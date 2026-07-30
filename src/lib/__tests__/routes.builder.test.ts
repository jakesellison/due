import {
  DEFAULT_ROUTE_BUILDER_CAMERA,
  initialBuilderState,
  builderReducer,
  renderedPath,
  builderDistanceMeters,
  canCloseLoop,
  routePointsForSave,
  type BuilderState,
} from '../routes/builder';
import {
  haversineMeters,
  type LatLng,
} from '../routes/geo';

const A: LatLng = [41.8827, -87.6233];
const B: LatLng = [41.885, -87.62];
const C: LatLng = [41.887, -87.618];

describe('route builder camera', () => {
  test('opens new routes over New York City at a waypoint-ready zoom', () => {
    expect(DEFAULT_ROUTE_BUILDER_CAMERA.center).toEqual([40.758, -73.9855]);
    expect(DEFAULT_ROUTE_BUILDER_CAMERA.zoom).toBeGreaterThanOrEqual(12);
  });
});

function add(state: BuilderState, ...pts: LatLng[]): BuilderState {
  return pts.reduce((s, point) => builderReducer(s, { type: 'add', point }), state);
}

describe('builder reducer', () => {
  test('adds waypoints, building straight segments', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    expect(s.points).toHaveLength(3);
    expect(s.segments).toHaveLength(2);
    expect(s.segments.every((seg) => !seg.snapped)).toBe(true);
  });

  test('renderedPath is the first point then each segment tail', () => {
    let s = initialBuilderState();
    expect(renderedPath(s)).toEqual([]);
    s = add(s, A);
    expect(renderedPath(s)).toEqual([A]);
    s = add(s, B, C);
    expect(renderedPath(s)).toEqual([A, B, C]);
  });

  test('live distance sums segment lengths', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    const expected = haversineMeters(A, B) + haversineMeters(B, C);
    expect(builderDistanceMeters(s)).toBeCloseTo(expected, 6);
  });

  test('undo removes the last waypoint + its segment', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    s = builderReducer(s, { type: 'undo' });
    expect(s.points).toEqual([A, B]);
    expect(s.segments).toHaveLength(1);
    s = builderReducer(s, { type: 'undo' });
    s = builderReducer(s, { type: 'undo' });
    expect(s.points).toEqual([]);
    expect(s.segments).toEqual([]);
    // Undo on empty is a no-op.
    expect(builderReducer(s, { type: 'undo' })).toBe(s);
  });

  test('clear empties points + segments', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    s = builderReducer(s, { type: 'clear' });
    expect(s.points).toEqual([]);
    expect(s.segments).toEqual([]);
    expect(builderDistanceMeters(s)).toBe(0);
  });

  test('closeLoop adds a return-to-start segment; needs ≥3 points', () => {
    let s = initialBuilderState();
    s = add(s, A, B);
    expect(canCloseLoop(s)).toBe(false);
    expect(builderReducer(s, { type: 'closeLoop' })).toBe(s);

    s = add(s, C);
    expect(canCloseLoop(s)).toBe(true);
    s = builderReducer(s, { type: 'closeLoop' });
    expect(s.closed).toBe(true);
    expect(s.segments).toHaveLength(3);
    // Rendered path returns to the start.
    const path = renderedPath(s);
    expect(path[path.length - 1]).toEqual(A);
    expect(routePointsForSave(s)).toEqual([A, B, C, A]);
    // Closing again is a no-op.
    expect(builderReducer(s, { type: 'closeLoop' })).toBe(s);
  });

  test('undo on a closed loop removes only the closing segment', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    s = builderReducer(s, { type: 'closeLoop' });
    s = builderReducer(s, { type: 'undo' });
    expect(s.closed).toBe(false);
    expect(s.points).toHaveLength(3);
    expect(s.segments).toHaveLength(2);
  });

  test('outAndBack mirrors the route back through prior waypoints', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    const snappedAB: LatLng[] = [A, [41.8835, -87.621], B];
    s = builderReducer(s, {
      type: 'snapResolved',
      index: 0,
      path: snappedAB,
      meters: 321,
      endpoints: [A, B],
    });
    s = builderReducer(s, { type: 'outAndBack' });
    expect(s.closed).toBe(false);
    expect(s.points).toEqual([A, B, C, B, A]);
    expect(s.segments).toHaveLength(4);
    expect(s.segments[3]!.path).toEqual([...snappedAB].reverse());
    expect(renderedPath(s)).toEqual([...snappedAB, C, B, [41.8835, -87.621], A]);
  });

  test('adding after a closed loop re-opens it', () => {
    let s = initialBuilderState();
    s = add(s, A, B, C);
    s = builderReducer(s, { type: 'closeLoop' });
    s = add(s, [41.89, -87.61]);
    expect(s.closed).toBe(false);
    expect(s.points).toHaveLength(4);
  });

  test('snapResolved replaces a straight segment with a snapped polyline', () => {
    let s = initialBuilderState();
    s = add(s, A, B);
    const snappedPath: LatLng[] = [A, [41.8835, -87.621], B];
    s = builderReducer(s, {
      type: 'snapResolved',
      index: 0,
      path: snappedPath,
      meters: 321,
      endpoints: [A, B],
    });
    expect(s.segments[0]!.snapped).toBe(true);
    expect(s.segments[0]!.meters).toBe(321);
    expect(renderedPath(s)).toEqual(snappedPath);
    expect(builderDistanceMeters(s)).toBe(321);
  });

  test('stale snapResolved (endpoints changed) is ignored', () => {
    let s = initialBuilderState();
    s = add(s, A, B);
    const before = s.segments[0];
    s = builderReducer(s, {
      type: 'snapResolved',
      index: 0,
      path: [A, B],
      meters: 999,
      endpoints: [A, C], // C ≠ the segment's actual end (B)
    });
    expect(s.segments[0]).toBe(before);
  });

  test('setSnap toggles the snap flag', () => {
    let s = initialBuilderState(true);
    s = builderReducer(s, { type: 'setSnap', snap: false });
    expect(s.snap).toBe(false);
  });

  test('load seeds points + straight segments for Duplicate & edit', () => {
    let s = initialBuilderState(true);
    s = builderReducer(s, { type: 'load', points: [A, B, C], snap: false });
    expect(s.points).toEqual([A, B, C]);
    expect(s.segments).toHaveLength(2);
    expect(s.snap).toBe(false);
    expect(s.closed).toBe(false);
  });

  test('load restores a saved closed route without losing its closing leg', () => {
    let s = initialBuilderState(true);
    s = builderReducer(s, { type: 'load', points: [A, B, C, A], snap: false });
    expect(s.points).toEqual([A, B, C]);
    expect(s.segments).toHaveLength(3);
    expect(s.closed).toBe(true);
    expect(renderedPath(s)).toEqual([A, B, C, A]);
    expect(routePointsForSave(s)).toEqual([A, B, C, A]);
  });
});
