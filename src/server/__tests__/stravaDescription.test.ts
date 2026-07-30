import { METERS_PER_MILE } from '../../lib/units';
import { DUE_MARK } from '../../lib/strava/description';
import { maybeWriteRunDescription } from '../stravaDescription';

type Table = 'users' | 'plan_members' | 'plans' | 'workouts' | 'plan_weeks' | 'activities';

// External Strava-copy glyphs stay escaped here so the app/source emoji
// guardrail remains scoped to the dedicated description renderer.
const YELLOW_CELL = '\u{1F7E8}';
const PURPLE_CELL = '\u{1F7EA}';
const BLUE_CELL = '\u{1F7E6}';
const EMPTY_CELL = '\u{2B1B}';

function fakeAdmin(
  overrides: Partial<Record<Table, unknown>> = {},
  errors: Partial<Record<Table, { message: string }>> = {},
) {
  const rows: Record<Table, unknown> = {
    users: { settings: { strava_description: true }, week_start: 'mon' },
    plan_members: [{ plan_id: 'plan-1' }],
    plans: [{ id: 'plan-1', num_weeks: 23 }],
    workouts: [
      {
        date: '2026-07-21',
        type: 'quality',
        planned_distance_meters: 17 * METERS_PER_MILE,
        structure: [],
        is_quality: true,
        prescribed_quality_meters: null,
        week_id: 'week-11',
      },
    ],
    plan_weeks: {
      target_meters: 100 * METERS_PER_MILE,
      week_index: 11,
      phase: 'build',
      is_recovery: false,
      quality_target_meters: 22 * METERS_PER_MILE,
      long_target_meters: 22 * METERS_PER_MILE,
    },
    activities: [
      { local_date: '2026-07-21', distance_meters: 14 * METERS_PER_MILE, stream_summary: null, quality_override: null },
      { local_date: '2026-07-20', distance_meters: 3 * METERS_PER_MILE, stream_summary: null, quality_override: null },
      { local_date: '2026-07-20', distance_meters: 20 * METERS_PER_MILE, stream_summary: null, quality_override: null },
    ],
    ...overrides,
  };
  const eqCalls: Array<{ table: Table; column: string; value: unknown }> = [];

  function from(tableName: string) {
    const table = tableName as Table;
    const result = () => ({ data: rows[table], error: errors[table] ?? null });
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        eqCalls.push({ table, column, value });
        return chain;
      },
      in: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  }

  return { admin: { from } as never, eqCalls };
}

describe('maybeWriteRunDescription', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('writes compact day + weekly context and counts every banked source', async () => {
    const { admin, eqCalls } = fakeAdmin();
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => (
      { ok: true, status: 200, text: async () => '' }
    ) as Response);
    global.fetch = fetchMock as typeof fetch;

    const outcome = await maybeWriteRunDescription(
      admin,
      'user-1',
      'strava-token',
      123,
      '2026-07-21',
      'Morning session felt controlled.',
      'read,activity:read_all,activity:write',
    );

    expect(outcome).toBe('written');
    expect(eqCalls).not.toContainEqual({ table: 'activities', column: 'source', value: 'strava' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as { description: string };
    expect(body.description).toBe(
      [
        'Morning session felt controlled.',
        '',
        'Quality day · 14/17 mi',
        `${DUE_MARK}11/23 · Build · 37/100 mi`,
        '',
        `${YELLOW_CELL.repeat(2)}${EMPTY_CELL.repeat(3)} 37/100 mi mileage`,
        `${PURPLE_CELL} 0/22 mi quality`,
        `${BLUE_CELL} 20/22 mi long run`,
        '',
        'due.run',
      ].join('\n'),
    );
  });

  it('does not attempt a write when the persisted grant lacks activity:write', async () => {
    const { admin } = fakeAdmin();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      maybeWriteRunDescription(admin, 'user-1', 'token', 123, '2026-07-21', null, 'read,activity:read_all'),
    ).resolves.toBe('missing_scope');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns opted_out before doing plan work', async () => {
    const { admin } = fakeAdmin({ users: { settings: {}, week_start: 'mon' } });
    await expect(
      maybeWriteRunDescription(admin, 'user-1', 'token', 123, '2026-07-21', null, 'read,activity:write'),
    ).resolves.toBe('opted_out');
  });

  it('reports a failed Strava update without breaking ingest', async () => {
    const { admin } = fakeAdmin();
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'upstream' }) as Response) as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      maybeWriteRunDescription(admin, 'user-1', 'token', 123, '2026-07-21', null, 'read,activity:write'),
    ).resolves.toBe('failed');
  });

  it('does not publish misleading zeros when a plan-context query fails', async () => {
    const { admin } = fakeAdmin({}, { activities: { message: 'database unavailable' } });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      maybeWriteRunDescription(admin, 'user-1', 'token', 123, '2026-07-21', null, 'read,activity:write'),
    ).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
