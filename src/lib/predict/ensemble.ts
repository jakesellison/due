/**
 * The race-prediction entry point. Since v3 the PRIMARY model is the PERSONAL
 * RACE CURVE (`personalCurve.ts` — the runner's own detected races; backtested
 * marathon MAE 3–6 min vs ~43 min for the population models on the design
 * subject): `predictRaceFromRuns` consults it first and the population
 * ensemble below is the tier-0 fallback AND the cross-check whose components
 * ride along on every prediction.
 *
 * The POPULATION ensemble (everything below `ensemblePrediction`) is driven by
 * the run_ww-trained RIDGE model (15.6-min CV MAE over 14,497 real marathon
 * blocks; see `ridge.ts`) as its primary, with the Tanda+Riegel parametric
 * blend as a fallback AND a cross-check. Pure, node-tested, with an honest
 * uncertainty band and a human-readable basis line.
 *
 * This is the in-app predictor. It is intentionally behind a SINGLE narrow
 * interface — `predictRace(activities, asOfDate, targetMeters)` →
 * `RacePrediction` — so models slot in behind the same call site without
 * touching the UI: it always emits the same
 * `{ seconds, lowSeconds, highSeconds, components, confidence, basis }`.
 *
 * Population-ensemble policy (documented):
 *  - PRIMARY = ridge when `usable` (≥6 active weeks AND real pace). Its 80%
 *    conformal band (±23.4 min, verified coverage 0.80) is the published band.
 *  - The Tanda+Riegel blend is BOTH the fallback (when ridge is not usable) AND
 *    a cross-check: if |ridge − parametric blend| > 20 min we widen the interval
 *    to envelope BOTH estimates and cap confidence at 'medium', noting the
 *    disagreement in the basis.
 *  - SLOW-TAIL GUARD (from the transfer experiment, `xfer_results.json`): when
 *    the ridge prediction is slower than 4:10:00 OR the training-pace signal is
 *    thin/absent, we widen the interval ×1.5 and cap confidence at 'medium' —
 *    volume-only signals over-promise slow runners by up to ~42 min (Q4 of the
 *    held-out transfer set: signed bias −42 min, coverage collapsed to 0.58).
 *  - Marathon only for ridge; non-marathon targets Riegel-scale the ridge
 *    marathon estimate so a half-marathon target still rides the model.
 *
 * Blend rationale (documented per the spec):
 *  - When BOTH components are present we weight Tanda 0.60 / Riegel 0.40. This
 *    is a volume-driven training app: Tanda uses the WHOLE 8-week block (volume
 *    + average training pace) and matches our coaching thesis, while Riegel
 *    leans on a single recent time trial. Tanda therefore leads; Riegel pulls
 *    the estimate toward demonstrated race-specific speed.
 *  - With only one component present we use it alone.
 *
 * Interval rationale (honest, literature-anchored — NOT a fitted CI):
 *  - Our `ml/` prototype's marathon Model-A (training-only, the closest analogue
 *    to this parametric predictor) achieved an 80% conformal interval of about
 *    ±37 min on a ~4:00 marathon, i.e. roughly ±15% half-width — but that was a
 *    sparse public dataset with no real training pace. With both a volume/pace
 *    model AND a recent best effort agreeing, the literature (Tanda's reported
 *    fit error, Riegel) supports a much tighter band. We therefore publish a
 *    deliberately conservative-but-useful 80%-ish band:
 *      · half-width = 4% of the predicted time when BOTH components agree and
 *        coverage is solid (≥6 weeks),
 *      · half-width = 8% when only one component is available OR coverage is
 *        thin (<6 weeks) — fewer signals, wider honest band.
 *    On a 2:40 marathon that is ±6.4 min (tight case) to ±12.8 min (wide case),
 *    bracketing the realistic spread for a well-trained runner without
 *    over-promising. This replaces the prototype's conformal offsets when the
 *    ML model lands.
 *
 * Confidence:
 *  - high   — both components present AND ≥6 weeks of run coverage,
 *  - medium — both components present but <6 weeks coverage,
 *  - low    — only a single component.
 *
 * Conventions: distances in metres, times in seconds, dates civil 'YYYY-MM-DD'.
 */

