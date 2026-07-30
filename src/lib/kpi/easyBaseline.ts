/**
 * easyBaseline.ts — Trailing easy-pace baseline derivation.
 *
 * Pure. No IO. Server-importable.
 *
 * Derives a trailing easy-pace baseline (sec/mi) from the user's easy-typed
 * activities. An activity is "easy" when its civil date has an easy-typed
 * planned workout (type === 'easy') and no quality workout on the same day.
 *
 * Falls back to 8:15/mi (495 s/mi) when fewer than 3 easy runs are available.
 */

import {
  METERS_PER_MILE,
} from '../units';

/** Fallback easy baseline when fewer than 3 easy runs exist (8:15/mi). */
export const FALLBACK_EASY_BASELINE_SEC_PER_MI = 495;

export interface BaselineActivity {
  local_date: string | null;
  distance_meters: number | null;
  moving_time_s: number | null;
}

export interface BaselineWorkout {
  date: string | null;
  is_quality: boolean;
  type: string | null;
}

/** Median of a number array (returns 0 for empty). */
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Derive a trailing easy-pace baseline (sec/mi) from the user's easy-typed
 * activities. An activity is "easy" when its civil date has an easy-typed
 * planned workout (type === 'easy') and no quality workout on the same day.
 *
 * Falls back to 8:15/mi (495 s/mi) when fewer than 3 easy runs are available.
 *
 * @param activities All activity rows (plan-span window is enough).
 * @param workouts   Plan workout rows (need .date and .type).
 */
export function computeEasyBaselineSecPerMi(
  activities: readonly BaselineActivity[],
  workouts: readonly BaselineWorkout[],
): number {
  // Build per-date intent from the plan: quality wins over easy.
  const intentByDate = new Map<string, 'easy' | 'quality'>();
  for (const w of workouts) {
    if (!w.date) continue;
    if (w.is_quality) {
      intentByDate.set(w.date, 'quality');
    } else if (w.type === 'easy' && !intentByDate.has(w.date)) {
      intentByDate.set(w.date, 'easy');
    }
  }

  const paces: number[] = activities
    .filter((a) => {
      if (!a.local_date || intentByDate.get(a.local_date) !== 'easy') return false;
      if (!a.distance_meters || !a.moving_time_s) return false;
      if (a.distance_meters < 1000) return false; // skip sub-km fragments
      return true;
    })
    .map((a) => {
      const miles = (a.distance_meters as number) / METERS_PER_MILE;
      return (a.moving_time_s as number) / miles; // sec/mi
    });

  if (paces.length < 3) return FALLBACK_EASY_BASELINE_SEC_PER_MI;
  return median(paces);
}
