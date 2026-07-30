/**
 * The Keychain session adapter (security audit 2026-07-28).
 *
 * Two properties matter more than the happy path and are what these tests are
 * really for:
 *
 *  1. NOBODY GETS SIGNED OUT by the upgrade. A pre-Keychain session sitting in
 *     AsyncStorage must be adopted on the first read, because supabase-js reads
 *     its session lazily and an app-start migration hook could lose that race.
 *  2. THE PLAINTEXT COPY GOES AWAY. Adopting without deleting the AsyncStorage
 *     original would leave exactly the token the change exists to remove.
 *
 * The SecureStore mock enforces the real 2048-byte ceiling, so a regression that
 * stopped chunking would fail here rather than only on a device.
 *
 * A NOTE ON WHAT THESE TESTS MISSED. The first implementation base64-encoded via
 * `Buffer` before chunking. Every test below passed, because Jest runs on Node
 * where `Buffer` is a global — and it broke on device, where Hermes has no such
 * thing. Unit tests cannot see a missing RUNTIME global; only launching the app
 * can. The lesson is in the launch step, not in another assertion here.
 */

const mockStore = new Map<string, string>();
const mockAsyncStore = new Map<string, string>();

const mockSecureLimit = 2048;

let mockKeychainUp = true;

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  isAvailableAsync: jest.fn(async () => mockKeychainUp),
  getItemAsync: jest.fn(async (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (new TextEncoder().encode(v).length > mockSecureLimit) {
      throw new Error(`SecureStore value too large for key ${k}`);
    }
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (mockAsyncStore.has(k) ? mockAsyncStore.get(k)! : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      mockAsyncStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockAsyncStore.delete(k);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetKeychainProbeForTests, secureSessionStore } from '../secureSessionStore';

const KEY = 'sb-divgspozifwxrshdsuqg-auth-token';

/** A realistic session: a long JWT easily clears the single-entry ceiling. */
function session(size = 4000): string {
  return JSON.stringify({
    access_token: `header.${'a'.repeat(size)}.sig`,
    refresh_token: 'r'.repeat(48),
    expires_at: 1785234481,
    user: { id: 'u1', email: 'jake@example.com' },
  });
}

beforeEach(() => {
  mockStore.clear();
  mockAsyncStore.clear();
  mockKeychainUp = true;
  __resetKeychainProbeForTests();
  jest.clearAllMocks();
});

describe('round trip', () => {
  it('stores and returns a value larger than one Keychain entry', async () => {
    const value = session();
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(mockSecureLimit);

    await secureSessionStore.setItem(KEY, value);
    expect(await secureSessionStore.getItem(KEY)).toBe(value);
  });

  it('keeps every chunk under the Keychain ceiling', async () => {
    await secureSessionStore.setItem(KEY, session(20_000));
    for (const [k, v] of mockStore) {
      expect(new TextEncoder().encode(v).length).toBeLessThanOrEqual(mockSecureLimit);
      expect(k.startsWith(KEY)).toBe(true);
    }
  });

  it('survives multi-byte characters at a chunk boundary', async () => {
    // Chunking the raw UTF-8 would split a multi-byte sequence and corrupt the
    // JSON; base64-encoding first is what makes the split safe. U+1D11E is a
    // FOUR-byte sequence (and deliberately not an emoji — the repo's no-emoji
    // guardrail scans this tree), so this exercises the widest case.
    const value = JSON.stringify({ note: '\u{1D11E}é日本語'.repeat(500) });
    await secureSessionStore.setItem(KEY, value);
    expect(await secureSessionStore.getItem(KEY)).toBe(value);
  });

  it('returns null when nothing was ever stored', async () => {
    expect(await secureSessionStore.getItem(KEY)).toBeNull();
  });

  it('round-trips an empty string distinctly from absence', async () => {
    await secureSessionStore.setItem(KEY, '');
    expect(await secureSessionStore.getItem(KEY)).toBe('');
  });
});

describe('rewrites and deletion leave nothing behind', () => {
  it('clears orphaned chunks when the new value needs fewer', async () => {
    await secureSessionStore.setItem(KEY, session(20_000));
    const wide = mockStore.size;
    await secureSessionStore.setItem(KEY, session(100));
    expect(mockStore.size).toBeLessThan(wide);
    // The tail of the long value must be gone, not merely unreferenced — a
    // stale chunk is retained session material.
    expect(await secureSessionStore.getItem(KEY)).toBe(session(100));
    // Manifest + exactly the chunks the short value needs, nothing orphaned.
    const manifest = JSON.parse(mockStore.get(KEY)!) as { chunks: number };
    expect(mockStore.size).toBe(1 + manifest.chunks);
  });

  it('removeItem deletes the manifest and every chunk', async () => {
    await secureSessionStore.setItem(KEY, session(20_000));
    await secureSessionStore.removeItem(KEY);
    expect(mockStore.size).toBe(0);
    expect(await secureSessionStore.getItem(KEY)).toBeNull();
  });

  it('reports a torn value as absent rather than returning truncated JSON', async () => {
    await secureSessionStore.setItem(KEY, session());
    mockStore.delete(`${KEY}.1`); // simulate an interrupted write
    expect(await secureSessionStore.getItem(KEY)).toBeNull();
  });
});

describe('migration off AsyncStorage', () => {
  it('adopts a pre-Keychain session on the first read, so nobody is signed out', async () => {
    const legacy = session();
    mockAsyncStore.set(KEY, legacy);

    expect(await secureSessionStore.getItem(KEY)).toBe(legacy);
  });

  it('deletes the plaintext copy once the Keychain copy reads back', async () => {
    mockAsyncStore.set(KEY, session());

    await secureSessionStore.getItem(KEY);

    expect(mockAsyncStore.has(KEY)).toBe(false);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('serves later reads from the Keychain, not AsyncStorage', async () => {
    const legacy = session();
    mockAsyncStore.set(KEY, legacy);
    await secureSessionStore.getItem(KEY);
    (AsyncStorage.getItem as jest.Mock).mockClear();

    expect(await secureSessionStore.getItem(KEY)).toBe(legacy);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('keeps the user signed in when the Keychain write fails', async () => {
    // A storage upgrade must never be the reason someone loses their session.
    const legacy = session();
    mockAsyncStore.set(KEY, legacy);
    const SecureStore = require('expo-secure-store') as { setItemAsync: jest.Mock };
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));

    expect(await secureSessionStore.getItem(KEY)).toBe(legacy);
    // And the legacy copy survives, so the next launch can retry.
    expect(mockAsyncStore.get(KEY)).toBe(legacy);
  });

  it('does not resurrect a signed-out session from a stale legacy copy', async () => {
    // Sign-out clears the Keychain; if a legacy value were still present the
    // adopt path would silently sign the user back in.
    mockAsyncStore.set(KEY, session());
    await secureSessionStore.getItem(KEY); // migrates + clears AsyncStorage
    await secureSessionStore.removeItem(KEY); // sign out

    expect(await secureSessionStore.getItem(KEY)).toBeNull();
  });
});

describe('a binary without the native module', () => {
  // expo-secure-store has a native side. A dev client built before it was added
  // has the JS shim only, and an adapter that threw there would sign the runner
  // out of a working app — the worst failure mode for auth.

  it('falls back to AsyncStorage instead of throwing', async () => {
    mockKeychainUp = false;

    await secureSessionStore.setItem(KEY, session());
    expect(await secureSessionStore.getItem(KEY)).toBe(session());
    expect(mockAsyncStore.get(KEY)).toBe(session());
    expect(mockStore.size).toBe(0); // nothing reached the Keychain
  });

  it('upgrades to the Keychain once a rebuilt binary runs', async () => {
    mockKeychainUp = false;
    await secureSessionStore.setItem(KEY, session());

    // Next launch, module present.
    mockKeychainUp = true;
    __resetKeychainProbeForTests();

    expect(await secureSessionStore.getItem(KEY)).toBe(session());
    expect(mockStore.size).toBeGreaterThan(0); // adopted into the Keychain
    expect(mockAsyncStore.has(KEY)).toBe(false); // plaintext copy gone
  });

  it('sign-out clears both homes', async () => {
    mockKeychainUp = false;
    await secureSessionStore.setItem(KEY, session()); // lands in AsyncStorage
    mockKeychainUp = true;
    __resetKeychainProbeForTests();
    await secureSessionStore.getItem(KEY); // migrates into the Keychain

    await secureSessionStore.removeItem(KEY);

    expect(mockStore.size).toBe(0);
    expect(mockAsyncStore.has(KEY)).toBe(false);
  });
});

describe('no Node-only globals leak into the runtime path', () => {
  // The bug this suite failed to catch: `Buffer` is a Jest/Node global and does
  // NOT exist in Hermes, so the encoder worked in tests and threw on device.
  it('never references Buffer in the module source', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const source: string = readFileSync(join(__dirname, '..', 'secureSessionStore.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bBuffer\b/);
    expect(code).not.toMatch(/\bprocess\./);
  });

  it('splits a 4-byte character whole or not at all', async () => {
    // U+1D11E is 4 UTF-8 bytes. Repeated past the chunk boundary, a naive
    // slice would tear one in half and corrupt the value on reassembly.
    const value = '\u{1D11E}'.repeat(2000);
    await secureSessionStore.setItem(KEY, value);
    expect(await secureSessionStore.getItem(KEY)).toBe(value);
    for (const [k, v] of mockStore) {
      if (k === KEY) continue;
      expect(v).not.toMatch(/[\uD800-\uDBFF]$/); // no dangling high surrogate
      expect(v).not.toMatch(/^[\uDC00-\uDFFF]/); // no orphaned low surrogate
    }
  });
});
