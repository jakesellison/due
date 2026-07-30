import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { CalendarDay } from '@/lib';
import { addDays } from '@/lib';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockBack = jest.fn();
const mockDismissTo = jest.fn();
const mockParams: { value: { selectedDate?: string } } = {
  value: { selectedDate: '2026-06-24' },
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo }),
  useLocalSearchParams: () => mockParams.value,
}));

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

function makeDay(localDate: string, dayIndex: number): CalendarDay {
  return {
    localDate,
    dayIndex,
    initial: 'MTWTFSS'[dayIndex] ?? 'M',
    state: localDate === '2026-06-24' ? 'today-pending' : 'upcoming',
    plannedMeters: 8047,
    actualMeters: 0,
    isQuality: false,
    isRace: false,
    isDouble: false,
    isToday: localDate === '2026-06-24',
    target: { kind: 'none' },
    workouts: [],
    primary: null,
    activities: [],
  };
}

const mockWeekly = {
  loading: false,
  error: null,
  plan: { id: 'p1', num_weeks: 3 },
  currentWeekIndex: 2,
  currentWeekStart: '2026-06-22',
  today: '2026-06-24',
  weekDaysFor: (anchor: string) =>
    Array.from({ length: 7 }, (_, index) => makeDay(addDays(anchor, index), index)),
};

jest.mock('@/app-lib/queries', () => ({
  useWeeklyMileage: () => mockWeekly,
}));

import WeekCalendarScreen from '../week-calendar';

beforeEach(() => {
  mockBack.mockClear();
  mockDismissTo.mockClear();
  mockParams.value = { selectedDate: '2026-06-24' };
});

test('renders as a focused calendar navigator without monthly goal totals', () => {
  render(
    <ThemeProvider preference="dark">
      <WeekCalendarScreen />
    </ThemeProvider>,
  );

  expect(screen.getByText('Choose a week')).toBeTruthy();
  expect(screen.getByText('June 2026')).toBeTruthy();
  expect(screen.queryByText('Month total')).toBeNull();
  expect(screen.queryByText('Quality')).toBeNull();
  expect(
    screen.getAllByRole('tab', { name: /Wednesday, 2026-06-24/i, selected: true }).length,
  ).toBeGreaterThan(0);
});

test('choosing a date dismisses to the Week screen with that date', () => {
  render(
    <ThemeProvider preference="dark">
      <WeekCalendarScreen />
    </ThemeProvider>,
  );

  act(() => {
    fireEvent.press(screen.getByTestId('cal-mday-2026-06-27'));
  });
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: '/(tabs)',
    params: { calendarDate: '2026-06-27' },
  });
});

test('Today returns directly to the current week', () => {
  mockParams.value = { selectedDate: '2026-06-30' };
  render(
    <ThemeProvider preference="dark">
      <WeekCalendarScreen />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByRole('button', { name: 'Return to today' }));
  expect(mockDismissTo).toHaveBeenCalledWith({
    pathname: '/(tabs)',
    params: { calendarDate: '2026-06-24' },
  });
});