import {
  formatDuration,
  formatPace,
  metersToMiles,
} from '../units';
import {
  weekStartOf,
} from '../time/week';
import type { InsightActivity } from '../kpi/insights';
import type { RunStreams } from '../run/analysis';
import {
  MARATHON_METERS,
  tandaInputsFromActivities,
  tandaMarathonSeconds,
  type PredictRun,
} from './tanda';
import {
  bestRecentEffort,
  riegelSeconds,
} from './riegel';
import {
  ridgePredict,
  RIDGE_CONFORMAL_OFFSET_S,
} from './ridge';
import {
  ridgeV2Predict,
  RIDGE_V2_CONFORMAL_OFFSET_S,
  type RidgeV2FeatureVector,
} from './ridgeV2';
import {
  detectRaceResults,
  type RaceResult,
} from './races';
import {
  personalCurvePredict,
  type PersonalCurveResult,
} from './personalCurve';

/** Tanda's blend weight when both components are present. */
const TANDA_WEIGHT = 0.6;
const RIEGEL_WEIGHT = 0.4;

/** Interval half-widths (fraction of predicted seconds) for the 80%-ish band. */
const HALF_WIDTH_TIGHT = 0.04; // both components + solid coverage
const HALF_WIDTH_WIDE = 0.08; // single component OR thin coverage

/** Coverage (distinct weeks with a run) at/above which confidence can be high. */
const SOLID_COVERAGE_WEEKS = 6;

/** Minimum weeks of coverage before we emit ANY prediction (series gate too). */
const MIN_COVERAGE_WEEKS = 3;

/**
 * Ridge↔parametric disagreement threshold (seconds). Beyond this gap we no
 * longer trust either point estimate tightly: envelope both and go 'medium'.
 */
export const DISAGREEMENT_THRESHOLD_S = 20 * 60; // 20 min

/**
 * Slow-tail threshold (seconds). Predictions slower than this fall in the
 * regime where volume-only signals over-promised the held-out slow runners by
 * up to ~42 min (transfer experiment Q4) — widen + cap confidence.
 */
export const SLOW_TAIL_THRESHOLD_S = 4 * 3600 + 10 * 60; // 4:10:00

/** Interval-widening multiplier applied by the slow-tail guard. */
export const SLOW_TAIL_WIDEN = 1.5;

/** Basis token noting the model + corpus when ridge v2 drives the prediction. */
const RIDGE_V2_BASIS_TOKEN = 'model v2  14.5k blocks';

/** Basis token when the v1 ridge fallback drives the prediction. */
const RIDGE_V1_BASIS_TOKEN = 'model: 14.5k marathon blocks';

// ---- Race-anchor policy ----------------------------------------------------

/** Race age at/under which the personal ladder's confidence is not degraded. */
const RACE_FRESH_DAYS = 365;

/**
 * Minimum race count for the tier-2 curve to reach 'high' confidence. Below
 * this the curve is still usable (it renders and drives the estimate) but a
 * 3-race sample is thin enough that we shouldn't tell the runner "high" next
 * to a "3 races" caption — the label must not out-run what's actually shown.
 */
const HIGH_CONFIDENCE_MIN_RACES = 4;

/**
 * |fitnessAdjPct| at/above which the runner's current fitness has moved
 * enough since their races that the curve is extrapolating over a materially
 * different fitness state — caps confidence below 'high' either direction
 * (improved OR declined), because the races are less representative of "now"
 * either way. Keeps the confidence label honest next to a basis line that
 * itself prints "fitness ±N%".
 */
const HIGH_CONFIDENCE_MAX_FITNESS_DRIFT_PCT = 5;

/** Max age (days) of a race result for it to anchor the prediction. */
const ANCHOR_MAX_AGE_DAYS = 180;

/** Age (days) at/below which an anchored prediction is 'high' confidence. */
const ANCHOR_HIGH_CONF_DAYS = 120;

/** Anchor age-decay time-constant (days): w = exp(−ageDays / τ). */
const ANCHOR_DECAY_TAU = 90;

/** Anchor weight clamp [min, max] — never fully trust nor fully ignore a race. */
const ANCHOR_WEIGHT_MIN = 0.25;
const ANCHOR_WEIGHT_MAX = 0.85;

/** Anchored-interval floor as a fraction of the prediction (half-width). */
const ANCHOR_HALF_WIDTH_FLOOR = 0.03;

export type PredictionConfidence = 'low' | 'medium' | 'high';

/** The race anchor that fed the blend, surfaced for snapshotting + grading. */
export interface AnchorComponent {
  /** Race time projected to the target distance via Riegel, seconds. */
  seconds: number;
  /** The age-decayed blend weight applied to the anchor, [min, max]. */
  weight: number;
  /** Civil 'YYYY-MM-DD' of the anchoring race. */
  raceDate: string;
}

