import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { exchangeCodeForToken } from '../../src/server/strava';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { getEnv } from '../../src/server/env';
import { methodAllowed } from '../../src/server/apiAuth';
import { verifyState } from '../../src/server/state';
import { depositToken } from '../../src/server/authHandoff';
import {
  SIGNIN_STATE,
  STRAVA_AUTH_REDIRECT,
  findOrCreateStravaUser,
  mintMagicLinkToken,
} from '../../src/server/stravaAuth';

/**
 * GET /api/strava/callback?code=...&state=...
 *
 * Two flows, told apart by the signed `state` payload:
 *  - SIGN-IN (payload = SIGNIN_STATE): find-or-create the Supabase user for this
 *    athlete, store the connection, then DEPOSIT a one-time magic-link token
 *    against the handoff hash carried in the state.
 *  - LINK (payload = a user id): store the connection for that existing user and
 *    bounce back to the app.
 * All writes go through the service-role client (RLS bypassed).
 *
 * SECURITY — the sign-in token is no longer placed in the return deep link.
 * Anyone able to make a device open a crafted callback URL used to control which
 * account that device signed into (login-CSRF); now the token is stored against
 * the initiating device's handoff and only that device can claim it. See
 * `src/server/authHandoff.ts`. The deep link carries no secret at all, which
 * also keeps the token out of URL-bearing logs and browser history.
 */

/**
 * Defence-in-depth headers for the one HTML response this API serves. The page
 * is fully static — its only interpolation is a constant deep link — but a CSP
 * that permits just the inline bootstrap means a future edit can't quietly turn
 * it into an injection sink.
 */
function setHtmlSecurityHeaders(res: ApiResponse): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['GET'])) return;

  // Strava redirects here with `error=access_denied` when the user cancels.
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;
  if (oauthError) {
    const description =
      typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
    console.warn('Strava callback denied:', oauthError, description ?? '');
    setHtmlSecurityHeaders(res);
    res.status(400).send('Strava authorization was declined. Close this page and try again.');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  if (!code) {
    setHtmlSecurityHeaders(res);
    res.status(400).send('Missing code or state');
    return;
  }

  const { stravaStateSecret } = getEnv();
  const state = verifyState(String(req.query.state ?? ''), stravaStateSecret);
  if (!state) {
    // Covers a bad signature, a malformed value, AND an expired one — the client
    // is told no more than "invalid" either way.
    setHtmlSecurityHeaders(res);
    res.status(400).send('This sign-in link has expired. Close this page and try again from the app.');
    return;
  }
  const { payload: statePayload, handoffHash } = state;

  // Strava returns the actually-granted scope (the user can deselect
  // `activity:read_all`); store what was granted, not what we requested.
  const grantedScope = typeof req.query.scope === 'string' ? req.query.scope : null;

  try {
    const token = await exchangeCodeForToken(code);
    const admin = createAdminClient();
    const isSignIn = statePayload === SIGNIN_STATE;

    // Resolve the user: an existing one (link flow) or find-or-create (sign-in).
    let userId = statePayload;
    let ticket: string | null = null;
    if (isSignIn) {
      if (token.athleteId == null) throw new Error('Strava returned no athlete id');
      const { userId: uid, email } = await findOrCreateStravaUser(admin, token.athleteId);
      userId = uid;
      // Deposit against the handoff the INITIATING device holds. A callback
      // driven by anyone else deposits against their own row, which the victim's
      // app never claims.
      //
      // The returned TICKET rides back on the deep link below, so it reaches
      // only the device that actually consented. Claiming needs both it and the
      // handoff, which is what stops an attacker from relaying their own
      // authUrl to a victim and claiming the victim's session (see
      // `authHandoff.ts`). Not a session token, so a URL is an acceptable home.
      ticket = await depositToken(admin, handoffHash, await mintMagicLinkToken(admin, email));
    }

    const { error } = await admin.from('integration_connections').upsert(
      {
        user_id: userId,
        provider: 'strava',
        provider_athlete_id: token.athleteId != null ? String(token.athleteId) : null,
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_at: token.expiresAt,
        scope: grantedScope,
        status: 'active',
      },
      { onConflict: 'user_id,provider' },
    );
    if (error) throw new Error(error.message);

    // Bounce back into the app. The session token is still claimed over TLS and
    // never rides in this URL; the sign-in link carries only the single-use
    // ticket. `encodeURIComponent` is belt-and-braces — the secret is base64url
    // ([A-Za-z0-9_-]), so it has nothing to escape in either the HTML attribute
    // or the JS string below.
    const deepLink = isSignIn
      ? `${STRAVA_AUTH_REDIRECT}?ticket=${encodeURIComponent(ticket ?? '')}`
      : 'duerunning://strava-connected';
    const heading = isSignIn ? 'Signed in with Strava' : 'Strava connected';
    setHtmlSecurityHeaders(res);
    res
      .status(200)
      .send(
        '<!doctype html><html><head><meta charset="utf-8">' +
          `<meta http-equiv="refresh" content="0;url=${deepLink}">` +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          `<title>${heading}</title></head>` +
          `<body style="font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:48px 24px">` +
          `<h1 style="font-size:22px">${heading}</h1>` +
          '<p style="color:#71767F">Returning to the app…</p>' +
          `<p><a href="${deepLink}" style="color:#FC5200;font-weight:600">Open Due</a></p>` +
          `<script>location.replace(${JSON.stringify(deepLink)});</script>` +
          '</body></html>',
      );
  } catch (err) {
    console.error('Strava callback error:', err);
    await captureError(err, { route: 'strava/callback' });
    setHtmlSecurityHeaders(res);
    res
      .status(502)
      .send('Strava connection failed. Close this page and try again from the app.');
  }
}
