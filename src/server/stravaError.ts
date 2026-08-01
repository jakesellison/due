/**
 * The typed Strava HTTP error, kept in its OWN module rather than alongside the
 * fetch helpers in `strava.ts`.
 *
 * Two reasons. Layering: the error shape is part of the contract every caller
 * classifies against, not part of the HTTP client. And practically: several test
 * suites `jest.mock('../strava')`, which replaces the whole module — if the
 * class lived there, any `err instanceof StravaHttpError` in production code
 * would evaluate against `undefined` under those mocks and throw. Importing the
 * type from here keeps a single class identity in every context.
 */

/**
 * Which Strava call failed. Carried on {@link StravaHttpError} so classifiers
 * can key off the OPERATION as well as the status — a 401 from a token refresh
 * means "grant revoked", the same 401 from an activity fetch does not.
 */
export type StravaOperation = 'token-exchange' | 'token-refresh' | 'activity' | 'streams';

/**
 * A non-ok HTTP response from Strava, carrying the status as a NUMBER.
 *
 * Callers used to recover the status by regex-matching the message
 * (`err.message.includes(' 429')`), which silently mis-classified any error
 * whose text happened to contain the digits — and, worse, made "couldn't tell"
 * indistinguishable from "not a rate limit". The structured `status`/`operation`
 * pair is the supported way to classify; the message format is preserved
 * verbatim so logs and the legacy regex fallbacks still read the same.
 */
export class StravaHttpError extends Error {
  readonly status: number;
  readonly operation: StravaOperation;
  /** Seconds until the exhausted rate-limit window resets, when the 429
   *  response carried enough header signal to compute it (see
   *  `retryAfterSeconds` in strava.ts). Undefined for non-429 errors. */
  readonly retryAfterS?: number;

  constructor(operation: StravaOperation, status: number, message: string, retryAfterS?: number) {
    super(message);
    this.name = 'StravaHttpError';
    this.status = status;
    this.operation = operation;
    this.retryAfterS = retryAfterS;
  }
}

/** True when `err` is a Strava rate-limit (429) response. */
export function isStravaRateLimited(err: unknown): boolean {
  return err instanceof StravaHttpError && err.status === 429;
}

/**
 * The back-off to report for a rate-limited call: the window-derived value the
 * 429 response carried, else the historical fixed 900s guess. Callers stop
 * hardcoding 900 so the app resumes when Strava actually resets, not a fixed
 * quarter-hour after whenever we happened to hit the wall.
 */
export function stravaRetryAfterS(err: unknown, fallbackS = 900): number {
  return err instanceof StravaHttpError && err.retryAfterS != null ? err.retryAfterS : fallbackS;
}

/**
 * True when Strava affirmatively reported the resource is GONE (404/410) —
 * the only statuses that may be read as "this activity no longer exists".
 * Every other failure (429, 5xx, 401, network) is inconclusive and must NOT
 * be treated as a deletion.
 */
export function isStravaNotFound(err: unknown): boolean {
  return err instanceof StravaHttpError && (err.status === 404 || err.status === 410);
}
