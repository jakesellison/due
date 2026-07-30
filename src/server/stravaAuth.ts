/**
 * Strava-as-sign-on glue (server, service role).
 *
 * Strava is the app's ONLY identity provider. There's no native Supabase Strava
 * provider, so the OAuth callback does it by hand: find-or-create a Supabase
 * user keyed to the Strava athlete, then mint a one-time magic-link token the
 * client exchanges (`verifyOtp`) for a real session. Strava's `read` scope
 * carries no email, so each athlete gets a synthetic, pre-confirmed address.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Synthetic, internal email domain for Strava-keyed accounts (never delivered). */
const STRAVA_EMAIL_DOMAIN = 'athletes.due.run';

/** The deterministic synthetic email for a Strava athlete id. */
export function stravaAthleteEmail(athleteId: number | string): string {
  return `strava-${athleteId}@${STRAVA_EMAIL_DOMAIN}`;
}

/** The deep link the sign-in callback bounces to, carrying the one-time token. */
export const STRAVA_AUTH_REDIRECT = 'duerunning://strava-auth';

/**
 * OAuth `state` payload for SIGN-IN (vs. linking to an existing user, whose
 * payload is their user id). A UUID never equals this, so the callback can tell
 * the two flows apart unambiguously.
 */
export const SIGNIN_STATE = 'signin';

/**
 * Find the Supabase user for a Strava athlete, creating one (with its
 * `public.users` row) on first sign-in. Keyed via `integration_connections` so
 * the same athlete always resolves to the same user regardless of email. IO.
 */
export async function findOrCreateStravaUser(
  admin: SupabaseClient,
  athleteId: number | string,
): Promise<{ userId: string; email: string }> {
  // Returning athlete → reuse the user their connection is tied to. The
  // magic-link MUST target that user's REAL email (which may be a legacy
  // provider email, not the synthetic one), or verifyOtp would land in the
  // wrong/empty account.
  // An athlete may have more than one connection row (same athlete linked under
  // different users during dev) — the unique key is (user_id, provider), not the
  // athlete. Pick the ACTIVE, most-recent one rather than assuming exactly one.
  const { data: rows, error: lookupErr } = await admin
    .from('integration_connections')
    .select('user_id')
    .eq('provider', 'strava')
    .eq('provider_athlete_id', String(athleteId))
    .order('status', { ascending: true }) // 'active' sorts before 'revoked'
    .order('created_at', { ascending: false })
    .limit(1);
  if (lookupErr) throw new Error(`athlete lookup failed: ${lookupErr.message}`);
  const existingUserId = (rows?.[0] as { user_id?: string } | undefined)?.user_id;
  if (existingUserId) {
    const uid = existingUserId;
    const { data: found, error: getErr } = await admin.auth.admin.getUserById(uid);
    const userEmail = found?.user?.email;
    if (getErr || !userEmail) throw new Error(`existing user has no email: ${getErr?.message ?? uid}`);
    return { userId: uid, email: userEmail };
  }

  // New athlete → create a pre-confirmed auth user + its profile row.
  const email = stravaAthleteEmail(athleteId);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { provider: 'strava', strava_athlete_id: String(athleteId) },
  });
  if (createErr || !created?.user) {
    throw new Error(`createUser failed: ${createErr?.message ?? 'no user'}`);
  }
  const userId = created.user.id;

  const { error: rowErr } = await admin
    .from('users')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (rowErr) throw new Error(`users row create failed: ${rowErr.message}`);

  return { userId, email };
}

/**
 * Mint a one-time magic-link token for an email. The client exchanges it via
 * `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` to establish a
 * session — no email is ever sent (the token is handed back through the deep
 * link). IO.
 */
export async function mintMagicLinkToken(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) throw new Error(`generateLink failed: ${error?.message ?? 'no token'}`);
  return hashed;
}
