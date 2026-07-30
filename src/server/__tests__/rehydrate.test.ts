import type { SupabaseClient } from '@supabase/supabase-js';

// `rehydrateActivity` reuses `ensureFreshAccessToken`/`fetchQualityInputs`/
// `fetchPlanQualityForDate` from `../ingest` (DRY — the same helpers
// `ingestStravaActivity` uses) and `fetchActivity`/`fetchStreams` from
// `../strava`. Mock only those collaborators; everything else (the actual
// `computeStreamSummary`/`fullResStreams`/`routeFromLatLng`/`routeFromPolyline`
// pipeline) runs for real so the test proves the real pipeline wires together,
// not a stub.
jest.mock('../ingest', () => ({
  ...jest.requireActual('../ingest'),
  ensureFreshAccessToken: jest.fn(),
  fetchQualityInputs: jest.fn(),
  fetchPlanQualityForDate: jest.fn(),
}));
jest.mock('../strava', () => ({
  fetchActivity: jest.fn(),
  fetchStreams: jest.fn(),
}));

import { rehydrateActivity } from '../rehydrate';
import { STREAM_SUMMARY_VERSION } from '../streams';
import { estimateQualityFloor } from '../../lib/kpi/qualityFloor';
import {
  ensureFreshAccessToken,
  fetchPlanQualityForDate,
  fetchQualityInputs,
} from '../ingest';
import { fetchActivity, fetchStreams } from '../strava';

const mockEnsureFreshAccessToken = ensureFreshAccessToken as jest.MockedFunction<typeof ensureFreshAccessToken>;
const mockFetchQualityInputs = fetchQualityInputs as jest.MockedFunction<typeof fetchQualityInputs>;
const mockFetchPlanQualityForDate = fetchPlanQualityForDate as jest.MockedFunction<typeof fetchPlanQualityForDate>;
const mockFetchActivity = fetchActivity as jest.MockedFunction<typeof fetchActivity>;
const mockFetchStreams = fetchStreams as jest.MockedFunction<typeof fetchStreams>;

const TEST_QF = { floor: estimateQualityFloor({ easyBaselineSecPerMi: 495 }), easyBaselineSecPerMi: 495 };

/** A minimal-but-real Strava streams fixture (mirrors streams.test.ts's rawSteady). */
function rawSteady(distM: number, durS: number, n: number) {
  const time: number[] = [];
  const distance: number[] = [];
  const velocity: number[] = [];
  const heartrate: number[] = [];
  const latlng: [number, number][] = [];
  const vel = distM / durS;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    time.push(Math.round(f * durS));
    distance.push(Math.round(f * distM * 100) / 100);
    velocity.push(vel);
    heartrate.push(150);
    latlng.push([40 + f * 0.01, -105 - f * 0.01]);
  }
  return {
    time: { data: time },
    distance: { data: distance },
    velocity_smooth: { data: velocity },
    heartrate: { data: heartrate },
    latlng: { data: latlng },
  };
}

const BASE_ROW = {
  id: 'act-1',
  user_id: 'user-1',
  source: 'strava',
  source_id: '999',
  name: 'Morning Run',
  local_date: '2026-06-01',
  distance_meters: 8000,
  moving_time_s: 2400,
  elapsed_time_s: 2450,
  avg_hr: 150,
  user_note: null,
  start_date: '2026-06-01T12:00:00Z',
  avg_temp_c: 18,
  best_efforts: null,
  workout_type: null,
  quality_override: null,
  enriched_at: '2026-06-01T13:00:00Z',
  max_hr: 175,
  suffer_score: 80,
  shoe_id: null,
  route: null,
  laps: null,
  raw: { id: 999, foo: 'bar' },
};

/**
 * A fake admin client covering exactly the two `activities` reads/writes and
 * one `integration_connections` read `rehydrateActivity` issues. The
 * post-update `.select().maybeSingle()` deliberately resolves `{data: null}`
 * (simulating a client that doesn't return the row on update) so these tests
 * also exercise the `row + update` merge fallback — and let assertions read
 * the update patch directly via `getUpdate()` rather than needing to predict
 * `computeStreamSummary`'s full output shape.
 */
