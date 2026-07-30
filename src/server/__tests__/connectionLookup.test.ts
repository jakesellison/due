import type { ApiRequest, ApiResponse } from '../httpTypes';

// Regression guard for the revoked-connection retry loop (Sentry DUE-API-1):
// sync-latest/backfill used to select the user's connection WITHOUT the
// status filter, so a revoked grant was retried with a dead refresh token on
// every app-open sync instead of answering 409 "Strava not connected". These
// tests drive both handlers through a mocked admin client and assert (a) the
// lookup filters status='active' and (b) a filtered-out (revoked) row → 409.
jest.mock('../supabaseAdmin', () => ({
  createAdminClient: jest.fn(),
}));
jest.mock('../report', () => ({
  captureError: jest.fn(async () => undefined),
}));
jest.mock('../env', () => ({
  getEnv: jest.fn(() => ({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
  })),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
  })),
}));

import syncLatestHandler from '../../../api/strava/sync-latest';
import backfillHandler from '../../../api/strava/backfill';
import { createAdminClient } from '../supabaseAdmin';

const mockCreateAdmin = createAdminClient as jest.MockedFunction<typeof createAdminClient>;

/**
 * Chain recorder for the connection lookup: `.from('integration_connections')
 * .select(...).eq(...).eq(...).eq(...).maybeSingle()`. Records every eq() pair
 * and resolves maybeSingle() to the given row (null = filtered out/absent).
 */
interface LookupChain {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
}

function stubConnectionLookup(row: unknown) {
  const eqCalls: Array<[string, unknown]> = [];
  const chain: LookupChain = {
    select: jest.fn((): LookupChain => chain),
    eq: jest.fn((col: string, val: unknown): LookupChain => {
      eqCalls.push([col, val]);
      return chain;
    }),
    maybeSingle: jest.fn(async () => ({ data: row, error: null })),
  };
  const from = jest.fn(() => chain);
  return { admin: { from } as never, eqCalls, from };
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

function makeReq(body: unknown): ApiRequest {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    query: {},
    body,
  } as ApiRequest;
}

describe.each([
  ['sync-latest', syncLatestHandler, {}],
  ['backfill', backfillHandler, { phase: 'summaries' }],
] as const)('strava %s connection lookup', (_name, handler, body) => {
  beforeEach(() => {
    mockCreateAdmin.mockReset();
  });

  it('filters the lookup to active connections only', async () => {
    const { admin, eqCalls } = stubConnectionLookup(null);
    mockCreateAdmin.mockReturnValue(admin);

    await handler(makeReq(body), makeRes());

    expect(eqCalls).toContainEqual(['status', 'active']);
    expect(eqCalls).toContainEqual(['provider', 'strava']);
    expect(eqCalls).toContainEqual(['user_id', 'user-1']);
  });

  it('answers 409 "Strava not connected" when no active row exists (revoked)', async () => {
    const { admin } = stubConnectionLookup(null);
    mockCreateAdmin.mockReturnValue(admin);

    const res = makeRes();
    await handler(makeReq(body), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Strava not connected' });
  });
});
