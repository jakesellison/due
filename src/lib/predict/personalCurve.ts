/**
 * The PERSONAL RACE CURVE — race prediction v3's primary model (spec:
 * docs/superpowers/specs/2026-06-10-race-prediction-v3-design.md).
 *
 * The runner's own detected races (tagged or inferred race-quality efforts)
 * are the strongest predictor of their next race — backtested on 19 real
 * races: marathon MAE 3:20 vs the population ensemble's 42:47. The ladder:
 *
 *  - TIER 2 (≥2 races, ≥1.5× distance spread): recency-weighted least squares
 *    on log(time) ~ log(distance) over fitness-adjusted race times. The slope
 *    is the personal fatigue exponent (clamped [1.0, 1.25]). Extrapolating
 *    beyond the longest raced distance shrinks the exponent toward a
 *    volume-adjusted population prior. A walk-forward self-calibration
 *    (geometric mean of past actual/predicted ratios) corrects systematic
 *    bias, and the band is the 80% quantile of past walk-forward relative
 *    errors.
 *  - TIER 1 (1 race): the race projected with the volume-adjusted prior
 *    exponent e(v) = 1.322 − 0.051·ln(mi/wk) (fitted 5-fold-CV on the
 *    Vickers & Vertosick corpus: one-race marathon MAE 17.8 → 13.8 min),
 *    fitness-scaled. Fixed ±10% band.
 *  - TIER 0 (no races): null — the caller falls back to the ensemble.
 *
 * Fitness scaling uses the Tanda index (predicted marathon seconds from
 * 8-wk volume+pace) as a RELATIVE within-runner signal only:
 * sec × (tanda(asOf)/tanda(raceDate))^β, β = 0.5. (A day-level HR-efficiency
 * index was tested and rejected — see the spec.)
 *
 * Pure + deterministic. Distances metres, times seconds, dates civil
 * 'YYYY-MM-DD'. Walk-forward internals are asOf-independent per race and
 * memoised per runs-array so the ~100-point Trends trendline stays cheap.
 * Callers must treat `runs` as immutable — mutating the array in place between
 * calls would return stale memo hits.
 */

import {
  metersToMiles,
} from '../units';
import {
  detectRaceResults,
  type RaceResult,
} from './races';
import {
  tandaInputsFromActivities,
  tandaMarathonSeconds,
  type PredictRun,
} from './tanda';
import {
  extractStreamEffortsFromActivities,
  type StreamEffort,
  type StreamEffortActivity,
} from './streamEfforts';

/** Fitness-scaling exponent β: sec × (tandaNow/tandaThen)^β. */
const CURVE_BETA = 0.5;
/** Recency half-life (days) for race weights AND calibration weights. */
const CURVE_HALF_LIFE_DAYS = 540;
/** Personal fatigue-exponent clamp for the fitted slope. */
const EXPONENT_MIN = 1.0;
export const EXPONENT_MAX = 1.25;
/** Volume-adjusted population prior: e = a + b·ln(mi/wk), clamped. */
export const EXPONENT_PRIOR = { a: 1.322, b: -0.051, min: 1.0, max: 1.3 } as const;
/** Tier-2 needs the raced distances to span at least this ratio. */
const MIN_SPREAD_RATIO = 1.5;
/** Target beyond longestRaced×this ⇒ extrapolation ⇒ shrink toward the prior. */
const EXTRAPOLATION_TOL = 1.1;
/** Band defaults/floors (relative half-widths). */
export const BAND_DEFAULT = 0.08;
export const BAND_FLOOR = 0.025;
export const TIER1_BAND = 0.1;
/** Walk-forward residuals needed before the band uses their 80% quantile. */
export const MIN_RESIDUALS_FOR_BAND = 4;
/** Past ratios needed before self-calibration applies. */
const MIN_CALIBRATION_RATIOS = 2;
/** Stream-effort weight is capped to this fraction of race-point weight. */
const STREAM_WEIGHT_CAP_VS_RACES = 0.75;

/** The personal-curve prediction surfaced to the ensemble. */
export interface PersonalCurveResult {
  /** Predicted finish at the target distance, seconds (calibrated for tier 2). */
  seconds: number;
  /** Relative half-width of the honest band (e.g. 0.04 ⇒ ±4%). */
  halfRelWidth: number;
  /** The fatigue exponent that produced `seconds`. */
  exponent: number;
  /** Where the exponent came from: fitted curve, prior-blended, or prior. */
  exponentSource: 'fitted' | 'blended' | 'prior';
  /** Detected races that informed the prediction (as of asOfDate). */
  nRaces: number;
  /** Stream-derived in-run efforts that helped densify the tier-2 curve. */
  nStreamEfforts?: number;
  /** Civil date of the newest detected race. */
  lastRaceDate: string;
  /**
   * Fitness adjustment applied to the NEWEST race, percent (negative = the
   * runner is fitter now ⇒ projected faster). Null when the Tanda index was
   * unusable at either end.
   */
  fitnessAdjPct: number | null;
  /** Self-calibration multiplier, or null when <MIN_CALIBRATION_RATIOS ratios. */
  calibrationFactor: number | null;
  /** 2 = personal curve, 1 = single-race anchor. */
  tier: 1 | 2;
}

