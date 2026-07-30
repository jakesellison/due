import {
  prescribedQualityMeters,
} from '../kpi/prescribedQuality';
import type { WorkoutStructure } from '../workout/types';

/** The deliberately small, portable summary that gives a plan one identity. */
export interface PlanIdentity {
  name: string;
  distanceLabel: string;
  numWeeks: number;
  averageWeeklyMeters: number;
  peakWeeklyMeters: number;
  /** Prescribed hard-work distance as a share of total planned mileage. */
  qualityShare: number;
  weeks: PlanIdentityWeek[];
  phases: PlanIdentityPhase[];
}

export interface PlanIdentityWeek {
  weekIndex: number;
  targetMeters: number;
}

export interface PlanIdentityPhase {
  label: string;
  weeks: number;
}

export interface PlanIdentityWeekInput {
  weekIndex: number;
  phase?: string | null;
  targetMeters?: number | null;
  isRecovery?: boolean;
}

export interface PlanIdentityWorkoutInput {
  weekIndex?: number | null;
  type?: string | null;
  plannedDistanceMeters?: number | null;
  isQuality?: boolean;
  structure?: WorkoutStructure;
  prescribedQualityMeters?: number | null;
}

export interface PlanIdentityInput {
  name: string;
  distanceKind?: string | null;
  numWeeks?: number | null;
  weeks: readonly PlanIdentityWeekInput[];
  workouts?: readonly PlanIdentityWorkoutInput[];
}

/**
 * Derive the canonical plan-card payload from either a .due file, a normalized
 * draft, or stored rows. It is intentionally pure so native, web, and future
 * share-image renderers can all consume exactly the same numbers and shape.
 *
 * Race events are excluded from quality: a race is the destination of the
 * training, not prescribed hard-work volume. It remains part of weekly mileage
 * because the card still describes the full burden of the block.
 */
export function derivePlanIdentity(input: PlanIdentityInput): PlanIdentity {
  const ordered = [...input.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const workouts = input.workouts ?? [];
  const mileageByWeek = new Map<number, number>();
  for (const workout of workouts) {
    const weekIndex = workout.weekIndex ?? null;
    if (weekIndex == null || isNonRun(workout.type)) continue;
    mileageByWeek.set(
      weekIndex,
      (mileageByWeek.get(weekIndex) ?? 0) + Math.max(0, workout.plannedDistanceMeters ?? 0),
    );
  }

  const weeks = ordered.map((week) => ({
    weekIndex: week.weekIndex,
    targetMeters: Math.max(0, week.targetMeters ?? mileageByWeek.get(week.weekIndex) ?? 0),
  }));
  const numWeeks = Math.max(1, input.numWeeks ?? weeks.length);
  const totalMeters = weeks.reduce((sum, week) => sum + week.targetMeters, 0);
  const qualityMeters = workouts.reduce((sum, workout) => sum + trainingQualityMeters(workout), 0);

  return {
    name: input.name.trim() || 'Training block',
    distanceLabel: planDistanceLabel(input.distanceKind),
    numWeeks,
    averageWeeklyMeters: Math.round(totalMeters / numWeeks),
    peakWeeklyMeters: weeks.reduce((peak, week) => Math.max(peak, week.targetMeters), 0),
    qualityShare: totalMeters > 0 ? qualityMeters / totalMeters : 0,
    weeks,
    phases: phaseRuns(ordered),
  };
}

export function planDistanceLabel(kind?: string | null): string {
  if (kind === 'marathon') return 'Marathon';
  if (kind === 'half') return 'Half marathon';
  if (kind === '10k') return '10K';
  if (kind === '5k') return '5K';
  return 'Custom';
}

function trainingQualityMeters(workout: PlanIdentityWorkoutInput): number {
  const type = (workout.type ?? '').toLowerCase();
  if (type === 'race' || type === 'rest' || type === 'cross') return 0;
  const isQuality = workout.isQuality || type === 'quality';
  return Math.max(0, workout.prescribedQualityMeters
    ?? prescribedQualityMeters(
      workout.structure ?? [],
      isQuality ? (workout.plannedDistanceMeters ?? undefined) : undefined,
    ));
}

function isNonRun(type?: string | null): boolean {
  const normalized = (type ?? '').toLowerCase();
  return normalized === 'rest' || normalized === 'cross';
}

function phaseRuns(weeks: readonly PlanIdentityWeekInput[]): PlanIdentityPhase[] {
  const structural = weeks.map((week, index) => structuralPhaseAt(weeks, index));
  const runs: PlanIdentityPhase[] = [];
  for (const raw of structural) {
    const label = titleCase(raw || 'base');
    const previous = runs[runs.length - 1];
    if (previous?.label === label) previous.weeks += 1;
    else runs.push({ label, weeks: 1 });
  }
  return runs;
}

/** Recovery is a cutback inside a phase, not a phase that fragments the card. */
function structuralPhaseAt(weeks: readonly PlanIdentityWeekInput[], index: number): string {
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
  return 'base';
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
