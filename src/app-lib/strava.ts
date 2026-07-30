import { useCallback, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { API_BASE, resilientFetch } from './api';
import { supabase } from './supabase';

/**
 * Client-side Strava integration glue: the API base, the in-app OAuth connect
 * flow, and the `useStravaStatus` hook.
 *
 * `integration_connections` is service-role-only (RLS blocks client reads), so
 * the app NEVER queries it directly — it asks `GET /api/strava/status`, which
 * verifies the user JWT server-side and returns only non-secret status. Tokens
 * stay on the server.
 */

/** The deep link the OAuth callback bounces back to, closing the in-app browser. */
export const STRAVA_REDIRECT = 'duerunning://strava-connected';

export interface StravaStatus {
  connected: boolean;
  athleteId: string | null;
  /** True only when Strava actually returned `activity:write` for this grant. */
  writeAuthorized?: boolean;
  lastActivityAt?: string | null;
}

/**
 * Disconnect Strava: revokes our access on Strava and deletes the user's
 * Strava-sourced activities (JWT-authed; server does the work). Resolves on
 * success, throws on failure so the caller can surface an error.
 */
export async function disconnectStrava(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Not signed in');

  const res = await resilientFetch(`${API_BASE}/api/strava/disconnect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    retries: 1,
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}: ${await res.text()}`);
  }
}

/** Fetch the caller's Strava status from the server (JWT-authed). */
export async function fetchStravaStatus(): Promise<StravaStatus> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { connected: false, athleteId: null };

  // Idempotent GET status probe: safe to retry on a transient network/5xx blip.
  const res = await resilientFetch(`${API_BASE}/api/strava/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    retries: 2,
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as StravaStatus;
}

export interface UseStravaStatus {
  status: StravaStatus | null;
  loading: boolean;
  error: Error | null;
  /** Re-fetch (e.g. after a connect round-trip). */
  refresh: () => Promise<StravaStatus | null>;
}

/**
 * Hook wrapping `fetchStravaStatus` with loading/error and a manual refresh.
 * Kept as simple local state (no react-query) since it's a single status probe
 * read by the settings sheet; the runner invalidates the activity caches itself.
 */
export function useStravaStatus(enabled: boolean): UseStravaStatus {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<StravaStatus | null> => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchStravaStatus();
      setStatus(s);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { status, loading, error, refresh };
}

export type ConnectResult = 'connected' | 'dismissed' | 'cancelled' | 'error';

/**
 * Launch the in-app Strava OAuth consent flow for an ALREADY SIGNED-IN user
 * (the link flow). `POST /api/strava/auth` with the session JWT in the
 * Authorization header returns the Strava authorize URL, which we open in an
 * auth session; the callback bounces back to `duerunning://strava-connected`,
 * closing the browser.
 *
 * The access token used to be appended to the auth URL as `?token=<jwt>`, which
 * put a live credential into Cloud Run's request logs, the CDN's logs, and the
 * in-app browser's history. It is a header now, and the server hands back a URL
 * instead of redirecting.
 *
 * Returns 'connected' when the redirect round-trips, else the browser result
 * type. Does NOT itself verify the connection — callers re-probe via status.
 */
export async function connectStrava(): Promise<ConnectResult> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return 'error';

  try {
    const res = await resilientFetch(`${API_BASE}/api/strava/auth`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return 'error';
    const { authUrl } = (await res.json()) as { authUrl?: string };
    if (!authUrl) return 'error';

    const result = await WebBrowser.openAuthSessionAsync(authUrl, STRAVA_REDIRECT);
    if (result.type === 'success') return 'connected';
    if (result.type === 'cancel') return 'cancelled';
    return 'dismissed';
  } catch {
    return 'error';
  }
}
