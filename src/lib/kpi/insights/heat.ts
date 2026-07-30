/**
 * HR vs temperature relationship: a simple (tempC, avgHr) scatter with a
 * least-squares line, and a pace-adjusted multiple regression that reads the
 * temperature effect AT EQUAL PACE.
 */

import type { InsightRun } from './inputs';
import {
  leastSquares,
  mean,
  ols2,
} from './stats';

// ---------------------------------------------------------------------------
// 2. HR vs temperature relationship
// ---------------------------------------------------------------------------

export interface HrTempPoint {
  tempC: number;
  avgHr: number;
}

export interface HrTempFit {
  /** bpm per °C (slope of the least-squares line). */
  slopeBpmPerC: number;
  /** bpm intercept at 0°C. */
  interceptBpm: number;
  /** Pearson correlation coefficient r in [-1,1]. */
  r: number;
}

export interface HrVsTemp {
  points: HrTempPoint[];
  /** Least-squares fit, or null when < 2 points or zero temp variance. */
  fit: HrTempFit | null;
}


// ---------------------------------------------------------------------------
// 2b. HR vs temperature, CONTROLLING FOR PACE (multiple regression)
// ---------------------------------------------------------------------------

/** A run reduced to the fields the pace-adjusted heat regression reads. */
export interface AdjustedRunInput {
  /** True when this run is an EASY-typed run (only easy runs are used). */
  isEasy: boolean;
  /** Average heart rate (bpm), or null/undefined when unknown. */
  avgHr?: number | null;
  /** Average temperature (°C), or null/undefined when unknown. */
  avgTempC?: number | null;
  /** Average pace in seconds per km (lower = faster), or null when unknown. */
  paceSecPerKm?: number | null;
}

/** One run's temperature paired with its pace-normalized HR. */
export interface AdjustedHrPoint {
  tempC: number;
  /** HR normalized to the cohort's mean pace: avgHr − paceCoef·(pace − meanPace). */
  adjHr: number;
  /** The run's real (unadjusted) avg HR, for the scrub callout. */
  rawHr: number;
  /** The run's pace in seconds per km, for the scrub callout. */
  paceSecPerKm: number;
}

export interface HrVsTempAdjusted {
  /** Per-run (temp, pace-adjusted HR) points, ordered as supplied. */
  points: AdjustedHrPoint[];
  /** ∂HR/∂temp at fixed pace (bpm per °C). */
  tempCoefBpmPerC: number;
  /** ∂HR/∂pace at fixed temp (bpm per s/km). */
  paceCoefBpmPerSecKm: number;
  /** Coefficient of determination of the 2-predictor fit. */
  r2: number;
  /** Number of runs in the fit. */
  n: number;
}

/** Minimum easy runs required to control for pace. */
const ADJUSTED_MIN_RUNS = 8;

