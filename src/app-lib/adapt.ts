import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  addDays,
  assignMatches,
  deriveContext,
  proposeAdaptations,
  todayLocal,
  type Adaptation,
  type ProposeInput,
  type RemainingDayType,
  type WeekDay,
} from '@/lib';

import { supabase } from './supabase';
import {
  invalidatePlanActivityCaches,
  useActivePlan,
  useActivities,
  type ActivePlan,
  type ActivityRow,
} from './queries';
import {
  detectWeekQuality,
  readQualityOverrides,
} from './qualityCredit';

/**
 * The read-only runtime layer for adaptation proposals.
 *
 * The PROPOSAL math lives entirely in the pure, node-tested `proposeAdaptations`
 * engine (`src/lib/adapt/propose.ts`); everything here is IO — deriving the
 * engine's input from the loaded plan and activities.
 *
 * READ-ONLY as of 2026-07-28. This module used to apply a proposal to the DB
 * and let the runner dismiss one, both driven by a realign sheet reached from a
 * run's detail. That sheet was removed because adjusting the week is a
 * CONTRACT-level decision: the Dash contract card's "Adjust" is the one door,
 * and it opens the week planner, where the runner redistributes by hand.
 *
 * What survives is the single number the Dash still shows — the week's deficit
 * ("N mi unallocated"). Nothing consumes the proposals themselves, so the
 * engine's richer output (reflow, lower_target, doubles) is currently computed
 * and discarded; `src/lib/adapt/reflowStrip.ts` likewise has no production
 * consumer, only the engine's acceptance harness. Left in place deliberately —
 * resurfacing an automatic redistribute is a small change from here rather than
 * a rebuild — but if that is ruled out, this is the thread to pull.
 */


// ---- Hook: useAdaptations --------------------------------------------------

export interface AdaptationsView {
  loading: boolean;
  error: Error | null;
  /** The active plan id (for applyAdaptation). */
  planId: string | null;
  /** The current plan-week id (for applyAdaptation / dismissAdaptation). */
  weekId: string | null;
  /** The proposals for the current week, minus any dismissed this week. */
  adaptations: Adaptation[];
  /**
   * The current week's SIGNED mileage gap, in meters:
   * `weekTarget - banked - stillPlanned`.
   *
   *   > 0  BEHIND — running everything still on the calendar still misses the
   *        contract. This is the deficit the Dash shows as "N mi unallocated".
   *   < 0  OVER-ALLOCATED — running everything still on the calendar overshoots
   *        the contract by that much. The Dash invites the runner to trim the
   *        plan once the overage clears a mile.
   *
   * Taken from the engine's own `deriveContext` rather than recomputed here:
   * that one definition already accounts for planned PM doubles, today's
   * unrun remainder, and missed days, and a second copy would drift from it.
   */
  weekGapMeters: number;
}

/** Whole civil days from `from` to `to` (>= 0 when `to` is on/after `from`). */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Map a DB workout `type` to the engine's RemainingDayType. */
function toDayType(type: string | null): RemainingDayType {
  switch (type) {
    case 'easy':
    case 'long':
    case 'quality':
    case 'rest':
    case 'cross':
    case 'race':
      return type;
    default:
      return null;
  }
}

/**
 * Derive the engine input for the CURRENT plan week from the loaded plan +
 * activities, run the pure proposal engine, and drop any proposals the user has
 * dismissed this week.
 *
 * The week is keyed by the plan-week row whose [weekStart, weekStart+7) span
 * contains today. "Remaining days" are workouts strictly AFTER today within that
 * week. Actual = sum of activity distance from the week start through today.
 */
