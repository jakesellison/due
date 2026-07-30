import * as Sentry from '@sentry/node';

/**
 * Minimal Sentry wiring for the API (audit-ops B3). `SENTRY_DSN` is OPTIONAL —
 * absent means reporting is disabled everywhere in this module; nothing here
 * may ever throw, since `captureError` is called from the same top-level
 * catch blocks that are the last line of defense before a 500 response.
 */

let initialized = false;

/**
 * Initializes the server Sentry client once, at process boot. No-op if
 * `SENTRY_DSN` isn't set (dev/local by default has no server DSN wired).
 * `tracesSampleRate: 0` — errors only, no perf/tracing overhead.
 */
export function initServerSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      // One project serves every deploy; environment keeps prod alert rules
      // clean of any future local/staging runs that carry a DSN.
      environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
      // Cloud Run stamps the serving revision (e.g. due-api-00038-jgc) — free
      // release tagging so regressions pin to a deploy.
      release: process.env.K_REVISION,
    });
  } catch {
    // Reporting must never prevent the server from starting.
  }
}

/**
 * Reports an error to Sentry, tagged with optional context (route name, ids,
 * etc). No-op if `SENTRY_DSN` isn't set. Cloud Run does not guarantee CPU is
 * allocated once a response has been sent (it's not configured with
 * "CPU always allocated" here), so the default transport's background drain
 * between requests isn't reliable — this awaits a short, bounded
 * `Sentry.flush()` before returning so the event has actually left the
 * process while the request's own CPU allocation is still active. Call sites
 * are exclusively top-level catch blocks already on the slow/error path, so
 * the bounded wait adds no latency to the happy path.
 */
export async function captureError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
    await Sentry.flush(2000);
  } catch {
    // Never let reporting failure break the caller's error path.
  }
}
