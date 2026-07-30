import { signState, verifyState, STATE_TTL_MS } from '../state';

const SECRET = 'state-signing-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const HANDOFF_HASH = 'a'.repeat(64);
const NOW = 1_700_000_000_000;

/** Split a signed state into its five fields (payload may contain dots). */
function parts(state: string): {
  payload: string;
  handoffHash: string;
  nonce: string;
  iat: string;
  sig: string;
} {
  const all = state.split('.');
  return {
    payload: all.slice(0, all.length - 4).join('.'),
    handoffHash: all[all.length - 4] ?? '',
    nonce: all[all.length - 3] ?? '',
    iat: all[all.length - 2] ?? '',
    sig: all[all.length - 1] ?? '',
  };
}

describe('signState / verifyState', () => {
  it('round-trips the payload and handoff hash', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    expect(verifyState(state, SECRET, NOW)).toEqual({
      payload: USER_ID,
      handoffHash: HANDOFF_HASH,
    });
  });

  it('returns null for a wrong secret', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    expect(verifyState(state, 'other-secret', NOW)).toBeNull();
  });

  it('is NOT deterministic — the same inputs produce a different state each time', () => {
    // The old implementation was a plain HMAC of the payload, so a given user's
    // state was one eternal constant that could be replayed forever. The nonce
    // is what makes each flow's state unguessable and single-purpose.
    const a = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    const b = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    expect(a).not.toBe(b);
    expect(parts(a).nonce).not.toBe(parts(b).nonce);
  });

  it('expires after the TTL', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    expect(verifyState(state, SECRET, NOW + STATE_TTL_MS - 1)).not.toBeNull();
    expect(verifyState(state, SECRET, NOW + STATE_TTL_MS + 1)).toBeNull();
  });

  it('rejects a state issued in the future beyond the skew allowance', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW + 10 * 60_000);
    expect(verifyState(state, SECRET, NOW)).toBeNull();
  });

  it('rejects a re-signed but stale issued-at (TTL is not forgeable without the secret)', () => {
    const stale = signState(USER_ID, HANDOFF_HASH, SECRET, NOW - STATE_TTL_MS - 1);
    expect(verifyState(stale, SECRET, NOW)).toBeNull();
  });

  it('returns null when the payload is tampered but the old sig is kept', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    const p = parts(state);
    const flipped = (p.payload[0] === '0' ? '1' : '0') + p.payload.slice(1);
    const forged = `${flipped}.${p.handoffHash}.${p.nonce}.${p.iat}.${p.sig}`;
    expect(verifyState(forged, SECRET, NOW)).toBeNull();
  });

  it('returns null when the handoff hash is swapped', () => {
    // The binding between a flow and its device lives in this field, so it must
    // not be substitutable without invalidating the signature.
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    const p = parts(state);
    const forged = `${p.payload}.${'b'.repeat(64)}.${p.nonce}.${p.iat}.${p.sig}`;
    expect(verifyState(forged, SECRET, NOW)).toBeNull();
  });

  it('returns null when the issued-at is extended to dodge expiry', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW - STATE_TTL_MS - 1);
    const p = parts(state);
    const forged = `${p.payload}.${p.handoffHash}.${p.nonce}.${NOW}.${p.sig}`;
    expect(verifyState(forged, SECRET, NOW)).toBeNull();
  });

  it('returns null for a tampered / garbage signature', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    const p = parts(state);
    const body = `${p.payload}.${p.handoffHash}.${p.nonce}.${p.iat}`;
    expect(verifyState(`${body}.deadbeef`, SECRET, NOW)).toBeNull();
    expect(verifyState(`${body}.${'A'.repeat(43)}`, SECRET, NOW)).toBeNull();
  });

  it('returns null for malformed state without throwing', () => {
    expect(verifyState('', SECRET, NOW)).toBeNull();
    expect(verifyState('no-dot-here', SECRET, NOW)).toBeNull();
    expect(verifyState('.', SECRET, NOW)).toBeNull();
    expect(verifyState('payload.', SECRET, NOW)).toBeNull();
    expect(verifyState('.sig', SECRET, NOW)).toBeNull();
    expect(verifyState('a.b.c.d', SECRET, NOW)).toBeNull();
    expect(verifyState('a.b.c.d.e', SECRET, NOW)).toBeNull();
  });

  it('round-trips a payload that itself contains dots (splits from the right)', () => {
    const dottyId = 'user.with.dots';
    const state = signState(dottyId, HANDOFF_HASH, SECRET, NOW);
    expect(verifyState(state, SECRET, NOW)).toEqual({
      payload: dottyId,
      handoffHash: HANDOFF_HASH,
    });
  });

  it('rejects a non-numeric issued-at', () => {
    const state = signState(USER_ID, HANDOFF_HASH, SECRET, NOW);
    const p = parts(state);
    const forged = `${p.payload}.${p.handoffHash}.${p.nonce}.nope.${p.sig}`;
    expect(verifyState(forged, SECRET, NOW)).toBeNull();
  });
});
