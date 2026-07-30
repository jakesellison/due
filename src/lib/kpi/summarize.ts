import {
  bandFor,
  paceStatus,
  type Band,
} from './band';
import {
  buildSchedule,
  showUpRate as scheduleShowUpRate,
  sparkDayState,
  type PlanWindow,
  type SparkDayState,
} from './schedule';
import {
  weekStartOf,
  weekElapsedFraction,
  completedWeekFraction,
  type WeekStart,
} from '../time/week';
import {
  addDays,
} from '../time/civil';
import type { Phase } from '../plan/generate';
import type { WorkoutTone } from '../workout/structureBar';

/** Map a raw workout type + quality flag to a strip tone (for SparkDay colour). */
const TONE_RANK: Record<WorkoutTone, number> = { quality: 3, speed: 3, long: 2, easy: 1 };
function toneOf(type: string | undefined, isQuality: boolean): WorkoutTone {
  const t = (type ?? '').toLowerCase();
  if (t === 'long') return 'long';
  if (t === 'speed') return 'speed';
  if (isQuality || t === 'quality') return 'quality';
  return 'easy';
}

/**
 * Pure, in-memory KPI derivation for the Dash screen.
 *
 * Takes the raw plan weeks + workouts + activities (already fetched from the DB)
 * and computes everything the Dash needs to render:
 *  - the weekly plan-vs-actual array for the hero chart,
 *  - the current-week KPI tile values (mileage + quality),
 *  - the consistency heatmap cells (one per day, last N weeks).
 *
 * It does NOT touch Supabase or React — it is a deterministic function over
 * plain data so it can be unit-tested under the `node` jest project. Banding,
 * week math and unit conversion are delegated to the existing domain functions
 * (`bandFor`, `weekStartOf`) — nothing is reimplemented here.
 */

export interface SummaryWeekInput {
  weekIndex: number;
  phase: Phase;
  /** Civil 'YYYY-MM-DD' week-start (Monday) for this plan week. */
  weekStart: string;
  targetMeters: number;
  isRecovery: boolean;
}

export interface SummaryWorkoutInput {
  /** Civil 'YYYY-MM-DD' of the planned workout. */
  date: string;
  isQuality: boolean;
  /**
   * Raw workout type ('easy' | 'long' | 'quality' | 'rest' | 'cross' | …), used
   * for schedule-aware "Showing up" semantics (a 'rest' type is not a run day).
   * Optional for back-compat with callers that don't need the schedule.
   */
  type?: string;
}

export interface SummaryActivityInput {
  /** Civil 'YYYY-MM-DD' the activity is attributed to. */
  localDate: string;
  distanceMeters: number;
}

export interface SummarizeOpts {
  weekStart?: WeekStart;
  /** Amber floor passed through to bandFor (default 0.9). */
  amber?: number;
  /** How many trailing weeks the heatmap shows (default 4). */
  heatmapWeeks?: number;
}

/** One bar in the hero weekly-mileage chart. */
export interface WeeklyBar {
  weekIndex: number;
  phase: Phase;
  targetMeters: number;
  actualMeters: number;
  /** Full-week band (actual vs full target). */
  band: Band;
  /**
   * The band to colour progress with. For past/future weeks this equals `band`;
   * for the IN-PROGRESS current week it is the prorated "on pace" band so a
   * mid-week tile/bar isn't punished against the full weekly target.
   */
  paceBand: Band;
  isRecovery: boolean;
  /** True for the plan week that contains `today`. */
  isCurrent: boolean;
  /** True for weeks strictly after the current week (planned-only). */
  isFuture: boolean;
}

/** Distance bucket 0..4 (0 = rest, 1..4 = volume greens low->high). */
export type DistanceBucket = 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  localDate: string;
  /** 0 = Monday .. 6 = Sunday (for weekStart 'mon'). */
  dayIndex: number;
  bucket: DistanceBucket;
  isQuality: boolean;
  isToday: boolean;
}

