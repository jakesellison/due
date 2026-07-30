import type { ApiRequest, ApiResponse } from '../httpTypes';

// The callback handler lives in `api/`, outside this jest project's roots, but
// it imports only from `src/server`, so ts-jest resolves it fine. We mock its
// server-lib collaborators to exercise the scope/error handling in isolation.
jest.mock('../strava', () => ({
  exchangeCodeForToken: jest.fn(),
}));
jest.mock('../env', () => ({
  getEnv: jest.fn(() => ({ stravaStateSecret: 'secret' })),
}));
jest.mock('../state', () => ({
  verifyState: jest.fn(() => 'user-1'),
}));
jest.mock('../supabaseAdmin', () => ({
  createAdminClient: jest.fn(),
}));

import handler from '../../../api/strava/callback';
import { exchangeCodeForToken } from '../strava';
import { createAdminClient } from '../supabaseAdmin';

const mockExchange = exchangeCodeForToken as jest.MockedFunction<typeof exchangeCodeForToken>;
const mockCreateAdmin = createAdminClient as jest.MockedFunction<typeof createAdminClient>;

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
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

function makeReq(query: Record<string, string | undefined>): ApiRequest {
  return { method: 'GET', headers: {}, query };
}

describe('strava callback', () => {
  beforeEach(() => {
    mockExchange.mockReset();
    mockCreateAdmin.mockReset();
  });

  it('rejects a denied (error param) callback without writing a connection', async () => {
    const res = makeRes();
    await handler(
      makeReq({ error: 'access_denied', error_description: 'user denied', state: 's' }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('stores the actual granted scope (not a hardcoded one)', async () => {
    mockExchange.mockResolvedValueOnce({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: '2030-01-01T00:00:00Z',
      athleteId: 555,
    });
    const upsert = jest.fn(
      async (_row: { scope: string | null; status: string }) => ({ error: null }),
    );
    mockCreateAdmin.mockReturnValueOnce({
      from: jest.fn(() => ({ upsert })),
    } as never);

    const res = makeRes();
    // User deselected activity:read_all on the consent screen.
    await handler(makeReq({ code: 'c', state: 's', scope: 'read' }), res);

    expect(res.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const row = upsert.mock.calls[0]![0];
    expect(row.scope).toBe('read');
    expect(row.status).toBe('active');
  });
});
