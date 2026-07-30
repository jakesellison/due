import type { ApiRequest, ApiResponse } from '../httpTypes';

// The handler lives in `api/`, outside this jest project's roots, but it
// imports only from `src/server`, so ts-jest resolves it fine (same pattern
// as `callback.test.ts`). We mock the admin-client collaborator to exercise
// auth + the update call shape in isolation — no live DB — and mock the OIDC
// verifier so auth outcomes are deterministic without minting real tokens.
jest.mock('../supabaseAdmin', () => ({
  createAdminClient: jest.fn(),
}));
jest.mock('../report', () => ({
  captureError: jest.fn(async () => undefined),
}));
jest.mock('../googleOidc', () => ({
  verifyGoogleOidcToken: jest.fn(async () => false),
}));

import handler from '../../../api/strava/purge-raw';
import { createAdminClient } from '../supabaseAdmin';
import { verifyGoogleOidcToken } from '../googleOidc';

const mockCreateAdmin = createAdminClient as jest.MockedFunction<typeof createAdminClient>;
const mockVerifyOidc = verifyGoogleOidcToken as jest.MockedFunction<typeof verifyGoogleOidcToken>;

/** A chain mock for the null-set update; the tail resolves to {error, count}. */
function stubUpdateChain(result: { error: unknown; count: number | null }) {
  const or = jest.fn(async (_filter: string) => result);
  const not2 = jest.fn((_col: string, _op: string, _val: null) => ({ or }));
  const not1 = jest.fn((_col: string, _op: string, _val: null) => ({ not: not2 }));
  const lt = jest.fn((_col: string, _val: string) => ({ not: not1 }));
  const eq = jest.fn((_col: string, _val: string) => ({ lt }));
  const update = jest.fn((_vals: unknown, _opts: unknown) => ({ eq }));
  const from = jest.fn((_table: string) => ({ update }));
  return { from, update, eq, lt, not1, not2, or };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader() {
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
    redirect() {
      return this;
    },
  };
  return res as unknown as ApiResponse & { statusCode: number; body: unknown };
}

function makeReq(headers: Record<string, string | undefined>): ApiRequest {
  return { method: 'GET', headers, query: {} };
}

const AUDIENCE = 'https://api.example/purge';
const SCHEDULER_SA = 'sched@proj.iam.gserviceaccount.com';

describe('strava purge-raw', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    mockCreateAdmin.mockReset();
    mockVerifyOidc.mockReset();
    mockVerifyOidc.mockResolvedValue(false);
    // OIDC is the only auth path; configure it by default.
    process.env = {
      ...OLD_ENV,
      PURGE_OIDC_AUDIENCE: AUDIENCE,
      PURGE_SCHEDULER_SA: SCHEDULER_SA,
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('rejects a request with no bearer token without touching the admin client', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);

    expect(res.statusCode).toBe(401);
    expect(mockVerifyOidc).not.toHaveBeenCalled();
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('rejects a token that fails OIDC verification', async () => {
    mockVerifyOidc.mockResolvedValueOnce(false);
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer forged.jwt' }), res);

    expect(res.statusCode).toBe(401);
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('does NOT accept a shared secret (no CRON_SECRET fallback)', async () => {
    // Even with CRON_SECRET set in the environment, a matching bearer must fail
    // — the endpoint has no secret path, only OIDC.
    process.env.CRON_SECRET = 'super-secret';
    mockVerifyOidc.mockResolvedValueOnce(false); // 'super-secret' is not a valid OIDC token
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer super-secret' }), res);

    expect(res.statusCode).toBe(401);
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('fails closed (503) when OIDC is not configured, even with a token present', async () => {
    delete process.env.PURGE_OIDC_AUDIENCE;
    delete process.env.PURGE_SCHEDULER_SA;
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer anything' }), res);

    expect(res.statusCode).toBe(503);
    expect(mockVerifyOidc).not.toHaveBeenCalled();
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('passes the configured audience + SA to the OIDC verifier', async () => {
    mockVerifyOidc.mockResolvedValueOnce(true);
    const chain = stubUpdateChain({ error: null, count: 0 });
    mockCreateAdmin.mockReturnValueOnce({ from: chain.from } as never);

    await handler(makeReq({ authorization: 'Bearer good.jwt' }), makeRes());

    expect(mockVerifyOidc).toHaveBeenCalledWith('good.jwt', {
      audience: AUDIENCE,
      serviceAccountEmail: SCHEDULER_SA,
    });
  });

  it('issues the null-set update with the 6-day/strava/enriched/raw filters and returns the count', async () => {
    mockVerifyOidc.mockResolvedValueOnce(true);
    const chain = stubUpdateChain({ error: null, count: 3 });
    mockCreateAdmin.mockReturnValueOnce({ from: chain.from } as never);

    const before = Date.now();
    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer good.jwt' }), res);
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ purged: 3 });

    expect(chain.from).toHaveBeenCalledWith('activities');
    expect(chain.update).toHaveBeenCalledWith(
      { raw: null, streams: null, route: null, laps: null, suffer_score: null },
      { count: 'exact' },
    );
    expect(chain.eq).toHaveBeenCalledWith('source', 'strava');
    expect(chain.not1).toHaveBeenCalledWith('enriched_at', 'is', null);
    expect(chain.not2).toHaveBeenCalledWith('raw', 'is', null);
    // Fail-safe guard: only null a GPS run's raw once route_simplified exists.
    expect(chain.or).toHaveBeenCalledWith('route_simplified.not.is.null,route.is.null');

    expect(chain.lt).toHaveBeenCalledTimes(1);
    const [col, cutoffIso] = chain.lt.mock.calls[0]!;
    expect(col).toBe('start_date');
    const cutoffMs = new Date(cutoffIso as string).getTime();
    const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
    // cutoff should be ~now - 6 days (one day inside the §6.2 limit), allowing
    // for test execution time.
    expect(cutoffMs).toBeGreaterThanOrEqual(before - sixDaysMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - sixDaysMs + 1000);
  });

  it('returns 500 and reports the error when the update fails', async () => {
    mockVerifyOidc.mockResolvedValueOnce(true);
    const chain = stubUpdateChain({ error: { message: 'boom' }, count: null });
    mockCreateAdmin.mockReturnValueOnce({ from: chain.from } as never);

    const res = makeRes();
    await handler(makeReq({ authorization: 'Bearer good.jwt' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
