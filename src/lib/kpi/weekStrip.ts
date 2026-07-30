/**
 * Week Strip (Dash) — the pure mapping layer for the Runna-style seven-chip week
 * row. Given one week's planned workouts, the user's activities, and today, this
 * derives seven chip models (Mon→Sun) the `<WeekStrip/>` component renders.
 *
 * NO new matching logic lives here: distances are summed per civil date the same
 * way the schedule / sparkbar layers already do (sum-by-date), and the chip state
 * reuses the same "today counts only in your favor" rule the rest of the app
 * honours — a today with no run yet is PENDING (planned shown), never a miss.
 *
 * Every function is a deterministic transform over plain data (DB rows mapped to
 * these inputs by the query hook), so it is node-testable — no Supabase, no React.
 * Civil dates are 'YYYY-MM-DD' throughout; the week is Monday-started.
 */

import {
  weekStartOf,
  type WeekStart,
} from '../time/week';
import {
  addDays,
} from '../time/civil';

/** A planned workout reduced to the fields the strip reads. */
export interface WeekStripWorkoutInput {
  /** The workout id (for the tap destination). */
  id: string;
  /** Civil 'YYYY-MM-DD' of the planned workout. */
  date: string;
  /** Raw workout type ('easy' | 'long' | 'quality' | 'rest' | 'race' | …). */
  type: string;
  /** Planned distance (meters); 0/absent when none. */
  plannedMeters: number;
  /** Quality-day flag (drives the volt accent alongside race). */
  isQuality: boolean;
}

/** An activity reduced to the fields the strip reads. */
export interface WeekStripActivityInput {
  /** The activity id (for the tap destination of an unplanned run). */
  id: string;
  /** Civil 'YYYY-MM-DD' of the activity. */
  localDate: string;
  /** Activity distance (meters). */
  distanceMeters: number;
}

/** The visual state of a single week-strip chip. */
export type WeekStripState =
  /** ≥1 activity on the day — filled ink chip, ACTUAL miles. */
  | 'done'
  /** Today, scheduled, not yet run — outlined chip, PLANNED miles. */
  | 'today-pending'
  /** A future scheduled run day — quiet chip, planned miles. */
  | 'upcoming'
  /** An elapsed scheduled run day with no run — dim chip. */
  | 'missed'
  /** A scheduled rest day (no run) — near-empty chip with a centered dot. */
  | 'rest';

/** Where tapping a chip should navigate. */
export type WeekStripTarget =
  | { kind: 'workout'; id: string }
  | { kind: 'run'; id: string }
  | { kind: 'none' };

/** One Mon→Sun chip in the week strip. */
export interface WeekStripDay {
  /** Civil 'YYYY-MM-DD' of this chip. */
  localDate: string;
  /** 0 = Monday .. 6 = Sunday. */
  dayIndex: number;
  /** Single-letter day initial (M T W T F S S). */
  initial: string;
  state: WeekStripState;
  /** Summed PLANNED meters across the day's workouts (0 when none / rest). */
  plannedMeters: number;
  /** Summed ACTUAL meters across the day's activities (0 when none). */
  actualMeters: number;
  /** True when any workout that day is a quality or race day (volt accent). */
  isQuality: boolean;
  /** True when the day is the race day. */
  isRace: boolean;
  /** True when the day carries ≥2 runs OR ≥2 planned workouts (a double). */
  isDouble: boolean;
  /** True for today's chip. */
  isToday: boolean;
  /** The tap destination (workout > unplanned run > none). */
  target: WeekStripTarget;
}

const INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];


