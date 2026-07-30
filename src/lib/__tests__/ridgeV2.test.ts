/**
 * Node tests for ridge **v2** (`src/lib/predict/ridgeV2.ts`):
 *  - F1 day-aggregation semantics (same-day runs sum into one day; pace blends),
 *    baseline-easy-pace excluding-hard one iteration, best_day_pace_8k /
 *    best_sustained_15k on DAY aggregates, pace_p10 / intensity_spread,
 *  - F2 anchor imputation (NaN → median) and Riegel-to-marathon scaling,
 *  - F3 deep-history windows (32wk, ytd, prior-block mean, peak/active weeks,
 *    volume_trend), incl. partial-history behaviour,
 *  - GOLDEN: the median feature vector reproduces the corpus median finish,
 *  - monotonicity: a faster best_sustained_15k predicts a faster marathon,
 *  - the 80% conformal interval arithmetic (±1293.55 s).
 *
 * Pure functions only — no Supabase, no React.
 */
import modelJson from '../predict/model/ridge_model_v2.json';
import type { PredictRun } from '../predict/ridge';
import {
  aggregateByDay,
  f1Features,
  f2Features,
  f3Features,
  ridgeV2Features,
  ridgeV2Predict,
  scoreRidgeV2,
  RIDGE_V2_CONFORMAL_OFFSET_S,
  RIDGE_V2_MIN_ACTIVE_WEEKS,
  type DayRow,
  type RidgeV2FeatureVector,
} from '../predict/ridgeV2';

const MODEL = modelJson as {
  features: string[];
  weights: Record<string, number>;
  intercept: number;
  feature_medians: Record<string, number>;
  conformal_offset_sec_80: number;
};

function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const ASOF = '2026-05-31';

// ---------------------------------------------------------------------------
// Day aggregation — the load-bearing v2 semantic
// ---------------------------------------------------------------------------
describe('aggregateByDay — sums same-day runs (distance + timed duration)', () => {
  it('blends two same-day runs into ONE day with the blended pace', () => {
    // 2 km warmup @ 360 s/km (720 s) + 13 km tempo @ 240 s/km (3120 s) same day.
    // Day = 15 km, 3840 s timed → pace 3840/15 = 256 s/km (NOT two separate days).
    const runs: PredictRun[] = [
      { localDate: '2026-05-30', distanceMeters: 2000, movingTimeS: 720 },
      { localDate: '2026-05-30', distanceMeters: 13000, movingTimeS: 3120 },
    ];
    const days = aggregateByDay(runs);
    expect(days).toHaveLength(1);
    expect(days[0]!.distKm).toBeCloseTo(15, 9);
    expect(days[0]!.timedSeconds).toBeCloseTo(3840, 9);
    expect(days[0]!.timedKm).toBeCloseTo(15, 9);
    // blended day pace
    expect(days[0]!.timedSeconds / days[0]!.timedKm).toBeCloseTo(256, 9);
  });

  it('drops zero-distance runs and excludes untimed km from the timed totals', () => {
    const runs: PredictRun[] = [
      { localDate: '2026-05-30', distanceMeters: 0, movingTimeS: 600 },
      { localDate: '2026-05-30', distanceMeters: 10000, movingTimeS: null }, // untimed
      { localDate: '2026-05-30', distanceMeters: 5000, movingTimeS: 1500 },
    ];
    const days = aggregateByDay(runs);
    expect(days).toHaveLength(1);
    expect(days[0]!.distKm).toBeCloseTo(15, 9); // 10 + 5 (zero-dist dropped)
    expect(days[0]!.timedKm).toBeCloseTo(5, 9); // only the timed 5 km
    expect(days[0]!.timedSeconds).toBeCloseTo(1500, 9);
  });
});

