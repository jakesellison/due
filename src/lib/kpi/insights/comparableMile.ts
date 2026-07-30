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

