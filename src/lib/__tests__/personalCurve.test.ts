/**
 * Node tests for the personal race curve (`src/lib/predict/personalCurve.ts`)
 * — the tier ladder that predicts from the runner's OWN detected races.
 * Fixtures use TAGGED races (workoutType 1) so detection is deterministic, and
 * keep races within ≤2 distinct weeks when a test needs the Tanda fitness
 * index to be unusable (coverage < 3 ⇒ no fitness scaling ⇒ exact math).
 */
import {
  personalCurvePredict,
  EXPONENT_PRIOR,
  TIER1_BAND,
  BAND_DEFAULT,
  BAND_FLOOR,
  MIN_RESIDUALS_FOR_BAND,
  type PersonalCurveResult,
} from '../predict/personalCurve';
import {
  MARATHON_METERS,
  type PredictRun,
} from '../predict/tanda';
import type { RunStreams } from '../run/analysis';
import {
  metersToMiles,
} from '../units';

const ASOF = '2026-06-01';

/** A tagged race run. */
function race(localDate: string, meters: number, seconds: number): PredictRun {
  return { localDate, distanceMeters: meters, movingTimeS: seconds, workoutType: 1 };
}

// NOTE: don't assert exact prior-exponent VALUES from races-only fixtures —
// the implied weekly volume depends on tandaInputsFromActivities' week
// counting. Assert self-consistency (seconds === pow(ratio, exponent)) and
// direction instead.

describe('personalCurvePredict — tier ladder gates', () => {
  it('returns null when no race efforts are detected', () => {
    const runs: PredictRun[] = [
      { localDate: '2026-05-20', distanceMeters: 12000, movingTimeS: 3600, workoutType: 0 },
    ];
    expect(personalCurvePredict(runs, ASOF, MARATHON_METERS)).toBeNull();
  });

  it('ignores races after asOf', () => {
    const runs = [race('2026-07-04', 10000, 2400)];
    expect(personalCurvePredict(runs, ASOF, MARATHON_METERS)).toBeNull();
  });
});

describe('personalCurvePredict — tier 1 (single race)', () => {
  it('projects one race with the volume-adjusted prior exponent', () => {
    const runs = [race('2026-05-25', 10000, 2400)];
    const p = personalCurvePredict(runs, ASOF, MARATHON_METERS)!;
    expect(p.tier).toBe(1);
    expect(p.nRaces).toBe(1);
    expect(p.lastRaceDate).toBe('2026-05-25');
    expect(p.exponentSource).toBe('prior');
    expect(p.halfRelWidth).toBeCloseTo(TIER1_BAND, 10);
    expect(p.calibrationFactor).toBeNull();
    // One race in one week ⇒ tanda coverage < 3 ⇒ no fitness scaling: the
    // prediction is EXACTLY the race time scaled by the reported exponent.
    expect(p.exponent).toBeGreaterThanOrEqual(EXPONENT_PRIOR.min);
    expect(p.exponent).toBeLessThanOrEqual(EXPONENT_PRIOR.max);
    expect(p.seconds).toBeCloseTo(2400 * Math.pow(MARATHON_METERS / 10000, p.exponent), 6);
    expect(p.fitnessAdjPct).toBeNull();
  });

  it('lowers the prior exponent as training volume rises', () => {
    // 16 wk of 80 km/wk steady running (5×16 km @ 360 s/km) before asOf.
    const runs: PredictRun[] = [race('2026-05-25', 10000, 2400)];
    let day = '2026-02-09';
    for (let w = 0; w < 16; w++) {
      for (let i = 0; i < 5; i++) {
        runs.push({ localDate: shift(day, i), distanceMeters: 16000, movingTimeS: 16 * 360, workoutType: 0 });
      }
      day = shift(day, 7);
    }
    const p = personalCurvePredict(runs, ASOF, MARATHON_METERS)!;
    // Tanda volume is now usable (steady-state window may trim race-adjacent weeks,
    // so we only assert direction/bounds, not an exact value).
    expect(p.exponent).toBeLessThan(priorAtOneMile());
    expect(p.exponent).toBeGreaterThanOrEqual(EXPONENT_PRIOR.min);
    expect(p.exponent).toBeLessThanOrEqual(EXPONENT_PRIOR.max);
    // The prediction is self-consistent: race time scaled by the reported exponent.
    expect(p.seconds).toBeCloseTo(2400 * Math.pow(MARATHON_METERS / 10000, p.exponent), 6);
  });
});

