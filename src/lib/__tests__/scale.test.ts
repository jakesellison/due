import {
  niceBounds,
  niceScale,
  niceStep,
  niceTicks,
} from '../kpi/insights/bounds';

describe('niceStep', () => {
  it('rounds a span to a 1/2/5 × 10^k step targeting ~4 intervals', () => {
    expect(niceStep(40)).toBe(10); // 40/4 = 10
    expect(niceStep(20)).toBe(5); // 20/4 = 5
    expect(niceStep(8)).toBe(2); // 8/4 = 2
    expect(niceStep(4)).toBe(1); // 4/4 = 1
    expect(niceStep(400)).toBe(100);
  });

  it('uses geometric thresholds (no coarse 20→50 jump)', () => {
    // 90/4 = 22.5 → nearer 20 than 50 (old table jumped to 50).
    expect(niceStep(90)).toBe(20);
  });

  it('is safe on degenerate spans', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });
});

describe('niceTicks', () => {
  it('returns evenly-spaced round ticks inside the domain', () => {
    expect(niceTicks(0, 40)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('interior mode drops the endpoints', () => {
    expect(niceTicks(0, 40, { interior: true })).toEqual([10, 20, 30]);
  });

  it('niceScale gives a sane, evenly-spaced tick count across every plan size 30→120 mi', () => {
    for (let peak = 30; peak <= 120; peak += 1) {
      const { max, ticks } = niceScale(0, peak, { anchorZero: true });
      const interior = ticks.filter((v) => v > 0); // 0 is the drawn baseline
      expect(interior.length).toBeGreaterThanOrEqual(3);
      expect(interior.length).toBeLessThanOrEqual(7);
      expect(max).toBeGreaterThanOrEqual(peak); // peak never clipped
      // bounds + ticks share one step → perfectly even spacing
      const gaps = ticks.slice(1).map((v, i) => v - ticks[i]!);
      expect(new Set(gaps).size).toBe(1);
    }
  });

  it('gives round, evenly-spaced finish-time ticks for a narrow range', () => {
    // ~2:35–3:10 finish window in minutes → round 5/10-min marks, ≥2 interior.
    const [lo, hi] = niceBounds(155, 190, { headroom: 0.12 });
    const ticks = niceTicks(lo, hi, { interior: true });
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    // all on whole-minute (here 5-min) marks
    expect(ticks.every((t) => t % 5 === 0)).toBe(true);
    const gaps = ticks.slice(1).map((v, i) => v - ticks[i]!);
    expect(new Set(gaps).size).toBe(1); // even spacing
  });

  it('returns [] for an empty/invalid domain', () => {
    expect(niceTicks(5, 5)).toEqual([]);
    expect(niceTicks(10, 0)).toEqual([]);
    expect(niceTicks(NaN, 10)).toEqual([]);
  });
});
