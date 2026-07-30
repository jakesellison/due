import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { methodAllowed, requireUser } from '../../src/server/apiAuth';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { revokeStravaConnection } from '../../src/server/ingest';

/**
 * POST /api/strava/disconnect — the user-facing "Disconnect Strava".
 *
 * Verifies the caller's Supabase JWT, then for that user: revokes our access on
 * Strava (deauthorize), deletes their Strava-sourced activities, and marks the
 * connection revoked. Idempotent — a no-op (200) when not connected. Mirrors the
 * deauthorization webhook, but initiated from inside the app.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['POST'])) return;

  const userId = await requireUser(req, res);
  if (!userId) return;

  const admin = createAdminClient();
  try {
    // Idempotent — a no-op when there's no active Strava connection.
    await revokeStravaConnection(admin, userId);
  } catch (err) {
    console.error('strava/disconnect failed:', err);
    await captureError(err, { route: 'strava/disconnect', userId });
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.status(200).json({ disconnected: true });
}
