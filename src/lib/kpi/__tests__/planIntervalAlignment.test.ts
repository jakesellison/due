import {
  alignIntervalsToPlan,
} from '../planIntervalAlignment';
import type { HardBlock } from '../qualityDetect';
import {
  METERS_PER_MILE,
} from '../../units';

const block = (mi: number, paceSecPerMi = 363, startIdx = 0): HardBlock => ({
  distanceMeters: mi * METERS_PER_MILE,
  paceSecPerMi,
  durationS: mi * paceSecPerMi,
  startIdx,
  endIdx: startIdx + 10,
});

describe('alignIntervalsToPlan', () => {
  test('July 21 shape: five long reps + a fast cooldown tail resolves to 5x2mi', () => {
    const observed = [1.928, 1.927, 1.986, 1.925, 1.926, 0.332]
      .map((mi, i) => block(mi, i === 5 ? 435 : 363, i * 20));
    const aligned = alignIntervalsToPlan(observed, Array(5).fill(2 * METERS_PER_MILE));

    expect(aligned).not.toBeNull();
    expect(aligned!.reps).toHaveLength(5);
    expect(aligned!.reps.every((rep) => rep.distanceMeters > 1.9 * METERS_PER_MILE)).toBe(true);
    expect(aligned!.extras).toHaveLength(0);
    expect(aligned!.ignored).toEqual([observed[5]]);
    expect(aligned!.confidence).toBeGreaterThan(0.95);
  });

  test('a genuine additional full rep is retained as extra work', () => {
    const observed = Array.from({ length: 6 }, (_, i) => block(2, 360 + i, i * 20));
    const aligned = alignIntervalsToPlan(observed, Array(5).fill(2 * METERS_PER_MILE));

    expect(aligned?.reps).toHaveLength(5);
    expect(aligned?.extras).toHaveLength(1);
    expect(aligned?.ignored).toHaveLength(0);
    expect(aligned?.confidence).toBeCloseTo(1, 5);
  });

  test('does not fabricate completion when fewer reps were observed', () => {
    const observed = Array.from({ length: 4 }, (_, i) => block(2, 360, i * 20));
    expect(alignIntervalsToPlan(observed, Array(5).fill(2 * METERS_PER_MILE))).toBeNull();
  });
});