export interface HeatmapRow {
  /** 'YYYY-MM-DD' week start for this row. */
  weekStart: string;
  /** Label like 'W1' (oldest) .. 'W4' (current). */
  label: string;
  cells: HeatmapCell[];
}

export interface CurrentWeekKpi {
  weekIndex: number;
  phase: Phase;
  isRecovery: boolean;
  targetMeters: number;
  actualMeters: number;
  /** Full-week band (actual vs full target) — kept for back-compat. */
  band: Band;
  /** Fraction 0..1 of target met, clamped to [0,1] for the tile bar fill. */
  fraction: number;
  /** Fraction 0..1 of the week elapsed by end of `today`. */
  elapsedFraction: number;
  /** Prorated "on pace" band (actual vs pace line). Use this on the Dash/Plan. */
  paceBand: Band;
  /** The prorated target you should have hit by now (meters). */
  paceLineMeters: number;
  qualityPlanned: number;
  qualityCompleted: number;
  /** Prescribed quality DISTANCE (meters) for the week's quality workout (the
   *  tile denominator; 0 when none planned). Patched in by the weekly query's
   *  on-the-fly detection — summarizeBlock has no streams/floor, so it sets 0. */
  qualityMetersPlanned: number;
  /** Detected hard-running distance (meters) banked this week (the tile numerator). */
  qualityMetersCompleted: number;
  /** The week's long-run distance (meters) — the longest planned run (the third
   *  KPI denominator; 0 when none planned). Patched by the weekly query, which
   *  has per-workout distances; summarizeBlock sets 0. */
  longMetersPlanned: number;
  /** The longest single run actually banked this week (meters) — the long-run
   *  numerator. Day-arrangement-negotiable: any day's longest run counts. */
  longMetersCompleted: number;
}

export interface BlockSummary {
  weeks: WeeklyBar[];
  current: CurrentWeekKpi | null;
  heatmap: HeatmapRow[];
}

/**
 * Bucket a day's total distance into 0..4 against the easy-day reference.
 * Thresholds are fractions of `referenceMeters` (a typical easy run). Tuned so
 * a rest day is 0, a short shake-out is 1, a normal easy run is 2, a longer run
 * is 3 and a long run / big day is 4.
 */
export function bucketForDistance(meters: number, referenceMeters: number): DistanceBucket {
  if (meters <= 0) return 0;
  const ref = referenceMeters > 0 ? referenceMeters : 1;
  const r = meters / ref;
  if (r < 0.6) return 1;
  if (r < 1.1) return 2;
  if (r < 1.7) return 3;
  return 4;
}

