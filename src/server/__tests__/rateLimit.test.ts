import { consume, clientIp, __resetRateLimits } from '../rateLimit';
import type { ApiRequest } from '../httpTypes';

beforeEach(() => __resetRateLimits());

const NOW = 1_700_000_000_000;

describe('consume', () => {
  it('allows up to the limit and refuses beyond it', () => {
    for (let i = 0; i < 3; i++) {
      expect(consume('k:subject', 3, 60_000, NOW).allowed).toBe(true);
    }
    expect(consume('k:subject', 3, 60_000, NOW).allowed).toBe(false);
  });

  it('resets once the window rolls over', () => {
    consume('k:subject', 1, 60_000, NOW);
    expect(consume('k:subject', 1, 60_000, NOW).allowed).toBe(false);
    expect(consume('k:subject', 1, 60_000, NOW + 60_001).allowed).toBe(true);
  });

  it('keeps separate buckets per subject', () => {
    consume('k:alice', 1, 60_000, NOW);
    expect(consume('k:alice', 1, 60_000, NOW).allowed).toBe(false);
    expect(consume('k:bob', 1, 60_000, NOW).allowed).toBe(true);
  });

  it('keeps separate buckets per endpoint key', () => {
    consume('auth:alice', 1, 60_000, NOW);
    expect(consume('claim:alice', 1, 60_000, NOW).allowed).toBe(true);
  });

  it('reports the seconds remaining in the window on refusal', () => {
    consume('k:s', 1, 60_000, NOW);
    const decision = consume('k:s', 1, 60_000, NOW + 30_000);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterS).toBe(30);
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, unknown>, remoteAddress?: string) =>
    ({ headers, socket: { remoteAddress } }) as unknown as ApiRequest;

  it('prefers cf-connecting-ip, which Cloudflare sets and the caller cannot forge', () => {
    expect(clientIp(req({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': 'attacker-chosen, 203.0.113.7, 10.0.0.1',
    }))).toBe('203.0.113.7');
  });

  it('takes the RIGHT-most x-forwarded-for hop when Cloudflare has not set its header', () => {
    // Both Cloudflare and the Cloud Run front end APPEND, so the left-most
    // entry is whatever the caller wrote — bucketing on it let an attacker
    // rotate a fake header and evade every unauthenticated limit.
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('does not let a spoofed left-most entry change the bucket', () => {
    const spoofed = clientIp(req({ 'x-forwarded-for': 'fake-1, 198.51.100.9' }));
    const alsoSpoofed = clientIp(req({ 'x-forwarded-for': 'fake-2, 198.51.100.9' }));
    expect(spoofed).toBe(alsoSpoofed);
  });

  it('handles a header delivered as an array', () => {
    expect(clientIp(req({ 'x-forwarded-for': ['203.0.113.7'] }))).toBe('203.0.113.7');
  });

  it('falls back to the socket address', () => {
    expect(clientIp(req({}, '198.51.100.4'))).toBe('198.51.100.4');
  });

  it('degrades to a constant rather than throwing when nothing is known', () => {
    // A single shared bucket is the safe failure mode here: it over-limits
    // rather than handing every caller an unlimited private bucket.
    expect(clientIp(req({}))).toBe('unknown');
  });

  it('ignores a blank forwarded header', () => {
    expect(clientIp(req({ 'x-forwarded-for': '   ' }, '198.51.100.4'))).toBe('198.51.100.4');
  });
});
