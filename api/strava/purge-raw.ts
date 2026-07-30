import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { authorizeCron, SCHEDULER_SA_ENVS } from '../../src/server/cronAuth';
import { methodAllowed } from '../../src/server/apiAuth';
import { withCronMonitor } from '../../src/server/cronMonitor';

/** MUST match the Cloud Scheduler job's schedule (infra/terraform dev.tfvars
 *  `purge_schedule`) — Sentry uses it to alert on a MISSED run, the one
 *  failure the GCP log alert can't see (paused/deleted job = no log line). */
const PURGE_CRONTAB = '0 8 * * *';

/**
 * GET /api/strava/purge-raw  (cron target)
 *
 * Enforces Strava API Policy §6.2 (raw Strava Data is a ≤7-day transient
 * cache — see `docs/superpowers/specs/2026-07-17-strava-7day-compliance-design.md`).
 * Nulls the raw columns (`raw`, `streams`, `route`, `laps`, `suffer_score`) on
 * any `activities` row older than 6 days (by `start_date`) whose durable
 * summary has already been computed — the row itself is kept, only the raw
 * payload is cleared. The 6-day cutoff is one day inside the §6.2 7-day limit
 * so the DAILY cron never lets a row reach ~8 days (7d + wait for next run).
 *
 * AUTH — FAIL-CLOSED, this drives admin-client writes. The ONLY accepted
 * credential is a Google-signed OIDC token minted by the Cloud Scheduler job
 * for its service account (verified against `PURGE_OIDC_AUDIENCE` +
 * `PURGE_SCHEDULER_SA`). There is deliberately NO shared-secret path — this is
 * an internet-reachable endpoint, so a static secret would be a standing
 * attack surface; a short-lived, signature-verified token is not. If OIDC is
 * not configured the endpoint disables itself (503) rather than leaving an
 * admin-write open. Failures are surfaced by a Cloud Monitoring alert on the
 * scheduler job (there is no manual fallback to fall back to).
 *
 * The WHERE clause here is the SQL mirror of `shouldPurgeRaw`
 * (`src/lib/strava/derive.ts`) — that predicate is the single source of
 * truth for the purge rule (incl. the 6-day window); keep the two in sync.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['GET', 'POST'])) return;

  const auth = await authorizeCron(req, {
    audienceEnv: 'PURGE_OIDC_AUDIENCE',
    serviceAccountEnvs: SCHEDULER_SA_ENVS,
  });
  if (auth === 'unconfigured') {
    res.status(503).json({ error: 'Purge auth not configured' });
    return;
  }
  if (auth === 'unauthorized') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const purged = await withCronMonitor('due-strava-purge-raw', PURGE_CRONTAB, async () => {
      const admin = createAdminClient();
      const cutoff = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

      const { error, count } = await admin
        .from('activities')
        .update(
          { raw: null, streams: null, route: null, laps: null, suffer_score: null },
          { count: 'exact' },
        )
        .eq('source', 'strava')
        .lt('start_date', cutoff)
        .not('enriched_at', 'is', null)
        .not('raw', 'is', null)
        // Fail-safe against running the purge before the one-time derived backfill:
        // never null a GPS run's raw data until its durable `route_simplified` trace
        // exists, or that trace is unrecoverable (permanent Routes-carousel loss).
        // No-GPS rows (`route` already null) are unaffected and still purge. After the
        // backfill has populated every row, this filter is a no-op.
        .or('route_simplified.not.is.null,route.is.null');

      if (error) throw error;
      return count ?? 0;
    });

    res.status(200).json({ purged });
  } catch (error) {
    console.error('strava/purge-raw update failed:', error);
    await captureError(error, { route: 'strava/purge-raw' });
    res.status(500).json({ error: 'Internal server error' });
  }
}
