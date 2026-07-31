import { timingSafeEqual } from 'crypto';

import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { getEnv } from '../../src/server/env';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { consume } from '../../src/server/rateLimit';
import {
  deactivateConnection,
  deleteAllStravaActivities,
  deleteStravaActivity,
  ensureFreshAccessToken,
  getConnectionByAthlete,
  ingestStravaActivity,
  isRevokedTokenError,
  persistRefreshedToken,
  type StravaConnection,
} from '../../src/server/ingest';
import { fetchActivity, refreshAccessToken } from '../../src/server/strava';
// From `stravaError` so the `instanceof` inside survives suites that mock
// `../strava` wholesale.
import { isStravaNotFound } from '../../src/server/stravaError';

interface StravaEvent {
  object_type?: string;
  object_id?: number | string;
  owner_id?: number | string;
  aspect_type?: string;
  /** Present on athlete `update` events; deauthorization sets `authorized:'false'`. */
  updates?: Record<string, unknown>;
}

/**
 * Light shape-validation of an inbound webhook body. Strava events are UNSIGNED,
 * so we can't trust the payload — but we can reject anything that isn't even the
 * right shape (object_type must be 'activity', aspect_type one of the three
 * lifecycle verbs, object_id/owner_id present and string|number). Returns the
 * narrowed event on success, or null when the body is malformed.
 */
export function parseStravaEvent(body: unknown): StravaEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  // STRICT: ids reach `fetchActivity`/`fetchStreams`, which interpolate them
  // into the Strava API path — and WHATWG URL resolves dot segments, so a
  // string id of `../../../oauth/deauthorize` would retarget the request while
  // still carrying the victim's bearer token. Digits only.
  const isId = (v: unknown): v is number | string =>
    (typeof v === 'number' && Number.isInteger(v) && v >= 0)
    || (typeof v === 'string' && /^\d+$/.test(v));
  if (!isId(b.owner_id)) return null;

  // Athlete events: the only one we act on is DEAUTHORIZATION — Strava sends an
  // `athlete` `update` with `updates: { authorized: 'false' }` when the user
  // revokes our access. We disconnect + delete their Strava data.
  if (b.object_type === 'athlete') {
    if (b.aspect_type !== 'update') return null;
    return {
      object_type: 'athlete',
      aspect_type: 'update',
      object_id: isId(b.object_id) ? b.object_id : undefined,
      owner_id: b.owner_id,
      updates: typeof b.updates === 'object' && b.updates !== null ? (b.updates as Record<string, unknown>) : undefined,
    };
  }

  // Activity lifecycle events.
  if (b.object_type !== 'activity') return null;
  if (b.aspect_type !== 'create' && b.aspect_type !== 'update' && b.aspect_type !== 'delete') {
    return null;
  }
  if (!isId(b.object_id)) return null;
  return {
    object_type: b.object_type,
    aspect_type: b.aspect_type,
    object_id: b.object_id,
    owner_id: b.owner_id,
  };
}

/**
 * Query params arrive as `string | string[] | undefined` (`cloudRun.ts`'s query
 * collapsing produces an array on duplicate keys). Strava never legitimately
 * sends a duplicate `hub.*` param, so collapse to the first value rather than
 * let a `string[]` flow into a `===`/`Buffer.from` call downstream.
 */
