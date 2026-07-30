/**
 * secureSessionStore.ts — the Keychain-backed storage adapter Supabase auth uses.
 *
 * WHY (security audit 2026-07-28, medium). The client persisted its session with
 * the AsyncStorage adapter, which writes plain JSON into the app sandbox. That
 * file holds the access token AND the long-lived REFRESH token, so anything that
 * can read the sandbox — an unencrypted local/iCloud backup, a jailbroken
 * device, forensic tooling — recovers a credential that mints valid JWTs for all
 * of the runner's training and health data until they sign out. The choice
 * predated real identities (its comment still said "dev: anonymous"), and was
 * never revisited when Strava sign-in landed.
 *
 * WHY CHUNKS RATHER THAN THE DOCUMENTED "LargeSecureStore". Supabase's own
 * workaround for SecureStore's 2048-byte ceiling is to keep an AES key in the
 * Keychain and the CIPHERTEXT in AsyncStorage. That still leaves the session on
 * disk in the sandbox, and adds a crypto dependency whose failure modes we would
 * own. Splitting the value across several Keychain entries keeps every byte in
 * the Keychain and needs no crypto library at all. The cost is a manifest read
 * per load, which is negligible next to the network calls it gates.
 *
 * CHUNKING IS BY CODE POINT WITH A BYTE BUDGET. The first version base64-encoded
 * the payload first (so one character equalled one byte) using `Buffer` — which
 * does not exist in Hermes. It survived review and unit tests because Jest runs
 * on Node, where `Buffer` is a global; it failed on device the moment the
 * Keychain path actually engaged. Iterating the string with `for…of` walks whole
 * code points, so a split can never land inside a multi-byte sequence or between
 * the halves of a surrogate pair, and no encoding layer is needed at all.
 *
 * Accessibility is WHEN_UNLOCKED_THIS_DEVICE_ONLY: the token is unreadable while
 * the device is locked, and — the point of the exercise — it is excluded from
 * backups, so it cannot be lifted out of one and replayed on another device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Bytes per Keychain entry. iOS rejects values over 2048; the margin absorbs the
 * per-chunk key overhead and keeps us clear of the cliff if the limit is ever
 * interpreted as including metadata.
 */
const CHUNK_SIZE = 1536;

/** Keychain accessibility — locked-device safe AND excluded from backups. */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * The manifest stored at the caller's own key: how many chunks follow. Kept as a
 * tiny JSON object rather than a bare number so a future field (a format
 * version, say) does not require another migration.
 */
interface Manifest {
  chunks: number;
}

/**
 * Is the Keychain actually reachable in THIS binary?
 *
 * `expo-secure-store` has a native module, so a JS-only reload of a dev client
 * built before it was added has the JS shim but no native side, and every call
 * throws. A storage adapter that throws is the worst possible failure for auth:
 * supabase-js cannot read the session and the runner is silently signed out of
 * a working app.
 *
 * So availability is probed once and cached. When the Keychain is missing we
 * fall back to AsyncStorage — i.e. the previous behaviour — which keeps people
 * signed in on an un-rebuilt client at the old (weaker) security level, and
 * upgrades itself automatically on the first launch of a binary that has the
 * module. The warning is deliberately loud: silently running without the
 * Keychain is exactly the state this module exists to end.
 */
let keychainAvailable: Promise<boolean> | null = null;

function keychainReady(): Promise<boolean> {
  keychainAvailable ??= (async () => {
    try {
      const ok = await SecureStore.isAvailableAsync();
      if (!ok) console.warn('[auth] Keychain unavailable — sessions fall back to AsyncStorage.');
      return ok;
    } catch {
      console.warn('[auth] expo-secure-store native module missing (rebuild the dev client) — sessions fall back to AsyncStorage.');
      return false;
    }
  })();
  return keychainAvailable;
}

/** Reset the cached probe. Tests only. */
export function __resetKeychainProbeForTests(): void {
  keychainAvailable = null;
}

/** SecureStore keys allow [A-Za-z0-9._-] only; Supabase's keys already comply. */
const chunkKey = (key: string, index: number): string => `${key}.${index}`;

/** UTF-8 byte length of a single code point — what the Keychain limit counts. */
function utf8Length(codePoint: string): number {
  const cp = codePoint.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Split into chunks that each fit the byte budget, never breaking a code point.
 *
 * `for…of` over a string iterates CODE POINTS, not UTF-16 code units, so a
 * 4-byte character is carried across whole or not at all.
 */
function split(payload: string, maxBytes: number = CHUNK_SIZE): string[] {
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const character of payload) {
    const size = utf8Length(character);
    if (currentBytes + size > maxBytes && current !== '') {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += size;
  }
  // Always push the tail — and for an empty payload that yields one empty
  // chunk, so `getItem` can tell "stored an empty string" from "nothing stored".
  parts.push(current);
  return parts;
}

function parseManifest(raw: string | null): Manifest | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const chunks = (parsed as { chunks?: unknown }).chunks;
      if (typeof chunks === 'number' && Number.isInteger(chunks) && chunks >= 0) {
        return { chunks };
      }
    }
  } catch {
    // Not our manifest — fall through.
  }
  return null;
}

