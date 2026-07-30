export interface PlannedDay {
  workoutId: string;
  localDate: string;
  isQuality: boolean;
  /** Planned distance (meters); used to pair runs on multi-workout days. */
  plannedMeters?: number;
}
export interface Activity { activityId: string; localDate: string; distanceMeters: number }

export interface Match { workoutId: string; activityId: string }
export interface WorkoutRollup { totalMeters: number; activityIds: string[] }
export interface AssignResult {
  matches: Match[];
  byWorkout: Record<string, WorkoutRollup>;
  missedWorkoutIds: string[];
  unplannedActivityIds: string[];
}

/**
 * Attribute activities to planned workouts by civil date.
 *
 * SINGLE-workout dates: every activity on that date is attributed to that one
 * workout and their distances sum into its rollup (unchanged from v1).
 *
 * MULTI-workout dates (a planned double): activities are paired to workouts
 * GREEDILY by closeness of distance — each activity lands on the unpaired
 * workout whose planned distance is nearest its own (|actual − planned|), so a
 * 10.2 mi run pairs with the 10 mi workout and a 4.8 mi run with the 5 mi
 * workout rather than both summing onto one. Ties (equal distance fit) prefer a
 * quality workout. When there are MORE activities than workouts, the leftover
 * activities attach as overflow to the workout whose planned distance is closest
 * to that activity (so a lone 15 mi run on a [10, 5] day lands on the 10). When
 * there are MORE workouts than activities, the unpaired workouts get no actual.
 *
 * Policy:
 * - `missedWorkoutIds`: a workout is missed iff its date had zero activities.
 *   On a double-planned day where the runner did at least one run, none of that
 *   day's workouts are reported missed — a leftover unpaired workout on an
 *   active day is NOT a miss (the runner showed up that day).
 * - `unplannedActivityIds`: an activity whose date has no planned workout.
 */
export function assignMatches(workouts: PlannedDay[], activities: Activity[]): AssignResult {
  // Group planned workouts by date, preserving input order within each date.
  const workoutsByDate = new Map<string, PlannedDay[]>();
  for (const w of workouts) {
    const list = workoutsByDate.get(w.localDate);
    if (list) list.push(w);
    else workoutsByDate.set(w.localDate, [w]);
  }

  // Group activities by date, preserving input order within each date.
  const activitiesByDate = new Map<string, Activity[]>();
  for (const a of activities) {
    const list = activitiesByDate.get(a.localDate);
    if (list) list.push(a);
    else activitiesByDate.set(a.localDate, [a]);
  }

  const matches: Match[] = [];
  const byWorkout: Record<string, WorkoutRollup> = {};
  const unplannedActivityIds: string[] = [];
  const datesWithActivity = new Set<string>();

  const attribute = (workoutId: string, a: Activity) => {
    matches.push({ workoutId, activityId: a.activityId });
    const roll = byWorkout[workoutId] ?? { totalMeters: 0, activityIds: [] };
    roll.totalMeters += a.distanceMeters;
    roll.activityIds.push(a.activityId);
    byWorkout[workoutId] = roll;
  };

  for (const [date, group] of activitiesByDate) {
    const wgroup = workoutsByDate.get(date);
    if (!wgroup || wgroup.length === 0) {
      for (const a of group) unplannedActivityIds.push(a.activityId);
      continue;
    }
    datesWithActivity.add(date);

    if (wgroup.length === 1) {
      // Single-workout date: all activities sum onto it (unchanged behavior).
      const primary = wgroup[0]!;
      for (const a of group) attribute(primary.workoutId, a);
      continue;
    }

    // Multi-workout date: distance-greedy pairing.
    pairGreedily(wgroup, group, attribute);
  }

  // Missed iff the workout's date had zero activities.
  const missedWorkoutIds = workouts
    .filter((w) => !datesWithActivity.has(w.localDate))
    .map((w) => w.workoutId);

  return { matches, byWorkout, missedWorkoutIds, unplannedActivityIds };
}

/** A workout's planned distance for pairing (0 when unknown). */
function plannedOf(w: PlannedDay): number {
  return w.plannedMeters ?? 0;
}

/**
 * Pair the day's activities to its (≥2) workouts by closeness of distance.
 *
 * Pass 1 — best-fit matching: consider every (activity, workout) pair, sort by
 * |actual − planned| ascending (quality workout breaking exact ties), and greedily
 * lock in the closest pairs, each activity and each workout used at most once.
 *
 * Pass 2 — overflow: any activity still unpaired (more activities than workouts)
 * attaches to the workout whose planned distance is closest to it.
 *
 * Workouts left with no activity simply get no rollup (and are not "missed",
 * since the date had ≥1 activity — handled by the caller's miss rule).
 */
function pairGreedily(
  workouts: PlannedDay[],
  activities: Activity[],
  attribute: (workoutId: string, a: Activity) => void,
): void {
  interface Pair { ai: number; wi: number; diff: number; quality: boolean }
  const pairs: Pair[] = [];
  activities.forEach((a, ai) => {
    workouts.forEach((w, wi) => {
      pairs.push({
        ai,
        wi,
        diff: Math.abs(a.distanceMeters - plannedOf(w)),
        quality: w.isQuality,
      });
    });
  });
  // Closest distance first; a quality workout wins an exact-distance tie.
  pairs.sort((p, q) => p.diff - q.diff || Number(q.quality) - Number(p.quality));

  const usedActivity = new Array(activities.length).fill(false);
  const usedWorkout = new Array(workouts.length).fill(false);
  for (const p of pairs) {
    if (usedActivity[p.ai] || usedWorkout[p.wi]) continue;
    usedActivity[p.ai] = true;
    usedWorkout[p.wi] = true;
    attribute(workouts[p.wi]!.workoutId, activities[p.ai]!);
  }

  // Overflow: leftover activities attach to the closest-by-distance workout.
  activities.forEach((a, ai) => {
    if (usedActivity[ai]) return;
    let best = workouts[0]!;
    let bestDiff = Math.abs(a.distanceMeters - plannedOf(best));
    let bestQuality = best.isQuality;
    for (let wi = 1; wi < workouts.length; wi++) {
      const w = workouts[wi]!;
      const diff = Math.abs(a.distanceMeters - plannedOf(w));
      if (diff < bestDiff || (diff === bestDiff && w.isQuality && !bestQuality)) {
        best = w;
        bestDiff = diff;
        bestQuality = w.isQuality;
      }
    }
    attribute(best.workoutId, a);
  });
}
