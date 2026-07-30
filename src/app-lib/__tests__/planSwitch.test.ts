/**
 * Tests for the plan-switcher data layer and the header caption composer
 * (`app` Jest project, jest-expo). The Supabase client is mocked so
 * `switchActivePlan` can assert the exact write/audit/invalidation calls without
 * a network, and `planCaption` is exercised as a pure priority-drop composer.
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

import { planCaption, switchActivePlan } from '../queries';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __calls } = require('../supabase') as {
  __calls: Array<{ table: string; op: string; payload: any; eq?: unknown }>;
};

beforeEach(() => {
  __calls.length = 0;
});

// ---- planCaption (priority-drop) -------------------------------------------

describe('planCaption', () => {
  const full = {
    raceName: 'Chicago 2026',
    goalTime: '2:36',
    weekN: 5,
    numWeeks: 23,
    phaseLabel: 'Base',
  };

  it('composes the full caption when it fits', () => {
    expect(planCaption(full, 60)).toBe('Chicago 2026  2:36 — Wk 5 of 23  Base');
  });

  it('drops the phase first when width-constrained', () => {
    // Budget fits through the week segment but not the phase.
    const c = planCaption(full, 32);
    expect(c).toBe('Chicago 2026  2:36 — Wk 5 of 23');
    expect(c).not.toContain('Base');
  });

  it('drops the week segment next, keeping goal', () => {
    const c = planCaption(full, 20);
    expect(c).toBe('Chicago 2026  2:36');
    expect(c).not.toContain('Wk');
  });

  it('drops the goal last, never the race name', () => {
    const c = planCaption(full, 13);
    expect(c).toBe('Chicago 2026');
  });

  it('never appends an ellipsis even when the race name alone overflows', () => {
    const c = planCaption(full, 4);
    expect(c).toBe('Chicago 2026');
    expect(c).not.toContain('…');
  });

  it('falls back to "Training block" and omits absent segments', () => {
    expect(
      planCaption({ raceName: '—', goalTime: null, weekN: null, numWeeks: null, phaseLabel: null }),
    ).toBe('Training block');
  });
});

// ---- switchActivePlan ------------------------------------------------------

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
