import {
  runnerRacePaces,
  resolvePacePrescription,
  type RacePaces,
} from '../kpi/targetPace';
import {
  portablePacePrescription,
} from '../workout/pace';
import type { Segment, WorkoutStructure } from '../workout/types';
import type { ImportedPlanDraft } from './draft';

function mapStructure(
  structure: WorkoutStructure,
  mapLeaf: (segment: Exclude<Segment, { kind: 'repeat' }>) => Exclude<Segment, { kind: 'repeat' }>,
): WorkoutStructure {
  return structure.map((segment) => {
    if (segment.kind !== 'repeat') return mapLeaf(segment);
    return {
      ...segment,
      children: mapStructure(segment.children, mapLeaf),
    };
  });
}

/** Add runner-specific resolved bands to every resolvable relative target. */
function resolveStructurePaces(
  structure: WorkoutStructure,
  paces: RacePaces | null,
): WorkoutStructure {
  return mapStructure(structure, (segment) => ({
    ...segment,
    target: {
      ...segment.target,
      ...(segment.target.pace
        ? { pace: resolvePacePrescription(segment.target.pace, paces) }
        : {}),
    },
  }));
}

/** Remove runner-specific resolution when serializing a portable plan. */
export function portableWorkoutStructure(structure: WorkoutStructure): WorkoutStructure {
  return mapStructure(structure, (segment) => {
    const pace = portablePacePrescription(segment.target.pace);
    return {
      ...segment,
      target: {
        ...segment.target,
        ...(pace ? { pace } : {}),
      },
    };
  });
}

/** Resolve a dated install draft from its own goal-time calibration. */
export function resolvePlanDraftPaces(draft: ImportedPlanDraft): ImportedPlanDraft {
  const paces = runnerRacePaces(draft.plan.goalTimeSeconds ?? 0);
  if (!paces) return draft;
  return {
    ...draft,
    workouts: draft.workouts.map((workout) => ({
      ...workout,
      structure: resolveStructurePaces(workout.structure, paces),
    })),
  };
}
