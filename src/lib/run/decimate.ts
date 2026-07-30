/**
 * decimate.ts — min-max bucket decimation for chart RENDER only.
 *
 * Pure. No IO. Node-tested.
 *
 * A full-res stream keeps every sample (~7,500 on a 16 mi run). Rendering one SVG
 * point per sample per lane is wasteful — the eye can't resolve it and the path
 * data is huge. This reduces a series to ~`target` points while PRESERVING every
 * local spike: each bucket contributes its MIN and its MAX sample, so a stride
 * peak or a pace dip survives as its bucket's extreme (uniform-stride and LTTB
 * both silently drop these). Points stay in index/time order and keep their x.
 *
 * Use ONLY in chart view-models. Analysis/splits/detection read full resolution.
 */

export interface DecimatedLane {
  /** X values (e.g. elapsed seconds) of the kept points, ascending by index. */
  xs: number[];
  /** Y values of the kept points (nulls preserved for gaps/stops). */
  ys: (number | null)[];
}

/** Default render budget per lane — dense enough to read, cheap to draw. */
export const DEFAULT_DECIMATE_TARGET = 600;

/**
 * Min-max bucket decimate an (xs, ys) lane to at most ~`target` points.
 *
 * - Passthrough: when `n <= target` the inputs are returned as-is (copied).
 * - Buckets: the index range is split into `ceil(target / 2)` even buckets; each
 *   emits the indices of its min and max non-null y (deduped, in index order).
 * - First + last points are always kept, so the line spans the full x-range.
 * - A bucket of only-null y contributes its first index (null) to keep spacing.
 *
 * The output length is bounded by `target` (≤2 per bucket + the pinned first and
 * last points), and never exceeds the input length.
 */
/**
 * Mean-bucket decimate an (xs, ys) lane to at most ~`target` points.
 *
 * Each bucket emits ONE point: the mean of its non-null ys at the mean of their
 * xs. Averaging is anti-aliasing — nothing is silently dropped, but bucket-scale
 * jitter cancels instead of rendering as a min/max comb. Use for lanes where
 * readability beats extremum fidelity (the long-run pace trace); keep
 * `decimateMinMax` where a single-sample spike must survive (interval reps).
 *
 * All-null buckets emit one null point (gap preserved). First/last samples are
 * pinned so the line spans the full x-range.
 */
export function decimateMean(
  xs: number[],
  ys: (number | null)[],
  target: number = DEFAULT_DECIMATE_TARGET,
): DecimatedLane {
  const n = Math.min(xs.length, ys.length);
  if (n <= target || n <= 2 || target < 2) {
    return { xs: xs.slice(0, n), ys: ys.slice(0, n) };
  }

  const buckets = Math.max(1, target - 2);
  const outXs: number[] = [xs[0]!];
  const outYs: (number | null)[] = [ys[0] ?? null];

  for (let b = 0; b < buckets; b++) {
    const lo = 1 + Math.floor((b * (n - 2)) / buckets);
    const hi = 1 + Math.floor(((b + 1) * (n - 2)) / buckets); // exclusive
    if (lo >= hi) continue;

    let sumX = 0, sumY = 0, c = 0;
    for (let i = lo; i < hi; i++) {
      const y = ys[i];
      if (y == null) continue;
      sumX += xs[i]!; sumY += y; c++;
    }
    if (c > 0) {
      outXs.push(sumX / c);
      outYs.push(sumY / c);
    } else {
      // All-null bucket: keep one null so the gap survives segmentation.
      outXs.push(xs[lo]!);
      outYs.push(null);
    }
  }

  outXs.push(xs[n - 1]!);
  outYs.push(ys[n - 1] ?? null);
  return { xs: outXs, ys: outYs };
}

export function decimateMinMax(
  xs: number[],
  ys: (number | null)[],
  target: number = DEFAULT_DECIMATE_TARGET,
): DecimatedLane {
  const n = Math.min(xs.length, ys.length);
  if (n <= target || n <= 2 || target < 2) {
    return { xs: xs.slice(0, n), ys: ys.slice(0, n) };
  }

  // Reserve 2 slots for the pinned first + last points so the total stays ≤
  // target even in the worst case (min ≠ max in every bucket = 2 points each).
  const buckets = Math.max(1, Math.floor((target - 2) / 2));
  const keep: number[] = [];
  let lastKept = -1;
  const push = (idx: number) => {
    if (idx !== lastKept) {
      keep.push(idx);
      lastKept = idx;
    }
  };

  // Always start at the first sample.
  push(0);

  for (let b = 0; b < buckets; b++) {
    // Even split across the interior range [1, n-1) so first/last are pinned.
    const lo = 1 + Math.floor((b * (n - 2)) / buckets);
    const hi = 1 + Math.floor(((b + 1) * (n - 2)) / buckets); // exclusive
    if (lo >= hi) continue;

    let minIdx = -1;
    let maxIdx = -1;
    let minVal = Infinity;
    let maxVal = -Infinity;
    let firstNonNull = -1;
    for (let i = lo; i < hi; i++) {
      const y = ys[i];
      if (y == null) continue;
      if (firstNonNull < 0) firstNonNull = i;
      if (y < minVal) { minVal = y; minIdx = i; }
      if (y > maxVal) { maxVal = y; maxIdx = i; }
    }

    if (minIdx < 0) {
      // All-null bucket: keep its first index to preserve the gap's spacing.
      push(lo);
      continue;
    }

    // Emit min + max in ascending index order (so the polyline stays monotonic
    // in x). When they coincide, a single point is pushed.
    const a = Math.min(minIdx, maxIdx);
    const c = Math.max(minIdx, maxIdx);
    push(a);
    if (c !== a) push(c);
  }

  // Always end at the last sample.
  push(n - 1);

  return {
    xs: keep.map((i) => xs[i]!),
    ys: keep.map((i) => ys[i] ?? null),
  };
}
