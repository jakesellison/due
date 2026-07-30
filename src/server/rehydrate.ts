/**
 * On-demand REHYDRATE of a purged activity's raw Strava Data (Strava API
 * Policy §6.2 ≤7-day cache — see
 * `docs/superpowers/specs/2026-07-17-strava-7day-compliance-design.md`).
 *
 * The purge (`api/strava/purge-raw.ts`) nulls `raw`/`streams`/`route`/`laps`/
 * `suffer_score` on rows older than 7 days, keeping the durable
 * `stream_summary`/`route_simplified`/`hr_load` the app was built around. The
 * ONE surface that still needs the raw payload is run detail
 * (`SessionView.tsx`, via `streams`/`route`/`laps`). This module is the single
 * place that re-fetches it from Strava on open, so the detail screen keeps
 * working for old runs without duplicating `ingestStravaActivity`'s
 * fetch+summary pipeline.
 *
 * PURE-ish: all IO (Strava fetch, Supabase read/write) is injected via the
 * admin client / `fetchActivity`/`fetchStreams`, so the outcome shape is easy
 * to unit test with mocks — no live DB or Strava calls in tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ensureFreshAccessToken,
  fetchPlanQualityForDate,
  fetchQualityInputs,
  isRevokedTokenError,
  type StravaConnection,
} from './ingest';
import { fetchActivity, fetchStreams } from './strava';
import {
  computeStreamSummary,
  fullResStreams,
  routeFromLatLng,
  routeFromPolyline,
  STREAM_SUMMARY_VERSION,
} from './streams';
import { hrLoad, simplifyRouteForStore } from '../lib/strava/derive';
import type { StravaLap as StreamLap } from '../lib/run/analysis';
import type { ActivityRow as ClientActivityRow } from '../app-lib/queries/rows';

/**
 * Columns needed for the rehydrate read + the refreshed detail response.
 * Mirrors `ACTIVITY_DETAIL_COLUMNS` (`src/app-lib/queries/activities.ts`) plus
 * `user_id`/`source`/`source_id`/`raw` (needed server-side to authorize +
 * refetch, never returned to the client). This module is server-only and must
 * NOT import `activities.ts` directly — that file pulls in `@tanstack/react-query`
 * and the RN `supabase` client, which have no place in `api`/`src/server`. Keep
 * this list in sync with `ACTIVITY_DETAIL_COLUMNS` if the detail shape changes.
 */
const REHYDRATE_SELECT_COLUMNS =
  'id, user_id, source, source_id, name, local_date, distance_meters, moving_time_s, ' +
  'elapsed_time_s, avg_hr, user_note, start_date, avg_temp_c, best_efforts, workout_type, ' +
  'stream_summary, quality_override, enriched_at, max_hr, suffer_score, shoe_id, ' +
  'streams, route, laps, raw';

/** The subset of an `activities` row this module reads/writes. */
interface RehydrateRow extends ClientActivityRow {
  user_id: string;
  raw: Record<string, unknown> | null;
}

/** The detail row returned to the client — never leaks `user_id`/`raw`. */
export type RehydratedActivity = ClientActivityRow;

export type RehydrateOutcome =
  | { ok: true; activity: RehydratedActivity }
  | {
      ok: false;
      /** `not_found`: no row / not owned by caller. `not_connected`: no active
       *  Strava connection, or the token grant is revoked/invalid. `strava_unavailable`:
       *  a transient Strava error (rate limit, 5xx, network) — retryable later. */
      reason: 'not_found' | 'not_connected' | 'strava_unavailable';
      message: string;
    };

/** Strip server-only fields before handing a row back to the client. */
function toClientActivity(row: RehydrateRow): RehydratedActivity {
  const { user_id: _userId, raw: _raw, ...rest } = row;
  return rest;
}

/**
 * Rehydrate one activity for its owner. Given `{userId, activityId}`:
 *
 *  - Row not found / not owned by `userId` → `{ok:false, reason:'not_found'}`.
 *  - `streams` already populated (never purged, or already rehydrated) →
 *    NO-OP, returns the row as-is (no Strava call).
 *  - `streams` null (purged, or never fetched) → re-fetches `raw`/`streams`/
 *    `route`/`laps` from Strava via `fetchActivity`/`fetchStreams` using the
 *    user's stored token (`ensureFreshAccessToken`), persists them, and — only
 *    when the stored `stream_summary.quality.v` is stale/absent — recomputes
 *    `stream_summary` + `route_simplified`/`hr_load` from the fresh fetch
 *    (`computeStreamSummary`/`simplifyRouteForStore`/`hrLoad`, the same
 *    pipeline `ingestStravaActivity` uses — not duplicated here).
 *  - No active Strava connection, or the refresh-token grant is revoked →
 *    `{ok:false, reason:'not_connected'}` (never throws — the caller degrades
 *    gracefully rather than 500ing the detail screen).
 *  - A Strava fetch fails for any other reason (rate limit, 5xx, network) →
 *    `{ok:false, reason:'strava_unavailable'}`.
 */
