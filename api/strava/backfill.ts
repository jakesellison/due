import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { methodAllowed, requireUser } from '../../src/server/apiAuth';
import { rateLimit } from '../../src/server/rateLimit';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { fetchActivity, fetchStreams, retryAfterSeconds } from '../../src/server/strava';
import { isStravaRateLimited, stravaRetryAfterS } from '../../src/server/stravaError';
import { fetchTempC } from '../../src/server/weather';
import { fullResStreams, computeStreamSummary, computeStreamSummaryFromStored, routeFromLatLng, type ActivityStreams, type QualityFloorInputs } from '../../src/server/streams';
import type { StravaLap as StreamLap } from '../../src/lib/run/analysis';
import { simplifyRouteForStore } from '../../src/lib/strava/derive';
import {
  ensureFreshAccessToken,
  fetchQualityInputs,
  fetchPlanQualityForDate,
  getUserTz,
  mapStravaActivity,
  upsertActivity,
  upsertSummaryActivities,
  withEnrichedAt,
  isPermanentStreamsFailure,
  stripUnsettledStreamKeys,
  shouldStampEnriched,
  type ActivityRow,
  type StravaActivity,
  type StravaConnection,
} from '../../src/server/ingest';
import {
  afterUnixSeconds,
  enrichOffsetFromCursor,
  ENRICH_PER_CALL,
  ENRICH_SELECT_FILTER,
  isRunActivity,
  mapStravaSummary,
  nextSummariesCursor,
  PURGED_STALE_VERSION_FILTER,
  SUMMARY_PER_PAGE,
  summariesPageFromCursor,
  type StravaSummaryActivity,
} from '../../src/server/backfill';

/**
 * POST /api/strava/backfill — client-driven, chunked history import.
 *
 * Authenticated with the caller's Supabase user JWT (Authorization: Bearer …),
 * verified the same way `auth.ts` verifies its query token. Each call does ONE
 * short chunk so the Vercel Hobby ~10s function limit is never hit; the client
 * (`src/app-lib/backfill.ts`) loops until `nextCursor` is null.
 *
 * Body: { phase: 'summaries' | 'enrich', cursor?: unknown, mode?: 'latest' | 'history' }
 *  - 'summaries': fetch one page of athlete activities (≤52 weeks back), filter
 *    to runs, upsert each via the light `mapStravaSummary`. In `latest` mode,
 *    only asks Strava for activities newer than the user's newest stored Strava
 *    activity. Returns the next page cursor or null at the end.
 *  - 'enrich': take the user's most-recent ≤30 strava rows never attempted (or
 *    attempted-but-missing the quality verdict), process up to 4 (detail +
 *    streams + weather), return progress and the next offset until none remain.
 *    See `ENRICH_SELECT_FILTER` (src/server/backfill.ts) for the exact predicate.
 *
 * On a Strava 429 anywhere, returns { rateLimited: true, retryAfterS } — the
 * back-off computed from the 429's own rate-limit headers (see
 * `retryAfterSeconds`), so the client resumes when Strava actually resets.
 */
const STRAVA_API = 'https://www.strava.com/api/v3';
const ENRICH_WINDOW = 30;

class RateLimited extends Error {
  constructor(readonly retryAfterS: number) { super('strava rate limited'); }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['POST'])) return;

  const userId = await requireUser(req, res);
  if (!userId) return; // response already sent

  // Each call fans out to the Strava API, whose quota is APP-WIDE — one user
  // looping here degrades sync for everyone. Bucket by user id, not IP.
  if (!rateLimit(req, res, { key: 'strava-backfill', limit: 60, windowMs: 60_000, subject: userId })) {
    return;
  }

  const body = (req.body ?? {}) as { phase?: string; cursor?: unknown; mode?: unknown };
  const phase = body.phase;
  const mode = body.mode === 'latest' ? 'latest' : 'history';
  if (phase !== 'summaries' && phase !== 'enrich') {
    res.status(400).json({ error: "phase must be 'summaries' or 'enrich'" });
    return;
  }

  const admin = createAdminClient();
  const conn = await getConnectionByUser(admin, userId);
  if (!conn) {
    res.status(409).json({ error: 'Strava not connected' });
    return;
  }

  try {
    if (phase === 'summaries') {
      await runSummaries(admin, conn, body.cursor, mode, res);
    } else {
      await runEnrich(admin, conn, body.cursor, res);
    }
  } catch (err) {
    if (err instanceof RateLimited) {
      res.status(200).json({ phase, rateLimited: true, retryAfterS: err.retryAfterS });
      return;
    }
    console.error('strava/backfill failed:', err);
    await captureError(err, { route: 'strava/backfill' });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Look up the caller's ACTIVE Strava connection (service role; RLS bypassed).
 * Active-only: a revoked connection must surface as 409 "not connected", not
 * be retried forever with a dead refresh token. */
async function getConnectionByUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<StravaConnection | null> {
  const { data, error } = await admin
    .from('integration_connections')
    .select('user_id, access_token, refresh_token, expires_at')
    .eq('provider', 'strava')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`getConnectionByUser failed: ${error.message}`);
  return (data as StravaConnection | null) ?? null;
}

