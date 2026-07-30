/**
 * Render-hook test for the weekDays / weekDaysFor / currentWeekStart fields
 * added to useWeeklyMileage. Uses a seeded QueryClient so no real network or
 * Supabase calls are made.
 *
 * `app` Jest project (jest-expo).
 */

// Supabase is imported transitively through useActivePlan / useActivities; stub
// the client so the module loads without baked config.
jest.mock('../../supabase', () => ({ supabase: { from: jest.fn() } }));

// AsyncStorage is used by quality-overrides query; provide a minimal stub.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useWeeklyMileage } from '../weeklyMileage';
import type { ActivePlan } from '../rows';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Pin today to a known Monday so the week start is deterministic.
// 2026-06-22 is a Monday (week starts Mon per WEEK_START).
const TODAY = '2026-06-22';

// Mock todayLocal so the hook returns a deterministic date.
jest.mock('../internal', () => {
  const actual = jest.requireActual('../internal');
  return { ...actual, todayLocal: () => TODAY };
});

const PLAN_ID = 'plan-1';
const WEEK_ID = 'week-1';

/** A quality workout scheduled on TODAY (Monday). */
const qualityWorkout = {
  id: 'wo-quality',
  week_id: WEEK_ID,
  date: TODAY,
  type: 'quality',
  title: '4×1mi Intervals',
  planned_distance_meters: 10000,
  planned_duration_s: null,
  structure: [],
  is_quality: true,
  notes: null,
};

const easyWorkout = {
  id: 'wo-easy',
  week_id: WEEK_ID,
  date: '2026-06-24', // Wednesday
  type: 'easy',
  title: 'Easy Run',
  planned_distance_meters: 8000,
  planned_duration_s: null,
  structure: [],
  is_quality: false,
  notes: null,
};

const activePlanData: ActivePlan = {
  plan: {
    id: PLAN_ID,
    race_name: 'Chicago 2026',
    race_date: '2026-10-11',
    distance_kind: 'marathon',
    start_date: TODAY, // plan starts today
    num_weeks: 16,
    status: 'active',
    goal_time: null,
  },
  weeks: [
    {
      id: WEEK_ID,
      week_index: 1,
      phase: 'base',
      target_meters: 60000,
      original_target_meters: 60000,
      quality_target_meters: 6000,
      long_target_meters: 20000,
      is_recovery: false,
    },
  ],
  workouts: [qualityWorkout, easyWorkout],
};

// ── Provider wrapper ───────────────────────────────────────────────────────────

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeQc(userId: string, activities: unknown[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the active-plan cache entry so useActivePlan resolves instantly.
  qc.setQueryData(['activePlan', userId], activePlanData);
  // Seed activities as empty (no logged runs yet).
  qc.setQueryData(
    ['activities', userId, TODAY, '2026-10-12'], // plan window
    activities,
  );
  return qc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWeeklyMileage — weekDays / weekDaysFor / currentWeekStart', () => {
  const USER = 'u-test';

  it('exposes a currentWeekStart that equals the Monday of today', async () => {
    const qc = makeQc(USER);
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.weekDays).toBeDefined());
    // 2026-06-22 IS a Monday, so weekStart === today itself.
    expect(result.current.currentWeekStart).toBe(TODAY);
  });

  it('weekDays has exactly 7 entries covering Mon→Sun', async () => {
    const qc = makeQc(USER);
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.weekDays).toBeDefined());
    expect(result.current.weekDays).toHaveLength(7);
  });

  it("today's CalendarDay has isToday=true", async () => {
    const qc = makeQc(USER);
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.weekDays).toBeDefined());
    const today = result.current.weekDays.find((d) => d.isToday);
    expect(today).toBeDefined();
    expect(today?.localDate).toBe(TODAY);
  });

  it("today's primary workout has tone 'quality'", async () => {
    const qc = makeQc(USER);
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.weekDays).toBeDefined());
    const today = result.current.weekDays.find((d) => d.isToday);
    expect(today?.primary?.tone).toBe('quality');
  });

  it('weekDaysFor returns 7 days for an arbitrary anchor date', async () => {
    const qc = makeQc(USER);
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.weekDaysFor).toBeDefined());
    // Pass the next week's Monday.
    const nextWeekDays = result.current.weekDaysFor('2026-06-29');
    expect(nextWeekDays).toHaveLength(7);
  });

  it('weekDaysFor returns [] when plan data is not loaded', async () => {
    // Use a fresh QC with NO seeded data so both queries return undefined.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });
    // Before plan data resolves, weekDaysFor should return [].
    expect(result.current.weekDaysFor('2026-06-29')).toEqual([]);
  });

  it('keeps the stored long contract and never combines split activities', async () => {
    const qc = makeQc(USER, [
      { id: 'a-6', local_date: TODAY, distance_meters: 9_656, stream_summary: null },
      { id: 'a-8', local_date: TODAY, distance_meters: 12_875, stream_summary: null },
      { id: 'a-3', local_date: TODAY, distance_meters: 4_828, stream_summary: null },
    ]);
    const { result } = renderHook(() => useWeeklyMileage(USER), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.weekGoals).toHaveLength(1));
    expect(result.current.weekGoals[0]?.long.targetMeters).toBe(20_000);
    expect(result.current.weekGoals[0]?.long.actualMeters).toBe(12_875);
    expect(result.current.weekGoals[0]?.long.hit).toBe(false);
  });

  it('keeps the settled goal ledger after the final plan week closes', async () => {
    const completedPlan: ActivePlan = {
      plan: {
        ...activePlanData.plan,
        start_date: '2026-06-08',
        num_weeks: 2,
      },
      weeks: [
        { ...activePlanData.weeks[0]!, id: 'week-2', week_index: 2, phase: 'build' },
        { ...activePlanData.weeks[0]!, id: 'week-1', week_index: 1, phase: 'base' },
      ],
      workouts: [],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['activePlan', USER], completedPlan);
    qc.setQueryData(
      ['activities', USER, '2026-06-08', '2026-06-22'],
      [
        { id: 'week-1-run', local_date: '2026-06-08', distance_meters: 60_000, moving_time_s: 18_000 },
        { id: 'week-2-run', local_date: '2026-06-15', distance_meters: 60_000, moving_time_s: 18_000 },
      ],
    );

    const { result } = renderHook(() => useWeeklyMileage(USER), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.weekGoals).toHaveLength(2));
    expect(result.current.weekGoals.map((goal) => ({
      index: goal.weekIndex,
      start: goal.weekStart,
      current: goal.isCurrent,
      future: goal.isFuture,
      mileageHit: goal.mileage.hit,
    }))).toEqual([
      { index: 1, start: '2026-06-08', current: false, future: false, mileageHit: true },
      { index: 2, start: '2026-06-15', current: false, future: false, mileageHit: true },
    ]);
  });
});
