import fs from 'fs';
import path from 'path';
import {
  buildGap,
  lapGap,
} from '../gap';

// Prototype fixture: real streams + laps for a set of pinned activities.
// Ported verbatim from docs/superpowers/specs/interpreter-prototype/{fixtures,streams}.json.
const streams = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/streams.json'), 'utf8')
);
const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/fixtures.json'), 'utf8')
);

// 07-12 marathon-pace tempo run.
const ACTIVITY_ID = 'c4629fff-4d92-4ebd-ab04-1c45e3b17a28';

describe('costFactor (Minetti cost curve)', () => {
  test('costFactor(0) === 1 (flat ground has no cost penalty)', () => {
    // Exercise the flat-grade case indirectly via lapGap: a gap built from a
    // perfectly flat altitude stream must return ratio === 1 (costFactor(0) === 1
    // baked through buildGap's cumulative grade-adjusted distance).
    const d = [0, 100, 200, 300, 400];
    const alt = [10, 10, 10, 10, 10];
    const gap = buildGap({ d, alt });
    const { ratio } = lapGap(gap, 0, 400, 500);
    expect(ratio).toBeCloseTo(1, 6);
  });
});

describe('buildGap', () => {
  test('returns null when alt length does not match d length', () => {
    const gap = buildGap({ d: [0, 100, 200], alt: [10, 11] });
    expect(gap).toBeNull();
  });

  test('returns null for streams shorter than 2 samples', () => {
    const gap = buildGap({ d: [0], alt: [10] });
    expect(gap).toBeNull();
  });

  test('builds a Gap with matching d and cumulative gaCum arrays', () => {
    const d = [0, 100, 200, 300];
    const alt = [10, 10, 10, 10];
    const gap = buildGap({ d, alt });
    expect(gap).not.toBeNull();
    expect(gap!.d).toEqual(d);
    expect(gap!.gaCum).toHaveLength(d.length);
  });
});

describe('lapGap on the 07-12 tempo block (real fixture data)', () => {
  test('the marathon-pace block (laps 8-17, cumulative laps 1-7 to 1-17) reads ~7:00/mi GAP', () => {
    const s = streams[ACTIVITY_ID];
    const laps = fixtures[ACTIVITY_ID].laps;

    const gap = buildGap(s);
    expect(gap).not.toBeNull();

    // Cumulative distance through lap 7 = start of the tempo block;
    // cumulative distance through lap 17 = end of the tempo block.
    const startD = laps.slice(0, 7).reduce((sum: number, l: any) => sum + l.distance, 0);
    const endD = laps.slice(0, 17).reduce((sum: number, l: any) => sum + l.distance, 0);
    const movingTime = laps
      .slice(7, 17)
      .reduce((sum: number, l: any) => sum + l.moving_time, 0);
    const miles = (endD - startD) / 1609.34;
    const movingPace = movingTime / miles;

    const { gapPace } = lapGap(gap, startD, endD, movingPace);

    // Prototype's validated read: ~7:00/mi (420 s/mi), within ±3 s/mi.
    expect(Math.abs(gapPace - 420)).toBeLessThanOrEqual(3);
  });
});
