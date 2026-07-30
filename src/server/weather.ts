/**
 * Best-effort historical-temperature lookup via the open-meteo archive API.
 *
 * Free, no API key. Used to backfill `avg_temp_c` on ingest when Strava itself
 * didn't supply `average_temp`. This is STRICTLY best-effort: every failure mode
 * (network error, timeout, non-200, malformed payload, no nearby hour) returns
 * null so it can never block or fail an ingest.
 *
 * The network call is injected via the `fetchImpl` parameter so the module is
 * mockable in tests — we do NOT hit the network in unit tests.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const TIMEOUT_MS = 5000;

/** The slice of the open-meteo response we read. */
interface ArchiveResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
  };
}

/** UTC ISO instant -> 'YYYY-MM-DD' (date portion, UTC). */
function isoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * The archive API returns hour stamps in GMT/UTC but WITHOUT a zone designator
 * (e.g. '2024-06-01T12:00'). Normalize to an explicit-UTC ISO so it isn't parsed
 * in the host's local timezone. Strings that already carry a zone pass through.
 */
function asUtcIso(s: string): string {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s;
  // Ensure seconds are present, then append 'Z'.
  const withSeconds = /T\d\d:\d\d$/.test(s) ? `${s}:00` : s;
  return `${withSeconds}Z`;
}

/**
 * Fetch the temperature (°C) nearest `isoTime` at (lat, lng) from the open-meteo
 * archive. Returns null on ANY failure. IO (but injectable for tests).
 *
 * @param lat      latitude
 * @param lng      longitude
 * @param isoTime  UTC ISO instant of the activity start
 * @param fetchImpl injected fetch (defaults to global fetch) — for testing
 */
export async function fetchTempC(
  lat: number,
  lng: number,
  isoTime: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const target = new Date(isoTime).getTime();
  if (Number.isNaN(target)) return null;

  const date = isoDate(isoTime);
  const url =
    `${ARCHIVE_URL}?latitude=${lat}&longitude=${lng}` +
    `&start_date=${date}&end_date=${date}&hourly=temperature_2m`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as ArchiveResponse;
    const times = json.hourly?.time;
    const temps = json.hourly?.temperature_2m;
    if (!times || !temps || times.length === 0) return null;

    // Pick the hour whose timestamp is nearest the activity start. The archive
    // API returns hour stamps in GMT/UTC but WITHOUT a trailing 'Z'; append one
    // so they're parsed as UTC rather than the host's local timezone.
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(asUtcIso(times[i]!)).getTime();
      if (Number.isNaN(t)) continue;
      const diff = Math.abs(t - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    const temp = temps[bestIdx];
    return typeof temp === 'number' && Number.isFinite(temp) ? temp : null;
  } catch {
    // Network error, abort/timeout, JSON parse error — all best-effort nulls.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
