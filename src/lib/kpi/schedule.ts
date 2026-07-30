/**
 * Schedule-aware "Showing up" semantics — the pure layer.
 *
 * The thesis of "Showing up" is consistency against what the PLAN asked of you.
 * That means rest days and future days must never count against the runner: a
 * scheduled rest day with no run is a success (the plan said rest), and a day
 * that hasn't happened yet (or today, before you've run) is simply unknown — not
 * a miss.
 *
 * Every function here is a deterministic transform over plain data (DB rows are
 * mapped to these inputs by the query hook), so it is node-testable — no
 * Supabase, no React. Dates are civil 'YYYY-MM-DD' throughout.
 *
 * Schedule per date:
 *  - 'run'     — a plan workout exists on the date with a non-rest type.
 *  - 'rest'    — the date is INSIDE the plan window but has no non-rest workout.
 *  - 'unknown' — the date is OUTSIDE any plan window (pre-plan history).
 */

import {
  addDays,
} from '../time/civil';

/** What the plan asked of a given civil date. */
export type DaySchedule = 'run' | 'rest' | 'unknown';

/** A planned workout reduced to the fields the schedule reads. */
export interface ScheduleWorkoutInput {
  /** Civil 'YYYY-MM-DD' of the planned workout. */
  date: string;
  /** Raw workout type ('easy' | 'long' | 'quality' | 'rest' | 'cross' | …). */
  type: string;
}

/** The inclusive civil-date span [from, to] covered by the plan. */
export interface PlanWindow {
  /** Inclusive 'YYYY-MM-DD' first day of the plan. */
  from: string;
  /** Inclusive 'YYYY-MM-DD' last day of the plan. */
  to: string;
}


/**
 * A schedule lookup: given a civil date, returns whether the plan scheduled a
 * run, a rest, or has no opinion (outside the plan window). Days inside the plan
 * window with no non-rest workout (no workout row, OR a 'rest'-typed row) are
 * REST; days outside the window are UNKNOWN.
 */
export interface Schedule {
  /** The schedule for a single civil date. */
  on(date: string): DaySchedule;
  /** Inclusive plan window, or null when no plan covers any date. */
  window: PlanWindow | null;
}

/**
 * Build a `Schedule` from the plan's workouts + the plan window. A date is a
 * 'run' day iff a non-rest workout falls on it; any other in-window date is
 * 'rest'; out-of-window dates are 'unknown'. Workouts whose `type` is 'rest'
 * (case-insensitive) never make a date a run day.
 */
export function buildSchedule(
  workouts: ScheduleWorkoutInput[],
  window: PlanWindow | null,
): Schedule {
  const runDates = new Set<string>();
  for (const w of workouts) {
    if (!w.date) continue;
    if ((w.type ?? '').toLowerCase() === 'rest') continue;
    runDates.add(w.date);
  }
  return {
    window,
    on(date: string): DaySchedule {
      if (window && date >= window.from && date <= window.to) {
        return runDates.has(date) ? 'run' : 'rest';
      }
      // A run date outside the declared window still counts as scheduled (the
      // plan explicitly placed a workout there); otherwise it's unknown.
      if (runDates.has(date)) return 'run';
      return 'unknown';
    },
  };
}

// ---------------------------------------------------------------------------
// Show-up rate (schedule-aware)
// ---------------------------------------------------------------------------

export interface ShowUpRate {
  /** Distinct days with ≥1 run that count toward the rate (numerator). */
  ran: number;
  /** Days that should have been run by now (denominator). */
  expected: number;
  /**
   * True when ≥80% of the window's elapsed days have a KNOWN schedule, so the
   * denominator is "scheduled days"; false → "days" (unknown-fallback wording).
   */
  scheduled: boolean;
}

export interface ShowUpRateOpts {
  /** Trailing window length in days (inclusive of today). */
  windowDays: number;
}

