import Constants from 'expo-constants';

/**
 * Defensive Sentry wiring for the client (audit-ops B3). `@sentry/react-native`
 * is a normal JS dependency (its `require` always resolves), but the native
 * module it wraps is only present once a dev client / release build has been
 * rebuilt with the Expo config plugin baked in — the sim dev-clients in use
 * right now predate that rebuild. Every entry point below is wrapped so a
 * missing/broken native module degrades to "reporting disabled, app boots
 * normally" and never crashes app startup or the error boundary itself.
 *
 * Resolution order mirrors `supabase.ts`/`maps.ts`: inlined `EXPO_PUBLIC_*` env
 * (Metro inlines it at build time under `doppler run`) falling back to
 * `extra.sentryDsn` baked by app.config.js. Unlike Supabase, absence is NOT a
 * misbuild — crash reporting is an optional feature, so no throw here.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { sentryDsn?: string | null };
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? extra.sentryDsn ?? null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SentryModule = any;

let sentryModule: SentryModule | null = null;
let loadAttempted = false;
let initialized = false;

function loadSentry(): SentryModule | null {
  if (loadAttempted) return sentryModule;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentryModule = require('@sentry/react-native');
  } catch {
    sentryModule = null;
  }
  return sentryModule;
}

/**
 * Initializes Sentry once, at app boot. No-op (never throws) if the DSN is
 * absent or the native module isn't available yet. Errors-only for now:
 * `tracesSampleRate: 0`, no session replay, no profiling.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  if (!dsn) return;
  try {
    const Sentry = loadSentry();
    if (!Sentry?.init) return;
    Sentry.init({
      dsn,
      enabled: true,
      tracesSampleRate: 0,
      // Simulator/dev-session noise must not pollute the stream beta alert
      // rules read — rules filter on environment:production.
      environment: __DEV__ ? 'development' : 'production',
    });
  } catch {
    // Reporting must never crash app boot.
  }
}

/**
 * Attach (or clear) the signed-in user's id so Sentry's "users affected"
 * counts are real. Id only — no email/name (PII stays out of events). Same
 * defensive contract as the rest of this module: never throws.
 */
export function setSentryUser(userId: string | null): void {
  if (!dsn) return;
  try {
    const Sentry = loadSentry();
    if (!Sentry?.setUser) return;
    Sentry.setUser(userId ? { id: userId } : null);
  } catch {
    // Never let reporting failure break the caller.
  }
}

/** Reports a caught error. Safe no-op if not configured/available — must
 * never throw from inside the error boundary's fallback path. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!dsn) return;
  try {
    const Sentry = loadSentry();
    if (!Sentry?.captureException) return;
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never let reporting failure break the caller.
  }
}
