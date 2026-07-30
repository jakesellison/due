import { render, screen } from '@testing-library/react-native';

import type { PlanDay } from '@/app-lib/queries';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { WeekManifest } from '../WeekManifest';

test('cross training uses its duration instead of a zero-mile readout', () => {
  const crossDay = {
    workout: {
      id: 'cross-1',
      week_id: 'week-1',
      date: '2026-07-20',
      type: 'cross',
      title: 'Strength',
      planned_distance_meters: 0,
      planned_duration_s: 45 * 60,
      structure: [],
      is_quality: false,
      notes: null,
    },
    actual: null,
    isPast: false,
    isMissed: false,
  } satisfies PlanDay;

  render(
    <ThemeProvider preference="dark">
      <WeekManifest
        weekStart="2026-07-20"
        today="2026-07-18"
        days={[crossDay]}
        unplanned={[]}
        showActual={false}
        onPressWorkout={jest.fn()}
        onPressActivity={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('45m')).toBeTruthy();
  expect(screen.queryByText('0')).toBeNull();
  expect(screen.getByLabelText(/45 planned minutes/)).toBeTruthy();
});
