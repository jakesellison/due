/**
 * Tests for the plan-switcher data layer and the header caption composer
 * (`app` Jest project, jest-expo). The Supabase client is mocked so
 * `switchActivePlan` can assert the exact write/audit/invalidation calls without
 * a network, and `` is exercised as a pure priority-drop composer.
 */
jest.mock('../supabase', () => {
  // A tiny chainable query-builder stand-in: every `.update().eq()` and
  // `.insert()` records its call and resolves `{ error: null }`.
  const calls: Array<{ table: string; op: string; payload: unknown; eq?: unknown }> = [];
  const from = jest.fn((table: string) => ({
    update: (payload: unknown) => ({
      eq: (_col: string, val: unknown) => {
        calls.push({ table, op: 'update', payload, eq: val });
        return Promise.resolve({ error: null });
      },
    }),
    insert: (payload: unknown) => {
      calls.push({ table, op: 'insert', payload });
      return Promise.resolve({ error: null });
    },
  }));
  return { supabase: { from }, __calls: calls };
});

import { switchActivePlan } from '../queries';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __calls } = require('../supabase') as {
  __calls: Array<{ table: string; op: string; payload: any; eq?: unknown }>;
};

beforeEach(() => {
  __calls.length = 0;
});

// ---- (priority-drop) -------------------------------------------

describe('switchActivePlan', () => {
  it('archives the previous active, activates the new one, and audits the switch', async () => {
    const qc = { invalidateQueries: jest.fn().mockResolvedValue(undefined) };
    await switchActivePlan('plan-new', 'plan-old', qc as any);

    // Archive old, then activate new (in that order).
    const updates = __calls.filter((c) => c.op === 'update');
    expect(updates[0]).toMatchObject({ table: 'plans', payload: { status: 'archived' }, eq: 'plan-old' });
    expect(updates[1]).toMatchObject({ table: 'plans', payload: { status: 'active' }, eq: 'plan-new' });

    // Exactly one plan_changes audit row with the right shape.
    const inserts = __calls.filter((c) => c.op === 'insert' && c.table === 'plan_changes');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toMatchObject({
      plan_id: 'plan-new',
      actor_type: 'user',
      source: 'manual',
      change: { kind: 'switch_active', from: 'plan-old', to: 'plan-new' },
    });

    // Invalidates Dash / Plan / Trends + the plan list.
    const keys = qc.invalidateQueries.mock.calls.map((c: any[]) => c[0].queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(['activePlan', 'activities', 'myPlans']));
  });

  it('skips the archive write when there is no previous active plan', async () => {
    await switchActivePlan('plan-new', null);
    const updates = __calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ payload: { status: 'active' }, eq: 'plan-new' });
  });
});
