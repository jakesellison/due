import { useMemo } from 'react';

import {
  assignMatches,
  summarizeBlock,
  type BlockSummary,
  type SummaryActivityInput,
  type SummaryWeekInput,
  type SummaryWorkoutInput,
  type WeeklyBar,
} from '@/lib';

import { useActivePlan } from './activePlan';
import { useActivities, type DateRange } from './activities';
import { addDays, todayLocal, WEEK_START } from './internal';
import type { ActivePlan, ActivityRow, PlanRow, WorkoutRow } from './rows';

// ---- Plan screen view ------------------------------------------------------

/** The actuals attributed to a single planned workout (via `assignMatches`). */
export interface DayActual {
  /** Summed activity distance for the workout's date (meters). */
  distanceMeters: number;
  /** Total moving time across the day's activities (seconds), if known. */
  movingTimeS: number | null;
  /** Average HR across the day's activities (meters-weighted ≈ simple avg). */
  avgHr: number | null;
}

/** A single day row inside a Plan week section. */
export interface PlanDay {
  workout: WorkoutRow;
  /** Matched/same-day actual, when any activity fell on this date. */
  actual: DayActual | null;
  /** True iff this workout's date is strictly before today (a settled day). */
  isPast: boolean;
  /** A planned (non-rest) workout in the past with no activity = missed. */
  isMissed: boolean;
}

/**
 * A run the user logged that has NO planned workout on its date (doubles / extra
 * days). Rendered as a quieter row — the Strava activity name in the title slot,
 * its actual distance on the right — that opens the standalone activity detail.
 */
export interface UnplannedRun {
  activityId: string;
  /** Civil date 'YYYY-MM-DD'. */
  localDate: string;
  /** UTC ISO instant of the start (for same-day ordering). */
  startDate: string | null;
  /** Strava name (e.g. "Lunch Run"); falls back to "Run". */
  name: string;
  /** Activity distance (meters). */
  distanceMeters: number;
}

/** One week section in the Plan list. */
export interface PlanWeekSection {
  weekId: string;
  weekIndex: number;
  weekStart: string;
  /** The derived bar (target/actual/band/isCurrent/isFuture) for this week. */
  bar: WeeklyBar | null;
  /** Run rows for display (rest days excluded). */
  days: PlanDay[];
  /**
   * The FULL week including rest-day rows (real workout ids). Used by the week
   * editor so every day shows and a rest day is a real drag drop-target.
   * Optional only so older test fixtures stay valid; planView always sets it.
   */
  editableDays?: PlanDay[];
  /** Runs in this week with no matching planned workout (doubles / extra days). */
  unplanned: UnplannedRun[];
  /** The immutable original target before any adaptations (null if unknown). */
  originalTargetMeters?: number | null;
  /** Stored supporting contracts. Null only for legacy rows. */
  qualityTargetMeters?: number | null;
  longTargetMeters?: number | null;
}

export interface PlanView {
  loading: boolean;
  error: Error | null;
  plan: PlanRow | null;
  sections: PlanWeekSection[];
  /** Index into `sections` of the current week (for auto-scroll). -1 if none. */
  currentIndex: number;
  today: string;
}

/** Shared loader: active plan + activities over its span, with a date range. */
export function usePlanAndActivities(userId: string | null) {
  const today = todayLocal();
  const planQ = useActivePlan(userId);
  const plan = planQ.data?.plan ?? null;

  const range: DateRange | null = useMemo(() => {
    if (!plan?.start_date || !plan.num_weeks) {
      return { from: addDays(today, -8 * 7), to: today };
    }
    return { from: plan.start_date, to: addDays(plan.start_date, plan.num_weeks * 7) };
  }, [plan?.start_date, plan?.num_weeks, today]);

  const activitiesQ = useActivities(userId, range);
  const error =
    (planQ.error as Error | null) ?? (activitiesQ.error as Error | null) ?? null;
  const loading = planQ.isLoading || (planQ.data != null && activitiesQ.isLoading);
  return { today, plan, planQ, activitiesQ, loading, error };
}

/** Build the per-week `WeeklyBar` summary from a loaded active plan + activities. */
export function buildSummary(
  planData: ActivePlan | null | undefined,
  activities: ActivityRow[] | undefined,
  today: string,
): BlockSummary | null {
  if (!planData) return null;
  const startDate = planData.plan.start_date;
  if (!startDate) return null;
  const weekInputs: SummaryWeekInput[] = planData.weeks.map((w) => ({
    weekIndex: w.week_index,
    phase: w.phase,
    // Derive the week's start from its week_index (1-based: week 1 is the
    // plan-start week → startDate + (week_index − 1)*7), not its array position,
    // so a missing or out-of-order week still lands on the right calendar date.
    weekStart: addDays(startDate, (w.week_index - 1) * 7),
    targetMeters: w.target_meters ?? 0,
    isRecovery: w.is_recovery,
  }));
  const workoutInputs: SummaryWorkoutInput[] = planData.workouts
    .filter((w) => !!w.date)
    .map((w) => ({ date: w.date as string, isQuality: w.is_quality }));
  const activityInputs: SummaryActivityInput[] = (activities ?? [])
    .filter((a) => !!a.local_date && a.distance_meters != null)
    .map((a) => ({
      localDate: a.local_date as string,
      distanceMeters: a.distance_meters as number,
    }));
  return summarizeBlock(weekInputs, workoutInputs, activityInputs, today, {
    weekStart: WEEK_START,
  });
}

