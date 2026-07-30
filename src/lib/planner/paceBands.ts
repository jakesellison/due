/**
 * paceBands.ts — derive a per-zone pace BAND (sec/mi) from a runner's own easy
 * pace. Coaching prescribes a range, not a point; the builder seeds each named
 * pace into an editable band from the runner's easyBaseline, and the same
 * mapping can render a band in downstream run-detail readouts.
 *
 * Pure. No IO. Node-tested.
 */
import type { PaceLabel } from '../workout/types';
import {
  METERS_PER_MILE,
} from '../units';

/** Offset from the easy baseline (sec/mi; negative = faster) + half-band width. */
const ZONE: Record<PaceLabel, { off: number; half: number }> = {
  recovery: { off: 45, half: 20 },
  easy: { off: 0, half: 15 },
  steady: { off: -35, half: 12 },
  MP: { off: -60, half: 8 },
  HMP: { off: -80, half: 7 },
  threshold: { off: -95, half: 6 },
  tempo: { off: -95, half: 6 },
  '10K': { off: -108, half: 6 },
  '5K': { off: -122, half: 6 },
  '3K': { off: -138, half: 7 },
  mile: { off: -152, half: 8 },
  rep: { off: -150, half: 10 },
};

/** Clamp a pace to a sane 4:00–12:00 /mi window. */
export const clampPaceSecPerMi = (s: number): number => Math.max(240, Math.min(720, Math.round(s)));

/**
 * Seed a pace band (sec/mi, `lo` = faster edge) for a named pace, offset from the
 * runner's easy baseline. Falls back to the easy zone for an unknown label.
 */
export function seedPaceBand(pace: PaceLabel, easyBaselineSecPerMi: number): { lo: number; hi: number } {
  const z = ZONE[pace] ?? ZONE.easy;
  const mid = easyBaselineSecPerMi + z.off;
  return { lo: clampPaceSecPerMi(mid - z.half), hi: clampPaceSecPerMi(mid + z.half) };
}

/** m:ss from seconds. */
export const fmtPace = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** Convert a sec/mi pace to sec/km (the .due Target unit). */
export const secPerMiToKm = (secPerMi: number): number => Math.round(secPerMi / (METERS_PER_MILE / 1000));
