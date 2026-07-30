/**
 * Node tests for the run_ww ridge marathon model (`src/lib/predict/ridge.ts`):
 *  - feature math against hand-built fixtures, INCLUDING the unit conversions
 *    (metres→km, seconds-stay-seconds for pace), zero/empty weeks, the 16-wk
 *    window edge, taper ratio, ramp slope, and the demographic imputation,
 *  - a GOLDEN test: the median feature vector reproduces the corpus median
 *    finish (~226 min) shipped in the training artifact,
 *  - monotonicity: more volume and faster pace both predict a faster marathon,
 *  - the 80% conformal interval arithmetic.
 *
 * Pure functions only — no Supabase, no React.
 */
import modelJson from '../predict/model/ridge_model.json';
import {
  ridgeFeatures,
  ridgePredict,
  scoreRidge,
  RIDGE_CONFORMAL_OFFSET_S,
  RIDGE_MIN_ACTIVE_WEEKS,
  type PredictRun,
  type RidgeFeatureVector,
} from '../predict/ridge';

const MODEL = modelJson as {
  features: string[];
  weights: Record<string, number>;
  intercept: number;
  feature_medians: Record<string, number>;
  conformal_offset_sec_80: number;
};

/** Civil 'YYYY-MM-DD' + day delta. */
function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const ASOF = '2026-05-31';