export async function rehydrateActivity(
  admin: SupabaseClient,
  userId: string,
  activityId: string,
): Promise<RehydrateOutcome> {
  const { data, error } = await admin
    .from('activities')
    .select(REHYDRATE_SELECT_COLUMNS)
    .eq('id', activityId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    return { ok: false, reason: 'not_found', message: `lookup failed: ${error.message}` };
  }
  const row = data as unknown as RehydrateRow | null;
  if (!row) {
    return { ok: false, reason: 'not_found', message: 'activity not found' };
  }

  // No-op: streams already present (row was never purged, or a previous
  // rehydrate already repopulated it). Don't touch stream_summary here even
  // if its `v` is stale — that re-derive-from-stored-streams path is the
  // version-bump re-enrich's job (src/server/backfill.ts), not this one.
  if (row.streams != null) {
    return { ok: true, activity: toClientActivity(row) };
  }

  // Manual (non-Strava) rows have no raw Strava Data to rehydrate — return
  // as-is rather than attempting a Strava fetch that could never succeed.
  if (row.source !== 'strava' || !row.source_id) {
    return { ok: true, activity: toClientActivity(row) };
  }

  const { data: connRow, error: connErr } = await admin
    .from('integration_connections')
    .select('user_id, access_token, refresh_token, expires_at, status')
    .eq('provider', 'strava')
    .eq('user_id', userId)
    .maybeSingle();
  if (connErr) {
    return { ok: false, reason: 'not_connected', message: `connection lookup failed: ${connErr.message}` };
  }
  const conn = connRow as (StravaConnection & { status?: string }) | null;
  if (!conn || conn.status !== 'active') {
    return { ok: false, reason: 'not_connected', message: 'no active Strava connection' };
  }

  let accessToken: string;
  try {
    accessToken = await ensureFreshAccessToken(admin, conn);
  } catch (err) {
    if (isRevokedTokenError(err)) {
      return { ok: false, reason: 'not_connected', message: 'Strava grant revoked' };
    }
    return { ok: false, reason: 'strava_unavailable', message: errMessage(err) };
  }

  let raw: Record<string, unknown>;
  try {
    raw = await fetchActivity(accessToken, row.source_id);
  } catch (err) {
    return { ok: false, reason: 'strava_unavailable', message: errMessage(err) };
  }

  let rawStreams: Awaited<ReturnType<typeof fetchStreams>> = null;
  try {
    rawStreams = await fetchStreams(accessToken, row.source_id);
  } catch (err) {
    // Streams alone failing (rate limit/5xx/network) still degrades
    // gracefully — the caller falls back to the summary body, same as ingest.
    return { ok: false, reason: 'strava_unavailable', message: errMessage(err) };
  }

  const streams = fullResStreams(rawStreams);
  const laps = ((raw as { laps?: unknown }).laps as RehydrateRow['laps']) ?? null;
  const polylineRoute = routeFromPolyline(
    ((raw as { map?: { summary_polyline?: string; polyline?: string } }).map?.summary_polyline ??
      (raw as { map?: { summary_polyline?: string; polyline?: string } }).map?.polyline) ??
      null,
  );
  const gpsRoute = routeFromLatLng(rawStreams);
  const route = gpsRoute ?? polylineRoute;

  const update: Record<string, unknown> = {
    raw,
    streams,
    route,
    laps,
    suffer_score: intOrNull((raw as { suffer_score?: number | null }).suffer_score),
  };

  const staleV = (row.stream_summary?.quality?.v ?? null) !== STREAM_SUMMARY_VERSION;
  if (staleV) {
    const qf = await fetchQualityInputs(admin, userId);
    const plan = row.local_date ? await fetchPlanQualityForDate(admin, userId, row.local_date) : null;
    update.stream_summary = computeStreamSummary(rawStreams, qf, laps as unknown as StreamLap[] | null, plan);
    update.route_simplified = simplifyRouteForStore(route);
    update.hr_load = hrLoad({ movingTimeS: row.moving_time_s ?? 0, avgHr: row.avg_hr, maxHr: row.max_hr });
  }

  const { data: updated, error: updateErr } = await admin
    .from('activities')
    .update(update)
    .eq('id', activityId)
    .eq('user_id', userId)
    .select(REHYDRATE_SELECT_COLUMNS)
    .maybeSingle();
  if (updateErr) {
    return { ok: false, reason: 'strava_unavailable', message: `persist failed: ${updateErr.message}` };
  }

  const refreshed = (updated as unknown as RehydrateRow | null) ?? { ...row, ...update };
  return { ok: true, activity: toClientActivity(refreshed as RehydrateRow) };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function intOrNull(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v);
}
