import type { SupabaseClient } from '@supabase/supabase-js';
import { localDateOf } from '../lib/time/week';
import { simplifyRouteForStore, hrLoad } from '../lib/strava/derive';
import { deauthorizeStrava, fetchActivity, fetchStreams, refreshAccessToken } from './strava';
// From `stravaError`, NOT `strava` — several suites mock the latter wholesale,
// which would leave this binding undefined and make `instanceof` throw.
import { StravaHttpError } from './stravaError';
import { fetchTempC } from './weather';
import { maybeSendRunBankedPush } from './push';
import { maybeWriteRunDescription } from './stravaDescription';
import {
  fullResStreams,
  computeStreamSummary,
  routeFromPolyline,
  routeFromLatLng,
  type ActivityStreams,
  type StreamSummary,
  type QualityFloorInputs,
} from './streams';
import type { StravaLap as StreamLap } from '../lib/run/analysis';
import { computeEasyBaselineSecPerMi, FALLBACK_EASY_BASELINE_SEC_PER_MI } from '../lib/kpi/easyBaseline';
import {
  estimateQualityFloor,
  observedMaxHr,
  effectiveMaxHr,
  steadyZoneFloorBpm,
} from '../lib/kpi/qualityFloor';
import { planQualityFromWorkout } from '../lib/kpi/planQuality';
import type { PlanQuality } from '../lib/kpi/interpretWorkout';
import type { WorkoutStructure } from '../lib/workout/types';
// isRunActivity lives in ./backfill, which imports only a TYPE from this module —
// so this value import introduces no runtime cycle.
import { isRunActivity } from './backfill';

/** A single Strava lap (only the fields we read are typed). */
export interface StravaLap {
  average_heartrate?: number | null;
  average_speed?: number | null;
  [key: string]: unknown;
}

/** A single Strava best-effort segment (only the fields we read are typed). */
export interface StravaBestEffort {
  name?: string;
  distance?: number;
  elapsed_time?: number;
  start_date?: string;
  [key: string]: unknown;
}

/** Our normalized best-effort shape, persisted to `activities.best_efforts`. */
export interface BestEffort {
  name: string;
  distance_m: number;
  elapsed_s: number;
  start_date: string;
}

/** Raw Strava activity (only the fields we read are typed; full JSON preserved in `raw`). */
export interface StravaActivity {
  id: number | string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  suffer_score?: number | null;
  name: string;
  laps?: StravaLap[] | null;
  best_efforts?: StravaBestEffort[] | null;
  average_temp?: number | null;
  /** Strava run workout_type: 0 default, 1 race, 2 long run, 3 workout. */
  workout_type?: number | null;
  start_latlng?: [number, number] | null;
  map?: { summary_polyline?: string | null; polyline?: string | null } | null;
  sport_type?: string;
  type?: string;
  [key: string]: unknown;
}

/** A row for the `activities` table. */
export interface ActivityRow {
  source: 'strava';
  source_id: string;
  start_date: string;
  local_date: string;
  distance_meters: number;
  moving_time_s: number;
  elapsed_time_s: number;
  avg_hr: number | null;
  max_hr: number | null;
  suffer_score: number | null;
  name: string;
  laps: StravaLap[] | null;
  best_efforts: BestEffort[] | null;
  /** Strava workout_type (1 = race for runs), persisted lean so the predictor
   * reads it without fetching the full `raw` jsonb. Null when absent. */
  workout_type: number | null;
  avg_temp_c: number | null;
  streams: ActivityStreams | null;
  stream_summary: StreamSummary | null;
  route: [number, number][] | null;
  /**
   * Durable ≤50-pt coarse trace derived from `route`, computed at map time (and
   * recomputed whenever `route` is upgraded to the full-res GPS path) so the
   * Routes matcher survives the raw-route purge. See `src/lib/strava/derive.ts`.
   */
  route_simplified: [number, number][] | null;
  /**
   * Durable TRIMP training-load derived from moving_time_s/avg_hr/max_hr at map
   * time, so training-load survives even if avg_hr/max_hr are purged later. See
   * `src/lib/strava/derive.ts`.
   */
  hr_load: number | null;
  raw: StravaActivity;
  sport_type: string;
  /**
   * When the last detail-fetch enrich ATTEMPT completed (whether or not
   * streams/best_efforts came back) — set via `withEnrichedAt` right before
   * upsert in `ingestStravaActivity` and `enrichOne` (api/strava/backfill.ts).
   * Optional/absent on summary-only rows (`mapStravaSummary`) so a later
   * 'summaries' upsert never clobbers an existing stamp. Lets the backfill
   * 'enrich' select predicate distinguish "never attempted" from "attempted,
   * still lacking streams" and terminate instead of re-picking forever.
   */
  enriched_at?: string | null;
}

