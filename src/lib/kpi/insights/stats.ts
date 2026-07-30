/**
 * Pure linear-algebra and statistics helpers shared across the insight
 * derivations. Placed in their own module so the trend modules can share them
 * without importing one another (avoids circular imports).
 */

import type { HrTempFit } from './heat';

// ---------------------------------------------------------------------------
// Linear-algebra helpers (pure)
// ---------------------------------------------------------------------------

/** Median of a non-empty numeric array (copy-sorted, mean of the middle pair). */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}


/** Arithmetic mean of a non-empty array. */
export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Two-predictor ordinary least-squares: fit y ~ intercept + b1·x1 + b2·x2 via
 * the centered normal equations (a 2×2 solve, no matrix lib). Returns null when
 * either predictor lacks variance or the two predictors are (near-)collinear,
 * i.e. the 2×2 Gram determinant is ~0 relative to its scale.
 */
export function ols2(
  x1: number[],
  x2: number[],
  y: number[],
): { intercept: number; bPace: number; bTemp: number } | null {
  const n = x1.length;
  if (n < 3) return null;
  const m1 = mean(x1);
  const m2 = mean(x2);
  const my = mean(y);

  let s11 = 0;
  let s22 = 0;
  let s12 = 0;
  let s1y = 0;
  let s2y = 0;
  for (let i = 0; i < n; i++) {
    const d1 = x1[i]! - m1;
    const d2 = x2[i]! - m2;
    const dy = y[i]! - my;
    s11 += d1 * d1;
    s22 += d2 * d2;
    s12 += d1 * d2;
    s1y += d1 * dy;
    s2y += d2 * dy;
  }
  // No variance in either predictor → can't estimate its partial slope.
  if (s11 <= 0 || s22 <= 0) return null;

  const det = s11 * s22 - s12 * s12;
  // Near-collinearity guard: det small vs the product of the marginal variances
  // means the predictors carry almost the same information (|corr| ≈ 1).
  if (Math.abs(det) < 1e-9 * s11 * s22) return null;

  const b1 = (s22 * s1y - s12 * s2y) / det;
  const b2 = (s11 * s2y - s12 * s1y) / det;
  const intercept = my - b1 * m1 - b2 * m2;
  return { intercept, bPace: b1, bTemp: b2 };
}

/**
 * Ordinary least-squares fit of y ~ slope*x + intercept plus Pearson r.
 * Returns null when there are < 2 points or x has zero variance.
 */
export function leastSquares(xs: number[], ys: number[]): HrTempFit | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { slopeBpmPerC: slope, interceptBpm: intercept, r };
}