/** The component predictions that fed the blend (seconds), when each was usable. */
export interface PredictionComponents {
  /** run_ww ridge v2 model finish time (s) — the primary when usable. */
  ridgeV2?: number;
  /** run_ww ridge v1 model finish time (s) — the instant fallback. */
  ridge?: number;
  /** Tanda volume/pace model finish time (s). */
  tanda?: number;
  /** Riegel best-effort extrapolation finish time (s). */
  riegel?: number;
  /** The Tanda/Riegel parametric blend (s) — the fallback + cross-check value. */
  parametric?: number;
  /**
   * A recent real race, Riegel-projected to the target (s) — the anchor. Kept as
   * a bare number for back-compat; `anchorMeta` carries weight + date.
   */
  anchor?: number;
  /** The full anchor (seconds + blend weight + race date), when one anchored. */
  anchorMeta?: AnchorComponent;
  /** The personal race curve estimate (s) — v3's primary when present. */
  personalCurve?: number;
}

/** The single prediction contract the UI (and a future ML model) speak. */
export interface RacePrediction {
  /** Blended predicted finish time, seconds. */
  seconds: number;
  /** Lower edge of the 80%-ish band (faster), seconds. */
  lowSeconds: number;
  /** Upper edge of the 80%-ish band (slower), seconds. */
  highSeconds: number;
  /** The per-model component times that fed the blend. */
  components: PredictionComponents;
  /** Confidence tier (see module header). */
  confidence: PredictionConfidence;
  /** Human-readable basis line, e.g. "8-wk volume 96 km/wk  training pace 4:52/km  10K best 38:15" (2-space gaps). */
  basis: string;
  /**
   * The model that drove this prediction, e.g. `'ridge_v2'`, `'ridge_v1'`,
   * `'parametric'` — with a `'+anchor'` suffix when a recent race anchored it
   * (`'ridge_v2+anchor'`). Frozen into the daily snapshot for later grading.
   */
  modelVersion: string;
  /**
   * The full ridge v2 (or v1 fallback) 39-feature vector that fed the model
   * estimate, for snapshotting + audit. Absent when the parametric fallback
   * drove the prediction (no ridge feature vector was computed).
   */
  featureVector?: RidgeV2FeatureVector;
}

/** Map an activity row's prediction-relevant fields into the PredictRun shape. */
export interface PredictActivity extends InsightActivity {
  /** Civil 'YYYY-MM-DD' the run is attributed to. */
  localDate?: string | null;
  /** Run distance in metres. */
  distanceMeters?: number | null;
  /** Moving time in seconds, when known. */
  movingTimeS?: number | null;
  /** Elapsed time in seconds, when known (race-finish fallback). */
  elapsedTimeS?: number | null;
  /** Strava workout_type (1 = race), when known. */
  workoutType?: number | null;
  /** Compact per-point streams, when known; used for stream-derived efforts. */
  streams?: RunStreams | null;
  /** Max HR, camelCase or DB snake_case depending on caller row shape. */
  maxHr?: number | null;
  max_hr?: number | null;
}

/**
 * Predict a race finish time for `targetMeters` (default the marathon) from the
 * user's activities as of `asOfDate`.
 *
 * PRIMARY is the run_ww ridge model when usable; the Tanda+Riegel parametric
 * blend is the fallback AND a cross-check (see the module header for the full
 * policy: disagreement widening + slow-tail guard). Attaches an honest interval,
 * a confidence tier and a basis line.
 *
 * Returns null when there is not enough signal to predict at all: NEITHER a
 * usable ridge fit, NOR a Tanda fit with ≥`MIN_COVERAGE_WEEKS` weeks of run
 * coverage AND real training pace, NOR a recent best effort.
 */
export function predictRace(
  activities: PredictActivity[],
  asOfDate: string,
  targetMeters = MARATHON_METERS,
): RacePrediction | null {
  return predictRaceFromRuns(prepareRuns(activities), activities, asOfDate, targetMeters);
}

/**
 * Map raw activities into the model's PredictRun shape ONCE. The per-week
 * trendline (`predictionSeries`) calls the predictor ~80–100 times over the
 * same activity set with only `asOfDate` changing — rebuilding this array per
 * week was the single most expensive thing on the Trends screen.
 */
