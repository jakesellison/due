/**
 * Ridge **v2** — the run_ww-trained marathon-time model extended with three
 * feature families on top of v1's 19 base features, a pure node-tested linear
 * predictor in RAW feature space, replicated faithfully from the training-side
 * Python (`runww/features_v2.py` + `ridge_model_v2.json`).
 *
 * Training summary (see `runww/results_v2.json`):
 *  - Trained on 14,497 real marathon training blocks (the run_ww corpus).
 *  - Cross-validated MAE 14.43 min at the full-taper (cutoff 0) horizon — the
 *    strongest single in-app signal we have (v1 was 15.6 min).
 *  - 80% conformal interval offset ±21.6 min (1293.55 s), verified coverage 0.80
 *    (split-conformal).
 *  - 39 features = v1's 19 base + F1 intensity (7) + F2 anchors (7) + F3 history
 *    (6). Verified raw-space reproduction max-abs-err 1.5e-11 s.
 *
 * The model is `pred = intercept + Σ weights[c]·feature[c]` over the EXACT
 * feature list in `model/ridge_model_v2.json`, in RAW units (no standardization).
 * Missing/NaN features impute `feature_medians[c]`. The result is finish_seconds.
 *
 * CRITICAL — DAY-AGGREGATION SEMANTICS. The model was trained on DAY-aggregated
 * rows: all of an athlete's runs on one civil day are summed (distance + duration)
 * into a single "day" with `pace = Σduration / Σdistance`. We have BETTER than
 * day grain (per-run records), so the F1/F3 builds here FIRST aggregate our runs
 * per civil day before computing any pace/intensity/history feature — otherwise
 * the per-run paces drift from the training semantics (e.g. a 2 km warmup + a
 * 13 km tempo on the same day is ONE 15 km day at a blended pace, not two days).
 *
 * Units: our distances are METRES → km (÷1000); our times are SECONDS. Python
 * `duration` is MINUTES and its pace is `dur·60/km` = s/km, so OUR pace is simply
 * `seconds / km` (no ×60). Volume features km, pace features s/km, target seconds.
 *
 * The v1 base features (`wk_km_mean` … `n_weeks_active` + demographics) are reused
 * verbatim from `ridge.ts` so the two models share one definition. F2 anchors
 * reuse `detectRaceResults` (races.ts). v1 stays around as an instant fallback.
 *
 * Pure + deterministic — no Supabase, no React. Distances metres in, times
 * seconds in, dates civil 'YYYY-MM-DD'.
 */

import modelJson from './model/ridge_model_v2.json';
import {
  ridgeFeatures,
  type PredictRun,
  type DemographicProfile,
  type RidgeFeatureVector,
} from './ridge';
import {
  detectRaceResults,
  type RaceCandidate,
} from './races';
import {
  MARATHON_METERS,
} from './tanda';

/** F1 intensity window length (weeks) — matches Python `N_WEEKS = 16`. */
const F1_WEEKS = 16;

/** Riegel exponent the training-side `riegel()` uses. */
const RIEGEL_EXP = 1.06;
const MARA_KM = MARATHON_METERS / 1000; // 42.195

/** The model artifact shape (RAW-space linear model + conformal offset). */
interface RidgeV2Model {
  features: string[];
  weights: Record<string, number>;
  intercept: number;
  feature_medians: Record<string, number>;
  conformal_offset_sec_80: number;
  target: string;
  version: string;
  note: string;
}

const MODEL = modelJson as RidgeV2Model;

/** The 80% conformal half-width offset (seconds), shipped in the v2 artifact. */
export const RIDGE_V2_CONFORMAL_OFFSET_S = MODEL.conformal_offset_sec_80;

/** Minimum active weeks before the v2 model is considered usable (mirrors v1). */
export const RIDGE_V2_MIN_ACTIVE_WEEKS = 6;

// ---------------------------------------------------------------------------
// Feature-family value shapes
// ---------------------------------------------------------------------------

/** F1 — benchmark / hard-effort intensity vs the athlete's OWN 16-wk baseline. */
export interface F1Features {
  /** Duration-weighted median DAY-pace (s/km), excluding hard days (1 iter). */
  baseline_easy_pace: number;
  /** Count of distinct DAYS with a hard run in the 16-wk window. */
  n_hard_days_16wk: number;
  /** Fraction of window km run on hard days. */
  hard_km_frac: number;
  /** Fastest DAY-aggregate pace among days totaling ≥8 km (s/km). */
  best_day_pace_8k: number;
  /** Fastest DAY-aggregate pace among days totaling ≥15 km (s/km). */
  best_sustained_15k: number;
  /** 10th-percentile of DAY paces (s/km) — a fast-tail proxy. */
  pace_p10: number;
  /** baseline_easy_pace − pace_p10 (s/km) — easy↔hard spread. */
  intensity_spread: number;
}

