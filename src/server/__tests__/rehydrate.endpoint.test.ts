import type { ApiRequest, ApiResponse } from '../httpTypes';

// The handler lives in `api/`, outside this jest project's roots, but it
// imports only from `src/server`, so ts-jest resolves it fine (same pattern
// as `purge-raw.test.ts`). Mock the collaborators to exercise the request
// glue (auth guard, body validation, outcome passthrough, error capture) in
// isolation — `rehydrateActivity`'s own logic is covered by `rehydrate.test.ts`.
jest.mock('../supabaseAdmin', () => ({
  createAdminClient: jest.fn(),
}));
jest.mock('../sync', () => ({
  authUser: jest.fn(),
}));
jest.mock('../rehydrate', () => ({
  rehydrateActivity: jest.fn(),
}));
jest.mock('../report', () => ({
  captureError: jest.fn(async () => undefined),
}));

import handler from '../../../api/strava/rehydrate';
import { createAdminClient } from '../supabaseAdmin';
import { authUser } from '../sync';
import { rehydrateActivity } from '../rehydrate';
import { captureError } from '../report';

const mockCreateAdmin = createAdminClient as jest.MockedFunction<typeof createAdminClient>;
const mockAuthUser = authUser as jest.MockedFunction<typeof authUser>;
const mockRehydrate = rehydrateActivity as jest.MockedFunction<typeof rehydrateActivity>;
const mockCaptureError = captureError as jest.MockedFunction<typeof captureError>;

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

function makeReq(body: unknown, headers: Record<string, string | undefined> = { authorization: 'Bearer tok' }): ApiRequest {
  return { method: 'POST', headers, query: {}, body };
}

describe('POST /api/strava/rehydrate', () => {
  beforeEach(() => {
    mockCreateAdmin.mockReset();
    mockAuthUser.mockReset();
    mockRehydrate.mockReset();
    mockCaptureError.mockClear();
    mockCreateAdmin.mockReturnValue({ marker: 'admin' } as never);
  });

  it('rejects non-POST', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(mockAuthUser).not.toHaveBeenCalled();
  });

  it('delegates the bearer-token auth failure to authUser (already sent the response)', async () => {
    mockAuthUser.mockImplementationOnce(async (_req, res) => {
      res.status(401).json({ error: 'Invalid token' });
      return null;
    });
    const res = makeRes();
    await handler(makeReq({ activityId: 'a1' }), res);

    expect(res.statusCode).toBe(401);
    expect(mockRehydrate).not.toHaveBeenCalled();
  });

  it('400s on a missing/malformed activityId', async () => {
    mockAuthUser.mockResolvedValueOnce('user-1');
    const res = makeRes();
    await handler(makeReq({}), res);

    expect(res.statusCode).toBe(400);
    expect(mockRehydrate).not.toHaveBeenCalled();
  });

  it('passes the caller-scoped userId + activityId through and returns the outcome verbatim on success', async () => {
    mockAuthUser.mockResolvedValueOnce('user-1');
    mockRehydrate.mockResolvedValueOnce({ ok: true, activity: { id: 'a1' } as never });
    const res = makeRes();
    await handler(makeReq({ activityId: 'a1' }), res);

    expect(mockRehydrate).toHaveBeenCalledWith({ marker: 'admin' }, 'user-1', 'a1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, activity: { id: 'a1' } });
  });

  it('a NON-FATAL outcome (e.g. Strava disconnected) still returns 200 — the client degrades, no 500', async () => {
    mockAuthUser.mockResolvedValueOnce('user-1');
    mockRehydrate.mockResolvedValueOnce({ ok: false, reason: 'not_connected', message: 'no active Strava connection' });
    const res = makeRes();
    await handler(makeReq({ activityId: 'a1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: 'not_connected', message: 'no active Strava connection' });
  });

  it('a genuine internal error (rehydrateActivity throws) is captured and returns 500', async () => {
    mockAuthUser.mockResolvedValueOnce('user-1');
    mockRehydrate.mockRejectedValueOnce(new Error('boom'));
    const res = makeRes();
    await handler(makeReq({ activityId: 'a1' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(mockCaptureError).toHaveBeenCalled();
  });
});