function prepareRuns(activities: PredictActivity[]): PredictRun[] {
  return activities
    .filter((a) => !!a.localDate && a.distanceMeters != null)
    .map((a) => ({
      localDate: a.localDate as string,
      distanceMeters: a.distanceMeters as number,
      movingTimeS: a.movingTimeS ?? null,
      workoutType: a.workoutType ?? null,
    }));
}

/**
 * The v3 tier ladder: the personal race curve (the runner's own detected
 * races) drives the prediction whenever any race effort exists; the
 * population ensemble below is tier 0's fallback AND the cross-check
 * component. See src/lib/predict/personalCurve.ts and the v3 spec.
 */
function predictRaceFromRuns(
  runs: PredictRun[],
  activities: PredictActivity[],
  asOfDate: string,
  targetMeters = MARATHON_METERS,
): RacePrediction | null {
  const personal = personalCurvePredict(runs, asOfDate, targetMeters, activities);
  const ensemble = ensemblePrediction(runs, activities, asOfDate, targetMeters);
  if (personal == null) return ensemble;
  return assemblePersonalPrediction(personal, ensemble, asOfDate);
}

/** Assemble the public RacePrediction from a personal-curve result. */
function assemblePersonalPrediction(
  personal: PersonalCurveResult,
  cross: RacePrediction | null,
  asOfDate: string,
): RacePrediction {
  const half = personal.seconds * personal.halfRelWidth;
  const raceAgeDays = civilDayDiff(asOfDate, personal.lastRaceDate);

  let confidence: PredictionConfidence;
  if (personal.tier === 2) {
    // 'high' requires ALL of what the UI shows beside the label to actually
    // back it up: enough races, a recent one, and a fitness state that hasn't
    // drifted materially from when those races were run. Any one of those
    // failing degrades to 'medium' — never "high" next to a caption that
    // reads thin or contradictory.
    const enoughRaces = personal.nRaces >= HIGH_CONFIDENCE_MIN_RACES;
    const fresh = raceAgeDays <= RACE_FRESH_DAYS;
    const stableFitness =
      personal.fitnessAdjPct == null ||
      Math.abs(personal.fitnessAdjPct) < HIGH_CONFIDENCE_MAX_FITNESS_DRIFT_PCT;
    confidence = enoughRaces && fresh && stableFitness ? 'high' : 'medium';
  } else {
    confidence = raceAgeDays <= RACE_FRESH_DAYS ? 'medium' : 'low';
  }

  const bandPct = Math.round(personal.halfRelWidth * 100);
  const parts: string[] =
    personal.tier === 2
      ? [`your ${personal.nRaces} races`, `exponent ${personal.exponent.toFixed(2)}`]
      : [`1 race + volume exponent ${personal.exponent.toFixed(2)}`];
  if (personal.fitnessAdjPct != null && Math.round(personal.fitnessAdjPct) !== 0) {
    const sign = personal.fitnessAdjPct > 0 ? '+' : '';
    parts.push(`fitness ${sign}${Math.round(personal.fitnessAdjPct)}%`);
  }
  parts.push(`band ±${bandPct}%`);

  return {
    seconds: personal.seconds,
    lowSeconds: personal.seconds - half,
    highSeconds: personal.seconds + half,
    components: { ...(cross?.components ?? {}), personalCurve: personal.seconds },
    confidence,
    basis: parts.join('  '),
    modelVersion: personal.tier === 2 ? 'personal_curve_v3' : 'race_anchor_v3',
    featureVector: cross?.featureVector,
  };
}

/**
 * The tier-0 population ensemble — the fallback when the runner has no
 * detected races, and the cross-check component otherwise. Formerly the
 * public `predictRaceFromRuns`; renamed so the v3 ladder wraps it.
 * `activities` is still needed raw for best-effort Riegel and anchor detection.
 */
