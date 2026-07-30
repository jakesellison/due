/**
 * anchor.ts — Converts a dateless `RelativePlan` (Task 1) into the app's dated
 * `RawPlanDraft` given a single anchor input: either a race date or a start
 * date. This is the one place calendar dates enter the plan-import pipeline;
 * everything downstream (`normalizePlanDraft` → review UI → install RPC) already
 * consumes `RawPlanDraft` unchanged.
 *
 * Two anchor modes:
 *   • `start` — the plan runs at full length from the given date's Monday.
 *   • `race`  — the final week's race lands on race week; if the runner has
 *     fewer weeks than the plan is long, it trims from the FRONT (join late)
 *     and renumbers the kept weeks 1..n. Refuses when the room left is below
 *     the plan's `minWeeks` floor, or when the race is already in the past.
 *
 * When a race anchor is given, the final-week race workout snaps to the actual
 * race weekday even if it was authored on a different day; any workout that
 * would then land on or after race day is dropped with a warning.
 *
 * Pure except `todayIsoDate()`, the single impure helper screens call to obtain
 * "today" — anchor math itself takes an explicit `todayIso` so it stays testable.
 * Date arithmetic uses UTC-noon instants to dodge DST/offset drift (the same
 * idiom as `draft.ts`).
 */

import {
  weekStartOf,
} from '../time/week';
import type { RawPlanDraft } from './draft';
import type { RelativePlan } from './relative';

/** One civil day, in ms. Shared with the reverse (export) path in planExport. */
export const DAY_MS = 86400 * 1000;
/** UTC-noon instant of a civil date — DST/offset-proof date arithmetic anchor. */
export const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, d: number) => toIso(noon(iso) + d * DAY_MS);

export type PlanAnchor =
  | { kind: 'race'; raceDate: string }     // YYYY-MM-DD
  | { kind: 'start'; startDate: string };  // any date; snapped to its Monday

export interface AnchorOk {
  ok: true;
  draft: RawPlanDraft;        // dated; feed straight into normalizePlanDraft
  joinAtWeek: number | null;  // original 1-based week joined at; null = full plan
  keptWeeks: number;
  startDate: string;          // Monday
  raceDate: string | null;
  warnings: string[];
}

export interface AnchorTooClose {
  ok: false;
  reason: 'too-close' | 'race-past';
  weeksAvailable: number;
  minWeeks: number;
}

/** Impure: today's civil date, UTC. Screens pass this into `anchorPlan`. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The Monday AFTER the week containing `todayIso` — never today, even on a Monday. */
export function nextMondayIso(todayIso: string): string {
  return addDays(weekStartOf(todayIso, 'mon'), 7);
}

export function anchorPlan(
  plan: RelativePlan,
  anchor: PlanAnchor,
  todayIso: string,
): AnchorOk | AnchorTooClose {
  const { numWeeks, minWeeks } = plan.plan;
  const warnings: string[] = [];
  let startMonday: string;
  let keptWeeks = numWeeks;
  let raceDate: string | null = null;

  if (anchor.kind === 'race') {
    raceDate = anchor.raceDate;
    const raceWeekMonday = weekStartOf(raceDate, 'mon');
    const currentWeekMonday = weekStartOf(todayIso, 'mon');
    const weeksAvailable =
      Math.round((noon(raceWeekMonday) - noon(currentWeekMonday)) / (7 * DAY_MS)) + 1;
    if (noon(raceDate) < noon(todayIso)) {
      return { ok: false, reason: 'race-past', weeksAvailable, minWeeks };
    }
    keptWeeks = Math.min(numWeeks, weeksAvailable);
    if (keptWeeks < minWeeks) {
      return { ok: false, reason: 'too-close', weeksAvailable, minWeeks };
    }
    startMonday = addDays(raceWeekMonday, -7 * (keptWeeks - 1));
  } else {
    startMonday = weekStartOf(anchor.startDate, 'mon');
  }

  const joinAtWeek = keptWeeks < numWeeks ? numWeeks - keptWeeks + 1 : null;
  const firstKept = joinAtWeek ?? 1;
  const raceDow = raceDate
    ? Math.round((noon(raceDate) - noon(weekStartOf(raceDate, 'mon'))) / DAY_MS)
    : null;

  const weeks = plan.weeks
    .filter((w) => w.week >= firstKept)
    .map((w) => ({
      weekIndex: w.week - firstKept + 1,
      phase: w.phase,
      targetMeters: w.targetMeters,
      qualityTargetMeters: w.qualityTargetMeters,
      longTargetMeters: w.longTargetMeters,
      isRecovery: w.isRecovery,
    }));

  const workouts: NonNullable<RawPlanDraft['workouts']> = [];
  for (const w of plan.workouts) {
    if (w.week < firstKept) continue;
    const finalWeek = w.week === numWeeks;
    let day = w.day;
    if (finalWeek && raceDow != null) {
      if (w.type === 'race') {
        day = raceDow;
      } else if (w.day >= raceDow) {
        warnings.push(`Dropped "${w.title}" — it fell on or after race day.`);
        continue;
      }
    }
    workouts.push({
      date: addDays(startMonday, (w.week - firstKept) * 7 + day),
      type: w.type,
      title: w.title,
      plannedDistanceMeters: w.plannedDistanceMeters,
      plannedDurationSeconds: w.plannedDurationSeconds,
      structure: w.structure,
      notes: w.notes,
    });
  }

  // Start anchors have no given race date — derive it from where the race
  // workout landed so the draft (and downstream race outlook) still knows it.
  if (raceDate == null) {
    const raceWorkout = workouts.find((w) => w.type === 'race');
    raceDate = raceWorkout?.date ?? null;
  }

  const draft: RawPlanDraft = {
    source: plan.source,
    plan: {
      raceName: plan.plan.name,
      raceDate,
      distanceKind: plan.plan.distanceKind,
      goalTimeSeconds: plan.plan.goalTimeSeconds,
      startDate: startMonday,
      numWeeks: keptWeeks,
    },
    weeks,
    workouts,
    questions: plan.questions,
  };
  return { ok: true, draft, joinAtWeek, keptWeeks, startDate: startMonday, raceDate, warnings };
}
