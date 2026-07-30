import {
  snapSegment,
} from '../routes/snap';
import type { LatLng } from '../routes/geo';

const FROM: LatLng = [41.8827, -87.6233];
const TO: LatLng = [41.885, -87.62];

/** A minimal fetch Response stand-in. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('snapSegment', () => {
  test('happy path: decodes geojson [lng,lat] → [lat,lng] and returns OSRM distance', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      // The request encodes coords as {lng},{lat};{lng},{lat}.
      expect(url).toContain(`${FROM[1]},${FROM[0]};${TO[1]},${TO[0]}`);
      expect(url).toContain('geometries=geojson');
      return jsonResponse({
        code: 'Ok',
        routes: [
          {
            distance: 412.7,
            geometry: {
              coordinates: [
                [-87.6233, 41.8827],
                [-87.622, 41.884],
                [-87.62, 41.885],
              ],
            },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await snapSegment(FROM, TO, fetchImpl);
    expect(result).not.toBeNull();
    expect(result!.distanceMeters).toBeCloseTo(412.7, 3);
    expect(result!.path).toEqual([
      [41.8827, -87.6233],
      [41.884, -87.622],
      [41.885, -87.62],
    ]);
  });

  test('failure: non-200 → null', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;
    expect(await snapSegment(FROM, TO, fetchImpl)).toBeNull();
  });

  test('failure: thrown network error → null', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await snapSegment(FROM, TO, fetchImpl)).toBeNull();
  });

  test('failure: empty geometry → null', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ code: 'Ok', routes: [{ distance: 0, geometry: { coordinates: [] } }] }),
    ) as unknown as typeof fetch;
    expect(await snapSegment(FROM, TO, fetchImpl)).toBeNull();
  });

  test('missing distance field → measured from the polyline', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        routes: [
          {
            geometry: {
              coordinates: [
                [0, 0],
                [0, 1],
              ],
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const result = await snapSegment([0, 0], [0, 1], fetchImpl);
    expect(result).not.toBeNull();
    // 1° longitude at the equator ≈ 111.19 km.
    expect(result!.distanceMeters / 1000).toBeCloseTo(111.19, 1);
  });
});