/**
 * Map Strava's `best_efforts[]` (present only on a detail fetch with all efforts)
 * to our normalized shape. Returns null when absent/empty. PURE. Entries missing
 * the core numeric fields are skipped; null is returned if nothing survives.
 */
export function mapBestEfforts(
  efforts: StravaBestEffort[] | null | undefined,
): BestEffort[] | null {
  if (!efforts || efforts.length === 0) return null;
  const mapped: BestEffort[] = [];
  for (const e of efforts) {
    if (
      typeof e.name === 'string' &&
      typeof e.distance === 'number' &&
      typeof e.elapsed_time === 'number' &&
      typeof e.start_date === 'string'
    ) {
      mapped.push({
        name: e.name,
        distance_m: e.distance,
        elapsed_s: e.elapsed_time,
        start_date: e.start_date,
      });
    }
  }
  return mapped.length > 0 ? mapped : null;
}

/**
 * Map a raw Strava activity JSON to an `activities` table row. PURE.
 * Strava distance is already in meters; we keep it as an integer.
 */
export function mapStravaActivity(raw: StravaActivity, tz: string): ActivityRow {
  const avgHr = intOrNull(raw.average_heartrate);
  const maxHr = intOrNull(raw.max_heartrate);
  const route = routeFromPolyline(raw.map?.summary_polyline ?? raw.map?.polyline ?? null);
  return {
    source: 'strava',
    source_id: String(raw.id),
    start_date: raw.start_date,
    local_date: localDateOf(raw.start_date, tz),
    distance_meters: Math.round(raw.distance),
    moving_time_s: raw.moving_time,
    elapsed_time_s: raw.elapsed_time,
    avg_hr: avgHr,
    max_hr: maxHr,
    suffer_score: intOrNull(raw.suffer_score),
    name: raw.name,
    laps: raw.laps ?? null,
    best_efforts: mapBestEfforts(raw.best_efforts),
    workout_type: typeof raw.workout_type === 'number' ? raw.workout_type : null,
    avg_temp_c: typeof raw.average_temp === 'number' ? raw.average_temp : null,
    // streams come from a separate /streams fetch; route is decoded from the
    // summary polyline (best-effort, upgraded to the full-res GPS path in
    // ingestStravaActivity/enrichOne, which also recomputes route_simplified).
    streams: null,
    stream_summary: null,
    route,
    // Durable derived values (see ActivityRow docs above) — computed here from
    // whatever route/HR are known at map time so even a summary-only row
    // (mapStravaSummary) or a detail row whose streams fetch fails still gets
    // them; both recomputed downstream if route/HR are later upgraded.
    route_simplified: simplifyRouteForStore(route),
    hr_load: hrLoad({ movingTimeS: raw.moving_time, avgHr, maxHr }),
    raw,
    sport_type: raw.sport_type ?? raw.type ?? 'Run',
  };
}

export interface HardLapOpts {
  /** Average-HR threshold a lap must meet/exceed to count as hard. Default 160. */
  hrThreshold?: number;
}

/**
 * Count "hard" laps. PURE.
 *
 * For this task a lap counts as hard when its `average_heartrate` is >= the
 * threshold (default 160). Laps without HR are not counted. A pace-based
 * heuristic is a future enhancement.
 */