/** F2 — prior-race anchors (the "Boston effect"). */
export interface F2Features {
  /** Most-recent prior MARATHON finish (s), else NaN (→ median impute). */
  prior_marathon_seconds: number;
  /** Days since that prior marathon, else NaN. */
  days_since_prior_marathon: number;
  /** Most-recent prior race of ANY distance, Riegel-scaled to marathon (s). */
  prior_race_riegel_seconds: number;
  /** Days since that prior race, else NaN. */
  days_since_prior_race: number;
  /** Count of detected prior races strictly before asOf. */
  n_prior_races: number;
  /** 1.0 when a prior marathon exists, else 0.0. */
  has_prior_marathon: number;
  /** 1.0 when any prior race exists, else 0.0. */
  has_prior_race: number;
}

/** F3 — deep history beyond the 16-wk window (32-wk, year-to-date, prior block). */
export interface F3Features {
  /** Total km over the most recent 32 weeks. */
  km_32wk: number;
  /** Total km over all available history (≈ year-to-date). */
  km_year_to_date: number;
  /** Mean weekly km over the prior block (weeks 16..31 before asOf). */
  wk_km_mean_16_32: number;
  /** Peak single-week km over the whole available history. */
  peak_week_year: number;
  /** Count of weeks with any running over the whole available history. */
  weeks_active_year: number;
  /** Recent-16wk mean ÷ prior-16-32wk mean (volume trajectory). */
  volume_trend: number;
}

/** The full v2 feature vector the model consumes, keyed by the model's names. */
export type RidgeV2FeatureVector = RidgeFeatureVector &
  F1Features &
  F2Features &
  F3Features;

/** A v2 prediction with its conformal band and usability metadata. */
export interface RidgeV2Prediction {
  /** Predicted marathon finish time, seconds. */
  seconds: number;
  /** Lower edge of the 80% conformal band (faster), seconds. */
  lowSeconds: number;
  /** Upper edge of the 80% conformal band (slower), seconds. */
  highSeconds: number;
  /** Whether the model had enough signal (≥6 active weeks AND real pace). */
  usable: boolean;
  /** Distinct active weeks (any run) in the 16-wk base window. */
  coverageWeeks: number;
  /** The feature vector that fed the prediction (for inspection / the report). */
  features: RidgeV2FeatureVector;
}

// ---------------------------------------------------------------------------
// Day aggregation — the load-bearing semantic for F1/F3
// ---------------------------------------------------------------------------

/** A civil-day-aggregated run: summed distance + summed timed duration. */
export interface DayRow {
  /** Civil 'YYYY-MM-DD'. */
  localDate: string;
  /** Σ distance over the day, km. */
  distKm: number;
  /** Σ moving time over TIMED runs that day, seconds (0 when none timed). */
  timedSeconds: number;
  /** Σ distance over TIMED runs that day, km (0 when none timed). */
  timedKm: number;
}

/**
 * Aggregate per-run records into one row per civil day (sum distance, sum timed
 * duration) — the grain the v2 model was trained on. Runs with distance ≤ 0 are
 * dropped (mirrors Python's `distance > 0`). Timed totals only include runs with
 * a positive moving time so a day's pace is `timedSeconds / timedKm`. PURE.
 */
export function aggregateByDay(runs: PredictRun[]): DayRow[] {
  const byDay = new Map<string, DayRow>();
  for (const r of runs) {
    if (!r.localDate) continue;
    const meters = r.distanceMeters;
    if (!(meters > 0)) continue;
    const distKm = meters / 1000;
    let row = byDay.get(r.localDate);
    if (!row) {
      row = { localDate: r.localDate, distKm: 0, timedSeconds: 0, timedKm: 0 };
      byDay.set(r.localDate, row);
    }
    row.distKm += distKm;
    if (r.movingTimeS != null && r.movingTimeS > 0) {
      row.timedSeconds += r.movingTimeS;
      row.timedKm += distKm;
    }
  }
  return [...byDay.values()];
}

/**
 * A day's pace (s/km) from its aggregated totals: `Σduration / Σdistance` over
 * the day's TIMED running, or NaN when the day had no timed running. Matches the
 * training-side `pace = duration_sec / distance_km` on a day-aggregated row.
 */
function dayPace(d: DayRow): number {
  return d.timedKm > 0 ? d.timedSeconds / d.timedKm : NaN;
}

