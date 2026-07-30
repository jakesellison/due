/**
 * hitTest.ts — pure drop-target math for the week planner's drag layer.
 *
 * Day slots are measured in WINDOW coordinates (x-ranges) and the strip's
 * vertical band [top, bottom] gates whether a pointer counts as "over the
 * strip". The gesture handler feeds `absoluteX/absoluteY` straight in, so no
 * scroll-offset bookkeeping is needed. A worklet mirror of `dayAtPoint` lives
 * inline in the screen (reanimated can't call JS per-frame); the logic is
 * trivial and verified here.
 */
export interface XRange {
  x0: number;
  x1: number;
}

/** Index of the slot whose x-range contains `x`, or null. Ranges are ordered. */
export function dayAtX(x: number, ranges: XRange[]): number | null {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r && x >= r.x0 && x < r.x1) return i;
  }
  return null;
}

/** Slot under a point, gated to the strip's vertical band. Null when the
 *  pointer is above/below the strip or between slots. */
export function dayAtPoint(
  x: number,
  y: number,
  ranges: XRange[],
  top: number,
  bottom: number,
): number | null {
  if (y < top || y > bottom) return null;
  return dayAtX(x, ranges);
}
