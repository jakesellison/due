/**
 * readingToDetect.test.ts — Reading → QualityDetect view adapter.
 */
import {
  readingToDetect,
} from '../readingToDetect';
import type { Reading } from '../interpretWorkout';
import type { RunStream } from '../qualityDetect';
import {
  METERS_PER_MILE,
} from '../../units';

// 400 m at a steady 3.33 m/s (≈ 8:03/mi), sampled every 30 s.
const stream: RunStream = {
  d: [0, 100, 200, 300, 400],
  v: [3.33, 3.33, 3.33, 3.33, 3.33],
  t: [0, 30, 60, 90, 120],
  hr: [150, 152, 154, 156, 158],
  altitude: [10, 10, 10, 10, 10],
};

const block = (startIdx: number, endIdx: number, mi: number) => ({
  startIdx,
  endIdx,
  mi,
  gapPaceSecPerMi: 480,
  hr: 154,
});

describe('readingToDetect', () => {
  test('maps kind + isQuality and preserves per-block distance from the Reading', () => {
    const reading: Reading = {
      kind: 'intervals',
      qualityMi: 0.248,
      blocks: [block(1, 2, 0.062), block(3, 4, 0.062)],
      summary: '2×0.1mi',
    };
    const det = readingToDetect(reading, stream);
    expect(det.kind).toBe('intervals');
    expect(det.isQuality).toBe(true);
    expect(det.blocks).toHaveLength(2);
    expect(det.summary).toBe('2×0.1mi');
    // distance comes straight from the Reading's mi (credited quality miles)
    expect(det.blocks[0]!.distanceMeters).toBeCloseTo(0.062 * METERS_PER_MILE, 1);
    expect(det.qualityDistanceMeters).toBeCloseTo(0.124 * METERS_PER_MILE, 1);
    // duration/pace derived on the stream → positive, finite
    expect(det.blocks[0]!.durationS).toBeGreaterThan(0);
    expect(det.blocks[0]!.paceSecPerMi).toBeGreaterThan(0);
    expect(Number.isFinite(det.blocks[0]!.paceSecPerMi)).toBe(true);
  });

  test('a none reading maps to a non-quality detect with no blocks', () => {
    const none: Reading = { kind: 'none', qualityMi: 0, blocks: [], summary: '' };
    const det = readingToDetect(none, stream);
    expect(det.kind).toBe('none');
    expect(det.isQuality).toBe(false);
    expect(det.blocks).toHaveLength(0);
    expect(det.qualityDistanceMeters).toBe(0);
  });

  test('keeps genuine extra reps separate from the matched core', () => {
    const reading: Reading = {
      kind: 'intervals',
      qualityMi: 0.062,
      blocks: [block(1, 2, 0.062)],
      extras: [block(3, 4, 0.062)],
      summary: '1×100m',
    };
    const det = readingToDetect(reading, stream);
    expect(det.blocks).toHaveLength(1);
    expect(det.extraBlocks).toHaveLength(1);
    expect(det.qualityDistanceMeters).toBeCloseTo(0.062 * METERS_PER_MILE, 1);
  });
});
