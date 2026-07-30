import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import * as WebBrowser from 'expo-web-browser';

import { API_BASE, resilientFetch } from './api';
import { setSentryUser } from './sentry';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export interface UserProfile {
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  provider: string | null;
  isAnonymous: boolean;
}

export type StravaSignInResult = 'signed_in' | 'cancelled' | 'dismissed' | { kind: 'error'; message: string };

/** Deep link the Strava sign-in callback bounces to (carries the one-time token). */
export const STRAVA_AUTH_REDIRECT = 'duerunning://strava-auth';

function profileFromUser(user: {
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  is_anonymous?: boolean;
} | null | undefined): UserProfile | null {
  if (!user) return null;
  const meta = user?.user_metadata ?? {};
  const appMeta = user?.app_metadata ?? {};
  const displayName =
    stringMeta(meta.full_name) ?? stringMeta(meta.name) ?? stringMeta(meta.user_name) ?? null;
  const avatarUrl =
    stringMeta(meta.avatar_url) ?? stringMeta(meta.picture) ?? stringMeta(meta.photo_url) ?? null;
  return {
    displayName,
    email: user?.email ?? stringMeta(meta.email),
    avatarUrl,
    provider: stringMeta(appMeta.provider),
    isAnonymous: !!user?.is_anonymous,
  };
}

