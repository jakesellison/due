/**
 * The run_ww-trained ridge marathon-time model — a pure, node-tested linear
 * predictor in RAW feature space, replicated faithfully from the training-side
 * Python (`runww/features.py` + `build_features.py`).
 *
 * Training summary (see `runww/results.json`):
 *  - Trained on 14,497 real marathon training blocks (the run_ww corpus).
 *  - 80% conformal interval offset ±23.38 min (1402.88 s), verified coverage
 *    0.80 (split-conformal).
 *  - Cross-validated MAE 15.6 min (vs Tanda baseline 23.7 min) at the full-taper
 *    (cutoff 0) horizon — this is the strongest single in-app signal we have.
 *
 * The model is `pred = intercept + Σ weights[c]·feature[c]` over the EXACT
 * feature list/order in `model/ridge_model.json`, in RAW units (no
 * standardization — the JSON carries no scaler; coefficients live in raw space).
 * The result is finish_seconds.
 *
 * Feature semantics (must match the Python EXACTLY):
 *  - Window: the 16 weeks ending at `asOfDate`. For each run day,
 *    `days_before = (asOf − day)`, `wk = floor(days_before / 7)`, kept where
 *    `0 ≤ days_before < 7·16 = 112`. (Python uses `< cutoff`; our asOf is the
 *    latest data day, so `days_before ≥ 0` is the app analogue.)
 *  - Weekly km is the SUM of run distances per week index 0..15 (0 = most
 *    recent). Empty weeks are zero (they DO count in means).
 *  - Units: our distances are METRES → km (÷1000); our times are SECONDS.
 *    Python `duration` is MINUTES, and its pace is `dur·60/km` = s/km, so OUR
 *    pace is simply `seconds / km` (no ×60). Volume features are in km, pace
 *    features in s/km, time target in seconds. The classic km-vs-m / min-vs-s
 *    traps are called out at each conversion below.
 *
 * Demographics we do NOT collect (gender_M, age_18_34, age_35_54, age_55plus):
 * we IMPUTE the training-set medians shipped in the JSON (`feature_medians`),
 * which are the dataset cohort shares (gender_M median 1.0 → predominantly male
 * corpus; age_35_54 median 1.0). This is the documented neutral default; a real
 * user profile (gender/age) can replace these later — see `DemographicProfile`.
 *
 * Conventions: distances in metres on input, times in seconds, dates civil
 * 'YYYY-MM-DD'. Pure + deterministic — no Supabase, no React.
 */

import modelJson from './model/ridge_model.json';
import {
  steadyStateWindow,
} from './window';

/** Window length in weeks (matches Python `N_WEEKS = 16`). */
const N_WEEKS = 16;

/** A run reduced to what the ridge feature build reads. */
export interface PredictRun {
  /** Civil 'YYYY-MM-DD' the run is attributed to. */
  localDate: string;
  /** Run distance in METRES. */
  distanceMeters: number;
  /** Moving time in SECONDS, or null/undefined when unknown (pace-excluded). */
  movingTimeS?: number | null;
  /** Strava workout_type (1 = race), used to detect + exclude race blocks. */
  workoutType?: number | null;
}

/** The model artifact shape (RAW-space linear model + conformal offset). */
interface RidgeModel {
  features: string[];
  weights: Record<string, number>;
  intercept: number;
  feature_medians: Record<string, number>;
  conformal_offset_sec_80: number;
  target: string;
  note: string;
}

const MODEL = modelJson as RidgeModel;

/**
 * Optional demographic profile to override the imputed cohort medians. We do
 * not collect this today; when we do, pass it through `ridgeFeatures`/`predict`.
 */
export interface DemographicProfile {
  /** true = male (gender_M = 1), false = female (0). */
  male?: boolean;
  /** Age band; sets the matching one-hot to 1 and the others to 0. */
  ageBand?: '18_34' | '35_54' | '55plus';
}

/** The numeric (non-demographic) features, in the model's units. */
export interface RidgeFeatureValues {
  /** Mean weekly km over the 16-wk window (zero weeks INCLUDED). */
  wk_km_mean: number;
  /** Peak single-week km over the window. */
  wk_km_peak: number;
  /** Mean weekly km over the most recent 4 weeks (zero weeks included). */
  wk_km_last4: number;
  /** Mean weekly km over the most recent 8 weeks (Tanda K, zero weeks included). */
  tanda_K: number;
  /**
   * Distance-weighted training pace over the most recent 8 weeks, s/km (Tanda P).
   * NaN when there is no timed running in the last 8 weeks.
   */
  tanda_P: number;
  /** Longest single run in the window, km. */
  longest_day_km: number;
  /** Total run-days ÷ number of active weeks (run days per ACTIVE week). */
  run_days_per_wk: number;
  /** Active weeks ÷ 16 (fraction of weeks with any run). */
  consistency: number;
  /** Slope of weekly km vs chronological week index (positive = building). */
  ramp_slope: number;
  /** Last-2-weeks mean km ÷ peak week km (taper depth). NaN when peak is 0. */
  taper_ratio: number;
  /** Total km across the window. */
  total_km: number;
  /** Mean per-run distance across the window, km. */
  avg_run_dist: number;
  /**
   * Distance-weighted training pace over the WHOLE window, s/km.
   * NaN when there is no timed running.
   */
  pace_overall: number;
  /** Fraction of run-days that were ≥25 km (long-run share). */
  long_run_frac: number;
  /** Number of weeks (0..16) with any run. */
  n_weeks_active: number;
}