export function useAdaptations(userId: string | null): AdaptationsView {
  const today = todayLocal();
  const planQ = useActivePlan(userId);
  const plan = planQ.data?.plan ?? null;

  const range = useMemo(() => {
    if (!plan?.start_date || !plan.num_weeks) {
      return { from: addDays(today, -8 * 7), to: today };
    }
    return { from: plan.start_date, to: addDays(plan.start_date, plan.num_weeks * 7) };
  }, [plan?.start_date, plan?.num_weeks, today]);

  const activitiesQ = useActivities(userId, range);

  // Read quality overrides for this week's activities so they flow into the
  // quality detection inside deriveCurrentWeek.
  const weekActivityIds = useMemo(() => {
    const acts = activitiesQ.data ?? [];
    // Approximate the week range for filtering (we don't know weekStart yet, but
    // the last 7 days is a safe over-read — false overrides don't exist in
    return acts.map((a) => a.id);
  }, [activitiesQ.data]);

  const qualityOverridesQ = useQuery<Set<string>>({
    queryKey: ['quality-overrides-adapt', weekActivityIds.join(',')],
    enabled: weekActivityIds.length > 0,
    staleTime: 0,
    queryFn: () => readQualityOverrides(weekActivityIds),
  });

  // The (planId, weekId, engine input) for the current week — pure derivation.
  const derived = useMemo(() => {
    const overrides = qualityOverridesQ.data ?? new Set<string>();
    return deriveCurrentWeek(planQ.data, activitiesQ.data, today, overrides);
  }, [planQ.data, activitiesQ.data, today, qualityOverridesQ.data]);

  const weekId = derived?.weekId ?? null;

  // No per-proposal dismissal any more: the tray that offered "dismiss" is gone,
  // so nothing could write one and the filter always passed everything through.
  const adaptations = useMemo(() => derived?.proposals ?? [], [derived]);

  const error =
    (planQ.error as Error | null) ?? (activitiesQ.error as Error | null) ?? null;

  return {
    loading: planQ.isLoading || (planQ.data != null && activitiesQ.isLoading),
    error,
    planId: plan?.id ?? null,
    weekId,
    adaptations,
    weekGapMeters: derived?.gapMeters ?? 0,
  };
}


interface DerivedWeek {
  weekId: string;
  proposals: Adaptation[];
  gapMeters: number;
}

/**
 * R4 doubles-gate input: the runner's habitual planned PM distance (meters).
 *
 * A "PM row" is any second-or-later workout row sharing a (week, date) slot
 * after the deterministic created_at -> id sort — the same AM/PM convention
 * deriveCurrentWeek uses below (the FIRST row per date is the AM run). Scans
 * ALL the plan's weeks (the loaded `workouts` span the whole plan) and returns
 * the median of the PM rows' planned_distance_meters; rows with a null
 * distance carry no habit signal and are skipped. Null when the plan has no
 * PM rows at all — the engine then never proposes add_double (R4 gate).
 *
 * NOTE: a fallback derived from the runner's LOGGED doubles (recent activity
 * history, for plans written without explicit PM rows) is deferred.
 */
