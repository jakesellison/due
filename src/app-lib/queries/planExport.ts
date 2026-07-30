import { DAY_MS, noon, portableWorkoutStructure, weekStartOf } from '@/lib';
import type { DraftPlanDistanceKind, DraftWorkoutType, WorkoutStructure } from '@/lib';

import type { PlanRow, PlanWeekRow, WorkoutRow } from './rows';

/** One workout in the dateless `.due` v3 file — (week, day) offsets, no date. */
export interface RelativePlanFileWorkout {
  week: number;              // 1-based
  day: number;               // 0=Mon … 6=Sun
  type: DraftWorkoutType | undefined;
  title: string | undefined;
  plannedDistanceMeters: number | null;
  plannedDurationSeconds: number | null;
  structure: WorkoutStructure;
  notes: string | null;
}

/** One week's contract in the v3 file (relative — keyed by 1-based `week`). */
export interface RelativePlanFileWeek {
  week: number;
  phase: PlanWeekRow['phase'];
  targetMeters: number | null;
  qualityTargetMeters: number | null;
  longTargetMeters: number | null;
  isRecovery: boolean;
}

/**
 * The plain-JSON v3 "relative" plan shape — exactly what `normalizeRelativePlan`
 * accepts. Dateless: dates are re-derived at import time by anchoring.
 */
export interface RelativePlanFileJson {
  formatVersion: 3;
  source: 'import';
  plan: {
    name: string | undefined;
    distanceKind: DraftPlanDistanceKind | undefined;
    goalTimeSeconds: number | null;
    numWeeks: number | undefined;
  };
  weeks: RelativePlanFileWeek[];
  workouts: RelativePlanFileWorkout[];
  questions: string[];
}

/** Parse a Postgres interval goal time ("HH:MM:SS" / "H:MM:SS") to seconds. */
export function parseGoalIntervalSeconds(interval: string | null): number | null {
  if (!interval) return null;
  const parts = interval.split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [h, m, s] = parts.length >= 3 ? parts : [0, parts[0]!, parts[1]!];
  return Math.round(h! * 3600 + m! * 60 + (s ?? 0));
}

/**
 * Serialize a stored plan (plans + plan_weeks + workouts rows) into a dateless
 * `.due` v3 "relative" file — the reverse of the anchor+install pipeline. Each
 * workout's calendar date is folded back into a (week, day) offset relative to
 * the plan's starting Monday, so the file re-imports at ANY future date via
 * `normalizeRelativePlan` → `anchorPlan`. Structured data round-trips fully; the
 * only things not stored are the original freeform sourceText and the dates
 * themselves (which are the whole point of going relative).
 *
 * `startMonday` is the plan's start-date Monday; on a pre-migration row with no
 * start_date we fall back to the earliest workout's Monday so week 1 still lines
 * up. Workouts with no date can't be placed relatively and are dropped.
 */
export function exportPlanToRelative(
  plan: PlanRow,
  weeks: PlanWeekRow[],
  workouts: WorkoutRow[],
): RelativePlanFileJson {
  const dated = workouts.filter((wo): wo is WorkoutRow & { date: string } => !!wo.date);
  const startMonday = plan.start_date
    ? weekStartOf(plan.start_date, 'mon')
    : dated.length
      ? weekStartOf(dated.reduce((min, wo) => (wo.date < min ? wo.date : min), dated[0]!.date), 'mon')
      : null;

  const relWorkouts: RelativePlanFileWorkout[] = dated
    .map((wo) => {
      const weekMonday = weekStartOf(wo.date, 'mon');
      const week = startMonday
        ? Math.round((noon(weekMonday) - noon(startMonday)) / (7 * DAY_MS)) + 1
        : 1;
      const day = Math.round((noon(wo.date) - noon(weekMonday)) / DAY_MS);
      return {
        week,
        day,
        type: (wo.type ?? undefined) as DraftWorkoutType | undefined,
        title: wo.title ?? undefined,
        plannedDistanceMeters: wo.planned_distance_meters,
        plannedDurationSeconds: wo.planned_duration_s,
        structure: portableWorkoutStructure(wo.structure),
        notes: wo.notes,
      };
    })
    .sort((a, b) => a.week - b.week || a.day - b.day);

  return {
    formatVersion: 3,
    source: 'import',
    plan: {
      name: plan.race_name ?? undefined,
      distanceKind: (plan.distance_kind ?? undefined) as DraftPlanDistanceKind | undefined,
      goalTimeSeconds: parseGoalIntervalSeconds(plan.goal_time),
      numWeeks: plan.num_weeks ?? undefined,
    },
    weeks: weeks.map((w) => ({
      week: w.week_index,
      phase: w.phase,
      targetMeters: w.target_meters,
      qualityTargetMeters: w.quality_target_meters ?? null,
      longTargetMeters: w.long_target_meters ?? null,
      isRecovery: w.is_recovery,
    })),
    workouts: relWorkouts,
    questions: [],
  };
}

/** A filesystem-safe `<name>.due` filename for an exported plan. */
export function planDueFilename(raceName: string | null | undefined): string {
  const base = (raceName ?? 'plan').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
  return `${base}.due`;
}
