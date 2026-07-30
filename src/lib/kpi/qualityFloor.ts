/**
 * qualityFloor.ts — Per-runner moderate-effort floor derivation.
 *
 * Pure. No IO. Node-tested.
 * Spec: docs/superpowers/specs/2026-06-18-quality-aware-adaptation-design.md §1
 *
 * The "moderate-effort floor" is the easy→moderate boundary — approximately
 * marathon-pace-or-faster. It is derived as the MIDPOINT between the runner's
 * easy-pace baseline and their estimated marathon pace (MP):
 *
 *   paceFloor = (easyBaseline + MP) / 2
 *
 * MP derivation (in priority order):
 *   1. When a RacePrediction is available: MP = prediction.seconds converted to
 *      s/mi via the marathon distance (42195 m). If this MP is ≥ easyBaseline
 *      (unreliable prediction), fall back to option 2.
 *   2. Fallback: MP ≈ easyBaseline − FALLBACK_MP_MARGIN_SEC_PER_MI (default 90
 *      s/mi). This is a conservative estimate (~1.5 min/mi faster than easy).
 *
 * HR floor:
 *   When an HrModel is provided with a steadyZoneFloorBpm, that value is the
 *   moderate/steady-zone HR boundary. Otherwise hrFloor is null.
 *
 * Defaults (spec §9):
 *   - FALLBACK_MP_MARGIN: 90 s/mi (easy → approx threshold pace gap).
 *   - hrFloor: null (HR is opt-in; pace/GAP is the fallback).
 */

import {
  METERS_PER_MILE,
} from '../units';

const MARATHON_METERS = 42195;

/** The margin (s/mi) below easy-pace used as fallback MP when no prediction. */
const FALLBACK_MP_MARGIN_SEC_PER_MI = 90;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A minimal race-prediction shape. Accepts the full RacePrediction from
 * `src/lib/predict/ensemble.ts`; only `seconds` (marathon time) is read here.
 */
export interface MinimalRacePrediction {
  /** Predicted marathon finish time in seconds. */
  seconds: number;
}

/** Optional HR model for deriving a BPM-based floor. */
export interface HrModel {
  /**
   * The BPM boundary between the easy and moderate/steady HR zones.
   * Matches the runner's steady-zone entry (e.g. 148 bpm for a
   * 150 bpm lactate-threshold runner).
   */
  steadyZoneFloorBpm: number;
}

/** Input to estimateQualityFloor. */
export interface QualityFloorInput {
  /** Runner's trailing easy-pace baseline (sec/mi). */
  easyBaselineSecPerMi: number;
  /**
   * Race prediction from the ensemble/personal-curve predictor, if available.
   * Only the `seconds` field (marathon finish time) is used; the rest is
   * ignored so callers can pass the full `RacePrediction` object.
   */
  prediction?: MinimalRacePrediction | null;
  /** Optional HR model for a BPM-based moderate floor. */
  hrModel?: HrModel | null;
}

/** The derived moderate-effort floor for a runner. */
export interface QualityFloor {
  /**
   * Pace floor (sec/mi). Samples AT or FASTER than this pace (≤ this value)
   * are considered moderate-to-hard effort.
   *
   * Approximately midway between the runner's easy-pace baseline and their
   * estimated marathon pace.
   */
  paceFloorSecPerMi: number;
  /**
   * Heart-rate floor (bpm). Samples at or above this HR are moderate-to-hard.
   * Null when no HR model is available — pace/GAP is used in that case.
   */
  hrFloor: number | null;
  /**
   * The genuinely-fast floor (sec/mi) for the workout interpreter — a block
   * counts as intentional quality only when its GAP pace clears this.
   * Between MP and the moderate paceFloor.
   */
  qualityFloorSecPerMi: number;
  /**
   * The estimated marathon pace (sec/mi) this floor was derived from — stored as
   * part of the POINT-IN-TIME snapshot (with easyBaselineSecPerMi at storage) so
   * a verdict records the fitness it was judged against and never silently
   * re-scales to today's faster fitness on a later reprocess. Optional: it's a
   * snapshot detail, not an input to any computation.
   */
  mpSecPerMi?: number;
}

/**
 * Derive the workout-interpreter's genuinely-fast quality floor (sec/mi)
 * as a fixed RATIO of the athlete's easy pace.
 *
 * Physiology (Daniels VDOT, 80/20, Stryd %CP all agree): the easy→threshold
 * pace GAP is not a constant s/mi offset — it nearly doubles from fit to unfit
 * (≈78→142 s/mi) — but the SPEED RATIO is near-constant (~1.19–1.23× easy for
 * threshold). So a ratio of easy self-scales across fitness, and — unlike a
 * percentile of the athlete's own efforts — it needs no hard runs in history
 * (robust for someone who rarely runs hard). `easy × 0.87` (≈ easy_speed ×
 * 1.15) sits just above marathon effort and below threshold: it catches genuine
 * tempo/MP/interval work and rejects moderate steady running. For the reference
 * athlete (~8:25 easy) this is ~7:19, matching the prior MP-derived value.
 *
 * v2 (documented, not built): refine FASTER via a race/critical-speed anchor
 * when one exists, so a fit runner who only jogs isn't handed a too-slow floor.
 */
