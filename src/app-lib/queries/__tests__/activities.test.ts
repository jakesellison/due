/**
 * Regression for data-layer #33: stable, *total* activity pagination
 * (`app` Jest project, jest-expo).
 *
 * `fetchAllActivities` pages a Supabase select via `.range(from, to)` — offset
 * pagination, where the server re-applies the query's ORDER for every page
 * request. If that order is not *total* (rows tie on the sort key, or the key is
 * null), the DB is free to return ties in a different relative order per request,
 * so a row sitting on a page boundary can land on both pages (duplicated) or
 * neither (lost). The shipped query previously ordered by `start_date` (nullable,
 * non-unique) while keying pages on `local_date`; the fix orders on the same key
 * pages are cursored on (`local_date`) plus a unique `id` tiebreaker — a total
 * order, stable across `.range` offsets, with null `local_date` pinned last.
 *
 * The supabase module is mocked (importing `../activities` pulls it in
 * transitively) so this stays a pure assertion over the paginator's contract.
 */
jest.mock('../../supabase', () => ({ supabase: { from: jest.fn() } }));

import { fetchAllActivities, type RangeablePostgrest } from '../activities';

type ActRow = { id: string; local_date: string | null; start_date: string | null };

/**
 * A `.range` stub over an UNORDERED backing set that re-sorts on every call by
 * the supplied comparator — i.e. it honors the query's ORDER per page like the
 * real REST backend, instead of slicing a pre-frozen array. Each call first
 * rotates the backing set, so equal-keyed rows are presented in a different
 * order every request: a *total* comparator cancels that out, a non-total one
 * lets it leak across the page boundary (the bug).
 */
function makeReorderingQuery(
  rows: ActRow[],
  orderBy: (a: ActRow, b: ActRow) => number,
): RangeablePostgrest<ActRow> {
  let call = 0;
  return {
    range(from: number, to: number) {
      const n = call++ % rows.length;
      const rotated = [...rows.slice(n), ...rows.slice(0, n)];
      const ordered = rotated
        .map((r, i) => [r, i] as const)
        .sort((a, b) => orderBy(a[0], b[0]) || a[1] - b[1]) // index keeps the sort stable
        .map(([r]) => r);
      // Supabase `.range` is inclusive on both ends.
      return Promise.resolve({ data: ordered.slice(from, to + 1), error: null });
    },
  };
}

// The OLD order key: start_date DESC. Non-total here — every row's start_date is
// null/equal, so it imposes no relative order at all.
const byStartDateDesc = (a: ActRow, b: ActRow): number =>
  (b.start_date ?? '').localeCompare(a.start_date ?? '');

// The SHIPPED order: local_date DESC (nulls last), then id DESC — total, because
// `id` is unique.
const byLocalDateThenIdDesc = (a: ActRow, b: ActRow): number => {
  const al = a.local_date ?? '';
  const bl = b.local_date ?? '';
  if (al !== bl) return bl.localeCompare(al);
  return b.id.localeCompare(a.id);
};

describe('activities pagination — stable & total (data-layer #33)', () => {
  // Rows that all share a local_date but have null start_date — the exact shape
  // that shuffled across pages under the old `start_date` order.
  const tiedRows: ActRow[] = Array.from({ length: 7 }, (_, i) => ({
    id: `a${i}`,
    local_date: '2026-01-10',
    start_date: null,
  }));

  it('loses or duplicates rows when ordered by a non-total key (the bug)', async () => {
    const query = makeReorderingQuery(tiedRows, byStartDateDesc);
    const result = await fetchAllActivities(query, 3); // 3 pages: [0,2] [3,5] [6,8]
    const ids = result.map((r) => r.id);
    // A non-total order is NOT total across pages: relative to the source set,
    // some row is dropped or duplicated.
    const isTotal = ids.length === tiedRows.length && new Set(ids).size === tiedRows.length;
    expect(isTotal).toBe(false);
  });

  it('returns every row exactly once when ordered+cursored on a total key (the fix)', async () => {
    const query = makeReorderingQuery(tiedRows, byLocalDateThenIdDesc);
    const result = await fetchAllActivities(query, 3);
    const ids = result.map((r) => r.id);
    // Nothing lost, nothing duplicated — every source row present exactly once.
    expect(ids).toHaveLength(tiedRows.length);
    expect(new Set(ids).size).toBe(tiedRows.length);
    expect([...ids].sort()).toEqual(tiedRows.map((r) => r.id).sort());
    // ...in the deterministic recent-first (id DESC tiebreak) order.
    expect(ids).toEqual(['a6', 'a5', 'a4', 'a3', 'a2', 'a1', 'a0']);
  });

  it('pins a null local_date deterministically last (nullsFirst: false)', async () => {
    const mixed: ActRow[] = [
      { id: 'x', local_date: '2026-01-10', start_date: null },
      { id: 'y', local_date: null, start_date: null },
      { id: 'z', local_date: '2026-01-11', start_date: null },
    ];
    const query = makeReorderingQuery(mixed, byLocalDateThenIdDesc);
    const result = await fetchAllActivities(query, 2);
    // Recent-first by local_date, the null-dated row last.
    expect(result.map((r) => r.id)).toEqual(['z', 'x', 'y']);
  });
});