function ensemblePrediction(
  runs: PredictRun[],
  activities: PredictActivity[],
  asOfDate: string,
  targetMeters = MARATHON_METERS,
): RacePrediction | null {
  // ---- Ridge primary (run_ww model, marathon native) ------------------------
  // v2 is PRIMARY when usable; v1 is the instant fallback (model file stays).
  // Both predict the MARATHON; scale to other targets via Riegel from the
  // marathon-equivalent so a non-marathon target still rides the model.
  const ridgeV2 = ridgeV2Predict(runs, asOfDate);
  const ridgeV1 = ridgePredict(runs, asOfDate);

  // Choose the active ridge: v2 when usable, else v1 when usable, else none.
  // The active model carries its own conformal offset + basis token.
  const active: ActiveRidge | null = ridgeV2.usable
    ? { kind: 'v2', seconds: ridgeV2.seconds, usable: true, tandaP: ridgeV2.features.tanda_P,
        wkKmMean: ridgeV2.features.wk_km_mean, paceOverall: ridgeV2.features.pace_overall,
        offset: RIDGE_V2_CONFORMAL_OFFSET_S, basisToken: RIDGE_V2_BASIS_TOKEN,
        features: ridgeV2.features }
    : ridgeV1.usable
      ? { kind: 'v1', seconds: ridgeV1.seconds, usable: true, tandaP: ridgeV1.features.tanda_P,
          wkKmMean: ridgeV1.features.wk_km_mean, paceOverall: ridgeV1.features.pace_overall,
          offset: RIDGE_CONFORMAL_OFFSET_S, basisToken: RIDGE_V1_BASIS_TOKEN,
          // Deliberately the V2 vector even when v1 drives: ActiveRidge.features
          // snapshots the full 39-feature v2 vector uniformly (see its doc).
          features: ridgeV2.features }
      : null;

  const ridgeSeconds =
    active != null
      ? targetMeters === MARATHON_METERS
        ? active.seconds
        : riegelSeconds({ meters: MARATHON_METERS, seconds: active.seconds }, targetMeters)
      : null;

  // ---- Tanda component (volume + training pace over the preceding 8 wks) ----
  const tandaInputs = tandaInputsFromActivities(runs, asOfDate);
  const tandaUsable =
    tandaInputs.coverage >= MIN_COVERAGE_WEEKS &&
    tandaInputs.nRuns > 0 &&
    tandaInputs.paceSecPerKmMean > 0 &&
    tandaInputs.weeklyKmMean > 0;

  let tandaSeconds: number | null = null;
  if (tandaUsable) {
    const marathon = tandaMarathonSeconds(tandaInputs);
    tandaSeconds =
      targetMeters === MARATHON_METERS
        ? marathon
        : riegelSeconds({ meters: MARATHON_METERS, seconds: marathon }, targetMeters);
  }

  // ---- Riegel component (longest recent best effort) ------------------------
  const effort = bestRecentEffort(activities, asOfDate);
  const riegelTime = effort != null ? riegelSeconds(effort, targetMeters) : null;
  const riegelUsable = riegelTime != null && Number.isFinite(riegelTime) && riegelTime > 0;

  // ---- Parametric blend (the legacy primary; now fallback + cross-check) -----
  const bothParametric = tandaSeconds != null && riegelUsable;
  let parametricSeconds: number | null = null;
  if (bothParametric) {
    parametricSeconds =
      TANDA_WEIGHT * (tandaSeconds as number) + RIEGEL_WEIGHT * (riegelTime as number);
  } else if (tandaSeconds != null) {
    parametricSeconds = tandaSeconds;
  } else if (riegelUsable) {
    parametricSeconds = riegelTime as number;
  }

  if (ridgeSeconds == null && parametricSeconds == null) return null;

  const components: PredictionComponents = {};
  if (ridgeSeconds != null) {
    if (active!.kind === 'v2') components.ridgeV2 = ridgeSeconds;
    else components.ridge = ridgeSeconds;
  }
  if (tandaSeconds != null) components.tanda = tandaSeconds;
  if (riegelUsable) components.riegel = riegelTime as number;
  if (parametricSeconds != null) components.parametric = parametricSeconds;

  // ===== Model estimate (ridge-primary, else parametric fallback) ============
  let model: RacePrediction;
  if (ridgeSeconds != null) {
    model = assembleRidgePrediction({
      active: active!,
      ridgeSeconds,
      parametricSeconds,
      components,
      effort,
      riegelUsable,
      targetMeters,
    });
  } else {
    const seconds = parametricSeconds as number;
    const solidCoverage = tandaInputs.coverage >= SOLID_COVERAGE_WEEKS;
    const halfFrac = bothParametric && solidCoverage ? HALF_WIDTH_TIGHT : HALF_WIDTH_WIDE;
    const half = seconds * halfFrac;

    let confidence: PredictionConfidence;
    if (bothParametric && solidCoverage) confidence = 'high';
    else if (bothParametric) confidence = 'medium';
    else confidence = 'low';

    model = {
      seconds,
      lowSeconds: seconds - half,
      highSeconds: seconds + half,
      components,
      confidence,
      basis: buildBasis(tandaUsable ? tandaInputs : null, effort, riegelUsable),
      modelVersion: 'parametric',
    };
  }

  // ===== Race anchor =========================================================
  // A real recent race is the strongest fitness signal we have. Blend the most
  // recent race (Riegel-projected to the target, age-decayed) toward the model
  // estimate; an anchor present also tightens the interval and lifts confidence.
  const anchor = mostRecentAnchor(activities, asOfDate, targetMeters);
  if (anchor != null) {
    return applyAnchor(model, anchor, active != null);
  }

  return model;
}

