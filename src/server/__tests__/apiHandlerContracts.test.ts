/**
 * HTTP contracts for the thin api/ handlers (test-audit gap #2).
 *
 * The mutation audit's lesson, applied across the layer: `src/server` logic is
 * well tested, but the handlers CONSUMING it are the actual wire contract the
 * app depends on — and both mutation survivors lived exactly there. These pin,
 * for every destructive or auth-gated route: the method gate, the auth gate
 * (an unauthenticated caller gets 401 and the underlying operation is NEVER
 * invoked), the success shape, and the generic-500 error posture (details go
 * to captureError, never to the client).
 */

const requireUser = jest.fn();
const methodAllowed = jest.fn();
jest.mock('../apiAuth', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  methodAllowed: (...a: unknown[]) => methodAllowed(...a),
}));

const authUser = jest.fn();
const providerStatuses = jest.fn();
jest.mock('../sync', () => ({
  authUser: (...a: unknown[]) => authUser(...a),
  providerStatuses: (...a: unknown[]) => providerStatuses(...a),
}));

const deleteAccount = jest.fn();
jest.mock('../accountDeletion', () => ({ deleteAccount: (...a: unknown[]) => deleteAccount(...a) }));

const revokeStravaConnection = jest.fn();
jest.mock('../ingest', () => ({ revokeStravaConnection: (...a: unknown[]) => revokeStravaConnection(...a) }));

jest.mock('../supabaseAdmin', () => ({ createAdminClient: () => ({}) }));
jest.mock('../report', () => ({ captureError: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const accountDelete = require('../../../api/account/delete').default;
const stravaDisconnect = require('../../../api/strava/disconnect').default;
const syncStatus = require('../../../api/sync/status').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function makeRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
}
const post = { method: 'POST', body: {}, headers: {}, query: {} };
const get = { method: 'GET', body: {}, headers: {}, query: {} };

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the gates pass; individual tests close them.
  methodAllowed.mockReturnValue(true);
  requireUser.mockResolvedValue('user-1');
  authUser.mockResolvedValue('user-1');
});

describe('POST /api/account/delete — the most destructive route there is', () => {
  it('an unauthenticated caller never reaches deleteAccount', async () => {
    requireUser.mockImplementation(async (_req, res) => { res.status(401).json({ error: 'Unauthorized' }); return null; });
    const res = makeRes();
    await accountDelete(post, res);
    expect(res.statusCode).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes exactly the AUTHENTICATED user — no body-supplied target', async () => {
    const res = makeRes();
    await accountDelete({ ...post, body: { userId: 'someone-else' } }, res);
    expect(deleteAccount).toHaveBeenCalledWith({}, 'user-1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('a failure is a generic 500 — internals never reach the client', async () => {
    deleteAccount.mockRejectedValue(new Error('users table row lock timeout on shard 7'));
    const res = makeRes();
    await accountDelete(post, res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('shard');
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('a blocked method never reaches the auth check or the delete', async () => {
    methodAllowed.mockImplementation((_req, res) => { res.status(405).json({ error: 'Method not allowed' }); return false; });
    const res = makeRes();
    await accountDelete({ ...post, method: 'GET' }, res);
    expect(requireUser).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});

describe('POST /api/strava/disconnect', () => {
  it('unauthenticated → revoke never invoked', async () => {
    requireUser.mockImplementation(async (_req, res) => { res.status(401).json({ error: 'Unauthorized' }); return null; });
    const res = makeRes();
    await stravaDisconnect(post, res);
    expect(res.statusCode).toBe(401);
    expect(revokeStravaConnection).not.toHaveBeenCalled();
  });

  it('revokes for the authenticated user and answers { disconnected: true }', async () => {
    const res = makeRes();
    await stravaDisconnect(post, res);
    expect(revokeStravaConnection).toHaveBeenCalledWith({}, 'user-1');
    expect(res.body).toEqual({ disconnected: true });
    expect(res.statusCode).toBe(200);
  });

  it('failure is a generic 500', async () => {
    revokeStravaConnection.mockRejectedValue(new Error('strava 500'));
    const res = makeRes();
    await stravaDisconnect(post, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /api/sync/status', () => {
  it('rejects non-GET with 405 before auth', async () => {
    const res = makeRes();
    await syncStatus(post, res);
    expect(res.statusCode).toBe(405);
    expect(authUser).not.toHaveBeenCalled();
  });

  it('returns the provider list for the authenticated user', async () => {
    providerStatuses.mockResolvedValue([{ provider: 'strava', status: 'active' }]);
    const res = makeRes();
    await syncStatus(get, res);
    expect(providerStatuses).toHaveBeenCalledWith({}, 'user-1');
    expect(res.body).toEqual({ providers: [{ provider: 'strava', status: 'active' }] });
  });

  it('unauthenticated → provider query never runs', async () => {
    authUser.mockImplementation(async (_req, res) => { res.status(401).json({ error: 'Unauthorized' }); return null; });
    const res = makeRes();
    await syncStatus(get, res);
    expect(res.statusCode).toBe(401);
    expect(providerStatuses).not.toHaveBeenCalled();
  });
});