/** The full feature vector the model consumes, keyed by the model's names. */
export type RidgeFeatureVector = RidgeFeatureValues & {
  gender_M: number;
  age_18_34: number;
  age_35_54: number;
  age_55plus: number;
};

/** A ridge prediction with its conformal band and usability metadata. */
export interface RidgePrediction {
  /** Predicted marathon finish time, seconds. */
  seconds: number;
  /** Lower edge of the 80% conformal band (faster), seconds. */
  lowSeconds: number;
  /** Upper edge of the 80% conformal band (slower), seconds. */
  highSeconds: number;
  /** Whether the model had enough signal (≥6 active weeks AND real pace). */
  usable: boolean;
  /** Distinct active weeks (any run) in the 16-wk window. */
  coverageWeeks: number;
  /** The feature vector that fed the prediction (for inspection / the report). */
  features: RidgeFeatureVector;
}

/** The 80% conformal half-width offset (seconds), shipped in the artifact. */
export const RIDGE_CONFORMAL_OFFSET_S = MODEL.conformal_offset_sec_80;

/** Minimum active weeks before the ridge model is considered usable. */
export const RIDGE_MIN_ACTIVE_WEEKS = 6;

/**
 * Compute the ridge model's feature vector from `activities` as of `asOfDate`,
 * replicating `runww/features.py` / `build_features.py` semantics over the 16
 * weeks preceding the as-of day. Demographic one-hots default to the training
 * medians (cohort shares) unless `profile` overrides them.
 *
 * Pure + deterministic. Distances in metres on input, times in seconds.
 */
export function ridgeFeatures(
  activities: PredictRun[],
  asOfDate: string,
  profile?: DemographicProfile,
): RidgeFeatureVector {
  // Steady-state windowing: drop taper/race/recovery weeks around any detected
  // race and compact the surviving 16 ACTIVE weeks onto a contiguous timeline
  // ending at asOf (no-op when no race is detected). This keeps the volume/pace
  // features representative of real training rather than a race block's dip.
  const { runs: windowed } = steadyStateWindow(activities, asOfDate, N_WEEKS);
  activities = windowed;

  // Per-week aggregates over the 16-wk window. Index 0 = most recent 7 days.
  const km = new Array<number>(N_WEEKS).fill(0); // km summed per week
  const ndays = new Array<number>(N_WEEKS).fill(0); // run-days per week

  // Per-run-day accumulators across the whole window.
  let totalKm = 0;
  let totalDays = 0;
  let totalTimedSeconds = 0; // Σ moving time over timed runs (whole window)
  let totalTimedKm = 0; // Σ km over timed runs (whole window)
  let longestDayKm = 0;
  let nLong = 0; // run-days ≥ 25 km

  // Last-8-week pace accumulators (Tanda P).
  let last8TimedSeconds = 0;
  let last8TimedKm = 0;

  for (const r of activities) {
    if (!r.localDate) continue;
    const meters = r.distanceMeters;
    if (!(meters > 0)) continue; // mirror Python's `distance > 0` filter
    const daysBefore = civilDayDiff(asOfDate, r.localDate);
    if (daysBefore < 0 || daysBefore >= 7 * N_WEEKS) continue;
    const wk = Math.floor(daysBefore / 7); // 0..15

    // CONVERSION: metres → km (the classic m-vs-km trap lives here).
    const distKm = meters / 1000;

    km[wk]! += distKm;
    ndays[wk]! += 1;
    totalKm += distKm;
    totalDays += 1;
    if (distKm > longestDayKm) longestDayKm = distKm;
    if (distKm >= 25) nLong += 1;

    // Pace uses runs with both distance and (positive) moving time. Our time is
    // already SECONDS, so pace is seconds / km directly (Python multiplies its
    // MINUTES by 60 to reach the same s/km — do NOT ×60 here).
    if (r.movingTimeS != null && r.movingTimeS > 0) {
      totalTimedSeconds += r.movingTimeS;
      totalTimedKm += distKm;
      if (wk < 8) {
        last8TimedSeconds += r.movingTimeS;
        last8TimedKm += distKm;
      }
    }
  }

  const nActive = km.reduce((acc, v) => acc + (v > 0 ? 1 : 0), 0);

  const wk_km_mean = mean(km);
  const wk_km_peak = Math.max(...km);
  const wk_km_last4 = mean(km.slice(0, 4));
  const tanda_K = mean(km.slice(0, 8));

  // ramp slope: OLS slope of weekly km vs chronological week index. Python
  // reverses km (km[0]=newest) to chronological, fits vs [0..15]; slope > 0
  // means volume is building toward the race. Zero when km has no variance.
  const kmChrono = [...km].reverse();
  const ramp_slope = stdev(kmChrono) > 0 ? olsSlope(kmChrono) : 0;

  const peak = wk_km_peak;
  const taper_ratio = peak > 0 ? mean(km.slice(0, 2)) / peak : NaN;

  const tanda_P = last8TimedKm > 0 ? last8TimedSeconds / last8TimedKm : NaN;
  const pace_overall = totalTimedKm > 0 ? totalTimedSeconds / totalTimedKm : NaN;

  const avg_run_dist = totalDays > 0 ? totalKm / totalDays : NaN;
  const long_run_frac = totalDays > 0 ? nLong / totalDays : NaN;
  const run_days_per_wk = totalDays / Math.max(nActive, 1);
  const consistency = nActive / N_WEEKS;

  const demo = resolveDemographics(profile);

  return {
    wk_km_mean,
    wk_km_peak,
    wk_km_last4,
    tanda_K,
    tanda_P,
    longest_day_km: longestDayKm,
    run_days_per_wk,
    consistency,
    ramp_slope,
    taper_ratio,
    total_km: totalKm,
    avg_run_dist,
    pace_overall,
    long_run_frac,
    n_weeks_active: nActive,
    ...demo,
  };
}

