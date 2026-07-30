import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { methodAllowed, requireUser } from '../../src/server/apiAuth';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { hasStravaScope } from '../../src/server/strava';

/**
 * GET /api/strava/status — connection status for the calling user.
 *
 * `integration_connections` is service-role-only (RLS blocks client reads), so
 * the app cannot query it directly. This endpoint verifies the caller's Supabase
 * user JWT (Bearer), reads their row server-side, and returns ONLY non-secret
 * status — never the tokens. `lastActivityAt` is the newest imported Strava
 * activity's start, so the UI can show "Last sync".
 *
 * Response: { connected: boolean, athleteId: string | null, lastActivityAt?: string }
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['GET'])) return;

  const userId = await requireUser(req, res);
  if (!userId) return;

  const admin = createAdminClient();
  const { data: conn, error: connErr } = await admin
    .from('integration_connections')
    .select('provider_athlete_id, status, scope')
    .eq('provider', 'strava')
    .eq('user_id', userId)
    .maybeSingle();
  if (connErr) {
    console.error('strava/status connection lookup failed:', connErr);
    await captureError(connErr, { route: 'strava/status' });
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  if (!conn || (conn as { status?: string }).status !== 'active') {
    res.status(200).json({ connected: false, athleteId: null });
    return;
  }

  const { data: latest } = await admin
    .from('activities')
    .select('start_date')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  res.status(200).json({
    connected: true,
    athleteId: (conn as { provider_athlete_id: string | null }).provider_athlete_id ?? null,
    writeAuthorized: hasStravaScope((conn as { scope?: string | null }).scope, 'activity:write'),
    lastActivityAt: (latest as { start_date?: string } | null)?.start_date,
  });
}
