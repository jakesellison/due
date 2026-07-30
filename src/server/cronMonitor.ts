import * as Sentry from '@sentry/node';

/**
 * Sentry Cron Monitor wrapper — the "one alerting pane" for scheduled jobs.
 *
 * `Sentry.withMonitor` sends in_progress/ok/error check-ins around `fn`, and
 * the attached schedule lets Sentry alert on a MISSED run — the failure mode
 * the Cloud Monitoring log alert structurally can't see (a paused/deleted
 * scheduler job produces no log line at all). A thrown `fn` records an error
 * check-in and rethrows for the caller's own error path.
 *
 * No DSN → plain passthrough. The bounded flush mirrors `captureError`'s:
 * Cloud Run gives no CPU guarantee after the response is sent, so check-ins
 * must leave the process while the request is still live. Never throws from
 * the monitoring itself.
 */
export async function withCronMonitor<T>(
  slug: string,
  crontab: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!process.env.SENTRY_DSN) return fn();
  try {
    return await Sentry.withMonitor(slug, fn, {
      schedule: { type: 'crontab', value: crontab },
      checkinMargin: 60, // minutes late before Sentry flags a missed run
      maxRuntime: 10, // minutes before an unfinished run counts as failed
      timezone: 'Etc/UTC',
    });
  } finally {
    await Sentry.flush(2000).catch(() => undefined);
  }
}