/** A race anchor: a real race result projected to the target distance. */
interface RaceAnchor {
  /** The detected race that anchors the prediction. */
  race: RaceResult;
  /** Race time projected to the target distance via Riegel, seconds. */
  projectedSeconds: number;
  /** Age of the race in days as of the prediction date. */
  ageDays: number;
  /** Blend weight on the anchor, clamped to [min, max]. */
  weight: number;
}

/**
 * The most recent detected race within `ANCHOR_MAX_AGE_DAYS`, projected to the
 * target distance via Riegel, with its age-decayed blend weight. Null when there
 * is no recent race. `detectRaceResults` returns races newest-first.
 */
function mostRecentAnchor(
  activities: PredictActivity[],
  asOfDate: string,
  targetMeters: number,
): RaceAnchor | null {
  const races = detectRaceResults(
    activities.map((a) => ({
      localDate: a.localDate,
      distanceMeters: a.distanceMeters,
      movingTimeS: a.movingTimeS,
      elapsedTimeS: a.elapsedTimeS,
      workoutType: a.workoutType,
    })),
    asOfDate,
  );
  for (const race of races) {
    const ageDays = civilDayDiff(asOfDate, race.date);
    if (ageDays < 0 || ageDays > ANCHOR_MAX_AGE_DAYS) continue;
    const projectedSeconds = riegelSeconds(
      { meters: race.distanceMeters, seconds: race.seconds },
      targetMeters,
    );
    if (!Number.isFinite(projectedSeconds) || projectedSeconds <= 0) continue;
    const weight = clamp(
      Math.exp(-ageDays / ANCHOR_DECAY_TAU),
      ANCHOR_WEIGHT_MIN,
      ANCHOR_WEIGHT_MAX,
    );
    return { race, projectedSeconds, ageDays, weight };
  }
  return null;
}

/**
 * Blend a race anchor into the model estimate:
 *   final = w·anchorProjection + (1−w)·modelEstimate.
 * The anchor tightens the interval (half-width = (1 − w/2)·model half-width,
 * floored at ±`ANCHOR_HALF_WIDTH_FLOOR` of the prediction) and lifts confidence
 * to 'high' when the race is recent (≤`ANCHOR_HIGH_CONF_DAYS` days) AND ridge was
 * usable. The basis gains an "anchored to H:MM:SS <class>  <Mon DD>" note.
 */
function applyAnchor(
  model: RacePrediction,
  anchor: RaceAnchor,
  ridgeUsable: boolean,
): RacePrediction {
  const w = anchor.weight;
  const seconds = w * anchor.projectedSeconds + (1 - w) * model.seconds;

  // Tighten the model's band, then floor the half-width at ±3% of the seconds.
  const modelHalf = (model.highSeconds - model.lowSeconds) / 2;
  const tightened = (1 - w / 2) * modelHalf;
  const half = Math.max(tightened, ANCHOR_HALF_WIDTH_FLOOR * seconds);

  const confidence: PredictionConfidence =
    anchor.ageDays <= ANCHOR_HIGH_CONF_DAYS && ridgeUsable ? 'high' : model.confidence;

  const note = `anchored to ${formatDuration(anchor.projectedSeconds)} ${anchorLabel(
    anchor.race.distanceClass,
  )}  ${monthDay(anchor.race.date)}`;

  return {
    seconds,
    lowSeconds: seconds - half,
    highSeconds: seconds + half,
    components: {
      ...model.components,
      anchor: anchor.projectedSeconds,
      anchorMeta: {
        seconds: anchor.projectedSeconds,
        weight: anchor.weight,
        raceDate: anchor.race.date,
      },
    },
    confidence,
    basis: `${model.basis}  ${note}`,
    modelVersion: `${model.modelVersion}+anchor`,
    featureVector: model.featureVector,
  };
}

