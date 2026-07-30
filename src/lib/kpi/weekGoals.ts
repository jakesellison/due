/**
 * weekGoals.ts — per-week attainment of the three plan goals (Mileage / Quality /
 * Long) for the "goal rings" trend. Each week becomes one medallion: three arcs
 * that fill when the goal's threshold is reached, stay hollow when missed.
 *
 * Pure types + the hit gates + a tiny stat builder. The actuals (esp. detected
 * quality) are computed in the query layer and fed in; this file owns the
 * thresholds so the gauge tiles and the rings agree on what "met" means.
 */

/** One goal's status for a week. `fraction` (0..1) drives the in-progress fill. */
export interface GoalStat {
  actualMeters: number;
  targetMeters: number;
  /** Met its threshold (see GOAL_GATES). False when there's no target. */
  hit: boolean;
  /** actual ÷ target, clamped 0..1 — for the current week's proportional arc. */
  fraction: number;
}

export interface WeekGoal {
  weekIndex: number;
  /** Monday (YYYY-MM-DD) of the week. */
  weekStart: string;
  /** 'W7' — the plan week number. */
  label: string;
  /** True for the in-progress week (its arcs fill proportionally, not binary). */
  isCurrent: boolean;
  /** True for weeks after the current one (a faint, empty "to come" ring). */
  isFuture: boolean;
  mileage: GoalStat;
  quality: GoalStat;
  long: GoalStat;
  /** All three goals met (a "perfect week" — gets a checkmark). */
  allMet: boolean;
}

/**
 * "Met" thresholds, matching the KPI gauges so the rings and gauges never
 * disagree: full weekly mileage, 60% of prescribed quality distance, 90% of the
 * planned long run.
 */
export const GOAL_GATES = { mileage: 1, quality: 0.6, long: 0.9 } as const;

/** Build a GoalStat from an actual/target pair and a gate fraction. */
export function goalStat(actualMeters: number, targetMeters: number, gate: number): GoalStat {
  return {
    actualMeters,
    targetMeters,
    hit: targetMeters > 0 && actualMeters >= gate * targetMeters,
    fraction: targetMeters > 0 ? Math.min(1, Math.max(0, actualMeters / targetMeters)) : 0,
  };
}

/** Per-plan-week mileage adherence status, driving the Week card's dot row. */
export type AdherenceStatus = 'hit' | 'miss' | 'current' | 'future';

/** The Week Adherence card's mileage verdict plus independent supporting reads. */
export interface AdherenceSummary {
  /** One status per week, oldest→newest — feeds the dot row. */
  statuses: AdherenceStatus[];
  /** Settled (non-current, non-future) week count — the headline's denominator. */
  settledN: number;
  /** Settled weeks that fulfilled the mileage contract. */
  hitN: number;
  /** Consecutive mileage-hit weeks counting back from the latest settled week. */
  streak: number;
  /** Settled weeks with a prescribed quality goal, and how many met its gate. */
  qualityPlannedN: number;
  qualityHitN: number;
  /** Settled weeks with a prescribed long-run goal, and how many met its gate. */
  longPlannedN: number;
  longHitN: number;
}

/**
 * Derive the primary adherence verdict from the weekly mileage contract. The
 * headline, streak, and dots all read `WeekGoal.mileage.hit`; quality and long
 * are counted separately so either can add context without nullifying mileage
 * already banked. `WeekGoal.allMet` remains available as an optional "perfect
 * week" distinction, but it is intentionally not the baseline adherence rule.
 */
export function adherenceSummary(weekGoals: WeekGoal[]): AdherenceSummary {
  const ordered = [...weekGoals].sort((a, b) => a.weekIndex - b.weekIndex);
  const statuses: AdherenceStatus[] = ordered.map((w) =>
    w.isFuture ? 'future' : w.isCurrent ? 'current' : w.mileage.hit ? 'hit' : 'miss',
  );
  const settled = statuses.filter((s) => s === 'hit' || s === 'miss');
  const settledWeeks = ordered.filter((w) => !w.isCurrent && !w.isFuture);
  const settledN = settled.length;
  const hitN = settled.filter((s) => s === 'hit').length;
  let streak = 0;
  for (let i = settled.length - 1; i >= 0; i--) {
    if (settled[i] === 'hit') streak += 1;
    else break;
  }
  const qualityWeeks = settledWeeks.filter((w) => w.quality.targetMeters > 0);
  const longWeeks = settledWeeks.filter((w) => w.long.targetMeters > 0);
  return {
    statuses,
    settledN,
    hitN,
    streak,
    qualityPlannedN: qualityWeeks.length,
    qualityHitN: qualityWeeks.filter((w) => w.quality.hit).length,
    longPlannedN: longWeeks.length,
    longHitN: longWeeks.filter((w) => w.long.hit).length,
  };
}
