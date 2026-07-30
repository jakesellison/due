/**
 * Tanda (2011) marathon-time model — a pure, node-tested, deterministic
 * transform over plain run arrays. No Supabase, no React.
 *
 * Tanda, G. (2011). "Prediction of marathon performance time on the basis of
 * training indices." Journal of Human Sport and Exercise, 6(3), 511–520.
 * Fitting marathon finishers' GPS logs, Tanda found marathon race pace is well
 * predicted by just two training indices computed over the ~8 weeks BEFORE the
 * race:
 *
 *     Pm = 17.1 + 140.0 · exp(−0.0053 · K) + 0.55 · P
 *
 *   Pm — predicted marathon race pace, seconds per kilometre
 *   K  — mean weekly distance over the window, kilometres per week
 *   P  — mean training pace over the window, seconds per kilometre
 *
 * Marathon time is then Pm · 42.195. Higher weekly volume (K) lowers Pm
 * (the exp term shrinks), and a faster average training pace (smaller P) lowers
 * Pm. The constants are Tanda's published fit — do NOT tune them here.
 *
 * Conventions match the rest of the lib: distances in meters on input, pace in
 * seconds-per-kilometre, dates civil 'YYYY-MM-DD'.
 */

import {
  weekStartOf,
} from '../time/week';
import {
  steadyStateWindow,
} from './window';

/** Marathon distance in metres (the IAAF 42.195 km). */
export const MARATHON_METERS = 42195;

/** Tanda's window in weeks (8 ≈ the published ~8-week training block). */
const TANDA_WEEKS = 8;

/** Tanda's published coefficients (do not tune). */
const TANDA_A = 17.1; // constant term (s/km)
const TANDA_B = 140.0; // amplitude of the volume term (s/km)
const TANDA_C = 0.0053; // volume decay (per km/week)
const TANDA_D = 0.55; // training-pace weight (dimensionless)

/** Tanda inputs over the preceding window. */
export interface TandaInputs {
  /** Mean weekly distance over the window (km/week), zero weeks INCLUDED. */
  weeklyKmMean: number;
  /** Distance-weighted mean training pace over the window (s/km). */
  paceSecPerKmMean: number;
}

/**
 * Tanda's predicted marathon race pace `Pm` (s/km) from the two training
 * indices. Pure formula — see the module header for the citation.
 */
export function tandaMarathonPaceSecPerKm({
  weeklyKmMean,
  paceSecPerKmMean,
}: TandaInputs): number {
  return TANDA_A + TANDA_B * Math.exp(-TANDA_C * weeklyKmMean) + TANDA_D * paceSecPerKmMean;
}

/**
 * Tanda's predicted marathon finish time in seconds: the predicted race pace
 * (s/km) times the marathon distance in km (42.195).
 */
export function tandaMarathonSeconds(inputs: TandaInputs): number {
  return tandaMarathonPaceSecPerKm(inputs) * (MARATHON_METERS / 1000);
}

/** The minimal run shape the Tanda input derivation reads. */
export interface PredictRun {
  /** Civil 'YYYY-MM-DD' the run is attributed to. */
  localDate: string;
  /** Run distance in metres. */
  distanceMeters: number;
  /** Moving time in seconds, or null/undefined when unknown (then pace-excluded). */
  movingTimeS?: number | null;
  /** Strava workout_type (1 = race), used to detect + exclude race blocks. */
  workoutType?: number | null;
}

/** What `tandaInputsFromActivities` returns alongside the two indices. */
export interface TandaInputsDerived extends TandaInputs {
  /** Number of runs that contributed to the pace mean (have distance + time). */
  nRuns: number;
  /**
   * Number of distinct calendar weeks (Monday-anchored) in the window that carry
   * at least one run — a coverage signal the ensemble uses for confidence.
   */
  coverage: number;
}

/**
 * Derive Tanda's two training indices from a flat run list, as of `asOfDate`,
 * over the preceding `windowDays` (default 56 = ~8 weeks, Tanda's window). Pure
 * and deterministic.
 *
 *  - The window is the inclusive civil-date span [asOf − (windowDays−1), asOf].
 *  - `weeklyKmMean` averages weekly kilometres over the FULL set of weeks the
 *    window spans, INCLUDING weeks with zero running (a down week or a gap must
 *    drag the mean down — that's the whole point of the volume index). The week
 *    count is the number of Monday-anchored weeks the window touches.
 *  - `paceSecPerKmMean` is the DISTANCE-WEIGHTED mean training pace over runs
 *    that carry both distance and moving time: Σ(time) / Σ(distance_km). This is
 *    exactly the pace of the aggregate distance, so a 20 km run counts ~2× a
 *    10 km run, matching how Tanda's "mean training pace" weights the block.
 *  - `coverage` counts the distinct weeks that have any run (for confidence).
 *
 * Returns zeros when the window is empty; callers gate on `nRuns`/`coverage`.
 */
export function tandaInputsFromActivities(
  runs: PredictRun[],
  asOfDate: string,
  windowDays = 56,
): TandaInputsDerived {
  // Tanda assumes STEADY-STATE training: its two indices (mean weekly volume +
  // mean training pace) describe a representative block, NOT a taper/race/
  // recovery cycle. Drop the weeks around any detected race and compact the
  // surviving 8 active weeks onto a contiguous timeline ending at asOf, so the
  // volume mean reflects real training (no-op when no race is detected).
  const { runs: windowed } = steadyStateWindow(runs, asOfDate, TANDA_WEEKS);
  runs = windowed;

  const from = shiftCivil(asOfDate, -(windowDays - 1));
  const to = asOfDate;

  let totalMeters = 0;
  let paceMeters = 0; // distance over runs that ALSO have moving time
  let paceSeconds = 0;
  let nRuns = 0;
  const weeksWithRun = new Set<string>();

  for (const r of runs) {
    if (!r.localDate || r.localDate < from || r.localDate > to) continue;
    const meters = r.distanceMeters;
    if (!(meters > 0)) continue;
    totalMeters += meters;
    weeksWithRun.add(weekStartOf(r.localDate, 'mon'));
    if (r.movingTimeS != null && r.movingTimeS > 0) {
      paceMeters += meters;
      paceSeconds += r.movingTimeS;
      nRuns += 1;
    }
  }

  // Weekly mean over the FULL span of weeks the window touches (zero weeks in).
  const weekSpan = weekSpanCount(from, to);
  const weeklyKmMean = weekSpan > 0 ? totalMeters / 1000 / weekSpan : 0;

  // Distance-weighted mean pace = total time / total distance (km) over runs
  // with both fields. Σtime / Σkm is the pace of the aggregate, i.e. weighting
  // each run by its distance.
  const paceSecPerKmMean = paceMeters > 0 ? paceSeconds / (paceMeters / 1000) : 0;

  return {
    weeklyKmMean,
    paceSecPerKmMean,
    nRuns,
    coverage: weeksWithRun.size,
  };
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC, tz-agnostic). */
function shiftCivil(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * The number of distinct Monday-anchored weeks the inclusive span [from, to]
 * touches — i.e. how many calendar weeks the Tanda window covers, so the weekly
 * mean divides by every week including empty ones.
 */
function weekSpanCount(from: string, to: string): number {
  if (to < from) return 0;
  const firstWeek = weekStartOf(from, 'mon');
  const lastWeek = weekStartOf(to, 'mon');
  const a = new Date(`${firstWeek}T12:00:00Z`).getTime();
  const b = new Date(`${lastWeek}T12:00:00Z`).getTime();
  const weeks = Math.round((b - a) / (7 * 86_400_000)) + 1;
  return Math.max(1, weeks);
}
