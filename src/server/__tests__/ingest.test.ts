jest.mock('../strava', () => ({
  refreshAccessToken: jest.fn(),
}));

import {
  mapStravaActivity,
  mapBestEfforts,
  countHardLaps,
  getConnectionByAthlete,
  ensureFreshAccessToken,
  isRevokedTokenError,
  withEnrichedAt,
  type StravaActivity,
} from '../ingest';
import { refreshAccessToken } from '../strava';

const mockRefreshAccessToken = refreshAccessToken as jest.MockedFunction<
  typeof refreshAccessToken
>;

/** Realistic-ish Strava activity fixture. */
const fullActivity: StravaActivity = {
  id: 987654321,
  name: 'Threshold session',
  // 2024-01-15T13:30:00Z is 2024-01-15 07:30 in America/Chicago (CST, UTC-6).
  start_date: '2024-01-15T13:30:00Z',
  distance: 12345.6,
  moving_time: 3600,
  elapsed_time: 3720,
  average_heartrate: 158.2,
  max_heartrate: 181,
  suffer_score: 142,
  sport_type: 'Run',
  type: 'Run',
  average_temp: 14,
  laps: [
    { average_heartrate: 150 },
    { average_heartrate: 162 },
    { average_heartrate: 165 },
    { average_heartrate: 159 },
  ],
  best_efforts: [
    { name: '1k', distance: 1000, elapsed_time: 200, start_date: '2024-01-15T13:31:00Z' },
    { name: '1 mile', distance: 1609.34, elapsed_time: 330, start_date: '2024-01-15T13:35:00Z' },
  ],
};

