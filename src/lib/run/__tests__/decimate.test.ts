import {
  decimateMean,
  decimateMinMax,
  DEFAULT_DECIMATE_TARGET,
} from '../decimate';

describe('decimateMinMax', () => {
  test('passes through unchanged when n <= target', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 20, 15, 30, 25];
    const out = decimateMinMax(xs, ys, 600);
    expect(out.xs).toEqual(xs);
    expect(out.ys).toEqual(ys);
    // returns copies, not the same array reference
    expect(out.xs).not.toBe(xs);
  });

  test('length is bounded by ~target and never exceeds input', () => {
    const n = 7500;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.sin(i / 40) * 100);
    const out = decimateMinMax(xs, ys, 600);
    expect(out.xs.length).toBeLessThanOrEqual(600);
    expect(out.xs.length).toBeGreaterThan(100);
    expect(out.xs.length).toBeLessThan(n);
    expect(out.ys.length).toBe(out.xs.length);
  });

  test('preserves a single sharp spike buried in a flat series', () => {
    const n = 4000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, () => 100);
    const spikeIdx = 2137;
    ys[spikeIdx] = 999; // a lone pace/HR spike (one full-res sample)
    const out = decimateMinMax(xs, ys, 600);
    // The spike's VALUE must survive as some bucket's max.
    expect(Math.max(...out.ys.filter((y): y is number => y != null))).toBe(999);
    // …and its x must be preserved (not smeared to a neighbour).
    const keptSpike = out.xs[out.ys.indexOf(999)];
    expect(keptSpike).toBe(spikeIdx);
  });

  test('preserves both a min dip and a max spike in the same region', () => {
    const n = 3000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, () => 50);
    ys[1500] = -200; // deep dip
    ys[1501] = 400;  // adjacent spike
    const out = decimateMinMax(xs, ys, 600);
    const vals = out.ys.filter((y): y is number => y != null);
    expect(Math.min(...vals)).toBe(-200);
    expect(Math.max(...vals)).toBe(400);
  });

  test('always keeps first and last points at their true x', () => {
    const n = 5000;
    const xs = Array.from({ length: n }, (_, i) => i * 11); // ~11s spacing
    const ys = Array.from({ length: n }, (_, i) => i);
    const out = decimateMinMax(xs, ys, 600);
    expect(out.xs[0]).toBe(0);
    expect(out.ys[0]).toBe(0);
    expect(out.xs[out.xs.length - 1]).toBe((n - 1) * 11);
    expect(out.ys[out.ys.length - 1]).toBe(n - 1);
  });

  test('x stays strictly ascending', () => {
    const n = 6000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.cos(i / 17) * ((i % 200) - 100));
    const out = decimateMinMax(xs, ys, 600);
    for (let i = 1; i < out.xs.length; i++) {
      expect(out.xs[i]!).toBeGreaterThan(out.xs[i - 1]!);
    }
  });

  test('tolerates nulls (stops / GPS dropouts) without crashing', () => {
    const n = 3000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys: (number | null)[] = Array.from({ length: n }, (_, i) => (i % 7 === 0 ? null : i % 100));
    ys[1234] = 555; // spike among the nulls
    const out = decimateMinMax(xs, ys, 400);
    expect(out.xs.length).toBeGreaterThan(0);
    expect(Math.max(...out.ys.filter((y): y is number => y != null))).toBe(555);
  });

  test('uses the default target when none is given', () => {
    const n = 5000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => i);
    const out = decimateMinMax(xs, ys);
    expect(out.xs.length).toBeLessThanOrEqual(DEFAULT_DECIMATE_TARGET);
  });
});

describe('decimateMean', () => {
  test('passes through unchanged when n <= target', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 20, 15, 30, 25];
    const out = decimateMean(xs, ys, 600);
    expect(out.xs).toEqual(xs);
    expect(out.ys).toEqual(ys);
    expect(out.xs).not.toBe(xs);
  });

  test('length is bounded by ~target; one point per bucket', () => {
    const n = 7500;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, (_, i) => Math.sin(i / 40) * 100);
    const out = decimateMean(xs, ys, 300);
    expect(out.xs.length).toBeLessThanOrEqual(300);
    expect(out.xs.length).toBeGreaterThan(100);
    expect(out.ys.length).toBe(out.xs.length);
    // xs stay ascending
    for (let i = 1; i < out.xs.length; i++) expect(out.xs[i]!).toBeGreaterThanOrEqual(out.xs[i - 1]!);
  });

  test('bucket jitter cancels: a noisy flat series decimates to ~its mean', () => {
    const n = 6000;
    const xs = Array.from({ length: n }, (_, i) => i);
    // ±30 alternating jitter around 100 — min-max would keep the full comb.
    const ys = Array.from({ length: n }, (_, i) => 100 + (i % 2 === 0 ? 30 : -30));
    const out = decimateMean(xs, ys, 300);
    const interior = out.ys.slice(1, -1).filter((y): y is number => y != null);
    for (const y of interior) expect(Math.abs(y - 100)).toBeLessThan(3);
  });

  test('all-null buckets survive as null gap points; first/last pinned', () => {
    const n = 4000;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys: (number | null)[] = Array.from({ length: n }, () => 50);
    for (let i = 1800; i < 2200; i++) ys[i] = null; // a masked walk break
    const out = decimateMean(xs, ys, 300);
    expect(out.ys.some((y) => y == null)).toBe(true);
    expect(out.xs[0]).toBe(0);
    expect(out.xs[out.xs.length - 1]).toBe(n - 1);
    expect(out.ys[0]).toBe(50);
  });

  test('a sustained rep (not a lone sample) stays visible after averaging', () => {
    const n = 3000; // ~50 min at 1Hz
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = Array.from({ length: n }, () => 480); // 8:00 easy
    for (let i = 1500; i < 1545; i++) ys[i] = 330; // 45s rep @ 5:30
    const out = decimateMean(xs, ys, 300); // 10s buckets
    const minY = Math.min(...out.ys.filter((y): y is number => y != null));
    expect(minY).toBeLessThan(360); // rep clearly below easy band
  });
});