function makeAdmin(opts: { activitiesRow: Record<string, unknown> | null; connRow?: Record<string, unknown> | null }) {
  let updatePatch: Record<string, unknown> | null = null;
  const activitiesBuilder: Record<string, jest.Mock> = {};
  activitiesBuilder.select = jest.fn(() => activitiesBuilder);
  activitiesBuilder.eq = jest.fn(() => activitiesBuilder);
  activitiesBuilder.update = jest.fn((patch: Record<string, unknown>) => {
    updatePatch = patch;
    return activitiesBuilder;
  });
  activitiesBuilder.maybeSingle = jest
    .fn()
    .mockResolvedValueOnce({ data: opts.activitiesRow, error: null })
    .mockResolvedValue({ data: null, error: null });

  const connBuilder: Record<string, jest.Mock> = {};
  connBuilder.select = jest.fn(() => connBuilder);
  connBuilder.eq = jest.fn(() => connBuilder);
  connBuilder.maybeSingle = jest.fn(async () => ({ data: opts.connRow ?? null, error: null }));

  const from = jest.fn((table: string) => {
    if (table === 'activities') return activitiesBuilder;
    if (table === 'integration_connections') return connBuilder;
    throw new Error(`unexpected table ${table}`);
  });

  return {
    admin: { from } as unknown as SupabaseClient,
    from,
    activitiesBuilder,
    getUpdate: () => updatePatch,
  };
}

const ACTIVE_CONN = {
  user_id: 'user-1',
  access_token: 'old-token',
  refresh_token: 'refresh-token',
  expires_at: '2099-01-01T00:00:00Z',
  status: 'active',
};

