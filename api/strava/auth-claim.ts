import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { methodAllowed } from '../../src/server/apiAuth';
import { claimToken } from '../../src/server/authHandoff';
import { rateLimit } from '../../src/server/rateLimit';

/**
 * POST /api/strava/auth/claim — collect the session token for a sign-in this
 * device started AND completed. Body: `{ handoff, ticket }`.
 *
 * This is the second half of the device-bound handoff that closes login-CSRF
 * (see `src/server/authHandoff.ts`). The app presents the `handoff` secret it
 * received from `POST /api/strava/auth` together with the `ticket` the callback
 * returned on the deep link; if the callback deposited a token against that
 * exact handoff and the ticket matches, it is returned here, exactly once.
 * Requiring BOTH is what stops a relayed flow — an attacker who mints a handoff
 * and gets a victim to consent never receives the ticket, which went to the
 * victim's device.
 *
 * Response:
 *  - `200 { tokenHash }` — claimed; the app exchanges it via `verifyOtp`.
 *  - `404 { error }`     — unknown, expired, already-claimed, or still-pending
 *                          handoff. Deliberately ONE response for all four: the
 *                          difference is only useful to someone probing handoffs.
 *
 * Unauthenticated by necessity (the caller has no session yet — that's the
 * point), so the handoff+ticket pair is the only credential and the endpoint is
 * rate limited to blunt guessing. Guessing is already infeasible at 256 bits
 * each; the limit exists so trying costs something.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { key: 'strava-auth-claim', limit: 20, windowMs: 60_000 })) return;

  const body = (req.body ?? {}) as { handoff?: unknown; ticket?: unknown };
  const handoff = typeof body.handoff === 'string' ? body.handoff : null;
  const ticket = typeof body.ticket === 'string' ? body.ticket : null;
  if (!handoff || !ticket) {
    res.status(400).json({ error: 'handoff and ticket are required' });
    return;
  }

  try {
    const result = await claimToken(createAdminClient(), handoff, ticket);
    if (!result.ok) {
      // Logged with the reason; the response body never carries it.
      console.warn(`strava/auth/claim rejected: ${result.reason}`);
      res.status(404).json({ error: 'No session to claim' });
      return;
    }
    res.status(200).json({ tokenHash: result.tokenHash });
  } catch (err) {
    console.error('strava/auth/claim failed:', err);
    await captureError(err, { route: 'strava/auth/claim' });
    res.status(500).json({ error: 'Internal server error' });
  }
}