/**
 * Predict the marathon finish time from `activities` as of `asOfDate` with the
 * RAW-space ridge model + its 80% conformal band. `usable` is false when there
 * are fewer than `RIDGE_MIN_ACTIVE_WEEKS` active weeks OR no training-pace
 * signal (tanda_P / pace_overall NaN) — the two inputs the model leans on most.
 *
 * Pure + deterministic.
 */
export function ridgePredict(
  activities: PredictRun[],
  asOfDate: string,
  profile?: DemographicProfile,
): RidgePrediction {
  const features = ridgeFeatures(activities, asOfDate, profile);
  const coverageWeeks = features.n_weeks_active;

  const seconds = scoreRidge(features);

  // Usable only with enough coverage AND a real pace signal. A NaN feature would
  // poison the dot product, so usability also guards arithmetic validity.
  const hasPace =
    Number.isFinite(features.pace_overall) && Number.isFinite(features.tanda_P);
  const usable =
    coverageWeeks >= RIDGE_MIN_ACTIVE_WEEKS && hasPace && Number.isFinite(seconds);

  return {
    seconds,
    lowSeconds: seconds - RIDGE_CONFORMAL_OFFSET_S,
    highSeconds: seconds + RIDGE_CONFORMAL_OFFSET_S,
    usable,
    coverageWeeks,
    features,
  };
}

/**
 * Score the RAW-space linear model: intercept + Σ weights[c]·feature[c] over the
 * model's exact feature order. NaN numeric features (e.g. no pace) fall back to
 * the training median so the dot product stays finite (callers gate on
 * `usable`, but a finite point estimate is still useful for inspection).
 */
export function scoreRidge(features: RidgeFeatureVector): number {
  let acc = MODEL.intercept;
  for (const name of MODEL.features) {
    const raw = (features as unknown as Record<string, number>)[name];
    const value =
      raw != null && Number.isFinite(raw) ? raw : MODEL.feature_medians[name]!;
    acc += MODEL.weights[name]! * value;
  }
  return acc;
}

/** Resolve the demographic one-hots from a profile, else the training medians. */
function resolveDemographics(profile?: DemographicProfile): {
  gender_M: number;
  age_18_34: number;
  age_35_54: number;
  age_55plus: number;
} {
  const m = MODEL.feature_medians;
  if (!profile) {
    // Imputed cohort shares from the training set (gender_M≈1, age_35_54≈1).
    return {
      gender_M: m.gender_M!,
      age_18_34: m.age_18_34!,
      age_35_54: m.age_35_54!,
      age_55plus: m.age_55plus!,
    };
  }
  const gender_M = profile.male == null ? m.gender_M! : profile.male ? 1 : 0;
  let age_18_34 = m.age_18_34!;
  let age_35_54 = m.age_35_54!;
  let age_55plus = m.age_55plus!;
  if (profile.ageBand) {
    age_18_34 = profile.ageBand === '18_34' ? 1 : 0;
    age_35_54 = profile.ageBand === '35_54' ? 1 : 0;
    age_55plus = profile.ageBand === '55plus' ? 1 : 0;
  }
  return { gender_M, age_18_34, age_35_54, age_55plus };
}

// ---------------------------------------------------------------------------
// Small numeric helpers (kept local + pure)
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length); // population std (matches numpy default)
}

/** OLS slope of `ys` against x = [0,1,2,...] (matches numpy polyfit deg-1). */
function olsSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ys[i]!;
    sxy += i * ys[i]!;
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

/**
 * Whole-day difference asOf − day in civil days (both 'YYYY-MM-DD'), tz-agnostic
 * via noon-UTC anchoring. Positive when `day` precedes `asOf`.
 */
function civilDayDiff(asOf: string, day: string): number {
  const a = new Date(`${asOf}T12:00:00Z`).getTime();
  const b = new Date(`${day}T12:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}
