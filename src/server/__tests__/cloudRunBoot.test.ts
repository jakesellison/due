/**
 * Boot-fatal path (audit-ops B3 follow-up / fix-E review): when required env is
 * missing, `start()` used to `console.error` + `process.exit(1)` with no crash
 * report — the ONE boot failure most worth seeing (a misconfigured deploy)
 * never got a second chance to report itself, and the process could be killed
 * before Sentry's background transport ever sent the event. `start()` must now
 * `captureError` and AWAIT its bounded flush before exiting.
 */

const mockCaptureError = jest.fn(async (_err: unknown, _ctx?: unknown) => undefined);
const mockInitServerSentry = jest.fn();
jest.mock('../report', () => ({
  initServerSentry: () => mockInitServerSentry(),
  captureError: (err: unknown, ctx?: unknown) => mockCaptureError(err, ctx),
}));

// Force getEnv() to throw regardless of the real process.env (required vars
// unset in the test environment already, but be explicit + robust).
jest.mock('../env', () => ({
  getEnv: () => {
    throw new Error('missing required env: SUPABASE_URL');
  },
}));

import { start } from '../cloudRun';

describe('start() boot-fatal path', () => {
  it('captures the error and awaits the flush BEFORE process.exit(1)', async () => {
    const order: string[] = [];
    mockCaptureError.mockImplementation(async () => {
      // Prove `start()` genuinely awaits this — if it didn't, `exit` below
      // would be pushed to `order` first.
      await Promise.resolve();
      order.push('captureError-flushed');
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      order.push('exit');
      return undefined as never;
    }) as never);

    await start();

    expect(order).toEqual(['captureError-flushed', 'exit']);
    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error), { boot: 'env-validation' });
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
