import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { refreshAccessToken } from '../../src/server/strava';
import { deactivateConnection, isRevokedTokenError } from '../../src/server/ingest';
import { authorizeCron, SCHEDULER_SA_ENVS } from '../../src/server/cronAuth';
import { methodAllowed } from '../../src/server/apiAuth';
import { captureError } from '../../src/server/report';

/**
 * GET /api/strava/refresh  (cron target)
 *
 * Refreshes Strava tokens that expire within the next hour.
 *
 * AUTH — FAIL-CLOSED, Google-signed OIDC only, identical to `purge-raw`. This
 * previously accepted a static `CRON_SECRET` bearer compared with a plain
 * `!==`: not constant-time, and a permanent shared secret guarding
 * service-role writes on a publicly reachable URL. `purge-raw` had already
 * rejected that design in its own doc comment; the two crons now share
 * `authorizeCron`. If OIDC is unconfigured the endpoint disables itself (503)
 * rather than falling back to anything weaker.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['GET', 'POST'])) return;

  const auth = await authorizeCron(req, {
    audienceEnv: 'REFRESH_OIDC_AUDIENCE',
    serviceAccountEnvs: SCHEDULER_SA_ENVS,
  });
  if (auth === 'unconfigured') {
    res.status(503).json({ error: 'Refresh auth not configured' });
    return;
  }
  if (auth === 'unauthorized') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('integration_connections')
    .select('user_id, refresh_token, expires_at')
    .eq('provider', 'strava')
    .eq('status', 'active')
    .lte('expires_at', cutoff);

  if (error) {
    console.error('strava/refresh connection select failed:', error);
    await captureError(error, { route: 'strava/refresh' });
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  const rows = (data ?? []) as Array<{ user_id: string; refresh_token: string }>;
  let refreshed = 0;
  let failed = 0;
  let deactivated = 0;

  for (const row of rows) {
    try {
      const token = await refreshAccessToken(row.refresh_token);
      const { error: updateErr } = await admin
        .from('integration_connections')
        .update({
          access_token: token.accessToken,
          refresh_token: token.refreshToken,
          expires_at: token.expiresAt,
        })
        .eq('user_id', row.user_id)
        .eq('provider', 'strava');
      if (updateErr) throw new Error(updateErr.message);
      refreshed += 1;
    } catch (err) {
      console.error('Strava refresh failed for user', row.user_id, err);
      await captureError(err, { route: 'strava/refresh', userId: row.user_id });
      failed += 1;
      // Revoked/invalid grant: deactivate so the cron stops retrying this row
      // forever. Transient failures stay active and retry next run.
      if (isRevokedTokenError(err)) {
        await deactivateConnection(admin, row.user_id);
        deactivated += 1;
      }
    }
  }

  res.status(200).json({ refreshed, failed, deactivated, total: rows.length });
}
