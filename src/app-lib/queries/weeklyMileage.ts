import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  assignMatches,
  buildWeekDays,
  summarizeBlock,
  weekDayBars,
  weekStartOf,
  weekStripDays,
  goalStat,
  GOAL_GATES,
  deriveSupportingContractTargets,
  longestContinuousActivityMeters,
  type BlockSummary,
  type CalendarDay,
  type SparkSummary,
  type WeekGoal,
  type SummaryActivityInput,
  type SummaryWeekInput,
  type SummaryWorkoutInput,
  type WeekStripDay,
} from '@/lib';

import {
  blendWeekQuality,
  computeEasyBaselineSecPerMi,
  detectWeekQuality,
  qualityDayFallbackMeters,
  readQualityOverrides,
} from '../qualityCredit';
import { prescribedQualityMeters } from '@/lib';
import { useActivePlan } from './activePlan';
import { qualityOverridesKey } from './cache';
import { useActivities, type DateRange } from './activities';
import { addDays, planWindowOf, todayLocal, WEEK_START } from './internal';
import type { ActivityRow, PlanRow, WorkoutRow } from './rows';

export interface TodayWorkout extends WorkoutRow {
  /** True when this planned workout has at least one matched activity. */
  completed: boolean;
}

export interface TodayActivity {
  /** Total distance logged today (sum of all activities on today's date). */
  distanceMeters: number;
  /**
   * Quality recognition note from stream detection, e.g. "quality (4×2mi)".
   * Null when today's run was not detected as quality.
   */
  qualityNote: string | null;
}

export interface WeeklyMileage {
  loading: boolean;
  /** Existing data is visible while one of its sources refreshes in place. */
  updating: boolean;
  error: Error | null;
  plan: PlanRow | null;
  summary: BlockSummary | null;
  /** The Week Sparkbars (consistency) derivation for the last 4 weeks. */
  spark: SparkSummary | null;
  /** Per-week attainment of the three goals (mileage/quality/long) — the goal-rings trend. */
  weekGoals: WeekGoal[];
  /** Today's workout(s), if any planned for the current civil date. */
  todayWorkouts: TodayWorkout[];
  /**
   * Today's logged activity summary (null when no run logged today yet).
   * Derived from activities whose local_date === today.
   */
  todayActivity: TodayActivity | null;
  /** The seven Mon→Sun chips for the current week's Dash strip. */
  weekStrip: WeekStripDay[];
  /** The current week's 1-based plan index (for the strip header link). -1 if none. */
  currentWeekIndex: number;
  /** Runner's easy-pace baseline (sec/mi) — for the Today cell's time estimate. */
  easyBaseline: number;
  today: string;
  /** The current civil week (Mon→Sun) as calendar-tab day models. */
  weekDays: CalendarDay[];
  /** Build day models for an arbitrary week (paging) — pass any date in the target week. */
  weekDaysFor: (anchorDate: string) => CalendarDay[];
  /** Monday (YYYY-MM-DD) of the current civil week. */
  currentWeekStart: string;
  /**
   * IDs of the activities THIS derivation's `weekGoals` counted for the
   * current week. `weekGoals` and the Dash's "just banked" card
   * (`useJustBanked`) read from two DIFFERENT `useActivities` query instances
   * (different date ranges → different cache entries), so a background
   * refetch can update one before the other. Callers use this set to tell
   * whether a specific just-banked run has actually landed in `weekGoals` yet
   * — i.e. whether the milestone verdict for that run is decided — rather
   * than assuming the two queries are always in lockstep (see the
   * run-completion-moment review, Fix 2).
   */
  currentWeekActivityIds: Set<string>;
}

/**
 * The derived view the Dash renders from. Combines the active plan and the
 * user's activities, mapping plan-week start dates, then runs `summarizeBlock`
 * entirely in memory. Returns the weekly chart array, current-week KPI values
 * and heatmap cells, plus today's workout.
 */