/** Days within `[0, 7·weeks)` civil days before `asOf`, with a finite pace. */
function pacedDaysInWindow(days: DayRow[], asOf: string, weeks: number): {
  day: DayRow;
  pace: number;
}[] {
  const out: { day: DayRow; pace: number }[] = [];
  for (const d of days) {
    const before = civilDayDiff(asOf, d.localDate);
    if (before < 0 || before >= 7 * weeks) continue;
    const pace = dayPace(d);
    if (!Number.isFinite(pace)) continue;
    out.push({ day: d, pace });
  }
  return out;
}

// ---------------------------------------------------------------------------
// F1 — intensity vs own baseline (DAY-aggregated, 16-wk window)
// ---------------------------------------------------------------------------

/**
 * Duration-weighted median day-pace over the window, excluding detected hard days
 * (ONE iteration), exactly mirroring Python `_baseline_easy_pace`. Hard day :=
 * `pace ≤ 0.90·base AND distKm ≥ 5`. The duration weight is the day's TIMED
 * seconds (Python weights by `duration`, which is the timed minutes). Returns NaN
 * for an empty window.
 */
function baselineEasyPace(paced: { day: DayRow; pace: number }[]): number {
  if (paced.length === 0) return NaN;
  const paces = paced.map((p) => p.pace);
  const weights = paced.map((p) => p.day.timedSeconds); // duration weight
  const base0 = weightedMedian(paces, weights);
  if (!Number.isFinite(base0)) return NaN;
  // Hard day := ≥10% faster than baseline AND ≥5 km.
  const keptPaces: number[] = [];
  const keptWeights: number[] = [];
  for (const { day, pace } of paced) {
    const hard = pace <= 0.9 * base0 && day.distKm >= 5;
    if (!hard) {
      keptPaces.push(pace);
      keptWeights.push(day.timedSeconds);
    }
  }
  if (keptPaces.length >= 3) {
    const base1 = weightedMedian(keptPaces, keptWeights);
    if (Number.isFinite(base1)) return base1;
  }
  return base0;
}

/**
 * F1 features from the day-aggregated rows over the 16-wk window. Mirrors
 * `features_v2.f1_features`. All paces are DAY-aggregate paces (s/km).
 */
export function f1Features(days: DayRow[], asOf: string): F1Features {
  const f: F1Features = {
    baseline_easy_pace: NaN,
    n_hard_days_16wk: 0,
    hard_km_frac: NaN,
    best_day_pace_8k: NaN,
    best_sustained_15k: NaN,
    pace_p10: NaN,
    intensity_spread: NaN,
  };
  const paced = pacedDaysInWindow(days, asOf, F1_WEEKS);
  if (paced.length === 0) return f;

  const base = baselineEasyPace(paced);
  f.baseline_easy_pace = base;
  if (!Number.isFinite(base)) return f;

  let totalKm = 0;
  let hardKm = 0;
  let nHard = 0;
  let bestDay8k = Infinity;
  let bestSustained15k = Infinity;
  const paces: number[] = [];
  for (const { day, pace } of paced) {
    paces.push(pace);
    totalKm += day.distKm;
    const hard = pace <= 0.9 * base && day.distKm >= 5;
    if (hard) {
      nHard += 1;
      hardKm += day.distKm;
    }
    if (day.distKm >= 8 && pace < bestDay8k) bestDay8k = pace;
    if (day.distKm >= 15 && pace < bestSustained15k) bestSustained15k = pace;
  }
  f.n_hard_days_16wk = nHard;
  f.hard_km_frac = totalKm > 0 ? hardKm / totalKm : NaN;
  if (Number.isFinite(bestDay8k)) f.best_day_pace_8k = bestDay8k;
  if (Number.isFinite(bestSustained15k)) f.best_sustained_15k = bestSustained15k;
  f.pace_p10 = percentile(paces, 10);
  f.intensity_spread = base - f.pace_p10;
  return f;
}

// ---------------------------------------------------------------------------
// F2 — prior-race anchors (reuses detectRaceResults from races.ts)
// ---------------------------------------------------------------------------

/** Riegel time-scale from `dFromKm` to the marathon, matching training-side. */
function riegelToMarathon(seconds: number, dFromKm: number): number {
  return seconds * Math.pow(MARA_KM / dFromKm, RIEGEL_EXP);
}

/**
 * F2 features from the user's history as of `asOf`. Reuses `detectRaceResults`
 * (Strava race tag OR round-distance hard effort) — the app analogue of the
 * training-side WMM/template detection — then mirrors `f2_features_for_race`:
 * the most-recent prior race of ANY distance is Riegel-scaled to the marathon,
 * and the most-recent prior MARATHON supplies the marathon anchor. Missing
 * features stay NaN/0 and are median-imputed at scoring time.
 *
 * `detectRaceResults` returns races on/before `asOf`, newest-first.
 */
