/**
 * planView row→view mapping (test-audit gap #4).
 *
 * The Plan screen's tests mock this module wholesale, so until now the
 * MAPPING — DB rows into week sections, same-day actual attribution,
 * isMissed, aggregate rollups — was the thing the mocks replaced rather
 * than the thing under test. These drive `usePlanView` with mocked
 * useActivePlan/useActivities (the supabase edge) and assert on the real
 * derivation, plus the pure `aggregateActual` directly.
 */
import React from 'react';
import { renderHook } from '@testing-library/react-native';

const MI = 1609.34;

const mockPlanQ: { data: unknown; error: null; isLoading: boolean } = { data: null, error: null, isLoading: false };
const mockActsQ: { data: unknown[]; error: null; isLoading: boolean } = { data: [], error: null, isLoading: false };
jest.mock('../activePlan', () => ({
  useActivePlan: () => mockPlanQ,
}));
jest.mock('../activities', () => {
  const actual = jest.requireActual('../activities');
  return { ...actual, useActivities: () => mockActsQ };
});
jest.mock('../../supabase', () => ({ supabase: {} }));

// Freeze "today" so week/current/missed derivations are deterministic.
jest.mock('@/lib', () => {
  const actual = jest.requireActual('@/lib');
  return { ...actual, todayLocal: () => '2026-07-29' };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlanView, aggregateActual } = require('../planView') as typeof import('../planView');

const START = '2026-07-27'; // Monday — week 1 of the plan
const wk = (week_index: number) => ({
  id: `wk-${week_index}`, week_index, phase: 'build', is_recovery: false,
  target_meters: 70 * MI,
});
const wo = (id: string, week_id: string, date: string, type: string, miles: number) => ({
  id, week_id, date, type, title: null, is_quality: type === 'quality',
  planned_distance_meters: miles > 0 ? miles * MI : null, planned_duration_s: null,
  prescribed_quality_meters: null, structure: [],
});
const act = (id: string, local_date: string, miles: number, extra: Record<string, unknown> = {}) => ({
  id, local_date, start_date: `${local_date}T12:00:00Z`, distance_meters: miles * MI,
  moving_time_s: miles * 480, avg_hr: 140, name: 'Run', sport_type: 'Run', ...extra,
});

beforeEach(() => {
  mockPlanQ.data = {
    plan: { id: 'p1', start_date: START, num_weeks: 2, race_date: null, name: 'Test block' },
    weeks: [wk(1), wk(2)],
    workouts: [
      wo('w-mon', 'wk-1', '2026-07-27', 'easy', 10),
      wo('w-tue', 'wk-1', '2026-07-28', 'quality', 8),
      wo('w-wed', 'wk-1', '2026-07-29', 'easy', 6),
      wo('w-rest', 'wk-1', '2026-08-02', 'rest', 0),
    ],
  };
  mockActsQ.data = [act('a-mon', '2026-07-27', 10.4)];
});

test('maps plan rows into week sections with day rows (rest excluded from days)', () => {
  const { result } = renderHook(() => usePlanView('u1'));
  expect(result.current.loading).toBe(false);
  expect(result.current.sections).toHaveLength(2);
  const week1 = result.current.sections[0]!;
  expect(week1.weekStart).toBe(START);
  expect(week1.days.map((d) => d.workout.id)).toEqual(['w-mon', 'w-tue', 'w-wed']);
});

test('attributes a same-day activity to its workout as the day actual', () => {
  const { result } = renderHook(() => usePlanView('u1'));
  const monday = result.current.sections[0]!.days[0]!;
  expect(monday.actual).not.toBeNull();
  expect(monday.actual!.distanceMeters).toBeCloseTo(10.4 * MI);
  expect(monday.isMissed).toBe(false);
});

test('a PAST planned day with no run is missed; today and future are not', () => {
  const { result } = renderHook(() => usePlanView('u1'));
  const [mon, tue, wed] = result.current.sections[0]!.days;
  expect(mon!.isMissed).toBe(false); // ran
  expect(tue!.isMissed).toBe(true);  // yesterday, nothing ran
  expect(wed!.isMissed).toBe(false); // today is not yet missed
});

test('an activity on no planned day surfaces as an unplanned run, not silently dropped', () => {
  mockActsQ.data = [act('a-sat', '2026-08-01', 5)];
  const { result } = renderHook(() => usePlanView('u1'));
  const week1 = result.current.sections[0]!;
  expect(week1.unplanned.map((u) => u.activityId)).toEqual(['a-sat']);
});

test('aggregateActual sums distance, sums moving time, distance-weights HR', () => {
  const byId = new Map([
    ['a', { id: 'a', distance_meters: 8000, moving_time_s: 2400, avg_hr: 150 } as never],
    ['b', { id: 'b', distance_meters: 2000, moving_time_s: 700, avg_hr: 120 } as never],
  ]);
  const out = aggregateActual(['a', 'b'], byId);
  expect(out.distanceMeters).toBe(10000);
  expect(out.movingTimeS).toBe(3100);
  expect(out.avgHr).toBe(144); // (150·8000 + 120·2000) / 10000
});

test('aggregateActual with no HR/moving data reports nulls, not zeros', () => {
  const byId = new Map([['a', { id: 'a', distance_meters: 5000, moving_time_s: null, avg_hr: null } as never]]);
  const out = aggregateActual(['a'], byId);
  expect(out.movingTimeS).toBeNull();
  expect(out.avgHr).toBeNull();
});
