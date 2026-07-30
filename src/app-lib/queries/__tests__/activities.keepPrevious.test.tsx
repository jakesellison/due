/**
 * Regression: retuning a range must not blank the data that is already on screen.
 *
 * The run-detail pace curve lets the runner pick the comparison period it builds
 * its dashed baseline from (12W / 26W / All). That period is part of the query
 * key, so selecting a new one starts a new query — and React Query serves
 * `undefined` for a fresh key. The call site's `?? []` turned that into an empty
 * corpus, the baseline had no points, and the comparison curve disappeared from
 * the chart until the fetch returned. `All` pages the entire history, so the gap
 * was long enough to read as the chart having broken rather than as loading.
 *
 * `keepPrevious` holds the previous window's rows across the switch. The call
 * site fades the line while `isPlaceholderData` is true, so the held curve is
 * never mistaken for the newly-selected period.
 *
 * `app` Jest project (jest-expo).
 */

// A chainable Postgrest stub. `useActivities` supplies its own `queryFn`, so the
// seam has to be the client itself: the query resolves from whichever `gte`
// lower bound the hook filtered on, which is what distinguishes the two windows.
// Fixtures live inside the factory because `jest.mock` is hoisted above the
// imports, so anything declared at module scope would still be in TDZ here.
jest.mock('../../supabase', () => {
  const ROWS: Record<string, Array<{ id: string; local_date: string }>> = {
    '2026-04-01': [{ id: 'a', local_date: '2026-05-01' }],
    '2016-06-24': [
      { id: 'a', local_date: '2026-05-01' },
      { id: 'b', local_date: '2019-03-02' },
    ],
  };
  let lowerBound = '';
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lte', 'order']) {
    chain[method] = () => chain;
  }
  chain.gte = (_col: string, value: string) => {
    lowerBound = value;
    return chain;
  };
  // Page 2+ is always empty: these fixtures sit far under the page size, so
  // `fetchAllActivities` breaks out after a single short page.
  chain.range = async (from: number) => ({
    data: from === 0 ? (ROWS[lowerBound] ?? []) : [],
    error: null,
  });
  return { supabase: { from: () => chain } };
});

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useActivities, type DateRange } from '../activities';

const WINDOW_12W: DateRange = { from: '2026-04-01', to: '2026-06-24' };
const WINDOW_ALL: DateRange = { from: '2016-06-24', to: '2026-06-24' };

/**
 * The bug lives in the render that happens IMMEDIATELY after the range changes,
 * before the new key's fetch resolves. Asserting synchronously right after
 * `rerender` observes exactly that render, so the test needs no gate holding the
 * fetch open — and so cannot deadlock on one.
 */
function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useActivities — keepPrevious', () => {
  it('holds the previous range’s rows while a newly-selected range loads', async () => {
    const { result, rerender } = renderHook(
      ({ range }: { range: DateRange }) => useActivities('u1', range, { keepPrevious: true }),
      { wrapper, initialProps: { range: WINDOW_12W } },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    // Switch to All. The new key is in flight and has no data of its own yet —
    // this is the render the chart drew empty.
    rerender({ range: WINDOW_ALL });

    // THE BUG: this used to be `undefined`, which the caller's `?? []` turned
    // into an empty corpus and a chart with no comparison curve.
    expect(result.current.data).toHaveLength(1);
    expect(result.current.isPlaceholderData).toBe(true);

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('still blanks between ranges WITHOUT the flag (unchanged for every other caller)', async () => {
    // The default must not change: the other callers derive their range from the
    // subject being shown (a week, a plan window), where holding the previous
    // subject's rows would render one subject's numbers under another's label.
    const { result, rerender } = renderHook(
      ({ range }: { range: DateRange }) => useActivities('u1', range),
      { wrapper, initialProps: { range: WINDOW_12W } },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    rerender({ range: WINDOW_ALL });
    expect(result.current.data).toBeUndefined();
  });
});
