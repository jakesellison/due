/**
 * The unsigned-DEAUTHORIZATION guard (overnight security audit, critical).
 *
 * Sibling of `webhookDelete.test.ts`, for the branch that guard's design was
 * never extended to. `delete` destroys one activity and was verified against
 * Strava; the athlete `deauthorize` branch destroys EVERY Strava row the user
 * has and was verified against nothing — so one unauthenticated POST carrying a
 * public athlete id and `updates:{authorized:'false'}` wiped their history.
 *
 * The probe is a TOKEN REFRESH rather than an activity fetch because a
 * deauthorization revokes the GRANT, and an unexpired access token can still
 * fetch for a short window after revocation. Strava rotates refresh tokens, so
 * a successful probe must persist the renewed pair — otherwise proving the
 * connection is alive would itself break it.
 */

import { StravaHttpError } from '../stravaError';

const refreshAccessToken = jest.fn();
const persistRefreshedToken = jest.fn();

jest.mock('../strava', () => ({
  refreshAccessToken: (...args: unknown[]) => refreshAccessToken(...args),
  fetchActivity: jest.fn(),
}));

jest.mock('../ingest', () => ({
  persistRefreshedToken: (...args: unknown[]) => persistRefreshedToken(...args),
  // The real classifier — the verdict's correctness depends on it, so mocking
  // it would test nothing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  isRevokedTokenError: jest.requireActual('../ingest').isRevokedTokenError,
  ensureFreshAccessToken: jest.fn(),
  deleteStravaActivity: jest.fn(),
  deleteAllStravaActivities: jest.fn(),
  deactivateConnection: jest.fn(),
  getConnectionByAthlete: jest.fn(),
  ingestStravaActivity: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deauthorizationVerdict, parseStravaEvent } = require('../../../api/strava/webhook') as {
  deauthorizationVerdict: (admin: unknown, conn: unknown) => Promise<'revoked' | 'active' | 'unknown'>;
  parseStravaEvent: (body: unknown) => { object_id?: number | string } | null;
};

const CONN = { user_id: 'u1', access_token: 'a', refresh_token: 'r', expires_at: '2030-01-01T00:00:00Z' };
const RENEWED = { accessToken: 'a2', refreshToken: 'r2', expiresAt: '2030-06-01T00:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deauthorizationVerdict', () => {
  it('says `revoked` when Strava rejects the refresh token with invalid_grant (400)', async () => {
    refreshAccessToken.mockRejectedValue(new StravaHttpError('token-refresh', 400, 'invalid_grant'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('revoked');
  });

  it('says `revoked` on a 401 from the refresh', async () => {
    refreshAccessToken.mockRejectedValue(new StravaHttpError('token-refresh', 401, 'unauthorized'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('revoked');
  });

  it('says `active` when the grant still refreshes — the forged event lied', async () => {
    refreshAccessToken.mockResolvedValue(RENEWED);
    expect(await deauthorizationVerdict({}, CONN)).toBe('active');
  });

  it('persists the rotated token pair on a successful probe', async () => {
    // Strava rotates refresh tokens; dropping the renewed pair would burn the
    // very connection the probe just proved healthy.
    refreshAccessToken.mockResolvedValue(RENEWED);
    await deauthorizationVerdict({ admin: true }, CONN);
    expect(persistRefreshedToken).toHaveBeenCalledWith({ admin: true }, 'u1', RENEWED);
  });

  it('says `unknown` on a RATE LIMIT — never `revoked`', async () => {
    // Each forged event costs a Strava call, so an attacker can drive us into a
    // 429; failing open here would hand them the wipe they were denied.
    refreshAccessToken.mockRejectedValue(new StravaHttpError('token-refresh', 429, 'rate limited'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('unknown');
  });

  it('says `unknown` on a 5xx', async () => {
    refreshAccessToken.mockRejectedValue(new StravaHttpError('token-refresh', 503, 'unavailable'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('unknown');
  });

  it('says `unknown` on a bare network error with no status', async () => {
    refreshAccessToken.mockRejectedValue(new TypeError('fetch failed'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('unknown');
  });

  it('does not read a 401 from a DIFFERENT operation as a revoked grant', async () => {
    refreshAccessToken.mockRejectedValue(new StravaHttpError('activity', 401, 'unauthorized'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('unknown');
  });

  it('says `unknown` when persisting the renewed token fails', async () => {
    refreshAccessToken.mockResolvedValue(RENEWED);
    persistRefreshedToken.mockRejectedValue(new Error('db down'));
    expect(await deauthorizationVerdict({}, CONN)).toBe('unknown');
  });
});

describe('parseStravaEvent id validation', () => {
  // These ids are interpolated into Strava API paths, and WHATWG URL resolves
  // dot segments — `.../activities/../../../oauth/deauthorize` retargets the
  // request while keeping the victim's bearer token attached.
  it('rejects a path-traversal object_id', () => {
    expect(parseStravaEvent({
      object_type: 'activity',
      aspect_type: 'create',
      owner_id: 123,
      object_id: '../../../oauth/deauthorize',
    })).toBeNull();
  });

  it('rejects a path-traversal owner_id', () => {
    expect(parseStravaEvent({
      object_type: 'activity',
      aspect_type: 'create',
      owner_id: '../athlete',
      object_id: 1,
    })).toBeNull();
  });

  it('rejects a non-numeric object_id on an athlete event', () => {
    const e = parseStravaEvent({
      object_type: 'athlete',
      aspect_type: 'update',
      owner_id: 123,
      object_id: '../x',
      updates: { authorized: 'false' },
    });
    expect(e?.object_id).toBeUndefined();
  });

  it('still accepts genuine numeric ids in both forms', () => {
    expect(parseStravaEvent({
      object_type: 'activity',
      aspect_type: 'create',
      owner_id: 123,
      object_id: '9876543210',
    })?.object_id).toBe('9876543210');
    expect(parseStravaEvent({
      object_type: 'activity',
      aspect_type: 'update',
      owner_id: '123',
      object_id: 456,
    })?.object_id).toBe(456);
  });

  it('rejects negative and fractional numeric ids', () => {
    expect(parseStravaEvent({ object_type: 'activity', aspect_type: 'create', owner_id: 1, object_id: -5 })).toBeNull();
    expect(parseStravaEvent({ object_type: 'activity', aspect_type: 'create', owner_id: 1, object_id: 1.5 })).toBeNull();
  });
});

// ── The GATING, not just the verdict ─────────────────────────────────────────
// Mutation audit 2026-07-30: deleting `if (verdict !== 'revoked') return` from
// processEvent survived the entire suite — the verdict function was tested, the
// guard consuming it was not. These pin the guard itself: the wipe fires on an
// affirmative revocation and on NOTHING else.

jest.mock('../supabaseAdmin', () => ({ createAdminClient: () => ({}) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processEvent } = require('../../../api/strava/webhook') as {
  processEvent: (event: unknown) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ingestMock = require('../ingest') as {
  getConnectionByAthlete: jest.Mock;
  deleteAllStravaActivities: jest.Mock;
  deactivateConnection: jest.Mock;
};

const DEAUTH_EVENT = {
  object_type: 'athlete', aspect_type: 'update', object_id: 7, owner_id: 7,
  updates: { authorized: 'false' },
};

describe('processEvent — deauthorization wipe gating', () => {
  beforeEach(() => {
    ingestMock.getConnectionByAthlete.mockResolvedValue({ ...CONN });
  });

  it('wipes history ONLY on an affirmative revocation (invalid_grant probe)', async () => {
    refreshAccessToken.mockRejectedValue(new StravaHttpError('token-refresh', 400, 'invalid_grant'));
    await processEvent(DEAUTH_EVENT);
    expect(ingestMock.deleteAllStravaActivities).toHaveBeenCalledWith({}, 'u1');
    expect(ingestMock.deactivateConnection).toHaveBeenCalledWith({}, 'u1');
  });

  it('a STILL-ACTIVE grant (probe succeeds) must not wipe anything', async () => {
    refreshAccessToken.mockResolvedValue(RENEWED);
    await processEvent(DEAUTH_EVENT);
    expect(ingestMock.deleteAllStravaActivities).not.toHaveBeenCalled();
    expect(ingestMock.deactivateConnection).not.toHaveBeenCalled();
  });

  it('an UNKNOWN verdict (Strava 5xx) must not wipe anything', async () => {
    refreshAccessToken.mockRejectedValue(new StravaHttpError('token-refresh', 503, 'unavailable'));
    await processEvent(DEAUTH_EVENT);
    expect(ingestMock.deleteAllStravaActivities).not.toHaveBeenCalled();
    expect(ingestMock.deactivateConnection).not.toHaveBeenCalled();
  });

  it('authorized:"true" (not a revocation) never probes or wipes', async () => {
    await processEvent({ ...DEAUTH_EVENT, updates: { authorized: 'true' } });
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(ingestMock.deleteAllStravaActivities).not.toHaveBeenCalled();
  });
});
