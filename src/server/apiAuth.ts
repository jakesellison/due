/**
 * The single implementation of "who is calling this endpoint".
 *
 * This used to be copy-pasted into six files (`account/delete`, `strava/auth`,
 * `strava/backfill`, `strava/disconnect`, `strava/status`, `strava/sync-latest`)
 * alongside a seventh in `sync.ts`. Seven near-identical copies of the one
 * check that must never drift is a standing correctness risk, so every endpoint
 * now routes through here.
 *
 * NOTE ON THE ROUND TRIP: `supabase.auth.getUser(token)` is a network call to
 * the auth service on every request. Verifying the JWT signature locally would
 * be faster and remove the availability dependency, but it would also stop
 * honouring revocation — a deleted or signed-out user's unexpired token would
 * keep working until it aged out. Given `account/delete` exists specifically to
 * make an account stop working immediately, the round trip is the deliberate
 * choice. Do not "optimize" it into local-only verification without adding a
 * revocation check.
 */

import { createClient } from '@supabase/supabase-js';

import type { ApiRequest, ApiResponse } from './httpTypes';
import { getEnv } from './env';

/** Extract a Bearer token from the Authorization header, or null. */
export function bearerToken(req: ApiRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token === '' ? null : token;
}

/**
 * Resolve the caller's user id from a Bearer token, or null when the token is
 * absent or invalid. Sends NO response — for endpoints where being signed in is
 * optional (the OAuth start, which treats "no token" as sign-in mode).
 */
export async function optionalUser(req: ApiRequest): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseAnonKey } = getEnv();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

/**
 * Require a valid Bearer token. Returns the user id, or sends 401 and returns
 * null — callers must `if (!userId) return;` immediately.
 */
export async function requireUser(req: ApiRequest, res: ApiResponse): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return null;
  }

  const { supabaseUrl, supabaseAnonKey } = getEnv();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
  return data.user.id;
}

/**
 * Reject any method other than those listed, with a correct `Allow` header.
 * Returns true when the request may proceed.
 */
export function methodAllowed(
  req: ApiRequest,
  res: ApiResponse,
  allowed: readonly string[],
): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (allowed.includes(method)) return true;
  res.status(405).setHeader('Allow', allowed.join(', ')).json({ error: 'Method not allowed' });
  return false;
}
