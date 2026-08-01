import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { getEnv } from '../../src/server/env';
import { methodAllowed, optionalUser } from '../../src/server/apiAuth';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { authorizeUrl } from '../../src/server/strava';
import { signState } from '../../src/server/state';
import { mintHandoff } from '../../src/server/authHandoff';
import { SIGNIN_STATE } from '../../src/server/stravaAuth';
import { rateLimit } from '../../src/server/rateLimit';

/**
 * POST /api/strava/auth — start the Strava OAuth flow.
 *
 *  - SIGN-IN (no Authorization header): Strava is the app's identity provider;
 *    the callback finds-or-creates the user and mints a session.
 *  - LINK (`Authorization: Bearer <supabase jwt>`): an already-signed-in user is
 *    (re)connecting Strava — we verify the JWT and sign their user id into state.
 *
 * WAS A GET WITH `?token=<jwt>`. Two problems, both fixed here:
 *
 *  1. The caller's Supabase access token travelled in a QUERY STRING, so it was
 *     recorded verbatim in Cloud Run request logs, in the CDN's logs, and in the
 *     in-app browser's history. Credentials belong in a header, which is why
 *     this is now a POST that reads `Authorization`.
 *  2. The endpoint 302'd straight to Strava, so it had to be navigable. It now
 *     RETURNS the authorize URL as JSON and the app opens it itself — which is
 *     also what lets us hand back the device-bound `handoff` (see authHandoff.ts)
 *     that closes the login-CSRF hole.
 *
 * Response: `{ authUrl, handoff }`. The app opens `authUrl` in an auth session
 * and later presents `handoff` to `/api/strava/auth/claim` to collect its
 * session token. `handoff` is a bearer secret for exactly one sign-in — it is
 * returned over TLS to the initiating instance and never logged.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['POST'])) return;

  // Unauthenticated in sign-in mode, so it is rate limited per client: each call
  // writes a handoff row and every accepted row is a Strava consent screen.
  if (!rateLimit(req, res, { key: 'strava-auth', limit: 10, windowMs: 60_000 })) return;

  const { appBaseUrl, stravaStateSecret } = getEnv();

  // A present-but-invalid token is NOT silently downgraded to sign-in: the
  // caller asked to link, and quietly starting a different flow would attach
  // their Strava account to a brand-new user instead.
  const hasAuthHeader = typeof req.headers.authorization === 'string';
  const userId = await optionalUser(req);
  if (hasAuthHeader && !userId) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const mode = userId ? 'link' : 'signin';
  const statePayload = userId ?? SIGNIN_STATE;

  try {
    const admin = createAdminClient();
    const { handoff, handoffHash } = await mintHandoff(admin, mode);
    const state = signState(statePayload, handoffHash, stravaStateSecret);
    const redirectUri = `${appBaseUrl}/api/strava/callback`;
    // Write scope is an escalation an authenticated user asks for explicitly
    // (Plan context reconnect); sign-in mode can never request it.
    const write = mode === 'link' && (req.body as { write?: unknown } | undefined)?.write === true;
    res.status(200).json({ authUrl: authorizeUrl(state, redirectUri, { write }), handoff });
  } catch (err) {
    console.error('strava/auth failed:', err);
    await captureError(err, { route: 'strava/auth' });
    res.status(500).json({ error: 'Internal server error' });
  }
}
