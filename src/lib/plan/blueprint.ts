import {
  renderStructure,
} from '../workout/render';
import type { WorkoutStructure } from '../workout/types';
import {
  prescribedQualityMeters,
} from '../kpi/prescribedQuality';

export type BlueprintWeekState = 'past' | 'current' | 'future';

export interface BlueprintWorkoutInput {
  id: string;
  date: string | null;
  type: string | null;
  title: string | null;
  plannedDistanceMeters: number | null;
  /** Logged distance attributed to this workout. Present rows are resolved,
   *  including a workout completed earlier on the current civil day. */
  actualDistanceMeters?: number | null;
  /** A past workout without an actual is a miss, so its stale prescription
   *  must not remain in the live week-end projection. */
  isPast?: boolean;
  isQuality: boolean;
  structure?: WorkoutStructure;
  prescribedQualityMeters?: number | null;
  notes?: string | null;
}

export interface BlueprintWeekInput {
  weekId: string;
  weekIndex: number;
  weekStart: string;
  phase: string;
  isRecovery: boolean;
  targetMeters: number;
  originalTargetMeters: number | null;
  qualityTargetMeters: number | null;
  longTargetMeters: number | null;
  actualMeters: number;
  isCurrent: boolean;
  isFuture: boolean;
  workouts: BlueprintWorkoutInput[];
}

export interface BlueprintKeyWorkout {
  id: string;
  date: string | null;
  title: string;
  plannedDistanceMeters: number;
  /** Compact, authored-or-structured prescription for the inspector. */
  prescription: string;
  /** A session can satisfy both roles while appearing only once. */
  roles: BlueprintSessionRole[];
  /** Prescribed hard-work distance inside this session. */
  qualityMeters: number;
}

export type BlueprintSessionRole = 'quality' | 'long';

export interface PlanBlueprintWeek extends Omit<BlueprintWeekInput, 'workouts' | 'qualityTargetMeters' | 'longTargetMeters'> {
  state: BlueprintWeekState;
  /** Base/build/peak/taper span. A cutback `phase: recovery` inherits a
   *  neighbouring structural phase so recovery never fragments the block. */
  structuralPhase: string;
  revised: boolean;
  revisionDeltaMeters: number;
  runDays: number;
  /** Resolved immutable contracts; legacy null inputs fall back to authored coverage. */
  qualityTargetMeters: number;
  longTargetMeters: number;
  keySessions: BlueprintKeyWorkout[];
  scheduledSupportMeters: number;
  scheduledSupportDays: number;
  scheduledTotalMeters: number;
  /** Positive = contract mileage still open; negative = above contract.
   *  Future weeks use authored allocation; the current week uses its projected
   *  finish (banked plus unresolved work). */
  allocationDeltaMeters: number;
  qualityCoverageMeters: number;
  longCoverageMeters: number;
  qualityOpenMeters: number;
  longOpenMeters: number;
}

export type BlueprintAllocationGapKind = 'weekly' | 'quality' | 'long';

export interface BlueprintAllocationGap {
  kind: BlueprintAllocationGapKind;
  meters: number;
  label: string;
  shortLabel: string;
}

/** Match Reshape's projection noise gate: sub-0.3-mile differences are normal
 * GPS and imported-plan rounding, not actionable allocation exceptions. */
const WEEKLY_ALLOCATION_TOLERANCE_METERS = 0.3 * 1609.344;

/** The still-unallocated portions of a week's immutable contracts. */
export function blueprintAllocationGaps(week: PlanBlueprintWeek): BlueprintAllocationGap[] {
  const threshold = 0.05 * 1609.344;
  return [
    { kind: 'weekly' as const, meters: week.allocationDeltaMeters, label: 'weekly mileage', shortLabel: 'weekly' },
    { kind: 'quality' as const, meters: week.qualityOpenMeters, label: 'quality', shortLabel: 'quality' },
    { kind: 'long' as const, meters: week.longOpenMeters, label: 'continuous long run', shortLabel: 'long' },
  ].filter((gap) => gap.meters > threshold);
}

/**
 * Reduce the query-shaped plan weeks into the stable, presentation-independent
 * model shared by the Plan profile, inspector, and ledger. Mileage stays the
 * contract; quality and long are intentionally only supporting cues.
 */