export function summarizeBlock(
  weeks: SummaryWeekInput[],
  workouts: SummaryWorkoutInput[],
  activities: SummaryActivityInput[],
  today: string,
  opts: SummarizeOpts = {},
): BlockSummary {
  const weekStart = opts.weekStart ?? 'mon';
  const heatmapWeeks = opts.heatmapWeeks ?? 4;

  // Sum activity distance per (attributed) week-start.
  const actualByWeekStart = new Map<string, number>();
  for (const a of activities) {
    const ws = weekStartOf(a.localDate, weekStart);
    actualByWeekStart.set(ws, (actualByWeekStart.get(ws) ?? 0) + a.distanceMeters);
  }

  const todayWeekStart = weekStartOf(today, weekStart);
  const elapsedFraction = weekElapsedFraction(today, weekStart);
  const paceFraction = completedWeekFraction(today, weekStart);

  const ordered = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex);

  const weeklyBars: WeeklyBar[] = ordered.map((w) => {
    const actualMeters = actualByWeekStart.get(w.weekStart) ?? 0;
    const isCurrent = w.weekStart === todayWeekStart;
    const isFuture = w.weekStart > todayWeekStart;
    const band = bandFor(actualMeters, w.targetMeters, { amber: opts.amber });
    // The current (in-progress) week is banded against its prorated pace line so
    // it isn't punished mid-week; past/future weeks use the full-target band.
    const paceBand = isCurrent
      ? paceStatus(actualMeters, w.targetMeters, paceFraction, { amber: opts.amber }).band
      : band;
    return {
      weekIndex: w.weekIndex,
      phase: w.phase,
      targetMeters: w.targetMeters,
      actualMeters,
      band,
      paceBand,
      isRecovery: w.isRecovery,
      isCurrent,
      isFuture,
    };
  });

  // Current-week KPI tile.
  const currentWeek = ordered.find((w) => w.weekStart === todayWeekStart) ?? null;
  let current: CurrentWeekKpi | null = null;
  if (currentWeek) {
    const actualMeters = actualByWeekStart.get(currentWeek.weekStart) ?? 0;
    // Quality counts for the current week.
    const weekEnd = addDays(currentWeek.weekStart, 6);
    const weekQualityWorkouts = workouts.filter(
      (wk) => wk.isQuality && wk.date >= currentWeek.weekStart && wk.date <= weekEnd,
    );
    const qualityPlanned = weekQualityWorkouts.length;
    // A quality day counts completed if there was any activity on its date.
    const activityDates = new Set(activities.map((a) => a.localDate));
    const qualityCompleted = weekQualityWorkouts.filter((wk) => activityDates.has(wk.date)).length;
    const fraction =
      currentWeek.targetMeters > 0
        ? Math.min(1, Math.max(0, actualMeters / currentWeek.targetMeters))
        : 0;
    const pace = paceStatus(actualMeters, currentWeek.targetMeters, paceFraction, {
      amber: opts.amber,
    });
    current = {
      weekIndex: currentWeek.weekIndex,
      phase: currentWeek.phase,
      isRecovery: currentWeek.isRecovery,
      targetMeters: currentWeek.targetMeters,
      actualMeters,
      band: bandFor(actualMeters, currentWeek.targetMeters, { amber: opts.amber }),
      fraction,
      elapsedFraction,
      paceBand: pace.band,
      paceLineMeters: pace.paceLineMeters,
      qualityPlanned,
      qualityCompleted,
      // Quality distance is detected on the fly (needs streams + the runner's
      // quality floor), which summarizeBlock doesn't have — the weekly query
      // patches these from detectWeekQuality. Default to 0 here.
      qualityMetersPlanned: 0,
      qualityMetersCompleted: 0,
      // The long run needs per-workout distances the weekly query holds; patched
      // there. Default to 0 here.
      longMetersPlanned: 0,
      longMetersCompleted: 0,
    };
  }

  // Heatmap: the last `heatmapWeeks` weeks up to and including the current week.
  // Reference for bucketing = median easy distance from the plan (target/7 of a
  // mid week), approximated as the average of per-week target/6 across weeks.
  const refMeters = referenceEasyMeters(ordered);
  const distanceByDate = new Map<string, number>();
  for (const a of activities) {
    distanceByDate.set(a.localDate, (distanceByDate.get(a.localDate) ?? 0) + a.distanceMeters);
  }
  const qualityDates = new Set(workouts.filter((w) => w.isQuality).map((w) => w.date));

  const heatmap: HeatmapRow[] = [];
  for (let i = heatmapWeeks - 1; i >= 0; i--) {
    const rowStart = addDays(todayWeekStart, -7 * i);
    const cells: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(rowStart, d);
      const dist = distanceByDate.get(date) ?? 0;
      cells.push({
        localDate: date,
        dayIndex: d,
        bucket: bucketForDistance(dist, refMeters),
        isQuality: qualityDates.has(date),
        isToday: date === today,
      });
    }
    const label = `W${heatmapWeeks - i}`;
    heatmap.push({ weekStart: rowStart, label, cells });
  }

  return { weeks: weeklyBars, current, heatmap };
}

// ---------------------------------------------------------------------------
// Week Sparkbars (consistency) derivation — option B of the approved mock.
// ---------------------------------------------------------------------------

