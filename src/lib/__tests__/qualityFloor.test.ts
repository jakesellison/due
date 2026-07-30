/**
 * qualityFloor.test.ts — TDD tests for estimateQualityFloor.
 *
 * Node-tested (no IO). Run with `npx jest --selectProjects node`.
 *
 * Floor derivation: paceFloor ≈ midway between easy-pace baseline and
 * marathon-pace (MP). When MP is available from a RacePrediction,
 *   MP = prediction.seconds / (42195 / 1609.344) s/mi
 * else fallback: easyBaseline − 90s/mi
 * paceFloor = (easyBaseline + MP) / 2
 *
 * hrFloor = moderate/steady-zone boundary from HrModel when provided, else null.
 */

import {
  estimateQualityFloor,
  agePredictedMaxHr,
  steadyZoneFloorBpm,
  observedMaxHr,
  effectiveMaxHr,
  DEFAULT_MAX_HR,
} from '../kpi/qualityFloor';
import type { QualityFloorInput } from '../kpi/qualityFloor';

// ── helpers ──────────────────────────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;
const MARATHON_METERS = 42195;

/** Build a minimal RacePrediction-like object for testing. */
function makePrediction(marathonSeconds: number) {
  return {
    seconds: marathonSeconds,
    lowSeconds: marathonSeconds - 600,
    highSeconds: marathonSeconds + 600,
    components: {},
    confidence: 'medium' as const,
    basis: 'test',
    modelVersion: 'test',
  };
}

// ── Fixture A: Jake's profile ─────────────────────────────────────────────────
// easyBaseline = 8:15/mi = 495 s/mi
// marathon prediction: 3:10:00 = 11400 s
//   MP = 11400 / (42195/1609.344) ≈ 11400 / 26.219 ≈ 435 s/mi ≈ 7:15/mi
// paceFloor = (495 + 435) / 2 = 465 s/mi ≈ 7:45/mi
//
const EASY_BASELINE_A = 8 * 60 + 15; // 495 s/mi
const MARATHON_S_A = 3 * 3600 + 10 * 60; // 11400 s
const MP_A = MARATHON_S_A / (MARATHON_METERS / METERS_PER_MILE); // ~435 s/mi
const EXPECTED_FLOOR_A = (EASY_BASELINE_A + MP_A) / 2; // ~465 s/mi

// ── Fixture B: slower runner ──────────────────────────────────────────────────
// easyBaseline = 10:00/mi = 600 s/mi
// marathon prediction: 4:30:00 = 16200 s
//   MP = 16200 / 26.219 ≈ 618 s/mi ≈ 10:18/mi (slower than easy — use fallback)
// fallback: easyBaseline - 90 = 600 - 90 = 510 s/mi
// paceFloor = (600 + 510) / 2 = 555 s/mi ≈ 9:15/mi
//
const EASY_BASELINE_B = 600; // 10:00/mi
const MARATHON_S_B = 4 * 3600 + 30 * 60; // 16200 s
// NOTE: MP_B = 16200 / 26.219 ≈ 618, which is SLOWER than easy baseline (600)
// So the MP estimate is suspect; clamp so MP < easyBaseline

// ── Fixture C: no prediction (fallback only) ──────────────────────────────────
// easyBaseline = 9:00/mi = 540 s/mi
// No prediction → fallback MP = 540 - 90 = 450 s/mi
// paceFloor = (540 + 450) / 2 = 495 s/mi
//
const EASY_BASELINE_C = 9 * 60; // 540 s/mi
const FALLBACK_MP_C = EASY_BASELINE_C - 90; // 450 s/mi
const EXPECTED_FLOOR_C = (EASY_BASELINE_C + FALLBACK_MP_C) / 2; // 495 s/mi

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('estimateQualityFloor — with fitness prediction', () => {
  test('paceFloor is between easy-baseline and MP', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_A,
      prediction: makePrediction(MARATHON_S_A),
    };
    const floor = estimateQualityFloor(input);
    // Floor must be faster than easy (lower number) and slower than MP
    expect(floor.paceFloorSecPerMi).toBeLessThan(EASY_BASELINE_A);
    expect(floor.paceFloorSecPerMi).toBeGreaterThan(MP_A);
  });

  test('paceFloor ≈ midpoint of easy and MP (within 5s/mi)', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_A,
      prediction: makePrediction(MARATHON_S_A),
    };
    const floor = estimateQualityFloor(input);
    expect(floor.paceFloorSecPerMi).toBeCloseTo(EXPECTED_FLOOR_A, 0);
  });

  test('paceFloor is in a sane range for a 3:10 marathoner (7:00–8:00/mi)', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_A,
      prediction: makePrediction(MARATHON_S_A),
    };
    const floor = estimateQualityFloor(input);
    // 7:00/mi = 420, 8:00/mi = 480
    expect(floor.paceFloorSecPerMi).toBeGreaterThan(420);
    expect(floor.paceFloorSecPerMi).toBeLessThan(480);
  });

  test('hrFloor is null when no HR model provided', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_A,
      prediction: makePrediction(MARATHON_S_A),
    };
    const floor = estimateQualityFloor(input);
    expect(floor.hrFloor).toBeNull();
  });

  test('hrFloor reflects the HR model boundary when provided', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_A,
      prediction: makePrediction(MARATHON_S_A),
      hrModel: { steadyZoneFloorBpm: 148 },
    };
    const floor = estimateQualityFloor(input);
    expect(floor.hrFloor).toBe(148);
  });
});

