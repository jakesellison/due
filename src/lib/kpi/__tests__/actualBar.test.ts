import {
  actualBarSegments,
} from '../actualBar';
import type { HardBlock } from '../qualityDetect';

/** A HardBlock with just the fields actualBarSegments reads. */
function block(startIdx: number, endIdx: number): HardBlock {
  return { startIdx, endIdx, distanceMeters: 0, paceSecPerMi: 0, durationS: 0 };
}

const sum = (segs: { meters: number }[]) => segs.reduce((s, x) => s + x.meters, 0);

describe('actualBarSegments', () => {
  test('easy run (kind none) → one flat steady bar summing to total', () => {
    const segs = actualBarSegments([], [0, 1000, 5000], 5000, 'none');
    expect(segs).toEqual([{ kind: 'steady', meters: 5000 }]);
  });

  test('kind none ignores any blocks and stays flat', () => {
    const segs = actualBarSegments([block(1, 2)], [0, 500, 1000, 5000], 5000, 'none');
    expect(segs).toEqual([{ kind: 'steady', meters: 5000 }]);
  });

  test('3-block interval → wu + [work,rest]×3 (last work then cd), meters sum to total', () => {
    // Cumulative distance stream, 10 samples, total 10 000 m.
    //   idx:   0    1    2     3     4     5     6     7     8     9
    //   dist:  0  1000 2000  3000  4000  5000  6000  7000  8000 10000
    // Three work blocks at [1..2], [3..4], [5..6]: each 1000 m of work,
    // 1000 m warm-up before the first, 1000 m recovery between, 3000 m cool-down.
    const d = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000];
    const blocks = [block(1, 2), block(3, 4), block(5, 6)];
    const segs = actualBarSegments(blocks, d, 10000, 'intervals');

    expect(segs.map((s) => s.kind)).toEqual([
      'wu', 'work', 'rest', 'work', 'rest', 'work', 'cd',
    ]);
    // Work segments equal the block distances (1000 m each).
    expect(segs.filter((s) => s.kind === 'work').map((s) => s.meters)).toEqual([1000, 1000, 1000]);
    // Warm-up 1000, each rest 1000, cool-down from idx6→idx9 = 4000.
    expect(segs[0]).toEqual({ kind: 'wu', meters: 1000 });
    expect(segs[6]).toEqual({ kind: 'cd', meters: 4000 });
    // The whole bar accounts for the run.
    expect(sum(segs)).toBe(10000);
    // Work-segment count matches rep count.
    expect(segs.filter((s) => s.kind === 'work')).toHaveLength(3);
  });

  test('no warm-up when the first block starts at index 0', () => {
    const d = [0, 1000, 2000, 3000];
    const segs = actualBarSegments([block(0, 1), block(2, 3)], d, 3000, 'intervals');
    expect(segs.map((s) => s.kind)).toEqual(['work', 'rest', 'work']);
    expect(sum(segs)).toBe(3000);
  });

  test('tempo (one sustained block) → wu + work + cd', () => {
    const d = [0, 500, 1000, 4000, 5000];
    const segs = actualBarSegments([block(1, 3)], d, 5000, 'tempo');
    expect(segs.map((s) => s.kind)).toEqual(['wu', 'work', 'cd']);
    expect(segs[1]).toEqual({ kind: 'work', meters: 3500 }); // idx1→idx3
    expect(sum(segs)).toBe(5000);
  });

  test('sub-1% spans merge into a neighbour, preserving the total', () => {
    // A 20 m warm-up on a 10 000 m run is <1% → folds into the first work block.
    const d = [0, 20, 3020, 6020, 10000];
    const segs = actualBarSegments([block(1, 2), block(3, 4)], d, 10000, 'intervals');
    // No tiny warm-up survives; the sum is still the whole run.
    expect(segs.every((s) => s.meters >= 100)).toBe(true);
    expect(sum(segs)).toBe(10000);
    expect(segs[0]!.kind).toBe('work'); // the 20 m wu was folded forward into work
  });
});
