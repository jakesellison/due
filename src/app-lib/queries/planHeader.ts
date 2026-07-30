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

/**
 * Build the single-line plan CAPTION shown under the screen titles
 * (Plan / Trends), e.g.
 *
 *   "Chicago 2026  2:36 — Wk 5 of 23  Base"
 *
 * The race name is never truncated. Instead, when the available character budget
 * is tight we DROP whole low-priority segments right-to-left so the line still
 * fits on one row. Drop order (first dropped first):
 *
 *   1. phase           ("Base")           — lowest priority
 *   2. week-of          ("Wk 5 of 23")
 *   3. goal time        ("2:36")
 *
 * The race name (highest priority) always survives. `maxChars` is an approximate
 * budget — callers pass a value derived from the available width / font size;
 * the default (40) suits a phone Dash header. The composition is pure + tested.
 */
export function planCaption(
  h: Pick<ReturnType<typeof planHeaderInfo>, 'raceName' | 'goalTime' | 'weekN' | 'numWeeks' | 'phaseLabel'>,
  maxChars = 40,
): string {
  const race = h.raceName && h.raceName !== '—' ? h.raceName : 'Training block';
  const goal = h.goalTime ?? null;
  const weekSeg =
    h.weekN != null && h.numWeeks != null ? `Wk ${h.weekN} of ${h.numWeeks}` : null;
  const phase = h.phaseLabel ?? null;

  // Assemble: "<race>  <goal> — <week>  <phase>" (2-space gaps, no glyphs).
  const compose = (withGoal: boolean, withWeek: boolean, withPhase: boolean): string => {
    const head = withGoal && goal ? `${race}  ${goal}` : race;
    const tailParts: string[] = [];
    if (withWeek && weekSeg) tailParts.push(weekSeg);
    if (withPhase && phase) tailParts.push(phase);
    const tail = tailParts.join('  ');
    return tail ? `${head} — ${tail}` : head;
  };

  // Try the full line, then drop segments right-to-left until it fits (or only
  // the race name remains). The race name itself is never trimmed.
  const candidates = [
    compose(true, true, true),
    compose(true, true, false), // drop phase
    compose(true, false, false), // drop week
    compose(false, false, false), // drop goal → race only
  ];
  for (const c of candidates) {
    if (c.length <= maxChars) return c;
  }
  // Even the bare race name exceeds the budget — return it anyway (no "…"; the
  // Text node's own single-line layout will shrink/clip gracefully).
  return candidates[candidates.length - 1] as string;
}
