import { useEffect, useMemo } from 'react';

import {
  addDays,
  predictRace,
  predictionSeries,
  weekStartOf,
  type PredictActivity,
  type PredictionSeriesPoint,
  type RacePrediction,
  type RangeKey,
} from '@/lib';

import { maybeLogPredictionSnapshot } from '../snapshots';
import { useActivePlan } from './activePlan';
import { dedupeActivityRows, useRangeActivities } from './insightsView';
import { todayLocal, WEEK_START } from './internal';
import type { PlanRow } from './rows';

// ---- Race prediction (Trends) ----------------------------------------------

/**
 * Race-distance kind → target metres (defaults to the marathon).
 *
 * Values are INTEGER metres on purpose: `target_meters` is an INTEGER column and
 * it is part of the snapshot dedup key (user_id, snapshot_date, target_meters).
 * The half marathon's true 21097.5 m would be rounded to 21097 by the DB, so the
 * app-side dedup key (21097.5) would never match the stored row → duplicate
 * snapshots every day. Round at the source so the app value equals the stored
 * value. (Marathon 42195, 10k, 5k are already integers.)
 */
const DISTANCE_KIND_METERS: Record<string, number> = {
  marathon: 42195,
  half: 21097, // 21097.5 m rounded down to match the INTEGER target_meters column
  '10k': 10000,
  '5k': 5000,
};

/**
 * Parse a Postgres `interval` goal time ("02:36:00" / "2:36:00" / "0:48:00")
 * into total seconds, or null when missing/unparseable.
 */
export function parseGoalSeconds(interval: string | null | undefined): number | null {
  if (!interval) return null;
  const m = interval.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] != null ? Number(m[3]) : 0;
  if ([h, min, sec].some((v) => Number.isNaN(v))) return null;
  return h * 3600 + min * 60 + sec;
}

/** One distance's current estimate + its improvement vs ~4 weeks ago. */
export interface DistanceEstimate {
  meters: number;
  label: string;
  /** Current predicted finish, seconds (null when not predictable yet). */
  seconds: number | null;
}

/** Canonical race distances for the multi-distance outlook table. */
const RACE_DISTANCES: { meters: number; label: string }[] = [
  { meters: 5000, label: '5K' },
  { meters: 10000, label: '10K' },
  { meters: 21097, label: 'Half' },
  { meters: 42195, label: 'Marathon' },
];

export interface RacePredictionView {
  loading: boolean;
  error: Error | null;
  plan: PlanRow | null;
  /** Today's blended prediction, or null when there isn't enough signal yet. */
  prediction: RacePrediction | null;
  /** Per-distance current estimate + 4-week improvement (5K / 10K / Half / Marathon). */
  byDistance: DistanceEstimate[];
  /** Prediction at each completed week across the range window (for the trendline). */
  series: PredictionSeriesPoint[];
  /** Goal finish time in seconds (active plan `goal_time`), or null. */
  goalSeconds: number | null;
  /** Target race distance in metres (from the plan's distance_kind). */
  targetMeters: number;
  /** The active range (4W / 12W / All) this view reflects. */
  range: RangeKey;
  today: string;
}

/**
 * Every completed Monday–Sunday week in the requested horizon. Empty weeks are
 * deliberate evidence: removing them would compress calendar time and make a
 * layoff look like an uninterrupted trend.
 */
export function completedPredictionWeekStarts(
  localDates: (string | null | undefined)[],
  today: string,
  options: { completedWeeks?: number; from?: string } = {},
): string[] {
  const currentWeekStart = weekStartOf(today, WEEK_START);
  if (options.completedWeeks != null) {
    const count = Math.max(0, Math.floor(options.completedWeeks));
    return Array.from({ length: count }, (_, index) =>
      addDays(currentWeekStart, -(count - index) * 7));
  }
  const observed = [...new Set(
    localDates
      .filter((date): date is string => !!date)
      .map((date) => weekStartOf(date, WEEK_START)),
  )].filter((weekStart) => weekStart < currentWeekStart).sort();
  const first = options.from ? weekStartOf(options.from, WEEK_START) : observed[0];
  if (!first || first >= currentWeekStart) return [];
  const weeks: string[] = [];
  for (let weekStart = first; weekStart < currentWeekStart; weekStart = addDays(weekStart, 7)) {
    weeks.push(weekStart);
  }
  return weeks;
}

