import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { rateLimit } from '../../src/server/rateLimit';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { authUser } from '../../src/server/sync';
import { captureError } from '../../src/server/report';
import { rehydrateActivity } from '../../src/server/rehydrate';

/**
 * POST /api/strava/rehydrate — on-demand re-fetch of a purged activity's raw
 * Strava Data (Strava API Policy §6.2 ≤7-day cache), for the run-detail
 * screen. Body: `{ activityId: string }`.
 *
 * Authenticated with the caller's Supabase user JWT (same pattern as
 * `api/account/delete.ts` / `api/strava/backfill.ts`'s `authUser`) — the row
 * looked up is always scoped to the authenticated user, never a body-supplied
 * user id.
 *
 * Response shapes:
 *  - `200 { ok: true, activity }` — streams already present (no-op), or the
 *    Strava re-fetch succeeded; `activity` is the refreshed detail row.
 *  - `200 { ok: false, reason, message }` — a NON-FATAL, expected outcome
 *    (activity not found/not owned, no Strava connection, revoked grant, or a
 *    transient Strava error). Deliberately still a 200: this is not a bug in
 *    our server, it's "couldn't rehydrate right now" — the client degrades to
 *    the summary body rather than treating it as a hard failure.
 *  - `401` — the caller's own JWT is missing/invalid.
 *  - `400` — malformed body.
 *  - `500` — a genuine internal error (logged + captured).
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = await authUser(req, res);
  if (!userId) return; // response already sent

  // Two Strava calls per rehydrate (fetchActivity + fetchStreams) against the
  // APP-WIDE quota, and a caller can loop it over their own purged rows — same
  // hazard, same ceiling as backfill/sync-latest.
  if (!rateLimit(req, res, { key: 'strava-rehydrate', limit: 60, windowMs: 60_000, subject: userId })) {
    return;
  }

  const body = (req.body ?? {}) as { activityId?: unknown };
  const activityId = typeof body.activityId === 'string' ? body.activityId : null;
  if (!activityId) {
    res.status(400).json({ error: 'activityId is required' });
    return;
  }

  const admin = createAdminClient();
  try {
    const outcome = await rehydrateActivity(admin, userId, activityId);
    res.status(200).json(outcome);
  } catch (err) {
    console.error('strava/rehydrate failed:', err);
    await captureError(err, { route: 'strava/rehydrate', userId, activityId });
    res.status(500).json({ error: 'Internal server error' });
  }
}
