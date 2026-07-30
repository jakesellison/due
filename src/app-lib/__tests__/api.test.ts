/**
 * Tests for the shared client fetch resilience (`app` Jest project, jest-expo).
 *
 * `resilientFetch` adds an AbortController TIMEOUT and bounded backoff RETRY to
 * bare `fetch`. These guard the three contracts callers rely on:
 *  - a stalled request aborts at the timeout (so a screen never hangs forever),
 *  - a transient 5xx/network blip is retried (then succeeds) for idempotent calls,
 *  - a `retries: 0` call (the billable plan parse) does NOT auto-retry.
 *
 * `fetch` and timers are mocked so the assertions are deterministic.
 */
import { resilientFetch, TimeoutError } from '../api';

const okResponse = (body: unknown = {}): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as unknown as Response;

const serverError = (): Response =>
  ({ ok: false, status: 503, json: async () => ({}), text: async () => 'busy' }) as unknown as Response;

describe('resilientFetch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('aborts after the timeout and rejects with a TimeoutError', async () => {
    // fetch never resolves on its own; it only settles when the signal aborts.
    const fetchMock = jest.fn((_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = resilientFetch('https://x/test', { timeoutMs: 30_000, retries: 0 });
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    // Trip the AbortController timer.
    jest.advanceTimersByTime(30_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx then succeeds, with backoff between attempts', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValueOnce(serverError())
      .mockResolvedValueOnce(okResponse({ ok: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = resilientFetch('https://x/status', { retries: 2, backoffMs: 200 });
    // Let the first attempt resolve (5xx) and the backoff timer schedule.
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(200);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error then succeeds', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = resilientFetch('https://x/status', { retries: 2, backoffMs: 200 });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(200);
    const res = await pending;

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT auto-retry when retries is 0 (plan parse style)', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValue(serverError());
    global.fetch = fetchMock as unknown as typeof fetch;

    // A 5xx is returned to the caller (to read its body), not retried.
    const res = await resilientFetch('https://x/api/plan/parse', { retries: 0 });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