describe('personalCurvePredict — tier 2 (curve fit)', () => {
  // Three tagged races in ONE week (tanda coverage < 3 ⇒ no fitness scaling),
  // times exactly on a power law with exponent 1.10 anchored at 5k = 1200 s.
  const E = 1.1;
  const t = (m: number) => 1200 * Math.pow(m / 5000, E);
  const lawRaces = [
    race('2026-05-25', 5000, t(5000)),
    race('2026-05-27', 10000, t(10000)),
    race('2026-05-29', MARATHON_METERS, t(MARATHON_METERS)),
  ];

  it('recovers the personal exponent and predicts on the law', () => {
    const p = personalCurvePredict(lawRaces, ASOF, 21097.5)!;
    expect(p.tier).toBe(2);
    expect(p.exponentSource).toBe('fitted');
    expect(p.exponent).toBeCloseTo(E, 6);
    expect(p.seconds).toBeCloseTo(t(21097.5), 0);
    expect(p.nRaces).toBe(3);
  });

  it('clamps an absurd fitted slope to EXPONENT_MAX', () => {
    const runs = [
      race('2026-05-25', 5000, 1200),
      race('2026-05-27', 10000, 1200 * Math.pow(2, 1.4)), // slope 1.4
    ];
    const p = personalCurvePredict(runs, ASOF, 10000)!;
    expect(p.tier).toBe(2);
    expect(p.exponent).toBeCloseTo(1.25, 10);
  });

  it('degrades to tier 1 when raced distances lack spread', () => {
    const runs = [race('2026-05-25', 5000, 1200), race('2026-05-27', 5100, 1230)];
    const p = personalCurvePredict(runs, ASOF, MARATHON_METERS)!;
    expect(p.tier).toBe(1);
    expect(p.exponentSource).toBe('prior');
  });

  it('uses HR-weighted stream efforts to densify a single-race curve', () => {
    const runs = [race('2026-04-01', 5000, 1200)];
    const streams = steadyStream(10000, 2400, 180);
    const p = personalCurvePredict(runs, ASOF, MARATHON_METERS, [
      { localDate: '2026-05-01', workoutType: 0, streams, maxHr: 190 },
    ])!;
    expect(p.tier).toBe(2);
    expect(p.nRaces).toBe(1);
    expect(p.nStreamEfforts).toBeGreaterThan(0);
    expect(p.exponentSource).toBe('blended');
  });

  it('weights recent races over stale ones', () => {
    // An OLD slow 5k/10k pair (3 years back) + a RECENT fast pair: the curve
    // level should sit near the recent pair, predicting a far faster half
    // than the old pair alone would.
    const runs = [
      race('2023-05-20', 5000, 1500),
      race('2023-05-22', 10000, 1500 * Math.pow(2, 1.1)),
      race('2026-05-25', 5000, 1080),
      race('2026-05-27', 10000, 1080 * Math.pow(2, 1.1)),
    ];
    const p = personalCurvePredict(runs, ASOF, 21097.5)!;
    const recentLaw = 1080 * Math.pow(21097.5 / 5000, 1.1);
    const oldLaw = 1500 * Math.pow(21097.5 / 5000, 1.1);
    expect(Math.abs(p.seconds - recentLaw)).toBeLessThan(Math.abs(p.seconds - oldLaw));
  });
});

describe('personalCurvePredict — fitness scaling', () => {
  /** A steady block: 5 runs/wk of `km` km @ `pace` s/km for `weeks` ending at `end`. */
  function block(end: string, weeks: number, kmPerWeek: number, pace: number): PredictRun[] {
    const out: PredictRun[] = [];
    let day = shift(end, -(weeks * 7 - 1));
    for (let w = 0; w < weeks; w++) {
      for (let i = 0; i < 5; i++) {
        out.push({
          localDate: shift(day, i),
          distanceMeters: (kmPerWeek / 5) * 1000,
          movingTimeS: (kmPerWeek / 5) * pace,
          workoutType: 0,
        });
      }
      day = shift(day, 7);
    }
    return out;
  }

  it('projects faster when training has improved since the races', () => {
    // Two tagged races 120 days ago during a modest 40 km/wk block.
    const raceDay = shift(ASOF, -120);
    const races = [
      race(shift(raceDay, -2), 5000, 1200),
      race(raceDay, 10000, 1200 * Math.pow(2, 1.08)),
    ];
    const oldBlock = block(shift(raceDay, 1), 10, 40, 330);
    const sameNow = block(ASOF, 10, 40, 330);
    const biggerNow = block(ASOF, 10, 90, 320);

    const steady = personalCurvePredict([...races, ...oldBlock, ...sameNow], ASOF, MARATHON_METERS)!;
    const improved = personalCurvePredict([...races, ...oldBlock, ...biggerNow], ASOF, MARATHON_METERS)!;
    expect(improved.seconds).toBeLessThan(steady.seconds);
    expect(improved.fitnessAdjPct).not.toBeNull();
    expect(improved.fitnessAdjPct!).toBeLessThan(0); // fitter now ⇒ negative adj
  });
});

