/**
 * Snap a straight segment between two waypoints onto the real walking network
 * using OSRM's foot router. Pure-ish: the network call goes through an injected
 * `fetchImpl` (defaults to the global `fetch`) so it's unit-testable with mocks.
 *
 * Development falls back to the public OSRM foot service. Production builds
 * should set EXPO_PUBLIC_ROUTE_SNAP_URL to a controlled OSRM-compatible proxy;
 * exact route endpoints are location data and must not be sent to an
 * uncontracted community service.
 *
 * Resilience contract: ANY failure (network error, timeout, non-200, malformed
 * body, empty geometry) resolves to `null`. The caller decides whether to retry
 * or explicitly accept a straight segment.
 */

import {
  haversineMeters,
  type LatLng,
} from './geo';

const PUBLIC_OSRM_FOOT_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const CONFIGURED_OSRM_FOOT_BASE = process.env.EXPO_PUBLIC_ROUTE_SNAP_URL?.trim() || null;
const OSRM_FOOT_BASE = CONFIGURED_OSRM_FOOT_BASE
  ? CONFIGURED_OSRM_FOOT_BASE.replace(/\/+$/, '')
  : process.env.NODE_ENV === 'production'
    ? null
    : PUBLIC_OSRM_FOOT_BASE;

/** Production fails closed unless a controlled routing endpoint is configured. */
export const routeSnapAvailable = OSRM_FOOT_BASE != null;

const TIMEOUT_MS = 5000;

export interface SnapResult {
  /** The snapped polyline as [[lat,lng],...], including both endpoints. */
  path: LatLng[];
  /** Route distance in metres reported by OSRM. */
  distanceMeters: number;
}

/** Minimal shape of the OSRM `route` response we read. */
interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    geometry?: { coordinates?: [number, number][] };
  }>;
}

/**
 * Snap the `from → to` segment to walkable paths. Returns the snapped polyline +
 * distance, or `null` on any failure.
 *
 * @param fetchImpl injected fetch (defaults to global `fetch`) — for tests.
 */
export async function snapSegment(
  from: LatLng,
  to: LatLng,
  fetchImpl?: typeof fetch,
): Promise<SnapResult | null> {
  const doFetch = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (!doFetch || !OSRM_FOOT_BASE) return null;

  // OSRM takes coordinates as {lng},{lat} pairs separated by ';'.
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `${OSRM_FOOT_BASE}/${coords}?overview=full&geometries=geojson`;

  // AbortController gives the 5s timeout; we always clear the timer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await doFetch(url, { signal: controller.signal });
    if (!res || !res.ok) return null;

    const body = (await res.json()) as OsrmResponse;
    const route = body?.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) return null;

    // GeoJSON is [lng, lat]; convert to our [lat, lng] convention.
    const path: LatLng[] = coordinates.map(([lng, lat]) => [lat, lng]);

    // Prefer OSRM's reported distance; fall back to measuring the polyline if
    // the field is missing/non-finite.
    const reported = route?.distance;
    const distanceMeters =
      typeof reported === 'number' && Number.isFinite(reported)
        ? reported
        : measure(path);

    return { path, distanceMeters };
  } catch {
    // Network error, abort/timeout, or JSON parse failure.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Local polyline length (haversine sum) — used only when OSRM omits distance. */
function measure(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}
