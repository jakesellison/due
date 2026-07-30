/**
 * Align observed interval blocks to a prescribed rep sequence.
 *
 * A plan match is a sequence problem, not merely a total-distance comparison:
 * five nearly-two-mile reps plus a 0.3mi cooldown pickup must resolve to the
 * prescribed 5x2mi core, not a fabricated sixth rep whose distance happens to
 * make the total land near ten miles. Conversely, a genuine sixth two-mile rep
 * should survive as extra work rather than disappearing.
 *
 * Pure. No IO. The dynamic program preserves observed order, selects exactly
 * one observed block per planned rep, and allows unrelated observations to be
 * skipped. Skipped blocks only become `extras` when both their distance and pace
 * look like another rep; incidental fragments are returned as `ignored`.
 */
import type { HardBlock } from './qualityDetect';

const MIN_PAIR_FIT = 0.5;
const EXTRA_MIN_FIT = 0.6;
const EXTRA_MAX_PACE_RATIO = 1.15;

export interface PlanIntervalAlignment {
  reps: HardBlock[];
  extras: HardBlock[];
  ignored: HardBlock[];
  /** 0..1, combining per-rep shape and total prescribed-work distance. */
  confidence: number;
}

function ratioFit(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Match observed blocks to planned distances in order. Returns null when there
 * are fewer observations than prescribed reps or no complete plausible path.
 */
export function alignIntervalsToPlan(
  observed: readonly HardBlock[],
  plannedDistancesMeters: readonly number[],
): PlanIntervalAlignment | null {
  const m = observed.length;
  const n = plannedDistancesMeters.length;
  if (n === 0 || m < n || plannedDistancesMeters.some((d) => !(d > 0))) return null;

  const neg = -1e9;
  const score = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(neg));
  const prev = Array.from({ length: m + 1 }, () => new Array<{ i: number; j: number; took: boolean } | null>(n + 1).fill(null));
  score[0]![0] = 0;

  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= n; j++) {
      const cur = score[i]![j]!;
      if (cur <= neg) continue;

      // Skip an observation. It may later become meaningful extra work, but it
      // must not improve the plan-match score merely by existing.
      if (cur > score[i + 1]![j]!) {
        score[i + 1]![j] = cur;
        prev[i + 1]![j] = { i, j, took: false };
      }

      if (j < n) {
        const fit = ratioFit(observed[i]!.distanceMeters, plannedDistancesMeters[j]!);
        if (fit >= MIN_PAIR_FIT && cur + fit > score[i + 1]![j + 1]!) {
          score[i + 1]![j + 1] = cur + fit;
          prev[i + 1]![j + 1] = { i, j, took: true };
        }
      }
    }
  }

  if (score[m]![n]! <= neg) return null;

  const selected = new Set<number>();
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const p = prev[i]![j];
    if (!p) return null;
    if (p.took) selected.add(p.i);
    i = p.i;
    j = p.j;
  }

  const reps = observed.filter((_, index) => selected.has(index));
  if (reps.length !== n) return null;

  const selectedPace = median(reps.map((r) => r.paceSecPerMi));
  const extras: HardBlock[] = [];
  const ignored: HardBlock[] = [];
  observed.forEach((block, index) => {
    if (selected.has(index)) return;
    const bestDistanceFit = Math.max(...plannedDistancesMeters.map((target) => ratioFit(block.distanceMeters, target)));
    const paceLooksLikeWork = block.paceSecPerMi <= selectedPace * EXTRA_MAX_PACE_RATIO;
    (bestDistanceFit >= EXTRA_MIN_FIT && paceLooksLikeWork ? extras : ignored).push(block);
  });

  const repFit = reps.reduce(
    (sum, rep, index) => sum + ratioFit(rep.distanceMeters, plannedDistancesMeters[index]!),
    0,
  ) / n;
  const observedMeters = reps.reduce((sum, rep) => sum + rep.distanceMeters, 0);
  const plannedMeters = plannedDistancesMeters.reduce((sum, dist) => sum + dist, 0);
  const totalFit = ratioFit(observedMeters, plannedMeters);
  const confidence = 0.7 * repFit + 0.3 * totalFit;

  return { reps, extras, ignored, confidence };
}
