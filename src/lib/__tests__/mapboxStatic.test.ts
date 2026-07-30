import {
  encodePolyline,
  samplePath,
  mapboxStaticUrl,
  fitMapView,
  mercatorProjector,
  mapboxBasemapUrl,
} from '../run/mapboxStatic';

describe('encodePolyline', () => {
  test('matches the canonical Google/Mapbox polyline vector', () => {
    // The reference example from the polyline-algorithm spec.
    const coords: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    expect(encodePolyline(coords)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });
});

describe('samplePath', () => {
  test('leaves short routes untouched', () => {
    const r: [number, number][] = [[0, 0], [1, 1], [2, 2]];
    expect(samplePath(r, 120)).toBe(r);
  });

  test('downsamples long routes but keeps both ends', () => {
    const r: [number, number][] = Array.from({ length: 600 }, (_, i) => [i * 0.001, i * 0.001] as [number, number]);
    const s = samplePath(r, 120);
    expect(s.length).toBeLessThanOrEqual(122);
    expect(s[0]).toEqual(r[0]);
    expect(s[s.length - 1]).toEqual(r[r.length - 1]);
  });
});

describe('mapboxStaticUrl', () => {
  const route: [number, number][] = [[40.71, -73.99], [40.72, -73.98], [40.73, -73.97]];

  test('builds a styled, auto-fit static URL with the route baked in', () => {
    const url = mapboxStaticUrl({ route, style: 'mapbox/light-v11', token: 'pk.test', width: 360, height: 326 });
    expect(url).toContain('https://api.mapbox.com/styles/v1/mapbox/light-v11/static/');
    expect(url).toContain('path-4+FFC93C-1(');
    expect(url).toContain('/auto/360x326@2x');
    expect(url).toContain('access_token=pk.test');
    expect(url).toContain('attribution=false');
    expect(url).toContain('logo=false');
  });

  test('honors a custom stroke color and style', () => {
    const url = mapboxStaticUrl({ route, style: 'jake/dark-min', token: 'pk.x', width: 100, height: 100, strokeColor: 'E0A006' });
    expect(url).toContain('/styles/v1/jake/dark-min/static/');
    expect(url).toContain('path-4+E0A006-1(');
  });

  test('returns null without a token, style, or enough points', () => {
    expect(mapboxStaticUrl({ route, style: 'mapbox/light-v11', token: '', width: 360, height: 326 })).toBeNull();
    expect(mapboxStaticUrl({ route: [[1, 1]], style: 'mapbox/light-v11', token: 'pk.x', width: 360, height: 326 })).toBeNull();
  });
});

describe('fitMapView + mercatorProjector', () => {
  const route: [number, number][] = [[40.70, -74.02], [40.72, -74.00], [40.74, -73.98]];

  test('centers on the route bbox and picks a positive zoom', () => {
    const v = fitMapView(route, 360, 320, 40);
    expect(v.center[0]).toBeCloseTo(-74.0, 1); // lng center
    expect(v.center[1]).toBeCloseTo(40.72, 1); // lat center
    expect(v.zoom).toBeGreaterThan(5);
    expect(v.zoom).toBeLessThanOrEqual(18);
  });

  test('projects the view center to the frame center', () => {
    const v = fitMapView(route, 360, 320, 40);
    const project = mercatorProjector(v, 360, 320);
    const [x, y] = project(v.center[1], v.center[0]); // (lat, lng)
    expect(x).toBeCloseTo(180, 0);
    expect(y).toBeCloseTo(160, 0);
  });

  test('keeps the whole route inside the padded frame', () => {
    const v = fitMapView(route, 360, 320, 40);
    const project = mercatorProjector(v, 360, 320);
    for (const [lat, lng] of route) {
      const [x, y] = project(lat, lng);
      expect(x).toBeGreaterThanOrEqual(36);
      expect(x).toBeLessThanOrEqual(324);
      expect(y).toBeGreaterThanOrEqual(36);
      expect(y).toBeLessThanOrEqual(284);
    }
  });

  test('mapboxBasemapUrl encodes the fixed center/zoom', () => {
    const v = { center: [-74, 40.72] as [number, number], zoom: 12.3 };
    const url = mapboxBasemapUrl({ view: v, style: 'jake/dark-min', token: 'pk.x', width: 360, height: 320 });
    expect(url).toContain('/styles/v1/jake/dark-min/static/-74.00000,40.72000,12.30,0/360x320@2x');
    expect(url).toContain('access_token=pk.x');
  });
});
