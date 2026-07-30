/**
 * classifyBlocks.test.ts — the shape classifier shared by the stream detector
 * and the lap-first verdict. Pins the v7 additions: the coverage test that keeps
 * a mile-auto-lapped continuous run out of "intervals", and progression.
 */
import {
  classifyBlocks,
  type HardBlock,
} from '../qualityDetect';

const METERS_PER_MILE = 1609.344;

/** A HardBlock from distance (m) + pace (s/mi); duration derived. */
const block = (distanceMeters: number, paceSecPerMi: number): HardBlock => ({
  distanceMeters,
  paceSecPerMi,
  durationS: (distanceMeters / METERS_PER_MILE) * paceSecPerMi,
  startIdx: -1,
  endIdx: -1,
});

describe('classifyBlocks — coverage separates intervals from continuous', () => {
  test('similar reps with recovery (low coverage) → intervals', () => {
    // 6×400m @ 5:20 inside a ~5 km run: work covers ~48% → real intervals.
    const reps = Array.from({ length: 6 }, () => block(400, 320));
    expect(classifyBlocks(reps, 0, 5000)).toBe('intervals');
  });

  test('uniform mile "reps" covering the whole run → tempo, NOT intervals', () => {
    // 12×~1mi at a steady 7:05, back-to-back over a 12-mile run: coverage ~1.0.
    // A continuous run mile-auto-lapped — the corpus "15×1mi" false positive.
    const reps = Array.from({ length: 12 }, () => block(1609, 425));
    const total = 12 * 1609;
    expect(classifyBlocks(reps, 0, total)).toBe('tempo');
  });

  test('pace stepping down across the run → progression', () => {
    // 5 miles at 7:40 → 6:40, monotonically faster: a progression run.
    const paces = [460, 445, 430, 415, 400];
    const reps = paces.map((p) => block(1609, p));
    expect(classifyBlocks(reps, 0, 5 * 1609)).toBe('progression');
  });

  test('one dominant sustained block among short pickups → tempo', () => {
    const reps = [block(200, 360), block(4800, 430), block(200, 360)];
    expect(classifyBlocks(reps, 0, 8000)).toBe('tempo');
  });

  test('a steady set that does NOT step down is not a progression', () => {
    // Flat paces covering the run → tempo (coverage), never progression.
    const reps = Array.from({ length: 4 }, () => block(1609, 430));
    expect(classifyBlocks(reps, 0, 4 * 1609)).toBe('tempo');
  });
});
