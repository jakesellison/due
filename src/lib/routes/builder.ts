/**
 * Pure route-builder state + reducer. The map/gesture layer stays thin: it
 * dispatches semantic actions (a tap added a waypoint, undo, clear, close-loop,
 * a snapped segment resolved, the snap toggle flipped) and reads back the
 * rendered polyline + live distance. All logic lives here so it's node-tested.
 *
 * Model
 * -----
 *  - `points`   — the editable waypoints the user tapped, [[lat,lng],...].
 *  - `segments` — one entry per gap between consecutive waypoints. Each is
 *                 either a straight line (just the two endpoints) or a snapped
 *                 polyline that follows paths. `segments.length === max(0,
 *                 points.length - 1)`. Drawing the route = first point, then
 *                 each segment's polyline minus its leading (duplicate) point.
 *  - `snap`     — whether new segments should be snapped to paths.
 *  - `closed`   — whether the loop has been closed (a return-to-start segment).
 *
 * Distance is derived from the rendered path (`renderedPath`), so it updates as
 * straight segments are replaced by snapped ones.
 */

import {
  haversineMeters,
  pathDistanceMeters,
  type LatLng,
} from './geo';

/**
 * Useful route-building fallback when the device has no reusable location.
 * It frames Manhattan and nearby boroughs closely enough to place waypoints
 * without requiring a pinch gesture (notably in the iOS Simulator).
 */
export const DEFAULT_ROUTE_BUILDER_CAMERA: Readonly<{
  center: LatLng;
  zoom: number;
}> = {
  center: [40.758, -73.9855],
  zoom: 12,
};

export interface RouteSegment {
  /** The polyline for this gap, [[lat,lng],...] inclusive of both endpoints. */
  path: LatLng[];
  /** True once a snapped result has replaced the initial straight line. */
  snapped: boolean;
  /** Distance of this segment in metres (snapped distance or straight haversine). */
  meters: number;
}

export interface BuilderState {
  points: LatLng[];
  segments: RouteSegment[];
  snap: boolean;
  closed: boolean;
}

export type BuilderAction =
  | { type: 'add'; point: LatLng }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'closeLoop' }
  | { type: 'outAndBack' }
  | { type: 'setSnap'; snap: boolean }
  /**
   * A snapped segment resolved. `index` is the segment index (the gap after
   * waypoint `index`); `endpoints` is the [from,to] the request was made for so
   * a stale result (the waypoints changed underneath) is ignored.
   */
  | { type: 'snapResolved'; index: number; path: LatLng[]; meters: number; endpoints: [LatLng, LatLng] }
  /** Load an existing route's waypoints into a fresh builder (Duplicate & edit). */
  | { type: 'load'; points: LatLng[]; snap: boolean };

export function initialBuilderState(snap = true): BuilderState {
  return { points: [], segments: [], snap, closed: false };
}

const samePoint = (a: LatLng, b: LatLng): boolean => a[0] === b[0] && a[1] === b[1];

/** A straight (un-snapped) segment between two waypoints. */
function straightSegment(from: LatLng, to: LatLng): RouteSegment {
  return { path: [from, to], snapped: false, meters: haversineMeters(from, to) };
}

