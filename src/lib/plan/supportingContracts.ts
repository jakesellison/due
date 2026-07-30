import {
  prescribedQualityMeters,
} from '../kpi/prescribedQuality';
import type { WorkoutStructure } from '../workout/types';

/** The workout fields needed to capture a week's supporting contracts. */
export interface SupportingContractWorkout {
  type: string | null;
  isQuality: boolean;
  plannedDistanceMeters: number | null;
  structure: WorkoutStructure;
  /** Stable per-workout hard-distance snapshot, when one was captured. */
  prescribedQualityMeters?: number | null;
}

export interface SupportingContractTargets {
  /** Prescribed hard-work distance across the week. */
  qualityTargetMeters: number;
  /** Distance of the longest prescribed continuous long run or race. */
  longTargetMeters: number;
}

/**
 * Capture the two supporting goals from an original weekly allocation.
 *
 * These are week-level contracts, not live summaries of the rows that happen
 * to remain on the calendar. Once stored, rearranging or removing a workout
 * must not silently rewrite either target.
 */
export function deriveSupportingContractTargets(
  workouts: SupportingContractWorkout[],
): SupportingContractTargets {
  let qualityTargetMeters = 0;
  let longTargetMeters = 0;

  for (const workout of workouts) {
    if (workout.type === 'rest') continue;

    qualityTargetMeters += workout.prescribedQualityMeters
      ?? prescribedQualityMeters(
        workout.structure ?? [],
        workout.isQuality ? (workout.plannedDistanceMeters ?? undefined) : undefined,
      );

    const type = (workout.type ?? '').toLowerCase();
    if (type === 'long' || type === 'race') {
      longTargetMeters = Math.max(longTargetMeters, workout.plannedDistanceMeters ?? 0);
    }
  }

  return {
    qualityTargetMeters: Math.round(qualityTargetMeters),
    longTargetMeters: Math.round(longTargetMeters),
  };
}

/**
 * A long run is one continuous recorded activity. Multiple activities on the
 * same date contribute to weekly mileage, but they never combine into a long
 * run. Taking the maximum activity distance enforces that distinction.
 */
export function longestContinuousActivityMeters(
  activities: Array<{ distanceMeters: number | null | undefined }>,
): number {
  return activities.reduce(
    (longest, activity) => Math.max(longest, activity.distanceMeters ?? 0),
    0,
  );
}
