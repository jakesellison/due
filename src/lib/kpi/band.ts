export type Band = 'green' | 'amber' | 'red';

export interface BandOpts { amber?: number }

export function bandFor(actualMeters: number, targetMeters: number, opts: BandOpts = {}): Band {
  const amber = opts.amber ?? 0.9;
  // No goal set (target <= 0) is green by design: there's nothing to miss.
  if (targetMeters <= 0) return 'green';
  // Note the deliberate asymmetry: bandFor measures the amber floor against
  // `target`, whereas bandForRange measures it against `low`.
  const ratio = actualMeters / targetMeters;
  if (ratio >= 1) return 'green';
  if (ratio >= amber) return 'amber';
  return 'red';
}

export function bandForRange(
  actualMeters: number, lowMeters: number, highMeters: number, opts: BandOpts = {},
): Band {
  const amber = opts.amber ?? 0.9;
  // Anything at or above the low edge is green (since amber < 1, being over the
  // top of the band is green too). The amber floor is measured against `low`.
  if (actualMeters >= lowMeters) return 'green';
  if (actualMeters >= lowMeters * amber) return 'amber';
  return 'red';
}

/** Where you "should be" by now: target × fraction of week elapsed. */
export function paceLineMeters(targetMeters: number, elapsedFraction: number): number {
  return targetMeters * elapsedFraction;
}

export interface PaceStatus {
  band: Band;
  /** The prorated target you should have reached by now (meters). */
  paceLineMeters: number;
}

/**
 * Prorated, "on pace" banding for an IN-PROGRESS period (typically the current
 * week mid-week). Compares `actualMeters` against the pace line
 * (`target × elapsedFraction`) with the same green/amber/red thresholds as
 * `bandFor` (amber floor default 0.9):
 *  - actual >= pace line          -> green ("on/ahead of pace")
 *  - actual >= pace line × amber   -> amber ("slightly behind pace")
 *  - otherwise                     -> red   ("behind pace")
 *
 * At `elapsedFraction === 1` the pace line equals the full target, so this
 * collapses to `bandFor(actual, target)`.
 */
export function paceStatus(
  actualMeters: number,
  targetMeters: number,
  elapsedFraction: number,
  opts: BandOpts = {},
): PaceStatus {
  const frac = Math.min(1, Math.max(0, elapsedFraction));
  const line = paceLineMeters(targetMeters, frac);
  // No goal (target <= 0) is green by design — mirrors bandFor.
  const band = targetMeters <= 0 ? 'green' : bandFor(actualMeters, line, opts);
  return { band, paceLineMeters: line };
}