function stringMeta(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Resolve the current Supabase session's user id, or null when signed out.
 *
 * Anonymous sign-in was REMOVED (beta-readiness audit S1): an anonymous JWT is
 * fully valid against PostgREST, so shipping a client that mints one hands out
 * scriptable insert access with the public anon key. Signed-out now simply
 * resolves null — the tabs gate shows AuthLanding, and Strava OAuth (the only
 * sign-in) creates the real session without needing a prior one. Anonymous
 * sign-ins are also disabled in the project's Supabase Auth config, so a stale
 * client can't mint one either.
 */
let pendingEnsure: Promise<string | null> | null = null;

export function ensureSession(): Promise<string | null> {
  // In-flight singleton kept for callers racing at boot; cleared on settle.
  return (pendingEnsure ??= _ensureSession().finally(() => {
    pendingEnsure = null;
  }));
}

async function _ensureSession(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export interface SessionState {
  /** Resolved Supabase user id, or null until a session exists. */
  userId: string | null;
  profile: UserProfile | null;
  /** True once the initial ensureSession() attempt has settled. */
  ready: boolean;
  /** Populated if ensureSession() threw. */
  error: Error | null;
  /** Re-runs the boot-time ensureSession() attempt after a failure. */
  retry: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Resolves the current session once at the app root (null when signed out — no
 * anonymous fallback, see `_ensureSession`). React Query is unnecessary for a
 * single boot-time identity snapshot; SessionProvider shares this controller
 * with every screen. `retry()` re-runs the bootstrap after a failure.
 */
function useSessionController(): SessionState {
  const [state, setState] = useState<Omit<SessionState, 'retry'>>({
    userId: null,
    profile: null,
    ready: false,
    error: null,
  });
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await ensureSession();
        const { data } = await supabase.auth.getSession();
        if (!cancelled) {
          setSentryUser(data.session?.user.id ?? null);
          setState({
            userId: data.session?.user.id ?? null,
            profile: data.session?.user ? profileFromUser(data.session.user) : null,
            ready: true,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            userId: null,
            profile: null,
            ready: true,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();

    // Keep userId in sync if the session changes later (e.g. token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setSentryUser(session?.user?.id ?? null);
        setState((prev) => ({
          ...prev,
          userId: session?.user?.id ?? null,
          profile: session?.user ? profileFromUser(session.user) : null,
        }));
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [bootAttempt]);

  // Reset ready/error synchronously so a caller's error screen flips to loading
  // immediately on tap, instead of showing the stale error message until the
  // async ensureSession() round-trip re-triggered by bootAttempt settles.
  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, ready: false, error: null }));
    setBootAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}

/**
 * One app-wide session owner. Screens used to run their own async
 * `getSession()` round-trip every time they mounted; a pushed/modal screen
 * therefore painted a signed-out loading frame before inheriting the same
 * already-known user. Keeping the controller above the router makes the warm
 * session snapshot available on the destination's first render.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const value = useSessionController();
  return createElement(SessionContext.Provider, { value }, children);
}

/** Read the shared, already-resolved app session. */
export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (value == null) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}

/**
 * Sign in with Strava — the app's only identity provider.
 *
 * Three steps, and the shape matters for security:
 *
 *  1. `POST /api/strava/auth` (no Authorization header = sign-in mode) returns
 *     the Strava authorize URL plus a `handoff` secret unique to THIS device and
 *     THIS attempt.
 *  2. Open the authorize URL in an auth session. The callback finds-or-creates
 *     the athlete's user, deposits a one-time magic-link token against the
 *     handoff — the token is NOT in the return deep link — and returns a
 *     single-use `ticket` on that link instead.
 *  3. Claim the token by presenting BOTH the handoff we are still holding and
 *     the ticket we just received, then exchange it via `verifyOtp` for a real
 *     session.
 *
 * The token used to ride back in the deep link, which meant anyone who could
 * get this device to open a crafted callback URL chose which account it signed
 * into (login-CSRF). Now a callback we did not start deposits its token against
 * somebody else's handoff, our claim comes back empty, and no session is
 * created.
 *
 * The ticket closes the mirror-image attack: an attacker who starts a flow and
 * relays their authUrl to a victim holds the handoff, but the ticket goes to
 * whichever device actually consented — the victim's — so neither party can
 * claim. Keep the handoff in memory only; never persist or log either secret.
 */
export async function signInWithStrava(): Promise<StravaSignInResult> {
  let handoff: string;
  let authUrl: string;
  try {
    const startRes = await resilientFetch(`${API_BASE}/api/strava/auth`, { method: 'POST' });
    if (!startRes.ok) {
      return { kind: 'error', message: `Could not start Strava sign-in (${startRes.status}).` };
    }
    const started = (await startRes.json()) as { authUrl?: string; handoff?: string };
    if (!started.authUrl || !started.handoff) {
      return { kind: 'error', message: 'Could not start Strava sign-in.' };
    }
    authUrl = started.authUrl;
    handoff = started.handoff;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authUrl, STRAVA_AUTH_REDIRECT);
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (result.type === 'cancel') return 'cancelled';
  if (result.type !== 'success') return 'dismissed';

  // Strava can still report a denial on the return URL even when the browser
  // session itself completed.
  const params = authParams(result.url);
  const error = params.get('error') ?? params.get('error_code');
  if (error) {
    const description = params.get('error_description');
    return { kind: 'error', message: description ? `${error}: ${description}` : error };
  }

  const ticket = params.get('ticket');
  if (!ticket) {
    return { kind: 'error', message: 'Strava sign-in could not be completed. Please try again.' };
  }

  let tokenHash: string;
  try {
    const claimRes = await resilientFetch(`${API_BASE}/api/strava/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoff, ticket }),
    });
    if (!claimRes.ok) {
      return { kind: 'error', message: 'Strava sign-in could not be completed. Please try again.' };
    }
    const claimed = (await claimRes.json()) as { tokenHash?: string };
    if (!claimed.tokenHash) {
      return { kind: 'error', message: 'Strava sign-in returned no session token.' };
    }
    tokenHash = claimed.tokenHash;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyError) return { kind: 'error', message: verifyError.message };
  return 'signed_in';
}

function authParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  if (parsed.hash.startsWith('#')) {
    const hashParams = new URLSearchParams(parsed.hash.slice(1));
    hashParams.forEach((value, key) => params.set(key, value));
  }
  return params;
}

/**
 * Sign out to the login gate. Unlike the old signOutToAnonymous(), this does
 * NOT mint a fresh anonymous session — doing so orphaned all of the account's
 * RLS-scoped data behind a new, empty anon user. After this resolves there is
 * no session, so the gating renders AuthLanding. Callers should also clear the
 * react-query cache so the previous account's data can't bleed into a later one.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Permanently delete the signed-in user's account (Apple Guideline 5.1.1(v),
 * audit-ops H2): revokes/deletes Strava data, storage objects, every DB row
 * scoped to the user, and the underlying auth user itself — all server-side,
 * JWT-authed (the server never trusts a client-supplied user id). Resolves on
 * success; throws on failure so the caller can surface an error and leave the
 * account intact. Does NOT sign out locally — callers should follow a success
 * with `signOut()` themselves (mirrors `disconnectStrava`'s shape).
 */
export async function deleteAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Not signed in');

  const res = await resilientFetch(`${API_BASE}/api/account/delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}: ${await res.text()}`);
  }
}

/** Internal helpers exposed only for unit tests. Not part of the public API. */
export const __testing = {
  profileFromUser,
  resetPending(): void {
    pendingEnsure = null;
  },
};