export function countHardLaps(
  laps: StravaLap[] | null | undefined,
  opts: HardLapOpts = {},
): number {
  if (!laps || laps.length === 0) return 0;
  const threshold = opts.hrThreshold ?? 160;
  let count = 0;
  for (const lap of laps) {
    const hr = lap.average_heartrate;
    if (hr != null && hr >= threshold) count += 1;
  }
  return count;
}

/**
 * Returns `row` with `enriched_at` stamped to `now` (default: the real current
 * time). PURE aside from the injectable clock. Called right before upsert in
 * both detail-fetch enrich paths (`ingestStravaActivity` below and `enrichOne`
 * in `api/strava/backfill.ts`) — after the detail fetch itself has already
 * succeeded, so the stamp records "an enrich attempt completed", independent
 * of whether the best-effort streams/weather fetches that follow succeed.
 */
export function withEnrichedAt(row: ActivityRow, now: Date = new Date()): ActivityRow {
  return { ...row, enriched_at: now.toISOString() };
}

/** Persist (upsert) an activity row via the service-role admin client. IO. */
export async function upsertActivity(
  admin: SupabaseClient,
  userId: string,
  row: ActivityRow,
): Promise<void> {
  const { error } = await admin
    .from('activities')
    .upsert({ user_id: userId, ...row }, { onConflict: 'user_id,source,source_id' });
  if (error) throw new Error(`upsertActivity failed: ${error.message}`);
}

/**
 * Upsert a page of SUMMARY-mapped activity rows, guarding every existing row
 * with `stripDetailKeysForResummary` so a summaries re-upsert can never null an
 * enriched row's streams/laps/quality (the summaries-nuke). Returns the count of
 * rows that were NEW (not in `existingIds`). IO.
 *
 * SINGLE SOURCE for the guarded summary write — shared by BOTH summary handlers
 * (`api/strava/backfill.ts` history + `api/strava/sync-latest.ts` latest). They
 * were copy-pasted, and the guard was once added to one and missed on the other,
 * which re-nuked the newest run on every app open. Keep the guard here so it
 * cannot drift out of one endpoint again.
 */
export async function upsertSummaryActivities(
  admin: SupabaseClient,
  userId: string,
  rows: ActivityRow[],
  existingIds: Set<string>,
): Promise<number> {
  let imported = 0;
  for (const row of rows) {
    const isExisting = existingIds.has(row.source_id);
    if (!isExisting) imported += 1;
    await upsertActivity(admin, userId, isExisting ? stripDetailKeysForResummary(row) : row);
  }
  return imported;
}

const DEFAULT_TZ = 'America/Chicago';

/** A Strava integration_connections row (fields we read). */
export interface StravaConnection {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  /** Persisted OAuth grants. Optional because non-write sync callers can still
   *  supply legacy/test connection fixtures without it. */
  scope?: string | null;
}

/**
 * Look up a Strava connection by athlete id. Returns null if not connected. IO.
 */
export async function getConnectionByAthlete(
  admin: SupabaseClient,
  ownerId: number | string,
): Promise<StravaConnection | null> {
  // Tolerate more than one row for an athlete (dev cruft: same athlete linked to
  // multiple users) — take the most-recent active connection instead of throwing.
  const { data, error } = await admin
    .from('integration_connections')
    .select('user_id, access_token, refresh_token, expires_at, scope')
    .eq('provider', 'strava')
    .eq('provider_athlete_id', String(ownerId))
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`getConnectionByAthlete failed: ${error.message}`);
  return ((data?.[0] as StravaConnection | undefined) ?? null) as StravaConnection | null;
}

/**
 * Whether a Strava token-refresh error means the grant is gone for good
 * (user revoked access, or the refresh token is otherwise invalid) rather than
 * a transient failure (network blip, 5xx). `refreshAccessToken` throws an Error
 * whose message embeds the HTTP status; Strava answers 400 (invalid_grant) /
 * 401 for a revoked or invalid refresh token. We deactivate ONLY on those.
 */
export function isRevokedTokenError(err: unknown): boolean {
  // Prefer the structured status — keyed to the token-refresh OPERATION, so a
  // 401 from an activity fetch is never mistaken for a revoked grant.
  if (err instanceof StravaHttpError) {
    return err.operation === 'token-refresh' && (err.status === 400 || err.status === 401);
  }
  const message = err instanceof Error ? err.message : String(err);
  return /token refresh failed:\s*(400|401)\b/.test(message);
}