describe('rehydrateActivity', () => {
  beforeEach(() => {
    mockEnsureFreshAccessToken.mockReset();
    mockFetchQualityInputs.mockReset();
    mockFetchPlanQualityForDate.mockReset();
    mockFetchActivity.mockReset();
    mockFetchStreams.mockReset();
  });

  it('is a no-op when streams are already present — no Strava fetch, no connection lookup', async () => {
    const { admin, from } = makeAdmin({
      activitiesRow: { ...BASE_ROW, streams: { t: [0, 1], d: [0, 10], v: [0, 1], hr: [null, null], alt: null } },
    });

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.activity.streams).not.toBeNull();
      // Server-only fields never leak to the client shape.
      expect('user_id' in result.activity).toBe(false);
      expect('raw' in result.activity).toBe(false);
    }
    expect(mockEnsureFreshAccessToken).not.toHaveBeenCalled();
    expect(mockFetchActivity).not.toHaveBeenCalled();
    expect(mockFetchStreams).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith('integration_connections');
  });

  it('returns not_found when the row does not exist / is not owned by the caller', async () => {
    const { admin } = makeAdmin({ activitiesRow: null });

    const result = await rehydrateActivity(admin, 'user-1', 'missing');

    expect(result).toEqual({ ok: false, reason: 'not_found', message: expect.any(String) });
    expect(mockFetchActivity).not.toHaveBeenCalled();
  });

  it('purged row (streams null): re-fetches from Strava, repopulates columns, recomputes a STALE summary', async () => {
    const { admin, getUpdate } = makeAdmin({
      activitiesRow: {
        ...BASE_ROW,
        streams: null,
        // stale: an old detector version.
        stream_summary: { quality: { v: 1 } },
      },
      connRow: ACTIVE_CONN,
    });
    mockEnsureFreshAccessToken.mockResolvedValueOnce('fresh-token');
    mockFetchActivity.mockResolvedValueOnce({
      id: 999,
      laps: [{ average_heartrate: 150 }],
      map: { summary_polyline: null },
      suffer_score: 82.6,
    });
    mockFetchStreams.mockResolvedValueOnce(rawSteady(8000, 2400, 400) as never);
    mockFetchQualityInputs.mockResolvedValueOnce(TEST_QF);
    mockFetchPlanQualityForDate.mockResolvedValueOnce(null);

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result.ok).toBe(true);
    expect(mockEnsureFreshAccessToken).toHaveBeenCalledWith(admin, expect.objectContaining({ user_id: 'user-1' }));
    expect(mockFetchActivity).toHaveBeenCalledWith('fresh-token', '999');
    expect(mockFetchStreams).toHaveBeenCalledWith('fresh-token', '999');

    const update = getUpdate()!;
    expect(update.streams).not.toBeNull();
    expect(update.route).not.toBeNull(); // routeFromLatLng picked up the GPS stream
    expect(update.laps).toEqual([{ average_heartrate: 150 }]);
    expect(update.suffer_score).toBe(83); // rounded
    // Stale v → recomputed, and lands on the CURRENT version.
    expect((update.stream_summary as { quality?: { v?: number } })?.quality?.v).toBe(STREAM_SUMMARY_VERSION);
    expect(update.route_simplified).not.toBeNull();
    expect(update.hr_load).not.toBeNull();

    if (result.ok) {
      expect(result.activity.streams).not.toBeNull();
    }
  });

  it('purged row with an ALREADY-CURRENT summary version: repopulates raw columns but does NOT recompute stream_summary/route_simplified/hr_load', async () => {
    const { admin, getUpdate } = makeAdmin({
      activitiesRow: {
        ...BASE_ROW,
        streams: null,
        stream_summary: { quality: { v: STREAM_SUMMARY_VERSION } },
      },
      connRow: ACTIVE_CONN,
    });
    mockEnsureFreshAccessToken.mockResolvedValueOnce('fresh-token');
    mockFetchActivity.mockResolvedValueOnce({ id: 999, laps: null, map: { summary_polyline: null } });
    mockFetchStreams.mockResolvedValueOnce(rawSteady(8000, 2400, 400) as never);

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result.ok).toBe(true);
    const update = getUpdate()!;
    expect(update.streams).not.toBeNull();
    expect('stream_summary' in update).toBe(false);
    expect('route_simplified' in update).toBe(false);
    expect('hr_load' in update).toBe(false);
    // No stale summary → no quality-floor / plan lookups needed.
    expect(mockFetchQualityInputs).not.toHaveBeenCalled();
    expect(mockFetchPlanQualityForDate).not.toHaveBeenCalled();
  });

  it('Strava genuinely has no streams for this activity (404 → null): NOT an error, streams stay null', async () => {
    const { admin, getUpdate } = makeAdmin({
      activitiesRow: { ...BASE_ROW, streams: null, stream_summary: null },
      connRow: ACTIVE_CONN,
    });
    mockEnsureFreshAccessToken.mockResolvedValueOnce('fresh-token');
    mockFetchActivity.mockResolvedValueOnce({ id: 999, laps: null, map: { summary_polyline: null } });
    mockFetchStreams.mockResolvedValueOnce(null); // fetchStreams' documented terminal "no streams" outcome

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result.ok).toBe(true);
    const update = getUpdate()!;
    expect(update.streams).toBeNull();
    // Still recomputes (stale/absent summary) — computeStreamSummary(null, …) is null too.
    expect(update.stream_summary).toBeNull();
  });

  it('no active Strava connection → graceful not_connected, never throws', async () => {
    const { admin } = makeAdmin({ activitiesRow: { ...BASE_ROW, streams: null }, connRow: null });

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result).toEqual({ ok: false, reason: 'not_connected', message: expect.any(String) });
    expect(mockEnsureFreshAccessToken).not.toHaveBeenCalled();
    expect(mockFetchActivity).not.toHaveBeenCalled();
  });

  it('revoked/invalid token grant → graceful not_connected, never throws', async () => {
    const { admin } = makeAdmin({ activitiesRow: { ...BASE_ROW, streams: null }, connRow: ACTIVE_CONN });
    mockEnsureFreshAccessToken.mockRejectedValueOnce(new Error('token refresh failed: 400 invalid_grant'));

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result).toEqual({ ok: false, reason: 'not_connected', message: expect.any(String) });
    expect(mockFetchActivity).not.toHaveBeenCalled();
  });

  it('a transient Strava error (5xx/network/rate-limit) → graceful strava_unavailable, never throws', async () => {
    const { admin } = makeAdmin({ activitiesRow: { ...BASE_ROW, streams: null }, connRow: ACTIVE_CONN });
    mockEnsureFreshAccessToken.mockResolvedValueOnce('fresh-token');
    mockFetchActivity.mockRejectedValueOnce(new Error('Strava fetchActivity failed: 429 rate limited'));

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result).toEqual({ ok: false, reason: 'strava_unavailable', message: expect.any(String) });
  });

  it('manual (non-Strava) rows are returned as-is — never attempt a Strava fetch', async () => {
    const { admin } = makeAdmin({
      activitiesRow: { ...BASE_ROW, source: 'manual', source_id: '', streams: null },
    });

    const result = await rehydrateActivity(admin, 'user-1', 'act-1');

    expect(result.ok).toBe(true);
    expect(mockEnsureFreshAccessToken).not.toHaveBeenCalled();
    expect(mockFetchActivity).not.toHaveBeenCalled();
  });
});
