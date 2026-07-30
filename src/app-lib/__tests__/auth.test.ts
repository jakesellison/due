/**
 * Tests for the auth state machine (`app` Jest project, jest-expo).
 *
 * The Supabase client + API base are mocked so these tests need neither the
 * EXPO_PUBLIC_* env vars nor a network call. `expo-web-browser` is mocked so
 * `signInWithStrava` can drive the OAuth → verifyOtp flow without a real browser.
 */
jest.mock('../supabase', () => {
  const getSession = jest.fn();
  const signInAnonymously = jest.fn();
  const verifyOtp = jest.fn();
  const signOut = jest.fn();
  const onAuthStateChange = jest.fn(() => ({
    data: { subscription: { unsubscribe: jest.fn() } },
  }));
  return {
    supabase: {
      auth: { getSession, signInAnonymously, verifyOtp, signOut, onAuthStateChange },
    },
  };
});

jest.mock('../api', () => ({ API_BASE: 'https://api.test', resilientFetch: jest.fn() }));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

import * as WebBrowser from 'expo-web-browser';
import { createElement } from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';

import { SessionProvider, __testing, ensureSession, signInWithStrava, signOut, useSession } from '../auth';
import { resilientFetch } from '../api';
import { supabase } from '../supabase';

const fetchMock = resilientFetch as unknown as jest.Mock;

const auth = supabase.auth as unknown as {
  getSession: jest.Mock;
  signInAnonymously: jest.Mock;
  verifyOtp: jest.Mock;
  signOut: jest.Mock;
  onAuthStateChange: jest.Mock;
};

const openAuthSessionAsync = WebBrowser.openAuthSessionAsync as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  __testing.resetPending();
});

describe('ensureSession', () => {
  it('returns the existing user id without signing in again', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-user' } } } });
    const id = await ensureSession();
    expect(id).toBe('existing-user');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  // Anonymous sign-in was removed (audit S1): signed-out must resolve null —
  // never mint an anonymous session (its JWT is fully valid against PostgREST).
  it('resolves null when there is no session — no anonymous sign-in', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const id = await ensureSession();
    expect(id).toBeNull();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('shares one in-flight promise across concurrent callers', async () => {
    let resolveGetSession: (v: unknown) => void = () => {};
    auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveGetSession = resolve;
      }),
    );
    const a = ensureSession();
    const b = ensureSession();
    resolveGetSession({ data: { session: { user: { id: 'real-user' } } } });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('real-user');
    expect(rb).toBe('real-user');
    expect(auth.getSession).toHaveBeenCalledTimes(1);
  });
});

describe('SessionProvider', () => {
  it('shares one warm session controller across every screen consumer', async () => {
    auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'existing-user',
            email: 'runner@example.com',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            is_anonymous: false,
          },
        },
      },
    });

    function Probe({ name }: { name: string }) {
      const session = useSession();
      return createElement(Text, null, `${name}:${session.ready ? session.userId : 'loading'}`);
    }

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(createElement(
        SessionProvider,
        null,
        createElement(Probe, { name: 'week' }),
        createElement(Probe, { name: 'adjust' }),
      ));
      await Promise.resolve();
      await Promise.resolve();
    });

    const copy = tree!.root.findAllByType(Text).map((node) => node.props.children);
    expect(copy).toEqual(['week:existing-user', 'adjust:existing-user']);
    // ensureSession checks once, then the controller reads the full user once.
    // Two consumers do not start two independent auth bootstraps.
    expect(auth.getSession).toHaveBeenCalledTimes(2);
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    act(() => tree!.unmount());
  });
});

describe('profileFromUser', () => {
  it('returns null for null/undefined user', () => {
    expect(__testing.profileFromUser(null)).toBeNull();
    expect(__testing.profileFromUser(undefined)).toBeNull();
  });

  it('maps fields from a real user', () => {
    const profile = __testing.profileFromUser({
      email: 'jake@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: 'Jake E', avatar_url: 'https://x/a.png' },
      is_anonymous: false,
    });
    expect(profile).toEqual({
      displayName: 'Jake E',
      email: 'jake@example.com',
      avatarUrl: 'https://x/a.png',
      provider: 'email',
      isAnonymous: false,
    });
  });
});

