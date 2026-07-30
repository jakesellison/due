import { addDays, type PlanWindow } from '@/lib';

import type { ActivePlan } from './rows';

/**
 * Shared private helpers for the react-query data hooks (the Dash/Plan/Trends
 * screens).
 *
 * The hooks only fetch rows; ALL derivation (per-week actual vs target, banding,
 * KPI tile values, heatmap cells) happens in the pure, node-tested
 * `summarizeBlock` function — these hooks just feed DB rows into it.
 */

export const WEEK_START = 'mon';

// Re-exported from the canonical civil-date helpers so the sibling query hooks
// can keep importing them from './internal'.
export { addDays, todayLocal } from '@/lib';

/**
 * The inclusive civil-date window [from, to] the active plan covers, for the
 * schedule-aware "Showing up" semantics. `from` is the plan start; `to` is the
 * last day of the final week (start + numWeeks*7 − 1). Null when the plan dates
 * are missing (the schedule then reads every date as 'unknown').
 */
export function planWindowOf(planData: ActivePlan | null | undefined): PlanWindow | null {
  const start = planData?.plan.start_date;
  const numWeeks = planData?.plan.num_weeks;
  if (!start || !numWeeks) return null;
  return { from: start, to: addDays(start, numWeeks * 7 - 1) };
}
