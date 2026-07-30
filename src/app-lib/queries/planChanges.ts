/**
 * planChanges.ts — the first READER of `plan_changes`. Fetches a plan's raw
 * change rows and resolves them (against the plan's workouts) into the clean
 * evolution log the day/week/plan surfaces render. The heavy lifting is the pure
 * `buildChangeLog` transform (src/lib/plan/changeLog.ts, node-tested); this hook
 * is just fetch + memoised resolve.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../supabase';
import { useActivePlan } from './activePlan';
import { ACTIVITY_QUERY_STALE_MS } from './activities';
import { buildChangeLog, type PlanChangeEvent, type RawPlanChange } from '@/lib/plan/changeLog';

const CHANGE_GC_MS = 30 * 60 * 1000;

/**
 * The resolved plan-evolution log (newest event first) + loading flag. Combines
 * the plan's `plan_changes` rows with the active plan's workouts to resolve each
 * change to its day/week. `planId` should be the active plan (the workouts come
 * from `useActivePlan`).
 */
export function usePlanChangeLog(
  userId: string | null,
  planId: string | null,
): { events: PlanChangeEvent[]; isLoading: boolean; error: Error | null; refetch: () => Promise<void> } {
  const planQ = useActivePlan(userId);
  const rowsQ = useQuery<RawPlanChange[]>({
    queryKey: ['planChanges', planId],
    enabled: !!planId,
    staleTime: ACTIVITY_QUERY_STALE_MS,
    gcTime: CHANGE_GC_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_changes')
        .select('id, actor_type, source, change, created_at')
        .eq('plan_id', planId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as RawPlanChange[];
    },
  });

  const events = useMemo<PlanChangeEvent[]>(() => {
    if (!rowsQ.data || !planQ.data) return [];
    return buildChangeLog({
      rows: rowsQ.data,
      workouts: planQ.data.workouts.map((w) => ({ id: w.id, date: w.date, type: w.type })),
      startDate: planQ.data.plan.start_date,
      planId,
    });
  }, [rowsQ.data, planQ.data, planId]);

  const refetch = useCallback(async () => {
    await Promise.all([rowsQ.refetch(), planQ.refetch()]);
  }, [planQ.refetch, rowsQ.refetch]);

  return {
    events,
    isLoading: rowsQ.isLoading || planQ.isLoading,
    error: (rowsQ.error ?? planQ.error) as Error | null,
    refetch,
  };
}