/** Rebuild straight segments for a fresh set of points (used by load/undo/close). */
function straightSegments(points: LatLng[]): RouteSegment[] {
  const segs: RouteSegment[] = [];
  for (let i = 1; i < points.length; i++) segs.push(straightSegment(points[i - 1]!, points[i]!));
  return segs;
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'add': {
      const points = [...state.points, action.point];
      // Adding a waypoint after a closed loop re-opens it.
      const segments = [...state.segments];
      if (state.points.length >= 1) {
        segments.push(straightSegment(state.points[state.points.length - 1]!, action.point));
      }
      return { ...state, points, segments, closed: false };
    }

    case 'undo': {
      if (state.points.length === 0) return state;
      // Undoing a closed loop just removes the closing segment, keeping points.
      if (state.closed) {
        return { ...state, segments: state.segments.slice(0, -1), closed: false };
      }
      const points = state.points.slice(0, -1);
      const segments = state.segments.slice(0, -1);
      return { ...state, points, segments, closed: false };
    }

    case 'clear':
      return { ...state, points: [], segments: [], closed: false };

    case 'closeLoop': {
      if (state.points.length < 3 || state.closed) return state;
      const first = state.points[0]!;
      const last = state.points[state.points.length - 1]!;
      if (samePoint(first, last)) return state;
      // Add a straight closing segment back to the start (it can snap later).
      return {
        ...state,
        segments: [...state.segments, straightSegment(last, first)],
        closed: true,
      };
    }

    case 'outAndBack': {
      if (state.points.length < 2 || state.closed) return state;
      const returnPoints = state.points.slice(0, -1).reverse();
      if (returnPoints.length === 0) return state;
      const points = [...state.points, ...returnPoints];
      const returnSegments = [...state.segments].reverse().map((seg) => ({
        path: [...seg.path].reverse(),
        snapped: seg.snapped,
        meters: seg.meters,
      }));
      return {
        ...state,
        points,
        segments: [...state.segments, ...returnSegments],
        closed: false,
      };
    }

    case 'setSnap':
      return { ...state, snap: action.snap };

    case 'snapResolved': {
      const seg = state.segments[action.index];
      if (!seg) return state;
      // Ignore a stale result: the gap's endpoints must still match.
      const from = seg.path[0]!;
      const to = seg.path[seg.path.length - 1]!;
      const [reqFrom, reqTo] = action.endpoints;
      if (!samePoint(from, reqFrom) || !samePoint(to, reqTo)) return state;
      if (action.path.length < 2) return state;
      const segments = [...state.segments];
      segments[action.index] = { path: action.path, snapped: true, meters: action.meters };
      return { ...state, segments };
    }

    case 'load': {
      const copied = action.points.map((p) => [p[0], p[1]] as LatLng);
      // Saved closed routes repeat the first waypoint at the end. Normalize
      // that representation back to the builder's dedicated closing segment.
      const closed = copied.length >= 3 && samePoint(copied[0]!, copied[copied.length - 1]!);
      const points = closed ? copied.slice(0, -1) : copied;
      const segments = straightSegments(points);
      if (closed && points.length >= 2) {
        segments.push(straightSegment(points[points.length - 1]!, points[0]!));
      }
      return {
        points,
        segments,
        snap: action.snap,
        closed,
      };
    }

    default:
      return state;
  }
}

/** Waypoints persisted for a route, including the closing leg of a loop. */
export function routePointsForSave(state: BuilderState): LatLng[] {
  if (!state.closed || state.points.length === 0) return state.points;
  return [...state.points, state.points[0]!];
}

/**
 * The full rendered polyline [[lat,lng],...]: the first waypoint, then every
 * segment's path with its (duplicate) leading point dropped. Empty for <1 point;
 * a single point for exactly one waypoint.
 */
export function renderedPath(state: BuilderState): LatLng[] {
  if (state.points.length === 0) return [];
  if (state.segments.length === 0) return [state.points[0]!];
  const out: LatLng[] = [state.segments[0]!.path[0]!];
  for (const seg of state.segments) {
    for (let i = 1; i < seg.path.length; i++) out.push(seg.path[i]!);
  }
  return out;
}

/**
 * Live distance in metres. Sums per-segment metres (so it reflects snapped
 * lengths as they resolve); falls back to measuring the rendered path if there
 * are segments without a cached length (there shouldn't be).
 */
export function builderDistanceMeters(state: BuilderState): number {
  if (state.segments.length === 0) return 0;
  let total = 0;
  for (const seg of state.segments) {
    total += Number.isFinite(seg.meters) ? seg.meters : pathDistanceMeters(seg.path);
  }
  return total;
}

/** Whether a close-loop action would currently do anything. */
export function canCloseLoop(state: BuilderState): boolean {
  return state.points.length >= 3 && !state.closed;
}