/**
 * The Plan screen's derived view: one section per plan week (with its banded
 * `WeeklyBar`), each holding its day rows. Each non-rest workout day carries any
 * same-day actual, attributed via the shared `assignMatches` domain function
 * (no bespoke matching here), plus `isMissed` for past planned days with no run.
 */
export function usePlanView(userId: string | null): PlanView {
  const { today, plan, planQ, activitiesQ, loading, error } =
    usePlanAndActivities(userId);

  const summary = useMemo(
    () => buildSummary(planQ.data, activitiesQ.data, today),
    [planQ.data, activitiesQ.data, today],
  );

  const sections = useMemo<PlanWeekSection[]>(() => {
    if (!planQ.data?.plan.start_date) return [];
    const { weeks, workouts, plan: p } = planQ.data;
    const startDate = p.start_date as string;
    const activities = activitiesQ.data ?? [];

    // Attribute activities to workouts by civil date (reused domain function).
    const dated = workouts.filter((w) => !!w.date);
    const assign = assignMatches(
      dated.map((w) => ({
        workoutId: w.id,
        localDate: w.date as string,
        isQuality: w.is_quality,
        plannedMeters: w.planned_distance_meters ?? 0,
      })),
      activities
        .filter((a) => !!a.local_date && a.distance_meters != null)
        .map((a) => ({
          activityId: a.id,
          localDate: a.local_date as string,
          distanceMeters: a.distance_meters as number,
        })),
    );
    const activityById = new Map(activities.map((a) => [a.id, a]));
    const barByIndex = new Map((summary?.weeks ?? []).map((b) => [b.weekIndex, b]));

    // The unplanned activities (no planned workout on their date), as quiet rows.
    const unplannedIds = new Set(assign.unplannedActivityIds);
    const sortedWeeks = [...weeks].sort((a, b) => a.week_index - b.week_index);

    return sortedWeeks.map((w) => {
      // Key the week's start on its week_index (1-based → (week_index − 1)*7),
      // not its array position, so a missing/out-of-order week still maps to the
      // right calendar week.
      const weekStart = addDays(startDate, (w.week_index - 1) * 7);
      const weekEnd = addDays(weekStart, 7); // exclusive upper bound
      // Build the FULL week first (rest rows included), then derive the
      // display `days` by dropping rest. The editor uses `editableDays` so a
      // rest day is a real, draggable drop-target with its own workout id.
      const weekWorkouts = workouts
        .filter((wo) => wo.week_id === w.id)
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
      const editableDays: PlanDay[] = weekWorkouts.map((wo) => {
        const roll = assign.byWorkout[wo.id];
        const actual: DayActual | null = roll
          ? aggregateActual(roll.activityIds, activityById)
          : null;
        const isPast = !!wo.date && wo.date < today;
        // A rest day is never "missed" (nothing was planned to run).
        const isMissed = isPast && actual == null && wo.type !== 'rest';
        return { workout: wo, actual, isPast, isMissed };
      });
      const days: PlanDay[] = editableDays.filter((d) => d.workout.type !== 'rest');
      const unplanned: UnplannedRun[] = activities
        .filter(
          (a) =>
            unplannedIds.has(a.id) &&
            !!a.local_date &&
            (a.local_date as string) >= weekStart &&
            (a.local_date as string) < weekEnd,
        )
        .map((a) => toUnplannedRun(a))
        .sort(byDateThenStart);
      return {
        weekId: w.id,
        weekIndex: w.week_index,
        weekStart,
        bar: barByIndex.get(w.week_index) ?? null,
        days,
        editableDays,
        unplanned,
        originalTargetMeters: w.original_target_meters ?? null,
        qualityTargetMeters: w.quality_target_meters ?? null,
        longTargetMeters: w.long_target_meters ?? null,
      };
    });
  }, [planQ.data, activitiesQ.data, summary, today]);

  const currentIndex = useMemo(
    () => sections.findIndex((s) => s.bar?.isCurrent),
    [sections],
  );

  return { loading, error, plan, sections, currentIndex, today };
}

/** Map an activity row into the quiet unplanned-run row shape. */
function toUnplannedRun(a: ActivityRow): UnplannedRun {
  return {
    activityId: a.id,
    localDate: a.local_date as string,
    startDate: a.start_date,
    name: a.name && a.name.trim().length > 0 ? a.name : 'Run',
    distanceMeters: a.distance_meters ?? 0,
  };
}

/** Sort unplanned runs by civil date, then by UTC start instant within the day. */
function byDateThenStart(a: UnplannedRun, b: UnplannedRun): number {
  if (a.localDate !== b.localDate) return a.localDate.localeCompare(b.localDate);
  return (a.startDate ?? '').localeCompare(b.startDate ?? '');
}

/** Sum/aggregate the day's activities into a single DayActual. */
export function aggregateActual(
  activityIds: string[],
  byId: Map<string, ActivityRow>,
): DayActual {
  let distanceMeters = 0;
  let movingTimeS = 0;
  let haveMoving = false;
  let hrWeighted = 0;
  let hrWeight = 0;
  for (const id of activityIds) {
    const a = byId.get(id);
    if (!a) continue;
    distanceMeters += a.distance_meters ?? 0;
    if (a.moving_time_s != null) {
      movingTimeS += a.moving_time_s;
      haveMoving = true;
    }
    if (a.avg_hr != null) {
      const w = a.distance_meters ?? 1;
      hrWeighted += a.avg_hr * w;
      hrWeight += w;
    }
  }
  return {
    distanceMeters,
    movingTimeS: haveMoving ? movingTimeS : null,
    avgHr: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null,
  };
}
