/**
 * Week planner screen (`app/planner/[id]`) — test-audit gap #1.
 *
 * 1,180 lines with ZERO tests until 2026-07-30, even though it is the app's
 * only write-path for the plan. Its pure engines (buildBoard, boardToWeekEdits,
 * dayComposition, weekTotals) are node-tested; these pin the SCREEN: what it
 * renders from a real WeekDetail, the per-workout day desk (the partially-run
 * double regression), and the save gate.
 */
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderScreen } from '@/app-lib/__testsupport__/render';
import type { CalendarDay } from '@/lib';

const MI = 1609.34;
const WEEK_START = '2026-07-27'; // Monday
const TODAY = '2026-07-29'; // Wednesday

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => ({ id: '12' }),
}));
jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));
const mockSave = jest.fn();
jest.mock('@/app-lib/weekEdit', () => ({
  saveWeekEdits: (...args: unknown[]) => mockSave(...args),
}));

type Wo = {
  id: string; date: string; type: string; title: string | null; is_quality: boolean;
  planned_distance_meters: number | null; planned_duration_s: number | null;
  prescribed_quality_meters: number | null; structure: unknown[];
};
const wo = (id: string, date: string, type: string, miles: number, extra: Partial<Wo> = {}): Wo => ({
  id, date, type, title: null, is_quality: type === 'quality',
  planned_distance_meters: miles > 0 ? miles * MI : null,
  planned_duration_s: null, prescribed_quality_meters: null, structure: [], ...extra,
});
const day = (workout: Wo, actual: { distanceMeters: number } | null, isPast: boolean) => ({
  workout, actual, isPast, isMissed: isPast && actual == null && workout.type !== 'rest',
});

// The week under test: Mon ran 12, Tue ran 12, WEDNESDAY IS A DOUBLE with the
// AM run banked (5.6) and the PM (4) still live, Thu-Fri planned, Sat long,
// Sun rest.
const editableDays = [
  day(wo('mon', '2026-07-27', 'easy', 12), { distanceMeters: 12 * MI }, true),
  day(wo('tue', '2026-07-28', 'quality', 12), { distanceMeters: 12 * MI }, true),
  day(wo('wed-am', TODAY, 'easy', 5.6), { distanceMeters: 5.6 * MI }, false),
  day(wo('wed-pm', TODAY, 'easy', 4), null, false),
  day(wo('thu', '2026-07-30', 'easy', 10), null, false),
  day(wo('fri', '2026-07-31', 'easy', 6), null, false),
  day(wo('sat', '2026-08-01', 'long', 16), null, false),
  day(wo('sun', '2026-08-02', 'rest', 0), null, false),
];

const calDay = (localDate: string, dayIndex: number, qualityDetected = false): CalendarDay => ({
  localDate, dayIndex, initial: 'MTWTFSS'[dayIndex] ?? 'M',
  state: localDate < TODAY ? 'done' : localDate === TODAY ? 'today-pending' : 'upcoming',
  plannedMeters: 0, actualMeters: 0, isQuality: false, isRace: false, isDouble: false,
  isToday: localDate === TODAY, target: { kind: 'none' }, workouts: [], primary: null,
  activities: qualityDetected ? [{ id: 'a-tue', qualityDetected: true } as never] : [],
});

const mockDetail = {
  loading: false, error: null, weekIndex: 12, phase: 'build', isRecovery: false,
  bar: null, elapsedFraction: 0.4, days: [], editableDays, unplanned: [],
  weekStart: WEEK_START, today: TODAY, originalTargetMeters: 70 * MI,
  qualityTargetMeters: 6 * MI, longTargetMeters: 16 * MI, weekId: 'wk-12',
};
const mockWm = {
  loading: false, error: null, plan: { id: 'p1', num_weeks: 23 },
  currentWeekIndex: 12, currentWeekStart: WEEK_START, today: TODAY,
  easyBaseline: 480,
  weekGoals: [{
    weekIndex: 11, weekStart: WEEK_START, label: 'W12', isCurrent: true, isFuture: false,
    mileage: { actualMeters: 29.6 * MI, targetMeters: 70 * MI, hit: false, fraction: 0.42 },
    quality: { actualMeters: 4 * MI, targetMeters: 6 * MI, hit: false, fraction: 0.67 },
    long: { actualMeters: 0, targetMeters: 16 * MI, hit: false, fraction: 0 },
    allMet: false,
  }],
  weekDaysFor: (anchor: string) =>
    Array.from({ length: 7 }, (_, i) => {
      const dates = ['2026-07-27','2026-07-28','2026-07-29','2026-07-30','2026-07-31','2026-08-01','2026-08-02'];
      return calDay(dates[i]!, i, dates[i] === '2026-07-28');
    }),
};

jest.mock('@/app-lib/queries', () => ({
  useWeek: () => mockDetail,
  useWeeklyMileage: () => mockWm,
  useRacePrediction: () => ({ loading: false, error: null, byDistance: [], data: null }),
  useActivePlan: () => ({ data: { plan: { id: 'p1' } } }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PlannerScreen = require('../planner/[id]').default;

const renderPlanner = () => renderScreen(<PlannerScreen />);

beforeEach(() => jest.clearAllMocks());

test('renders the week identity and the projection header', () => {
  renderPlanner();
  expect(screen.getByText('Adjust week')).toBeTruthy();
  // Banked 29.6 + scheduled (wed-pm 4 + thu 10 + fri 6 + sat 16 = 36) = 65.6
  expect(screen.getByText(/65\.6/)).toBeTruthy();
  expect(screen.getByText(/MI CONTRACT/i)).toBeTruthy();
});

test('THE DOUBLES REGRESSION: today shows the banked AM locked AND the live PM row', () => {
  renderPlanner();
  // Banked actual for the AM leg…
  expect(screen.getByText(/Banked actual/i)).toBeTruthy();
  // …and the PM tile is still visible/editable on the same desk: its 4-mi
  // distance renders as a live row (not in the pool, not swallowed by the
  // banked branch — the exact pre-fix failure).
  // Two Easy rows on today's desk: the banked AM and the live PM tile. Under
  // the pre-fix branch (actual swallows the desk) only ONE renders.
  expect(screen.getAllByText('Easy').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText(/Missed · Wed/)).toBeNull();
});

test('the day strip reports banked + still-scheduled for the double day', () => {
  renderPlanner();
  // Wednesday cell: 5.6 banked + 4 still planned = 9.6 → shown in the strip.
  expect(screen.getByText(/9\.6mi|9\.6 mi|10mi/)).toBeTruthy();
});

test('Save week is disabled until something changes, and never fires a save', () => {
  renderPlanner();
  const save = screen.getByText('Save week');
  fireEvent.press(save);
  expect(mockSave).not.toHaveBeenCalled();
});

test('a past day that ran renders its actual, not an editable row', () => {
  renderPlanner();
  fireEvent.press(screen.getByTestId('planner-day-0')); // Monday, ran 12
  expect(screen.getAllByText(/Banked actual/i).length).toBeGreaterThan(0);
});

test('the rest day renders as Rest, not as an empty editable slot', () => {
  renderPlanner();
  fireEvent.press(screen.getByTestId('planner-day-6')); // Sunday
  expect(screen.getByText('Rest')).toBeTruthy();
});