/** Mark a connection inactive so it stops triggering ingests/refreshes. IO. */
export async function deactivateConnection(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  await admin
    .from('integration_connections')
    .update({ status: 'revoked' })
    .eq('user_id', userId)
    .eq('provider', 'strava');
}

/**
 * Return a valid access token for a connection, refreshing + persisting if the
 * stored token expires within the next 60 seconds. IO.
 */
export async function ensureFreshAccessToken(
  admin: SupabaseClient,
  conn: StravaConnection,
): Promise<string> {
  const expiresMs = new Date(conn.expires_at).getTime();
  if (expiresMs - Date.now() > 60_000) return conn.access_token;

  let refreshed;
  try {
    refreshed = await refreshAccessToken(conn.refresh_token);
  } catch (err) {
    // If Strava says the grant is revoked/invalid, deactivate so this
    // connection stops churning on every webhook/cron. Transient failures
    // (network, 5xx) re-throw untouched so they can be retried later.
    if (isRevokedTokenError(err)) {
      await deactivateConnection(admin, conn.user_id);
    }
    throw err;
  }
  await persistRefreshedToken(admin, conn.user_id, refreshed);
  return refreshed.accessToken;
}

/**
 * Persist a freshly-refreshed Strava grant. Strava ROTATES the refresh token on
 * every refresh, so any caller that refreshes must store the result or it burns
 * the connection it just renewed. IO.
 */
export async function persistRefreshedToken(
  admin: SupabaseClient,
  userId: string,
  refreshed: { accessToken: string; refreshToken: string; expiresAt: string },
): Promise<void> {
  const { error } = await admin
    .from('integration_connections')
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expires_at: refreshed.expiresAt,
    })
    .eq('user_id', userId)
    .eq('provider', 'strava');
  if (error) throw new Error(`token refresh persist failed: ${error.message}`);
}

/** Fetch the user's IANA tz from `users`, defaulting to America/Chicago. IO. */
export async function getUserTz(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .select('tz')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`getUserTz failed: ${error.message}`);
  const tz = (data as { tz?: string | null } | null)?.tz;
  return tz ?? DEFAULT_TZ;
}

/**
 * Derive the runner's quality floor for ingest-time detection: active plan's
 * workouts type the easy days; lean activity fields give the paces. Mirrors
 * the client derivation (weeklyMileage). Any failure → fallback baseline.
 *
 * `plans` has no `user_id` column — ownership is via `plan_members` (plan_id,
 * user_id) — so the active plan is resolved through that join, not a direct
 * `.eq('user_id', ...)` on `plans` (the admin client bypasses RLS, so this
 * membership filter is what keeps the lookup scoped to the caller).
 */
