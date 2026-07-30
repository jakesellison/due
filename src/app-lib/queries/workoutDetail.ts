import { useMemo } from 'react';

import { assignMatches } from '@/lib';

import { aggregateActual, usePlanAndActivities, type DayActual } from './planView';
import type { ActivityRow, WorkoutRow } from './rows';

// ---- Workout detail --------------------------------------------------------

export interface WorkoutDetail {
  loading: boolean;
  error: Error | null;
  workout: WorkoutRow | null;
  /** Activities that fell on this workout's date. */
  activities: ActivityRow[];
  /**
   * The activities paired to THIS workout via the distance-greedy day pairing.
   * On a single-workout date this is every activity on the date; on a double day
   * it is only the run(s) attributed to this workout. Drives the actual tile.
   */
  matchedActivities: ActivityRow[];
  actual: DayActual | null;
  /**
   * The id of the primary activity for charts/route — the one paired to this
   * workout (largest when several), else null. The screen falls back to its own
   * streams-then-largest pick over `matchedActivities`.
   */
  primaryActivityId: string | null;
  /** 1-based plan week index this workout belongs to, if resolvable. */
  weekIndex: number | null;
  today: string;
  /** Re-runs the underlying plan/activities queries — the error state's retry action. */
  refetch: () => void;
}

/** A single workout (from the active plan) + the activities on its date. */
export function useWorkoutDetail(
  userId: string | null,
  workoutId: string | null,
): WorkoutDetail {
  const { today, planQ, activitiesQ, loading, error } =
    usePlanAndActivities(userId);

  const workout = useMemo<WorkoutRow | null>(() => {
    if (!planQ.data || !workoutId) return null;
    return planQ.data.workouts.find((w) => w.id === workoutId) ?? null;
  }, [planQ.data, workoutId]);

  const activities = useMemo<ActivityRow[]>(() => {
    if (!workout?.date) return [];
    return (activitiesQ.data ?? []).filter((a) => a.local_date === workout.date);
  }, [activitiesQ.data, workout?.date]);

  // Pair the day's activities to the day's workouts (distance-greedy), so on a
  // double day only the run(s) attributed to THIS workout drive its actual.
  const matchedActivities = useMemo<ActivityRow[]>(() => {
    if (!workout?.date || activities.length === 0) return [];
    const dayWorkouts = (planQ.data?.workouts ?? []).filter(
      (w) => w.date === workout.date && w.type !== 'rest',
    );
    if (dayWorkouts.length <= 1) return activities; // single workout: all runs.
    const assign = assignMatches(
      dayWorkouts.map((w) => ({
        workoutId: w.id,
        localDate: w.date as string,
        isQuality: w.is_quality,
        plannedMeters: w.planned_distance_meters ?? 0,
      })),
      activities
        .filter((a) => a.distance_meters != null)
        .map((a) => ({
          activityId: a.id,
          localDate: a.local_date as string,
          distanceMeters: a.distance_meters as number,
        })),
    );
    const ids = new Set(assign.byWorkout[workout.id]?.activityIds ?? []);
    return activities.filter((a) => ids.has(a.id));
  }, [activities, planQ.data, workout?.date, workout?.id]);

  const actual = useMemo<DayActual | null>(() => {
    if (matchedActivities.length === 0) return null;
    const byId = new Map(matchedActivities.map((a) => [a.id, a]));
    return aggregateActual(
      matchedActivities.map((a) => a.id),
      byId,
    );
  }, [matchedActivities]);

  // Primary for charts/route: the largest paired activity (the screen refines to
  // streams-then-largest over the matched set).
  const primaryActivityId = useMemo<string | null>(() => {
    if (matchedActivities.length === 0) return null;
    return (
      [...matchedActivities].sort(
        (a, b) => (b.distance_meters ?? 0) - (a.distance_meters ?? 0),
      )[0]?.id ?? null
    );
  }, [matchedActivities]);

  const weekIndex = useMemo<number | null>(() => {
    if (!planQ.data || !workout?.week_id) return null;
    return planQ.data.weeks.find((w) => w.id === workout.week_id)?.week_index ?? null;
  }, [planQ.data, workout?.week_id]);

  return {
    loading,
    error,
    workout,
    activities,
    matchedActivities,
    actual,
    primaryActivityId,
    weekIndex,
    today,
    refetch: () => {
      void planQ.refetch();
      void activitiesQ.refetch();
    },
  };
}
