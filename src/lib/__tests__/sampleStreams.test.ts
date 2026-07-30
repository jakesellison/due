import {
  buildSampleBlock,
  makeStreams,
  makeRoute,
  type SampleActivity,
} from '../plan/sampleBlock';

const START = '2026-02-09'; // Monday
const TODAY = '2026-03-11'; // ~week 5

/** d/v consistency: integral of v over t should match final d within tol. */
function integralDistance(t: number[], v: number[]): number {
  let d = 0;
  for (let i = 1; i < t.length; i++) {
    d += ((v[i]! + v[i - 1]!) / 2) * (t[i]! - t[i - 1]!);
  }
  return d;
}

describe('makeStreams (pure synthetic per-activity streams)', () => {
  test('easy run: ~SAMPLE_COUNT samples, aligned arrays, drift up in HR', () => {
    const s = makeStreams('easy', 12000, 3300, 142, 7);
    const L = s.t.length;
    expect(L).toBeGreaterThan(150);
    expect(L).toBeLessThanOrEqual(200);
    expect(s.d).toHaveLength(L);
    expect(s.v).toHaveLength(L);
    expect(s.hr).toHaveLength(L);
    expect(s.alt).toHaveLength(L);
    // HR drifts upward (cardiac drift): late-run avg > early-run avg.
    const mean = (xs: (number | null)[]): number =>
      xs.reduce<number>((a, b) => a + (b ?? 0), 0) / xs.length;
    const early = mean(s.hr.slice(0, 20));
    const late = mean(s.hr.slice(-20));
    expect(late).toBeGreaterThan(early);
  });

  test('duration consistency: last t == movingTimeS', () => {
    const s = makeStreams('long', 32000, 9200, 148, 11);
    expect(s.t[0]).toBe(0);
    expect(s.t[s.t.length - 1]).toBe(9200);
  });

  test('d/v consistency within 2%', () => {
    const dist = 16000;
    const s = makeStreams('easy', dist, 4400, 145, 3);
    // Final stored d matches the requested distance.
    expect(Math.abs(s.d[s.d.length - 1]! - dist) / dist).toBeLessThan(0.02);
    // And d is the integral of v (the stored profile is internally consistent).
    const integ = integralDistance(s.t, s.v);
    expect(Math.abs(integ - s.d[s.d.length - 1]!) / dist).toBeLessThan(0.02);
    // d is monotonically non-decreasing.
    for (let i = 1; i < s.d.length; i++) expect(s.d[i]!).toBeGreaterThanOrEqual(s.d[i - 1]!);
  });

  test('quality run shows 4 distinct work blocks above a threshold velocity', () => {
    // 4×1mi @ ~6:05/mi plus warmup/recovery/cooldown. ~9.5 mi total ~ 15300 m.
    const dist = 15300;
    const movingTime = Math.round(dist * (405 / 1609.344)); // ~6:45/mi blended
    const s = makeStreams('quality', dist, movingTime, 165, 5);
    // Work pace ~6:05/mi = 4.41 m/s; easy ~8:15 = 3.25; threshold between.
    const WORK_V = 4.0;
    // Count rising-edge crossings above WORK_V to detect distinct work blocks.
    let blocks = 0;
    let inBlock = false;
    let blockLen = 0;
    for (const vv of s.v) {
      if (vv >= WORK_V) {
        if (!inBlock) {
          inBlock = true;
          blockLen = 0;
        }
        blockLen += 1;
      } else if (inBlock) {
        if (blockLen >= 2) blocks += 1; // ignore single-sample noise spikes
        inBlock = false;
      }
    }
    if (inBlock && blockLen >= 2) blocks += 1;
    expect(blocks).toBe(4);
  });

  test('determinism: same seed -> identical output', () => {
    const a = makeStreams('quality', 15000, 3800, 165, 42);
    const b = makeStreams('quality', 15000, 3800, 165, 42);
    expect(a).toEqual(b);
    const c = makeStreams('quality', 15000, 3800, 165, 43);
    expect(c).not.toEqual(a);
  });
});

describe('makeRoute (pure synthetic loop)', () => {
  test('returns a closed loop (first ≈ last) capped at 120 points', () => {
    const r = makeRoute(12000, 7);
    expect(r.length).toBeLessThanOrEqual(120);
    expect(r.length).toBeGreaterThan(10);
    expect(r[0]![0]).toBeCloseTo(r[r.length - 1]![0], 6);
    expect(r[0]![1]).toBeCloseTo(r[r.length - 1]![1], 6);
  });

  test('points are near the Chicago center', () => {
    const r = makeRoute(12000, 9);
    for (const [lat, lng] of r) {
      expect(lat).toBeGreaterThan(41.6);
      expect(lat).toBeLessThan(42.2);
      expect(lng).toBeGreaterThan(-87.9);
      expect(lng).toBeLessThan(-87.3);
    }
  });

  test('larger distance -> larger loop radius', () => {
    const center = 41.88;
    const spread = (r: [number, number][]) =>
      Math.max(...r.map((p) => Math.abs(p[0] - center)));
    expect(spread(makeRoute(32000, 4))).toBeGreaterThan(spread(makeRoute(8000, 4)));
  });

  test('determinism: same seed -> identical route', () => {
    expect(makeRoute(12000, 21)).toEqual(makeRoute(12000, 21));
    expect(makeRoute(12000, 21)).not.toEqual(makeRoute(12000, 22));
  });
});

describe('buildSampleBlock wires streams + routes onto every activity', () => {
  const block = buildSampleBlock({ startDate: START, today: TODAY });

  test('every seeded activity has streams and a route', () => {
    expect(block.activities.length).toBeGreaterThan(0);
    for (const a of block.activities as SampleActivity[]) {
      expect(a.streams).toBeDefined();
      expect(a.route).toBeDefined();
      expect(a.streams!.t.length).toBeGreaterThan(10);
      expect(a.route!.length).toBeLessThanOrEqual(120);
    }
  });

  test('deterministic across two builds', () => {
    const b2 = buildSampleBlock({ startDate: START, today: TODAY });
    expect(b2.activities).toEqual(block.activities);
  });
});