export async function fetchQualityInputs(
  admin: SupabaseClient,
  userId: string,
): Promise<QualityFloorInputs> {
  let easyBaselineSecPerMi = FALLBACK_EASY_BASELINE_SEC_PER_MI;

  // Per-runner HR floor for HR-confirmed detection. Derived from the athlete's
  // OWN history (98th-pct of per-activity max HR, ≥10 runs) → effective max HR →
  // steady-zone floor (0.83×). Best-effort + isolated: any failure leaves
  // hrFloor null (pace/GAP fallback) and never blocks ingest. No hardcoded floor.
  let hrModel: { steadyZoneFloorBpm: number } | null = null;
  try {
    const { data: hrRows } = await admin
      .from('activities')
      .select('max_hr')
      .eq('user_id', userId)
      .not('max_hr', 'is', null);
    const perActivityMax = ((hrRows ?? []) as { max_hr: number | null }[]).map((r) => r.max_hr);
    const observed = observedMaxHr(perActivityMax);
    if (observed != null) {
      const { maxHr } = effectiveMaxHr({ observedMaxHr: observed });
      hrModel = { steadyZoneFloorBpm: steadyZoneFloorBpm(maxHr) };
    }
  } catch {
    // never block ingest on HR-floor derivation — fall back to pace/GAP
  }

  try {
    const { data: memberships } = await admin
      .from('plan_members')
      .select('plan_id')
      .eq('user_id', userId);
    const planIds = ((memberships ?? []) as { plan_id: string }[]).map((m) => m.plan_id);
    if (planIds.length > 0) {
      const { data: plans } = await admin
        .from('plans')
        .select('id, start_date, num_weeks')
        .in('id', planIds)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);
      const plan = plans?.[0] as { id: string; start_date: string | null; num_weeks: number | null } | undefined;
      if (plan?.start_date && plan.num_weeks) {
        const planEnd = new Date(new Date(plan.start_date + 'T00:00:00Z').getTime() + plan.num_weeks * 7 * 86400_000)
          .toISOString()
          .slice(0, 10);
        const [{ data: workouts }, { data: activities }] = await Promise.all([
          admin.from('workouts').select('date, type, is_quality').eq('plan_id', plan.id),
          admin
            .from('activities')
            .select('local_date, distance_meters, moving_time_s')
            .eq('user_id', userId)
            .gte('local_date', plan.start_date)
            .lte('local_date', planEnd),
        ]);
        easyBaselineSecPerMi = computeEasyBaselineSecPerMi(
          (activities ?? []) as { local_date: string | null; distance_meters: number | null; moving_time_s: number | null }[],
          (workouts ?? []) as { date: string | null; is_quality: boolean; type: string | null }[],
        );
      }
    }
  } catch {
    // never block ingest on floor derivation — fall back
  }
  return { floor: estimateQualityFloor({ easyBaselineSecPerMi, hrModel }), easyBaselineSecPerMi };
}

/**
 * The prescribed quality for the athlete's ACTIVE-plan workout on a given local
 * date, mapped to the interpreter's `PlanQuality` — the prior it uses to PREFER
 * the prescribed reading. Returns null when there's no active plan, no workout
 * that day, or the day prescribes no quality. Resilient: a lookup failure never
 * strands ingest (returns null and the run is interpreted plan-agnostically).
 */
export async function fetchPlanQualityForDate(
  admin: SupabaseClient,
  userId: string,
  localDate: string,
): Promise<PlanQuality | null> {
  try {
    const { data: memberships } = await admin
      .from('plan_members')
      .select('plan_id')
      .eq('user_id', userId);
    const planIds = ((memberships ?? []) as { plan_id: string }[]).map((m) => m.plan_id);
    if (planIds.length === 0) return null;
    const { data: plans } = await admin
      .from('plans')
      .select('id')
      .in('id', planIds)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    const planId = (plans?.[0] as { id: string } | undefined)?.id;
    if (!planId) return null;
    const { data: workouts } = await admin
      .from('workouts')
      .select('id, structure, planned_distance_meters, prescribed_quality_meters')
      .eq('plan_id', planId)
      .eq('date', localDate)
      .limit(1);
    const w = workouts?.[0] as
      | {
          id: string;
          structure: WorkoutStructure | null;
          planned_distance_meters: number | null;
          prescribed_quality_meters: number | null;
        }
      | undefined;
    if (!w?.structure) return null;
    return planQualityFromWorkout({
      id: w.id,
      structure: w.structure,
      plannedDistanceMeters: w.planned_distance_meters,
      prescribedQualityMeters: w.prescribed_quality_meters,
    });
  } catch {
    return null; // never block ingest on the plan lookup
  }
}

/**
 * Fetch + map + upsert a single Strava activity for a connected athlete.
 * Used by the webhook for `create`/`update` events. IO.
 */
