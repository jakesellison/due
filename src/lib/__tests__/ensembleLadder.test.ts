/**
 * Node tests for the v3 tier ladder INSIDE the ensemble: the personal race
 * curve drives `predictRace` when the runner has detected races; the
 * population ensemble remains the tier-0 fallback and a cross-check
 * component. Contract (RacePrediction shape) is unchanged.
 */
import {
  predictRace,
  type PredictActivity,
} from '../predict/ensemble';
import {
  MARATHON_METERS,
} from '../predict/tanda';
import {
  TIER1_BAND,
} from '../predict/personalCurve';

const ASOF = '2026-06-04';

function steadyBlock(asOf: string, weeklyKm: number, paceSecPerKm: number): PredictActivity[] {
  const out: PredictActivity[] = [];
  let day = shift(asOf, -(16 * 7 - 1));
  for (let w = 0; w < 16; w++) {
    for (let i = 0; i < 5; i++) {
      out.push({
        localDate: shift(day, i),
        distanceMeters: (weeklyKm / 5) * 1000,
        movingTimeS: (weeklyKm / 5) * paceSecPerKm,
        workoutType: 0,
      });
    }
    day = shift(day, 7);
  }
  return out;
}

function race(localDate: string, meters: number, seconds: number): PredictActivity {
  return { localDate, distanceMeters: meters, movingTimeS: seconds, workoutType: 1 };
}

/** A finite (non-16wk) volume block ending at `end` — for building two
 * back-to-back, non-overlapping training phases (e.g. an old baseline then a
 * step up in volume) around a fixed race date. */
function volBlock(end: string, weeks: number, kmPerWeek: number, paceSecPerKm: number): PredictActivity[] {
  const out: PredictActivity[] = [];
  let day = shift(end, -(weeks * 7 - 1));
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 5; i++) {
      out.push({
        localDate: shift(day, i),
        distanceMeters: (kmPerWeek / 5) * 1000,
        movingTimeS: (kmPerWeek / 5) * paceSecPerKm,
        workoutType: 0,
      });
    }
    day = shift(day, 7);
  }
  return out;
}

describe('predictRace — v3 tier ladder', () => {
  it('tier 0: no detected races keeps the population ensemble untouched', () => {
    const p = predictRace(steadyBlock(ASOF, 95, 305), ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toMatch(/^(ridge_v2|ridge_v1|parametric)/);
    expect(p.components.personalCurve).toBeUndefined();
  });

  it('tier 1: a single recent race drives race_anchor_v3 at medium confidence', () => {
    const acts = [...steadyBlock(ASOF, 95, 305), race(shift(ASOF, -45), 42519, 10305)];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('race_anchor_v3');
    expect(p.confidence).toBe('medium');
    expect(p.basis).toMatch(/1 race \+ volume exponent \d\.\d\d {2}band ±10%/);
    expect(p.components.personalCurve).toBeCloseTo(p.seconds, 6);
    // Band is the tier-1 fixed ±10%.
    expect((p.highSeconds - p.lowSeconds) / 2 / p.seconds).toBeCloseTo(TIER1_BAND, 6);
    // The ensemble cross-check is still reported.
    expect(p.components.ridgeV2 ?? p.components.ridge ?? p.components.parametric).toBeDefined();
  });

  it('tier 1: a stale single race (>365d) reports low confidence', () => {
    const acts = [...steadyBlock(ASOF, 95, 305), race(shift(ASOF, -400), 42519, 10305)];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('race_anchor_v3');
    expect(p.confidence).toBe('low');
  });

  // A 3-race sample is thin: it must NOT read "high" confidence — the
  // confidence label has to agree with a "3 races" caption, not out-run it.
  // (This is the exact case the runner panel flagged: "Confidence · high"
  // beside "3 races · fitness -6%".)
  it('tier 2: exactly 3 races (even fresh, even no fitness drift) caps at medium', () => {
    const acts = [
      ...steadyBlock(ASOF, 95, 305),
      race(shift(ASOF, -200), 5000, 1080),
      race(shift(ASOF, -120), 10000, 2250),
      race(shift(ASOF, -45), 21097.5, 4800),
    ];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('personal_curve_v3');
    expect(p.basis).toMatch(/your 3 races {2}exponent \d\.\d\d/);
    expect(p.confidence).toBe('medium');
    expect(p.components.personalCurve).toBeCloseTo(p.seconds, 6);
  });

  it('tier 2: ≥4 races, fresh, stable fitness drives high confidence', () => {
    const acts = [
      ...steadyBlock(ASOF, 95, 305),
      race(shift(ASOF, -250), 5000, 1080),
      race(shift(ASOF, -200), 10000, 2250),
      race(shift(ASOF, -120), 15000, 3450),
      race(shift(ASOF, -45), 21097.5, 4800),
    ];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('personal_curve_v3');
    expect(p.basis).toMatch(/your 4 races {2}exponent \d\.\d\d/);
    expect(p.confidence).toBe('high');
  });

  it('tier 2: ≥4 fresh races but a stale most-recent race caps at medium', () => {
    const acts = [
      ...steadyBlock(ASOF, 95, 305),
      race(shift(ASOF, -600), 5000, 1080),
      race(shift(ASOF, -500), 10000, 2250),
      race(shift(ASOF, -450), 15000, 3450),
      race(shift(ASOF, -400), 21097.5, 4800),
    ];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('personal_curve_v3');
    expect(p.confidence).toBe('medium');
  });

  it('tier 2: ≥4 races + fresh but a material fitness drift caps at medium', () => {
    // A step up in training volume AFTER the newest race (30 km/wk while
    // racing → 130 km/wk by ASOF) pushes the newest race's fitness adjustment
    // past the drift cap, even though race count and recency both clear their
    // own bars on their own.
    const raceDay = shift(ASOF, -45);
    const acts = [
      ...volBlock(shift(raceDay, 1), 8, 30, 330),
      ...volBlock(ASOF, 8, 130, 300),
      race(shift(raceDay, -205), 5000, 1080),
      race(shift(raceDay, -155), 10000, 2250),
      race(shift(raceDay, -75), 15000, 3450),
      race(raceDay, 21097.5, 4800),
    ];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('personal_curve_v3');
    expect(p.basis).toMatch(/your 4 races/);
    expect(p.basis).toMatch(/fitness -\d+%/);
    expect(p.confidence).toBe('medium');
  });

  it('tier 2 with only 2 races reports medium confidence', () => {
    const acts = [
      ...steadyBlock(ASOF, 95, 305),
      race(shift(ASOF, -120), 10000, 2250),
      race(shift(ASOF, -45), 21097.5, 4800),
    ];
    const p = predictRace(acts, ASOF, MARATHON_METERS)!;
    expect(p.modelVersion).toBe('personal_curve_v3');
    expect(p.confidence).toBe('medium');
  });
});

function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
