import {
  METERS_PER_MILE,
} from '../units';
import type { PaceBand, PaceLabel, PacePrescription, Target } from './types';

const KM_PER_MILE = METERS_PER_MILE / 1000;

/** The semantic pace name carried by a prescription, if any. */
export function paceIntent(pace: PacePrescription | null | undefined): PaceLabel | null {
  if (!pace) return null;
  return pace.kind === 'relative' ? pace.reference : pace.intent ?? null;
}

/** The actionable numeric band, authored or install-resolved. */
export function actionablePaceBand(
  pace: PacePrescription | null | undefined,
): PaceBand | null {
  if (!pace) return null;
  return pace.kind === 'absolute' ? pace.band : pace.resolved ?? null;
}

/** Compact, unambiguous relative label: "MP" or "92% MP". */
export function relativePaceLabel(
  pace: Extract<PacePrescription, { kind: 'relative' }>,
): string {
  const pct = Math.round(pace.speed_fraction * 1000) / 10;
  const reference = pace.reference;
  if (Math.abs(pct - 100) < 0.05) return reference;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}% ${reference}`;
}

/** Strip runner-specific resolution before writing a portable `.due` file. */
export function portablePacePrescription(
  pace: PacePrescription | null | undefined,
): PacePrescription | undefined {
  if (!pace) return undefined;
  if (pace.kind === 'absolute') {
    return {
      kind: 'absolute',
      band: { ...pace.band },
      ...(pace.intent ? { intent: pace.intent } : {}),
    };
  }
  return {
    kind: 'relative',
    reference: pace.reference,
    speed_fraction: pace.speed_fraction,
  };
}

/**
 * Resolve a relative prescription against a reference pace (seconds per mile).
 * Fractions are speed-based, hence target pace = reference pace / fraction.
 */
export function resolveRelativePaceBand(
  referenceSecPerMi: number,
  speedFraction: number,
  halfWidthSecPerMi: number,
): PaceBand | null {
  if (!(referenceSecPerMi > 0) || !(speedFraction > 0) || !(halfWidthSecPerMi >= 0)) {
    return null;
  }
  const midpoint = referenceSecPerMi / speedFraction;
  return {
    fast_s_per_km: Math.round((midpoint - halfWidthSecPerMi) / KM_PER_MILE),
    slow_s_per_km: Math.round((midpoint + halfWidthSecPerMi) / KM_PER_MILE),
  };
}

