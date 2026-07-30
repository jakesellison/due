/**
 * prescribedQuality.ts — Derive prescribed quality-session minutes from a
 * planned workout's structure.
 *
 * Pure. No IO. Node-tested.
 * Spec: docs/superpowers/specs/2026-06-18-quality-aware-adaptation-design.md §2
 *
 * Algorithm:
 *  1. Walk the structure to collect hard segments (kind === 'interval' or
 *     kind === 'steady' with a non-easy hr_zone, inside a repeat block or
 *     standalone). A 'repeat' multiplies its hard children by its set count.
 *  2. For each hard segment:
 *       - Distance targets convert to time at the prescribed pace.
 *       - Duration targets use their explicit time and convert to estimated
 *         hard distance at the prescribed pace.
 *       - Authored and install-resolved bands use their midpoint.
 *       - Relative targets resolve from the runner's race-equivalent paces.
 *       - Unresolved named paces scale relative to the runner's floor;
 *         otherwise use the floor pace itself.
 *  3. Sum all hard segment durations → prescribedMinutes.
 *  4. If the structure has no parseable hard distance at all, fall back to
 *     60% of the total planned quality distance at the floor pace.
 *
 * Sufficiency gate (applied in qualityCredit.ts):
 *   credit is given only when detectedQualityTimeMin ≥ 0.6 × prescribedMinutes
 */

import {
  paceIntent,
} from '../workout/pace';
import type { Segment, WorkoutStructure } from '../workout/types';
import type { QualityFloor } from './qualityFloor';
import {
  METERS_PER_MILE,
} from '../units';
import {
  resolveTargetPace,
  type RacePaces,
} from './targetPace';

/** Hard kinds for leaf segments inside a repeat. */
const HARD_KINDS = new Set(['interval', 'work', 'steady']);

/** Named paces that denote quality (hard) effort. */
const HARD_PACE_LABELS = new Set([
  'threshold', 'tempo', '5K', '10K', '3K', 'mile', 'rep', 'HMP', 'MP',
]);

/** A conservative generic fallback used only by the distance KPI, whose public
 * API historically has no runner-floor argument. Builder-created workouts keep
 * their runner-resolved total in `workouts.prescribed_quality_meters`; this
 * fallback primarily protects imported and legacy named-pace prescriptions from
 * collapsing to zero before a snapshot exists. */
const DEFAULT_TIMED_QUALITY_PACE_SEC_PER_MI = 420;

/** Named quality paces relative to the runner's moderate/quality floor. */
const NAMED_PACE_FACTOR: Record<string, number> = {
  MP: 1.08,
  HMP: 1.04,
  threshold: 1,
  tempo: 1,
  '10K': 0.97,
  '5K': 0.94,
  '3K': 0.91,
  mile: 0.86,
  rep: 0.88,
};

export interface QualityPaceContext {
  /** Current runner-specific race equivalents; resolves named targets without
   * writing false numeric precision into the portable .due prescription. */
  paces?: RacePaces | null;
  /** Conservative fallback when no race model can resolve a named target. */
  fallbackPaceSecPerMi?: number;
}

/**
 * Returns true when a leaf segment is a "hard" (quality-work) segment.
 * `interval`/`work` are always hard; any segment carrying a hard pace intent
 * is hard; `steady` is hard unless annotated easy (hr_zone === 'easy').
 */
function isHardLeaf(seg: Extract<Segment, { kind: string }>): boolean {
  if (seg.kind === 'interval' || seg.kind === 'work') return true;
  const target = seg.kind === 'repeat' ? null : seg.target;
  // An explicit easy HR zone is authoritative: a long run's easy leg can carry a
  // relative reference (e.g. "MP") without being quality work — so the easy
  // marker must win over the pace-intent check below.
  if (target?.hr_zone === 'easy') return false;
  const intent = paceIntent(target?.pace);
  if (intent && HARD_PACE_LABELS.has(intent)) return true;
  if (seg.kind === 'steady') return true;
  return false;
}

/**
 * Convert a target pace (seconds/km) to seconds/mile.
 * Returns null when no pace information is present.
 */
function targetPaceSecPerMi(
  seg: Segment,
  fallbackPaceSecPerMi: number,
  paces: RacePaces | null,
): number | null {
  if (seg.kind === 'repeat') return null;
  const t = seg.target;
  const resolved = resolveTargetPace(t, paces);
  if (resolved != null) return resolved;
  const intent = paceIntent(t.pace);
  if (intent && NAMED_PACE_FACTOR[intent] != null) {
    const base = fallbackPaceSecPerMi * NAMED_PACE_FACTOR[intent]!;
    return t.pace?.kind === 'relative' ? base / t.pace.speed_fraction : base;
  }
  return fallbackPaceSecPerMi > 0 ? fallbackPaceSecPerMi : null;
}

/** Time + distance represented by one hard leaf. Explicit values win; the
 * missing axis is estimated from prescribed/named/fallback pace. */
function hardSegmentPrescription(
  seg: Segment,
  fallbackPaceSecPerMi: number,
  paces: RacePaces | null,
): { seconds: number; meters: number } {
  if (seg.kind === 'repeat') return { seconds: 0, meters: 0 };
  const distM = seg.target.distance_m ?? 0;
  const durationS = seg.target.duration_s ?? 0;
  const pace = targetPaceSecPerMi(seg, fallbackPaceSecPerMi, paces);
  const seconds = durationS > 0
    ? durationS
    : distM > 0 && pace != null
      ? (distM / METERS_PER_MILE) * pace
      : 0;
  const meters = distM > 0
    ? distM
    : durationS > 0 && pace != null && pace > 0
      ? (durationS / pace) * METERS_PER_MILE
      : 0;
  return { seconds, meters };
}

