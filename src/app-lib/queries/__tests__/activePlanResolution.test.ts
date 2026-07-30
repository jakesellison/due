/**
 * Active-plan resolution: when a stray duplicate active row exists, both the
 * loader (useActivePlan) and the Settings list (useMyPlans) must surface the
 * MOST RECENT active plan (by created_at), consistently — never strand the user
 * on an old plan because a second active row sorts earlier.
 */

// Shared captures must be `mock`-prefixed to be referenced inside jest.mock's
// hoisted factory.
const mockPending: { data: unknown; error: unknown } = { data: [], error: null };
const mockOrderCalls: Array<{ column: string; ascending: boolean }> = [];
const mockFromCalls: string[] = [];

// A tiny chainable PostgREST stub: every builder method returns the same
// thenable; resolution data is whatever the test set on `mockPending`.
jest.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFromCalls.push(table);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.limit = chain;
      builder.order = (column: string, opts?: { ascending?: boolean }) => {
        mockOrderCalls.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mockPending.data, error: mockPending.error }).then(resolve);
      return builder;
    },
  },
}));

// Capture the react-query config so we can invoke the queryFn directly.
let mockLastConfig: { queryFn?: () => Promise<unknown> } | null = null;
jest.mock('@tanstack/react-query', () => ({
  useQuery: (config: { queryFn?: () => Promise<unknown> }) => {
    mockLastConfig = config;
    return { data: null };
  },
}));

import { useActivePlan } from '../activePlan';
import { useMyPlans } from '../planSwitcher';

beforeEach(() => {
  mockOrderCalls.length = 0;
  mockFromCalls.length = 0;
  mockPending.data = [];
  mockPending.error = null;
  mockLastConfig = null;
});

describe('useActivePlan — picks the most-recent active plan', () => {
  test('orders active plans by created_at descending (newest first)', async () => {
    mockPending.data = [{ id: 'new', status: 'active' }];
    useActivePlan('u1');
    expect(mockLastConfig?.queryFn).toBeDefined();
    await mockLastConfig!.queryFn!();

    // The plans query must order created_at DESCENDING so a stray duplicate
    // active row never strands the user on the oldest plan.
    const plansOrder = mockOrderCalls.find((c) => c.column === 'created_at');
    expect(plansOrder).toEqual({ column: 'created_at', ascending: false });
    expect(mockFromCalls[0]).toBe('plans');
  });
});

describe('useMyPlans — surfaces the most-recent active plan first', () => {
  async function runMyPlans(rows: unknown[]) {
    mockPending.data = rows;
    useMyPlans('u1');
    return (await mockLastConfig!.queryFn!()) as Array<{ id: string; status: string | null }>;
  }

  test('among several active rows, the newest leads (consistent with useActivePlan)', async () => {
    const rows = [
      { id: 'old-active', race_name: 'Old', status: 'active', created_at: '2026-01-01T00:00:00Z' },
      { id: 'archived', race_name: 'Arch', status: 'archived', created_at: '2026-05-01T00:00:00Z' },
      { id: 'new-active', race_name: 'New', status: 'active', created_at: '2026-03-01T00:00:00Z' },
    ];
    const plans = await runMyPlans(rows);
    // Active rows lead; within them the most-recent created_at wins.
    expect(plans.map((p) => p.id)).toEqual(['new-active', 'old-active', 'archived']);
  });

  test('still puts active before archived even when archived is newer', async () => {
    const rows = [
      { id: 'active', race_name: 'A', status: 'active', created_at: '2026-01-01T00:00:00Z' },
      { id: 'archived', race_name: 'B', status: 'archived', created_at: '2026-09-01T00:00:00Z' },
    ];
    const plans = await runMyPlans(rows);
    expect(plans.map((p) => p.id)).toEqual(['active', 'archived']);
  });
});