export function f2Features(activities: RaceCandidate[], asOf: string): F2Features {
  const f: F2Features = {
    prior_marathon_seconds: NaN,
    days_since_prior_marathon: NaN,
    prior_race_riegel_seconds: NaN,
    days_since_prior_race: NaN,
    n_prior_races: 0,
    has_prior_marathon: 0,
    has_prior_race: 0,
  };
  const races = detectRaceResults(activities, asOf);
  // Strictly-prior: exclude any race dated on `asOf` itself (the target day is
  // never a feature input — mirrors the Python `datetime < cutoff`).
  const prior = races.filter((r) => r.date < asOf);
  if (prior.length === 0) return f;

  f.n_prior_races = prior.length;
  f.has_prior_race = 1;

  // Most-recent ANY-distance prior race → Riegel to marathon (prior is sorted
  // newest-first by detectRaceResults).
  const last = prior[0]!;
  f.prior_race_riegel_seconds = riegelToMarathon(last.seconds, last.distanceMeters / 1000);
  f.days_since_prior_race = civilDayDiff(asOf, last.date);

  // Most-recent prior MARATHON.
  const lastMarathon = prior.find((r) => r.distanceClass === 'marathon');
  if (lastMarathon) {
    f.prior_marathon_seconds = lastMarathon.seconds;
    f.days_since_prior_marathon = civilDayDiff(asOf, lastMarathon.date);
    f.has_prior_marathon = 1;
  }
  return f;
}

// ---------------------------------------------------------------------------
// F3 — deep history (DAY-aggregated, up to 32wk + year-to-date)
// ---------------------------------------------------------------------------

/**
 * F3 deep-history features from ALL day-aggregated rows before `asOf`, mirroring
 * `features_v2.f3_features`. Uses whatever history exists: with < 32 wk of data
 * the windowed sums simply cover fewer weeks, and the model's medians impute
 * reasonably for partial history (documented in the spec). Weekly buckets are by
 * `floor(daysBefore / 7)`.
 */
export function f3Features(days: DayRow[], asOf: string): F3Features {
  const f: F3Features = {
    km_32wk: NaN,
    km_year_to_date: NaN,
    wk_km_mean_16_32: NaN,
    peak_week_year: NaN,
    weeks_active_year: 0,
    volume_trend: NaN,
  };
  const pre = days
    .map((d) => ({ d, before: civilDayDiff(asOf, d.localDate) }))
    .filter((x) => x.before >= 0); // strictly-before grain: asOf data still counts (before≥0)
  if (pre.length === 0) return f;

  let kmYtd = 0;
  let km32 = 0;
  let kmPriorBlock = 0; // weeks 16..31
  let kmRecent16 = 0; // weeks 0..15
  const weekKm = new Map<number, number>();
  for (const { d, before } of pre) {
    kmYtd += d.distKm;
    if (before < 7 * 32) km32 += d.distKm;
    if (before >= 7 * 16 && before < 7 * 32) kmPriorBlock += d.distKm;
    if (before < 7 * 16) kmRecent16 += d.distKm;
    const wk = Math.floor(before / 7);
    weekKm.set(wk, (weekKm.get(wk) ?? 0) + d.distKm);
  }
  f.km_year_to_date = kmYtd;
  f.km_32wk = km32;

  const hasPriorBlock = pre.some((x) => x.before >= 7 * 16 && x.before < 7 * 32);
  if (hasPriorBlock) f.wk_km_mean_16_32 = kmPriorBlock / 16;

  if (weekKm.size > 0) {
    let peak = 0;
    let active = 0;
    for (const km of weekKm.values()) {
      if (km > peak) peak = km;
      if (km > 0) active += 1;
    }
    f.peak_week_year = peak;
    f.weeks_active_year = active;
  }

  // Volume trend: recent-16wk mean ÷ prior-16-32wk mean (NaN when no prior block).
  const recentMean = kmRecent16 / 16;
  const priorMean = f.wk_km_mean_16_32;
  if (priorMean != null && Number.isFinite(priorMean) && priorMean > 0) {
    f.volume_trend = recentMean / priorMean;
  }
  return f;
}

// ---------------------------------------------------------------------------
// Full v2 feature build + prediction
// ---------------------------------------------------------------------------

