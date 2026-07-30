/**
 * planQuality.ts — map a plan workout's prescribed structure to the interpreter's
 * `PlanQuality` (the prior the change-point interpreter uses to PREFER the
 * prescribed reading). Pure. No IO. Node-tested.
 *
 * `kind`:
 *   - 'intervals' when the structure contains one or more `repeat` blocks; rep
 *     counts aggregate across sets so the interpreter prefers the complete
 *     prescription rather than only its first block;
 *   - 'tempo' otherwise — a single continuous prescribed block, including an
 *     MP/tempo block embedded in a long run (a "quality long run").
 * `qualityMi`: the prescribed HARD distance (prescribedQualityMeters), falling
 *   back to 60% of the planned distance when the structure has no explicit hard
 *   leaves but a total distance is known (mirrors prescribedQualityMeters).
 *
 * Returns null when the workout prescribes no quality (an easy day) — the caller
 * then interprets plan-agnostically.
 */
import type { PlanQuality } from './interpretWorkout';
import type { WorkoutStructure } from '../workout/types';
import {
  prescribedQualityMeters,
} from './prescribedQuality';
import {
  extractPlannedIntervals,
} from './qualityDetect';
import {
  METERS_PER_MILE,
} from '../units';

export interface PlanWorkoutInput {
  id: string;
  structure: WorkoutStructure;
  plannedDistanceMeters?: number | null;
  /** Persisted hard-distance snapshot for duration-based named-pace work. */
  prescribedQualityMeters?: number | null;
}

export function planQualityFromWorkout(w: PlanWorkoutInput): PlanQuality | null {
  // NOTE: no totalPlannedDist fallback — `prescribedQualityMeters(structure, total)`
  // returns 0.6·total when the structure has NO hard leaves, which would make an
  // EASY day prescribe quality and let easy runs get plan-matched. We only treat a
  // day as prescribing quality when its structure has real hard work.
  const meters = w.prescribedQualityMeters ?? prescribedQualityMeters(w.structure);
  if (meters <= 0) return null;
  const intervals = extractPlannedIntervals(w.structure, {
    prescribedTotalMeters: w.prescribedQualityMeters,
  });
  return {
    kind: intervals ? 'intervals' : 'tempo',
    qualityMi: meters / METERS_PER_MILE,
    workoutId: w.id,
    ...(intervals
      ? {
          reps: intervals.reps,
          repDistancesMi: intervals.groups.flatMap((group) =>
            Array.from({ length: group.reps }, () => group.distPerRepMeters / METERS_PER_MILE),
          ),
        }
      : {}),
  };
}
