/**
 * lapsRegime.test.ts — the pure lap↔regime reconciliation.
 *
 * Exercises the four cases from the locked design: over-granular laps collapse
 * into regime blocks, laps outside every block are kept, no-blocks passes laps
 * through, and clean 1-lap-per-block boundaries are unchanged.
 */
import {
  reconcileLapsWithRegime,
} from '../lapsRegime';
import type { LapRep } from '../lapIntervals';
import type { HardBlock } from '../qualityDetect';

const MI = 1609.344;

const lap = (startIdx: number, endIdx: number, distanceMeters: number, paceSecPerMi: number, avgHr: number | null = null): LapRep =>
  ({ startIdx, endIdx, distanceMeters, paceSecPerMi, avgHr });

const block = (startIdx: number, endIdx: number, distanceMeters: number, paceSecPerMi: number): HardBlock =>
  ({ startIdx, endIdx, distanceMeters, paceSecPerMi, durationS: (distanceMeters / MI) * paceSecPerMi });

describe('reconcileLapsWithRegime', () => {
  test('Jun-23 shape: 8 mile-laps inside 4 two-mile regime blocks → 4 reps', () => {
    // Two mile-laps per 2mi rep, recovery gaps between reps (index space is coarse).
    const laps: LapRep[] = [
      lap(0, 10, MI, 372, 170), lap(10, 20, MI, 370, 172), // rep 1 (2mi)
      lap(25, 35, MI, 371, 171), lap(35, 45, MI, 373, 173), // rep 2
      lap(50, 60, MI, 370, 170), lap(60, 70, MI, 372, 172), // rep 3
      lap(75, 85, MI, 371, 171), lap(85, 95, MI, 369, 169), // rep 4
    ];
    const blocks: HardBlock[] = [
      block(0, 20, 1.96 * MI, 371),
      block(25, 45, 1.96 * MI, 372),
      block(50, 70, 1.96 * MI, 371),
      block(75, 95, 1.96 * MI, 370),
    ];
    const reps = reconcileLapsWithRegime(laps, blocks);
    expect(reps).toHaveLength(4);
    // The regime groups the reps, but the declared lap metrics win: two exact
    // mile laps render as an exact two-mile rep instead of a trimmed 1.96mi
    // pace region.
    for (const r of reps) expect(r.distanceMeters).toBeCloseTo(2 * MI, 0);
    // Equal-distance/equal-duration-ish laps remain a duration-weighted mean.
    expect(reps[0]!.avgHr).toBe(171); // (170+172)/2
    expect(reps.map((r) => r.startIdx)).toEqual([0, 25, 50, 75]);
  });

  test('a short lap outside every regime block is KEPT alongside the blocks', () => {
    const laps: LapRep[] = [
      lap(0, 20, 1.96 * MI, 371, 170), // absorbed by block
      lap(100, 105, 205, 340, 178),    // a marked 200m rep regime missed
    ];
    const blocks: HardBlock[] = [block(0, 20, 1.96 * MI, 371)];
    const reps = reconcileLapsWithRegime(laps, blocks);
    expect(reps).toHaveLength(2);
    // block-collapsed rep first, then the kept short lap
    expect(reps[0]!.distanceMeters).toBeCloseTo(1.96 * MI, 0);
    expect(reps[1]!.distanceMeters).toBe(205);
    expect(reps[1]!.avgHr).toBe(178);
  });

  test('no regime blocks → laps pass through unchanged (laps fully win)', () => {
    const laps: LapRep[] = [lap(0, 10, 400, 340, 175), lap(20, 30, 400, 345, 176)];
    const reps = reconcileLapsWithRegime(laps, []);
    expect(reps).toEqual(laps);
  });

  test('clean 1 lap per regime block → reps equal the blocks, count unchanged', () => {
    const laps: LapRep[] = [
      lap(0, 15, MI, 352, 178),
      lap(30, 45, MI, 351, 179),
      lap(60, 75, MI, 350, 180),
    ];
    const blocks: HardBlock[] = [
      block(0, 15, MI, 352),
      block(30, 45, MI, 351),
      block(60, 75, MI, 350),
    ];
    const reps = reconcileLapsWithRegime(laps, blocks);
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => Math.round(r.paceSecPerMi))).toEqual([352, 351, 350]);
    expect(reps.map((r) => r.avgHr)).toEqual([178, 179, 180]);
  });

  test('a regime block with no overlapping lap still yields a rep (avgHr null)', () => {
    const laps: LapRep[] = [lap(0, 15, MI, 352, 178)];
    const blocks: HardBlock[] = [block(0, 15, MI, 352), block(40, 55, MI, 350)];
    const reps = reconcileLapsWithRegime(laps, blocks);
    expect(reps).toHaveLength(2);
    expect(reps[1]!.avgHr).toBeNull();
  });
});
