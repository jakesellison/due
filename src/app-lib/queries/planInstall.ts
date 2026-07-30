import type { QueryClient } from '@tanstack/react-query';

import { resolvePlanDraftPaces, type ImportedPlanDraft } from '@/lib';

import { supabase } from '../supabase';
import { invalidatePlanActivityCaches } from './cache';

export interface InstallPlanResult {
  planId: string;
}

export async function installPlanDraft(
  draft: ImportedPlanDraft,
  qc?: QueryClient,
): Promise<InstallPlanResult> {
  const payload = toRpcDraft(resolvePlanDraftPaces(draft));
  const { data, error } = await supabase.rpc('install_plan_draft', { p_draft: payload });
  if (error) throw new Error(`installPlanDraft: ${error.message}`);
  const planId = typeof data === 'string' ? data : null;
  if (!planId) throw new Error('installPlanDraft: no plan id returned');

  if (qc) {
    await Promise.all([
      invalidatePlanActivityCaches(qc),
      qc.invalidateQueries({ queryKey: ['myPlans'] }),
    ]);
  }

  return { planId };
}

export function formatInterval(seconds: number | null): string | null {
  if (seconds == null) return null;
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function toRpcDraft(draft: ImportedPlanDraft): Record<string, unknown> {
  return {
    ...draft,
    plan: {
      ...draft.plan,
      goalTimeInterval: formatInterval(draft.plan.goalTimeSeconds),
    },
  };
}
