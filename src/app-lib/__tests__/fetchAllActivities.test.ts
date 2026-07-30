/**
 * Regression test for the activities paginator (`app` Jest project, jest-expo).
 *
 * Supabase REST caps a single select at 1000 rows. Once the user crosses 1k
 * activities (the full Strava backfill), a one-shot fetch silently truncates and
 * drops the newest runs — emptying the easy-HR / efficiency / best-efforts /
 * race-prediction sections. `fetchAllActivities` loops `.range(from, to)` until a
 * short page arrives, so the assembled array is the complete, recent-first set.
 *
 * The supabase module is mocked (importing `../queries` pulls it in transitively)
 * so this stays a pure assertion over the paginator's `.range()` contract.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { fetchAllActivities, type RangeablePostgrest } from '../queries';

type Row = { id: string; start_date: string };

/**
 * A `.range(from, to)`-only query stub backed by a fixed, already-ordered row
 * array (recent-first, the order the real query's `.order('start_date', desc)`
 * produces). Each call returns the requested slice and records the page bounds.
 */
function makeQuery(rows: Row[], pageSize: number) {
  const calls: Array<[number, number]> = [];
  const query: RangeablePostgrest<Row> = {
    range(from: number, to: number) {
      calls.push([from, to]);
      // Supabase `.range` is inclusive on both ends.
      const slice = rows.slice(from, to + 1);
      return Promise.resolve({ data: slice, error: null });
    },
  };
  return { query, calls, pageSize };
}

describe('fetchAllActivities', () => {
  it('pages a 1000 + 74 result into all 1074 rows, recent-first order preserved', async () => {
    const pageSize = 1000;
    // 1074 rows, already recent-first (newest start_date at index 0), like the
    // real `.order('start_date', { ascending: false })` query emits.
    const rows: Row[] = Array.from({ length: 1074 }, (_, i) => ({
      id: `a${i}`,
      // Strictly descending instants: i=0 newest, i=1073 oldest.
      start_date: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString(),
    }));

    const { query, calls } = makeQuery(rows, pageSize);
    const result = await fetchAllActivities(query, pageSize);

    // Every row returned exactly once — nothing truncated at the 1000 cap.
    expect(result).toHaveLength(1074);
    expect(new Set(result.map((r) => r.id)).size).toBe(1074);

    // Recent-first ordering is preserved end-to-end (page boundary included).
    expect(result[0]!.id).toBe('a0');
    expect(result[999]!.id).toBe('a999');
    expect(result[1000]!.id).toBe('a1000'); // first row of the second page
    expect(result[1073]!.id).toBe('a1073');
    const instants = result.map((r) => Date.parse(r.start_date));
    for (let i = 1; i < instants.length; i++) {
      expect(instants[i]!).toBeLessThan(instants[i - 1]!);
    }

    // Two pages: [0,999] then [1000,1999]; the second is short → loop stops.
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('stops after a single round-trip when the result fits in one page', async () => {
    const rows: Row[] = Array.from({ length: 320 }, (_, i) => ({
      id: `r${i}`,
      start_date: `2026-01-01T00:00:00.000Z`,
    }));
    const { query, calls } = makeQuery(rows, 1000);
    const result = await fetchAllActivities(query, 1000);
    expect(result).toHaveLength(320);
    expect(calls).toEqual([[0, 999]]);
  });

  it('returns an exact multiple as two pages (final empty page ends the loop)', async () => {
    // 2000 rows at pageSize 1000: page1 full (1000), page2 full (1000), page3
    // empty → stop. Guards the boundary where the last full page isn't short.
    const rows: Row[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `m${i}`,
      start_date: `2026-01-01T00:00:00.000Z`,
    }));
    const { query, calls } = makeQuery(rows, 1000);
    const result = await fetchAllActivities(query, 1000);
    expect(result).toHaveLength(2000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('propagates a query error', async () => {
    const query: RangeablePostgrest<Row> = {
      range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    };
    await expect(fetchAllActivities(query)).rejects.toMatchObject({ message: 'boom' });
  });
});
