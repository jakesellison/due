/**
 * Unit tests for the install RPC payload transform (`toRpcDraft` / `formatInterval`).
 * These shape the EXACT `install_plan_draft` RPC payload — previously only ever
 * exercised through mocks at the screen layer, so the seconds→Postgres-interval
 * conversion was untested. Runs under the `app` Jest project; Supabase is mocked
 * so importing the module never opens a client.
 */
jest.mock('../../supabase', () => ({ supabase: { rpc: jest.fn() } }));

import type { ImportedPlanDraft } from '@/lib';

import { formatInterval, toRpcDraft } from '../planInstall';

describe('formatInterval', () => {
  it('formats seconds into H:MM:SS with zero-padded minutes/seconds', () => {
    expect(formatInterval(2 * 3600 + 36 * 60)).toBe('2:36:00');
    expect(formatInterval(48 * 60)).toBe('0:48:00');
    expect(formatInterval(3 * 3600 + 7 * 60 + 42)).toBe('3:07:42');
    expect(formatInterval(0)).toBe('0:00:00');
  });

  it('rounds fractional seconds and clamps negatives to zero', () => {
    expect(formatInterval(59.6)).toBe('0:01:00');
    expect(formatInterval(-100)).toBe('0:00:00');
  });

  it('returns null when seconds is null', () => {
    expect(formatInterval(null)).toBeNull();
  });
});

describe('toRpcDraft', () => {
  const draft: ImportedPlanDraft = {
    source: 'import',
    plan: {
      raceName: 'Test Marathon',
      raceDate: '2026-10-01',
      distanceKind: 'marathon',
      raceDistanceMeters: 42195,
      goalTimeSeconds: 2 * 3600 + 36 * 60,
      startDate: '2026-06-01',
      numWeeks: 16,
      createdVia: 'import',
    },
    weeks: [],
    workouts: [],
    warnings: [],
    questions: [],
  };

  it('adds a goalTimeInterval derived from goalTimeSeconds', () => {
    const payload = toRpcDraft(draft) as { plan: Record<string, unknown> };
    expect(payload.plan.goalTimeInterval).toBe('2:36:00');
  });

  it('preserves the original draft fields (including goalTimeSeconds)', () => {
    const payload = toRpcDraft(draft) as {
      source: string;
      plan: Record<string, unknown>;
      weeks: unknown[];
      workouts: unknown[];
    };
    expect(payload.source).toBe('import');
    expect(payload.plan.raceName).toBe('Test Marathon');
    expect(payload.plan.goalTimeSeconds).toBe(2 * 3600 + 36 * 60);
    expect(payload.weeks).toEqual([]);
    expect(payload.workouts).toEqual([]);
  });

  it('emits a null goalTimeInterval when no goal time is set', () => {
    const noGoal: ImportedPlanDraft = {
      ...draft,
      plan: { ...draft.plan, goalTimeSeconds: null },
    };
    const payload = toRpcDraft(noGoal) as { plan: Record<string, unknown> };
    expect(payload.plan.goalTimeInterval).toBeNull();
  });

  it('does not mutate the input draft', () => {
    const before = JSON.stringify(draft);
    toRpcDraft(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
