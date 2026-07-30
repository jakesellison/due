/**
 * `src/app-lib/sentry.ts` must never throw, even when
 * `require('@sentry/react-native')` itself throws — e.g. the ESM-only main
 * entry Jest can't transform, or (in real app boot) a dev-client built before
 * the Expo config plugin rebuild (audit-ops B3 follow-up / fix-E review).
 *
 * `jest.setup.app.js` globally mocks `@sentry/react-native` with a working
 * stub so the rest of the app-project suite can run headlessly; this file
 * overrides that mock for itself so the require() throws, and sets a truthy
 * DSN first — `initSentry`/`captureException` return before ever calling
 * `require` when no DSN is configured, so the throwing path is only exercised
 * once a DSN is present.
 */

describe('sentry.ts — defensive against a throwing @sentry/react-native require', () => {
  const ORIGINAL_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

  afterEach(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
    jest.dontMock('@sentry/react-native');
  });

  it('initSentry() and captureException() no-op instead of throwing', () => {
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => {
      throw new Error('simulated ESM parse / missing native module failure');
    });
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/1';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initSentry, captureException } = require('@/app-lib/sentry');

    expect(() => initSentry()).not.toThrow();
    expect(() => captureException(new Error('boom'), { where: 'test' })).not.toThrow();
    // A second call exercises the already-`loadAttempted`/cached-null path too.
    expect(() => captureException(new Error('again'))).not.toThrow();
  });
});
