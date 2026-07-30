import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string | null };

// Last-resort fallback is the CUSTOM domain (Cloudflare-fronted, survives a
// service re-create) — the raw Cloud Run hash URL lives on only as the purge
// cron's OIDC audience, never as an app-facing base.
const RESOLVED_API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  extra.apiBaseUrl ??
  'https://api.due.run';

// Normalize any raw Cloud Run host (e.g. a stale `due-api-…-uc.a.run.app`
// baked into a dev build's `extra` before the config was pointed at the custom
// domain) to api.due.run — the Cloudflare-fronted canonical host for the SAME
// service. This self-heals a stale baked base on a plain JS reload (no Metro
// restart) and keeps the ugly hash host out of the OAuth consent dialog.
export const API_BASE = /\.run\.app(\/|$)/.test(RESOLVED_API_BASE)
  ? 'https://api.due.run'
  : RESOLVED_API_BASE;

/**
 * Shared client-side fetch resilience.
 *
 * Bare `fetch` has no timeout, so a stalled connection (or a long server task
 * that never responds) hangs the calling screen forever. It also has no retry,
 * so a transient blip rejects the whole call. `resilientFetch` wraps `fetch`
 * with:
 *
 *  - an `AbortController` TIMEOUT (default 30s for normal status probes; plan
 *    parse/revise pass a much longer `timeoutMs` since generation legitimately
 *    runs ~210s and must not be killed mid-flight), and
 *  - bounded EXPONENTIAL-BACKOFF retry for transient failures (network error /
 *    timeout / 5xx). Retry is OPT-IN per call (`retries`): it's only safe for
 *    idempotent reads and idempotent/resumable upserts. The billable plan
 *    parse/revise POST passes `retries: 0` — a long timeout but no auto-retry,
 *    so a slow generation isn't re-triggered as a second 200s+ billable call.
 *
 * On timeout the rejection is a clear `Error` (not a silent hang) so callers
 * surface their existing error shape to the UI.
 */

/** Default request timeout for normal status/probe calls. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ResilientFetchOptions extends RequestInit {
  /** Abort the request after this many ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Number of RETRIES (in addition to the first attempt) on transient failures
   * (network/timeout/5xx). Defaults to 0 (no retry). Only set > 0 for idempotent
   * calls — never for non-idempotent or billable POSTs.
   */
  retries?: number;
  /** Base backoff in ms; doubles each retry (200, 400, …). */
  backoffMs?: number;
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** True for failures worth retrying: network/abort errors and 5xx responses. */
function isRetriableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` with an AbortController timeout and optional bounded backoff retry.
 * Resolves with the `Response` (including non-retriable error statuses like
 * 4xx, which callers inspect); rejects with a {@link TimeoutError} on timeout or
 * the underlying network error once retries are exhausted.
 */
export async function resilientFetch(
  input: string,
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    backoffMs = 200,
    ...init
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      // A 5xx is transient: retry if budget remains, else hand the response back
      // so the caller can read its error body / status as before.
      if (isRetriableStatus(res.status) && attempt < retries) {
        lastError = new Error(`Request failed (${res.status})`);
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      // `abort()` surfaces as an AbortError; normalize timeouts to TimeoutError.
      lastError = controller.signal.aborted ? new TimeoutError(timeoutMs) : err;
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable in practice (loop either returns or throws), but satisfies TS.
  throw lastError ?? new Error('Request failed');
}
