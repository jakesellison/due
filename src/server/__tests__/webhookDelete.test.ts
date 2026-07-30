/**
 * The unsigned-delete guard (security audit P1).
 *
 * Strava webhooks carry no signature and athlete ids are public, so a `delete`
 * event is forgeable by anyone. The guard's whole job is to refuse to act on one
 * unless Strava ITSELF confirms the activity is gone. It previously caught every
 * error and read it as confirmation, so a rate limit, a 5xx, or an expired token
 * during verification destroyed the user's row — and since each forged event
 * costs a Strava API call, replaying them is a way to CAUSE the 429 that made the
 * guard fail open.
 */

import { StravaHttpError } from '../stravaError';

const fetchActivity = jest.fn();
const ensureFreshAccessToken = jest.fn();

jest.mock('../strava', () => ({
  fetchActivity: (...args: unknown[]) => fetchActivity(...args),
}));

jest.mock('../ingest', () => ({
  ensureFreshAccessToken: (...args: unknown[]) => ensureFreshAccessToken(...args),
  deleteStravaActivity: jest.fn(),
  deleteAllStravaActivities: jest.fn(),
  deactivateConnection: jest.fn(),
  getConnectionByAthlete: jest.fn(),
  ingestStravaActivity: jest.fn(),
}));

// Imported after the mocks so the module picks them up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { activityDeletionVerdict } = require('../../../api/strava/webhook') as {
  activityDeletionVerdict: (
    admin: unknown,
    conn: unknown,
    id: string | number,
  ) => Promise<'gone' | 'exists' | 'unknown'>;
};

const CONN = { user_id: 'u1', access_token: 'a', refresh_token: 'r', expires_at: '2030-01-01T00:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  ensureFreshAccessToken.mockResolvedValue('token');
});

describe('activityDeletionVerdict', () => {
  it('says `gone` only when Strava answers 404', async () => {
    fetchActivity.mockRejectedValue(new StravaHttpError('activity', 404, 'not found'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('gone');
  });

  it('says `gone` for 410 as well', async () => {
    fetchActivity.mockRejectedValue(new StravaHttpError('activity', 410, 'gone'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('gone');
  });

  it('says `exists` when the activity is still fetchable (the event lied)', async () => {
    fetchActivity.mockResolvedValue({ id: 1 });
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('exists');
  });

  it('says `unknown` on a RATE LIMIT — never `gone`', async () => {
    fetchActivity.mockRejectedValue(new StravaHttpError('activity', 429, 'rate limited'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('unknown');
  });

  it('says `unknown` on a 5xx', async () => {
    fetchActivity.mockRejectedValue(new StravaHttpError('activity', 503, 'unavailable'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('unknown');
  });

  it('says `unknown` on a 401 (token no longer valid)', async () => {
    fetchActivity.mockRejectedValue(new StravaHttpError('activity', 401, 'unauthorized'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('unknown');
  });

  it('says `unknown` when the token refresh itself fails', async () => {
    ensureFreshAccessToken.mockRejectedValue(new Error('network down'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('unknown');
    expect(fetchActivity).not.toHaveBeenCalled();
  });

  it('says `unknown` on a bare network error with no status', async () => {
    fetchActivity.mockRejectedValue(new TypeError('fetch failed'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('unknown');
  });

  it('does not treat an error whose TEXT contains 404 as confirmation', async () => {
    // The old classifiers regex-matched status digits out of message strings.
    // Only a real status may authorize a delete.
    fetchActivity.mockRejectedValue(new Error('activity 404 something went wrong'));
    expect(await activityDeletionVerdict({}, CONN, '1')).toBe('unknown');
  });
});