export const QUALITY_PACE_RATIO = 0.87;
export function deriveQualityFloor(easyBaselineSecPerMi: number): number {
  return easyBaselineSecPerMi * QUALITY_PACE_RATIO;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Derive the moderate-effort floor for a runner.
 *
 * paceFloor = (easyBaseline + MP) / 2, where MP is estimated from the race
 * prediction if present and credible, else easyBaseline − 90 s/mi.
 *
 * hrFloor = hrModel.steadyZoneFloorBpm if provided, else null.
 */
export function estimateQualityFloor(input: QualityFloorInput): QualityFloor {
  const { easyBaselineSecPerMi, prediction, hrModel } = input;

  // ── MP estimate ──────────────────────────────────────────────────────────────
  let mpSecPerMi: number;

  if (prediction != null && prediction.seconds > 0) {
    // Convert marathon finish time to s/mi
    const marathonMiles = MARATHON_METERS / METERS_PER_MILE;
    const predictedMpSecPerMi = prediction.seconds / marathonMiles;

    // Sanity: predicted MP must be faster (lower s/mi) than easy baseline.
    // If not, the prediction is unreliable for pace-floor purposes → fallback.
    if (predictedMpSecPerMi < easyBaselineSecPerMi) {
      mpSecPerMi = predictedMpSecPerMi;
    } else {
      mpSecPerMi = easyBaselineSecPerMi - FALLBACK_MP_MARGIN_SEC_PER_MI;
    }
  } else {
    // No prediction available — use the ~90 s/mi margin below easy pace.
    mpSecPerMi = easyBaselineSecPerMi - FALLBACK_MP_MARGIN_SEC_PER_MI;
  }

  // ── Pace floor (midpoint easy↔MP) ────────────────────────────────────────────
  const paceFloorSecPerMi = (easyBaselineSecPerMi + mpSecPerMi) / 2;

  // ── Quality floor (workout interpreter's genuinely-fast gate) ───────────────
  const qualityFloorSecPerMi = deriveQualityFloor(easyBaselineSecPerMi);

  // ── HR floor ─────────────────────────────────────────────────────────────────
  const hrFloor = hrModel?.steadyZoneFloorBpm ?? null;

  return { paceFloorSecPerMi, hrFloor, qualityFloorSecPerMi, mpSecPerMi };
}

// ── Max-HR derivation ──────────────────────────────────────────────────────────
//
// The quality-effort HR floor is a fraction of the runner's max HR. Max HR is
// resolved per-runner via a fallback chain — an explicit profile setting, else
// observed from their own history, else age-predicted, else a population default.

/** Steady/threshold HR zone entry as a fraction of max HR — the quality floor.
 *  A corpus sweep showed real intervals at ~88% max HR, moderate runs at ~75%;
 *  0.83 sits cleanly in the gap. */
const STEADY_ZONE_FRAC = 0.83;

/** Population fallback max HR when nothing is known (no history, no age). */
export const DEFAULT_MAX_HR = 190;

/** Plausible human max-HR bounds (bpm) — guards sensor spikes and bad data. */
const MAX_HR_MIN = 120;
const MAX_HR_MAX = 220;

const isPlausibleMaxHr = (h: number | null | undefined): h is number =>
  typeof h === 'number' && Number.isFinite(h) && h >= MAX_HR_MIN && h <= MAX_HR_MAX;

/** Tanaka age-predicted max HR: 208 − 0.7·age (more accurate than 220−age). */
export function agePredictedMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/** The quality-effort HR floor (steady/threshold zone entry) for a given max HR. */
export function steadyZoneFloorBpm(maxHr: number): number {
  return Math.round(maxHr * STEADY_ZONE_FRAC);
}

/**
 * Observed max HR from per-activity maxima. Robust to sensor spikes: requires a
 * minimum sample count and takes the 98th percentile (a genuine all-out peak)
 * rather than the single highest value. Returns null when there isn't enough
 * HR history to trust.
 */
export function observedMaxHr(perActivityMax: ReadonlyArray<number | null>, minRuns = 10): number | null {
  const vals = perActivityMax.filter(isPlausibleMaxHr).sort((a, b) => a - b);
  if (vals.length < minRuns) return null;
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))]!;
}

export type MaxHrSource = 'setting' | 'observed' | 'age' | 'default';

export interface MaxHrInput {
  /** Explicit user-set max HR (profile override), if any. */
  settingMaxHr?: number | null;
  /** Observed max from history (via observedMaxHr), if derivable. */
  observedMaxHr?: number | null;
  /** Runner age in years (from profile birth year), if known. */
  age?: number | null;
}

/** Resolve the effective max HR via fallback: explicit → observed → age → default. */
export function effectiveMaxHr(input: MaxHrInput): { maxHr: number; source: MaxHrSource } {
  if (isPlausibleMaxHr(input.settingMaxHr)) return { maxHr: input.settingMaxHr, source: 'setting' };
  if (isPlausibleMaxHr(input.observedMaxHr)) return { maxHr: input.observedMaxHr, source: 'observed' };
  if (typeof input.age === 'number' && input.age > 0 && input.age < 120) {
    return { maxHr: agePredictedMaxHr(input.age), source: 'age' };
  }
  return { maxHr: DEFAULT_MAX_HR, source: 'default' };
}
