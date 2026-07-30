/**
 * Tests for `saveWeekEdits` (src/app-lib/weekEdit.ts) — the IO layer that
 * persists the week editor's net state, and (Task 4) the reflow Apply path:
 *
 *  - workout UPDATEs persist the (possibly re-derived) `title`, so a rest day
 *    activated by a reflow never stays "Rest Day" in the DB while carrying miles;
 *  - a HYBRID reflow (`newTargetMeters != null`) also lowers
 *    `plan_weeks.target_meters` (NEVER `original_target_meters`) and records
 *    `newTarget` in the single plan_changes audit row;
 *  - audit attribution: manual saves are user/manual, reflow applies are
 *    adapt/adapt with `kind: 'reflow'`.
 *
 * Same chainable Supabase-mock style as planSwitch.test.ts.
 */
jest.mock('../supabase', () => {
  // A tiny chainable query-builder stand-in: every `.update().eq()` and
  // `.insert()` records its call and resolves `{ error: null }`.
  const calls: Array<{ table: string; op: string; payload: unknown; eq?: unknown }> = [];
  const from = jest.fn((table: string) => ({
    delete: () => ({
      eq: (_col: string, val: unknown) => {
        calls.push({ table, op: 'delete', payload: null, eq: val });
        return Promise.resolve({ error: null });
      },
    }),
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

jest.mock('../queries', () => ({
  invalidatePlanActivityCaches: jest.fn().mockResolvedValue(undefined),
}));

import type { QueryClient } from '@tanstack/react-query';

import type { EditableDay, EditOp } from '@/lib';
import { deletePlannedWorkout, saveWeekEdits } from '../weekEdit';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __calls } = require('../supabase') as {
  __calls: Array<{ table: string; op: string; payload: Record<string, unknown>; eq?: unknown }>;
};

beforeEach(() => {
  __calls.length = 0;
});

const qc = {} as unknown as QueryClient;

function makeDay(over: Partial<EditableDay> & { id: string | null; date: string }): EditableDay {
  return {
    type: 'easy',
    title: 'Easy Run',
    plannedDistanceMeters: 10000,
    isQuality: false,
    ...over,
  };
}

// The reflow 'max' rest-activation op pair (setType + setDistance) — the
// compound whose net state must persist the re-derived title.
const REFLOW_OPS: EditOp[] = [
  { kind: 'setType', workoutId: 'w1', newType: 'easy' },
  { kind: 'setDistance', workoutId: 'w1', newDistanceMeters: 4828 },
];

describe('saveWeekEdits — title persistence', () => {
  it('writes the title on a non-rest UPDATE (activated rest day becomes "Easy Run")', async () => {
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({ id: 'w1', date: '2026-06-18', title: 'Easy Run', plannedDistanceMeters: 4828 })],
      ops: REFLOW_OPS,
      queryClient: qc,
    });
    const upd = __calls.find((c) => c.table === 'workouts' && c.op === 'update');
    expect(upd).toBeDefined();
    expect(upd!.eq).toBe('w1');
    expect(upd!.payload).toMatchObject({
      type: 'easy',
      planned_distance_meters: 4828,
      date: '2026-06-18',
      is_quality: false,
      title: 'Easy Run',
    });
  });

  it('writes the title on a rest UPDATE (a zeroed day is titled "Rest Day")', async () => {
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({ id: 'w2', date: '2026-06-19', type: 'rest', title: 'Rest Day', plannedDistanceMeters: 0 })],
      ops: [{ kind: 'setRest', workoutId: 'w2' }],
      queryClient: qc,
    });
    const upd = __calls.find((c) => c.table === 'workouts' && c.op === 'update');
    expect(upd).toBeDefined();
    expect(upd!.payload).toMatchObject({
      type: 'rest',
      planned_distance_meters: 0,
      is_quality: false,
      title: 'Rest Day',
    });
  });
});

describe('saveWeekEdits — manual save (no reflow)', () => {
  it('audits as user/manual with the raw ops and never touches plan_weeks', async () => {
    const ops: EditOp[] = [{ kind: 'setDistance', workoutId: 'w1', newDistanceMeters: 12000 }];
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({ id: 'w1', date: '2026-06-18', plannedDistanceMeters: 12000 })],
      ops,
      queryClient: qc,
    });
    expect(__calls.some((c) => c.table === 'plan_weeks')).toBe(false);
    const audit = __calls.find((c) => c.table === 'plan_changes');
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({
      plan_id: 'plan-1',
      actor_type: 'user',
      source: 'manual',
    });
    const change = audit!.payload['change'] as Record<string, unknown>;
    expect(change['edits']).toEqual(ops);
    expect(change['newTarget']).toBeUndefined();
    expect(change['kind']).toBeUndefined();
  });

  it('persists an edited existing prescription without dropping its structure or quality snapshot', async () => {
    const structure = [{ kind: 'work', target: { by: 'distance', distance_m: 16000, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } }] as any;
    const op: EditOp = {
      kind: 'updateWorkout',
      workoutId: 'wq',
      type: 'quality',
      title: 'Quality Run',
      plannedDistanceMeters: 27000,
      plannedDurationSeconds: null,
      isQuality: true,
      prescribedQualityMeters: 16000,
      structure,
    };
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({
        id: 'wq',
        date: '2026-06-18',
        type: 'quality',
        title: 'Quality Run',
        plannedDistanceMeters: 27000,
        plannedDurationSeconds: null,
        isQuality: true,
        prescribedQualityMeters: 16000,
        structure,
      })],
      ops: [op],
      queryClient: qc,
    });

    const update = __calls.find((call) => call.table === 'workouts' && call.op === 'update');
    expect(update?.payload).toMatchObject({
      planned_distance_meters: 27000,
      planned_duration_s: null,
      prescribed_quality_meters: 16000,
      structure,
    });
  });
});

