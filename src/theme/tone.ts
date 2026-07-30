/**
 * tone.ts — THE canonical workout-TYPE → colour map.
 *
 * One source of truth for how a run's TYPE is coloured across the whole app, so
 * a palette change (e.g. quality pink→violet, easy neutral→steel blue) is a single edit
 * here instead of a scavenger hunt. Every surface that tints by workout type —
 * pips, gauges, structure bars, planned/actual labels, the run-detail chip —
 * routes through this.
 *
 *   easy          → easyText (muted steel blue): quiet enough to remain the
 *                   default, but distinct from untyped/rest neutrals.
 *   long          → cyanText (cyan in dark, contrast-safe blue-cyan in light).
 *   quality/speed → qualText (violet): earned effort, decoupled from the danger pink.
 *   cross         → mute.
 *   rest/untyped  → null (no colour / no pip).
 *
 * STATUS colours are deliberately NOT here: "met" (green z2) and "missed" /
 * danger (pink z5) describe an OUTCOME, not a type, and must stay put even as the
 * type palette changes.
 */
import type { WorkoutTone } from '@/lib';
import type { Tokens } from './tokens';

/** Accepts any workout tone plus 'cross' (a builder-only type) and loose strings. */
export type ToneLike = WorkoutTone | 'cross' | string | null | undefined;

export function toneColor(C: Tokens, tone: ToneLike): string | null {
  switch (tone) {
    case 'long':
      return C.cyanText;
    case 'quality':
    case 'speed':
      return C.qualText;
    case 'easy':
      return C.easyText;
    case 'cross':
      return C.mute;
    default:
      return null; // rest / untyped — no type colour
  }
}

/** Like `toneColor` but never null — falls back to `mute` for rest/untyped. For
 *  surfaces that always need a colour (a bar fill, an icon tint). */
export function toneColorOr(C: Tokens, tone: ToneLike, fallback?: string): string {
  return toneColor(C, tone) ?? fallback ?? C.mute;
}