describe('mapStravaActivity', () => {
  it('ActivityRow carries stream_summary (null until enriched)', () => {
    const row = mapStravaActivity({ id: 1, start_date: '2026-06-30T12:00:00Z', distance: 7000, moving_time: 3478, elapsed_time: 3493, name: 'Run', laps: null } as any, 'America/Chicago');
    expect('stream_summary' in row).toBe(true);
    expect(row.stream_summary).toBeNull();
  });

  it('maps a full activity, rounding distance and computing local_date', () => {
    const row = mapStravaActivity(fullActivity, 'America/Chicago');
    expect(row.source).toBe('strava');
    expect(row.source_id).toBe('987654321');
    expect(row.distance_meters).toBe(12346);
    expect(Number.isInteger(row.distance_meters)).toBe(true);
    expect(row.local_date).toBe('2024-01-15');
    expect(row.moving_time_s).toBe(3600);
    expect(row.elapsed_time_s).toBe(3720);
    expect(row.avg_hr).toBe(158);
    expect(row.max_hr).toBe(181);
    expect(row.suffer_score).toBe(142);
    expect(row.name).toBe('Threshold session');
    expect(row.sport_type).toBe('Run');
    // raw is preserved untouched.
    expect(row.raw).toBe(fullActivity);
    expect(row.laps).toHaveLength(4);
  });

  it('computes the durable route_simplified + hr_load derived fields (survive the raw purge)', () => {
    const row = mapStravaActivity(fullActivity, 'America/Chicago');
    // fullActivity has no map, so route (and thus route_simplified) is null,
    // but avg_hr/max_hr/moving_time_s are present so hr_load is computed.
    expect(row.route).toBeNull();
    expect(row.route_simplified).toBeNull();
    expect(row.hr_load).not.toBeNull();
    expect(typeof row.hr_load).toBe('number');
  });

  it('route_simplified caps a real GPS route at <=50 points, preserving endpoints; hr_load null without avg_hr', () => {
    const withRoute: StravaActivity = {
      ...fullActivity,
      average_heartrate: undefined,
      map: { summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
    };
    const row = mapStravaActivity(withRoute, 'America/Chicago');
    expect(row.route).not.toBeNull();
    expect(row.route_simplified).not.toBeNull();
    expect(row.route_simplified!.length).toBeLessThanOrEqual(50);
    expect(row.route_simplified![0]).toEqual(row.route![0]);
    expect(row.route_simplified![row.route_simplified!.length - 1]).toEqual(
      row.route![row.route!.length - 1],
    );
    // avg_hr absent -> hr_load must be null (never a duration-only guess).
    expect(row.avg_hr).toBeNull();
    expect(row.hr_load).toBeNull();
  });

  it('maps average_temp to avg_temp_c and best_efforts into our shape', () => {
    const row = mapStravaActivity(fullActivity, 'America/Chicago');
    expect(row.avg_temp_c).toBe(14);
    expect(row.best_efforts).toEqual([
      { name: '1k', distance_m: 1000, elapsed_s: 200, start_date: '2024-01-15T13:31:00Z' },
      { name: '1 mile', distance_m: 1609.34, elapsed_s: 330, start_date: '2024-01-15T13:35:00Z' },
    ]);
  });

  it('maps absent average_temp and best_efforts to null', () => {
    const sparse: StravaActivity = {
      id: 99,
      name: 'Easy run',
      start_date: '2024-03-01T12:00:00Z',
      distance: 8000,
      moving_time: 2400,
      elapsed_time: 2450,
      type: 'Run',
      // no average_temp, no best_efforts
    };
    const row = mapStravaActivity(sparse, 'UTC');
    expect(row.avg_temp_c).toBeNull();
    expect(row.best_efforts).toBeNull();
  });

  it('rolls local_date across the day boundary by timezone', () => {
    // 2024-01-15T02:00:00Z is still 2024-01-14 in America/Chicago.
    const late = { ...fullActivity, start_date: '2024-01-15T02:00:00Z' };
    expect(mapStravaActivity(late, 'America/Chicago').local_date).toBe('2024-01-14');
    // Same instant is 2024-01-15 in UTC.
    expect(mapStravaActivity(late, 'UTC').local_date).toBe('2024-01-15');
  });

  it('maps missing HR / suffer_score / laps to null and falls back to type for sport', () => {
    const sparse: StravaActivity = {
      id: 42,
      name: 'Easy run',
      start_date: '2024-03-01T12:00:00Z',
      distance: 8000,
      moving_time: 2400,
      elapsed_time: 2450,
      type: 'Run',
      // no sport_type, no HR fields, no suffer_score, no laps
    };
    const row = mapStravaActivity(sparse, 'UTC');
    expect(row.avg_hr).toBeNull();
    expect(row.max_hr).toBeNull();
    expect(row.suffer_score).toBeNull();
    expect(row.laps).toBeNull();
    expect(row.sport_type).toBe('Run');
    expect(row.source_id).toBe('42');
  });
});

describe('withEnrichedAt', () => {
  it('stamps enriched_at with the given clock, leaving the rest of the row untouched', () => {
    const row = mapStravaActivity(fullActivity, 'America/Chicago');
    expect(row.enriched_at).toBeUndefined(); // never attempted yet, per mapStravaActivity

    const stamped = withEnrichedAt(row, new Date('2026-07-06T12:00:00Z'));
    expect(stamped.enriched_at).toBe('2026-07-06T12:00:00.000Z');
    expect(stamped.source_id).toBe(row.source_id);
    expect(stamped.streams).toBe(row.streams);
  });

  it('stamps regardless of whether streams ended up populated (the attempt is what is recorded)', () => {
    const withStreams = withEnrichedAt(
      { ...mapStravaActivity(fullActivity, 'UTC'), streams: { moving: [], distance: [], time: [] } as never },
      new Date('2026-01-01T00:00:00Z'),
    );
    const withoutStreams = withEnrichedAt(mapStravaActivity(fullActivity, 'UTC'), new Date('2026-01-01T00:00:00Z'));
    expect(withStreams.enriched_at).toBe('2026-01-01T00:00:00.000Z');
    expect(withoutStreams.enriched_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defaults to the real current time when no clock is passed', () => {
    const before = Date.now();
    const stamped = withEnrichedAt(mapStravaActivity(fullActivity, 'UTC'));
    const after = Date.now();
    const stampedMs = new Date(stamped.enriched_at!).getTime();
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(after);
  });
});

describe('countHardLaps', () => {
  it('counts laps at or above the default threshold (160)', () => {
    // 150(no), 162(yes), 165(yes), 159(no) => 2
    expect(countHardLaps(fullActivity.laps)).toBe(2);
  });

  it('returns 0 for empty or undefined laps', () => {
    expect(countHardLaps([])).toBe(0);
    expect(countHardLaps(undefined)).toBe(0);
    expect(countHardLaps(null)).toBe(0);
  });

  it('honors a custom threshold', () => {
    // threshold 165 => only the 165 lap counts => 1
    expect(countHardLaps(fullActivity.laps, { hrThreshold: 165 })).toBe(1);
    // threshold 150 => 150,162,165,159 all >= 150 => 4
    expect(countHardLaps(fullActivity.laps, { hrThreshold: 150 })).toBe(4);
  });

  it('ignores laps with no HR', () => {
    const laps = [{ average_heartrate: 170 }, { average_heartrate: null }, {}];
    expect(countHardLaps(laps)).toBe(1);
  });
});

describe('mapBestEfforts', () => {
  it('returns null for absent/empty input', () => {
    expect(mapBestEfforts(null)).toBeNull();
    expect(mapBestEfforts(undefined)).toBeNull();
    expect(mapBestEfforts([])).toBeNull();
  });

  it('skips entries missing core numeric/string fields', () => {
    const efforts = [
      { name: '5k', distance: 5000, elapsed_time: 1120, start_date: '2024-01-15T13:40:00Z' },
      { name: 'broken', distance: 1000 }, // no elapsed_time / start_date -> skipped
      { distance: 1000, elapsed_time: 200, start_date: '2024-01-15T13:31:00Z' }, // no name
    ];
    expect(mapBestEfforts(efforts)).toEqual([
      { name: '5k', distance_m: 5000, elapsed_s: 1120, start_date: '2024-01-15T13:40:00Z' },
    ]);
  });

  it('returns null when nothing survives filtering', () => {
    expect(mapBestEfforts([{ name: 'x' }, { distance: 1 }])).toBeNull();
  });
});

/**
 * Build a chainable fake `integration_connections` query that records the
 * `.eq()` filters applied so tests can assert on them. Mirrors the supabase
 * mock style used in sync.test.ts.
 */
interface ConnBuilder {
  select: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  maybeSingle: jest.Mock;
}

function makeConnectionAdmin(data: unknown) {
  const eqFilters: Record<string, unknown> = {};
  const builder: ConnBuilder = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn((col: string, val: unknown) => {
      eqFilters[col] = val;
      return builder;
    }),
    order: jest.fn().mockReturnThis(),
    // getConnectionByAthlete terminates on .limit(1) → rows array.
    limit: jest.fn(async () => ({ data: data == null ? [] : [data], error: null })),
    maybeSingle: jest.fn(async () => ({ data, error: null })),
  };
  const admin = { from: jest.fn(() => builder) };
  return { admin, builder, eqFilters };
}

describe('getConnectionByAthlete', () => {
  it('filters to active connections only', async () => {
    const { admin, eqFilters } = makeConnectionAdmin({
      user_id: 'u1',
      access_token: 'a',
      refresh_token: 'r',
      expires_at: '2030-01-01T00:00:00Z',
    });

    const conn = await getConnectionByAthlete(admin as never, 12345);

    expect(conn).toMatchObject({ user_id: 'u1' });
    expect(eqFilters.status).toBe('active');
    expect(eqFilters.provider).toBe('strava');
    expect(eqFilters.provider_athlete_id).toBe('12345');
  });

  it('returns null when no active row matches (revoked/disconnected)', async () => {
    const { admin } = makeConnectionAdmin(null);
    const conn = await getConnectionByAthlete(admin as never, 999);
    expect(conn).toBeNull();
  });
});

describe('isRevokedTokenError', () => {
  it('treats 400/401 refresh failures as revoked', () => {
    expect(
      isRevokedTokenError(new Error('Strava token refresh failed: 400 {"errors":[]}')),
    ).toBe(true);
    expect(isRevokedTokenError(new Error('Strava token refresh failed: 401 nope'))).toBe(true);
  });

  it('does NOT treat transient (5xx / network) failures as revoked', () => {
    expect(isRevokedTokenError(new Error('Strava token refresh failed: 503'))).toBe(false);
    expect(isRevokedTokenError(new Error('fetch failed'))).toBe(false);
  });
});

describe('ensureFreshAccessToken', () => {
  const expiredConn = {
    user_id: 'u1',
    access_token: 'old',
    refresh_token: 'r',
    // already expired -> forces a refresh
    expires_at: '2000-01-01T00:00:00Z',
  };

  beforeEach(() => {
    mockRefreshAccessToken.mockReset();
  });

  it('marks the connection revoked when the refresh token is revoked', async () => {
    mockRefreshAccessToken.mockRejectedValueOnce(
      new Error('Strava token refresh failed: 400 {"errors":[{"code":"invalid"}]}'),
    );
    const { admin, builder, eqFilters } = makeConnectionAdmin(null);

    await expect(ensureFreshAccessToken(admin as never, expiredConn)).rejects.toThrow(
      /token refresh failed: 400/,
    );

    expect(builder.update).toHaveBeenCalledWith({ status: 'revoked' });
    expect(eqFilters.user_id).toBe('u1');
  });

  it('re-throws transient failures WITHOUT deactivating the connection', async () => {
    mockRefreshAccessToken.mockRejectedValueOnce(
      new Error('Strava token refresh failed: 503 upstream'),
    );
    const { admin, builder } = makeConnectionAdmin(null);

    await expect(ensureFreshAccessToken(admin as never, expiredConn)).rejects.toThrow(/503/);
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('persists the refreshed token on success', async () => {
    mockRefreshAccessToken.mockResolvedValueOnce({
      accessToken: 'new',
      refreshToken: 'r2',
      expiresAt: '2030-01-01T00:00:00Z',
      athleteId: null,
    });
    const { admin, builder } = makeConnectionAdmin(null);

    const token = await ensureFreshAccessToken(admin as never, expiredConn);
    expect(token).toBe('new');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'new', refresh_token: 'r2' }),
    );
  });
});

