/**
 * Steady-state feature windowing — drop the taper / race / recovery weeks that
 * surround a detected race so the volume/pace feature windows reflect the
 * runner's STEADY-STATE training, not the artificial dip of a race block.
 *
 * Rationale (documented): both Tanda and the ridge model assume the feature
 * window is ~representative steady-state training. A marathon block ends with a
 * sharp taper (volume cut 40–60%), the race itself (one very long, very hard
 * day), and 1–3 weeks of low-volume recovery. If those weeks fall inside the
 * 16-week (ridge) / 8-week (Tanda) window they drag the volume mean far below
 * the runner's real fitness — exactly the contamination that made the subject's
 * prediction read 3:08 off a 62.6 km/wk mean when his real steady state is
 * 91–124 km/wk. We therefore EXCLUDE, for each detected race:
 *   · the week of the race,
 *   · the 1 week BEFORE it (taper),
 *   · the 2 weeks AFTER it (recovery),
 * then compute features over the most-recent N ACTIVE (any-run) weeks that
 * remain, looking back up to `MAX_LOOKBACK_WEEKS` to find enough clean weeks.
 *
 * The mechanism: we don't change the downstream feature math. Instead we select
 * the clean calendar weeks and COMPACT the surviving runs onto a contiguous
 * timeline ending at `asOfDate`, so the existing 0..N week-indexing in ridge /
 * Tanda reads the kept weeks as if they were consecutive. Empty (no-run) clean
 * weeks are preserved as gaps so zero-week means stay honest.
 *
 * Pure + deterministic. Dates civil 'YYYY-MM-DD'.
 */

import {
  weekStartOf,
} from '../time/week';
import {
  detectRaceResults,
  type RaceCandidate,
} from './races';

/** How many weeks back we'll look to gather enough clean active weeks. */
export const MAX_LOOKBACK_WEEKS = 24;

/** Weeks excluded AFTER a race (recovery). */
const RECOVERY_WEEKS_AFTER = 2;

/** Weeks excluded BEFORE a race (taper). */
const TAPER_WEEKS_BEFORE = 1;

/** A run with the fields windowing + the downstream feature builds read. */
export interface WindowRun {
  localDate: string;
  distanceMeters: number;
  movingTimeS?: number | null;
  elapsedTimeS?: number | null;
  workoutType?: number | null;
}

/** Result of compacting clean weeks onto a contiguous timeline. */
export interface SteadyWindow<T extends WindowRun> {
  /**
   * The surviving runs, each with its `localDate` REMAPPED onto a contiguous
   * timeline ending at `asOfDate` (most-recent clean week → the asOf week, the
   * next clean week back → the prior calendar week, etc.). Downstream week
   * indexing then reads the clean weeks as consecutive.
   */
  runs: T[];
  /** The civil week-start dates (Mon) excluded as taper/race/recovery. */
  excludedWeekStarts: string[];
  /** Whether any race was detected (and thus any exclusion applied). */
  hadRace: boolean;
}

/**
 * Build a steady-state window of `nWeeks` clean active weeks from `activities`
 * as of `asOfDate`, dropping taper/race/recovery weeks around every detected
 * race. Returns runs remapped onto a contiguous timeline (see `SteadyWindow`).
 *
 * When NO race is detected the input runs pass through UNCHANGED (same dates),
 * so behaviour is identical to today for race-free histories.
 */
export function steadyStateWindow<T extends WindowRun>(
  activities: T[],
  asOfDate: string,
  nWeeks: number,
): SteadyWindow<T> {
  const races = detectRaceResults(activities as RaceCandidate[], asOfDate);
  if (races.length === 0) {
    return { runs: activities, excludedWeekStarts: [], hadRace: false };
  }

  // Excluded week-starts: race week ± taper/recovery, for every race.
  const excluded = new Set<string>();
  for (const r of races) {
    const raceWeek = weekStartOf(r.date, 'mon');
    for (let w = -TAPER_WEEKS_BEFORE; w <= RECOVERY_WEEKS_AFTER; w++) {
      excluded.add(shiftWeek(raceWeek, w));
    }
  }

  // Bucket runs by their Monday week-start.
  const byWeek = new Map<string, T[]>();
  for (const a of activities) {
    if (!a.localDate || a.localDate > asOfDate) continue;
    const ws = weekStartOf(a.localDate, 'mon');
    (byWeek.get(ws) ?? byWeek.set(ws, []).get(ws)!).push(a);
  }

  // Walk back from the asOf week, skipping excluded weeks, collecting clean
  // weeks (active OR empty) until we have `nWeeks` ACTIVE weeks or exhaust the
  // lookback. We keep empty clean weeks as gaps so zero-week means stay honest.
  const asOfWeek = weekStartOf(asOfDate, 'mon');
  const keptWeeks: { source: string; runs: T[] }[] = [];
  let activeKept = 0;
  for (let back = 0; back < MAX_LOOKBACK_WEEKS && activeKept < nWeeks; back++) {
    const ws = shiftWeek(asOfWeek, -back);
    if (excluded.has(ws)) continue; // taper/race/recovery — drop entirely
    const runs = byWeek.get(ws) ?? [];
    keptWeeks.push({ source: ws, runs });
    if (runs.length > 0) activeKept += 1;
  }

  // Compact: map the kept weeks onto a contiguous timeline ending at the asOf
  // week. keptWeeks[0] is the most-recent clean week → asOf week (offset 0);
  // keptWeeks[k] → asOf week minus k weeks. Within a week, preserve each run's
  // day-of-week so intra-week spacing is unchanged.
  const remapped: T[] = [];
  for (let k = 0; k < keptWeeks.length; k++) {
    const targetWeek = shiftWeek(asOfWeek, -k);
    for (const run of keptWeeks[k]!.runs) {
      const dow = dayOffsetInWeek(run.localDate);
      remapped.push({ ...run, localDate: shiftDays(targetWeek, dow) });
    }
  }

  return {
    runs: remapped,
    excludedWeekStarts: [...excluded].sort(),
    hadRace: true,
  };
}

/** Days (0..6) from the Monday week-start to this civil date. */
function dayOffsetInWeek(localDate: string): number {
  const ws = weekStartOf(localDate, 'mon');
  return civilDayDiff(localDate, ws);
}

/** Whole-day difference a − b in civil days (both 'YYYY-MM-DD'). */
function civilDayDiff(a: string, b: string): number {
  const ta = new Date(`${a}T12:00:00Z`).getTime();
  const tb = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((ta - tb) / 86_400_000);
}

/** Shift a week-start by `n` weeks. */
function shiftWeek(weekStart: string, n: number): string {
  return shiftDays(weekStart, n * 7);
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC, tz-agnostic). */
function shiftDays(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