/**
 * Predict the finish time at `targetMeters` from the runner's own detected
 * races as of `asOfDate`. Returns null when no race efforts exist (tier 0 —
 * the caller falls back to the population ensemble).
 */
export function personalCurvePredict(
  runs: PredictRun[],
  asOfDate: string,
  targetMeters: number,
  streamActivities: StreamCurveActivity[] = [],
): PersonalCurveResult | null {
  const newestFirst = detectRaceResults(runs, asOfDate);
  if (newestFirst.length === 0) return null;
  const ordered = [...newestFirst].reverse(); // oldest-first
  const newest = ordered[ordered.length - 1]!;
  const streamPoints = streamCurvePoints(streamActivities, asOfDate);
  const curvePoints = [...raceCurvePoints(ordered), ...streamPoints].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const t2 = curveFit(runs, curvePoints, asOfDate, targetMeters, newest);
  if (t2 != null) {
    const resids = walkForwardResiduals(runs, ordered);
    const cal = calibrationFactor(resids, asOfDate);
    return {
      seconds: t2.seconds * cal,
      halfRelWidth: bandHalfWidth(resids),
      exponent: t2.exponent,
      exponentSource: t2.exponentSource,
      nRaces: ordered.length,
      nStreamEfforts: streamPoints.length,
      lastRaceDate: newest.date,
      fitnessAdjPct: t2.fitnessAdjPct,
      calibrationFactor: resids.length >= MIN_CALIBRATION_RATIOS ? cal : null,
      tier: 2,
    };
  }

  const t1 = anchorPredict(runs, newest, asOfDate, targetMeters);
  return {
    seconds: t1.seconds,
    halfRelWidth: TIER1_BAND,
    exponent: t1.exponent,
    exponentSource: 'prior',
    nRaces: ordered.length,
    lastRaceDate: newest.date,
    fitnessAdjPct: t1.fitnessAdjPct,
    calibrationFactor: null,
    tier: 1,
  };
}

/** A tier-2 fit outcome (uncalibrated). */
interface CurveFit {
  seconds: number;
  exponent: number;
  exponentSource: 'fitted' | 'blended';
  fitnessAdjPct: number | null;
}

interface CurvePoint {
  date: string;
  distanceMeters: number;
  seconds: number;
  source: 'race' | 'stream';
  qualityWeight: number;
}

export type StreamCurveActivity = StreamEffortActivity;

/**
 * Tier 2: weighted least squares on log(time) ~ log(distance) over the
 * fitness-adjusted races (oldest-first), recency-weighted with
 * CURVE_HALF_LIFE_DAYS. Null when <2 races or the distance spread is under
 * MIN_SPREAD_RATIO (the caller degrades to tier 1).
 */
function curveFit(
  runs: PredictRun[],
  ordered: CurvePoint[],
  asOfDate: string,
  targetMeters: number,
  newestRace?: RaceResult,
): CurveFit | null {
  if (ordered.length < 2) return null;

  let fitnessAdjPct: number | null = null;
  const pts = ordered.map((r) => {
    let sec = r.seconds;
    const factor = fitnessFactor(runs, asOfDate, r.date);
    if (factor != null) {
      sec *= factor;
      if (newestRace && r.source === 'race' && r.date === newestRace.date) {
        fitnessAdjPct = (factor - 1) * 100;
      }
    }
    return {
      x: Math.log(r.distanceMeters),
      y: Math.log(sec),
      source: r.source,
      w:
        r.qualityWeight *
        Math.pow(0.5, civilDayDiff(asOfDate, r.date) / CURVE_HALF_LIFE_DAYS),
    };
  });
  capStreamWeights(pts);

  const xMin = Math.min(...pts.map((p) => p.x));
  const xMax = Math.max(...pts.map((p) => p.x));
  if (xMax - xMin < Math.log(MIN_SPREAD_RATIO)) return null;

  const wSum = pts.reduce((s, p) => s + p.w, 0);
  const xBar = pts.reduce((s, p) => s + p.w * p.x, 0) / wSum;
  const yBar = pts.reduce((s, p) => s + p.w * p.y, 0) / wSum;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += p.w * (p.x - xBar) * (p.y - yBar);
    den += p.w * (p.x - xBar) * (p.x - xBar);
  }
  if (den === 0) return null;

  let exponent = clamp(num / den, EXPONENT_MIN, EXPONENT_MAX);
  let exponentSource: CurveFit['exponentSource'] = 'fitted';

  // Extrapolating beyond the longest raced distance is where a fitted short-
  // distance slope misleads (corpus: Riegel-1.06 to the marathon biased ~14
  // min fast). Shrink toward the volume-adjusted population prior by how much
  // of the log-distance journey to the target the raced spread covers.
  const maxRaced = Math.exp(xMax);
  const minRaced = Math.exp(xMin);
  if (targetMeters > maxRaced * EXTRAPOLATION_TOL) {
    const spreadFrac = Math.min(
      1,
      Math.log(maxRaced / minRaced) / Math.log(targetMeters / minRaced),
    );
    const prior = priorExponent(runs, asOfDate);
    exponent = clamp(
      spreadFrac * exponent + (1 - spreadFrac) * prior,
      EXPONENT_MIN,
      EXPONENT_PRIOR.max,
    );
    exponentSource = 'blended';
  }

  // WLS-optimal intercept for the (possibly clamped) slope.
  const intercept = yBar - exponent * xBar;
  const seconds = Math.exp(intercept + exponent * Math.log(targetMeters));
  return { seconds, exponent, exponentSource, fitnessAdjPct };
}

