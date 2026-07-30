import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { supabase } from '../supabase';
import { API_BASE, resilientFetch } from '../api';
import { useActivePlan } from './activePlan';
import { ACTIVITY_DETAIL_COLUMNS, ACTIVITY_QUERY_STALE_MS } from './activities';
import { addDays, todayLocal } from './internal';
import type { ActivityRow } from './rows';

// ---- Standalone activity detail --------------------------------------------

export interface ActivityDetail {
  loading: boolean;
  error: Error | null;
  /** The activity row (incl. streams/route/laps), or null when not found. */
  activity: ActivityRow | null;
  /** 1-based plan week index this activity falls in, if inside the plan window. */
  weekIndex: number | null;
  today: string;
  /** Re-runs whichever underlying query failed (plan or activity row) — the
   *  error state's retry action. */
  refetch: () => void;
}

interface RehydrateResponse {
  ok: boolean;
  activity?: ActivityRow;
  reason?: string;
  message?: string;
}

/**
 * POST `/api/strava/rehydrate` for a purged (streams-null) activity row, and
 * return the refreshed row on success (`src/server/rehydrate.ts` does the
 * actual Strava re-fetch + summary recompute; this is just the client call).
 *
 * NEVER throws: any failure — no session, network/timeout, the server's own
 * `{ok:false}` (activity not found, Strava disconnected/revoked, or a
 * transient Strava error) — resolves to `null` so the caller keeps the
 * original (still streams-null) row. SessionView's existing graceful-degrade
 * paths (`route={null}`, `hasUsableStreams(...) === false` → the
 * planned/summary body) then render off the durable `stream_summary` alone.
 */
async function rehydrateActivityRow(activityId: string): Promise<ActivityRow | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return null;
    const res = await resilientFetch(`${API_BASE}/api/strava/rehydrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ activityId }),
      timeoutMs: 20_000,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as RehydrateResponse;
    return json.ok && json.activity ? json.activity : null;
  } catch {
    return null; // network/timeout — degrade gracefully, never block the detail screen
  }
}

/** A single activity row (incl. streams/route/laps) by id. */
function useActivityRow(activityId: string | null) {
  return useQuery<ActivityRow | null>({
    queryKey: ['activity', activityId],
    enabled: !!activityId,
    // 5-min stale window (matches sibling activity queries) so an old/purged or
    // genuinely-streamless run doesn't re-POST /rehydrate to Strava on every
    // detail-screen open — one attempt, then cached, easing rate-limit pressure.
    staleTime: ACTIVITY_QUERY_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activities')
        .select(ACTIVITY_DETAIL_COLUMNS)
        .eq('id', activityId)
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as ActivityRow | null;
      // An old/purged run: the row exists but `streams` is null (Strava API
      // Policy §6.2 ≤7-day cache — see
      // docs/superpowers/specs/2026-07-17-strava-7day-compliance-design.md).
      // Rehydrate on THIS detail-screen open only — `useActivityRow` is
      // private to `useActivity`, which only `SessionView` calls, never a
      // list/feed query (those use `ACTIVITY_LIST_COLUMNS`, which never
      // selects `streams`, so they can't even observe this condition).
      // Runs inside this same queryFn call, so React Query's normal
      // `isLoading` already covers the rehydrate round-trip — SessionView's
      // existing full-screen spinner gate (`active.loading`) is the
      // "skeleton" here, no separate loading state needed. On any failure
      // this falls through to the un-rehydrated (still streams-null) row.
      if (row && row.streams == null && activityId) {
        const rehydrated = await rehydrateActivityRow(activityId);
        if (rehydrated) return rehydrated;
      }
      return row;
    },
  });
}

/**
 * A standalone activity (a logged run with no planned workout) by id: the full
 * activity row plus, when its civil date lands inside the active plan's window,
 * the 1-based plan week index for the "Wk N" header context.
 */
export function useActivity(
  userId: string | null,
  activityId: string | null,
): ActivityDetail {
  const today = todayLocal();
  const planQ = useActivePlan(userId);
  const actQ = useActivityRow(activityId);

  const weekIndex = useMemo<number | null>(() => {
    const a = actQ.data;
    if (!a?.local_date || !planQ.data?.plan.start_date) return null;
    const startDate = planQ.data.plan.start_date;
    const weeks = [...planQ.data.weeks].sort((x, y) => x.week_index - y.week_index);
    for (let i = 0; i < weeks.length; i++) {
      const ws = addDays(startDate, i * 7);
      const we = addDays(ws, 7);
      if ((a.local_date as string) >= ws && (a.local_date as string) < we) {
        return weeks[i]!.week_index;
      }
    }
    return null;
  }, [actQ.data, planQ.data]);

  const error = (actQ.error as Error | null) ?? (planQ.error as Error | null) ?? null;
  return {
    loading: actQ.isLoading,
    error,
    activity: actQ.data ?? null,
    weekIndex,
    today,
    refetch: () => {
      void actQ.refetch();
      void planQ.refetch();
    },
  };
}