describe('isPermanentStreamsFailure', () => {
  const { isPermanentStreamsFailure } = require('../ingest');

  test('429 rate limit is transient (never stamp)', () => {
    expect(isPermanentStreamsFailure(new Error('streams failed: 429 Too Many Requests'))).toBe(false);
  });

  test('permanent 4xx terminates (404 gone, 403 private)', () => {
    expect(isPermanentStreamsFailure(new Error('streams failed: 404 Not Found'))).toBe(true);
    expect(isPermanentStreamsFailure(new Error('streams failed: 403 Forbidden'))).toBe(true);
  });

  test('5xx and network errors are transient', () => {
    expect(isPermanentStreamsFailure(new Error('streams failed: 502 Bad Gateway'))).toBe(false);
    expect(isPermanentStreamsFailure(new Error('fetch failed: ECONNRESET'))).toBe(false);
    expect(isPermanentStreamsFailure('not an error')).toBe(false);
  });
});

describe('withinStreamProcessingWindow', () => {
  const { withinStreamProcessingWindow } = require('../ingest');
  const now = new Date('2026-07-10T18:00:00Z');

  test('a run started an hour ago is inside the window', () => {
    expect(withinStreamProcessingWindow('2026-07-10T17:00:00Z', now)).toBe(true);
  });

  test('a run started two days ago is past the window', () => {
    expect(withinStreamProcessingWindow('2026-07-08T18:00:00Z', now)).toBe(false);
  });

  test('null / unparseable dates are treated as past the window (never loop)', () => {
    expect(withinStreamProcessingWindow(null, now)).toBe(false);
    expect(withinStreamProcessingWindow('not-a-date', now)).toBe(false);
  });
});