export async function ingestStravaActivity(
  admin: SupabaseClient,
  conn: StravaConnection,
  activityId: number | string,
  notifyOnBank = false,
): Promise<void> {
  const accessToken = await ensureFreshAccessToken(admin, conn);
  const raw = (await fetchActivity(accessToken, activityId)) as unknown as StravaActivity;

  // Only runs belong in Due. The summaries/backfill phases filter with
  // isRunActivity, but the real-time WEBHOOK fires for EVERY activity type
  // (rides, e-bikes, swims, walks) and ingests by id — so filter here, the single
  // detail-ingest chokepoint. If a non-run was previously mis-ingested (or a run
  // was edited to another sport), an update webhook removes the stale row.
  if (!isRunActivity(raw)) {
    await deleteStravaActivity(admin, conn.user_id, activityId);
    return;
  }

  const tz = await getUserTz(admin, conn.user_id);
  const qf = await fetchQualityInputs(admin, conn.user_id);
  const row = mapStravaActivity(raw, tz);

  // Best-effort weather backfill: if Strava didn't supply a temperature and we
  // have start coordinates, look it up. Any failure leaves avg_temp_c null and
  // MUST NOT block the ingest.
  if (row.avg_temp_c == null && Array.isArray(raw.start_latlng) && raw.start_latlng.length === 2) {
    try {
      const [lat, lng] = raw.start_latlng;
      row.avg_temp_c = await fetchTempC(lat, lng, raw.start_date);
    } catch {
      // never block ingest on weather
    }
  }

  // Best-effort streams fetch: many activities lack streams (manual entries,
  // some devices) and fetchStreams returns null — that is a legitimate,
  // TERMINAL outcome and gets the enriched_at stamp. A TRANSIENT failure
  // (rate limit, network, 5xx) must NOT stamp: stamping a failed fetch
  // permanently strands the row streamless (the enrich predicate never
  // re-picks a stamped row). Permanent 4xx (private, gone) still stamps so
  // the predicate terminates.
  let streamsSettled = true;
  try {
    const rawStreams = await fetchStreams(accessToken, activityId);
    row.streams = fullResStreams(rawStreams);
    const plan = await fetchPlanQualityForDate(admin, conn.user_id, row.local_date);
    row.stream_summary = computeStreamSummary(rawStreams, qf, row.laps as unknown as StreamLap[] | null, plan);
    // Prefer the full-resolution `latlng` stream over the decimated summary
    // polyline already set on the row — it keeps real path detail (track laps
    // especially) instead of a blocky, spiky simplification.
    const gpsRoute = routeFromLatLng(rawStreams);
    if (gpsRoute) row.route = gpsRoute;
    // route_simplified was derived from the (worse) polyline route in
    // mapStravaActivity — recompute from the final route so the durable trace
    // matches whichever route (GPS or polyline) actually landed.
    row.route_simplified = simplifyRouteForStore(row.route);
  } catch (err) {
    // never block ingest on streams — but only terminate on permanent 4xx
    // (not 429); rate limits and transient errors leave the row unstamped
    // so a later enrich pass retries.
    streamsSettled = isPermanentStreamsFailure(err);
  }

  await upsertActivity(
    admin,
    conn.user_id,
    shouldStampEnriched(row, streamsSettled) ? withEnrichedAt(row) : stripUnsettledStreamKeys(row),
  );

  // "Run banked" push — only for a fresh webhook `create` (not `update`, not the
  // history backfill). Idempotent (push_sent_at) and best-effort: never block
  // ingest on a notification failure.
  if (notifyOnBank) {
    try {
      await maybeSendRunBankedPush(admin, conn.user_id, activityId, row.distance_meters ?? null, row.stream_summary?.quality);
    } catch (err) {
      console.warn('[push] run-banked notify failed', err);
    }
  }

  // Plan context into the Strava description (opt-in). Run on create AND update:
  // the merge is idempotent, so the update webhook caused by our own PUT stops
  // at `unchanged`, while a later Strava edit or a transient first-write failure
  // gets another safe opportunity to reconcile.
  try {
    await maybeWriteRunDescription(
      admin,
      conn.user_id,
      accessToken,
      activityId,
      row.local_date,
      (raw as { description?: string | null }).description ?? null,
      conn.scope,
    );
  } catch (err) {
    console.warn('[strava-desc] write failed', err);
  }
}

/**
 * True when a streams-fetch error will never succeed on retry (a non-429
 * client error: private activity, deleted, unsupported). Rate limits (429),
 * server errors, and network failures are transient — the caller must leave
 * the row unstamped so it is re-picked.
 */
