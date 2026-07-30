/**
 * Pure, testable logic for the chunked Strava history backfill.
 *
 * The backfill is CLIENT-DRIVEN: the app calls `POST /api/strava/backfill`
 * repeatedly, one short chunk per request, so each Vercel function invocation
 * stays well under the Hobby ~10s limit. This module holds the parts with no IO
 * (mapping a SUMMARY activity to an `activities` row, the run-ish filter, the
 * "after" window and cursor arithmetic) so they can be unit-tested under the
 * node jest project. The fetch + persist wiring lives in `api/strava/backfill.ts`.
 */

import { localDateOf } from '../lib/time/week';
import { routeFromPolyline } from './streams';
import { STREAM_SUMMARY_VERSION } from '../lib/kpi/ingestVerdict';
import { simplifyRouteForStore, hrLoad } from '../lib/strava/derive';
import type { ActivityRow } from './ingest';

/**
 * Activities older than this window are not imported by the backfill. Widened
 * 16 → 52 weeks (112 → 364 days) so the ridge v2 deep-history features (km_32wk,
 * year-to-date, the 16–32 wk prior block, volume_trend) have real data instead of
 * median imputation. The summaries phase pages further back; enrich policy (the
 * recent 30) is unchanged. Idempotent by upsert, so re-running just reaches older.
 */
export const BACKFILL_WEEKS = 52;

/** How many activities to ENRICH (detail+streams+weather) per 'enrich' chunk. */
export const ENRICH_PER_CALL = 4;

/** How many summary activities to request per 'summaries' page. */
export const SUMMARY_PER_PAGE = 100;

/**
 * The "quality verdict is stale for the current detector policy" leg, shared
 * between `ENRICH_SELECT_FILTER` (gated on `streams.not.is.null`, so it only
 * re-picks rows that CAN be locally recomputed) and
 * `PURGED_STALE_VERSION_FILTER` (gated on `streams.is.null` instead, purely
 * for counting/observability — never selected for re-enrich work). Declared
 * once here so the two filters can never drift on what counts as "stale".
 */
const STALE_QUALITY_VERSION_FILTER =
  `stream_summary->quality->>v.is.null,stream_summary->quality->>v.neq.${STREAM_SUMMARY_VERSION}`;

/**
 * PostgREST `.or()` filter for the 'enrich' phase select (api/strava/backfill.ts
 * runEnrich): rows that have NEVER been attempted (`enriched_at` is null) OR
 * rows that HAVE streams but carry a quality verdict older than the current
 * detector policy (`stream_summary->quality->>v` absent or ≠
 * STREAM_SUMMARY_VERSION) — the schema-evolution / policy-bump re-enrich.
 *
 * The version leg uses two or-clauses because of SQL null semantics: a row with
 * NO quality at all (or a pre-versioning quality object) has `quality->>v` = NULL,
 * which `.neq.<N>` would NOT match (NULL ≠ '<N>' is UNKNOWN, not TRUE) — so the
 * explicit `->>v.is.null` leg catches those, and `->>v.neq.<N>` catches rows
 * stamped by a genuinely older version (e.g. the v2 rows picked up by the v3
 * block-merge bump). TERMINATION: the current code always writes
 * `v: STREAM_SUMMARY_VERSION`, so once a row re-enriches its `quality->>v`
 * matches, failing BOTH legs — it exits the predicate for good and is never
 * re-picked.
 *
 * Deliberately excludes rows that were attempted and simply have no streams
 * (manual entries, some devices, activities Strava never returns best_efforts
 * for) — those would never satisfy a streams-based predicate, so including
 * them here would refetch the same never-enrichable rows every single enrich
 * pass forever (confirmed live: ~5 bursts on the same 10 rows, ~350 wasted
 * Strava API calls before this fix). Once `enriched_at` is stamped the row
 * exits the never-attempted leg for good, whether or not the attempt found streams.
 *
 * This SAME `streams.not.is.null` guard is also what keeps the version-bump
 * re-enrich leg from picking up rows purged by the 7-day raw-data cache
 * (`api/strava/purge-raw.ts` nulls `streams`/`raw`/`route`/`laps`/`suffer_score`
 * once `start_date` is >7 days old — see
 * `docs/superpowers/specs/2026-07-17-strava-7day-compliance-design.md`). A
 * purged row can have a stale `stream_summary.quality.v` (it was enriched
 * before purge) with `streams IS NULL`; `computeStreamSummaryFromStored`
 * cannot re-derive a summary from streams that no longer exist, so the batch
 * re-enrich intentionally SKIPS it rather than crash or silently refetch
 * everyone's full history from Strava (rate-limit blowup). It stays frozen at
 * its old `v` until a user opens that run's detail, which triggers
 * `rehydrateActivity` (`src/server/rehydrate.ts`) to re-fetch from Strava and
 * recompute — the intended, user-triggered recovery path for purged history.
 * `PURGED_STALE_VERSION_FILTER` below (used by the backfill handler for a
 * lightweight observability count) targets exactly this skipped set.
 */
export const ENRICH_SELECT_FILTER =
  `enriched_at.is.null,and(streams.not.is.null,or(${STALE_QUALITY_VERSION_FILTER}))`;

