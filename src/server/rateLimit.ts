/**
 * A small fixed-window rate limiter for the API's abusable endpoints.
 *
 * SCOPE — this is deliberately IN-PROCESS. Cloud Run may run several instances,
 * so the effective ceiling is `limit × instances`, not `limit`. That is fine for
 * what this is for: stopping one client from trivially hammering an
 * unauthenticated endpoint or burning the app-wide Strava quota from a single
 * loop. It is NOT a defence against a distributed attacker — that belongs at the
 * edge (Cloudflare rate-limiting rules on `api.due.run`), which should be
 * configured as well. Treat this as the floor, not the ceiling.
 *
 * Keyed by user id when the caller is authenticated (the meaningful unit for
 * quota-consuming endpoints) and by client IP otherwise.
 */

import type { ApiRequest, ApiResponse } from './httpTypes';

export interface RateLimitOptions {
  /** Namespace, so two endpoints don't share a bucket. */
  key: string;
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Identity to bucket by. Defaults to the client IP; pass a user id for
   * authenticated endpoints so one user can't multiply their quota by
   * reconnecting from new addresses.
   */
  subject?: string;
}

interface Bucket {
  count: number;
  /** Epoch ms at which this window closes and the count resets. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Sweep threshold. Expired buckets are cleaned lazily rather than on a timer so
 * the module holds no handles (important in tests and in a scale-to-zero
 * runtime); the map only grows to the number of distinct subjects seen inside
 * one window.
 */
const SWEEP_EVERY = 512;
let sinceSweep = 0;

/**
 * The client's address, used as the bucket subject for unauthenticated limits.
 *
 * TOPOLOGY (this is the whole subtlety). The API is served from Cloud Run
 * BEHIND Cloudflare (`api.due.run`). The previous implementation took the
 * left-most `x-forwarded-for` entry on the stated assumption that "on Cloud Run
 * the header is REWRITTEN by the front end" — but with Cloudflare in front,
 * both hops APPEND, so the left-most entry is whatever the caller sent. Every
 * IP-bucketed limit was therefore evadable by rotating a fake header, on
 * exactly the unauthenticated endpoints where the limit is the only control.
 *
 * `cf-connecting-ip` is the fix: Cloudflare sets it to the true visitor address
 * and strips any client-supplied copy, so it cannot be forged by the caller.
 * Only when it is absent do we fall back to `x-forwarded-for` — and then to the
 * RIGHT-most entry, which is the one appended by the nearest trusted proxy
 * rather than the one the client chose.
 *
 * The durable control is still a Cloudflare rate-limiting rule at the edge;
 * this is defence behind it.
 */
export function clientIp(req: ApiRequest): string {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
  };

  const cf = header('cf-connecting-ip');
  if (cf) return cf;

  const forwarded = header('x-forwarded-for');
  if (forwarded) {
    // Right-most: appended by the closest proxy, so it is the first value the
    // client could not have written. Left-most is caller-controlled.
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }
  const socket = (req as unknown as { socket?: { remoteAddress?: string } }).socket;
  return socket?.remoteAddress ?? 'unknown';
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the current window closes. */
  retryAfterS: number;
}

/** Pure-ish core: record a hit and report whether it is within budget. */
export function consume(
  bucketKey: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitDecision {
  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const existing = buckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterS: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const retryAfterS = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { allowed: existing.count <= limit, retryAfterS };
}

/**
 * Enforce a limit for this request. Returns true when the caller may proceed;
 * on refusal it has already sent a 429 with `Retry-After` and the caller must
 * return immediately.
 */
export function rateLimit(
  req: ApiRequest,
  res: ApiResponse,
  options: RateLimitOptions,
): boolean {
  const subject = options.subject ?? clientIp(req);
  const decision = consume(
    `${options.key}:${subject}`,
    options.limit,
    options.windowMs,
  );
  if (decision.allowed) return true;

  res
    .status(429)
    .setHeader('Retry-After', String(decision.retryAfterS))
    .json({ error: 'Too many requests', retryAfterS: decision.retryAfterS });
  return false;
}

/** Test seam — drop all buckets. */
export function __resetRateLimits(): void {
  buckets.clear();
  sinceSweep = 0;
}