// ---------------------------------------------------------------------------
// Feature math + unit conversions
// ---------------------------------------------------------------------------
describe('ridgeFeatures — units and window', () => {
  it('converts metres→km and keeps seconds for pace (no ×60 trap)', () => {
    // One 10 km run @ 300 s/km this week (3000 s). Pace must be 300 s/km, NOT
    // 18000 (the min→s×60 trap) and NOT 0.3 (the km→m trap).
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 },
    ];
    const f = ridgeFeatures(runs, ASOF);
    expect(f.total_km).toBeCloseTo(10, 9);
    expect(f.avg_run_dist).toBeCloseTo(10, 9);
    expect(f.longest_day_km).toBeCloseTo(10, 9);
    expect(f.pace_overall).toBeCloseTo(300, 9);
    expect(f.tanda_P).toBeCloseTo(300, 9);
    // 10 km over the 16-wk window → mean 10/16; only week 0 active.
    expect(f.wk_km_mean).toBeCloseTo(10 / 16, 9);
    expect(f.wk_km_peak).toBeCloseTo(10, 9);
    expect(f.n_weeks_active).toBe(1);
    expect(f.consistency).toBeCloseTo(1 / 16, 9);
  });

  it('distance-weights pace over the whole window and the last-8-wk tanda_P', () => {
    // 10 km @ 300 s/km (3000 s) this week and 20 km @ 270 s/km (5400 s) this week.
    // Σtime/Σkm = 8400 / 30 = 280 s/km.
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 },
      { localDate: shift(ASOF, -2), distanceMeters: 20000, movingTimeS: 5400 },
    ];
    const f = ridgeFeatures(runs, ASOF);
    expect(f.pace_overall).toBeCloseTo(280, 9);
    expect(f.tanda_P).toBeCloseTo(280, 9);
    expect(f.long_run_frac).toBeCloseTo(0, 9); // neither run ≥ 25 km
  });

  it('counts runs ≥25 km toward long_run_frac and longest_day_km', () => {
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 },
      { localDate: shift(ASOF, -2), distanceMeters: 30000, movingTimeS: 9000 }, // long
    ];
    const f = ridgeFeatures(runs, ASOF);
    expect(f.longest_day_km).toBeCloseTo(30, 9);
    expect(f.long_run_frac).toBeCloseTo(0.5, 9); // 1 of 2 run-days
  });

  it('drops runs outside the 16-wk (112-day) window', () => {
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 },
      { localDate: shift(ASOF, -112), distanceMeters: 99000, movingTimeS: 9000 }, // exactly 112 days → excluded
      { localDate: shift(ASOF, -200), distanceMeters: 99000, movingTimeS: 9000 }, // far past
    ];
    const f = ridgeFeatures(runs, ASOF);
    // Only the 10 km run is inside the window.
    expect(f.total_km).toBeCloseTo(10, 9);
    expect(f.n_weeks_active).toBe(1);
  });

  it('excludes timeless runs from pace but not from volume', () => {
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 },
      { localDate: shift(ASOF, -2), distanceMeters: 10000, movingTimeS: null }, // no time
    ];
    const f = ridgeFeatures(runs, ASOF);
    expect(f.total_km).toBeCloseTo(20, 9); // both count toward volume
    expect(f.pace_overall).toBeCloseTo(300, 9); // only the timed run
  });

  it('zero/empty input → NaN pace, NaN taper, zero volume, no active weeks', () => {
    const f = ridgeFeatures([], ASOF);
    expect(f.wk_km_mean).toBe(0);
    expect(f.n_weeks_active).toBe(0);
    expect(Number.isNaN(f.pace_overall)).toBe(true);
    expect(Number.isNaN(f.tanda_P)).toBe(true);
    expect(Number.isNaN(f.taper_ratio)).toBe(true);
  });

  it('taper_ratio = last-2-weeks mean ÷ peak week', () => {
    // Week 0: 10 km, week 1: 30 km (also the peak), older weeks empty.
    // last-2 mean = (10+30)/2 = 20; peak = 30; ratio = 0.6667.
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 },
      { localDate: shift(ASOF, -8), distanceMeters: 30000, movingTimeS: 9000 },
    ];
    const f = ridgeFeatures(runs, ASOF);
    expect(f.wk_km_peak).toBeCloseTo(30, 9);
    expect(f.taper_ratio).toBeCloseTo(20 / 30, 9);
  });

  it('ramp_slope is positive when chronological weekly volume builds', () => {
    // Older weeks small, recent weeks large → building → positive slope.
    const runs: PredictRun[] = [];
    for (let wk = 0; wk < 8; wk++) {
      const km = (8 - wk) * 10; // week 0 (recent) = 80, week 7 (old) = 10
      runs.push({ localDate: shift(ASOF, -(wk * 7 + 1)), distanceMeters: km * 1000, movingTimeS: km * 300 });
    }
    const f = ridgeFeatures(runs, ASOF);
    expect(f.ramp_slope).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Demographics imputation
// ---------------------------------------------------------------------------
describe('ridgeFeatures — demographics', () => {
  it('imputes the training-median cohort one-hots by default', () => {
    const f = ridgeFeatures(
      [{ localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 }],
      ASOF,
    );
    expect(f.gender_M).toBe(MODEL.feature_medians.gender_M);
    expect(f.age_35_54).toBe(MODEL.feature_medians.age_35_54);
  });

  it('honors an explicit profile override', () => {
    const f = ridgeFeatures(
      [{ localDate: shift(ASOF, -1), distanceMeters: 10000, movingTimeS: 3000 }],
      ASOF,
      { male: false, ageBand: '55plus' },
    );
    expect(f.gender_M).toBe(0);
    expect(f.age_18_34).toBe(0);
    expect(f.age_35_54).toBe(0);
    expect(f.age_55plus).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Golden: the median vector reproduces the corpus median finish
// ---------------------------------------------------------------------------
describe('scoreRidge — golden', () => {
  it('the median feature vector reproduces the ~226-min corpus median finish', () => {
    const median = { ...MODEL.feature_medians } as unknown as RidgeFeatureVector;
    const pred = scoreRidge(median);
    // Hand-recompute intercept + Σ w·median to the same value.
    let manual = MODEL.intercept;
    for (const f of MODEL.features) manual += MODEL.weights[f]! * MODEL.feature_medians[f]!;
    expect(pred).toBeCloseTo(manual, 6);
    // ~13627 s = 3:47:07, within a couple of minutes of the 226-min (13560 s)
    // run_ww median finish reported in the transfer experiment.
    expect(pred).toBeGreaterThan(13560 - 120);
    expect(pred).toBeLessThan(13560 + 120);
  });

  it('NaN numeric features fall back to the training median in the dot product', () => {
    // A vector with a NaN pace should still score finite (callers gate on usable).
    const median = { ...MODEL.feature_medians } as unknown as RidgeFeatureVector;
    median.pace_overall = NaN;
    median.tanda_P = NaN;
    const pred = scoreRidge(median);
    expect(Number.isFinite(pred)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Monotonicity
// ---------------------------------------------------------------------------
describe('ridgePredict — monotonicity', () => {
  /** A full 16-wk block at the given weekly km and pace (s/km), 6 runs/wk. */
  function block(weeklyKm: number, paceSecPerKm: number): PredictRun[] {
    const perRunKm = weeklyKm / 6;
    const runs: PredictRun[] = [];
    let day = shift(ASOF, -(16 * 7 - 1));
    for (let w = 0; w < 16; w++) {
      for (let i = 0; i < 6; i++) {
        runs.push({
          localDate: shift(day, i),
          distanceMeters: perRunKm * 1000,
          movingTimeS: perRunKm * paceSecPerKm,
        });
      }
      day = shift(day, 7);
    }
    return runs;
  }

  it('more weekly volume predicts a faster marathon (lower seconds)', () => {
    const base = ridgePredict(block(70, 300), ASOF);
    const more = ridgePredict(block(110, 300), ASOF);
    expect(base.usable).toBe(true);
    expect(more.usable).toBe(true);
    expect(more.seconds).toBeLessThan(base.seconds);
  });

  it('a faster training pace predicts a faster marathon (lower seconds)', () => {
    const base = ridgePredict(block(90, 320), ASOF);
    const faster = ridgePredict(block(90, 280), ASOF);
    expect(faster.seconds).toBeLessThan(base.seconds);
  });

  it('a realistic 90 km/wk @ 5:00/km block lands in a sane marathon range', () => {
    const p = ridgePredict(block(90, 300), ASOF);
    expect(p.usable).toBe(true);
    // Well-trained but not elite → roughly 2:40–3:30, never absurd.
    expect(p.seconds).toBeGreaterThan(2 * 3600 + 30 * 60);
    expect(p.seconds).toBeLessThan(3 * 3600 + 40 * 60);
  });
});

// ---------------------------------------------------------------------------
// Usability + conformal interval arithmetic
// ---------------------------------------------------------------------------
describe('ridgePredict — usability + conformal band', () => {
  it('is not usable with fewer than the minimum active weeks', () => {
    const runs: PredictRun[] = [];
    // Only 4 active weeks.
    let day = shift(ASOF, -(4 * 7 - 1));
    for (let w = 0; w < 4; w++) {
      runs.push({ localDate: day, distanceMeters: 16000, movingTimeS: 16 * 290 });
      day = shift(day, 7);
    }
    const p = ridgePredict(runs, ASOF);
    expect(p.coverageWeeks).toBe(4);
    expect(p.coverageWeeks).toBeLessThan(RIDGE_MIN_ACTIVE_WEEKS);
    expect(p.usable).toBe(false);
  });

  it('is not usable with enough weeks but no pace data', () => {
    const runs: PredictRun[] = [];
    let day = shift(ASOF, -(8 * 7 - 1));
    for (let w = 0; w < 8; w++) {
      runs.push({ localDate: day, distanceMeters: 16000, movingTimeS: null }); // no time
      day = shift(day, 7);
    }
    const p = ridgePredict(runs, ASOF);
    expect(p.coverageWeeks).toBe(8);
    expect(Number.isNaN(p.features.pace_overall)).toBe(true);
    expect(p.usable).toBe(false);
  });

  it('brackets the prediction by exactly ±the 80% conformal offset', () => {
    const runs: PredictRun[] = [];
    let day = shift(ASOF, -(16 * 7 - 1));
    for (let w = 0; w < 16; w++) {
      for (let i = 0; i < 6; i++) {
        runs.push({ localDate: shift(day, i), distanceMeters: 15000, movingTimeS: 15 * 300 });
      }
      day = shift(day, 7);
    }
    const p = ridgePredict(runs, ASOF);
    expect(p.usable).toBe(true);
    expect(p.lowSeconds).toBeCloseTo(p.seconds - RIDGE_CONFORMAL_OFFSET_S, 9);
    expect(p.highSeconds).toBeCloseTo(p.seconds + RIDGE_CONFORMAL_OFFSET_S, 9);
    expect(RIDGE_CONFORMAL_OFFSET_S).toBeCloseTo(MODEL.conformal_offset_sec_80, 9);
  });
});