describe('shouldStampEnriched', () => {
  const { shouldStampEnriched } = require('../ingest');
  const now = new Date('2026-07-10T18:00:00Z');
  const fresh = '2026-07-10T17:00:00Z'; // 1h ago — inside processing window
  const old = '2026-05-01T00:00:00Z'; // months ago

  test('transient streams failure never stamps (retry later)', () => {
    expect(shouldStampEnriched({ start_date: fresh, streams: null, laps: null }, false, now)).toBe(false);
    expect(shouldStampEnriched({ start_date: old, streams: null, laps: null }, false, now)).toBe(false);
  });

  test('fully-processed row (streams + laps) stamps regardless of age', () => {
    expect(shouldStampEnriched({ start_date: fresh, streams: { t: [] } as any, laps: [{}] as any }, true, now)).toBe(true);
  });

  test('fresh upload missing streams is NOT stamped (would strand) — retry until Strava finishes', () => {
    // streams 404 (permanent-looking) but the activity is minutes old: still processing.
    expect(shouldStampEnriched({ start_date: fresh, streams: null, laps: null }, true, now)).toBe(false);
    // streams arrived but laps still lagging on a fresh upload: also not settled.
    expect(shouldStampEnriched({ start_date: fresh, streams: { t: [] } as any, laps: null }, true, now)).toBe(false);
  });

  test('old streamless row (genuine manual entry) stamps → terminates, no churn', () => {
    expect(shouldStampEnriched({ start_date: old, streams: null, laps: null }, true, now)).toBe(true);
  });
});

