/**
 * lapsRegime.ts — reconcile marked LAP work-reps with the stream REGIME blocks.
 *
 * Pure. No IO. Node-tested.
 *
 * The athlete's lap button and the pace/HR stream disagree about rep GRANULARITY.
 * On a 4×2mi threshold session the athlete often presses lap for his own mile
 * splits — INSIDE each 2-mile rep — so the laps read as 8 mile-reps while regime
 * detection on the stream sees the 4 true 2-mile blocks. Neither is strictly
 * better: laps are ground truth for a short rep regime never sustains long enough
 * to see (a marked 200m), while regime groups over-lapped reps into their real
 * shape. So we RECONCILE rather than pick a winner:
 *
 *   1. Each regime block defines ONE rep. The lap work-reps whose sample ranges
 *      overlap that block COLLAPSE into it — the rep takes the block's
 *      stream-accurate distance + pace, and avgHr = the mean of the overlapping
 *      laps' HR (when present). Jun 23's 4 blocks each absorb their 2 mile-laps
 *      → 4×2mi instead of 8×1mi.
 *   2. Lap reps overlapping NO regime block are KEPT verbatim — a short rep the
 *      athlete lapped but regime's minimum-duration gate missed. This is NOT
 *      "regime always wins": laps still contribute the reps regime can't see.
 *   3. Result = {one rep per regime block} ∪ {lap reps outside every block},
 *      sorted by startIdx.
 *
 * No regime blocks → the lap reps pass through unchanged (laps fully win). One
 * lap per block (already at rep boundaries) → the reps come out identical.
 */
import type { LapRep } from './lapIntervals';
import type { HardBlock } from './qualityDetect';
import {
  METERS_PER_MILE,
} from '../units';

/** Two inclusive [start,end] index ranges overlap iff aS ≤ bE AND bS ≤ aE. */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Fraction of lap range a that overlaps regime range b (inclusive indices). */
function overlapFraction(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const span = Math.max(1, aEnd - aStart + 1);
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1);
  return overlap / span;
}

/**
 * Reconcile marked lap work-reps against detected regime blocks into a single
 * unified rep list. See the module header for the rules. PURE.
 *
 * @param lapReps      Work reps from `repsFromLaps` (each with mapped startIdx/endIdx).
 * @param regimeBlocks Hard blocks from `detectQuality(...).blocks` (same index space).
 * @returns            One rep per regime block (laps collapsed in) plus any lap
 *                     reps that overlapped no block, sorted by startIdx.
 */
export function reconcileLapsWithRegime(
  lapReps: LapRep[],
  regimeBlocks: readonly HardBlock[],
): LapRep[] {
  // No stream structure to group by → the laps are the reps, untouched.
  if (regimeBlocks.length === 0) return [...lapReps];

  const consumed = new Array(lapReps.length).fill(false);

  // Each regime block becomes exactly one rep. Any overlapping lap is consumed
  // so a recovery whose edge barely touches the smoothed regime does not leak out
  // as a fake extra rep. Metrics, however, come only from laps whose MAJORITY is
  // inside the block: watch laps are the runner-declared measurement, while the
  // regime is a grouping/highlight signal whose smoothed edges routinely trim
  // ~0.05mi from a real rep. This is what lets two exact mile laps render as one
  // exact 2mi rep instead of the regime's 1.94mi pace region.
  const collapsed: LapRep[] = regimeBlocks.map((block) => {
    const contributors: LapRep[] = [];
    for (let i = 0; i < lapReps.length; i++) {
      const r = lapReps[i]!;
      // An unmapped lap (idx -1) can't be placed against a block — leave it for
      // the kept set rather than mis-collapse it.
      if (r.startIdx < 0 || r.endIdx < 0) continue;
      if (rangesOverlap(r.startIdx, r.endIdx, block.startIdx, block.endIdx)) {
        consumed[i] = true;
        if (overlapFraction(r.startIdx, r.endIdx, block.startIdx, block.endIdx) >= 0.5) {
          contributors.push(r);
        }
      }
    }
    if (contributors.length === 0) {
      return {
        distanceMeters: block.distanceMeters,
        paceSecPerMi: block.paceSecPerMi,
        avgHr: null,
        startIdx: block.startIdx,
        endIdx: block.endIdx,
      };
    }

    const distanceMeters = contributors.reduce((sum, r) => sum + r.distanceMeters, 0);
    const durationS = contributors.reduce(
      (sum, r) => sum + (r.distanceMeters / METERS_PER_MILE) * r.paceSecPerMi,
      0,
    );
    const hrContributors = contributors.filter((r) => r.avgHr != null);
    const hrSeconds = hrContributors.reduce(
      (sum, r) => sum + r.avgHr! * (r.distanceMeters / METERS_PER_MILE) * r.paceSecPerMi,
      0,
    );
    const hrDurationS = hrContributors.reduce(
      (sum, r) => sum + (r.distanceMeters / METERS_PER_MILE) * r.paceSecPerMi,
      0,
    );
    return {
      distanceMeters,
      paceSecPerMi: durationS / (distanceMeters / METERS_PER_MILE),
      avgHr: hrDurationS > 0 ? Math.round(hrSeconds / hrDurationS) : null,
      startIdx: block.startIdx,
      endIdx: block.endIdx,
    };
  });

  // Lap reps that overlapped no block survive as-is (regime missed a short rep).
  const kept = lapReps.filter((_, i) => !consumed[i]);

  return [...collapsed, ...kept].sort((a, b) => a.startIdx - b.startIdx);
}