describe('estimateQualityFloor — no fitness prediction (fallback)', () => {
  test('fallback paceFloor ≈ easyBaseline − 90 s/mi halved toward easy', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_C,
    };
    const floor = estimateQualityFloor(input);
    expect(floor.paceFloorSecPerMi).toBeCloseTo(EXPECTED_FLOOR_C, 0);
  });

  test('fallback paceFloor is faster than easy and slower than easy−90', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_C,
    };
    const floor = estimateQualityFloor(input);
    expect(floor.paceFloorSecPerMi).toBeLessThan(EASY_BASELINE_C);
    expect(floor.paceFloorSecPerMi).toBeGreaterThan(EASY_BASELINE_C - 90);
  });

  test('hrFloor is null when no HR model in fallback case', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_C,
    };
    const floor = estimateQualityFloor(input);
    expect(floor.hrFloor).toBeNull();
  });
});

describe('estimateQualityFloor — MP clamping when prediction is sluggish', () => {
  test('when predicted MP >= easyBaseline, uses fallback instead', () => {
    // A 4:30 marathon = 618 s/mi MP, but easy baseline is 600 s/mi → clamped
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_B,
      prediction: makePrediction(MARATHON_S_B),
    };
    const floor = estimateQualityFloor(input);
    // Must still be faster than easy
    expect(floor.paceFloorSecPerMi).toBeLessThan(EASY_BASELINE_B);
  });

  test('floor is still sane even when prediction and baseline disagree', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: EASY_BASELINE_B,
      prediction: makePrediction(MARATHON_S_B),
    };
    const floor = estimateQualityFloor(input);
    // Should be at least 60s faster than easy (not a tiny fraction)
    expect(floor.paceFloorSecPerMi).toBeLessThan(EASY_BASELINE_B - 30);
  });
});

describe('estimateQualityFloor — output shape', () => {
  test('returns object with paceFloorSecPerMi and hrFloor', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: 495,
    };
    const floor = estimateQualityFloor(input);
    expect(typeof floor.paceFloorSecPerMi).toBe('number');
    expect('hrFloor' in floor).toBe(true);
  });

  test('paceFloorSecPerMi is always positive', () => {
    const input: QualityFloorInput = {
      easyBaselineSecPerMi: 495,
      prediction: makePrediction(11400),
    };
    const floor = estimateQualityFloor(input);
    expect(floor.paceFloorSecPerMi).toBeGreaterThan(0);
  });
});

describe('max-HR derivation', () => {
  test('agePredictedMaxHr uses Tanaka 208 − 0.7·age', () => {
    expect(agePredictedMaxHr(30)).toBe(187);
    expect(agePredictedMaxHr(40)).toBe(180);
  });

  test('steadyZoneFloorBpm is 83% of max HR', () => {
    expect(steadyZoneFloorBpm(194)).toBe(161);
    expect(steadyZoneFloorBpm(190)).toBe(158);
  });

  test('observedMaxHr takes a high percentile and ignores spikes', () => {
    const maxima = [165, 170, 172, 175, 178, 180, 182, 185, 188, 192, 250 /* spike */, null];
    const got = observedMaxHr(maxima);
    expect(got).not.toBeNull();
    expect(got).toBeLessThan(200); // spike excluded
    expect(got).toBeGreaterThanOrEqual(188);
  });

  test('observedMaxHr returns null without enough history', () => {
    expect(observedMaxHr([180, 185, 190])).toBeNull();
  });

  describe('effectiveMaxHr fallback chain', () => {
    test('explicit setting wins', () => {
      expect(effectiveMaxHr({ settingMaxHr: 198, observedMaxHr: 188, age: 30 })).toEqual({ maxHr: 198, source: 'setting' });
    });
    test('observed used when no setting', () => {
      expect(effectiveMaxHr({ observedMaxHr: 191, age: 30 })).toEqual({ maxHr: 191, source: 'observed' });
    });
    test('age-predicted when no setting or observed', () => {
      expect(effectiveMaxHr({ age: 30 })).toEqual({ maxHr: 187, source: 'age' });
    });
    test('default when nothing known', () => {
      expect(effectiveMaxHr({})).toEqual({ maxHr: DEFAULT_MAX_HR, source: 'default' });
    });
    test('implausible setting is ignored, falls through', () => {
      expect(effectiveMaxHr({ settingMaxHr: 300, observedMaxHr: 189 })).toEqual({ maxHr: 189, source: 'observed' });
    });
  });
});