// ---- phase: summaries ------------------------------------------------------

async function runSummaries(
  admin: ReturnType<typeof createAdminClient>,
  conn: StravaConnection,
  cursor: unknown,
  mode: 'latest' | 'history',
  res: ApiResponse,
): Promise<void> {
  const page = summariesPageFromCursor(cursor);
  const after = mode === 'latest'
    ? await latestAfterUnixSeconds(admin, conn.user_id)
    : afterUnixSeconds(new Date());
  const accessToken = await ensureFreshAccessToken(admin, conn);
  const tz = await getUserTz(admin, conn.user_id);

  const url =
    `${STRAVA_API}/athlete/activities?per_page=${SUMMARY_PER_PAGE}` +
    `&page=${page}&after=${after}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (resp.status === 429) throw new RateLimited(retryAfterSeconds(resp) ?? 900);
  if (!resp.ok) {
    throw new Error(`athlete/activities failed: ${resp.status} ${await resp.text()}`);
  }

  const list = (await resp.json()) as StravaSummaryActivity[];
  const returnedCount = Array.isArray(list) ? list.length : 0;
  const runSummaries = list.filter(isRunActivity);
  const existing = await existingSourceIds(
    admin,
    conn.user_id,
    runSummaries.map((summary) => String(summary.id)),
  );

  const rows = runSummaries.map((summary) => mapStravaSummary(summary, tz));
  const imported = await upsertSummaryActivities(admin, conn.user_id, rows, existing);

  res.status(200).json({
    phase: 'summaries',
    mode,
    imported,
    scanned: returnedCount,
    nextCursor: nextSummariesCursor(page, returnedCount),
  });
}

async function latestAfterUnixSeconds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin
    .from('activities')
    .select('start_date')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latest activity select failed: ${error.message}`);
  const start = (data as { start_date?: string | null } | null)?.start_date;
  if (!start) return afterUnixSeconds(new Date());
  const unix = Math.floor(new Date(start).getTime() / 1000);
  // Back up one minute so clock precision around the newest activity never
  // skips a same-minute import. Existing source_ids are filtered below.
  return Math.max(0, unix - 60);
}

async function existingSourceIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from('activities')
    .select('source_id')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .in('source_id', ids);
  if (error) throw new Error(`existing source ids select failed: ${error.message}`);
  return new Set((data ?? []).map((row) => String((row as { source_id: string }).source_id)));
}

// ---- phase: enrich ---------------------------------------------------------

interface EnrichTarget {
  source_id: string;
  start_date: string | null;
  raw: StravaActivity | null;
}

async function runEnrich(
  admin: ReturnType<typeof createAdminClient>,
  conn: StravaConnection,
  cursor: unknown,
  res: ApiResponse,
): Promise<void> {
  const offset = enrichOffsetFromCursor(cursor);

  // Most-recent ≤30 strava rows that either have NEVER been through a
  // detail-fetch enrich attempt (`enriched_at` null), or HAVE streams but
  // still lack the precomputed quality verdict (schema-evolution re-enrich).
  // See ENRICH_SELECT_FILTER's doc comment (src/server/backfill.ts) for why
  // streamless rows (manual entries, no best_efforts) must NOT stay in this
  // predicate forever once attempted. We page the FULL window every call (the
  // predicate shrinks as rows get enriched) and use the offset to skip ones we
  // already processed within this run.
  const { data, error } = await admin
    .from('activities')
    .select('source_id, start_date, raw')
    .eq('user_id', conn.user_id)
    .eq('source', 'strava')
    .or(ENRICH_SELECT_FILTER)
    .order('start_date', { ascending: false })
    .limit(ENRICH_WINDOW);
  if (error) throw new Error(`enrich select failed: ${error.message}`);

  // Observability only (best-effort, never blocks/throws): count how many of
  // this user's rows carry a stale/absent quality version AND have already
  // been purged (streams IS NULL by the 7-day raw-data cache — see
  // ENRICH_SELECT_FILTER's doc comment in src/server/backfill.ts). Those rows
  // are DELIBERATELY excluded from `targets` above; they stay frozen at their
  // old verdict until a user opens the run and `rehydrateActivity` re-fetches
  // from Strava. Logging the count makes that skip visible instead of silent.
  try {
    const { count: purgedStaleCount } = await admin
      .from('activities')
      .select('source_id', { count: 'exact', head: true })
      .eq('user_id', conn.user_id)
      .eq('source', 'strava')
      .not('enriched_at', 'is', null)
      .is('streams', null)
      .or(PURGED_STALE_VERSION_FILTER);
    if (purgedStaleCount) {
      console.log(
        `[strava-backfill] skipping ${purgedStaleCount} purged row(s) with a stale stream_summary version (streams nulled by the 7-day cache; recovered via rehydrateActivity on run-detail open)`,
      );
    }
  } catch {
    // Never let the observability count affect the enrich batch itself.
  }

  const targets = (data ?? []) as EnrichTarget[];
  const remaining = Math.max(0, targets.length - offset);
  const batch = targets.slice(offset, offset + ENRICH_PER_CALL);

  if (batch.length === 0) {
    res.status(200).json({ phase: 'enrich', enriched: 0, remaining: 0, nextCursor: null });
    return;
  }

  const accessToken = await ensureFreshAccessToken(admin, conn);
  const tz = await getUserTz(admin, conn.user_id);
  const qf = await fetchQualityInputs(admin, conn.user_id);

  let enriched = 0;
  for (const target of batch) {
    await enrichOne(admin, conn.user_id, accessToken, tz, qf, target);
    enriched += 1;
  }

  const nextOffset = offset + batch.length;
  const stillRemaining = Math.max(0, remaining - batch.length);
  res.status(200).json({
    phase: 'enrich',
    enriched,
    remaining: stillRemaining,
    nextCursor: stillRemaining > 0 ? { offset: nextOffset } : null,
  });
}