/**
 * Schedule-aware show-up rate over a trailing window ending today.
 *
 * Numerator: distinct days in the window with ≥1 activity that ALSO count toward
 * the denominator (so a run on a future date or a non-counted day doesn't inflate
 * the rate — runs land on real, elapsed, expected days).
 *
 * Denominator: window days that are
 *   (a) strictly before today, OR today-if-the-runner-ran-today, AND
 *   (b) scheduled — either a known 'run' day, OR (when the window predates the
 *       plan) an 'unknown'-schedule elapsed day (pre-plan history counts every
 *       elapsed day). Scheduled REST days and FUTURE days are excluded.
 *
 * Today never counts as a miss: it only enters the denominator if the runner ran
 * today (credit), never as an empty expected slot.
 *
 * Wording flag (`scheduled`): true when ≥80% of the window's elapsed days have a
 * KNOWN schedule (run or rest) — i.e. the window is plan-covered, so we say
 * "N of M scheduled days". Below that threshold the schedule is too sparse to
 * claim, so we fall back to "N of M days" counting all elapsed days.
 */
export function showUpRate(
  activityDates: string[],
  schedule: Schedule,
  today: string,
  opts: ShowUpRateOpts,
): ShowUpRate {
  const days = opts.windowDays;
  if (days <= 0) return { ran: 0, expected: 0, scheduled: false };

  const windowStart = addDays(today, -(days - 1));
  const ranSet = new Set<string>();
  for (const d of activityDates) {
    if (d >= windowStart && d <= today) ranSet.add(d);
  }

  // Classify every elapsed day in the window to decide the wording threshold.
  let elapsed = 0;
  let knownElapsed = 0;
  for (let d = windowStart; d <= today; d = addDays(d, 1)) {
    elapsed += 1;
    if (schedule.on(d) !== 'unknown') knownElapsed += 1;
  }
  const knownFraction = elapsed > 0 ? knownElapsed / elapsed : 0;
  const useScheduled = knownFraction >= 0.8;

  let ran = 0;
  let expected = 0;
  for (let d = windowStart; d <= today; d = addDays(d, 1)) {
    const isToday = d === today;
    const sched = schedule.on(d);
    const didRun = ranSet.has(d);

    // Does this day count toward the denominator?
    let counts: boolean;
    if (useScheduled) {
      // Scheduled mode: only known 'run' days count (rest excluded). Unknown
      // days don't count here (they're the rare minority below the threshold).
      counts = sched === 'run';
    } else {
      // Unknown-fallback: count every elapsed day regardless of schedule, EXCEPT
      // a known scheduled rest (a rest day is never a miss even in fallback).
      counts = sched !== 'rest';
    }
    if (!counts) continue;

    // Today only counts if the runner ran (credit), never as an empty miss.
    if (isToday && !didRun) continue;

    expected += 1;
    if (didRun) ran += 1;
  }

  return { ran, expected, scheduled: useScheduled };
}


// ---------------------------------------------------------------------------
// Sparkbar day state (four states)
// ---------------------------------------------------------------------------

/**
 * The visual state of a single sparkbar day cell:
 *  - 'ran'    — ≥1 activity (render the height-∝-miles bar).
 *  - 'missed' — an elapsed, scheduled run day with no activity (dim stub).
 *  - 'rest'   — a scheduled rest day with no activity (small neutral dot).
 *  - 'future' — a future day, or today-not-yet-run (near-invisible faint dot).
 */
export type SparkDayState = 'ran' | 'missed' | 'rest' | 'future';

/**
 * Classify a single day for the sparkbar, given whether it ran, its schedule and
 * its position relative to today.
 *
 * - Ran on the day → 'ran' (always; a run on a rest/future day is still a run).
 * - Future date → 'future' (near-invisible).
 * - Today with no run → 'future' (today is never a miss; it's pending).
 * - Scheduled rest (or unknown) with no run, in the past → 'rest' (neutral dot —
 *   never a miss). Unknown pre-plan days collapse to the calm rest dot rather
 *   than screaming "missed" against a schedule we don't know.
 * - Scheduled run, elapsed, no run → 'missed' (dim stub).
 */
export function sparkDayState(
  didRun: boolean,
  sched: DaySchedule,
  date: string,
  today: string,
): SparkDayState {
  if (didRun) return 'ran';
  if (date > today) return 'future';
  if (date === today) return 'future'; // pending — never a miss
  // Strictly past, no run:
  if (sched === 'run') return 'missed';
  // Scheduled rest, or unknown pre-plan day → calm neutral dot, not a miss.
  return 'rest';
}