describe('personalCurvePredict — extrapolation shrinkage', () => {
  it('blends the exponent toward the prior when target exceeds raced range', () => {
    // Only 5k + 10k raced (fitted exponent 1.05); marathon is extrapolation.
    const runs = [
      race('2026-05-25', 5000, 1200),
      race('2026-05-27', 10000, 1200 * Math.pow(2, 1.05)),
    ];
    const p = personalCurvePredict(runs, ASOF, MARATHON_METERS)!;
    expect(p.tier).toBe(2);
    expect(p.exponentSource).toBe('blended');
    // The blend moves the exponent strictly ABOVE the fitted 1.05 toward the
    // (higher) volume prior, without exceeding the prior clamp.
    expect(p.exponent).toBeGreaterThan(1.05);
    expect(p.exponent).toBeLessThanOrEqual(EXPONENT_PRIOR.max);
    // spreadFrac covers ~32% of the log-distance journey, so the blend is
    // substantial — well above a token nudge.
    expect(p.exponent).toBeGreaterThan(1.1);
  });

  it('keeps the fitted exponent for targets inside the raced range', () => {
    const runs = [
      race('2026-05-25', 5000, 1200),
      race('2026-05-27', MARATHON_METERS, 1200 * Math.pow(MARATHON_METERS / 5000, 1.05)),
    ];
    const p = personalCurvePredict(runs, ASOF, 21097.5)!;
    expect(p.exponentSource).toBe('fitted');
    expect(p.exponent).toBeCloseTo(1.05, 6);
  });
});

describe('personalCurvePredict — self-calibration and band', () => {
  // Races on a drifting law: each race is 5% slower than the curve through
  // its predecessors implies, so walk-forward ratios are consistently > 1.
  function driftingRaces(n: number): PredictRun[] {
    const out: PredictRun[] = [];
    for (let i = 0; i < n; i++) {
      const meters = i % 2 === 0 ? 5000 : 10000;
      const base = 1200 * Math.pow(meters / 5000, 1.06);
      out.push(race(shift('2025-06-01', i * 30), meters, base * Math.pow(1.05, i)));
    }
    return out;
  }

  it('uses the default band until enough walk-forward residuals exist', () => {
    // 5 races ⇒ residuals only for races with ≥2 priors ⇒ 3 < MIN_RESIDUALS_FOR_BAND.
    const p = personalCurvePredict(driftingRaces(5), ASOF, 10000)!;
    expect(p.tier).toBe(2);
    expect(p.halfRelWidth).toBeCloseTo(BAND_DEFAULT, 10);
  });

  it('calibrates up when the curve consistently under-predicts', () => {
    const p = personalCurvePredict(driftingRaces(5), ASOF, 10000)!;
    expect(p.calibrationFactor).not.toBeNull();
    expect(p.calibrationFactor!).toBeGreaterThan(1.0);
    // The calibrated prediction is slower than the raw curve would say.
  });

  it('switches to the residual-quantile band with ≥MIN_RESIDUALS_FOR_BAND', () => {
    // 7 races ⇒ 5 residuals ⇒ quantile band (≈5% drift), floored at BAND_FLOOR.
    const p = personalCurvePredict(driftingRaces(7), ASOF, 10000)!;
    expect(p.halfRelWidth).toBeGreaterThanOrEqual(BAND_FLOOR);
    expect(p.halfRelWidth).not.toBeCloseTo(BAND_DEFAULT, 10);
  });

  it('reports calibrationFactor null on exact-law histories ≈1 stays harmless', () => {
    // Races exactly on one law ⇒ ratios 1 ⇒ factor ≈ 1 (still reported).
    const E = 1.06;
    const law = (m: number) => 1200 * Math.pow(m / 5000, E);
    const runs = [
      race('2025-06-01', 5000, law(5000)),
      race('2025-08-01', 10000, law(10000)),
      race('2025-10-01', 5000, law(5000)),
      race('2025-12-01', 10000, law(10000)),
    ];
    const p = personalCurvePredict(runs, ASOF, 10000)!;
    expect(p.calibrationFactor).not.toBeNull();
    expect(p.calibrationFactor!).toBeCloseTo(1.0, 2);
    expect(p.seconds).toBeCloseTo(law(10000), 0);
  });
});

/** Returns the prior exponent when volume is 1 mi/wk (ln(1)=0 ⇒ maximum/clamped value). */
function priorAtOneMile(): number {
  return Math.min(
    EXPONENT_PRIOR.max,
    Math.max(EXPONENT_PRIOR.min, EXPONENT_PRIOR.a + EXPONENT_PRIOR.b * Math.log(1)),
  );
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD'. */
function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function steadyStream(distanceMeters: number, seconds: number, bpm: number): RunStreams {
  const n = seconds;
  const speed = distanceMeters / seconds;
  const t: number[] = [0];
  const d: number[] = [0];
  const v: number[] = [0];
  const hr: (number | null)[] = [bpm];
  for (let i = 1; i <= n; i++) {
    t.push(i);
    d.push(speed * i);
    v.push(speed);
    hr.push(bpm);
  }
  return { t, d, v, hr, alt: null };
}