/**
 * Sign-in is a three-step flow: start (mints a device-bound handoff) → the
 * browser consent round trip (which returns a single-use TICKET on the deep
 * link) → claim, which presents BOTH secrets. The session token deliberately
 * never travels in the return deep link, and the ticket is what proves this
 * device is where the consent landed — see `src/server/authHandoff.ts` for the
 * two attacks those two properties close.
 */

/** The deep link the callback returns: constant path, single-use ticket. */
const RETURN_URL = 'duerunning://strava-auth?ticket=T1';
const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

/** Wire `resilientFetch` to answer the start and claim calls. */
function mockAuthEndpoints(options: {
  start?: Response;
  claim?: Response;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/strava/auth')) {
      return options.start ?? jsonResponse({ authUrl: 'https://strava.test/oauth', handoff: 'H1' });
    }
    if (url.endsWith('/api/strava/auth/claim')) {
      return options.claim ?? jsonResponse({ tokenHash: 'abc123' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('signInWithStrava', () => {
  it('starts the flow, opens the returned Strava URL, and claims the session token', async () => {
    mockAuthEndpoints();
    openAuthSessionAsync.mockResolvedValue({ type: 'success', url: RETURN_URL });
    auth.verifyOtp.mockResolvedValue({ error: null });

    const result = await signInWithStrava();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/strava/auth',
      expect.objectContaining({ method: 'POST' }),
    );
    // The URL opened is the one the SERVER returned, not one built client-side.
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      'https://strava.test/oauth',
      'duerunning://strava-auth',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/strava/auth/claim',
      expect.objectContaining({
        method: 'POST',
        // BOTH secrets: the handoff proves this device started the flow, the
        // ticket proves it is where the consent landed.
        body: JSON.stringify({ handoff: 'H1', ticket: 'T1' }),
      }),
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'magiclink' });
    expect(result).toBe('signed_in');
  });

  it('never reads a session token out of the callback deep link', async () => {
    // A token in the return URL is exactly the login-CSRF vector that was
    // removed: even if one appears there, it must be ignored in favour of the
    // claim, which is bound to this device's handoff.
    mockAuthEndpoints({ claim: jsonResponse({}, false, 404) });
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'duerunning://strava-auth?ticket=T1&token_hash=attacker-token&type=magiclink',
    });

    const result = await signInWithStrava();

    expect(result).toMatchObject({ kind: 'error' });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('errors when the claim finds no session (callback never ran, or ran for someone else)', async () => {
    mockAuthEndpoints({ claim: jsonResponse({}, false, 404) });
    openAuthSessionAsync.mockResolvedValue({ type: 'success', url: RETURN_URL });

    const result = await signInWithStrava();
    expect(result).toMatchObject({ kind: 'error' });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('refuses to claim when the callback returned no ticket', async () => {
    // The anti-RELAY property on the client half. An attacker who mints a
    // handoff and relays their authUrl to a victim never receives the ticket —
    // it goes to whichever device actually consented. Without one there is
    // nothing to claim with, so we must not even try.
    mockAuthEndpoints();
    openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'duerunning://strava-auth' });

    const result = await signInWithStrava();

    expect(result).toMatchObject({ kind: 'error' });
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://api.test/api/strava/auth/claim',
      expect.anything(),
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('errors when the flow cannot be started', async () => {
    mockAuthEndpoints({ start: jsonResponse({}, false, 500) });
    const result = await signInWithStrava();
    expect(result).toMatchObject({ kind: 'error' });
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('returns cancelled when the user dismisses the browser', async () => {
    mockAuthEndpoints();
    openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    const result = await signInWithStrava();
    expect(result).toBe('cancelled');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('surfaces an error param from the callback without attempting a claim', async () => {
    mockAuthEndpoints();
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'duerunning://strava-auth?error=access_denied',
    });
    const result = await signInWithStrava();
    expect(result).toMatchObject({ kind: 'error' });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://api.test/api/strava/auth/claim',
      expect.anything(),
    );
  });

  it('errors when verifyOtp fails', async () => {
    mockAuthEndpoints();
    openAuthSessionAsync.mockResolvedValue({ type: 'success', url: RETURN_URL });
    auth.verifyOtp.mockResolvedValue({ error: { message: 'token expired' } });
    const result = await signInWithStrava();
    expect(result).toMatchObject({ kind: 'error', message: 'token expired' });
  });
});

describe('signOut', () => {
  it('signs out without creating a new session', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });
});
