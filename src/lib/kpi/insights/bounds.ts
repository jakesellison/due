/**
 * Shared chart SCALE helpers — the single source of truth for "nice" numeric
 * axes across every chart (Block mileage, race prediction, the insights/Trends
 * charts). One `niceStep` (1/2/5 × 10^k) feeds both the domain (`niceBounds`)
 * and the gridline ticks (`niceTicks`), so no chart improvises its own axis math
 * (which is what produced uneven, sparse y-labels). Exported via the barrel.
 */

// ---------------------------------------------------------------------------
// Nice y-bounds from a data extent (shared, ≤15% headroom)
// ---------------------------------------------------------------------------

/** A consistent numeric axis: bounds, the step that made them, and the ticks. */
export interface NiceScale {
  min: number;
  max: number;
  /** The nice step (1/2/5 × 10^k) — `min`/`max`/`ticks` are all multiples of it. */
  step: number;
  /** Every nice mark in [min, max] inclusive (multiples of `step`). */
  ticks: number[];
}

/**
 * A friendly numeric axis from a data extent — the ONE entry point charts should
 * use, so the bounds and the gridline ticks share a single step (a chart that
 * snaps its max with one step and its ticks with another ends up with 2 lonely
 * labels). Pads by `headroom` (≤15%), snaps each edge to a nice step, and emits
 * the evenly-spaced ticks. `anchorZero` pins the lower bound to 0 (volume bars).
 */
export function niceScale(
  lo: number,
  hi: number,
  opts: { anchorZero?: boolean; headroom?: number; target?: number } = {},
): NiceScale {
  const anchorZero = opts.anchorZero ?? false;
  const headroom = Math.min(0.15, Math.max(0, opts.headroom ?? 0.12));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (hi < lo) [lo, hi] = [hi, lo];
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  const pad = span * headroom;
  const rawMax = hi + pad;
  const rawMin = anchorZero ? 0 : lo - pad;
  const step = niceStep(rawMax - rawMin, opts.target ?? 4);
  const min = anchorZero ? 0 : Math.floor(rawMin / step) * step;
  const max = Math.max(Math.ceil(rawMax / step) * step, min + step);
  const eps = step * 1e-6;
  const ticks: number[] = [];
  for (let v = min; v <= max + eps; v += step) {
    const r = Math.round(v / step) * step;
    ticks.push(Object.is(r, -0) ? 0 : r);
  }
  return { min, max, step, ticks };
}

/**
 * Tight [min, max] bounds from a data extent (thin wrapper over `niceScale` for
 * callers that only need the domain). `anchorZero` pins the lower bound to 0.
 */
export function niceBounds(
  lo: number,
  hi: number,
  opts: { anchorZero?: boolean; headroom?: number } = {},
): [number, number] {
  const { min, max } = niceScale(lo, hi, opts);
  return [min, max];
}

/**
 * A "nice" rounding step (1/2/5 × 10^k) for a value span, targeting ~`target`
 * intervals. The thresholds sit at the TRUE geometric midpoints (√2, √10, √50)
 * of the 1/2/5/10 ladder, so a span lands on the step that yields a tick count
 * close to `target` — not the coarse jump (e.g. 20→50) the old cutoffs produced.
 */
export function niceStep(span: number, target = 4): number {
  if (!(span > 0)) return 1;
  const rough = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag; // in [1, 10)
  let mult: number;
  if (norm < Math.SQRT2) mult = 1; // √2 ≈ 1.414
  else if (norm < Math.sqrt(10)) mult = 2; // √10 ≈ 3.162
  else if (norm < Math.sqrt(50)) mult = 5; // √50 ≈ 7.071
  else mult = 10;
  return mult * mag;
}

/**
 * Evenly-spaced "nice" tick values inside [min, max] — multiples of `niceStep`,
 * for a FIXED domain you didn't derive from `niceScale` (which already returns
 * its own consistent ticks; prefer that). `interior` drops the endpoints.
 */
export function niceTicks(
  min: number,
  max: number,
  opts: { target?: number; interior?: boolean } = {},
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return [];
  const step = niceStep(max - min, opts.target ?? 4);
  const eps = step * 1e-6;
  const ticks: number[] = [];
  for (let v = Math.ceil((min - eps) / step) * step; v <= max + eps; v += step) {
    const raw = Math.round(v / step) * step; // de-fuzz float accumulation
    const r = Object.is(raw, -0) ? 0 : raw;
    if (opts.interior && (r <= min + eps || r >= max - eps)) continue;
    ticks.push(r);
  }
  return ticks;
}
