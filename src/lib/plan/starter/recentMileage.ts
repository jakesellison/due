/**
 * recentMileage.ts — pure aggregation behind the `useRecentWeeklyMiles` hook.
 *
 * Turns a runner's recent activity rows into an average weekly mileage over a
 * trailing 28-day window, so the starter picker can suggest a mileage tier.
 *
 * Pure. No IO. Node-tested. The hook (`src/app-lib/queries/recentMileage.ts`)
 * just wires supabase + react-query around this.
 */

import {
  METERS_PER_MILE,
} from '../../units';

export interface ActivityMileageRow {
  /** YYYY-MM-DD (local date the activity is credited to). */
  local_date: string | null;
  distance_meters: number | null;
}

const WINDOW_DAYS = 28;

/** Parse a YYYY-MM-DD string to a UTC-midnight epoch (day granularity). */
function dayEpoch(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Average weekly mileage over the 28 days ending `todayIso` (inclusive), from
 * activity rows. Rows outside the window (or with unparseable/zero distance) are
 * ignored. Returns:
 *   - `null` when NO qualifying activity falls in the window (nothing to base a
 *     suggestion on — distinct from a real 0.0);
 *   - otherwise total meters ÷ 4 weeks ÷ meters-per-mile, rounded to one decimal.
 */
export function weeklyMilesFromRows(
  rows: ReadonlyArray<ActivityMileageRow>,
  todayIso: string,
): number | null {
  const today = dayEpoch(todayIso);
  if (today == null) return null;
  const cutoff = today - WINDOW_DAYS * 86_400_000; // gte cutoff (inclusive)

  let totalMeters = 0;
  let counted = 0;
  for (const row of rows) {
    if (!row.local_date) continue;
    const day = dayEpoch(row.local_date);
    if (day == null || day < cutoff || day > today) continue;
    const meters = row.distance_meters;
    if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) continue;
    totalMeters += meters;
    counted += 1;
  }
  if (counted === 0) return null;

  const weeklyMiles = totalMeters / 4 / METERS_PER_MILE;
  return Math.round(weeklyMiles * 10) / 10;
}

/** ISO date `days` before `todayIso` (YYYY-MM-DD), for the SQL `gte` bound. */
export function isoDaysAgo(todayIso: string, days: number): string {
  const today = dayEpoch(todayIso) ?? Date.now();
  return new Date(today - days * 86_400_000).toISOString().slice(0, 10);
}

/** The trailing window (days) the suggestion is computed over. */
export const RECENT_WINDOW_DAYS = WINDOW_DAYS;
