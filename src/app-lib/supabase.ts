import 'react-native-url-polyfill/auto';

import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

import { assertEnvironmentMatches } from './appEnv';
import { secureSessionStore } from './secureSessionStore';

/**
 * The Supabase client for the mileage app.
 *
 * Auth sessions are persisted in the KEYCHAIN (see `secureSessionStore`) so a
 * signed-in session survives app restarts without leaving the access and
 * long-lived refresh tokens as plaintext JSON in the app sandbox, which is what
 * the AsyncStorage adapter did until the 2026-07-28 audit.
 * `react-native-url-polyfill/auto` is imported for its side effect: it installs
 * a WHATWG `URL` implementation, which supabase-js relies on in the React
 * Native runtime.
 *
 * `EXPO_PUBLIC_*` vars are inlined by Expo at build time from the process env;
 * they are injected by `doppler run` (see AGENTS.md). The anon key is
 * public-safe, but is still kept out of git.
 */
// Resolution order: inlined EXPO_PUBLIC_* env (when the build shell exported
// them) → `extra` baked by app.config.js (populated from Doppler's native
// SUPABASE_* names — the path a plain `doppler run -- npx expo run:ios` takes).
// A build made with NEITHER is a misbuild; fail with an actionable message.
const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
};
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey;

const MISBUILD =
  'Supabase config missing from this build. Build via `npm run ios` / `npm run ' +
  'ios:release` (they wrap `node scripts/secrets.mjs`, which needs `gcloud auth ' +
  'login`) so app.config.js can bake the values.';
// A build made without the secrets env bakes `extra.*` as an empty object `{}`
// (a null in app.config.js → empty dict in the native plist), which is truthy —
// so require a real, non-empty string. Otherwise the miss surfaces as a cryptic
// "undefined is not a function" deep inside supabase-js instead of this message.
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
if (!isNonEmptyString(supabaseUrl)) throw new Error(MISBUILD);
if (!isNonEmptyString(supabaseAnonKey)) throw new Error(MISBUILD);

/**
 * The session's storage key, spelled out rather than left to the default.
 *
 * supabase-js derives `sb-<project-ref>-auth-token` from the URL. Stating it
 * here makes it explicit that the Keychain migration reads the SAME key the
 * AsyncStorage adapter wrote — deriving it differently would silently sign
 * every existing user out instead of upgrading them.
 */
const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

// The build must point where it says it points. Checked here rather than in
// `appEnv` itself so the failure lands at the same place as the other misbuild
// guards above, with the same "your config is wrong, rebuild" shape.
assertEnvironmentMatches(supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureSessionStore,
    storageKey,
    persistSession: true,
    autoRefreshToken: true,
    // No deep-link OAuth callback yet; anonymous sign-in needs no URL parsing.
    detectSessionInUrl: false,
  },
});
