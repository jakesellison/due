import {
  haversineMeters,
  pathDistanceMeters,
  closeLoop,
  simplifyPath,
  defaultRouteName,
  relativeDateLabel,
  type LatLng,
} from '../routes/geo';

describe('haversineMeters', () => {
  test('identical points → 0', () => {
    expect(haversineMeters([41.88, -87.62], [41.88, -87.62])).toBe(0);
  });

  test('1° of latitude ≈ 111.19 km', () => {
    const d = haversineMeters([0, 0], [1, 0]);
    // mean-Earth-radius value: 1° lat = R * π/180 ≈ 111195 m.
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
    expect(d / 1000).toBeCloseTo(111.19, 1);
  });

  test('1° of longitude at the equator ≈ 111.19 km, shrinks with latitude', () => {
    const eq = haversineMeters([0, 0], [0, 1]);
    const mid = haversineMeters([60, 0], [60, 1]);
    expect(eq / 1000).toBeCloseTo(111.19, 1);
    // At 60°N, a longitude degree is ~half (cos 60° = 0.5).
    expect(mid / eq).toBeCloseTo(0.5, 1);
  });

  test('symmetric', () => {
    const a: LatLng = [41.8, -87.6];
    const b: LatLng = [41.9, -87.7];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('pathDistanceMeters', () => {
  test('< 2 points → 0', () => {
    expect(pathDistanceMeters([])).toBe(0);
    expect(pathDistanceMeters([[41.88, -87.62]])).toBe(0);
  });

  test('cumulative = sum of legs', () => {
    const pts: LatLng[] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const leg1 = haversineMeters(pts[0]!, pts[1]!);
    const leg2 = haversineMeters(pts[1]!, pts[2]!);
    expect(pathDistanceMeters(pts)).toBeCloseTo(leg1 + leg2, 6);
  });

  test('three points along a meridian = 2°', () => {
    const pts: LatLng[] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    expect(pathDistanceMeters(pts) / 1000).toBeCloseTo(222.39, 0);
  });
});

describe('closeLoop', () => {
  test('appends the start point', () => {
    const pts: LatLng[] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const looped = closeLoop(pts);
    expect(looped).toHaveLength(4);
    expect(looped[looped.length - 1]).toEqual([0, 0]);
    // Original is not mutated.
    expect(pts).toHaveLength(3);
  });

  test('no-op when already closed', () => {
    const pts: LatLng[] = [
      [0, 0],
      [0, 1],
      [0, 0],
    ];
    expect(closeLoop(pts)).toHaveLength(3);
  });

  test('< 2 points returns a copy', () => {
    expect(closeLoop([])).toEqual([]);
    expect(closeLoop([[1, 1]])).toEqual([[1, 1]]);
  });
});

describe('simplifyPath', () => {
  test('within cap → unchanged copy', () => {
    const pts: LatLng[] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const out = simplifyPath(pts, 300);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });

  test('caps a long path at ≤ maxPoints and preserves endpoints', () => {
    // A genuinely wiggly 1000-point path (a high-frequency sine wander) so DP
    // must keep many vertices to stay under the perpendicular threshold.
    const pts: LatLng[] = [];
    for (let i = 0; i < 1000; i++) {
      pts.push([41.88 + 0.02 * Math.sin(i * 0.6), -87.62 + i * 0.0002]);
    }
    const out = simplifyPath(pts, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  test('degenerate collinear path falls back to stride sampling under the cap', () => {
    // 5000 collinear points: DP collapses to 2, so to exercise the stride path
    // use a tiny cap where even DP at eps→0 can keep endpoints only. We assert
    // the cap holds and endpoints survive regardless of which branch ran.
    const pts: LatLng[] = [];
    for (let i = 0; i < 5000; i++) pts.push([i * 0.001, 0]);
    const out = simplifyPath(pts, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  test('empty / null safe', () => {
    expect(simplifyPath([], 300)).toEqual([]);
  });
});

describe('defaultRouteName', () => {
  test('miles', () => {
    expect(defaultRouteName(8368, 'mi')).toBe('Route 5.2 mi');
  });
  test('km', () => {
    expect(defaultRouteName(5200, 'km')).toBe('Route 5.2 km');
  });
});

describe('relativeDateLabel', () => {
  const now = new Date(2026, 2, 20, 10, 0, 0); // Fri Mar 20 2026, local.
  test('same day → Today', () => {
    expect(relativeDateLabel(new Date(2026, 2, 20, 1, 0, 0).toISOString(), now)).toBe('Today');
  });
  test('previous day → Yesterday', () => {
    expect(relativeDateLabel(new Date(2026, 2, 19, 23, 0, 0).toISOString(), now)).toBe('Yesterday');
  });
  test('within a week → N days ago', () => {
    expect(relativeDateLabel(new Date(2026, 2, 17).toISOString(), now)).toBe('3 days ago');
  });
  test('older same year → Mon D', () => {
    expect(relativeDateLabel(new Date(2026, 1, 14).toISOString(), now)).toBe('Feb 14');
  });
  test('prior year includes the year', () => {
    expect(relativeDateLabel(new Date(2025, 11, 1).toISOString(), now)).toBe('Dec 1, 2025');
  });
});