/** One day's mini-bar within a sparkbar week row. */
export interface SparkDay {
  localDate: string;
  /** 0 = Monday .. 6 = Sunday (for weekStart 'mon'). */
  dayIndex: number;
  /** This day's total distance (meters). */
  distanceMeters: number;
  /**
   * Bar height as a fraction 0..1, max-normalized across ALL visible days in the
   * window. A zero-distance day is 0 (the component renders a non-bar marker).
   */
  heightFraction: number;
  isZero: boolean;
  isQuality: boolean;
  /** Strip tone of the day's (most notable) planned workout — colours the cell. */
  tone: WorkoutTone;
  isToday: boolean;
  /**
   * Four-state day visual: 'ran' (bar), 'missed' (elapsed scheduled run, no
   * activity → dim stub), 'rest' (scheduled rest, no activity → neutral dot),
   * 'future' (future day, or today-not-yet-run → near-invisible faint dot).
   */
  state: SparkDayState;
}

/** A verdict for a sparkbar week's right column. */
export type SparkVerdict = 'hit' | 'short' | 'inProgress';

/** One recent week as a row of seven day bars + a weekly total/target verdict. */
export interface SparkWeek {
  weekStart: string;
  /** The matching plan week's 1-based index, or null if the window predates it. */
  weekIndex: number | null;
  /** Label like 'W2' (oldest visible) .. 'W5' (current). */
  label: string;
  days: SparkDay[];
  totalMeters: number;
  targetMeters: number;
  /** True for the in-progress week containing `today`. */
  isCurrent: boolean;
  /** 'hit' when actual ≥ target; 'inProgress' for the current week; else 'short'. */
  verdict: SparkVerdict;
  /** Signed meters vs target (negative = behind). Only meaningful for 'short'. */
  deficitMeters: number;
}

export interface SparkSummary {
  weeks: SparkWeek[];
  /** Schedule-aware numerator: distinct expected days the runner showed up. */
  showUpDays: number;
  /** Schedule-aware denominator: days the runner was expected to show up. */
  showUpExpected: number;
  /**
   * True when the denominator is "scheduled days" (window plan-covered, ≥80%
   * known schedule); false → "days" (unknown-schedule fallback wording).
   */
  showUpScheduled: boolean;
  /** Window length in days (weeks × 7). */
  windowDays: number;
  /** How many fully-elapsed (non-current) visible weeks hit target. */
  weeksHit: number;
  /** How many visible weeks are settled (non-current). */
  weeksSettled: number;
}

export interface WeekDayBarsOpts {
  weekStart?: WeekStart;
  /** How many trailing weeks to show (default 4). */
  weeks?: number;
  /**
   * Inclusive plan window [from, to], for schedule-aware day states + show-up.
   * When omitted, every in-window day reads as 'unknown' schedule (so a missing
   * window degrades to "no rest credit" rather than crashing).
   */
  planWindow?: PlanWindow | null;
}

/**
 * Derive the Week Sparkbars view — one row per recent week (last `weeks`), each
 * a row of seven day bars whose heights are the day's distance max-normalized
 * across the whole visible window, plus the weekly total/target and a verdict.
 *
 * Pure and deterministic over plain data (DB rows are mapped to these inputs by
 * the query hook), so it is node-testable. Target per visible week comes from
 * the matching plan week's `targetMeters` (0 when the window predates the plan).
 */
