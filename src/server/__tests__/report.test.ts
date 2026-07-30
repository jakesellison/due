const initMock = jest.fn();
const captureExceptionMock = jest.fn();
const flushMock = jest.fn().mockResolvedValue(true);

jest.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => initMock(...args),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  flush: (...args: unknown[]) => flushMock(...args),
}));

describe('server/report captureError (audit-ops B3)', () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it('is a no-op when SENTRY_DSN is not set', async () => {
    delete process.env.SENTRY_DSN;
    const { captureError } = require('../report');

    await captureError(new Error('boom'), { route: 'test' });

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(flushMock).not.toHaveBeenCalled();
  });

  it('reports and flushes when SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1';
    const { captureError } = require('../report');
    const err = new Error('boom');

    await captureError(err, { route: 'test' });

    expect(captureExceptionMock).toHaveBeenCalledWith(err, { extra: { route: 'test' } });
    expect(flushMock).toHaveBeenCalledWith(2000);
  });

  it('never throws even if the Sentry SDK itself throws', async () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1';
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('sdk exploded');
    });
    const { captureError } = require('../report');

    await expect(captureError(new Error('boom'))).resolves.toBeUndefined();
  });

  it('initServerSentry only calls Sentry.init when SENTRY_DSN is set, and is idempotent', () => {
    delete process.env.SENTRY_DSN;
    const { initServerSentry: initWithoutDsn } = require('../report');
    initWithoutDsn();
    expect(initMock).not.toHaveBeenCalled();

    jest.resetModules();
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1';
    const { initServerSentry: initWithDsn } = require('../report');
    initWithDsn();
    initWithDsn();
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith({
      dsn: 'https://example.ingest.sentry.io/1',
      tracesSampleRate: 0,
      environment: 'production',
      release: undefined,
    });
  });

  it('initServerSentry never throws even if Sentry.init throws', () => {
    process.env.SENTRY_DSN = 'https://example.ingest.sentry.io/1';
    initMock.mockImplementationOnce(() => {
      throw new Error('sdk init exploded');
    });
    const { initServerSentry } = require('../report');
    expect(() => initServerSentry()).not.toThrow();
  });
});