export function coerceQueryParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Constant-time verify-token comparison for the GET handshake (contrast the
 * `===` this replaces, and mirror `state.ts`'s `timingSafeEqual` pattern).
 * `timingSafeEqual` throws on differing buffer lengths, so guard first —
 * length itself isn't secret, only the token, and short-circuiting on it here
 * still means an attacker never observes byte-by-byte comparison timing.
 */
export function verifyTokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided == null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * True when a webhook event should be processed further. The athlete id on an
 * inbound event is attacker-controllable (Strava webhooks are unsigned and
 * athlete ids are public), so this predicate is the hard gate: no Strava API
 * call and no DB write happens for any event whose owner_id doesn't resolve to
 * a real, active connection (`getConnectionByAthlete` already filters
 * `status = 'active'`).
 */
export function shouldProcessEvent<T>(conn: T | null | undefined): conn is T {
  return conn != null;
}

/**
 * Strava webhook endpoint.
 *
 * GET  — subscription validation handshake.
 * POST — activity events. Heavy work is wrapped so a failure still returns 200
 *        (Strava retries on non-2xx; we'd rather log + drop than 500-loop).
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === 'GET') {
    handleValidation(req, res);
    return;
  }

  if (req.method === 'POST') {
    // Acknowledge fast; process best-effort.
    const event = parseStravaEvent(req.body);
    if (!event) {
      // Malformed/forged body — ack with 200 so Strava doesn't retry-loop.
      res.status(200).json({ received: true });
      return;
    }
    // Per-ATHLETE ceiling, not per-IP: real Strava traffic arrives from many
    // addresses, so an IP bucket would both miss the abuse and risk throttling
    // Strava itself. Each forged create/update costs a full ingest (token
    // refresh, fetchActivity, fetchStreams, a weather call, DB writes) against
    // the APP-WIDE Strava quota — the same "one caller degrades sync for
    // everyone" hazard backfill and sync-latest already guard. Generous enough
    // that a genuine burst of edits passes; a replay loop does not. Still ack
    // 200 so Strava never sees a non-2xx and retries.
    if (!consume(`strava-webhook:${event.owner_id}`, 120, 60_000).allowed) {
      console.warn(`Strava webhook: rate limited athlete ${event.owner_id}`);
      res.status(200).json({ received: true });
      return;
    }
    try {
      await processEvent(event);
    } catch (err) {
      // Swallow: never 500 the webhook. Log for observability.
      console.error('Strava webhook processing error:', err);
      await captureError(err, { route: 'strava/webhook' });
    }
    res.status(200).json({ received: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

function handleValidation(req: ApiRequest, res: ApiResponse): void {
  const { stravaWebhookVerifyToken } = getEnv();
  const mode = coerceQueryParam(req.query['hub.mode']);
  const verifyToken = coerceQueryParam(req.query['hub.verify_token']);
  const challenge = coerceQueryParam(req.query['hub.challenge']);
  if (mode === 'subscribe' && verifyTokenMatches(verifyToken, stravaWebhookVerifyToken)) {
    res.status(200).json({ 'hub.challenge': challenge });
    return;
  }
  res.status(403).json({ error: 'Verification failed' });
}

/** Exported as a test seam: the deauthorization gating below is the most
 *  destructive path in the app, and mutation testing proved the verdict alone
 *  was tested while the GATING was not — a deleted guard survived the whole
 *  suite. */
export async function processEvent(event: StravaEvent): Promise<void> {
  if (event.owner_id == null) return;

  const admin = createAdminClient();
  const conn = await getConnectionByAthlete(admin, event.owner_id);
  // Hard gate BEFORE any Strava API call or DB write: unknown/inactive athlete
  // ids (attacker-forgeable, since Strava webhooks are unsigned) get ack'd with
  // no further work.
  if (!shouldProcessEvent(conn)) return;

  // Deauthorization: the athlete revoked our access in their Strava settings.
  // Compliance: stop syncing AND delete the Strava data we hold for them.
  //
  // This is the MOST destructive path in the app — it drops every Strava row the
  // user has — and webhooks are unsigned, so it gets the same treatment as the
  // `delete` branch below: verify against Strava before acting. Only an
  // affirmative "this grant is gone" authorizes the wipe.
  if (event.object_type === 'athlete') {
    if (String(event.updates?.authorized) === 'false') {
      const verdict = await deauthorizationVerdict(admin, conn);
      if (verdict !== 'revoked') {
        console.warn(
          `Strava webhook: ignoring deauthorization for athlete ${event.owner_id} (${verdict})`,
        );
        return;
      }
      await deleteAllStravaActivities(admin, conn.user_id);
      await deactivateConnection(admin, conn.user_id);
    }
    return;
  }

  if (event.object_id == null) return;

  if (event.aspect_type === 'create' || event.aspect_type === 'update') {
    // Forged create/update events are harmless: ingest re-fetches the activity
    // from Strava itself, so an attacker can only make us re-sync the truth.
    // `create` (first arrival) also fires the one-time "run banked" push.
    await ingestStravaActivity(admin, conn, event.object_id, event.aspect_type === 'create');
  } else if (event.aspect_type === 'delete') {
    // Strava webhooks are UNSIGNED, so a forged delete event is the one
    // destructive path. Verify against the source of truth: delete locally ONLY
    // when Strava affirmatively confirms the activity is gone. Anything else —
    // including "we couldn't ask" — must leave the row alone.
    const verdict = await activityDeletionVerdict(admin, conn, event.object_id);
    if (verdict !== 'gone') {
      console.warn(
        `Strava webhook: ignoring delete for activity ${event.object_id} (${verdict})`,
      );
      return;
    }
    await deleteStravaActivity(admin, conn.user_id, event.object_id);
  }
}

/**
 * Outcome of verifying an inbound `delete` event against Strava itself.
 *  - `gone`      — Strava answered 404/410: the activity really is deleted.
 *  - `exists`    — the fetch succeeded: the delete event lied.
 *  - `unknown`   — we could not get an answer (rate limit, 5xx, expired/revoked
 *                  token, network). NOT a deletion.
 */
export type DeletionVerdict = 'gone' | 'exists' | 'unknown';

/**
 * Ask Strava whether an activity still exists, for an unsigned `delete` event.
 *
 * SECURITY: only an affirmative 404/410 from Strava may authorize a local
 * delete. This function previously caught EVERY error and returned "deleted",
 * so any transient failure destroyed the user's row — and because each forged
 * event costs a Strava API call, an attacker replaying deletes for a (public)
 * athlete id could drive us into the 429 that made the guard fail open. Now
 * an inconclusive answer yields `unknown` and the caller leaves the row intact;
 * Strava re-sends genuine delete events, so a real deletion still converges.
 */
/**
 * Outcome of verifying an inbound athlete `deauthorize` event against Strava.
 *  - `revoked` — Strava rejected our refresh token (400/401 invalid_grant): the
 *                grant really is gone.
 *  - `active`  — the refresh succeeded: the grant is alive and the event lied.
 *  - `unknown` — no answer (rate limit, 5xx, network, persist failure).
 */
export type DeauthorizationVerdict = 'revoked' | 'active' | 'unknown';

/**
 * Ask Strava whether our grant still works, for an unsigned deauthorization
 * event.
 *
 * SECURITY: this is the gate on `deleteAllStravaActivities`. Without it, one
 * unauthenticated POST carrying a victim's (PUBLIC, it's in their profile URL)
 * athlete id and `updates:{authorized:'false'}` wiped every Strava row they
 * had — and since `purge-raw` has already dropped `raw`/`streams` for anything
 * older than a week, the durable derived columns that went with it are not
 * recoverable by re-syncing.
 *
 * A token refresh is the probe because it tests the GRANT, which is exactly
 * what a deauthorization destroys — an activity fetch with an unexpired access
 * token can still succeed for a short window after revocation. Strava rotates
 * refresh tokens on success, so the renewed pair must be persisted (see
 * `persistRefreshedToken`); dropping it would break the live connection we just
 * proved is healthy. Anything inconclusive yields `unknown` and the caller
 * leaves the data alone: Strava re-sends genuine deauthorization events, and
 * `api/strava/refresh.ts` independently deactivates on a truly revoked grant,
 * so a real revocation still converges.
 */
export async function deauthorizationVerdict(
  admin: ReturnType<typeof createAdminClient>,
  conn: StravaConnection,
): Promise<DeauthorizationVerdict> {
  try {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    await persistRefreshedToken(admin, conn.user_id, refreshed);
    return 'active';
  } catch (err) {
    if (isRevokedTokenError(err)) return 'revoked';
    return 'unknown';
  }
}

export async function activityDeletionVerdict(
  admin: ReturnType<typeof createAdminClient>,
  conn: StravaConnection,
  activityId: number | string,
): Promise<DeletionVerdict> {
  try {
    const accessToken = await ensureFreshAccessToken(admin, conn);
    await fetchActivity(accessToken, activityId);
    return 'exists'; // fetched fine — it still exists, the delete event lied
  } catch (err) {
    if (isStravaNotFound(err)) return 'gone';
    return 'unknown';
  }
}
