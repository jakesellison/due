import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { PlanOverviewContext } from '../PlanOverviewContext';

test('active context renders the Plan-tab facts without inventing an action', () => {
  render(
    <ThemeProvider preference="dark">
      <PlanOverviewContext
        name="Chicago Marathon"
        goalTime="Goal 2:36:00"
        primaryFacts="Marathon · Oct 11 · 81 days"
        secondaryFacts="Build · Week 11 of 23"
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Chicago Marathon')).toBeTruthy();
  expect(screen.getByText('Build · Week 11 of 23')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

test('review context makes only the anchor fact interactive', () => {
  const onChangeAnchor = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanOverviewContext
        name="Marathon · 45 mpw"
        primaryFacts="Marathon · 14 weeks"
        secondaryFacts="Starts Mon Jul 27"
        onSecondaryPress={onChangeAnchor}
        secondaryAccessibilityLabel="Change anchor"
      />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByLabelText('Change anchor'));
  expect(onChangeAnchor).toHaveBeenCalledTimes(1);
});

test('the active plan stays a quiet readout rather than introducing cover artwork', () => {
  render(
    <ThemeProvider preference="dark">
      <PlanOverviewContext
        name="Chicago Marathon"
        primaryFacts="Marathon · Oct 11 · 23-week plan"
        secondaryFacts="Build · Week 11"
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('plan-overview-context')).toBeTruthy();
  expect(screen.queryByTestId('plan-overview-strata', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText('Chicago Marathon')).toBeTruthy();
  expect(screen.getByText('Build · Week 11')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
