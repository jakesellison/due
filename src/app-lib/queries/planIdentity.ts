import { useQuery } from '@tanstack/react-query';

import { type PlanIdentityWeekInput, type PlanIdentityWorkoutInput } from '@/lib';
import { normalizeStructure } from '@/lib/plan/normalizeStructure';

import { supabase } from '../supabase';
import { ACTIVITY_QUERY_STALE_MS } from './activities';

export interface StoredPlanIdentitySource {
  weeks: PlanIdentityWeekInput[];
  workouts: PlanIdentityWorkoutInput[];
}

export type StoredPlanIdentitySources = Record<string, StoredPlanIdentitySource>;

/**
 * Fetch only the compact prescription fields needed by plan-library cards.
 * This is intentionally separate from useMyPlans: ordinary plan pickers stay
 * light, while the visual library pays for its deterministic signatures once.
 */
export function usePlanIdentitySources(userId: string | null, planIds: readonly string[]) {
  const ids = [...new Set(planIds)].sort();
  return useQuery<StoredPlanIdentitySources>({
    queryKey: ['planIdentitySources', userId, ids],
    enabled: !!userId && ids.length > 0,
    staleTime: ACTIVITY_QUERY_STALE_MS,
    queryFn: async () => {
      if (ids.length === 0) return {};
      const [{ data: rawWeeks, error: weekError }, { data: rawWorkouts, error: workoutError }] = await Promise.all([
        supabase
          .from('plan_weeks')
          .select('id, plan_id, week_index, phase, target_meters, is_recovery')
          .in('plan_id', ids)
          .order('week_index', { ascending: true }),
        supabase
          .from('workouts')
          .select('plan_id, week_id, type, planned_distance_meters, is_quality, prescribed_quality_meters, structure')
          .in('plan_id', ids),
      ]);
      if (weekError) throw weekError;
      if (workoutError) throw workoutError;

      const sources: StoredPlanIdentitySources = Object.fromEntries(ids.map((id) => [id, { weeks: [], workouts: [] }]));
      const weekIndexById = new Map<string, number>();
      for (const raw of (rawWeeks ?? []) as Array<Record<string, unknown>>) {
        const planId = typeof raw.plan_id === 'string' ? raw.plan_id : null;
        const weekIndex = finiteNumber(raw.week_index);
        if (!planId || weekIndex == null || !sources[planId]) continue;
        if (typeof raw.id === 'string') weekIndexById.set(raw.id, weekIndex);
        sources[planId].weeks.push({
          weekIndex,
          phase: typeof raw.phase === 'string' ? raw.phase : null,
          targetMeters: finiteNumber(raw.target_meters),
          isRecovery: Boolean(raw.is_recovery),
        });
      }

      for (const raw of (rawWorkouts ?? []) as Array<Record<string, unknown>>) {
        const planId = typeof raw.plan_id === 'string' ? raw.plan_id : null;
        if (!planId || !sources[planId]) continue;
        sources[planId].workouts.push({
          weekIndex: typeof raw.week_id === 'string' ? weekIndexById.get(raw.week_id) ?? null : null,
          type: typeof raw.type === 'string' ? raw.type : null,
          plannedDistanceMeters: finiteNumber(raw.planned_distance_meters),
          isQuality: Boolean(raw.is_quality),
          prescribedQualityMeters: finiteNumber(raw.prescribed_quality_meters),
          structure: normalizeStructure(raw.structure),
        });
      }

      return sources;
    },
  });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