export function weekDayBars(
  weeks: SummaryWeekInput[],
  workouts: SummaryWorkoutInput[],
  activities: SummaryActivityInput[],
  today: string,
  opts: WeekDayBarsOpts = {},
): SparkSummary {
  const weekStart = opts.weekStart ?? 'mon';
  const nWeeks = opts.weeks ?? 4;

  const distanceByDate = new Map<string, number>();
  for (const a of activities) {
    distanceByDate.set(a.localDate, (distanceByDate.get(a.localDate) ?? 0) + a.distanceMeters);
  }
  const qualityDates = new Set(workouts.filter((w) => w.isQuality).map((w) => w.date));
  // Most-notable planned tone per date (quality/speed > long > easy) → cell colour.
  const toneByDate = new Map<string, WorkoutTone>();
  for (const w of workouts) {
    const t = toneOf(w.type, w.isQuality);
    const prev = toneByDate.get(w.date);
    if (prev == null || TONE_RANK[t] > TONE_RANK[prev]) toneByDate.set(w.date, t);
  }
  const targetByWeekStart = new Map(weeks.map((w) => [w.weekStart, w.targetMeters]));
  const weekIndexByStart = new Map(weeks.map((w) => [w.weekStart, w.weekIndex]));

  // Schedule (run/rest/unknown per date) from the plan's workout types + window.
  const schedule = buildSchedule(
    workouts.map((w) => ({ date: w.date, type: w.type ?? (w.isQuality ? 'quality' : 'easy') })),
    opts.planWindow ?? null,
  );

  const todayWeekStart = weekStartOf(today, weekStart);

  // First pass: collect every visible day's distance to find the window max.
  const rowStarts: string[] = [];
  for (let i = nWeeks - 1; i >= 0; i--) {
    rowStarts.push(addDays(todayWeekStart, -7 * i));
  }
  let windowMax = 0;
  for (const rowStart of rowStarts) {
    for (let d = 0; d < 7; d++) {
      const dist = distanceByDate.get(addDays(rowStart, d)) ?? 0;
      if (dist > windowMax) windowMax = dist;
    }
  }
  const norm = windowMax > 0 ? windowMax : 1;

  // Schedule-aware show-up rate over the full visible window (ending today).
  const windowStart = rowStarts[0]!;
  const windowDays = daysBetweenInclusive(windowStart, today);
  const activityDates: string[] = [];
  for (const [date, dist] of distanceByDate) if (dist > 0) activityDates.push(date);
  const rate = scheduleShowUpRate(activityDates, schedule, today, { windowDays });

  let weeksHit = 0;
  let weeksSettled = 0;

  const sparkWeeks: SparkWeek[] = rowStarts.map((rowStart, ri) => {
    const isCurrent = rowStart === todayWeekStart;
    const isFuture = rowStart > todayWeekStart;
    let totalMeters = 0;
    const days: SparkDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(rowStart, d);
      const dist = distanceByDate.get(date) ?? 0;
      totalMeters += dist;
      const didRun = dist > 0;
      days.push({
        localDate: date,
        dayIndex: d,
        distanceMeters: dist,
        heightFraction: didRun ? dist / norm : 0,
        isZero: dist <= 0,
        isQuality: qualityDates.has(date),
        tone: toneByDate.get(date) ?? 'easy',
        isToday: date === today,
        state: sparkDayState(didRun, schedule.on(date), date, today),
      });
    }
    const targetMeters = targetByWeekStart.get(rowStart) ?? 0;
    const settled = !isCurrent && !isFuture;
    let verdict: SparkVerdict;
    if (isCurrent || isFuture) {
      verdict = 'inProgress';
    } else if (targetMeters <= 0 || totalMeters >= targetMeters) {
      verdict = 'hit';
    } else {
      verdict = 'short';
    }
    if (settled) {
      weeksSettled += 1;
      if (verdict === 'hit') weeksHit += 1;
    }
    return {
      weekStart: rowStart,
      weekIndex: weekIndexByStart.get(rowStart) ?? null,
      label: `W${ri + 1}`,
      days,
      totalMeters,
      targetMeters,
      isCurrent,
      verdict,
      deficitMeters: totalMeters - targetMeters,
    };
  });

  return {
    weeks: sparkWeeks,
    showUpDays: rate.ran,
    showUpExpected: rate.expected,
    showUpScheduled: rate.scheduled,
    windowDays: nWeeks * 7,
    weeksHit,
    weeksSettled,
  };
}

/** Inclusive day count between two civil dates (1 when equal). */
function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * A reference easy-run distance used to bucket heatmap cells. We take the
 * median weekly target and divide by 6 (a typical run-days-per-week count).
 */
function referenceEasyMeters(weeks: SummaryWeekInput[]): number {
  if (weeks.length === 0) return 12000; // ~7.5mi fallback
  const targets = weeks.map((w) => w.targetMeters).sort((a, b) => a - b);
  const mid = targets[Math.floor(targets.length / 2)] ?? 0;
  return mid > 0 ? mid / 6 : 12000;
}
