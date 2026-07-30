/**
 * Device-bound OAuth handoff (security audit P1 — login-CSRF / session fixation).
 *
 * THE PROBLEM. The sign-in callback used to return the freshly-minted Supabase
 * magic-link token by embedding it in the `duerunning://strava-auth?token_hash=…`
 * deep link. Any party who could make a victim's device open a crafted callback
 * URL therefore controlled which account that device signed into — the classic
 * login-CSRF. The old constant `state` made crafting that URL trivial, but note
 * that fixing `state` alone does NOT close this: an attacker can always mint a
 * legitimate, fresh state for their own flow and hand the resulting link over.
 *
 * THE FIX. Bind the flow to the device that STARTED it:
 *
 *   1. `POST /api/strava/auth` mints a random `handoff` secret, stores only its
 *      sha256, and returns the secret to that one app instance over TLS.
 *   2. The hash is signed into the OAuth `state`, so the callback learns it
 *      without trusting any query parameter.
 *   3. The callback writes the minted token against that hash — never into a URL.
 *   4. The app CLAIMS the token by presenting the handoff it still holds.
 *
 * A callback crafted by an attacker deposits its token against the ATTACKER's
 * handoff row. The victim's app claims its own row, finds no token, and refuses
 * to sign in. As a bonus the magic-link token no longer travels in a URL at all,
 * so it stops appearing in request logs and browser history.
 *
 * THE RELAY (the reverse direction, closed second). Binding to the STARTING
 * device is not enough on its own, because the attacker can be the starter:
 * mint a handoff, send the resulting genuine strava.com `authUrl` to a victim,
 * and let them consent. The callback then deposits the VICTIM's token against
 * the ATTACKER's handoff, and the attacker claims a full session for the
 * victim's account — account takeover, which the victim sees only as a failed
 * sign-in.
 *
 * So the callback mints a SECOND secret, the `ticket`, and returns it on the
 * `duerunning://strava-auth?ticket=…` deep link — reaching whichever device
 * actually consented. A claim must present BOTH secrets. A relay now fails on
 * both sides: the attacker has the handoff but never sees the ticket, and the
 * victim has the ticket but no handoff. One device holding both is precisely
 * the legitimate case. The ticket is safe in a URL: it is not a session token
 * and is worthless without the handoff.
 *
 * Rows are single-use and short-lived; only hashes are persisted, so a read of
 * `oauth_handoffs` yields nothing claimable.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How long a handoff may sit unclaimed. Must comfortably exceed the OAuth round
 * trip (it spans the user's time on Strava's consent screen) while keeping an
 * abandoned row short-lived. Matches `STATE_TTL_MS` by intent — the state and
 * its handoff expire together.
 */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

/** Bytes of randomness in the handoff secret. 32 bytes = 256 bits. */
const HANDOFF_BYTES = 32;

export type HandoffMode = 'signin' | 'link';

/** sha256 of a handoff secret, hex. The secret itself is never persisted. */
export function hashHandoff(handoff: string): string {
  return createHash('sha256').update(handoff).digest('hex');
}

export interface MintedHandoff {
  /** The secret returned to the initiating app instance. Never stored. */
  handoff: string;
  /** Its sha256, signed into the OAuth state and used as the row key. */
  handoffHash: string;
}

/**
 * Create a handoff row for a flow that is about to start. IO.
 *
 * Opportunistically sweeps expired rows first so the table stays small without
 * needing its own cron — the volume here is one row per sign-in attempt.
 */
