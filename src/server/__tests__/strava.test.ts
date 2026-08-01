import { authorizeUrl, fetchStreams, hasStravaScope } from '../strava';

/**
 * authorizeUrl is pure but reads STRAVA_CLIENT_ID via getEnv(), which validates
 * all required env vars. Populate a full fake env before each test.
 */
const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  STRAVA_CLIENT_ID: '123456',
  STRAVA_CLIENT_SECRET: 'client-secret',
  STRAVA_WEBHOOK_VERIFY_TOKEN: 'verify-token',
  STRAVA_STATE_SECRET: 'state-secret',
  APP_BASE_URL: 'https://mileage.app',
};

describe('authorizeUrl', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] = v;
  });
  afterEach(() => {
    for (const k of Object.keys(FAKE_ENV)) delete process.env[k];
  });

  it('builds an authorize URL with client_id, scope, encoded redirect_uri and state', () => {
    const redirectUri = 'https://mileage.app/api/strava/callback';
    const url = authorizeUrl('user-abc-123', redirectUri);
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('123456');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    // Scope minimization: the default grant is READ-ONLY — activity:write is
    // never part of a plain connect.
    expect(parsed.searchParams.get('scope')).toBe('read,activity:read_all');
    expect(parsed.searchParams.get('state')).toBe('user-abc-123');
    // redirect_uri round-trips through URLSearchParams (i.e. was encoded).
    expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
    // Raw query string must contain a percent-encoded redirect_uri.
    expect(url).toContain('redirect_uri=https%3A%2F%2Fmileage.app%2Fapi%2Fstrava%2Fcallback');
  });

  it('adds activity:write ONLY on an explicit write escalation', () => {
    const redirectUri = 'https://mileage.app/api/strava/callback';
    const url = authorizeUrl('user-abc-123', redirectUri, { write: true });
    expect(new URL(url).searchParams.get('scope')).toBe('read,activity:read_all,activity:write');
  });
});

describe('hasStravaScope', () => {
  it('matches exact comma-separated grants and tolerates callback whitespace', () => {
    expect(hasStravaScope('read, activity:read_all,activity:write', 'activity:write')).toBe(true);
    expect(hasStravaScope('read,activity:read_all', 'activity:write')).toBe(false);
    expect(hasStravaScope(null, 'activity:write')).toBe(false);
  });
});

describe('fetchStreams — transient failures must NOT be swallowed to null', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const mockFetch = (init: { ok: boolean; status: number; json?: () => Promise<unknown> }) => {
    global.fetch = (() => Promise.resolve(init as unknown as Response)) as typeof fetch;
  };

  it('returns the stream object on 200', async () => {
    const body = { distance: { data: [0, 1, 2] } };
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve(body) });
    await expect(fetchStreams('tok', 1)).resolves.toEqual(body);
  });

  it('returns null on 404 (activity genuinely has no streams — terminal)', async () => {
    mockFetch({ ok: false, status: 404 });
    await expect(fetchStreams('tok', 1)).resolves.toBeNull();
  });

  it('THROWS a 429 (rate limit) so the caller backs off unstamped', async () => {
    mockFetch({ ok: false, status: 429 });
    await expect(fetchStreams('tok', 1)).rejects.toThrow(/429/);
  });

  it('THROWS a 500 (transient) so the caller retries unstamped', async () => {
    mockFetch({ ok: false, status: 500 });
    await expect(fetchStreams('tok', 1)).rejects.toThrow(/500/);
  });

  it('propagates a network error (does not swallow to null)', async () => {
    global.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    await expect(fetchStreams('tok', 1)).rejects.toThrow(/network down/);
  });
});

describe('retryAfterSeconds — 429 back-off from the response itself', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { retryAfterSeconds } = require('../strava') as typeof import('../strava');
  const resp = (status: number, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  });

  afterEach(() => jest.restoreAllMocks());

  it('is undefined for non-429 responses', () => {
    expect(retryAfterSeconds(resp(500))).toBeUndefined();
    expect(retryAfterSeconds(resp(200))).toBeUndefined();
  });

  it('honors a standard Retry-After header first', () => {
    expect(retryAfterSeconds(resp(429, { 'retry-after': '120' }))).toBe(120);
  });

  it('backs off to the next quarter-hour boundary when only the short window blew', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000 * 900 * 1000 + 100_000); // 100s into a window
    expect(
      retryAfterSeconds(resp(429, { 'x-ratelimit-limit': '600,30000', 'x-ratelimit-usage': '601,900' })),
    ).toBe(900 - 100 + 5);
  });

  it('backs off to the next UTC midnight when the DAILY budget blew but the short window did not', () => {
    const nowS = 86_400 * 20_000 + 3_600; // 01:00 UTC
    jest.spyOn(Date, 'now').mockReturnValue(nowS * 1000);
    expect(
      retryAfterSeconds(resp(429, { 'x-ratelimit-limit': '600,30000', 'x-ratelimit-usage': '10,30001' })),
    ).toBe(86_400 - 3_600 + 5);
  });

  it('never crashes on a headerless 429 — falls back to the quarter-hour window', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000 * 900 * 1000 + 100_000);
    expect(retryAfterSeconds({ status: 429 })).toBe(900 - 100 + 5);
  });
});
