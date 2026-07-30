import {
  simplifyRouteForStore,
  hrLoad,
  shouldPurgeRaw,
} from '../derive';
import {
  trimp,
} from '../../kpi/insights/trainingLoad';

describe('simplifyRouteForStore', () => {
  it('returns null for null input', () => {
    expect(simplifyRouteForStore(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(simplifyRouteForStore(undefined)).toBeNull();
  });

  it('returns null for an empty route', () => {
    expect(simplifyRouteForStore([])).toBeNull();
  });

  it('caps a long route at maxPoints and preserves the first + last points', () => {
    const route: [number, number][] = [];
    for (let i = 0; i < 1000; i++) {
      route.push([41.88 + 0.02 * Math.sin(i * 0.6), -87.62 + i * 0.0002]);
    }
    const out = simplifyRouteForStore(route);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(50);
    expect(out![0]).toEqual(route[0]);
    expect(out![out!.length - 1]).toEqual(route[route.length - 1]);
  });

  it('honors a custom maxPoints', () => {
    const route: [number, number][] = [];
    for (let i = 0; i < 5000; i++) route.push([i * 0.001, 0]);
    const out = simplifyRouteForStore(route, 20);
    expect(out!.length).toBeLessThanOrEqual(20);
    expect(out![0]).toEqual(route[0]);
    expect(out![out!.length - 1]).toEqual(route[route.length - 1]);
  });

  it('a route already under the cap is returned (endpoints intact) unchanged', () => {
    const route: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const out = simplifyRouteForStore(route, 50);
    expect(out).toEqual(route);
  });
});

describe('hrLoad', () => {
  it('returns the known TRIMP value for a known input', () => {
    // 60 minutes @ avgHr 150, maxHr 190 → hrr = (150-50)/(190-50) = 0.714286,
    // load = 60 · hrr · e^(1.92·hrr) ≈ 168.899.
    const load = hrLoad({ movingTimeS: 3600, avgHr: 150, maxHr: 190 });
    expect(load).not.toBeNull();
    expect(load as number).toBeCloseTo(168.899, 2);
  });

  it('matches the shared trimp formula exactly (delegates, does not reimplement)', () => {
    const expected = trimp({ movingTimeS: 2400, avgHr: 165, maxHr: 188 });
    const actual = hrLoad({ movingTimeS: 2400, avgHr: 165, maxHr: 188 });
    expect(actual).toBeCloseTo(expected as number, 10);
  });

  it('returns null when avgHr is null', () => {
    expect(hrLoad({ movingTimeS: 3600, avgHr: null, maxHr: 190 })).toBeNull();
  });

  it('returns null when avgHr is undefined', () => {
    expect(hrLoad({ movingTimeS: 3600, avgHr: undefined })).toBeNull();
  });

  it('still scales with duration at the same intensity (sanity, mirrors trimp)', () => {
    const short = hrLoad({ movingTimeS: 1800, avgHr: 150, maxHr: 190 })!;
    const long = hrLoad({ movingTimeS: 3600, avgHr: 150, maxHr: 190 })!;
    expect(long).toBeCloseTo(short * 2, 5);
  });
});

describe('shouldPurgeRaw', () => {
  // Fixed "now" so tests are never time-dependent.
  const NOW = new Date('2026-07-17T12:00:00.000Z');

  function eligibleRow(overrides: Partial<Parameters<typeof shouldPurgeRaw>[0]> = {}) {
    return {
      source: 'strava',
      startDate: '2026-07-01T12:00:00.000Z', // 16 days before NOW
      enrichedAt: '2026-07-02T00:00:00.000Z',
      hasRaw: true,
      ...overrides,
    };
  }

  it('returns true when every condition is met', () => {
    expect(shouldPurgeRaw(eligibleRow(), NOW)).toBe(true);
  });

  it('returns false for a non-strava source', () => {
    expect(shouldPurgeRaw(eligibleRow({ source: 'manual' }), NOW)).toBe(false);
  });

  it('returns false when enrichedAt is null', () => {
    expect(shouldPurgeRaw(eligibleRow({ enrichedAt: null }), NOW)).toBe(false);
  });

  it('returns false when enrichedAt is undefined', () => {
    expect(shouldPurgeRaw(eligibleRow({ enrichedAt: undefined }), NOW)).toBe(false);
  });

  it('returns false when hasRaw is false (already purged, idempotent)', () => {
    expect(shouldPurgeRaw(eligibleRow({ hasRaw: false }), NOW)).toBe(false);
  });

  it('returns false when startDate is within the last 6 days', () => {
    const startDate = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldPurgeRaw(eligibleRow({ startDate }), NOW)).toBe(false);
  });

  it('boundary: exactly 6 days old does NOT purge (strictly older than required)', () => {
    const startDate = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldPurgeRaw(eligibleRow({ startDate }), NOW)).toBe(false);
  });

  it('boundary: 6 days + 1ms old DOES purge', () => {
    const startDate = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000 - 1).toISOString();
    expect(shouldPurgeRaw(eligibleRow({ startDate }), NOW)).toBe(true);
  });

  it('a row 6.5 days old (still <7d) purges under the 6-day margin', () => {
    const startDate = new Date(NOW.getTime() - 6.5 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldPurgeRaw(eligibleRow({ startDate }), NOW)).toBe(true);
  });

  it('accepts Date objects for startDate and enrichedAt, not just strings', () => {
    const startDate = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    const enrichedAt = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000);
    expect(shouldPurgeRaw(eligibleRow({ startDate, enrichedAt }), NOW)).toBe(true);
  });

  it('honors a custom days window', () => {
    const startDate = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldPurgeRaw(eligibleRow({ startDate }), NOW, 1)).toBe(true);
    expect(shouldPurgeRaw(eligibleRow({ startDate }), NOW, 3)).toBe(false);
  });

  it('returns false (not throw) for an unparseable startDate', () => {
    expect(shouldPurgeRaw(eligibleRow({ startDate: 'not-a-date' }), NOW)).toBe(false);
  });

  it('returns false (not throw) for an invalid Date object as startDate', () => {
    expect(shouldPurgeRaw(eligibleRow({ startDate: new Date('nope') }), NOW)).toBe(false);
  });
});
