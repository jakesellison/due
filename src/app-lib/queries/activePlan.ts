import { useQuery } from '@tanstack/react-query';

import { normalizeStructure } from '@/lib/plan/normalizeStructure';

import { supabase } from '../supabase';
import { ACTIVITY_QUERY_STALE_MS } from './activities';
import type { ActivePlan, PlanRow, PlanWeekRow, WorkoutRow } from './rows';

const ACTIVE_PLAN_QUERY_GC_MS = 30 * 60 * 1000;

/**
 * Map a raw `workouts` DB row into a `WorkoutRow`, running the jsonb `structure`
 * column through `normalizeStructure` so consumers always receive a clean,
 * validated `WorkoutStructure` (legacy/malformed/"fat" jsonb is sanitized here
 * rather than reaching renderers). The `structure` field stays a
 * `WorkoutStructure`; all other fields pass through unchanged.
 */
export function mapWorkoutRow(raw: Record<string, unknown>): WorkoutRow {
  return {
    ...(raw as unknown as WorkoutRow),
    structure: normalizeStructure(raw.structure),
  };
}

const PLAN_SELECT = 'id, race_name, race_date, distance_kind, start_date, num_weeks, status, goal_time';

/** Load a plan's ordered weeks + workouts (shared by the active + by-id loaders). */
async function loadWeeksAndWorkouts(
  planId: string,
): Promise<{ weeks: PlanWeekRow[]; workouts: WorkoutRow[] }> {
  const [{ data: weeks, error: weekErr }, { data: workouts, error: woErr }] = await Promise.all([
    supabase
      .from('plan_weeks')
      .select('id, week_index, phase, target_meters, original_target_meters, quality_target_meters, long_target_meters, is_recovery')
      .eq('plan_id', planId)
      .order('week_index', { ascending: true }),
    supabase
      .from('workouts')
      .select(
        'id, week_id, date, type, title, planned_distance_meters, planned_duration_s, structure, is_quality, prescribed_quality_meters, notes, created_at',
      )
      .eq('plan_id', planId)
      // Within-date row order matters: consumers (deriveCurrentWeek) treat the
      // FIRST row per date as the AM run and later rows as PM doubles. Postgres
      // gives no stable order without an explicit key, so break date ties by
      // insertion time, then id (same-transaction inserts share created_at).
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  if (weekErr) throw weekErr;
  if (woErr) throw woErr;
  return {
    weeks: (weeks ?? []) as PlanWeekRow[],
    workouts: (workouts ?? []).map((w) => mapWorkoutRow(w as Record<string, unknown>)),
  };
}

/** Imperatively load a plan + its weeks + workouts (for export, outside React). */
export async function fetchPlanBundle(planId: string): Promise<ActivePlan | null> {
  const { data: plans, error } = await supabase.from('plans').select(PLAN_SELECT).eq('id', planId).limit(1);
  if (error) throw error;
  const plan = plans?.[0] as PlanRow | undefined;
  if (!plan) return null;
  return { plan, ...(await loadWeeksAndWorkouts(plan.id)) };
}

// ---- Hooks -----------------------------------------------------------------

/** The active plan + ordered plan_weeks + workouts. `null` if no active plan. */
export function useActivePlan(userId: string | null) {
  return useQuery<ActivePlan | null>({
    queryKey: ['activePlan', userId],
    enabled: !!userId,
    staleTime: ACTIVITY_QUERY_STALE_MS,
    gcTime: ACTIVE_PLAN_QUERY_GC_MS,
    queryFn: async () => {
      const { data: plans, error: planErr } = await supabase
        .from('plans')
        .select(PLAN_SELECT)
        .eq('status', 'active')
        // If a stray duplicate active row exists, prefer the MOST RECENT one
        // (by created_at) so the user lands on their newest plan, not an old
        // one. planSwitcher.useMyPlans resolves the active plan the same way.
        .order('created_at', { ascending: false })
        .limit(1);
      if (planErr) throw planErr;
      const plan = plans?.[0] as PlanRow | undefined;
      if (!plan) return null;
      return { plan, ...(await loadWeeksAndWorkouts(plan.id)) };
    },
  });
}

/** A SPECIFIC plan (any status) + its weeks + workouts — for read-only viewing
 *  and export of an archived/past plan. `null` if it doesn't exist. */
export function usePlanById(userId: string | null, planId: string | null) {
  return useQuery<ActivePlan | null>({
    queryKey: ['planById', planId],
    enabled: !!userId && !!planId,
    staleTime: ACTIVITY_QUERY_STALE_MS,
    gcTime: ACTIVE_PLAN_QUERY_GC_MS,
    queryFn: async () => {
      if (!planId) return null;
      const { data: plans, error: planErr } = await supabase
        .from('plans')
        .select(PLAN_SELECT)
        .eq('id', planId)
        .limit(1);
      if (planErr) throw planErr;
      const plan = plans?.[0] as PlanRow | undefined;
      if (!plan) return null;
      return { plan, ...(await loadWeeksAndWorkouts(plan.id)) };
    },
  });
}
