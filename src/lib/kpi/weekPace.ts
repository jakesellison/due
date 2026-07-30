/**
 * weekPace.ts — "where should I be by now" for the in-progress week.
 *
 * Each pillar (mileage / quality / long) has a PACE expectation: the planned
 * distance on the week's days that have already elapsed (strictly BEFORE today).
 * Upcoming days contribute nothing, so a Sunday long run isn't "due" on a
 * Wednesday and a later quality day isn't "missing" yet — it's just not here yet.
 *
 * Two consumers share this one definition so the gauge tick and the realign
 * bullets can never disagree about what "behind pace" means:
 *   • the KPI gauges draw a tick at expected÷target (the yellow pace marker), and
 *   • the Dash realign card only flags quality/long as missing when the runner is
 *     actually behind their expected-by-now, not merely short of the week total.
 *
 * Pure. No IO. Node-tested. Quality/long filter to their workout type/tone.
 */
import type { CalendarDay } from './weekDays';
import {
  prescribedQualityMeters,
} from './prescribedQuality';

export interface PaceExpectation {
  /** Planned meters that should be banked coming INTO today (elapsed days). */
  mileageMeters: number;
  /** Prescribed QUALITY meters due by now. */
  qualityMeters: number;
  /** Planned LONG-run meters due by now. */
  longMeters: number;
}

const ZERO: PaceExpectation = { mileageMeters: 0, qualityMeters: 0, longMeters: 0 };

/**
 * Sum the planned distance on days strictly before today (today's own runs
 * aren't "overdue" yet). Anchored on the day flagged `isToday`; if no day in the
 * set is today (a past/future week was passed) returns all-zero, since pace is
 * only meaningful for the in-progress week.
 */
export function weekPaceExpectation(days: CalendarDay[]): PaceExpectation {
  const today = days.find((d) => d.isToday);
  if (!today) return ZERO;
  const acc: PaceExpectation = { mileageMeters: 0, qualityMeters: 0, longMeters: 0 };
  for (const d of days) {
    if (d.dayIndex >= today.dayIndex) continue; // today + upcoming — not yet due
    for (const w of d.workouts) {
      const m = w.plannedMeters ?? 0;
      acc.mileageMeters += m;
      // Quality is measured in PRESCRIBED HARD miles (e.g. 4×2mi → ~8mi), NOT the
      // full workout distance — the same metric the Quality gauge/goal use, so the
      // pace tick and the "missing quality" bullet stay on one scale.
      if (w.isQuality) {
        acc.qualityMeters += w.prescribedQualityMeters
          ?? prescribedQualityMeters(w.structure ?? [], m);
      }
      if (w.tone === 'long') acc.longMeters += m;
    }
  }
  return acc;
}