/**
 * Compute the full 39-feature v2 vector from `activities` as of `asOfDate`.
 *
 * The 19 base features come from v1's `ridgeFeatures` (steady-state windowing,
 * per-run grain — that's its trained semantic). F1 + F3 are DAY-aggregated (the
 * v2 training grain). F2 reuses race detection. Demographic one-hots default to
 * the v1 training medians unless `profile` overrides.
 *
 * Pure + deterministic. Distances metres in, times seconds in.
 */
export function ridgeV2Features(
  activities: PredictRun[],
  asOfDate: string,
  profile?: DemographicProfile,
): RidgeV2FeatureVector {
  // Base 19 (v1 semantics, incl. steady-state windowing + demographics).
  const base = ridgeFeatures(activities, asOfDate, profile);

  // F1 + F3 over DAY-aggregated rows (the v2 training grain). We aggregate the
  // RAW activities (not the steady-state-windowed ones) per civil day so the
  // history/intensity families see the real calendar.
  const days = aggregateByDay(activities);
  const f1 = f1Features(days, asOfDate);
  const f3 = f3Features(days, asOfDate);

  // F2 anchors from race detection over the raw activities.
  const f2 = f2Features(activities as RaceCandidate[], asOfDate);

  return { ...base, ...f1, ...f2, ...f3 };
}

/**
 * Score the RAW-space v2 linear model: `intercept + Σ weights[c]·feature[c]` over
 * the model's exact feature order. NaN numeric features fall back to the training
 * median so the dot product stays finite (callers gate on `usable`).
 */
export function scoreRidgeV2(features: RidgeV2FeatureVector): number {
  let acc = MODEL.intercept;
  for (const name of MODEL.features) {
    const raw = (features as unknown as Record<string, number>)[name];
    const value =
      raw != null && Number.isFinite(raw) ? raw : MODEL.feature_medians[name]!;
    acc += MODEL.weights[name]! * value;
  }
  return acc;
}

/**
 * Predict the marathon finish time with ridge **v2** + its 80% conformal band.
 * Same contract as v1 `ridgePredict`: `usable` is false with fewer than
 * `RIDGE_V2_MIN_ACTIVE_WEEKS` active weeks OR no training-pace signal (pace_overall
 * / tanda_P NaN), the two base inputs the model leans on most.
 *
 * Pure + deterministic.
 */
export function ridgeV2Predict(
  activities: PredictRun[],
  asOfDate: string,
  profile?: DemographicProfile,
): RidgeV2Prediction {
  const features = ridgeV2Features(activities, asOfDate, profile);
  const coverageWeeks = features.n_weeks_active;
  const seconds = scoreRidgeV2(features);

  const hasPace =
    Number.isFinite(features.pace_overall) && Number.isFinite(features.tanda_P);
  const usable =
    coverageWeeks >= RIDGE_V2_MIN_ACTIVE_WEEKS && hasPace && Number.isFinite(seconds);

  return {
    seconds,
    lowSeconds: seconds - RIDGE_V2_CONFORMAL_OFFSET_S,
    highSeconds: seconds + RIDGE_V2_CONFORMAL_OFFSET_S,
    usable,
    coverageWeeks,
    features,
  };
}

// ---------------------------------------------------------------------------
// Small numeric helpers (kept local + pure, mirroring the training Python)
// ---------------------------------------------------------------------------

/**
 * Duration-weighted median (mirrors `features_v2._weighted_median`): sort by
 * value, return the value at the half-total-weight crossing. Ignores non-finite
 * values / non-positive weights. NaN when nothing valid remains.
 */
function weightedMedian(vals: number[], weights: number[]): number {
  const pairs: { v: number; w: number }[] = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]!;
    const w = weights[i]!;
    if (Number.isFinite(v) && Number.isFinite(w) && w > 0) pairs.push({ v, w });
  }
  if (pairs.length === 0) return NaN;
  pairs.sort((a, b) => a.v - b.v);
  const total = pairs.reduce((s, p) => s + p.w, 0);
  const cutoff = total / 2;
  let cum = 0;
  for (const p of pairs) {
    cum += p.w;
    if (cum >= cutoff) return p.v; // numpy searchsorted(cum, cutoff) analogue
  }
  return pairs[pairs.length - 1]!.v;
}

/**
 * Linear-interpolated percentile (matches numpy.percentile default, the method
 * `features_v2` uses for `pace_p10`). `q` in [0, 100].
 */
function percentile(xs: number[], q: number): number {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return NaN;
  if (a.length === 1) return a[0]!;
  const rank = (q / 100) * (a.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return a[lo]!;
  const frac = rank - lo;
  return a[lo]! * (1 - frac) + a[hi]! * frac;
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