/** Clamp `x` into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Race distance class → human label for the basis note. */
function anchorLabel(cls: RaceResult['distanceClass']): string {
  if (cls === 'marathon') return 'marathon';
  if (cls === 'half') return 'half';
  if (cls === '10k') return '10K';
  if (cls === '5k') return '5K';
  return 'race';
}

/** Civil 'YYYY-MM-DD' → "Apr 20" (UTC, locale-stable). */
function monthDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const mon = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}`;
}

/** Whole-day difference asOf − day in civil days (both 'YYYY-MM-DD'). */
function civilDayDiff(asOf: string, day: string): number {
  const a = new Date(`${asOf}T12:00:00Z`).getTime();
  const b = new Date(`${day}T12:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

/**
 * The active ridge model (v2 primary, else v1 fallback) flattened to the fields
 * the ensemble needs: its marathon point estimate, conformal offset, basis token,
 * and the base-window signals (tanda_P / volume / pace) the guards + basis read.
 * This lets the assembly stay model-version-agnostic.
 */
interface ActiveRidge {
  kind: 'v2' | 'v1';
  /** The model's MARATHON point estimate, seconds (pre Riegel-scale). */
  seconds: number;
  usable: boolean;
  /** Last-8-wk training-pace signal (s/km), NaN when thin — slow-tail guard. */
  tandaP: number;
  /** 16-wk mean weekly km, for the basis line. */
  wkKmMean: number;
  /** Whole-window training pace (s/km), for the basis line. */
  paceOverall: number;
  /** The model's 80% conformal half-width offset, seconds. */
  offset: number;
  /** Basis token naming the model + corpus. */
  basisToken: string;
  /** The full 39-feature v2 vector (always computed), for snapshotting. */
  features: RidgeV2FeatureVector;
}

/**
 * Assemble the final prediction when ridge drives it: start from the active
 * ridge point estimate and its 80% conformal band (Riegel-scaled for non-marathon
 * targets), then apply the cross-check (disagreement widening) and the slow-tail
 * guard. Works for either ridge version via the `ActiveRidge` abstraction.
 */
function assembleRidgePrediction(args: {
  active: ActiveRidge;
  ridgeSeconds: number;
  parametricSeconds: number | null;
  components: PredictionComponents;
  effort: { label: string; seconds: number } | null;
  riegelUsable: boolean;
  targetMeters: number;
}): RacePrediction {
  const {
    active,
    ridgeSeconds,
    parametricSeconds,
    components,
    effort,
    riegelUsable,
    targetMeters,
  } = args;

  const seconds = ridgeSeconds;

  // Conformal half-width: the active model's 80% offset (v2 ±21.6 min / v1 ±23.4
  // min), Riegel-scaled along with the point estimate for non-marathon targets so
  // the band stays proportional to the (scaled) prediction.
  const scale =
    targetMeters === MARATHON_METERS ? 1 : seconds / active.seconds;
  let lowSeconds = seconds - active.offset * scale;
  let highSeconds = seconds + active.offset * scale;
  let confidence: PredictionConfidence = 'high';
  const basisNotes: string[] = [];

  // ---- Cross-check: ridge vs parametric disagreement ------------------------
  if (
    parametricSeconds != null &&
    Math.abs(seconds - parametricSeconds) > DISAGREEMENT_THRESHOLD_S
  ) {
    // Envelope BOTH estimates (plus the conformal band around ridge) and soften.
    lowSeconds = Math.min(lowSeconds, parametricSeconds);
    highSeconds = Math.max(highSeconds, parametricSeconds);
    confidence = 'medium';
    basisNotes.push('ridge vs volume model disagree');
  }

  // ---- Slow-tail guard (transfer-experiment Q4) -----------------------------
  // tanda_P is the last-8-wk training-pace signal; thin/absent pace OR a
  // slower-than-4:10 prediction is exactly where volume-only over-promised.
  const tandaPThin = !Number.isFinite(active.tandaP);
  if (active.seconds > SLOW_TAIL_THRESHOLD_S || tandaPThin) {
    const mid = (lowSeconds + highSeconds) / 2;
    lowSeconds = mid - ((mid - lowSeconds) * SLOW_TAIL_WIDEN);
    highSeconds = mid + ((highSeconds - mid) * SLOW_TAIL_WIDEN);
    if (confidence === 'high') confidence = 'medium';
    basisNotes.push(tandaPThin ? 'thin pace data' : 'slow-tail caution');
  }

  // ---- Basis line -----------------------------------------------------------
  // Volume/pace come from the ridge model's OWN 16-wk window so the basis
  // describes the signal that actually drove the prediction.
  // Display in MILES (the app-wide unit); the model itself computes in km.
  const parts: string[] = [active.basisToken];
  parts.push(`16-wk volume ${Math.round(metersToMiles(active.wkKmMean * 1000))} mi/wk`);
  if (Number.isFinite(active.paceOverall)) {
    parts.push(`training pace ${formatPace(active.paceOverall, 'mi')}`);
  }
  if (effort && riegelUsable) {
    parts.push(`${effortLabel(effort.label)} best ${formatDuration(effort.seconds)}`);
  }
  for (const n of basisNotes) parts.push(n);
  const basis = parts.join('  ');

  const modelVersion = active.kind === 'v2' ? 'ridge_v2' : 'ridge_v1';

  return {
    seconds,
    lowSeconds,
    highSeconds,
    components,
    confidence,
    basis,
    modelVersion,
    featureVector: active.features,
  };
}

