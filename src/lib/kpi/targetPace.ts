/**
 * targetPace.ts — resolve a plan Target to a concrete pace (sec/mi).
 *
 * Pure. No IO. Node-tested. Numeric pace fields resolve directly; named race
 * prescriptions (5K/MP/threshold…) resolve via Riegel equivalence from the
 * runner's marathon-finish prediction. threshold/tempo are treated as ~HMP
 * effort. Relative fractions are explicitly speed-based.
 */
import {
  actionablePaceBand,
  resolveRelativePaceBand,
} from '../workout/pace';
import type { PaceLabel, PacePrescription, Target } from '../workout/types';
import {
  METERS_PER_MILE,
} from '../units';

const MARATHON_M = 42195;
const RIEGEL = 1.06;

export interface RacePaces {
  mp: number; hmp: number; threshold: number;
  ['10k']: number; ['5k']: number; ['3k']: number; mile: number;
}

/** Riegel-equivalent finish seconds for `targetM`, from a known distance/time. */
function equivSeconds(knownM: number, knownSec: number, targetM: number): number {
  return knownSec * Math.pow(targetM / knownM, RIEGEL);
}

/** Pace (sec/mi) for a race distance equivalent to the marathon prediction. */
function pace(marathonSeconds: number, distM: number): number {
  const sec = distM === MARATHON_M ? marathonSeconds : equivSeconds(MARATHON_M, marathonSeconds, distM);
  return sec / (distM / METERS_PER_MILE);
}

export function runnerRacePaces(marathonSeconds: number): RacePaces | null {
  if (!(marathonSeconds > 0)) return null;
  return {
    mp: pace(marathonSeconds, MARATHON_M),
    hmp: pace(marathonSeconds, 21097.5),
    threshold: pace(marathonSeconds, 21097.5), // ~1-hour effort ≈ HMP
    ['10k']: pace(marathonSeconds, 10000),
    ['5k']: pace(marathonSeconds, 5000),
    ['3k']: pace(marathonSeconds, 3000),
    mile: pace(marathonSeconds, METERS_PER_MILE),
  };
}

const LABEL_KEY: Partial<Record<PaceLabel, keyof RacePaces>> = {
  MP: 'mp', HMP: 'hmp', threshold: 'threshold', tempo: 'threshold',
  ['10K']: '10k', ['5K']: '5k', ['3K']: '3k', mile: 'mile', rep: 'mile',
};

const BAND_HALF_WIDTH_SEC_PER_MI: Record<PaceLabel, number> = {
  recovery: 20,
  easy: 15,
  steady: 12,
  MP: 8,
  HMP: 7,
  threshold: 6,
  tempo: 6,
  '10K': 6,
  '5K': 6,
  '3K': 7,
  mile: 8,
  rep: 10,
};

function referencePaceSecPerMi(reference: PaceLabel, paces: RacePaces | null): number | null {
  if (!paces) return null;
  const key = LABEL_KEY[reference];
  return key ? paces[key] : null;
}

/** Resolve and snapshot a portable relative prescription for this runner. */
export function resolvePacePrescription(
  prescription: PacePrescription,
  paces: RacePaces | null,
): PacePrescription {
  if (prescription.kind === 'absolute' || prescription.resolved) return prescription;
  const reference = referencePaceSecPerMi(prescription.reference, paces);
  if (reference == null) return prescription;
  const resolved = resolveRelativePaceBand(
    reference,
    prescription.speed_fraction,
    BAND_HALF_WIDTH_SEC_PER_MI[prescription.reference],
  );
  return resolved ? { ...prescription, resolved } : prescription;
}

export function resolveTargetPace(target: Target, paces: RacePaces | null): number | null {
  const band = actionablePaceBand(target.pace);
  if (band) {
    const midKm = (band.fast_s_per_km + band.slow_s_per_km) / 2;
    return (midKm / 1000) * METERS_PER_MILE;
  }
  if (target.pace?.kind === 'relative') {
    const reference = referencePaceSecPerMi(target.pace.reference, paces);
    if (reference != null && target.pace.speed_fraction > 0) {
      return reference / target.pace.speed_fraction;
    }
  }
  return null;
}
