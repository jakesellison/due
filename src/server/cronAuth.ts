/**
 * Shared authorization for the internet-reachable CRON endpoints.
 *
 * Both cron targets drive service-role (RLS-bypassing) writes, so both are
 * FAIL-CLOSED: the only accepted credential is a short-lived, Google-signed OIDC
 * token minted by the Cloud Scheduler job for its service account. If OIDC is
 * not configured the endpoint disables itself (503) rather than leaving an
 * admin-write open.
 *
 * WHY NO SHARED SECRET. `purge-raw` already made this argument and `refresh` now
 * follows it: a static bearer on a public endpoint is a standing attack surface
 * that never rotates itself, leaks into any config store or log that touches it,
 * and is only as strong as its comparison (the `refresh` implementation this
 * replaces used a plain `!==`, which is also not constant-time). A
 * signature-verified token that expires on its own has none of those properties.
 */

import type { ApiRequest } from './httpTypes';
import { verifyGoogleOidcToken } from './googleOidc';

export type CronAuthResult = 'ok' | 'unauthorized' | 'unconfigured';

export interface CronAuthConfig {
  /**
   * Env var holding the expected `aud` — the full URL Cloud Scheduler was told
   * to mint the token for. Per-job, because the audience is the target URL.
   */
  audienceEnv: string;
  /**
   * Env vars holding the scheduler service-account email, tried in order. The
   * first is the shared name; later entries are legacy per-job names kept so an
   * already-deployed environment keeps authenticating across this change.
   */
  serviceAccountEnvs: readonly string[];
}

function firstSet(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

/**
 * Verify a cron request's OIDC bearer. Never throws — any failure resolves to
 * `unauthorized` so the caller answers 401 uniformly.
 */
export async function authorizeCron(
  req: ApiRequest,
  config: CronAuthConfig,
): Promise<CronAuthResult> {
  const header = req.headers['authorization'];
  const token =
    typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';

  const audience = process.env[config.audienceEnv];
  const schedulerSa = firstSet(config.serviceAccountEnvs);

  // Never leave an admin-write endpoint open: if OIDC isn't set up, disable it.
  if (!audience || !schedulerSa) return 'unconfigured';
  if (!token) return 'unauthorized';

  if (await verifyGoogleOidcToken(token, { audience, serviceAccountEmail: schedulerSa })) {
    return 'ok';
  }
  return 'unauthorized';
}

/**
 * The service-account env names, newest first. `PURGE_SCHEDULER_SA` is the
 * original purge-only name and stays supported so this change does not require
 * a coordinated env update to keep the purge cron working.
 */
export const SCHEDULER_SA_ENVS = ['CRON_SCHEDULER_SA', 'PURGE_SCHEDULER_SA'] as const;
