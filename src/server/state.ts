/**
 * HMAC-signed OAuth `state` so the callback can verify the payload wasn't
 * tampered with (preventing association of a Strava account to an arbitrary
 * user). The signing secret is passed in explicitly to keep this module pure.
 *
 * SECURITY HISTORY — this used to be `"<payload>.<HMAC(payload)>"`, which was
 * DETERMINISTIC and eternal: the same user always produced the same state, and
 * the sign-in payload is a literal constant, so `signState('signin', …)` was one
 * fixed string valid for every user forever. That is the opposite of what an
 * OAuth `state` is for (RFC 6749 §10.12 requires it be non-guessable and bound
 * to the request). A state observed once — from browser history, a log, or just
 * by running the flow yourself — could be replayed indefinitely.
 *
 * The signed value now carries a random NONCE and an issued-at, and
 * `verifyState` enforces a short TTL. Note that unpredictability + expiry alone
 * do NOT stop login-CSRF (an attacker can always mint a fresh state for their
 * own flow and hand it to a victim) — that is closed separately by the
 * device-bound handoff in `authHandoff.ts`, whose hash is carried inside this
 * payload. The two are complementary; keep both.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * How long a signed state stays valid. An OAuth round trip is a few seconds of
 * redirects plus however long the user spends on Strava's consent screen; ten
 * minutes is generous for that and short enough that a leaked state is stale
 * almost immediately.
 */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Bytes of randomness in the per-request nonce. */
const NONCE_BYTES = 16;

export interface StatePayload {
  /** The signed payload — a user id (link flow) or `SIGNIN_STATE`. */
  payload: string;
  /** sha256 of the device handoff secret this flow is bound to. */
  handoffHash: string;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Serialize as `<payload>.<handoffHash>.<nonce>.<issuedAtMs>.<sig>`.
 *
 * The four leading fields are signed together, so none can be swapped
 * independently. `payload` is the only field that may itself contain dots, so
 * verification splits from the RIGHT — the last four segments are always
 * handoffHash/nonce/iat/sig and everything before them is the payload.
 */
export function signState(
  payload: string,
  handoffHash: string,
  secret: string,
  now: number = Date.now(),
): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');
  const body = `${payload}.${handoffHash}.${nonce}.${now}`;
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify a signed state and return its payload, or null if the signature is
 * wrong, the format is malformed, or it has expired. Never throws.
 */
export function verifyState(
  state: string,
  secret: string,
  now: number = Date.now(),
): StatePayload | null {
  const parts = state.split('.');
  // payload + handoffHash + nonce + iat + sig — the four trailing fields are
  // mandatory, so anything shorter is malformed.
  if (parts.length < 5) return null;

  const providedSig = parts[parts.length - 1];
  const issuedAtRaw = parts[parts.length - 2];
  const nonce = parts[parts.length - 3];
  const handoffHash = parts[parts.length - 4];
  const payload = parts.slice(0, parts.length - 4).join('.');
  if (!providedSig || !nonce || !handoffHash || !payload) return null;

  const body = `${payload}.${handoffHash}.${nonce}.${issuedAtRaw}`;
  const expectedSig = sign(body, secret);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  // timingSafeEqual throws on differing buffer lengths, so guard first.
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  // Signature is good — now enforce freshness. Reject a future issued-at too:
  // a clock-skewed or hand-crafted timestamp must not buy extra lifetime.
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return null;
  if (issuedAt > now + 60_000) return null;
  if (now - issuedAt > STATE_TTL_MS) return null;

  return { payload, handoffHash };
}