/**
 * The Trends "Race prediction" view. The range switch controls only the
 * trendline's visible week window; the model input is always the user's full
 * history. Otherwise the headline estimate changes just because the user chose
 * 4W vs 12W, even though "today's prediction" should be independent of the
 * chart horizon.
 *
 *  - `prediction` is today's blended finish-time estimate (Tanda + Riegel) with
 *    an interval, a confidence tier and a basis line — null until ≥3 weeks of
 *    coverage exist.
 *  - `series` is one prediction per completed week across the selected range
 *    window (4W / 12W / All), for the prediction-over-time trendline.
 *  - `goalSeconds` is the active plan's goal time, for the delta chip + the
 *    chart's goal reference hairline.
 *
 * The target distance follows the plan's `distance_kind` (marathon by default).
 */
export function useRacePrediction(
  userId: string | null,
  range: RangeKey = 'all',
  /** Explicit custom civil window for the prediction trend (overrides the preset). */
  customWindow: { from: string; to: string } | null = null,
): RacePredictionView {
  const today = todayLocal();
  const planQ = useActivePlan(userId);
  const windowActivitiesQ = useRangeActivities(userId, today, range, customWindow);
  const allActivitiesQ = useRangeActivities(userId, today, 'all');
  const plan = planQ.data?.plan ?? null;

  const error =
    (planQ.error as Error | null) ??
    (windowActivitiesQ.error as Error | null) ??
    (allActivitiesQ.error as Error | null) ??
    null;
  const loading = planQ.isLoading || windowActivitiesQ.isLoading || allActivitiesQ.isLoading;

  const targetMeters = useMemo(() => {
    const kind = plan?.distance_kind ?? 'marathon';
    return DISTANCE_KIND_METERS[kind] ?? 42195;
  }, [plan?.distance_kind]);

  const goalSeconds = useMemo(() => parseGoalSeconds(plan?.goal_time), [plan?.goal_time]);

  const derived = useMemo(() => {
    const allActivities = dedupeActivityRows(allActivitiesQ.data ?? []);
    const windowActivities = dedupeActivityRows(windowActivitiesQ.data ?? []);
    const predActivities: PredictActivity[] = allActivities
      .filter((a) => !!a.local_date)
      .map((a) => ({
        localDate: a.local_date,
        distanceMeters: a.distance_meters,
        movingTimeS: a.moving_time_s,
        startDate: a.start_date,
        bestEfforts: a.best_efforts,
        workoutType: a.workout_type,
      }));

    const prediction = predictRace(predActivities, today, targetMeters);

    // Multi-distance outlook: each canonical distance's current estimate
    // (predictRace handles any distance via Riegel). The goal distance reuses the
    // hero `prediction` instead of recomputing. No backward 4-week delta — the
    // predictor is intensity-sensitive, so it reads as a phantom regression in a
    // base phase, and the table never renders it.
    const byDistance: DistanceEstimate[] = RACE_DISTANCES.map((d) => {
      const est = d.meters === targetMeters ? prediction : predictRace(predActivities, today, d.meters);
      return { meters: d.meters, label: d.label, seconds: est?.seconds ?? null };
    });

    // One trendline point per completed (Monday) week across the window,
    // including time-off weeks so the x-axis never compresses calendar time.
    // Never ask the model to evaluate the live week as of a Sunday that has not
    // happened yet.
    const weekStarts = completedPredictionWeekStarts(
      windowActivities.map((activity) => activity.local_date),
      today,
      customWindow
        ? { from: customWindow.from }
        : range === '4w'
          ? { completedWeeks: 4 }
          : range === '12w'
            ? { completedWeeks: 12 }
            : {},
    );
    const series = predictionSeries(predActivities, weekStarts, targetMeters);

    return { prediction, series, byDistance };
  }, [allActivitiesQ.data, windowActivitiesQ.data, today, targetMeters, range, customWindow]);

  // Self-measurement: freeze today's prediction once it has computed from usable
  // data, so a future real race result can grade the model. Fire-and-forget,
  // idempotent per (day, target), and never blocks/errors the UI (see
  // `maybeLogPredictionSnapshot`). Gated on a real prediction + a signed-in user.
  const prediction = derived.prediction;
  useEffect(() => {
    if (!userId || !prediction) return;
    maybeLogPredictionSnapshot(
      {
        userId,
        planId: plan?.id ?? null,
        raceDate: plan?.race_date ?? null,
        targetMeters,
      },
      prediction,
      today,
    );
  }, [userId, plan?.id, plan?.race_date, targetMeters, today, prediction]);

  return {
    loading,
    error,
    plan,
    prediction: derived.prediction,
    byDistance: derived.byDistance,
    series: derived.series,
    goalSeconds,
    targetMeters,
    range,
    today,
  };
}