export function isPermanentStreamsFailure(err: unknown): boolean {
  if (err instanceof StravaHttpError) {
    return err.status >= 400 && err.status < 500 && err.status !== 429;
  }
  if (!(err instanceof Error)) return false;
  const m = err.message.match(/ (4\d\d)(\s|$|:)/);
  return m != null && m[1] !== '429';
}

/**
 * Hours after an activity's start during which missing streams/laps are read as
 * "Strava is still processing the upload" (transient) rather than "this activity
 * will never have them" (permanent). Strava computes laps/splits/best_efforts
 * and the streams endpoint a few minutes AFTER upload; a fetch inside that window
 * returns a lap-less detail and a 404 on /streams. Generous (24 h) so a run that
 * uploads hours after it finishes is still retried, at the cost of a few bounded
 * retries on a genuinely-streamless fresh manual entry before it terminates.
 */
export const STREAM_PROCESSING_WINDOW_HOURS = 24;

/** Whether `startDate` is within the post-upload processing window of `now`. PURE.
 *  An unparseable date yields false (treat as settled) so it never loops forever. */
export function withinStreamProcessingWindow(
  startDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!startDate) return false;
  const startMs = new Date(startDate).getTime();
  if (!Number.isFinite(startMs)) return false;
  const ageHours = (now.getTime() - startMs) / 3_600_000;
  return ageHours >= 0 && ageHours < STREAM_PROCESSING_WINDOW_HOURS;
}

/**
 * Whether an enrich attempt should stamp `enriched_at`. PURE.
 *
 * Stamping marks a row "done" — the enrich predicate never re-picks a stamped
 * row that lacks streams (see ENRICH_SELECT_FILTER). So we must NOT stamp a row
 * whose streams/laps are merely still-processing, or it strands permanently
 * (the fetched-too-early bug). Rules:
 *
 *  - Streams fetch not settled (429 / 5xx / network — `streamsSettled` false):
 *    never stamp; a later pass retries.
 *  - Streams settled AND the row has both streams and laps: fully processed →
 *    stamp.
 *  - Streams settled but streams and/or laps missing: stamp ONLY once the
 *    activity is past the processing window — so a fresh upload is retried until
 *    Strava finishes, while a genuinely-streamless old/manual row still
 *    terminates (bounded, no churn).
 */
export function shouldStampEnriched(
  row: Pick<ActivityRow, 'start_date' | 'streams' | 'laps'>,
  streamsSettled: boolean,
  now: Date = new Date(),
): boolean {
  if (!streamsSettled) return false;
  if (row.streams != null && row.laps != null) return true;
  return !withinStreamProcessingWindow(row.start_date, now);
}

/**
 * Strip the stream-derived keys from an upsert payload after a FAILED streams
 * fetch. `mapStravaActivity` seeds `streams`/`stream_summary` as null and
 * `route` as the summary polyline; upserting those over an already-enriched
 * row (update-webhook re-ingest, retitles) would null a good verdict and
 * downgrade the full-res route while the row's OLD `enriched_at` survives —
 * permanently stranding it outside the enrich predicate AND flipping it to
 * "proven streamless" for the quality fallback. Absent keys leave existing
 * columns untouched; a brand-new row simply waits minutes for its enrich.
 *
 * `route_simplified` is stripped alongside `route` for the same reason — it was
 * derived from the not-yet-final polyline route in `mapStravaActivity`, so
 * upserting it here would downgrade an already-enriched row's full-res-derived
 * trace. `hr_load` is NOT stripped: it derives from `avg_hr`/`max_hr`/
 * `moving_time_s`, which are written on every attempt regardless of streams
 * settling, so recomputing it here is always consistent with the row's other
 * (unstripped) HR scalars.
 */
export function stripUnsettledStreamKeys(row: ActivityRow): ActivityRow {
  const { streams: _s, stream_summary: _ss, route: _r, route_simplified: _rs, ...rest } = row as ActivityRow & {
    streams?: unknown;
    stream_summary?: unknown;
    route?: unknown;
    route_simplified?: unknown;
  };
  return rest as ActivityRow;
}

