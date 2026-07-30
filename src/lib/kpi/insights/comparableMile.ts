/**
 * Comparable early-mile sampling (apples-to-apples across run lengths).
 *
 * Both the per-run easy-HR cloud and the aerobic-efficiency progression sample a
 * single comparable mile from each run's stored streams so runs of different
 * lengths can be compared on equal footing (mile 2 skips warmup noise).
 */

import {
  earlyMileFromSplits,
  mileSplits,
  type EarlyMileStats,
  type RunStreams,
} from '../../run/analysis';

/** A mile qualifies for the comparison only when ≥ this share of runs has it. */
export const COMPARABLE_MILE_COVERAGE = 0.8;

/** Per-run early-mile stats keyed by mile index (1-based), or null (no streams). */
export type EarlyMiles = { m1: EarlyMileStats | null; m2: EarlyMileStats | null } | null;

/**
 * Compute the early-mile stats a trend needs from a run's stored streams —
 * ONE split walk per run, reused for both candidate miles (the walk is the
 * expensive part; both trends call this for every easy run in the window).
 */
export function earlyMiles(streams: RunStreams | null | undefined): EarlyMiles {
  if (!streams || !streams.d || streams.d.length < 2) return null;
  const splits = mileSplits(streams);
  return { m1: earlyMileFromSplits(splits, 1), m2: earlyMileFromSplits(splits, 2) };
}

/**
 * Pick the COMPARABLE mile for a cohort of easy runs: mile 2 when at least
 * `COMPARABLE_MILE_COVERAGE` of the cohort has a valid mile-2 sample WITH HR
 * (mile 2 skips warmup noise), else mile 1 by the same rule, else null —
 * callers then fall back to whole-run averages (manual entries, no streams).
 */
export function pickComparableMile(miles: EarlyMiles[]): 1 | 2 | null {
  const n = miles.length;
  if (n === 0) return null;
  const covered = (pick: (m: EarlyMiles) => EarlyMileStats | null) =>
    miles.filter((m) => {
      const st = m && pick(m);
      return st != null && st.avgHr != null;
    }).length / n;
  if (covered((m) => m && m.m2) >= COMPARABLE_MILE_COVERAGE) return 2;
  if (covered((m) => m && m.m1) >= COMPARABLE_MILE_COVERAGE) return 1;
  return null;
}