describe('upsertSummaryActivities', () => {
  const { upsertSummaryActivities } = require('../ingest');

  /** Fake admin client that records every upsert payload. */
  function fakeAdmin() {
    const payloads: any[] = [];
    return {
      payloads,
      from() {
        return { upsert: (p: any) => { payloads.push(p); return { error: null }; } };
      },
    };
  }

  const summaryRow = (source_id: string) => ({
    source: 'strava', source_id, name: 'Run', distance_meters: 14563,
    // mapStravaSummary seeds these detail columns to null:
    streams: null, stream_summary: null, laps: null, best_efforts: null,
    route: [[1, 2]], raw: { id: source_id },
  });

  test('EXISTING rows are stripped of detail keys; NEW rows keep them; imported counts new only', async () => {
    const admin = fakeAdmin();
    const rows = [summaryRow('existing-1'), summaryRow('new-1')] as any;
    const imported = await upsertSummaryActivities(admin as any, 'user-1', rows, new Set(['existing-1']));

    expect(imported).toBe(1); // only new-1 is new
    const [existingPayload, newPayload] = admin.payloads;
    // existing row: detail columns must NOT be in the payload (untouched on upsert)
    for (const k of ['streams', 'stream_summary', 'laps', 'best_efforts', 'route', 'raw']) {
      expect(k in existingPayload).toBe(false);
    }
    expect(existingPayload.name).toBe('Run'); // light scalars still written
    // new row: full summary written (detail columns present, null/route as mapped)
    expect('streams' in newPayload).toBe(true);
    expect('route' in newPayload).toBe(true);
  });
});

describe('stripDetailKeysForResummary', () => {
  const { stripDetailKeysForResummary } = require('../ingest');

  test('drops all enriched/detail columns; keeps light summary scalars', () => {
    const row = {
      source_id: '123',
      name: 'Morning Run',
      distance_meters: 14563,
      moving_time_s: 3600,
      max_hr: 182,
      workout_type: 3,
      streams: { t: [1, 2] },
      stream_summary: { quality: { kind: 'intervals' } },
      laps: [{}, {}],
      best_efforts: [{}],
      route: [[1, 2]],
      route_simplified: [[1, 2]],
      hr_load: 123.4,
      raw: { id: 123, laps: [{}, {}] },
    };
    const out = stripDetailKeysForResummary(row as any);
    for (const k of ['streams', 'stream_summary', 'laps', 'best_efforts', 'route', 'route_simplified', 'raw']) {
      expect(k in out).toBe(false);
    }
    expect(out.source_id).toBe('123');
    expect(out.name).toBe('Morning Run');
    expect(out.distance_meters).toBe(14563);
    expect((out as any).max_hr).toBe(182);
    // hr_load is NOT stripped — it refreshes alongside the light HR scalars.
    expect((out as any).hr_load).toBe(123.4);
  });
});

describe('stripUnsettledStreamKeys', () => {
  const { stripUnsettledStreamKeys } = require('../ingest');

  test('removes streams, stream_summary, route, and route_simplified; keeps everything else', () => {
    const row = {
      source_id: '123',
      name: 'Morning Run',
      distance_meters: 22531,
      streams: null,
      stream_summary: null,
      route: [[1, 2]],
      route_simplified: [[1, 2]],
      hr_load: 88.1,
      avg_temp_c: 21,
    };
    const out = stripUnsettledStreamKeys(row);
    expect('streams' in out).toBe(false);
    expect('stream_summary' in out).toBe(false);
    expect('route' in out).toBe(false);
    expect('route_simplified' in out).toBe(false);
    expect(out.source_id).toBe('123');
    expect(out.distance_meters).toBe(22531);
    expect(out.avg_temp_c).toBe(21);
    expect('enriched_at' in out).toBe(false);
    // hr_load is NOT stripped — it doesn't depend on the (unsettled) streams fetch.
    expect((out as any).hr_load).toBe(88.1);
  });
});
