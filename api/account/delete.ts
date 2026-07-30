import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { methodAllowed, requireUser } from '../../src/server/apiAuth';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { deleteAccount } from '../../src/server/accountDeletion';

/**
 * POST /api/account/delete — in-app account deletion (Apple Guideline
 * 5.1.1(v), audit-ops H2).
 *
 * Verifies the caller's Supabase JWT the same way `strava/disconnect` and the
 * backfill routes do — the deletion target is ALWAYS the authenticated user;
 * there is no body-supplied user id. On success, deletes Strava data, storage
 * objects, every user-scoped DB row, and the underlying `auth.users` row (see
 * `src/server/accountDeletion.ts` for the full order + table coverage).
 * Returns 200 only after the auth-user delete itself succeeds; any failure
 * along the way is a generic 500 (details go to `captureError`/console, never
 * to the client).
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['POST'])) return;

  const userId = await requireUser(req, res);
  if (!userId) return;

  const admin = createAdminClient();
  try {
    await deleteAccount(admin, userId);
  } catch (err) {
    console.error('account/delete failed:', err);
    await captureError(err, { route: 'account/delete', userId });
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.status(200).json({ ok: true });
}