/** Estimated distance for one prescribed leaf. Used by plan matching so a
 * duration-based rep has the same per-rep prior as a distance-based rep. */
export function estimatedQualityLeafMeters(
  seg: Segment,
  context: QualityPaceContext = {},
): number {
  return hardSegmentPrescription(
    seg,
    context.fallbackPaceSecPerMi ?? DEFAULT_TIMED_QUALITY_PACE_SEC_PER_MI,
    context.paces ?? null,
  ).meters;
}

/**
 * Accumulate hard-segment duration (in seconds) from a list of segments,
 * multiplying by the repeat count when inside a repeat block.
 *
 * @param segs              Array of Segment (top-level or children of a repeat).
 * @param multiplier        Repeat multiplier (1 at top level, set count inside repeat).
 * @param fallbackPace      Floor pace (s/mi) used when no target pace is present.
 * @param hardOut           Mutable accumulator for total hard distance/evidence.
 */
function accumulateHardSeconds(
  segs: Segment[],
  multiplier: number,
  fallbackPace: number,
  paces: RacePaces | null,
  hardOut: { m: number; leaves: number },
): number {
  let totalS = 0;
  for (const seg of segs) {
    if (seg.kind === 'repeat') {
      totalS += accumulateHardSeconds(
        seg.children,
        multiplier * seg.sets,
        fallbackPace,
        paces,
        hardOut,
      );
    } else if (HARD_KINDS.has(seg.kind) && isHardLeaf(seg)) {
      const prescription = hardSegmentPrescription(seg, fallbackPace, paces);
      if (prescription.meters > 0 || prescription.seconds > 0) {
        hardOut.leaves += multiplier;
        hardOut.m += prescription.meters * multiplier;
        totalS += prescription.seconds * multiplier;
      }
    }
  }
  return totalS;
}

/**
 * Derive the prescribed quality-session minutes from a planned workout's
 * structure.
 *
 * @param structure           Planned workout structure (Segment[]).
 * @param floor               The runner's quality floor (for fallback pace).
 * @param totalPlannedDistM   Total planned workout distance (meters). Used only
 *                            as a last resort when no hard segments are parseable.
 */
export function prescribedQualityMinutes(
  structure: WorkoutStructure,
  floor: QualityFloor,
  totalPlannedDistM?: number,
  paces: RacePaces | null = null,
): number {
  const fallbackPace = floor.paceFloorSecPerMi;
  const hardDistAcc = { m: 0, leaves: 0 };
  const hardTotalS = accumulateHardSeconds(structure, 1, fallbackPace, paces, hardDistAcc);

  if (hardDistAcc.leaves > 0) {
    // Explicit duration is authoritative for time-based hard work.
    return hardTotalS / 60;
  }

  // Fallback: no parseable hard distance found in structure.
  // Estimate as 60% of total planned distance at the floor pace.
  if (totalPlannedDistM != null && totalPlannedDistM > 0) {
    const totalMiles = totalPlannedDistM / METERS_PER_MILE;
    const totalS = totalMiles * fallbackPace;
    return (totalS * 0.6) / 60;
  }

  // No distance info at all — return 0 (gate will always pass).
  return 0;
}

/**
 * Derive the prescribed quality-session DISTANCE (meters) — the total hard-work
 * distance a planned workout asks for (e.g. 4×2mi → ~12874 m). This is the
 * denominator of the distance-based Quality KPI. Distance prescriptions remain
 * pace-invariant; duration prescriptions are converted at their numeric/named
 * pace so standard sessions such as 6×3 min still have a truthful contract.
 * Falls back to 60% of total planned distance only when there is no hard leaf.
 */
export function prescribedQualityMeters(
  structure: WorkoutStructure,
  totalPlannedDistM?: number,
  context: QualityPaceContext = {},
): number {
  const hardDistAcc = { m: 0, leaves: 0 };
  accumulateHardSeconds(
    structure,
    1,
    context.fallbackPaceSecPerMi ?? DEFAULT_TIMED_QUALITY_PACE_SEC_PER_MI,
    context.paces ?? null,
    hardDistAcc,
  );
  if (hardDistAcc.leaves > 0 && hardDistAcc.m > 0) return hardDistAcc.m;
  if (totalPlannedDistM != null && totalPlannedDistM > 0) return totalPlannedDistM * 0.6;
  return 0;
}

// ── Sufficiency gate ──────────────────────────────────────────────────────────

/** Minimum fraction of prescribed minutes that must be detected. */
export const SUFFICIENCY_FRACTION = 0.6;

/**
 * Returns true when the detected quality-time meets the sufficiency gate:
 *   detectedQualityTimeMin ≥ SUFFICIENCY_FRACTION × prescribedMinutes
 *
 * When prescribedMinutes is 0 (no prescribed structure), the gate always
 * passes (we don't penalise a plan that has no structure metadata).
 */
export function meetsSufficiencyGate(
  detectedQualityTimeMin: number,
  prescribedMin: number,
): boolean {
  if (prescribedMin <= 0) return true;
  return detectedQualityTimeMin >= SUFFICIENCY_FRACTION * prescribedMin;
}