// ---------------------------------------------------------------------------
// F1 — intensity vs own baseline (on DAY aggregates)
// ---------------------------------------------------------------------------
describe('f1Features — baseline, hard days, best-day paces', () => {
  /** Build a block of easy days plus a few hard days, all within the 16-wk window. */
  function f1Block(): DayRow[] {
    const days: DayRow[] = [];
    // 12 easy days @ 300 s/km, 12 km each (well inside the window).
    for (let i = 0; i < 12; i++) {
      const date = shift(ASOF, -(i * 2 + 1));
      days.push({ localDate: date, distKm: 12, timedSeconds: 12 * 300, timedKm: 12 });
    }
    return days;
  }

  it('baseline excludes hard days (one iteration) and counts hard DAYS', () => {
    const days = f1Block();
    // Two hard days: 16 km @ 252 s/km (16% faster than 300 → ≤0.90·base, ≥5km).
    days.push({ localDate: shift(ASOF, -2), distKm: 16, timedSeconds: 16 * 252, timedKm: 16 });
    days.push({ localDate: shift(ASOF, -4), distKm: 18, timedSeconds: 18 * 250, timedKm: 18 });
    const f = f1Features(days, ASOF);
    // Baseline should sit at the easy-day pace (300), not be dragged by the fast days.
    expect(f.baseline_easy_pace).toBeCloseTo(300, 6);
    expect(f.n_hard_days_16wk).toBe(2);
    // best_sustained_15k = fastest day ≥15 km = 250 s/km.
    expect(f.best_sustained_15k).toBeCloseTo(250, 6);
    // best_day_pace_8k = fastest day ≥8 km = 250 s/km.
    expect(f.best_day_pace_8k).toBeCloseTo(250, 6);
    // intensity_spread = baseline − pace_p10 ≥ 0 (p10 is the fast tail).
    expect(f.intensity_spread).toBeGreaterThan(0);
  });

  it('a sub-8km hard day does NOT set best_day_pace_8k/best_sustained_15k', () => {
    const days = f1Block();
    // A blazing 6 km day — fast but under the 8 km/15 km distance gates.
    days.push({ localDate: shift(ASOF, -3), distKm: 6, timedSeconds: 6 * 200, timedKm: 6 });
    const f = f1Features(days, ASOF);
    // best_day_pace_8k stays at the easy 300 (the 12 km easy days are ≥8 km; the
    // fast 6 km day is under the 8 km gate so it can't set it).
    expect(f.best_day_pace_8k).toBeCloseTo(300, 6);
    // No day reaches 15 km in this block → best_sustained_15k stays NaN.
    expect(Number.isNaN(f.best_sustained_15k)).toBe(true);
  });

  it('empty window → all-NaN F1 (median-imputed downstream)', () => {
    const f = f1Features([], ASOF);
    expect(Number.isNaN(f.baseline_easy_pace)).toBe(true);
    expect(f.n_hard_days_16wk).toBe(0);
    expect(Number.isNaN(f.best_sustained_15k)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F2 — prior-race anchors (NaN imputation + Riegel)
// ---------------------------------------------------------------------------
describe('f2Features — anchors and imputation', () => {
  it('no prior races → NaN anchors, zero flags', () => {
    const runs: PredictRun[] = [
      { localDate: shift(ASOF, -3), distanceMeters: 12000, movingTimeS: 12 * 300 },
    ];
    const f = f2Features(runs, ASOF);
    expect(f.n_prior_races).toBe(0);
    expect(f.has_prior_race).toBe(0);
    expect(f.has_prior_marathon).toBe(0);
    expect(Number.isNaN(f.prior_marathon_seconds)).toBe(true);
    expect(Number.isNaN(f.prior_race_riegel_seconds)).toBe(true);
  });

  it('a tagged prior half-marathon Riegel-scales to a marathon anchor', () => {
    const halfDate = shift(ASOF, -40);
    const runs: PredictRun[] = [
      // a base of easy runs so detection has a baseline (not strictly needed for tags)
      { localDate: shift(ASOF, -3), distanceMeters: 12000, movingTimeS: 12 * 300 },
      // tagged half-marathon @ 90 min (5400 s)
      { localDate: halfDate, distanceMeters: 21097, movingTimeS: 5400, workoutType: 1 },
    ];
    const f = f2Features(runs, ASOF);
    expect(f.has_prior_race).toBe(1);
    expect(f.n_prior_races).toBe(1);
    // Riegel 21.097 km → 42.195 km, exp 1.06: 5400·(42.195/21.097)^1.06
    const expected = 5400 * Math.pow(42.195 / 21.097, 1.06);
    expect(f.prior_race_riegel_seconds).toBeCloseTo(expected, 3);
    expect(f.days_since_prior_race).toBe(40);
    // not a marathon → marathon anchor stays NaN
    expect(f.has_prior_marathon).toBe(0);
    expect(Number.isNaN(f.prior_marathon_seconds)).toBe(true);
  });

  it('a tagged prior marathon sets the marathon anchor too', () => {
    const marDate = shift(ASOF, -70);
    const runs: PredictRun[] = [
      { localDate: marDate, distanceMeters: 42195, movingTimeS: 10800, workoutType: 1 }, // 3:00
    ];
    const f = f2Features(runs, ASOF);
    expect(f.has_prior_marathon).toBe(1);
    expect(f.prior_marathon_seconds).toBeCloseTo(10800, 6);
    expect(f.days_since_prior_marathon).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// F3 — deep history windows
// ---------------------------------------------------------------------------
describe('f3Features — 32wk / ytd / prior-block / trend', () => {
  it('splits km across 32wk, ytd and the 16-32 prior block', () => {
    const days: DayRow[] = [];
    // 40 weeks of history, 50 km in week 0..15 (recent), 30 km in 16..31, 20 in 32..39.
    for (let wk = 0; wk < 40; wk++) {
      const km = wk < 16 ? 50 : wk < 32 ? 30 : 20;
      const date = shift(ASOF, -(wk * 7 + 1));
      days.push({ localDate: date, distKm: km, timedSeconds: km * 300, timedKm: km });
    }
    const f = f3Features(days, ASOF);
    // ytd = all 40 weeks: 16·50 + 16·30 + 8·20 = 800 + 480 + 160 = 1440
    expect(f.km_year_to_date).toBeCloseTo(1440, 6);
    // 32wk = weeks 0..31: 800 + 480 = 1280
    expect(f.km_32wk).toBeCloseTo(1280, 6);
    // prior block mean (16..31): 480 / 16 = 30
    expect(f.wk_km_mean_16_32).toBeCloseTo(30, 6);
    // volume_trend = recent16 mean (800/16=50) / prior mean (30) = 1.6667
    expect(f.volume_trend).toBeCloseTo(50 / 30, 6);
    // peak week = 50, active weeks = 40
    expect(f.peak_week_year).toBeCloseTo(50, 6);
    expect(f.weeks_active_year).toBe(40);
  });

  it('partial history (<32wk) → prior-block + trend NaN, ytd/32wk over what exists', () => {
    const days: DayRow[] = [];
    for (let wk = 0; wk < 10; wk++) {
      const date = shift(ASOF, -(wk * 7 + 1));
      days.push({ localDate: date, distKm: 40, timedSeconds: 40 * 300, timedKm: 40 });
    }
    const f = f3Features(days, ASOF);
    expect(f.km_year_to_date).toBeCloseTo(400, 6);
    expect(f.km_32wk).toBeCloseTo(400, 6);
    expect(Number.isNaN(f.wk_km_mean_16_32)).toBe(true); // no prior block
    expect(Number.isNaN(f.volume_trend)).toBe(true);
    expect(f.weeks_active_year).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Golden: the median feature vector reproduces the corpus median finish
// ---------------------------------------------------------------------------
describe('scoreRidgeV2 — golden', () => {
  it('the median feature vector reproduces intercept + Σ w·median exactly', () => {
    const median = { ...MODEL.feature_medians } as unknown as RidgeV2FeatureVector;
    const pred = scoreRidgeV2(median);
    let manual = MODEL.intercept;
    for (const f of MODEL.features) manual += MODEL.weights[f]! * MODEL.feature_medians[f]!;
    expect(pred).toBeCloseTo(manual, 6);
    // The median vector should land near the ~226-min (13560 s) corpus median.
    expect(pred).toBeGreaterThan(13560 - 600);
    expect(pred).toBeLessThan(13560 + 600);
  });

  it('NaN features fall back to the training median (finite score)', () => {
    const median = { ...MODEL.feature_medians } as unknown as RidgeV2FeatureVector;
    median.best_sustained_15k = NaN;
    median.prior_marathon_seconds = NaN;
    median.volume_trend = NaN;
    expect(Number.isFinite(scoreRidgeV2(median))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Monotonicity + a realistic block
// ---------------------------------------------------------------------------
describe('ridgeV2Predict — monotonicity + sane range', () => {
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

  it('a faster best_sustained_15k (long-run speed) predicts a faster marathon', () => {
    // best_sustained_15k carries a POSITIVE coefficient (slower s/km → slower
    // finish), so a faster long run (lower s/km) should lower the prediction.
    const base = block(90, 300);
    // Inject a 20 km long run on the most recent rest day at a chosen pace.
    const slow = [...base, { localDate: shift(ASOF, -1), distanceMeters: 20000, movingTimeS: 20 * 300 }];
    const fast = [...base, { localDate: shift(ASOF, -1), distanceMeters: 20000, movingTimeS: 20 * 250 }];
    const pSlow = ridgeV2Predict(slow, ASOF);
    const pFast = ridgeV2Predict(fast, ASOF);
    expect(pFast.features.best_sustained_15k).toBeLessThan(pSlow.features.best_sustained_15k);
    expect(pFast.seconds).toBeLessThan(pSlow.seconds);
  });

  it('a realistic 90 km/wk @ 5:00/km block lands in a sane marathon range', () => {
    const p = ridgeV2Predict(block(90, 300), ASOF);
    expect(p.usable).toBe(true);
    expect(p.seconds).toBeGreaterThan(2 * 3600 + 20 * 60);
    expect(p.seconds).toBeLessThan(3 * 3600 + 40 * 60);
  });

  it('brackets the prediction by exactly ±the 80% conformal offset', () => {
    const p = ridgeV2Predict(block(80, 300), ASOF);
    expect(p.usable).toBe(true);
    expect(p.lowSeconds).toBeCloseTo(p.seconds - RIDGE_V2_CONFORMAL_OFFSET_S, 9);
    expect(p.highSeconds).toBeCloseTo(p.seconds + RIDGE_V2_CONFORMAL_OFFSET_S, 9);
    expect(RIDGE_V2_CONFORMAL_OFFSET_S).toBeCloseTo(MODEL.conformal_offset_sec_80, 9);
  });

  it('is not usable below the minimum active weeks', () => {
    const runs: PredictRun[] = [];
    let day = shift(ASOF, -(4 * 7 - 1));
    for (let w = 0; w < 4; w++) {
      runs.push({ localDate: day, distanceMeters: 16000, movingTimeS: 16 * 290 });
      day = shift(day, 7);
    }
    const p = ridgeV2Predict(runs, ASOF);
    expect(p.coverageWeeks).toBeLessThan(RIDGE_V2_MIN_ACTIVE_WEEKS);
    expect(p.usable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full vector wiring
// ---------------------------------------------------------------------------
describe('ridgeV2Features — wires all 39 features', () => {
  it('produces every model feature as a finite-or-NaN number', () => {
    const runs: PredictRun[] = [];
    let day = shift(ASOF, -(16 * 7 - 1));
    for (let w = 0; w < 16; w++) {
      for (let i = 0; i < 5; i++) {
        runs.push({ localDate: shift(day, i), distanceMeters: 14000, movingTimeS: 14 * 300 });
      }
      day = shift(day, 7);
    }
    const f = ridgeV2Features(runs, ASOF) as unknown as Record<string, number>;
    for (const name of MODEL.features) {
      expect(name in f).toBe(true);
      expect(typeof f[name]).toBe('number');
    }
  });
});