/** Tier 1: one race, projected with the volume-adjusted prior, fitness-scaled. */
function anchorPredict(
  runs: PredictRun[],
  raceResult: RaceResult,
  asOfDate: string,
  targetMeters: number,
): { seconds: number; exponent: number; fitnessAdjPct: number | null } {
  const exponent = priorExponent(runs, asOfDate);
  let seconds =
    raceResult.seconds * Math.pow(targetMeters / raceResult.distanceMeters, exponent);
  let fitnessAdjPct: number | null = null;
  const factor = fitnessFactor(runs, asOfDate, raceResult.date);
  if (factor != null) {
    seconds *= factor;
    fitnessAdjPct = (factor - 1) * 100;
  }
  return { seconds, exponent, fitnessAdjPct };
}

/**
 * The volume-adjusted population exponent e(v) = a + b·ln(mi/wk), clamped.
 * Uses the 8-wk Tanda volume window; mi/wk floors at 1 so ln stays finite.
 */
function priorExponent(runs: PredictRun[], asOfDate: string): number {
  const inputs = tandaInputsFromActivities(runs, asOfDate);
  const miPerWk = Math.max(1, metersToMiles(inputs.weeklyKmMean * 1000));
  return clamp(
    EXPONENT_PRIOR.a + EXPONENT_PRIOR.b * Math.log(miPerWk),
    EXPONENT_PRIOR.min,
    EXPONENT_PRIOR.max,
  );
}

/**
 * Fitness-scaling factor (tanda(asOf)/tanda(then))^β, or null when the Tanda
 * index is unusable at either date. <1 means fitter now (faster projection).
 */
function fitnessFactor(
  runs: PredictRun[],
  asOfDate: string,
  thenDate: string,
): number | null {
  const now = fitnessIndex(runs, asOfDate);
  const then = fitnessIndex(runs, thenDate);
  if (now == null || then == null || then <= 0) return null;
  return Math.pow(now / then, CURVE_BETA);
}

/** Per-runs-array memo of the Tanda index by date (asOf-independent inputs). */
const fitnessMemo = new WeakMap<PredictRun[], Map<string, number | null>>();

/** Tanda index (predicted marathon seconds) at a date, or null when thin. */
function fitnessIndex(runs: PredictRun[], asOfDate: string): number | null {
  let memo = fitnessMemo.get(runs);
  if (!memo) {
    memo = new Map();
    fitnessMemo.set(runs, memo);
  }
  const hit = memo.get(asOfDate);
  if (hit !== undefined) return hit;
  const inputs = tandaInputsFromActivities(runs, asOfDate);
  const usable =
    inputs.coverage >= 3 &&
    inputs.nRuns > 0 &&
    inputs.paceSecPerKmMean > 0 &&
    inputs.weeklyKmMean > 0;
  const value = usable ? tandaMarathonSeconds(inputs) : null;
  memo.set(asOfDate, value);
  return value;
}