export function buildPlanBlueprint(inputs: BlueprintWeekInput[]): PlanBlueprintWeek[] {
  const ordered = [...inputs].sort((a, b) => a.weekIndex - b.weekIndex);
  return ordered.map((week, index) => {
    const runs = week.workouts.filter(isRunWorkout);
    const classified = runs.map(classifyWorkout);
    const keySessions = [...new Map(
      classified
        .filter((entry) => entry.roles.length > 0)
        .map((entry) => [entry.workout.id, toKeyWorkout(entry.workout, entry.roles, entry.qualityMeters)]),
    ).values()].sort(byDateThenDistance);
    const keyIds = new Set(keySessions.map((session) => session.id));
    const supportRuns = runs.filter((workout) => !keyIds.has(workout.id));
    const scheduledTotalMeters = sumPlannedMeters(runs);
    const hasResolutionData = runs.some(
      (workout) => workout.isPast != null || workout.actualDistanceMeters !== undefined,
    );
    const remainingScheduledMeters = hasResolutionData
      ? sumPlannedMeters(runs.filter((workout) => !isResolvedWorkout(workout)))
      : scheduledTotalMeters;
    // Future/template weeks compare authored allocation with the contract.
    // A live week instead projects its finish: everything already banked
    // (including unplanned runs) plus only the prescriptions still unresolved.
    const allocationBasisMeters = week.isCurrent && hasResolutionData
      ? week.actualMeters + remainingScheduledMeters
      : scheduledTotalMeters;
    const rawAllocationDeltaMeters = week.targetMeters - allocationBasisMeters;
    const allocationDeltaMeters = Math.abs(rawAllocationDeltaMeters) <= WEEKLY_ALLOCATION_TOLERANCE_METERS
      ? 0
      : rawAllocationDeltaMeters;
    const scheduledSupportMeters = sumPlannedMeters(supportRuns);
    const qualityCoverageMeters = keySessions.reduce((sum, session) => sum + session.qualityMeters, 0);
    // A long contract is one continuous session, never a sum across workouts.
    const longCoverageMeters = keySessions
      .filter((session) => session.roles.includes('long'))
      .reduce((longest, session) => Math.max(longest, session.plannedDistanceMeters), 0);
    // Stored targets are immutable contracts. Legacy rows have no stored value,
    // so their authored allocation is the only honest fallback.
    const qualityTargetMeters = week.qualityTargetMeters ?? qualityCoverageMeters;
    const longTargetMeters = week.longTargetMeters ?? longCoverageMeters;
    const original = week.originalTargetMeters;
    const revised = original != null && Math.round(original) !== Math.round(week.targetMeters);

    return {
      ...week,
      state: week.isCurrent ? 'current' : week.isFuture ? 'future' : 'past',
      structuralPhase: structuralPhaseAt(ordered, index),
      revised,
      revisionDeltaMeters: revised ? week.targetMeters - original! : 0,
      runDays: new Set(runs.map((workout) => workout.date).filter(Boolean)).size,
      keySessions,
      scheduledSupportMeters,
      scheduledSupportDays: new Set(supportRuns.map((workout) => workout.date).filter(Boolean)).size,
      scheduledTotalMeters,
      allocationDeltaMeters,
      qualityTargetMeters,
      longTargetMeters,
      qualityCoverageMeters,
      longCoverageMeters,
      qualityOpenMeters: Math.max(0, qualityTargetMeters - qualityCoverageMeters),
      longOpenMeters: Math.max(0, longTargetMeters - longCoverageMeters),
    };
  });
}

function isRunWorkout(workout: BlueprintWorkoutInput): boolean {
  const type = (workout.type ?? '').toLowerCase();
  return type !== 'rest' && type !== 'cross' && (workout.plannedDistanceMeters ?? 0) > 0;
}

function isResolvedWorkout(workout: BlueprintWorkoutInput): boolean {
  return workout.isPast === true || workout.actualDistanceMeters != null;
}

function classifyWorkout(workout: BlueprintWorkoutInput): {
  workout: BlueprintWorkoutInput;
  roles: BlueprintSessionRole[];
  qualityMeters: number;
} {
  const type = (workout.type ?? '').toLowerCase();
  const qualityMeters = workout.prescribedQualityMeters
    ?? prescribedQualityMeters(
      workout.structure ?? [],
      workout.isQuality || type === 'quality' ? (workout.plannedDistanceMeters ?? undefined) : undefined,
    );
  const roles: BlueprintSessionRole[] = [];
  if (qualityMeters > 0) roles.push('quality');
  if (type === 'long' || type === 'race') roles.push('long');
  return { workout, roles, qualityMeters };
}

function byDateThenDistance(
  a: Pick<BlueprintWorkoutInput, 'date' | 'plannedDistanceMeters'>,
  b: Pick<BlueprintWorkoutInput, 'date' | 'plannedDistanceMeters'>,
): number {
  return (
    (a.date ?? '').localeCompare(b.date ?? '') ||
    (b.plannedDistanceMeters ?? 0) - (a.plannedDistanceMeters ?? 0)
  );
}

function sumPlannedMeters(workouts: BlueprintWorkoutInput[]): number {
  return workouts.reduce((sum, workout) => sum + (workout.plannedDistanceMeters ?? 0), 0);
}

function toKeyWorkout(
  workout: BlueprintWorkoutInput,
  roles: BlueprintSessionRole[],
  qualityMeters: number,
): BlueprintKeyWorkout {
  return {
    id: workout.id,
    date: workout.date,
    title: workout.title?.trim() || 'Run',
    plannedDistanceMeters: workout.plannedDistanceMeters ?? 0,
    prescription: compactPrescription(workout),
    roles,
    qualityMeters,
  };
}

function structuralPhaseAt(weeks: BlueprintWeekInput[], index: number): string {
  const phase = weeks[index]?.phase ?? 'base';
  if (phase.toLowerCase() !== 'recovery') return phase;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = weeks[i]?.phase;
    if (candidate && candidate.toLowerCase() !== 'recovery') return candidate;
  }
  for (let i = index + 1; i < weeks.length; i += 1) {
    const candidate = weeks[i]?.phase;
    if (candidate && candidate.toLowerCase() !== 'recovery') return candidate;
  }
  return phase;
}

const GENERIC_WORKOUT_TITLES = new Set([
  'quality', 'quality run', 'quality workout', 'workout',
  'long', 'long run', 'easy', 'easy run', 'run',
]);

function compactPrescription(workout: BlueprintWorkoutInput): string {
  const structure = workout.structure ?? [];
  if (structure.length > 0) {
    const rendered = renderStructure(structure, 'mi');
    const core = rendered
      .split(' + ')
      .map((part) => part.trim())
      .find((part) => part.includes('×') || part.includes('@'));
    if (core) return core.replace(/\s+/g, ' ');
  }
  const title = workout.title?.trim() || 'Run';
  if (!GENERIC_WORKOUT_TITLES.has(title.toLowerCase())) return title;
  const note = workout.notes?.trim();
  return note || title;
}
