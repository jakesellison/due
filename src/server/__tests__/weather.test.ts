import { fetchTempC } from '../weather';

/** Build a mock fetch returning a given JSON payload with ok=true. */
function okFetch(json: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => json,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('fetchTempC (mocked fetch — never hits the network)', () => {
  const hourly = {
    time: ['2024-06-01T11:00', '2024-06-01T12:00', '2024-06-01T13:00'],
    temperature_2m: [16, 20, 24],
  };

  it('picks the hour nearest the activity start', async () => {
    // 12:20Z is nearest the 12:00 sample -> 20°C.
    const temp = await fetchTempC(
      41.88,
      -87.63,
      '2024-06-01T12:20:00Z',
      okFetch({ hourly }),
    );
    expect(temp).toBe(20);
  });

  it('returns null on a non-ok response', async () => {
    const badFetch = (async () =>
      ({ ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    expect(await fetchTempC(41.88, -87.63, '2024-06-01T12:00:00Z', badFetch)).toBeNull();
  });

  it('returns null when the fetch throws (network/abort)', async () => {
    const throwFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await fetchTempC(41.88, -87.63, '2024-06-01T12:00:00Z', throwFetch)).toBeNull();
  });

  it('returns null for malformed payloads and bad coords', async () => {
    expect(await fetchTempC(41.88, -87.63, '2024-06-01T12:00:00Z', okFetch({}))).toBeNull();
    expect(await fetchTempC(NaN, -87.63, '2024-06-01T12:00:00Z', okFetch({ hourly }))).toBeNull();
  });
});
