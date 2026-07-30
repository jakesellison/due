import type { ApiRequest, ApiResponse } from '../httpTypes';

jest.mock('../supabaseAdmin', () => ({ createAdminClient: jest.fn() }));
jest.mock('../report', () => ({ captureError: jest.fn(async () => undefined) }));
jest.mock('../env', () => ({
  getEnv: jest.fn(() => ({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
  })),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
  })),
}));

import handler from '../../../api/strava/status';
import { createAdminClient } from '../supabaseAdmin';

const mockCreateAdmin = createAdminClient as jest.MockedFunction<typeof createAdminClient>;

function chainFor(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };
  return chain;
}

function adminWithScope(scope: string | null) {
  return {
    from(table: string) {
      if (table === 'integration_connections') {
        return chainFor({ provider_athlete_id: 'athlete-1', status: 'active', scope });
      }
      if (table === 'activities') {
        return chainFor({ start_date: '2026-07-21T12:00:00Z' });
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as never;
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    send(body: unknown) { this.body = body; return this; },
    setHeader() { return this; },
    redirect() { return this; },
  };
  return res as unknown as ApiResponse & { statusCode: number; body: unknown };
}

const req = {
  method: 'GET',
  headers: { authorization: 'Bearer user-jwt' },
  query: {},
} as ApiRequest;

describe('GET /api/strava/status write capability', () => {
  it('reports writeAuthorized only when Strava granted activity:write', async () => {
    mockCreateAdmin.mockReturnValue(adminWithScope('read,activity:read_all,activity:write'));
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ connected: true, writeAuthorized: true }));
  });

  it('keeps a legacy read-only connection connected but marks write unavailable', async () => {
    mockCreateAdmin.mockReturnValue(adminWithScope('read,activity:read_all'));
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ connected: true, writeAuthorized: false }));
  });
});
