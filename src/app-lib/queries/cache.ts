import type { QueryClient } from '@tanstack/react-query';

/**
 * Stable react-query key for the per-week quality-overrides lookup.
 *
 * Keyed by plan + week range (NOT the activity-id set) so the entry is reused
 * across renders even as the matched activities change, and so a single
 * invalidation key can target it. Returning a partial key (no week bounds)
 * still matches every week's entry under `invalidateQueries`.
 */
export function qualityOverridesKey(
  planId?: string | null,
  weekStart?: string | null,
  weekEnd?: string | null,
): (string | null)[] {
  const key: (string | null)[] = ['quality-overrides'];
  if (planId != null) key.push(planId);
  if (weekStart != null) key.push(weekStart);
  if (weekEnd != null) key.push(weekEnd);
  return key;
}

/**
 * Invalidate the query families derived from the active plan and activity rows.
 * Use after writes that can affect Dash, Plan, Trends, Settings, or Shoes
 * summaries, plus the detected-quality overrides view.
 *
 * Includes the single-activity detail key (`['activity', id]`, see
 * `activityDetail.ts`'s `useActivityRow`) — invalidating only the `['activities']`
 * list left an already-open detail row stale after a re-sync/enrich wrote new
 * streams/route/laps for it.
 */
export async function invalidatePlanActivityCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['activePlan'] }),
    queryClient.invalidateQueries({ queryKey: ['activities'] }),
    queryClient.invalidateQueries({ queryKey: ['activity'] }),
    queryClient.invalidateQueries({ queryKey: ['shoes'] }),
    queryClient.invalidateQueries({ queryKey: ['planIdentitySources'] }),
    queryClient.invalidateQueries({ queryKey: qualityOverridesKey() }),
  ]);
}