/**
 * Remove every chunk from `from` up to (but not including) `to`. Used both to
 * delete a value and to clear the tail when a rewrite needs fewer chunks than
 * the value it replaces — without which a shorter session would leave orphaned
 * chunks in the Keychain forever.
 */
async function deleteChunks(key: string, from: number, to: number): Promise<void> {
  const deletions: Promise<void>[] = [];
  for (let i = from; i < to; i += 1) {
    deletions.push(SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS));
  }
  await Promise.all(deletions);
}

/**
 * How many chunks to probe for when clearing a key whose manifest is gone. A
 * session that needed more than this many chunks would be ~150 KB, which no
 * Supabase session approaches; the bound just stops a corrupt manifest from
 * turning cleanup into an unbounded loop.
 */
const MAX_STALE_PROBE = 100;

export const secureSessionStore = {
  async getItem(key: string): Promise<string | null> {
    if (!(await keychainReady())) return AsyncStorage.getItem(key);
    const manifest = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
    // Nothing in the Keychain may mean "signed out" OR "this install predates
    // Keychain storage". Adopting the legacy value HERE rather than in an
    // app-start hook is what makes the migration race-free: supabase-js reads
    // its session lazily, so any separate hook could lose to that read and sign
    // the runner out. The first read IS the migration.
    if (manifest == null) return adoptLegacySession(key);

    const parts = await Promise.all(
      Array.from({ length: manifest.chunks }, (_, i) =>
        SecureStore.getItemAsync(chunkKey(key, i), OPTIONS)),
    );
    // A missing chunk means the value is torn (an interrupted write, or a
    // partially-cleared Keychain). Report "no session" rather than hand
    // supabase-js truncated JSON it would throw on.
    if (parts.some((part) => part == null)) return null;

    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!(await keychainReady())) return AsyncStorage.setItem(key, value);
    const parts = split(value);

    // Write the chunks BEFORE the manifest. A crash mid-write then leaves the
    // old manifest pointing at a mix of old and new chunks, which `getItem`
    // surfaces as a torn read (null) — a signed-out user, recoverable by
    // signing in. The reverse order could leave a manifest promising chunks
    // that were never written.
    await Promise.all(
      parts.map((part, i) => SecureStore.setItemAsync(chunkKey(key, i), part, OPTIONS)),
    );

    const previous = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
    await SecureStore.setItemAsync(
      key,
      JSON.stringify({ chunks: parts.length } satisfies Manifest),
      OPTIONS,
    );

    if (previous != null && previous.chunks > parts.length) {
      await deleteChunks(key, parts.length, previous.chunks);
    }
  },

  async removeItem(key: string): Promise<void> {
    // Clear BOTH homes: a sign-out must not leave a session behind in whichever
    // store this binary happens not to be using.
    await AsyncStorage.removeItem(key);
    if (!(await keychainReady())) return;
    const manifest = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
    // With no manifest we cannot know the chunk count, so probe a bounded range:
    // leaving chunks behind would leave session material in the Keychain, which
    // is the whole thing this module exists to prevent.
    const count = manifest?.chunks ?? MAX_STALE_PROBE;
    await SecureStore.deleteItemAsync(key, OPTIONS);
    await deleteChunks(key, 0, count);
  },
};

/**
 * Adopt a pre-Keychain session that is still sitting in AsyncStorage.
 *
 * Without this, shipping the new adapter signs everybody out — the client would
 * look in the Keychain, find nothing, and treat them as new.
 *
 * The AsyncStorage copy is deleted once the Keychain copy reads back intact.
 * That deletion is the point of the exercise: leaving it would preserve the
 * exact plaintext refresh token this module exists to remove.
 *
 * Best-effort. If the Keychain is unavailable we return the legacy value so the
 * runner stays signed in on the old footing rather than being logged out by a
 * storage upgrade; the next launch tries again.
 */
async function adoptLegacySession(key: string): Promise<string | null> {
  let legacy: string | null = null;
  try {
    legacy = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (legacy == null) return null;

  try {
    await secureSessionStore.setItem(key, legacy);
    // Read the chunks back before dropping the only other copy.
    const roundTripped = await readChunks(key);
    if (roundTripped !== legacy) return legacy;
    await AsyncStorage.removeItem(key);
  } catch {
    return legacy; // still signed in, just not upgraded yet
  }
  return legacy;
}

/** Reassemble a value from its chunks, or null if the manifest/chunks are gone. */
async function readChunks(key: string): Promise<string | null> {
  const manifest = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
  if (manifest == null) return null;
  const parts = await Promise.all(
    Array.from({ length: manifest.chunks }, (_, i) =>
      SecureStore.getItemAsync(chunkKey(key, i), OPTIONS)),
  );
  if (parts.some((part) => part == null)) return null;
  return parts.join('');
}
