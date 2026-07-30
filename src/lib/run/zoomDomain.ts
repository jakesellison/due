/**
 * zoomDomain.ts — pinch/pan/reset math for the interval chart's X-axis (miles)
 * zoom window.
 *
 * Pure. No IO. Node-tested. Kept separate from SessionView's IntervalChart so
 * the focal-point/clamp arithmetic (easy to get subtly wrong — off-by-a-sign
 * pinch, drift past the full domain) can be verified without mounting RN.
 */

/** A visible X-axis window, in the chart's own units (miles). */
export interface Domain {
  lo: number;
  hi: number;
}

/** Below this visible span (seconds of running time, translated to miles via
 *  the run's average pace) further pinch-in is clamped — a shorter window
 *  reads as noise, not detail. */
const MIN_ZOOM_SPAN_SEC = 30;

/** The full (unzoomed) domain for a run of `totalMi` miles. */
export function fullDomain(totalMi: number): Domain {
  return { lo: 0, hi: Math.max(totalMi, 1e-6) };
}

/** Minimum visible span (miles) equivalent to ~30s of running time at
 *  `avgPaceSecPerMi` (seconds/mile). Falls back to a small fixed span if the
 *  pace is missing/non-finite (e.g. no reps yet) rather than blowing up. */
export function minZoomSpanMi(avgPaceSecPerMi: number): number {
  if (!Number.isFinite(avgPaceSecPerMi) || avgPaceSecPerMi <= 0) return 0.05;
  return MIN_ZOOM_SPAN_SEC / avgPaceSecPerMi;
}

function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Clamp a candidate domain so it always sits fully inside `full`, with a span
 * between `minSpanMi` and the full domain's width.
 *
 * When only the span is out of range, it's clamped in place (centered on the
 * candidate's own center isn't attempted — callers pass a domain whose lo/hi
 * already encode the intended center via pinch/pan math). When an edge would
 * fall outside `full`, the window is slid back inside (not re-centered) so a
 * pan/pinch that hits an edge just stops there, span preserved.
 */
export function clampDomain(candidate: Domain, full: Domain, minSpanMi: number): Domain {
  const fullSpan = Math.max(full.hi - full.lo, 1e-6);
  const minSpan = Math.min(Math.max(minSpanMi, 1e-6), fullSpan);
  const span = clampNum(candidate.hi - candidate.lo, minSpan, fullSpan);
  let lo = candidate.lo;
  let hi = lo + span;
  if (lo < full.lo) {
    lo = full.lo;
    hi = lo + span;
  }
  if (hi > full.hi) {
    hi = full.hi;
    lo = hi - span;
  }
  return { lo, hi };
}

/**
 * Pinch-zoom: scale `base` around `focalMi` (a point in the domain's own
 * units — e.g. the mile under the gesture's focal point at pinch-start),
 * keeping that point's position fixed while the window shrinks/grows.
 *
 * `scale` is the gesture's CUMULATIVE scale since the pinch began (as RNGH's
 * Pinch gesture reports it) — callers should always zoom from a `base` domain
 * captured at gesture start, not the latest render's domain, so repeated
 * onUpdate calls don't compound floating-point drift.
 */
export function pinchZoomDomain(base: Domain, focalMi: number, scale: number, full: Domain, minSpanMi: number): Domain {
  if (!Number.isFinite(scale) || scale <= 0) return clampDomain(base, full, minSpanMi);
  const lo = focalMi - (focalMi - base.lo) / scale;
  const hi = focalMi + (base.hi - focalMi) / scale;
  return clampDomain({ lo, hi }, full, minSpanMi);
}

/**
 * Pan: shift `base` by `deltaMi` (positive = window moves later/forward).
 * Callers should pass a `base` captured at pan-gesture-start plus the
 * gesture's CUMULATIVE translation converted to miles, for the same
 * no-compounding reason as `pinchZoomDomain`.
 */
export function panDomainBy(base: Domain, deltaMi: number, full: Domain, minSpanMi: number): Domain {
  return clampDomain({ lo: base.lo + deltaMi, hi: base.hi + deltaMi }, full, minSpanMi);
}

/** Reset to the full domain (double-tap). Returns a fresh object (never the
 *  same reference as `full`) so callers can't accidentally mutate it. */
export function resetDomain(full: Domain): Domain {
  return { lo: full.lo, hi: full.hi };
}

/** True when `domain` differs from `full` (drives e.g. a "reset zoom" affordance). */
export function isZoomed(domain: Domain, full: Domain, eps = 1e-6): boolean {
  return Math.abs(domain.lo - full.lo) > eps || Math.abs(domain.hi - full.hi) > eps;
}
