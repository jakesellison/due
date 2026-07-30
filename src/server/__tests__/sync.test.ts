import { SYNC_PROVIDERS } from '../../lib/sync/providers';
import { providerStatuses } from '../sync';

function queryResult(data: unknown) {
  return {
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(async () => ({ data, error: null })),
  };
}

describe('providerStatuses', () => {
  test('returns every provider with capabilities and connected state', async () => {
    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'integration_connections') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn(async () => ({
              data: [
                {
                  provider: 'strava',
                  provider_athlete_id: '123',
                  status: 'active',
                },
              ],
              error: null,
            })),
          };
        }
        return {
          select: jest.fn(() => queryResult({ source: 'strava', start_date: '2026-06-01T12:00:00Z' })),
        };
      }),
    };

    const rows = await providerStatuses(admin as never, 'u1');
    expect(rows.map((row) => row.provider)).toEqual(SYNC_PROVIDERS.map((provider) => provider.id));
    expect(rows.find((row) => row.provider === 'strava')).toMatchObject({
      connected: true,
      providerAccountId: '123',
      state: 'connected',
    });
    expect(rows.find((row) => row.provider === 'garmin')).toMatchObject({
      connected: false,
      state: 'partner_required',
      capabilities: { activityImport: true, workoutExport: true, routeExport: true },
    });
    expect(rows.find((row) => row.provider === 'coros')).toMatchObject({
      connected: false,
      state: 'partner_required',
      capabilities: { activityImport: true, workoutExport: true },
    });
  });
});
