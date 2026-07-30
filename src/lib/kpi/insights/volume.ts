/**
 * Mileage volume derivations: weekly bucketing, the Trends range-switcher window
 * math, rolling 4-week mileage, and dense daily mileage with rolling means.
 */

import {
  weekStartOf,
} from '../../time/week';
import type { DistanceRun, IdentifiedDistanceRun, WeekVolume } from './inputs';

/**
 * Collapse runs to one entry PER ACTIVITY ID, keeping the first occurrence.
 * Defensive belt-and-suspenders: if the same activity reaches a bucketing layer
 * twice (overlapping query windows, a concatenated array, a re-fetch race), it
 * is counted exactly once. Order is preserved.
 */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (r.id == null || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Window / range math (Trends range switcher)
// ---------------------------------------------------------------------------

/** The selectable trend window: 4 weeks, 12 weeks, or everything. */
export type RangeKey = '4w' | '12w' | 'all';

/** Trailing-day span for a range key. `all` → null (no lower bound). */
function rangeDays(range: RangeKey): number | null {
  if (range === '4w') return 28;
  if (range === '12w') return 84;
  return null;
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (tz-agnostic, noon-UTC). */
export function shiftDate(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Inclusive civil-date window [from, to] for a range ending at `today`. `4w` is
 * the trailing 28 days (incl. today), `12w` the trailing 84, `all` returns a
 * `from` far enough back to include everything (`null` lower bound semantics —
 * callers may pass a sentinel epoch date).
 */
export function rangeWindow(today: string, range: RangeKey): { from: string; to: string } {
  const days = rangeDays(range);
  if (days == null) return { from: '1970-01-01', to: today };
  // 28d window = today and the 27 days before it.
  return { from: shiftDate(today, -(days - 1)), to: today };
}

// ---------------------------------------------------------------------------
// Rolling 4-week mileage
// ---------------------------------------------------------------------------

export interface RollingMileagePoint {
  weekStart: string;
  meters: number;
  /** Trailing 4-week mean ending at this week; null until 4 weeks are available. */
  rolling4: number | null;
}


// ---------------------------------------------------------------------------
// Daily mileage buckets + rolling means (4W range)
// ---------------------------------------------------------------------------

/** One civil day's summed run meters (zero on rest days, kept as a gap). */
export interface DailyMileagePoint {
  /** Civil 'YYYY-MM-DD'. */
  date: string;
  /** Summed run meters for the day (0 on a rest day). */
  meters: number;
  /** Trailing 7-day mean (meters); null until `minPoints` real days behind it. */
  rolling: number | null;
}