/**
 * Fetch the activity detail + streams + (best-effort) weather for one row and
 * upsert the enriched version. Reuses the same posture as the webhook ingest:
 * weather and streams are best-effort and never block the upsert.
 */
async function enrichOne(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  accessToken: string,
  tz: string,
  qf: QualityFloorInputs,
  target: EnrichTarget,
): Promise<void> {
  // FAST PATH — if the row already has streams stored (a version-only re-enrich),
  // recompute the summary LOCALLY: no Strava fetch, so it never touches the rate
  // limit or strands the row. This clears the mass v6 re-enrich churn. The
  // streams are fetched PER-ROW here (not in the bulk enrich SELECT — full-res
  // streams × the window would be multi-MB and could fail the query).
  //
  // Defensive note: `ENRICH_SELECT_FILTER` excludes purged (streams-null)
  // stale-version rows, so `target` here should never be one — but if a race
  // ever let one through, `stored?.streams != null` below is false and it
  // simply falls to the SLOW PATH (re-fetches from Strava) rather than
  // crashing on a null-streams recompute.
  const { data: stored } = await admin
    .from('activities')
    .select('streams, laps, local_date')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .eq('source_id', target.source_id)
    .maybeSingle();
  if (stored?.streams != null) {
    const plan = await fetchPlanQualityForDate(admin, userId, stored.local_date as string);
    const summary = computeStreamSummaryFromStored(stored.streams as ActivityStreams, qf, stored.laps as StreamLap[] | null, plan);
    const { error } = await admin
      .from('activities')
      .update({ stream_summary: summary, enriched_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('source', 'strava')
      .eq('source_id', target.source_id);
    if (error) throw new Error(`enrich (local recompute) failed: ${error.message}`);
    return;
  }

  // SLOW PATH — streams absent (new or genuinely-streamless row): fetch from Strava.
  let detail: StravaActivity;
  try {
    detail = (await fetchActivity(accessToken, target.source_id)) as unknown as StravaActivity;
  } catch (err) {
    // A 429 surfaces as a StravaHttpError from fetchActivity; classify off the
    // structured status so the client backs off.
    if (isStravaRateLimited(err)) throw new RateLimited(stravaRetryAfterS(err));
    throw err;
  }

  const row = mapStravaActivity(detail, tz);

  if (row.avg_temp_c == null && Array.isArray(detail.start_latlng) && detail.start_latlng.length === 2) {
    try {
      const [lat, lng] = detail.start_latlng;
      row.avg_temp_c = await fetchTempC(lat, lng, detail.start_date);
    } catch {
      // never block on weather
    }
  }

  let streamsSettled = true;
  try {
    const rawStreams = await fetchStreams(accessToken, target.source_id);
    row.streams = fullResStreams(rawStreams);
    const plan = await fetchPlanQualityForDate(admin, userId, row.local_date);
    row.stream_summary = computeStreamSummary(rawStreams, qf, row.laps as unknown as StreamLap[] | null, plan);
    // Prefer the full-resolution GPS path over the decimated summary polyline.
    const gpsRoute = routeFromLatLng(rawStreams);
    if (gpsRoute) row.route = gpsRoute;
    // Recompute the durable trace from the final route (see ingest.ts's
    // matching comment in ingestStravaActivity).
    row.route_simplified = simplifyRouteForStore(row.route);
  } catch (err) {
    // A rate-limited STREAMS fetch must back the whole loop off, same as the
    // detail fetch above — stamping it would permanently strand the row
    // streamless (the predicate never re-picks a stamped row). Other
    // transient failures upsert unstamped so a later pass retries; only a
    // permanent non-429 4xx terminates.
    if (isStravaRateLimited(err)) throw new RateLimited(stravaRetryAfterS(err));
    streamsSettled = isPermanentStreamsFailure(err);
  }

  await upsertActivity(
    admin,
    userId,
    shouldStampEnriched(row, streamsSettled) ? withEnrichedAt(row) : stripUnsettledStreamKeys(row),
  );
}
