// src/lib/kpi/__tests__/qualityFloor.test.ts
//
// Tests for deriveQualityFloor + estimateQualityFloor's qualityFloorSecPerMi.
// The workout-interpreter's genuinely-fast floor, derived per-athlete as a
// fixed RATIO of easy pace (Daniels/80/20/Stryd: the easy→threshold speed ratio
// is near-constant across fitness, unlike the s/mi offset). Robust for athletes
// who rarely run hard — no efforts/race needed.

import {
  deriveQualityFloor,
  estimateQualityFloor,
  QUALITY_PACE_RATIO,
} from '../qualityFloor';

describe('deriveQualityFloor', () => {
  test('is easy pace × the quality ratio (0.87) — reference athlete easy 500 → ~435 (~7:15)', () => {
    expect(deriveQualityFloor(500)).toBeCloseTo(500 * QUALITY_PACE_RATIO, 5);
    expect(deriveQualityFloor(500)).toBeGreaterThanOrEqual(428);
    expect(deriveQualityFloor(500)).toBeLessThanOrEqual(438);
  });

  test('is faster (lower s/mi) than easy — a real deviation, not easy running', () => {
    expect(deriveQualityFloor(500)).toBeLessThan(500);
  });

  test('self-scales with fitness (ratio constant): a slower easy → proportionally slower floor', () => {
    // A less-fit runner (easy 760 = 12:40) still gets a floor at the same RATIO,
    // so their genuine quality is caught — no absolute offset that mis-scales.
    expect(deriveQualityFloor(760)).toBeCloseTo(760 * QUALITY_PACE_RATIO, 5);
    expect(deriveQualityFloor(760) / 760).toBeCloseTo(deriveQualityFloor(500) / 500, 5);
  });
});

describe('estimateQualityFloor — qualityFloorSecPerMi', () => {
  test('is easy × ratio regardless of prediction (no race needed)', () => {
    const floor = estimateQualityFloor({ easyBaselineSecPerMi: 500 });
    expect(floor.qualityFloorSecPerMi).toBeCloseTo(deriveQualityFloor(500), 5);
    expect(floor.qualityFloorSecPerMi).toBeGreaterThanOrEqual(428);
    expect(floor.qualityFloorSecPerMi).toBeLessThanOrEqual(438);
  });

  test('quality floor is faster than the moderate paceFloor', () => {
    const floor = estimateQualityFloor({ easyBaselineSecPerMi: 500 });
    expect(floor.qualityFloorSecPerMi).toBeLessThan(floor.paceFloorSecPerMi);
  });
});