describe('deletePlannedWorkout', () => {
  it('deletes the workout, records the consequence, and invalidates plan caches', async () => {
    await deletePlannedWorkout({
      planId: 'plan-1',
      workoutId: 'workout-1',
      date: '2026-07-24',
      title: 'Easy Run',
      queryClient: qc,
    });

    expect(__calls[0]).toMatchObject({
      table: 'workouts',
      op: 'delete',
      eq: 'workout-1',
    });
    const audit = __calls.find((call) => call.table === 'plan_changes');
    expect(audit?.payload).toMatchObject({
      plan_id: 'plan-1',
      actor_type: 'user',
      source: 'manual',
      change: {
        edits: [{
          kind: 'deleteWorkout',
          workoutId: 'workout-1',
          date: '2026-07-24',
          title: 'Easy Run',
        }],
      },
    });
  });
});

describe('saveWeekEdits — reflow apply', () => {
  it('hybrid card: lowers plan_weeks.target_meters (rounded) and audits newTarget', async () => {
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({ id: 'w1', date: '2026-06-18', plannedDistanceMeters: 4828 })],
      ops: REFLOW_OPS,
      queryClient: qc,
      reflow: { newTargetMeters: 33796.9 },
    });

    // plan_weeks write: target_meters ONLY — original_target_meters is the
    // immutable plan-of-record baseline and must never appear in the payload.
    const pw = __calls.filter((c) => c.table === 'plan_weeks');
    expect(pw).toHaveLength(1);
    expect(pw[0]!.op).toBe('update');
    expect(pw[0]!.eq).toBe('week-1');
    expect(pw[0]!.payload).toEqual({ target_meters: 33797 });
    expect(Object.keys(pw[0]!.payload)).not.toContain('original_target_meters');

    // Exactly one audit row, attributed to adapt, carrying the concession.
    const audits = __calls.filter((c) => c.table === 'plan_changes');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({
      plan_id: 'plan-1',
      actor_type: 'adapt',
      source: 'adapt',
    });
    const change = audits[0]!.payload['change'] as Record<string, unknown>;
    expect(change['kind']).toBe('reflow');
    expect(change['edits']).toEqual(REFLOW_OPS);
    expect(change['newTarget']).toBe(33797);

    // Order: workout writes -> target write -> audit.
    const order = __calls.map((c) => c.table);
    expect(order.indexOf('plan_weeks')).toBeGreaterThan(order.indexOf('workouts'));
    expect(order.indexOf('plan_changes')).toBeGreaterThan(order.indexOf('plan_weeks'));
  });

  it('full-recovery card (newTargetMeters null): no plan_weeks write, no newTarget in audit', async () => {
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({ id: 'w1', date: '2026-06-18', plannedDistanceMeters: 4828 })],
      ops: REFLOW_OPS,
      queryClient: qc,
      reflow: { newTargetMeters: null },
    });
    expect(__calls.some((c) => c.table === 'plan_weeks')).toBe(false);
    const audit = __calls.find((c) => c.table === 'plan_changes')!;
    expect(audit.payload).toMatchObject({ actor_type: 'adapt', source: 'adapt' });
    const change = audit.payload['change'] as Record<string, unknown>;
    expect(change['kind']).toBe('reflow');
    expect(change['newTarget']).toBeUndefined();
  });

  it('inserts a reflow-added PM double with its canonical title', async () => {
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [
        makeDay({ id: null, date: '2026-06-18', title: 'Easy Run', plannedDistanceMeters: 4828, isInserted: true }),
      ],
      ops: [{ kind: 'addDouble', onDate: '2026-06-18', distanceMeters: 4828 }],
      queryClient: qc,
      reflow: { newTargetMeters: null },
    });
    const ins = __calls.find((c) => c.table === 'workouts' && c.op === 'insert');
    expect(ins).toBeDefined();
    expect(ins!.payload).toMatchObject({
      plan_id: 'plan-1',
      week_id: 'week-1',
      date: '2026-06-18',
      type: 'easy',
      title: 'Easy Run',
      planned_distance_meters: 4828,
      is_quality: false,
    });
  });

  it('persists a structured workout hard-distance snapshot on insert', async () => {
    await saveWeekEdits({
      planId: 'plan-1',
      weekId: 'week-1',
      finalDays: [makeDay({
        id: null,
        date: '2026-06-18',
        type: 'quality',
        title: '6 × 3:00 at 5K',
        plannedDistanceMeters: 11_265,
        isQuality: true,
        isInserted: true,
        prescribedQualityMeters: 4_567.8,
        structure: [{
          kind: 'repeat',
          sets: 6,
          children: [{ kind: 'work', target: { by: ['time', 'pace'], duration_s: 180, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } }],
        }],
      })],
      ops: [{ kind: 'addDouble', onDate: '2026-06-18', distanceMeters: 11_265 }],
      queryClient: qc,
    });

    const ins = __calls.find((c) => c.table === 'workouts' && c.op === 'insert');
    expect(ins?.payload).toMatchObject({ prescribed_quality_meters: 4_568 });
  });
});