/**
 * Map one week (the week CONTAINING `weekStartDate`, Monday-started) to its seven
 * chip models. `weekStartDate` may be any date in the target week — it is snapped
 * to the Monday — so callers can pass a plan-week start or `today`.
 *
 * State rules (no run on the day unless stated):
 *  - any activity on the date → 'done' (actual miles win; a run on a rest/future
 *    day is still 'done').
 *  - the date is today, scheduled run, no run → 'today-pending' (planned shown;
 *    today is never a miss).
 *  - a future scheduled run day → 'upcoming'.
 *  - an elapsed (strictly past) scheduled run day, no run → 'missed'.
 *  - a rest day (no non-rest workout) with no run → 'rest', whether past or
 *    future (the plan said rest — calm, never a miss).
 *
 * Tap destination: the day's workout (quality/race preferred when several) when a
 * planned workout exists; else the (largest) unplanned run on the day; else none.
 */
export function weekStripDays(
  workouts: WeekStripWorkoutInput[],
  activities: WeekStripActivityInput[],
  today: string,
  opts: { weekStart?: WeekStart; weekStartDate?: string } = {},
): WeekStripDay[] {
  const weekStart = opts.weekStart ?? 'mon';
  const anchor = opts.weekStartDate ?? today;
  const monday = weekStartOf(anchor, weekStart);

  // Index inputs by civil date.
  const woByDate = new Map<string, WeekStripWorkoutInput[]>();
  for (const w of workouts) {
    if (!w.date) continue;
    if ((w.type ?? '').toLowerCase() === 'rest') continue; // rest rows aren't runs
    const arr = woByDate.get(w.date) ?? [];
    arr.push(w);
    woByDate.set(w.date, arr);
  }
  const actByDate = new Map<string, WeekStripActivityInput[]>();
  for (const a of activities) {
    if (!a.localDate) continue;
    const arr = actByDate.get(a.localDate) ?? [];
    arr.push(a);
    actByDate.set(a.localDate, arr);
  }

  const days: WeekStripDay[] = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(monday, d);
    const dayWorkouts = woByDate.get(date) ?? [];
    const dayActivities = actByDate.get(date) ?? [];
    const isToday = date === today;

    const plannedMeters = dayWorkouts.reduce((s, w) => s + (w.plannedMeters || 0), 0);
    const actualMeters = dayActivities.reduce((s, a) => s + (a.distanceMeters || 0), 0);

    const isRace = dayWorkouts.some((w) => (w.type ?? '').toLowerCase() === 'race');
    const isQuality = isRace || dayWorkouts.some((w) => w.isQuality);
    const isDouble = dayActivities.length >= 2 || dayWorkouts.length >= 2;

    const didRun = dayActivities.length > 0;
    const hasPlannedRun = dayWorkouts.length > 0;

    let state: WeekStripState;
    if (didRun) {
      state = 'done';
    } else if (!hasPlannedRun) {
      // No non-rest workout scheduled → a rest day (calm, never a miss).
      state = 'rest';
    } else if (isToday) {
      state = 'today-pending';
    } else if (date < today) {
      state = 'missed';
    } else {
      state = 'upcoming';
    }

    days.push({
      localDate: date,
      dayIndex: d,
      initial: INITIALS[d] as string,
      state,
      plannedMeters,
      actualMeters,
      isQuality,
      isRace,
      isDouble,
      isToday,
      target: tapTarget(dayWorkouts, dayActivities),
    });
  }

  return days;
}

/**
 * Resolve a chip's tap destination. A planned workout wins (quality/race
 * preferred when several share the date); otherwise the largest unplanned run on
 * the day; otherwise nothing (a bare rest / empty future day is a no-op).
 */
function tapTarget(
  dayWorkouts: WeekStripWorkoutInput[],
  dayActivities: WeekStripActivityInput[],
): WeekStripTarget {
  if (dayWorkouts.length > 0) {
    const preferred =
      dayWorkouts.find((w) => (w.type ?? '').toLowerCase() === 'race') ??
      dayWorkouts.find((w) => w.isQuality) ??
      dayWorkouts[0]!;
    return { kind: 'workout', id: preferred.id };
  }
  if (dayActivities.length > 0) {
    const largest = [...dayActivities].sort(
      (a, b) => (b.distanceMeters || 0) - (a.distanceMeters || 0),
    )[0]!;
    return { kind: 'run', id: largest.id };
  }
  return { kind: 'none' };
}