/**
 * Build the human-readable basis string from whichever signals fed the blend,
 * e.g. "8-wk volume 96 km/wk  training pace 4:52/km  10K best 38:15". Volume
 * and pace come from the Tanda window; the best-effort segment from Riegel.
 */
function buildBasis(
  tandaInputs: { weeklyKmMean: number; paceSecPerKmMean: number } | null,
  effort: { label: string; seconds: number } | null,
  riegelUsable: boolean,
): string {
  const parts: string[] = [];
  if (tandaInputs) {
    parts.push(`8-wk volume ${Math.round(metersToMiles(tandaInputs.weeklyKmMean * 1000))} mi/wk`);
    parts.push(`training pace ${formatPace(tandaInputs.paceSecPerKmMean, 'mi')}`);
  }
  if (effort && riegelUsable) {
    parts.push(`${effortLabel(effort.label)} best ${formatDuration(effort.seconds)}`);
  }
  return parts.join('  ');
}

/** Canonical effort label → display token ("10k" → "10K", "1 mile" → "1 mi"). */
function effortLabel(name: string): string {
  if (name === '10k') return '10K';
  if (name === '5k') return '5K';
  if (name === '1 mile') return '1 mi';
  return name;
}

// ---------------------------------------------------------------------------
// Prediction-over-time series (the Trends trendline)
// ---------------------------------------------------------------------------

/** One point on the prediction trendline: a week-end as-of and its prediction. */
export interface PredictionSeriesPoint {
  /** Civil 'YYYY-MM-DD' Monday week-start this point is keyed to. */
  weekStart: string;
  /** Civil 'YYYY-MM-DD' Sunday week-end the prediction was computed as-of. */
  asOf: string;
  /** Predicted finish seconds at this week-end, or null when coverage too thin. */
  seconds: number | null;
  /** Lower band edge at this week-end (faster), null whenever `seconds` is. */
  lowSeconds: number | null;
  /** Upper band edge at this week-end (slower), null whenever `seconds` is. */
  highSeconds: number | null;
}

/**
 * The prediction at each completed week across `weekStarts`, for the Trends
 * trendline. For every Monday week-start we predict AS OF that week's Sunday
 * (weekStart + 6 days), feeding only the activities up to that day, so each
 * point reflects what the model would have said at the end of that week.
 *
 * A point is null where the as-of window has fewer than `MIN_COVERAGE_WEEKS`
 * weeks of run coverage (so the line never starts on a single-week stub). Pure
 * + deterministic; `weekStarts` are sorted ascending before computing.
 */
export function predictionSeries(
  activities: PredictActivity[],
  weekStarts: string[],
  targetMeters = MARATHON_METERS,
): PredictionSeriesPoint[] {
  const ordered = [...weekStarts].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  // Shape the run array ONCE — only `asOf` changes across the ~80–100 weekly
  // points, and predictRaceFromRuns never mutates its input.
  const runs = prepareRuns(activities);
  return ordered.map((weekStart) => {
    const asOf = shiftCivil(weekStart, 6); // the week's Sunday
    const pred = predictRaceFromRuns(runs, activities, asOf, targetMeters);
    return {
      weekStart: weekStartOf(weekStart, 'mon'),
      asOf,
      seconds: pred ? pred.seconds : null,
      lowSeconds: pred ? pred.lowSeconds : null,
      highSeconds: pred ? pred.highSeconds : null,
    };
  });
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC, tz-agnostic). */
function shiftCivil(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