/**
 * Strip the detail-derived keys from a SUMMARY-phase upsert payload for a row
 * that ALREADY EXISTS. `mapStravaSummary` seeds streams / stream_summary / laps
 * / best_efforts as null and route/raw from the light summary — upserting those
 * over an already-enriched row would null its streams + quality verdict + laps
 * and downgrade its full-res route/detail raw, all while its `enriched_at`
 * survives (mapStravaSummary omits the stamp) — permanently stranding it outside
 * the enrich predicate (the summaries-nuke). Omitting the keys leaves those
 * columns untouched on the existing row while the light summary scalars (name,
 * distance, times, hr, workout_type) still refresh. Only applied to rows already
 * present; a brand-new summary row keeps its polyline route + summary raw.
 *
 * `route_simplified` is stripped alongside `route` for the same downgrade
 * reason — a light resummary derives it from the coarser summary polyline, and
 * upserting it would overwrite the (better) full-res-derived trace an enriched
 * row already has. `hr_load` is NOT stripped: it derives from `avg_hr`/
 * `max_hr`/`moving_time_s`, which DO refresh on a summary resync (see the
 * "light summary scalars" note above) — recomputing it alongside those keeps
 * it consistent rather than stale.
 */
export function stripDetailKeysForResummary(row: ActivityRow): ActivityRow {
  const {
    streams: _s,
    stream_summary: _ss,
    laps: _l,
    best_efforts: _be,
    route: _r,
    route_simplified: _rs,
    raw: _raw,
    ...rest
  } = row as ActivityRow & {
    streams?: unknown;
    stream_summary?: unknown;
    laps?: unknown;
    best_efforts?: unknown;
    route?: unknown;
    route_simplified?: unknown;
    raw?: unknown;
  };
  return rest as ActivityRow;
}

/** Delete a previously-ingested Strava activity. IO. */
export async function deleteStravaActivity(
  admin: SupabaseClient,
  userId: string,
  activityId: number | string,
): Promise<void> {
  const { error } = await admin
    .from('activities')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'strava')
    .eq('source_id', String(activityId));
  if (error) throw new Error(`deleteStravaActivity failed: ${error.message}`);
}

/**
 * Delete ALL of a user's Strava-sourced activities — the data-deletion half of a
 * deauthorization (the athlete revoked access). Manual activities are left
 * untouched. IO.
 */
export async function deleteAllStravaActivities(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await admin
    .from('activities')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'strava');
  if (error) throw new Error(`deleteAllStravaActivities failed: ${error.message}`);
}

/**
 * Revoke a user's Strava OAuth grant and delete their Strava-sourced
 * activities, then mark the connection revoked. A no-op when there is no
 * ACTIVE Strava connection for the user (idempotent).
 *
 * Shared by the user-facing "Disconnect Strava" (`api/strava/disconnect.ts`)
 * and account deletion (`src/server/accountDeletion.ts`) — both need exactly
 * this revoke-then-delete-then-deactivate sequence, so it lives in one place
 * rather than being duplicated. IO.
 */
export async function revokeStravaConnection(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: conn, error: connErr } = await admin
    .from('integration_connections')
    .select('user_id, access_token, refresh_token, expires_at, status')
    .eq('provider', 'strava')
    .eq('user_id', userId)
    .maybeSingle();
  if (connErr) throw new Error(`revokeStravaConnection lookup failed: ${connErr.message}`);

  if (!conn || (conn as { status?: string }).status !== 'active') return;

  try {
    // Revoke on Strava first (best-effort), using a fresh token.
    const accessToken = await ensureFreshAccessToken(admin, conn as StravaConnection);
    await deauthorizeStrava(accessToken);
  } catch (err) {
    // A token-refresh failure means the grant is already gone — proceed to clean up.
    console.warn('revokeStravaConnection: deauthorize skipped:', err);
  }

  await deleteAllStravaActivities(admin, userId);
  await deactivateConnection(admin, userId);
}

/** Strava sends floats (e.g. average_heartrate: 151.5); integer columns need rounding. */
function intOrNull(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v);
}
