/**
 * The claim endpoint's RESPONSE CONTRACT.
 *
 * Mutation audit 2026-07-30: turning the rejection 404 into an empty 200
 * survived the whole suite — `claimToken`'s logic was tested, the HTTP
 * contract the app depends on was not. The client keys on `res.ok` and
 * `tokenHash`; these pin both directions plus the input guard, so the
 * endpoint can't silently change shape under either side.
 */

const claimToken = jest.fn();
jest.mock('../authHandoff', () => ({
  claimToken: (...args: unknown[]) => claimToken(...args),
}));
jest.mock('../supabaseAdmin', () => ({ createAdminClient: () => ({}) }));
jest.mock('../rateLimit', () => ({ rateLimit: () => true }));
jest.mock('../report', () => ({ captureError: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../api/strava/auth-claim').default as (req: unknown, res: unknown) => Promise<void>;

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return res;
}

const req = (body: unknown) => ({ method: 'POST', body, headers: {}, query: {} });

beforeEach(() => jest.clearAllMocks());

test('a rejected claim is a 404 whose body carries only the generic error', async () => {
  claimToken.mockResolvedValue({ ok: false, reason: 'not_found' });
  const res = makeRes();
  await handler(req({ handoff: 'H', ticket: 'T' }), res);
  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({ error: 'No session to claim' });
});

test('not_ready is indistinguishable from not_found on the wire', async () => {
  claimToken.mockResolvedValue({ ok: false, reason: 'not_ready' });
  const res = makeRes();
  await handler(req({ handoff: 'H', ticket: 'T' }), res);
  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({ error: 'No session to claim' });
});

test('a successful claim returns 200 with exactly { tokenHash }', async () => {
  claimToken.mockResolvedValue({ ok: true, tokenHash: 'th-1' });
  const res = makeRes();
  await handler(req({ handoff: 'H', ticket: 'T' }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ tokenHash: 'th-1' });
});

test('missing ticket is a 400 and never reaches claimToken', async () => {
  const res = makeRes();
  await handler(req({ handoff: 'H' }), res);
  expect(res.statusCode).toBe(400);
  expect(claimToken).not.toHaveBeenCalled();
});

test('non-string secrets are rejected, not coerced', async () => {
  const res = makeRes();
  await handler(req({ handoff: 42, ticket: ['T'] }), res);
  expect(res.statusCode).toBe(400);
  expect(claimToken).not.toHaveBeenCalled();
});
