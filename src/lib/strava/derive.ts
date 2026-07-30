/**
 * Pure, durable derived values computed at ingest from raw Strava Data, so they
 * survive the ≤7-day raw-data purge (Strava API Policy §6.2/§5.5 — see
 * `docs/superpowers/specs/2026-07-17-strava-7day-compliance-design.md`).
 *
 * Both functions here WRAP existing single-source-of-truth implementations
 * rather than reimplementing them:
 *  - `simplifyRouteForStore` wraps the Douglas–Peucker `simplifyPath` already
 *    used by the Routes "recently used" GPS matcher (`src/app-lib/routes.ts`).
 *  - `hrLoad` wraps the Banister TRIMP formula (`trimp`, in
 *    `../kpi/insights/trainingLoad`) already used by Trends training-load.
 *
 * Pure. No IO, no Supabase/Strava calls. Node-tested.
 */
import {
  simplifyPath,
  type LatLng,
} from '../routes/geo';
import {
  trimp,
} from '../kpi/insights/trainingLoad';

/**
 * A durable, coarse trace of a GPS route for the Routes "recently used"
 * matcher — computed once at ingest so it survives the raw-route purge.
 * Returns null for a null/undefined/empty route; otherwise the route
 * simplified (Douglas–Peucker, falling back to stride sampling) and capped at
 * `maxPoints` points, always preserving the first and last points.
 */
export function simplifyRouteForStore(
  route: [number, number][] | null | undefined,
  maxPoints = 50,
): [number, number][] | null {
  if (!route || route.length === 0) return null;
  return simplifyPath(route as LatLng[], maxPoints);
}

/** Inputs for a durable HR training-load (TRIMP) score. */
export interface HrLoadInput {
  movingTimeS: number;
  avgHr: number | null | undefined;
  maxHr?: number | null;
  /** Override the resting-HR baseline (forwarded to `trimp`'s `restHr`). */
  restHr?: number;
  /** Override the default max-HR cap (forwarded to `trimp`'s `hrMaxDefault`). */
  hrMax?: number;
}

/**
 * A derived TRIMP training-load number for one activity, computed at ingest so
 * training-load survives even if `avg_hr`/`max_hr` are later purged as raw
 * Strava Data. Delegates to the shared `trimp` formula, but returns null when
 * `avgHr` is null/undefined — `trimp` itself falls back to a duration-only
 * easy-effort estimate when HR is missing; `hrLoad` instead reads a
 * missing/not-yet-purged HR as "unknown" rather than silently guessing.
 */
export function hrLoad(input: HrLoadInput): number | null {
  if (input.avgHr == null) return null;
  return trimp({
    movingTimeS: input.movingTimeS,
    avgHr: input.avgHr,
    maxHr: input.maxHr ?? null,
    restHr: input.restHr,
    hrMaxDefault: input.hrMax,
  });
}

/** Row shape `shouldPurgeRaw` needs — a subset of `activities` columns. */
export interface PurgeableRow {
  source: string;
  startDate: string | Date;
  enrichedAt: string | Date | null | undefined;
  hasRaw: boolean;
}

/**
 * Single source of truth for the raw-purge rule (Strava API Policy §6.2/§5.5
 * ≤7-day cache): the purge endpoint's SQL WHERE clause
 * (`api/strava/purge-raw.ts`) mirrors this exactly, and this predicate is
 * what the tests assert against.
 *
 * Default window is 6 days, deliberately one day inside the §6.2 7-day limit:
 * the purge runs on a DAILY cron, so a 7-day cutoff could leave a row cached
 * for up to ~8 days (7d + the wait until the next run). A 6-day cutoff keeps
 * the worst case at ~7 days.
 *
 * True iff ALL: `source === 'strava'`, `enrichedAt` is present (never purge
 * before the durable summary is computed), `hasRaw` is true (idempotent —
 * already-purged rows don't re-match), and `startDate` is strictly older
 * than `now - days`.
 *
 * Boundary: strictly older than, not "at least" — a row exactly `days` old
 * (to the millisecond) is NOT yet purgeable; it must age past the boundary.
 * This matches the SQL's `start_date < now() - interval '6 days'`.
 *
 * Pure/defensive: invalid or unparseable dates are treated as not-purgeable
 * (returns false) rather than throwing.
 */
export function shouldPurgeRaw(row: PurgeableRow, now: Date, days = 6): boolean {
  if (row.source !== 'strava') return false;
  if (row.enrichedAt == null) return false;
  if (!row.hasRaw) return false;

  const start = row.startDate instanceof Date ? row.startDate : new Date(row.startDate);
  if (Number.isNaN(start.getTime())) return false;
  if (Number.isNaN(now.getTime())) return false;

  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return start.getTime() < cutoff;
}
