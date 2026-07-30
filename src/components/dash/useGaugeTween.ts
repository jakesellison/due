import { useEffect, useRef, useState } from 'react';

import { motion } from '@/theme/tokens';

/**
 * ~600ms travel (no bounce) — the Dash gauge motion (UX#3). Exported so
 * `useArrivalMeters`'s stage-1 hold duration can import the SAME constant
 * instead of a same-value comment-only duplicate — a retune here used to be
 * able to silently desynchronise the two (FIX 6).
 */
export const DURATION_MS = 600;

/**
 * The gauge's travel curve — `motion.fill`, solved directly.
 *
 * This was a cubic ease-out (`1 - (1-p)³`), which leaves at FULL SPEED and
 * decelerates the whole way. That is the right feel for UI responding to a tap,
 * but a gauge is a quantity travelling to a new value: departing from rest and
 * braking as it lands reads as motion, where an ease-out reads as something
 * already in flight that is slowing down. So the fill now accelerates briefly,
 * covers most of the distance at speed, and decelerates over the last stretch.
 *
 * A real bezier solve rather than a closed-form approximation because the house
 * curves are authored as beziers in `motion`; approximating one here would make
 * a retune in the token silently not apply.
 */
const [BX1, BY1, BX2, BY2] = motion.fill;

/** Cubic bezier component with P0=0 and P3=1, for control values `a`/`b`. */
function bezierAt(t: number, a: number, b: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * a + 3 * inv * t * t * b + t * t * t;
}

/**
 * y for a given x on the curve. x(t) is monotonic for these control points, so
 * bisection converges quickly and cannot diverge the way Newton can near a flat
 * tangent — worth the handful of extra iterations inside a 60fps loop.
 */
function easeFill(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let t = p;
  for (let i = 0; i < 18; i++) {
    const x = bezierAt(t, BX1, BX2);
    if (Math.abs(x - p) < 1e-4) break;
    if (x < p) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bezierAt(t, BY1, BY2);
}

/**
 * Tweens a small vector of values from *wherever they currently sit* to new
 * targets over ~600ms ease-out, in one `requestAnimationFrame` loop.
 *
 * The key difference from the old `useGaugeSweep` (a 0→1 progress the caller
 * multiplied in): the "from" is the last displayed frame, not a hard 0. So on
 * mount the ring still sweeps up from empty (initial current = 0), but browsing
 * week→week now GLIDES from the previous week's fill/number to the next week's
 * instead of collapsing to empty and re-filling. A target change mid-tween
 * retargets smoothly from the current frame (the ref holds live position).
 *
 * JS-driven (not Reanimated) to mirror the rest of the Dash reveals: snaps
 * straight to the targets when rAF is unavailable (jest — see
 * jest.setup.app.js) or Reduce Motion is on, so a gauge is never stuck at 0.
 */
export function useGaugeTween(targets: number[], reduceMotion: boolean, delayMs = 0): number[] {
  const [values, setValues] = useState<number[]>(() => (reduceMotion ? targets : targets.map(() => 0)));
  // Live position we tween FROM — survives retargets so week→week is continuous.
  const currentRef = useRef<number[]>(values);
  // Only genuine target changes re-fire the tween (not incidental re-renders).
  const key = targets.join(',');

  useEffect(() => {
    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      currentRef.current = targets;
      setValues(targets);
      return;
    }
    const to = targets;
    const from = to.map((_, i) => currentRef.current[i] ?? 0);
    let raf = 0;
    let start = 0;
    let cancelled = false;
    const tick = (t: number) => {
      if (cancelled) return;
      if (!start) start = t;
      const p = Math.min(1, (t - start) / DURATION_MS);
      const e = easeFill(p);
      const next = to.map((tv, i) => {
        const f = from[i] ?? 0;
        return f + (tv - f) * e;
      });
      currentRef.current = next;
      setValues(next);
      if (p < 1) raf = requestAnimationFrame(tick);
      else currentRef.current = to;
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduceMotion, delayMs]);

  return values;
}