/** Clamp `x` into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Whole-day difference a − b in civil days (both 'YYYY-MM-DD'). */
function civilDayDiff(a: string, b: string): number {
  const ta = new Date(`${a}T12:00:00Z`).getTime();
  const tb = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((ta - tb) / 86_400_000);
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC). */
function shiftCivil(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** One walk-forward residual: how a past race compared to its own prediction. */
interface WfResidual {
  /** Civil date of the race that was predicted. */
  date: string;
  /** actual/predicted — >1 means the curve under-predicted (too fast). */
  ratio: number;
  /** (predicted − actual)/actual — signed relative error. */
  rel: number;
}

/** Memo of walk-forward residuals per runs array, keyed by the race-list shape. */
const wfMemo = new WeakMap<PredictRun[], Map<string, WfResidual[]>>();

/**
 * Walk-forward residuals over the runner's races (oldest-first): each race
 * with ≥2 prior races gets predicted from ONLY those priors (as of the day
 * before, chained through the calibration of its own past), and contributes
 * an actual/predicted ratio + relative error. asOf-independent ⇒ memoised.
 */
function walkForwardResiduals(runs: PredictRun[], ordered: RaceResult[]): WfResidual[] {
  const key = ordered.map((r) => `${r.date}|${Math.round(r.distanceMeters)}`).join(',');
  let memo = wfMemo.get(runs);
  if (!memo) {
    memo = new Map();
    wfMemo.set(runs, memo);
  }
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const out: WfResidual[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const raceResult = ordered[i]!;
    const prior = ordered.slice(0, i);
    if (prior.length < 2) continue;
    const asOf = shiftCivil(raceResult.date, -1);
    const fit = curveFit(
      runs,
      raceCurvePoints(prior),
      asOf,
      raceResult.distanceMeters,
      prior[prior.length - 1],
    );
    if (fit == null) continue;
    const pred = fit.seconds * calibrationFactor(out, asOf);
    out.push({
      date: raceResult.date,
      ratio: raceResult.seconds / pred,
      rel: (pred - raceResult.seconds) / raceResult.seconds,
    });
  }
  memo.set(key, out);
  return out;
}

function raceCurvePoints(races: RaceResult[]): CurvePoint[] {
  return races.map((r) => ({
    date: r.date,
    distanceMeters: r.distanceMeters,
    seconds: r.seconds,
    source: 'race',
    qualityWeight: 1,
  }));
}

function streamCurvePoints(activities: StreamCurveActivity[], asOfDate: string): CurvePoint[] {
  // Pass the activity objects through as-is (no per-call spread): the extraction
  // is memoized per activity object and resolves max_hr → maxHr internally, so
  // the ~100-point trendline reuses each activity's effort set instead of
  // recomputing the O(n·m) sliding window every point.
  return extractStreamEffortsFromActivities(activities, asOfDate).map(
    (e: StreamEffort & { localDate: string }) => ({
      date: e.localDate,
      distanceMeters: e.distanceMeters,
      seconds: e.seconds,
      source: 'stream',
      qualityWeight: e.qualityWeight,
    }),
  );
}

function capStreamWeights(pts: { source: 'race' | 'stream'; w: number }[]): void {
  const raceW = pts.reduce((sum, p) => sum + (p.source === 'race' ? p.w : 0), 0);
  const streamW = pts.reduce((sum, p) => sum + (p.source === 'stream' ? p.w : 0), 0);
  const cap = raceW * STREAM_WEIGHT_CAP_VS_RACES;
  if (raceW <= 0 || streamW <= cap || streamW <= 0) return;
  const scale = cap / streamW;
  for (const p of pts) {
    if (p.source === 'stream') p.w *= scale;
  }
}

/**
 * Recency-weighted geometric mean of past actual/predicted ratios — the
 * self-calibration multiplier. 1 (no-op) until MIN_CALIBRATION_RATIOS exist.
 */
function calibrationFactor(resids: WfResidual[], asOfDate: string): number {
  if (resids.length < MIN_CALIBRATION_RATIOS) return 1;
  let wSum = 0;
  let logSum = 0;
  for (const r of resids) {
    const w = Math.pow(0.5, civilDayDiff(asOfDate, r.date) / CURVE_HALF_LIFE_DAYS);
    wSum += w;
    logSum += w * Math.log(r.ratio);
  }
  return Math.exp(logSum / wSum);
}

/**
 * The honest band: 80% quantile of past walk-forward relative |errors|,
 * floored at BAND_FLOOR; BAND_DEFAULT until MIN_RESIDUALS_FOR_BAND exist.
 * Measured coverage on the design backtest: 79% against an 80% target.
 */
function bandHalfWidth(resids: WfResidual[]): number {
  if (resids.length < MIN_RESIDUALS_FOR_BAND) return BAND_DEFAULT;
  const q = resids.map((r) => Math.abs(r.rel)).sort((a, b) => a - b);
  const idx = Math.min(q.length - 1, Math.ceil(0.8 * q.length) - 1);
  return Math.max(BAND_FLOOR, q[idx]!);
}
