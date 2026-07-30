/**
 * Pure route geometry — no React, no RN, no network. Everything the route
 * builder/viewer needs to measure and shape a drawn route, kept here so it runs
 * under the node ts-jest project and is exhaustively unit-tested.
 *
 * Coordinate convention throughout: a point is `[lat, lng]` (latitude first),
 * matching the rest of the app (RouteCard, activity routes). Distances are in
 * metres.
 */

import {
  METERS_PER_MILE,
} from '../units';

export type LatLng = [number, number];

const EARTH_RADIUS_M = 6371008.8; // IUGG mean Earth radius.

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two `[lat, lng]` points, in metres (haversine).
 * Symmetric; returns 0 for identical points. At these (running) scales the
 * spherical-Earth error is negligible.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cumulative path length: the sum of haversine distances between consecutive
 * points. Returns 0 for fewer than two points.
 */
export function pathDistanceMeters(points: LatLng[]): number {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Close the loop: append a copy of the first point to the end so the route
 * returns to its start. No-op when there are fewer than two points or the route
 * is already closed (last point already equals the first). Returns a new array.
 */
export function closeLoop(points: LatLng[]): LatLng[] {
  if (!points || points.length < 2) return points ? [...points] : [];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return [...points];
  return [...points, [first[0], first[1]]];
}

/**
 * Perpendicular distance (in equirectangular degree-space, scaled by cos lat so
 * lat/lng are comparable) from point `p` to the segment `a→b`. Used by the
 * Douglas–Peucker simplifier; the units are arbitrary-but-consistent so a single
 * epsilon threshold works regardless of latitude.
 */
function perpDist(p: LatLng, a: LatLng, b: LatLng): number {
  const cos = Math.cos(toRad((a[0] + b[0]) / 2)) || 1;
  const px = p[1] * cos;
  const py = p[0];
  const ax = a[1] * cos;
  const ay = a[0];
  const bx = b[1] * cos;
  const by = b[0];
  const dx = bx - ax;
  const dy = by - ay;
  const segLen2 = dx * dx + dy * dy;
  if (segLen2 === 0) return Math.hypot(px - ax, py - ay);
  // Project p onto the segment, clamped to [0,1].
  let t = ((px - ax) * dx + (py - ay) * dy) / segLen2;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/** Recursive Douglas–Peucker keeping the endpoints of `points[lo..hi]`. */
function dpReduce(points: LatLng[], lo: number, hi: number, eps: number, keep: boolean[]): void {
  if (hi <= lo + 1) return;
  let maxDist = -1;
  let idx = -1;
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist(points[i]!, points[lo]!, points[hi]!);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > eps && idx > lo) {
    keep[idx] = true;
    dpReduce(points, lo, idx, eps, keep);
    dpReduce(points, idx, hi, eps, keep);
  }
}

/** Apply Douglas–Peucker at a given epsilon (degree-space), preserving order + endpoints. */
function douglasPeucker(points: LatLng[], eps: number): LatLng[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  dpReduce(points, 0, points.length - 1, eps, keep);
  return points.filter((_, i) => keep[i]);
}

/**
 * Cap a stored path at `maxPoints` points (default 300) so a long snapped route
 * doesn't bloat the row. Strategy:
 *
 *  1. If already within the cap, return a shallow copy unchanged (lossless).
 *  2. Otherwise run Douglas–Peucker, ramping epsilon up until the result fits.
 *  3. If geometry is degenerate (all points collinear/identical, so DP can't
 *     reduce below the cap), fall back to uniform stride sampling that always
 *     keeps the first + last point.
 *
 * Endpoints are always preserved so the route still starts/ends where drawn.
 */
export function simplifyPath(points: LatLng[], maxPoints = 300): LatLng[] {
  if (!points || points.length <= maxPoints) return points ? [...points] : [];

  // Ramp epsilon (degrees) until DP fits the cap. ~1e-5° ≈ 1.1 m.
  let eps = 1e-5;
  for (let i = 0; i < 24; i++) {
    const out = douglasPeucker(points, eps);
    if (out.length <= maxPoints) return out;
    eps *= 1.8;
  }

  // Fallback: uniform stride, first + last always kept.
  const stride = Math.ceil(points.length / maxPoints);
  const out: LatLng[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/**
 * The builder's default route name: "Route 5.2 mi" (or km). Distance label is
 * formatted to one decimal, mirroring `formatDistance`. Kept pure so the save
 * sheet can prefill a sensible name.
 */
export function defaultRouteName(distanceMeters: number, units: 'mi' | 'km'): string {
  const value = units === 'mi' ? distanceMeters / METERS_PER_MILE : distanceMeters / 1000;
  return `Route ${value.toFixed(1)} ${units}`;
}

/**
 * A compact relative-date label for the saved-routes list ("Today",
 * "Yesterday", "3 days ago", "Mar 14"). `now` is injectable for tests. Compares
 * on local calendar days so a run logged late last night reads "Yesterday".
 */
export function relativeDateLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86_400_000;
  const days = Math.round((startOfDay(now) - startOfDay(then)) / dayMs);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? label : `${label}, ${then.getFullYear()}`;
}
