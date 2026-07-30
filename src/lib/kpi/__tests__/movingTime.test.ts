import {
  normalizeMovingTime,
} from '../movingTime';

describe('normalizeMovingTime', () => {
  it('clean run, no stops: moving equals elapsed, paces equal', () => {
    const r = normalizeMovingTime({ t: [0, 20, 40, 60], d: [0, 80, 160, 240] });
    expect(r.elapsedTimeS).toBe(60);
    expect(r.movingTimeS).toBe(60);
    expect(r.stopIntervals).toEqual([]);
    expect(r.movingPaceSecPerMi).toBeCloseTo(r.elapsedPaceSecPerMi!, 5);
  });

  it('explicit pause gap (big Δt, flat Δd) is excluded', () => {
    const r = normalizeMovingTime({ t: [0, 20, 340, 360], d: [0, 80, 82, 162] });
    expect(r.elapsedTimeS).toBe(360);
    expect(r.stopIntervals).toHaveLength(1);
    expect(r.stopIntervals[0]).toEqual({ startS: 20, endS: 340, durationS: 320 });
    expect(r.movingTimeS).toBe(40);
  });

  it('forgot-to-pause stationary span (v≈0, flat distance) is excluded', () => {
    const r = normalizeMovingTime({
      t: [0, 20, 40, 60, 80, 100],
      d: [0, 80, 160, 160, 160, 240],
    });
    expect(r.stopIntervals).toEqual([{ startS: 40, endS: 80, durationS: 40 }]);
    expect(r.movingTimeS).toBe(60);
    expect(r.elapsedTimeS).toBe(100);
  });

  it('multiple stops are each excluded', () => {
    const r = normalizeMovingTime({
      t: [0, 20, 40, 60, 80, 100, 120],
      d: [0, 80, 80, 160, 240, 240, 320],
    });
    expect(r.stopIntervals).toHaveLength(2);
    expect(r.movingTimeS).toBe(80);
  });

  it('sub-minStopS blip is NOT a stop', () => {
    const r = normalizeMovingTime({ t: [0, 8, 28], d: [0, 0, 80] });
    expect(r.stopIntervals).toEqual([]);
    expect(r.movingTimeS).toBe(28);
  });

  it('empty / single-sample streams return zeros', () => {
    expect(normalizeMovingTime({ t: [], d: [] }).movingTimeS).toBe(0);
    expect(normalizeMovingTime({ t: [5], d: [10] }).elapsedTimeS).toBe(0);
    expect(normalizeMovingTime({ t: [], d: [] }).movingPaceSecPerMi).toBeNull();
  });

  it('all-stopped activity: moving time 0, moving pace null', () => {
    const r = normalizeMovingTime({ t: [0, 20, 40], d: [0, 0, 0] });
    expect(r.movingTimeS).toBe(0);
    expect(r.movingPaceSecPerMi).toBeNull();
  });
});
