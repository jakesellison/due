import { useQuery, type QueryClient } from '@tanstack/react-query';

import { formatGoalTime } from '@/lib';

import { supabase } from '../supabase';
import { invalidatePlanActivityCaches } from './cache';
import type { PlanRow } from './rows';

// ---- Plan switcher (Settings) ----------------------------------------------

/** A plan the user owns, for the plan list / library (any status). */
export interface MyPlan {
  id: string;
  raceName: string;
  /** Compact goal time ("2:36"), or null. */
  goalTime: string | null;
  numWeeks: number | null;
  /** Plan lifecycle: the active one carries the "Active" tag. */
  status: string | null;
  /** Race day (YYYY-MM-DD), or null — for the library card's year + recency. */
  raceDate?: string | null;
  /** First Monday of the installed block — used only to place its live notch. */
  startDate?: string | null;
  /** marathon | half | 10k | 5k | custom, or null — for the card's distance label. */
  distanceKind?: string | null;
  /** Creation timestamp (drives recency ordering); optional for older fixtures. */
  createdAt?: string | null;
}

/**
 * Every plan the signed-in user is a member of (via `plan_members` RLS),
 * regardless of status — ordered active-first, then by creation. Drives the
 * Settings "Plan" section. The query reads `plans` directly; RLS scopes it to
 * the membership rows so we never need to join `plan_members` client-side.
 */
export function useMyPlans(userId: string | null) {
  return useQuery<MyPlan[]>({
    queryKey: ['myPlans', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select('id, race_name, race_date, distance_kind, start_date, num_weeks, status, goal_time, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Array<PlanRow & { created_at?: string }>;
      const plans: MyPlan[] = rows.map((p) => ({
        id: p.id,
        raceName: p.race_name ?? 'Training block',
        goalTime: formatGoalTime(p.goal_time),
        numWeeks: p.num_weeks,
        status: p.status,
        raceDate: p.race_date,
        startDate: p.start_date,
        distanceKind: p.distance_kind,
        createdAt: p.created_at ?? null,
      }));
      // Active first; within each status bucket the MOST RECENT (by created_at)
      // leads, so when a stray duplicate active row exists the surfaced active
      // plan matches useActivePlan (which also picks the most-recent active row).
      return plans.sort((a, b) => {
        const activeDelta =
          Number(b.status === 'active') - Number(a.status === 'active');
        if (activeDelta !== 0) return activeDelta;
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      });
    },
  });
}

/**
 * Switch the user's active plan. Sets the chosen plan `status='active'`, archives
 * the previously-active plan(s), writes a single `plan_changes` audit row, and
 * invalidates every react-query key the Dash / Plan / Trends derive from so the
 * whole app flips to the new plan.
 *
 *  - `fromPlanId` is the currently-active plan (archived); pass null if none.
 *  - The audit row records `{ kind:'switch_active', from, to }` with
 *    `actor_type:'user', source:'manual'`.
 */
export async function switchActivePlan(
  toPlanId: string,
  fromPlanId: string | null,
  qc?: QueryClient,
): Promise<void> {
  // Archive the outgoing active plan first (so there's never two active rows).
  if (fromPlanId && fromPlanId !== toPlanId) {
    const { error: archiveErr } = await supabase
      .from('plans')
      .update({ status: 'archived' })
      .eq('id', fromPlanId);
    if (archiveErr) throw archiveErr;
  }

  const { error: activateErr } = await supabase
    .from('plans')
    .update({ status: 'active' })
    .eq('id', toPlanId);
  if (activateErr) throw activateErr;

  const { error: changeErr } = await supabase.from('plan_changes').insert({
    plan_id: toPlanId,
    actor_type: 'user',
    source: 'manual',
    change: { kind: 'switch_active', from: fromPlanId, to: toPlanId },
  });
  if (changeErr) throw changeErr;

  if (qc) {
    await Promise.all([
      invalidatePlanActivityCaches(qc),
      qc.invalidateQueries({ queryKey: ['myPlans'] }),
    ]);
  }
}

/**
 * Rename a plan (its `race_name`). Trims the input; a blank name is rejected by
 * the caller. Invalidates the plan caches so the new name shows everywhere it's
 * read (Library list, active-plan header, by-id detail).
 */
export async function renamePlan(
  planId: string,
  raceName: string,
  qc?: QueryClient,
): Promise<void> {
  const name = raceName.trim();
  if (!name) throw new Error('Name cannot be empty.');
  const { error } = await supabase.from('plans').update({ race_name: name }).eq('id', planId);
  if (error) throw error;
  if (qc) {
    await Promise.all([
      invalidatePlanActivityCaches(qc),
      qc.invalidateQueries({ queryKey: ['myPlans'] }),
      qc.invalidateQueries({ queryKey: ['planById', planId] }),
    ]);
  }
}

/**
 * Permanently delete a plan and everything under it. The `plans` table has a
 * `plans_delete` RLS policy and `ON DELETE CASCADE` on plan_weeks / workouts /
 * plan_changes / plan_members, so a single client delete tears down the whole
 * tree — no RPC needed. The caller must ensure this is NOT the active plan
 * (swap/archive first); deleting the active plan is disallowed in the UI.
 */
export async function deletePlan(planId: string, qc?: QueryClient): Promise<void> {
  const { error } = await supabase.from('plans').delete().eq('id', planId);
  if (error) throw error;
  if (qc) {
    await Promise.all([
      invalidatePlanActivityCaches(qc),
      qc.invalidateQueries({ queryKey: ['myPlans'] }),
    ]);
  }
}
