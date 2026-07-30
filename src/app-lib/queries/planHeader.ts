import { formatGoalTime, type BlockSummary } from '@/lib';

import type { PlanRow } from './rows';

// ---- Plan header helpers (Dash / Plan / Trends) ----------------------------

/** Phase label + days-to-race header bits, derived from the plan + current week. */
export function planHeaderInfo(
  plan: PlanRow | null,
  summary: BlockSummary | null,
  today: string,
): {
  raceName: string;
  /** Compact goal time, e.g. "2:36", or null when no goal_time is set. */
  goalTime: string | null;
  /** "Chicago 2026  2:36" — race name with goal time when present (2-space gap). */
  raceLine: string;
  weekN: number | null;
  numWeeks: number | null;
  phaseLabel: string | null;
  daysToRace: number | null;
} {
  if (!plan) {
    return {
      raceName: '—',
      goalTime: null,
      raceLine: '—',
      weekN: null,
      numWeeks: null,
      phaseLabel: null,
      daysToRace: null,
    };
  }
  const current = summary?.current ?? null;
  const phaseLabel = current
    ? current.isRecovery
      ? `${cap(current.phase)}  Recovery`
      : cap(current.phase)
    : null;
  let daysToRace: number | null = null;
  if (plan.race_date) {
    const a = new Date(`${today}T00:00:00Z`).getTime();
    const b = new Date(`${plan.race_date}T00:00:00Z`).getTime();
    daysToRace = Math.round((b - a) / 86_400_000);
  }
  const raceName = plan.race_name ?? 'Training block';
  const goalTime = formatGoalTime(plan.goal_time);
  return {
    raceName,
    goalTime,
    raceLine: goalTime ? `${raceName}  ${goalTime}` : raceName,
    weekN: current?.weekIndex ?? null,
    numWeeks: plan.num_weeks ?? null,
    phaseLabel,
    daysToRace,
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