export async function mintHandoff(
  admin: SupabaseClient,
  mode: HandoffMode,
  now: number = Date.now(),
): Promise<MintedHandoff> {
  const handoff = randomBytes(HANDOFF_BYTES).toString('base64url');
  const handoffHash = hashHandoff(handoff);

  await deleteExpired(admin, now);

  const { error } = await admin.from('oauth_handoffs').insert({
    handoff_hash: handoffHash,
    provider: 'strava',
    mode,
    expires_at: new Date(now + HANDOFF_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`mintHandoff failed: ${error.message}`);

  return { handoff, handoffHash };
}

/**
 * Attach the minted magic-link token to its handoff row, for the app to claim,
 * and mint the TICKET that authorizes that claim. Only ever called for the
 * sign-in flow. IO.
 *
 * Returns the ticket secret — the caller (the OAuth callback) must hand it to
 * the device that just consented, via the return deep link, and nowhere else.
 * Only its hash is stored, so a read of this table still yields nothing usable.
 *
 * Scoped to an UNEXPIRED, UNCLAIMED, sign-in row: a callback arriving after the
 * window has closed must not resurrect it.
 */
export async function depositToken(
  admin: SupabaseClient,
  handoffHash: string,
  tokenHash: string,
  now: number = Date.now(),
): Promise<string> {
  const ticket = randomBytes(HANDOFF_BYTES).toString('base64url');
  const { data, error } = await admin
    .from('oauth_handoffs')
    .update({ token_hash: tokenHash, ticket_hash: hashHandoff(ticket) })
    .eq('handoff_hash', handoffHash)
    .eq('mode', 'signin')
    .is('claimed_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('handoff_hash');
  if (error) throw new Error(`depositToken failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('depositToken failed: no live handoff row for this flow');
  }
  return ticket;
}

export type ClaimResult =
  | { ok: true; tokenHash: string }
  | { ok: false; reason: 'not_found' | 'not_ready' };

/**
 * Exchange a handoff secret AND its ticket for the magic-link token, exactly
 * once. IO.
 *
 * BOTH secrets are required, and that pairing is the anti-relay property (see
 * the module doc): the handoff proves this device started the flow, the ticket
 * proves this device is where the consent landed. Holding one without the other
 * is exactly the relayed case, and gets nothing.
 *
 * `not_found` covers unknown/expired/already-claimed handoffs AND a ticket
 * mismatch; `not_ready` means the row exists but the callback has not deposited
 * a token — the flow was abandoned, or an attacker-crafted callback deposited
 * against a DIFFERENT row. Both are reported to the client as a plain sign-in
 * failure; the distinction exists for logging, not for the response body.
 *
 * The consume is race-safe: contenders may read the same token, but the
 * conditional update is the single winner gate. Only the caller whose update
 * changes the still-unclaimed row receives the token it read.
 */
export async function claimToken(
  admin: SupabaseClient,
  handoff: string,
  ticket: string,
  now: number = Date.now(),
): Promise<ClaimResult> {
  const handoffHash = hashHandoff(handoff);
  const nowIso = new Date(now).toISOString();

  // Read the token before clearing it. PostgREST returns the NEW row from
  // `update(...).select()`, so trying to update `token_hash` to null and return
  // that same column can only return null.
  const { data: ready, error: readError } = await admin
    .from('oauth_handoffs')
    .select('token_hash, ticket_hash')
    .eq('handoff_hash', handoffHash)
    .is('claimed_at', null)
    .gt('expires_at', nowIso)
    .not('token_hash', 'is', null)
    .maybeSingle();
  if (readError) throw new Error(`claimToken failed: ${readError.message}`);

  const row = ready as { token_hash?: string | null; ticket_hash?: string | null } | null;
  const tokenHash = row?.token_hash;
  // The ticket must match the one the callback minted for THIS row. Constant
  // time, and a missing stored ticket can never be satisfied.
  if (tokenHash && !(row?.ticket_hash && handoffHashMatches(row.ticket_hash, hashHandoff(ticket)))) {
    return { ok: false, reason: 'not_found' };
  }
  if (tokenHash) {
    // `claimed_at is null` plus the exact token value is an optimistic lock.
    // If two claims race, one update clears the token and the other matches
    // zero rows, so the one-time token is returned exactly once.
    const { data: claimed, error: claimError } = await admin
      .from('oauth_handoffs')
      .update({ claimed_at: nowIso, token_hash: null })
      .eq('handoff_hash', handoffHash)
      .eq('token_hash', tokenHash)
      .is('claimed_at', null)
      .gt('expires_at', nowIso)
      .select('handoff_hash');
    if (claimError) throw new Error(`claimToken failed: ${claimError.message}`);
    if ((claimed ?? []).length > 0) return { ok: true, tokenHash };
    return { ok: false, reason: 'not_found' };
  }

  // No token was ready. Distinguish "row is waiting on the callback" from
  // "no such/live row" for logging only.
  const { data: probe } = await admin
    .from('oauth_handoffs')
    .select('handoff_hash')
    .eq('handoff_hash', handoffHash)
    .gt('expires_at', nowIso)
    .is('claimed_at', null)
    .maybeSingle();
  return { ok: false, reason: probe ? 'not_ready' : 'not_found' };
}

/**
 * Constant-time compare for two handoff-derived hashes. Used where a hash from
 * a signed state is checked against one recomputed from a presented secret.
 */
export function handoffHashMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Drop rows past their expiry. Best-effort; never blocks the caller. IO. */
async function deleteExpired(admin: SupabaseClient, now: number): Promise<void> {
  try {
    await admin.from('oauth_handoffs').delete().lt('expires_at', new Date(now).toISOString());
  } catch {
    // Housekeeping only — a failed sweep must not fail the sign-in it precedes.
  }
}
