import { getEnv } from './env';
import type { RawStreams } from './streams';
import { StravaHttpError } from './stravaError';

// The error type lives in `stravaError.ts` (see that module for why). Re-export
// it so `import { StravaHttpError } from './strava'` keeps working for callers
// that already talk to this module — but note that anything relying on
// `instanceof` must import from `stravaError` directly, since suites that
// `jest.mock('../strava')` would otherwise get an undefined binding.
export {
  StravaHttpError,
  isStravaRateLimited,
  isStravaNotFound,
  type StravaOperation,
} from './stravaError';

/** Normalized OAuth token result from Strava. */
export interface StravaToken {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp of token expiry. */
  expiresAt: string;
  /** Strava athlete id (present on authorization_code exchange). */
  athleteId: number | null;
}

const OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';
const OAUTH_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const API_BASE = 'https://www.strava.com/api/v3';

/**
 * Guard every id interpolated into an API path. WHATWG `URL` resolves dot
 * segments, so a non-numeric id (`../../../oauth/deauthorize`) silently
 * retargets the request while keeping the caller's bearer token attached.
 * Defence in depth: the webhook validates at its parse boundary too, but stored
 * `source_id`s reach here from backfill/rehydrate/description paths as well.
 */
function assertNumericId(activityId: number | string, operation: string): string {
  const id = String(activityId);
  if (!/^\d+$/.test(id)) {
    throw new Error(`${operation}: refusing non-numeric Strava id ${JSON.stringify(id)}`);
  }
  return id;
}
const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';

/** Whether Strava reported a specific OAuth scope for this connection. Scope
 *  strings are comma-separated, but tolerate whitespace so persisted legacy
 *  rows and callback variants resolve identically. */
export function hasStravaScope(scope: string | null | undefined, required: string): boolean {
  return new Set((scope ?? '').split(',').map((value) => value.trim()).filter(Boolean)).has(required);
}

/**
 * Revoke our app's access on Strava's side (the user-initiated counterpart to
 * the deauthorization webhook). POSTs the access token to Strava's deauthorize
 * endpoint. Best-effort: a non-2xx (e.g. the token was already revoked) is
 * swallowed so the local disconnect/cleanup still proceeds. IO.
 */
export async function deauthorizeStrava(accessToken: string): Promise<void> {
  try {
    await fetch(OAUTH_DEAUTHORIZE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Network/already-revoked — local cleanup is the source of truth either way.
  }
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
}

function toToken(json: StravaTokenResponse): StravaToken {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(json.expires_at * 1000).toISOString(),
    athleteId: json.athlete?.id ?? null,
  };
}

/** Build the Strava authorize URL the user is redirected to. PURE. */
export function authorizeUrl(state: string, redirectUri: string): string {
  const { stravaClientId } = getEnv();
  const params = new URLSearchParams({
    client_id: stravaClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'read,activity:read_all,activity:write',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForToken(code: string): Promise<StravaToken> {
  const { stravaClientId, stravaClientSecret } = getEnv();
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new StravaHttpError(
      'token-exchange',
      res.status,
      `Strava token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return toToken((await res.json()) as StravaTokenResponse);
}

/** Refresh an access token using a refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<StravaToken> {
  const { stravaClientId, stravaClientSecret } = getEnv();
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new StravaHttpError(
      'token-refresh',
      res.status,
      `Strava token refresh failed: ${res.status} ${await res.text()}`,
    );
  }
  return toToken((await res.json()) as StravaTokenResponse);
}

/** Fetch a single activity (with all efforts/laps). */
export async function fetchActivity(
  accessToken: string,
  activityId: number | string,
): Promise<Record<string, unknown>> {
  const id = assertNumericId(activityId, 'fetchActivity');
  const url = `${API_BASE}/activities/${id}?include_all_efforts=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new StravaHttpError(
      'activity',
      res.status,
      `Strava fetchActivity failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Fetch the per-activity streams (time/distance/heartrate/velocity/altitude/
 * latlng), keyed by type. `latlng` is the full-resolution GPS path we build the
 * route from. Returns the raw streams JSON, or null on any error — MANY
 * activities (manual entries, some devices) lack streams entirely and return a
 * 404, which is expected and must NOT throw. Best-effort, like weather.
 */
export async function fetchStreams(
  accessToken: string,
  activityId: number | string,
): Promise<RawStreams | null> {
  const keys = 'time,distance,heartrate,velocity_smooth,altitude,latlng';
  const id = assertNumericId(activityId, 'fetchStreams');
  const url = `${API_BASE}/activities/${id}/streams?keys=${keys}&key_by_type=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404 = the activity genuinely has no streams (manual entry, private, deleted):
  // a TERMINAL "no streams" the caller stamps. Any OTHER non-ok (429 rate limit,
  // 5xx, network error) MUST surface — swallowing it to null would stamp
  // `enriched_at` on a transient failure and PERMANENTLY strand the row
  // streamless (the enrich predicate never re-picks a stamped, streams-null row).
  // The caller (ingest/backfill) classifies the thrown status: 429 → back off,
  // non-429 4xx → terminal, 5xx/network → retry unstamped.
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new StravaHttpError('streams', res.status, `Strava fetchStreams failed: ${res.status}`);
  }
  return (await res.json()) as RawStreams;
}
