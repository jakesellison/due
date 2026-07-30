import {
  describeBanked,
  isRecentlyBanked,
  pickNewestBanked,
  toMillis,
  preRunMeters,
  crossedMileageContract,
  type BankableActivity,
} from './justBanked';
import type { QualitySummary } from '../run/streamSummary';

const METERS_PER_MILE = 1609.344;

function act(over: Partial<BankableActivity>): BankableActivity {
  return {
    id: 'a',
    distance_meters: 10 * METERS_PER_MILE,
    moving_time_s: null,
    start_date: '2026-07-14T12:00:00Z',
    workout_type: null,
    stream_summary: null,
    quality_override: null,
    ...over,
  };
}

describe('toMillis', () => {
  const expected = Date.UTC(2026, 6, 15, 16, 22, 59);
  it('parses strict ISO 8601', () => {
    expect(toMillis('2026-07-15T16:22:59+00:00')).toBe(expected);
  });
  it('parses the Postgres form Hermes rejects (space + short offset)', () => {
    // Hermes returns NaN for this; the normaliser must recover it.
    expect(toMillis('2026-07-15 16:22:59+00')).toBe(expected);
  });
  it('parses the +0000 offset form', () => {
    expect(toMillis('2026-07-15 16:22:59+0000')).toBe(expected);
  });
  it('parses a Z suffix', () => {
    expect(toMillis('2026-07-15T16:22:59Z')).toBe(expected);
  });
});

describe('isRecentlyBanked', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  it('accepts a run inside the trailing window', () => {
    expect(isRecentlyBanked('2026-07-14T18:00:00Z', now)).toBe(true);
  });
  it('accepts a run dated in the Hermes-hostile Postgres format', () => {
    expect(isRecentlyBanked('2026-07-14 18:00:00+00', now)).toBe(true);
  });
  it('rejects a run older than the window', () => {
    expect(isRecentlyBanked('2026-07-12T00:00:00Z', now)).toBe(false);
  });
  it('rejects a future-dated run', () => {
    expect(isRecentlyBanked('2026-07-16T00:00:00Z', now)).toBe(false);
  });
  it('rejects an unparseable date', () => {
    expect(isRecentlyBanked('not-a-date', now)).toBe(false);
  });
});

describe('pickNewestBanked', () => {
  it('returns the newest real run by start instant', () => {
    const rows = [
      act({ id: 'old', start_date: '2026-07-10T12:00:00Z' }),
      act({ id: 'new', start_date: '2026-07-14T12:00:00Z' }),
    ];
    expect(pickNewestBanked(rows)?.id).toBe('new');
  });
  it('skips zero-distance and undated rows', () => {
    const rows = [
      act({ id: 'zero', distance_meters: 0, start_date: '2026-07-20T12:00:00Z' }),
      act({ id: 'undated', start_date: null }),
      act({ id: 'real', start_date: '2026-07-14T12:00:00Z' }),
    ];
    expect(pickNewestBanked(rows)?.id).toBe('real');
  });
  it('returns null when nothing qualifies', () => {
    expect(pickNewestBanked([])).toBeNull();
    expect(pickNewestBanked([act({ distance_meters: 0 })])).toBeNull();
  });
});

describe('describeBanked', () => {
  // The payload is deliberately the four fields the Dash + ContractMetMoment
  // consume: id, label, and the RAW distance/time the moment animates and
  // formats itself (so km runners never see a hardcoded `/mi`).
  it('leads with the detected quality kind', () => {
    const quality = {
      isQuality: true,
      kind: 'tempo',
      blocks: [],
      summary: '',
      qualityTimeMin: 0,
      qualityDistanceMeters: 0,
      honest: { kind: 'tempo', qualityMi: 2.4, blocks: [], summary: '' },
    } as unknown as QualitySummary;
    const info = describeBanked(
      act({ id: 'q', distance_meters: 6 * METERS_PER_MILE, moving_time_s: 6 * 420, stream_summary: { quality } }),
      0,
    );
    expect(info).toEqual({
      activityId: 'q',
      label: 'TEMPO',
      distanceMeters: 6 * METERS_PER_MILE,
      movingTimeS: 6 * 420,
    });
  });

  it('flags a race', () => {
    const info = describeBanked(act({ workout_type: 1, distance_meters: 13.1 * METERS_PER_MILE }), 0);
    expect(info.label).toBe('RACE');
  });

  it('flags the long run when it clears 90% of the long target', () => {
    const longTarget = 12 * METERS_PER_MILE;
    const info = describeBanked(act({ distance_meters: 11.5 * METERS_PER_MILE, moving_time_s: 11.5 * 540 }), longTarget);
    expect(info.label).toBe('LONG RUN');
    expect(info.distanceMeters).toBeCloseTo(11.5 * METERS_PER_MILE, 2);
    expect(info.movingTimeS).toBe(11.5 * 540);
  });

  it('falls back to a plain run', () => {
    const info = describeBanked(act({ distance_meters: 5 * METERS_PER_MILE, moving_time_s: 5 * 480 }), 12 * METERS_PER_MILE);
    expect(info.label).toBe('RUN');
  });

  it('reports zero distance and a null moving time rather than NaN', () => {
    const info = describeBanked(act({ distance_meters: null, moving_time_s: null }), 0);
    expect(info.distanceMeters).toBe(0);
    expect(info.movingTimeS).toBeNull();
  });
});

describe('preRunMeters', () => {
  it('subtracts this run from the week banked total', () => {
    expect(preRunMeters(90_000, 12_000)).toBe(78_000);
  });

  it('clamps at zero when the run is the only banked work', () => {
    // Floating drift or a re-ingested run can make the run exceed the total;
    // a negative pre-run value would animate the track backwards from nowhere.
    expect(preRunMeters(12_000, 12_500)).toBe(0);
  });

  it('treats a non-finite total as zero rather than propagating NaN', () => {
    expect(preRunMeters(Number.NaN, 12_000)).toBe(0);
  });
});

describe('crossedMileageContract', () => {
  it('is true only for the run that crosses the target', () => {
    expect(crossedMileageContract(78_000, 101_000, 100_000)).toBe(true);
  });

  it('is false when the contract was already met before this run', () => {
    expect(crossedMileageContract(100_500, 112_000, 100_000)).toBe(false);
  });

  it('is false when the contract is still short after this run', () => {
    expect(crossedMileageContract(60_000, 78_000, 100_000)).toBe(false);
  });

  it('counts landing exactly on the target as met', () => {
    expect(crossedMileageContract(88_000, 100_000, 100_000)).toBe(true);
  });

  it('is false when the week has no mileage target', () => {
    expect(crossedMileageContract(0, 40_000, 0)).toBe(false);
  });
});