/**
 * PostgREST `.or()` filter identifying rows the version-bump re-enrich WOULD
 * want to touch (stale/absent `stream_summary.quality.v`) but CAN'T, because
 * their raw `streams` were purged by the 7-day cache. Not used to select rows
 * for enrich work (that's `ENRICH_SELECT_FILTER`, which explicitly excludes
 * this set) — only for a best-effort count/log in the backfill handler so the
 * skip is observable rather than silent. See `ENRICH_SELECT_FILTER`'s doc
 * comment above for the full rationale.
 */
export const PURGED_STALE_VERSION_FILTER = STALE_QUALITY_VERSION_FILTER;

/**
 * A Strava SUMMARY activity (the shape returned by
 * `GET /athlete/activities`). Only the fields we read are typed; the full JSON
 * is preserved on the row's `raw`. Summaries carry distance / moving_time /
 * start_date and (sometimes) average_heartrate + a `map.summary_polyline`, but
 * NO best_efforts, laps or streams — those come later in the 'enrich' phase.
 */
export interface StravaSummaryActivity {
  id: number | string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  suffer_score?: number | null;
  name?: string;
  average_temp?: number | null;
  /** Strava run workout_type (1 = race), when present on the summary. */
  workout_type?: number | null;
  map?: { summary_polyline?: string | null; polyline?: string | null } | null;
  sport_type?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * The set of Strava `type` / `sport_type` values we treat as runs. Trail runs
 * and virtual runs count; walks/hikes/rides do not. Strava is mid-migration
 * from `type` to `sport_type`; prefer `sport_type` when present.
 */
const RUN_TYPES = new Set(['run', 'trailrun', 'virtualrun']);

/** True iff a Strava activity (summary or detail) is a run we want to import. PURE. */
export function isRunActivity(
  a: { type?: string | null; sport_type?: string | null } | null | undefined,
): boolean {
  if (!a) return false;
  const t = (a.sport_type ?? a.type ?? '').toLowerCase();
  return RUN_TYPES.has(t);
}

/**
 * The unix-seconds `after` bound for the summaries fetch: `weeks` weeks before
 * `now`. PURE. Strava's `after` filter is inclusive of newer activities.
 */
export function afterUnixSeconds(now: Date, weeks = BACKFILL_WEEKS): number {
  const ms = now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000;
  return Math.floor(ms / 1000);
}

/**
 * Map a Strava SUMMARY activity to an `activities` row. PURE.
 *
 * Lighter than `mapStravaActivity`: summaries have no best_efforts, laps or
 * streams, so those are null and get filled later by the 'enrich' phase. The
 * route is decoded from `map.summary_polyline` when present, and `avg_temp_c`
 * from `average_temp` when Strava supplied it. Distance is already meters.
 *
 * Also computes the durable `route_simplified`/`hr_load` (see
 * `mapStravaActivity` in `./ingest`, which mirrors this) so a summary-only row
 * still has a coarse trace + training-load; `stripDetailKeysForResummary`
 * (`./ingest`) strips `route_simplified` (but not `hr_load`) when resyncing an
 * already-enriched row, to avoid downgrading its full-res-derived trace.
 */
export function mapStravaSummary(raw: StravaSummaryActivity, tz: string): ActivityRow {
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
    name: raw.name ?? 'Run',
    laps: null,
    best_efforts: null,
    workout_type: typeof raw.workout_type === 'number' ? raw.workout_type : null,
    avg_temp_c: typeof raw.average_temp === 'number' ? raw.average_temp : null,
    streams: null,
    stream_summary: null,
    route,
    route_simplified: simplifyRouteForStore(route),
    hr_load: hrLoad({ movingTimeS: raw.moving_time, avgHr, maxHr }),
    raw: raw as unknown as ActivityRow['raw'],
    sport_type: raw.sport_type ?? raw.type ?? 'Run',
  };
}

/** Cursor for the 'summaries' phase: the 1-based page to fetch next. */
export interface SummariesCursor {
  page: number;
}

/** Cursor for the 'enrich' phase: offset into the list of un-enriched rows. */
export interface EnrichCursor {
  offset: number;
}

/**
 * Decide the next 'summaries' cursor given how many activities a page returned.
 * A full page (== perPage) means there may be more, so advance; a short/empty
 * page means we've reached the end. PURE.
 */
export function nextSummariesCursor(
  currentPage: number,
  returnedCount: number,
  perPage = SUMMARY_PER_PAGE,
): SummariesCursor | null {
  if (returnedCount >= perPage) return { page: currentPage + 1 };
  return null;
}

/** Coerce an arbitrary request body cursor into a 1-based summaries page. PURE. */
export function summariesPageFromCursor(cursor: unknown): number {
  if (cursor && typeof cursor === 'object' && 'page' in cursor) {
    const p = (cursor as { page?: unknown }).page;
    if (typeof p === 'number' && Number.isFinite(p) && p >= 1) return Math.floor(p);
  }
  return 1;
}

/** Coerce an arbitrary request body cursor into a >=0 enrich offset. PURE. */
export function enrichOffsetFromCursor(cursor: unknown): number {
  if (cursor && typeof cursor === 'object' && 'offset' in cursor) {
    const o = (cursor as { offset?: unknown }).offset;
    if (typeof o === 'number' && Number.isFinite(o) && o >= 0) return Math.floor(o);
  }
  return 0;
}

/** Strava sends floats (e.g. average_heartrate: 151.5); integer columns need rounding. */
function intOrNull(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v);
}