export function derivePmHabitMeters(
  workouts: ActivePlan['workouts'],
): number | null {
  // Group rows into (week, date) slots.
  const slots = new Map<string, ActivePlan['workouts']>();
  for (const w of workouts) {
    if (w.date == null) continue;
    const key = `${w.week_id ?? ''}|${w.date}`;
    const rows = slots.get(key);
    if (rows) rows.push(w);
    else slots.set(key, [w]);
  }

  const pmMeters: number[] = [];
  for (const rows of slots.values()) {
    if (rows.length < 2) continue;
    // Same defensive within-date ordering as deriveCurrentWeek: insertion
    // time first, id as the same-transaction tiebreak.
    const sorted = [...rows].sort(
      (a, b) =>
        (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
        a.id.localeCompare(b.id),
    );
    for (const pm of sorted.slice(1)) {
      if (pm.planned_distance_meters != null) pmMeters.push(pm.planned_distance_meters);
    }
  }
  if (pmMeters.length === 0) return null;

  pmMeters.sort((a, b) => a - b);
  const mid = Math.floor(pmMeters.length / 2);
  return pmMeters.length % 2 === 1
    ? pmMeters[mid]!
    : (pmMeters[mid - 1]! + pmMeters[mid]!) / 2;
}

/**
 * Pure derivation of the current week's proposals from loaded rows. Exported for
 * the hook only (kept here, beside the hook, since it reads the same row shapes).
 *
 * Builds all 7 WeekDay entries (weekStart..weekStart+6) so the engine can compute
 * missed/open/adjacency itself from the full picture, not just remaining days.
 *
 * @param qualityOverrides  Set of activity IDs overridden by the user (suppressed
 *   quality detections).  Defaults to an empty set when omitted.
 */
export function deriveCurrentWeek(
  planData: ActivePlan | null | undefined,
  activities: ActivityRow[] | undefined,
  today: string,
  qualityOverrides?: Set<string>,
): DerivedWeek | null {
  if (!planData?.plan.start_date) return null;
  const startDate = planData.plan.start_date;
  const { weeks, workouts } = planData;

  // Resolve the current plan week from its actual date span, not its array
  // position. week_index is 1-BASED (week 1 IS the plan-start week), so week N
  // begins startDate + (week_index − 1)*7 — the same convention the importer uses
  // (`draft.ts`: startDate + (weekIndex − 1)*7). Keying on week_index — not the
  // loop index — keeps the math correct when weeks are missing or out of order.
  let currentWeekId: string | null = null;
  let weekStart: string | null = null;
  for (const w of weeks) {
    const ws = addDays(startDate, (w.week_index - 1) * 7);
    const we = addDays(ws, 7);
    if (today >= ws && today < we) {
      currentWeekId = w.id;
      weekStart = ws;
      break;
    }
  }
  if (!currentWeekId || !weekStart) return null;

  const week = weeks.find((w) => w.id === currentWeekId)!;
  const targetMeters = week.target_meters ?? 0;

  // The `activities` array covers the full plan span (loaded by useAdaptations
  // with a plan-span range).  Filter to just the current week for actual meters
  // and quality detection; reuse the full set for the easy-pace baseline.
  const allActivities = activities ?? [];
  const weekEnd = addDays(weekStart, 6);
  const weekActivities = allActivities.filter(
    (a) =>
      !!a.local_date &&
      a.distance_meters != null &&
      a.local_date >= (weekStart as string) &&
      a.local_date <= weekEnd,
  );
  const todayActivities = allActivities.filter(
    (a) =>
      !!a.local_date &&
      a.distance_meters != null &&
      a.local_date >= (weekStart as string) &&
      a.local_date <= today,
  );
  const actualMeters = todayActivities.reduce((s, a) => s + (a.distance_meters ?? 0), 0);

  // Build a set of dates that have at least one logged activity in the week.
  const activityDates = new Set(todayActivities.map((a) => a.local_date as string));
  const currentWeekWorkouts = workouts.filter(
    (workout) =>
      workout.week_id === currentWeekId &&
      workout.date != null &&
      (workout.type ?? '').toLowerCase() !== 'rest',
  );
  const assignments = assignMatches(
    currentWeekWorkouts.map((workout) => ({
      workoutId: workout.id,
      localDate: workout.date as string,
      isQuality: workout.is_quality,
      plannedMeters: workout.planned_distance_meters ?? 0,
    })),
    weekActivities.map((activity) => ({
      activityId: activity.id,
      localDate: activity.local_date as string,
      distanceMeters: activity.distance_meters ?? 0,
    })),
  );

  // Build the full 7-day weekDays array (all dates weekStart..weekStart+6).
  // For each date, find the workout row (if any) for the current week.
  const weekDays: WeekDay[] = [];
  for (let idx = 0; idx < 7; idx++) {
    const date = addDays(weekStart, idx);
    // Collect ALL workouts for this date in the current week (there may be none
    // if it's a rest day with no explicit row — implicitly a rest slot). A date
    // can carry multiple rows when a PM double is planned (D7): the FIRST row
    // (insertion order) is the AM run; the rest aggregate into plannedPmMeters.
    // Don't key off the 'Easy (PM)' title — treat row order as authoritative.
    // Defensively sort by insertion time (created_at, then id) so the AM/PM
    // split doesn't depend on the caller's query ordering — array order alone
    // is not trustworthy (Postgres within-date order is unstable).
    const dayWorkouts = workouts
      .filter((w) => w.week_id === currentWeekId && w.date === date)
      .sort(
        (a, b) =>
          (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
          a.id.localeCompare(b.id),
      );
    const amWorkout = dayWorkouts[0] ?? null;
    const plannedPmMeters = dayWorkouts
      .slice(1)
      .reduce((s, w) => s + (w.planned_distance_meters ?? 0), 0);
    const remainingMeters = date < today
      ? 0
      : dayWorkouts.reduce(
          (sum, workout) =>
            sum +
            (assignments.byWorkout[workout.id] == null
              ? workout.planned_distance_meters ?? 0
              : 0),
          0,
        );

    weekDays.push({
      workoutId: amWorkout?.id ?? null,
      date,
      idx,
      type: toDayType(amWorkout?.type ?? null),
      plannedMeters: amWorkout?.planned_distance_meters ?? 0,
      plannedPmMeters,
      remainingMeters,
      hasActivity: activityDates.has(date),
      isToday: date === today,
    });
  }

  // Pace-line fraction through END OF YESTERDAY (completedDays / 7). Today is not
  // counted: the trigger measures you against where you should have been by the
  // start of today, so a not-yet-run today is never "behind pace".
  const completedDays = daysBetween(weekStart, today);
  const elapsedFraction = Math.min(1, Math.max(0, completedDays / 7));

  // ── Quality satisfaction ─────────────────────────────────────────────────
  // Locate the planned quality workout for this week (if any) and detect
  // whether quality has already been satisfied by an activity in the week.
  const qualityWorkout = workouts.find(
    (w) =>
      w.is_quality &&
      w.date != null &&
      w.date >= (weekStart as string) &&
      w.date <= weekEnd,
  ) ?? null;

  const qualityWorkoutForDetect = qualityWorkout
    ? {
        id: qualityWorkout.id,
        structure: qualityWorkout.structure,
        plannedDistanceMeters: qualityWorkout.planned_distance_meters,
      }
    : null;

  const overridesSet = qualityOverrides ?? new Set<string>();
  const qualityDetectResult = detectWeekQuality(
    weekActivities,
    qualityWorkoutForDetect,
    overridesSet,
  );

  // Resolve the planned quality day's idx in the week (for the engine).
  let plannedQualityDayIdx: number | undefined;
  if (qualityWorkout?.date != null && weekStart != null) {
    const qDate = qualityWorkout.date;
    const qIdx = weekDays.findIndex((d) => d.date === qDate);
    if (qIdx >= 0) plannedQualityDayIdx = qIdx;
  }

  // Locate the planned long run for this week (for reflow).
  const longWorkout = workouts.find(
    (w) =>
      w.type === 'long' &&
      w.date != null &&
      w.date >= (weekStart as string) &&
      w.date <= weekEnd,
  ) ?? null;
  const longDayIdx = longWorkout?.date != null
    ? weekDays.findIndex((d) => d.date === longWorkout.date)
    : -1;

  const input: ProposeInput = {
    weekTargetMeters: targetMeters,
    actualMeters,
    elapsedFraction,
    weekDays,
    // R4 doubles gate: the plan-wide planned-PM habit (null = never doubles).
    pmHabitMeters: derivePmHabitMeters(workouts),
    // Thread quality status into the engine when a quality workout exists.
    ...(qualityWorkout != null
      ? {
          qualitySatisfied: qualityDetectResult.qualityDetected,
          plannedQualityDayIdx,
          // qualityDayInfo for the reflow suggester.
          qualityDayInfo: {
            idx: plannedQualityDayIdx ?? -1,
            plannedMeters: qualityWorkout.planned_distance_meters ?? 0,
            workoutId: qualityWorkout.id,
            date: qualityWorkout.date!,
          },
        }
      : {}),
    // longDayInfo for the reflow suggester.
    ...(longWorkout != null && longDayIdx >= 0
      ? {
          longDayInfo: {
            idx: longDayIdx,
            plannedMeters: longWorkout.planned_distance_meters ?? 0,
            workoutId: longWorkout.id,
            date: longWorkout.date!,
          },
        }
      : {}),
  };

  return {
    weekId: currentWeekId,
    proposals: proposeAdaptations(input),
    gapMeters: deriveContext(input).gap,
  };
}