export function useWeeklyMileage(userId: string | null): WeeklyMileage {
  const today = todayLocal();
  const planQ = useActivePlan(userId);
  const plan = planQ.data?.plan ?? null;

  // Pull activities for the whole plan span (or a sensible window) so both the
  // weekly bars and the heatmap have data.
  const range: DateRange | null = useMemo(() => {
    if (!plan?.start_date || !plan.num_weeks) {
      // Fall back to the trailing ~8 weeks if the plan dates are missing.
      return { from: addDays(today, -8 * 7), to: today };
    }
    const from = plan.start_date;
    const to = addDays(plan.start_date, plan.num_weeks * 7);
    return { from, to };
  }, [plan?.start_date, plan?.num_weeks, today]);

  const activitiesQ = useActivities(userId, range);

  const summary = useMemo<BlockSummary | null>(() => {
    if (!planQ.data) return null;
    const { weeks, workouts } = planQ.data;
    const startDate = planQ.data.plan.start_date;
    if (!startDate) return null;

    const weekInputs: SummaryWeekInput[] = weeks.map((w) => ({
      weekIndex: w.week_index,
      phase: w.phase,
      weekStart: addDays(startDate, (w.week_index - 1) * 7),
      targetMeters: w.target_meters ?? 0,
      isRecovery: w.is_recovery,
    }));

    const workoutInputs: SummaryWorkoutInput[] = workouts
      .filter((w) => !!w.date)
      .map((w) => ({ date: w.date as string, isQuality: w.is_quality }));

    const activityInputs: SummaryActivityInput[] = (activitiesQ.data ?? [])
      .filter((a) => !!a.local_date && a.distance_meters != null)
      .map((a) => ({
        localDate: a.local_date as string,
        distanceMeters: a.distance_meters as number,
      }));

    return summarizeBlock(weekInputs, workoutInputs, activityInputs, today, {
      weekStart: WEEK_START,
    });
  }, [planQ.data, activitiesQ.data, today]);

  const spark = useMemo<SparkSummary | null>(() => {
    if (!planQ.data) return null;
    const { weeks, workouts } = planQ.data;
    const startDate = planQ.data.plan.start_date;
    if (!startDate) return null;

    const weekInputs: SummaryWeekInput[] = weeks.map((w) => ({
      weekIndex: w.week_index,
      phase: w.phase,
      weekStart: addDays(startDate, (w.week_index - 1) * 7),
      targetMeters: w.target_meters ?? 0,
      isRecovery: w.is_recovery,
    }));
    const workoutInputs: SummaryWorkoutInput[] = workouts
      .filter((w) => !!w.date)
      .map((w) => ({
        date: w.date as string,
        isQuality: w.is_quality,
        type: w.type ?? undefined,
      }));
    const activityInputs: SummaryActivityInput[] = (activitiesQ.data ?? [])
      .filter((a) => !!a.local_date && a.distance_meters != null)
      .map((a) => ({
        localDate: a.local_date as string,
        distanceMeters: a.distance_meters as number,
      }));

    return weekDayBars(weekInputs, workoutInputs, activityInputs, today, {
      weekStart: WEEK_START,
      planWindow: planWindowOf(planQ.data),
    });
  }, [planQ.data, activitiesQ.data, today]);

  const todayWorkouts = useMemo<TodayWorkout[]>(() => {
    if (!planQ.data) return [];
    const workouts = planQ.data.workouts.filter((w) => w.date === today && w.type !== 'rest');
    if (workouts.length === 0) return [];
    const assign = assignMatches(
      workouts.map((w) => ({
        workoutId: w.id,
        localDate: today,
        isQuality: w.is_quality,
        plannedMeters: w.planned_distance_meters ?? 0,
      })),
      (activitiesQ.data ?? [])
        .filter((a) => a.local_date === today && a.distance_meters != null)
        .map((a) => ({
          activityId: a.id,
          localDate: today,
          distanceMeters: a.distance_meters as number,
        })),
    );
    return workouts.map((w) => ({ ...w, completed: assign.byWorkout[w.id] != null }));
  }, [planQ.data, activitiesQ.data, today]);

  // The Dash week strip — seven Mon→Sun chips for the week containing today.
  const weekStrip = useMemo<WeekStripDay[]>(() => {
    if (!planQ.data) return [];
    const workouts = planQ.data.workouts
      .filter((w) => !!w.date)
      .map((w) => ({
        id: w.id,
        date: w.date as string,
        type: w.type ?? 'easy',
        plannedMeters: w.planned_distance_meters ?? 0,
        isQuality: w.is_quality,
      }));
    const activities = (activitiesQ.data ?? [])
      .filter((a) => !!a.local_date && a.distance_meters != null)
      .map((a) => ({
        id: a.id,
        localDate: a.local_date as string,
        distanceMeters: a.distance_meters as number,
      }));
    return weekStripDays(workouts, activities, today, { weekStart: WEEK_START });
  }, [planQ.data, activitiesQ.data, today]);

  const currentWeekIndex = summary?.current?.weekIndex ?? -1;

  // ── Detected-quality credit for the current week's KPI tile ─────────────────
  //
  // `summarizeBlock` credits qualityCompleted when an activity falls on the same
  // date as the planned quality workout. Detection also credits quality sessions
  // found on ANY day of the week via stream analysis (e.g. a quality run done on
  // a non-quality-planned day). We augment the summary's current-week count here.

  // Current-week date bounds (null when no current week in summary).
  const currentWeekBounds = useMemo(() => {
    if (!summary?.current) return null;
    const startDate = planQ.data?.plan.start_date;
    if (!startDate) return null;
    const weekStart = addDays(startDate, (summary.current.weekIndex - 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    return { weekStart, weekEnd };
  }, [summary?.current?.weekIndex, planQ.data?.plan.start_date]);

  // Current-week activities (those whose local_date falls in the current week).
  const currentWeekActivities = useMemo<ActivityRow[]>(() => {
    if (!currentWeekBounds) return [];
    const { weekStart, weekEnd } = currentWeekBounds;
    return (activitiesQ.data ?? []).filter(
      (a) => !!a.local_date && a.local_date >= weekStart && a.local_date <= weekEnd,
    );
  }, [activitiesQ.data, currentWeekBounds]);

  // Easy baseline: derived from ALL plan-span activities + workouts (sync).
  const easyBaseline = useMemo(() => {
    const workouts = planQ.data?.workouts ?? [];
    return computeEasyBaselineSecPerMi(activitiesQ.data ?? [], workouts);
  }, [activitiesQ.data, planQ.data?.workouts]);

  // AsyncStorage overrides for current-week activity IDs.
  //
  // The query key is stable per plan + week range (NOT the activity-id set):
  // the IDs flow through the queryFn closure, so the override read stays
  // correct, but the cache entry is reused across renders and the set of
  // entries can't grow without bound. `plan?.id` + the week bounds uniquely
  // identify the lookup; cache.ts invalidates the same shape.
  // Exposed set (see `WeeklyMileage.currentWeekActivityIds`) — membership
  // check for whether a specific run has landed in THIS week's numbers yet.
  // The `.map` is inlined here (rather than read from a separately-memoized
  // list) so this can depend on `currentWeekActivities` alone, with nothing
  // else read from outside the callback — no exhaustive-deps suppression needed.
  const currentWeekActivityIds = useMemo(
    () => new Set(currentWeekActivities.map((a) => a.id)),
    [currentWeekActivities],
  );
  const overridesQ = useQuery<Set<string>>({
    queryKey: qualityOverridesKey(
      plan?.id,
      currentWeekBounds?.weekStart,
      currentWeekBounds?.weekEnd,
    ),
    enabled: currentWeekActivities.length > 0,
    queryFn: () => readQualityOverrides(currentWeekActivities.map((a) => a.id)),
    staleTime: 0,
  });

  // Detected-quality result for the current week (sync, pure).
  const detectedResult = useMemo(() => {
    const overrides = overridesQ.data ?? new Set<string>();
    // Locate the planned quality workout for the current week, if any.
    let qualityWorkout: {
      id: string;
      structure: WorkoutRow['structure'];
      plannedDistanceMeters?: number | null;
      prescribedQualityMeters?: number | null;
    } | null = null;
    if (currentWeekBounds && planQ.data) {
      const { weekStart, weekEnd } = currentWeekBounds;
      const qw = planQ.data.workouts.find(
        (w) => w.is_quality && w.date != null && w.date >= weekStart && w.date <= weekEnd,
      );
      if (qw) qualityWorkout = {
        id: qw.id,
        structure: qw.structure,
        plannedDistanceMeters: qw.planned_distance_meters,
        prescribedQualityMeters: qw.prescribed_quality_meters,
      };
    }
    return detectWeekQuality(currentWeekActivities, qualityWorkout, overrides);
  }, [currentWeekActivities, overridesQ.data, currentWeekBounds, planQ.data]);

  // The long-run KPI for the current week: prescribed comes from the STORED
  // weekly contract, completed is the longest SINGLE activity banked this week.
  // Several runs on one date count toward mileage but never combine into a long
  // run. The derivation fallback exists only for pre-migration rows.
  const longResult = useMemo<{ plannedMeters: number; completedMeters: number }>(() => {
    if (!currentWeekBounds || !planQ.data || !summary?.current) {
      return { plannedMeters: 0, completedMeters: 0 };
    }
    const { weekStart, weekEnd } = currentWeekBounds;
    const weekWorkouts = planQ.data.workouts.filter(
      (w) => w.date != null && w.date >= weekStart && w.date <= weekEnd && w.type !== 'rest',
    );
    const storedWeek = planQ.data.weeks.find(
      (week) => week.week_index === summary.current!.weekIndex,
    );
    const fallback = deriveSupportingContractTargets(weekWorkouts.map((workout) => ({
      type: workout.type,
      isQuality: workout.is_quality,
      plannedDistanceMeters: workout.planned_distance_meters,
      structure: workout.structure,
      prescribedQualityMeters: workout.prescribed_quality_meters,
    })));
    const plannedMeters = storedWeek?.long_target_meters ?? fallback.longTargetMeters;
    const completedMeters = longestContinuousActivityMeters(
      currentWeekActivities.map((activity) => ({ distanceMeters: activity.distance_meters })),
    );
    return { plannedMeters, completedMeters };
  }, [currentWeekBounds, planQ.data, currentWeekActivities, summary?.current]);

  const currentQualityTargetMeters = useMemo(() => {
    if (!planQ.data || !summary?.current) return 0;
    const storedWeek = planQ.data.weeks.find(
      (week) => week.week_index === summary.current!.weekIndex,
    );
    return storedWeek?.quality_target_meters ?? detectedResult.prescribedQualityMeters;
  }, [planQ.data, summary?.current, detectedResult.prescribedQualityMeters]);

  // Patch the summary: if stream detection found a quality session, ensure
  // qualityCompleted ≥ 1 (without doubling existing plan-based credit). Also fold
  // in the on-the-fly quality DISTANCE and the long-run KPI.
  const augmentedSummary = useMemo<BlockSummary | null>(() => {
    if (!summary) return null;
    if (!summary.current) return summary;
    // Detection credits a quality session found on any day (without doubling the
    // plan-based heuristic), AND surfaces the detected/prescribed quality DISTANCE
    // that the detector already computes — the Dash "X / Y mi" tile (always set,
    // even when below the sufficiency gate, so a partial reads correctly).
    const qualityCompleted = detectedResult.qualityDetected
      ? Math.max(1, summary.current.qualityCompleted)
      : summary.current.qualityCompleted;
    return {
      ...summary,
      current: {
        ...summary.current,
        qualityCompleted,
        qualityMetersCompleted: detectedResult.detectedQualityMeters,
        qualityMetersPlanned: currentQualityTargetMeters,
        longMetersPlanned: longResult.plannedMeters,
        longMetersCompleted: longResult.completedMeters,
      },
    };
  }, [summary, detectedResult, longResult, currentQualityTargetMeters]);

  // ── Per-week goal attainment (the goal-rings capstone) ──────────────────────
  //
  // For EVERY plan week, compute each goal's actual vs target: mileage (all miles
  // vs week target), long (longest run vs planned long, any day counts), quality
  // (detected quality distance vs prescribed — the same stream detection the
  // gauge uses, per week). Future weeks are empty rings. Quality FALLBACK: some
  // activities genuinely have no streams (manual entries, some devices), so a
  // real quality session would falsely read "missed" — if the prescribed quality
  // day was run by a PROVEN-streamless activity (enrich attempted, no streams;
  // see qualityDayFallbackMeters), credit the prescribed distance. Rows whose
  // enrichment is still pending contribute NO credit — their verdict credits
  // when it lands (issue #139: an easy run on the quality day must not bank the
  // ring while the MISSED verdict is in flight).
  const weekGoals = useMemo<WeekGoal[]>(() => {
    if (!planQ.data || !summary) return [];
    const startDate = planQ.data.plan.start_date;
    if (!startDate) return [];
    const ordered = [...planQ.data.weeks].sort((a, b) => a.week_index - b.week_index);
    const barByIndex = new Map(summary.weeks.map((week) => [week.weekIndex, week]));
    const acts = (activitiesQ.data ?? []).filter((a) => !!a.local_date && a.distance_meters != null);
    const wos = planQ.data.workouts.filter((w) => w.date != null && w.type !== 'rest');
    const out: WeekGoal[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const wk = ordered[i]!;
      const bar = barByIndex.get(wk.week_index);
      const isCurrent = bar?.isCurrent ?? false;
      const isFuture = bar?.isFuture ?? false;
      const weekStart = addDays(startDate, (wk.week_index - 1) * 7);
      const weekEnd = addDays(weekStart, 6);
      const weekActs = isFuture
        ? []
        : acts.filter((a) => (a.local_date as string) >= weekStart && (a.local_date as string) <= weekEnd);
      const mileageActual = weekActs.reduce((s, a) => s + (a.distance_meters ?? 0), 0);
      const longActual = longestContinuousActivityMeters(
        weekActs.map((activity) => ({ distanceMeters: activity.distance_meters })),
      );
      const weekWos = wos.filter(
        (w) => (w.date as string) >= weekStart && (w.date as string) <= weekEnd,
      );
      const fallbackTargets = deriveSupportingContractTargets(weekWos.map((workout) => ({
        type: workout.type,
        isQuality: workout.is_quality,
        plannedDistanceMeters: workout.planned_distance_meters,
        structure: workout.structure,
        prescribedQualityMeters: workout.prescribed_quality_meters,
      })));
      const longTarget = wk.long_target_meters ?? fallbackTargets.longTargetMeters;
      // Quality banks wherever it appears: prescribed = Σ hard-miles across ALL
      // week workouts (intervals + embedded MP/tempo blocks in long/easy runs);
      // actual = Σ detected hard-miles across ALL week activities. The long run's
      // full distance still counts toward long/mileage — different goals.
      const qw = weekWos.find((w) => w.is_quality); // primary tagged session (streamless fallback)
      const blend = isFuture
        ? { prescribedMeters: fallbackTargets.qualityTargetMeters, detectedMeters: 0 }
        : blendWeekQuality(
            weekWos.map((w) => ({
              structure: w.structure,
              plannedTotalMeters: w.is_quality ? w.planned_distance_meters : null,
              prescribedQualityMeters: w.prescribed_quality_meters,
            })),
            weekActs,
            new Set<string>(),
          );
      // Fallback: the tagged quality day was run by a proven-streamless activity
      // (effort can't be judged) -> credit its prescribed distance.
      const qualityActual = Math.max(
        blend.detectedMeters,
        qualityDayFallbackMeters(
          weekActs,
          qw?.date ?? null,
          qw
            ? qw.prescribed_quality_meters
              ?? prescribedQualityMeters(qw.structure ?? [], qw.planned_distance_meters ?? undefined)
            : 0,
          easyBaseline,
        ),
      );
      const mileage = goalStat(mileageActual, wk.target_meters ?? 0, GOAL_GATES.mileage);
      const qualityTarget = wk.quality_target_meters ?? fallbackTargets.qualityTargetMeters;
      const quality = goalStat(qualityActual, qualityTarget, GOAL_GATES.quality);
      const long = goalStat(longActual, longTarget, GOAL_GATES.long);
      out.push({
        weekIndex: wk.week_index,
        weekStart,
        label: `${wk.week_index}`,
        isCurrent,
        isFuture,
        mileage,
        quality,
        long,
        allMet: !isFuture && mileage.hit && quality.hit && long.hit,
      });
    }
    return out;
  }, [planQ.data, activitiesQ.data, summary]);

  // Today's activity summary: total distance + quality note from stream detection.
  const todayActivity = useMemo<TodayActivity | null>(() => {
    const todayActs = (activitiesQ.data ?? []).filter(
      (a) => a.local_date === today && a.distance_meters != null,
    );
    if (todayActs.length === 0) return null;
    const distanceMeters = todayActs.reduce((s, a) => s + (a.distance_meters as number), 0);
    // Quality note: use the current-week detection result if the best activity
    // for the week ran today.
    const qualityNote =
      detectedResult.qualityDetected &&
      detectedResult.bestActivityId != null &&
      todayActs.some((a) => a.id === detectedResult.bestActivityId)
        ? (detectedResult.matchNote ?? null)
        : null;
    return { distanceMeters, qualityNote };
  }, [activitiesQ.data, today, detectedResult]);

  const error =
    (planQ.error as Error | null) ?? (activitiesQ.error as Error | null) ?? null;

  // ── Calendar-tab day models ─────────────────────────────────────────────────
  //
  // `weekDaysFor` is a stable callback so the UI can page to adjacent weeks
  // without issuing new queries — it closes over the already-fetched plan +
  // activities data. `weekDays` is the current week (anchored to today).
  const weekDaysFor = useCallback(
    (anchorDate: string): CalendarDay[] => {
      if (!planQ.data) return [];
      return buildWeekDays({
        workouts: planQ.data.workouts.map((w) => ({
          id: w.id,
          date: w.date,
          type: w.type,
          title: w.title,
          is_quality: w.is_quality,
          structure: w.structure,
          planned_distance_meters: w.planned_distance_meters,
          prescribed_quality_meters: w.prescribed_quality_meters,
        })),
        activities: (activitiesQ.data ?? []).map((a) => ({
          id: a.id,
          local_date: a.local_date,
          distance_meters: a.distance_meters,
          // Moving time → the day's actual pace in the plan-vs-actual ledger.
          moving_time_s: a.moving_time_s,
          // Start instant → time-of-day label + ascending sort for the per-run
          // rows on a completed (double/triple) day.
          start_date: a.start_date,
          // The intrinsic per-run verdict, so a QUALITY day's success seal is
          // gated on effort detection (issue #139) — a distance/day match
          // alone stays neutral (no seal), and a pending verdict is neutral.
          qualityDetected: a.stream_summary?.quality?.isQuality ?? null,
          // The precomputed ACTUAL-shape bar — the Dash card draws what was run
          // on a completed day. Null pre-v5 → the prescription bar as fallback.
          actualBar: a.stream_summary?.quality?.actualBar ?? null,
        })),
        today,
        weekStartDate: anchorDate,
        // Overrides are loaded for the CURRENT week (the only week whose seal
        // can flip live); other weeks' ids simply won't be in the set.
        qualityOverrides: overridesQ.data,
      });
    },
    [planQ.data, activitiesQ.data, today, overridesQ.data],
  );

  const weekDays = useMemo(() => weekDaysFor(today), [weekDaysFor, today]);
  const currentWeekStart = useMemo(() => weekStartOf(today, WEEK_START), [today]);

  return {
    loading: planQ.isLoading || (planQ.data != null && activitiesQ.isLoading),
    updating: planQ.isFetching || activitiesQ.isFetching || overridesQ.isFetching,
    error,
    plan,
    summary: augmentedSummary,
    spark,
    weekGoals,
    todayWorkouts,
    todayActivity,
    weekStrip,
    currentWeekIndex,
    easyBaseline,
    today,
    weekDays,
    weekDaysFor,
    currentWeekStart,
    currentWeekActivityIds,
  };
}
