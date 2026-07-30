import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, Text } from 'react-native';

import type { PlanBlueprintWeek } from '@/lib';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { data, THEMES } from '@/theme/tokens';
import { PlanLedger } from '../PlanLedger';

const weeks = [
  makeWeek(1, 'build', 'past', 55, 57),
  makeWeek(2, 'build', 'current', 65, 31),
  makeWeek(3, 'peak', 'future', 72, 0),
  makeWeek(4, 'peak', 'future', 76, 0, true),
];

test('phase headers select the first week in a newly opened phase', () => {
  const onSelectWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={onSelectWeek}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByLabelText(/^Week 2,/)).toBeTruthy();
  expect(screen.queryByLabelText(/^Week 3,/)).toBeNull();

  fireEvent.press(screen.getByLabelText(/^Peak phase,/));

  expect(onSelectWeek).toHaveBeenCalledWith(3);
  expect(screen.getByTestId('phase-title-build')).toHaveStyle({ color: THEMES.dark.ink });
  expect(screen.getByTestId('phase-title-peak')).toHaveStyle({ color: THEMES.dark.ink });
  expect(screen.queryByTestId('phase-mark-build')).toBeNull();
  expect(screen.queryByTestId('phase-mark-peak')).toBeNull();
});

test('the roadmap stays strategic and omits historical execution verdicts', () => {
  render(
    <ThemeProvider preference="light">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={1}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('55–65 mi')).toBeTruthy();
  expect(screen.queryByText('+2 mi')).toBeNull();
  expect(screen.queryByText(/met/i)).toBeNull();
  expect(screen.queryByText(/banked/i)).toBeNull();
  expect(screen.queryByLabelText('Adjust week 1')).toBeNull();
});

test('the selected week exposes contract composition and a direct week drill', () => {
  const onOpenWeek = jest.fn();
  const onAdjustWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        onAdjustWeek={onAdjustWeek}
        onOpenWeek={onOpenWeek}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Weekly contract')).toBeTruthy();
  expect(screen.getByText('Quality')).toBeTruthy();
  expect(screen.getByText('Long run')).toBeTruthy();
  expect(screen.getByText('Miles open')).toBeTruthy();
  expect(screen.getByText('8 quality · 18 long')).toBeTruthy();
  expect(screen.getByText('CURRENT')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Adjust week 2'));
  expect(onAdjustWeek).toHaveBeenCalledWith(2);

  fireEvent.press(screen.getByLabelText('View Week 2'));
  expect(onOpenWeek).toHaveBeenCalledWith(2);
});

test('preview mode keeps the plan grammar but removes live-only actions', () => {
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks.map((week) => ({ ...week, state: 'future', isCurrent: false, isFuture: true }))}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        renderWeekDetails={() => <Text>Planned runs</Text>}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Training blocks')).toBeTruthy();
  expect(screen.getByText('Planned runs')).toBeTruthy();
  expect(screen.queryByLabelText('Adjust week 2')).toBeNull();
  expect(screen.queryByLabelText('View Week 2')).toBeNull();
  expect(screen.queryByText('CURRENT')).toBeNull();
});

test('the compact carousel uses centered paging, faded neighbors, and date-first week summaries', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.queryByTestId('plan-week-focus')).toBeNull();
  expect(screen.getByTestId('plan-week-page-indicator')).toBeTruthy();
  expect(screen.getByTestId('plan-week-page-2')).toHaveStyle({
    width: 20,
    backgroundColor: THEMES.dark.yellow,
  });
  expect(screen.getByText('Jun 8–14')).toHaveProp('numberOfLines', 1);
  expect(screen.getByText('Jun 8–14')).toHaveProp('adjustsFontSizeToFit', true);
  expect(screen.queryByTestId('plan-week-quality-2')).toBeNull();
  expect(screen.queryByTestId('plan-week-long-2')).toBeNull();
  expect(screen.getByLabelText(/^Week 2,/).props.accessibilityLabel).not.toMatch(/quality|long-run targets/i);
  expect(screen.getByTestId('plan-week-1')).toHaveStyle({ opacity: 0.54 });
  expect(screen.getByText('Jun 8–14')).toHaveStyle({
    fontFamily: undefined,
    fontWeight: '700',
  });
  expect(within(screen.getByTestId('plan-week-2')).getByText('65 mi')).toHaveStyle({
    color: THEMES.dark.ink,
    fontFamily: data,
  });
  dimensions.mockRestore();
});

test('training phases share one bounded surface and the selected phase opens into a restrained gradient field', () => {
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('plan-ledger-surface')).toHaveStyle({
    backgroundColor: THEMES.dark.card,
    borderColor: THEMES.dark.line,
  });
  expect(screen.getByTestId('plan-phase-group-build')).toHaveStyle({
    backgroundColor: THEMES.dark.recess,
  });
  expect(screen.getByTestId('plan-phase-gradient-build')).toBeTruthy();
  expect(screen.getByTestId('plan-phase-body-build')).toHaveStyle({
    backgroundColor: 'transparent',
  });
});

test('a selected non-current week uses a neutral page marker while preserving the yellow current position', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={1}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('plan-week-page-1')).toHaveStyle({
    width: 20,
    backgroundColor: THEMES.dark.ink,
  });
  expect(screen.getByTestId('plan-week-page-2')).toHaveStyle({
    width: 5,
    backgroundColor: THEMES.dark.yellow,
  });
  expect(screen.queryByTestId('plan-current-week-2')).toBeNull();
  dimensions.mockRestore();
});

test('a settled weekly strategy states the shape once without re-narrating volume', () => {
  const settled = {
    ...weeks[1]!,
    qualityOpenMeters: 0,
    longOpenMeters: 0,
  };
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={[weeks[0]!, settled, weeks[2]!, weeks[3]!]}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('5 run days · 0 key sessions')).toBeTruthy();
  expect(screen.queryByText(/High volume/)).toBeNull();
});

test('the phase header owns disclosure and collapses in place', () => {
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('phase-header-build').props.accessibilityState).toEqual({ expanded: true });
  fireEvent.press(screen.getByTestId('phase-header-build'));
  expect(screen.queryByTestId('plan-phase-body-build')).toBeNull();
  expect(screen.getByTestId('phase-header-build').props.accessibilityState).toEqual({ expanded: false });
  expect(screen.queryByTestId('phase-hinge-build')).toBeNull();
  fireEvent.press(screen.getByTestId('phase-header-build'));
  expect(screen.getByTestId('plan-phase-body-build')).toBeTruthy();
});

test('inspecting another week keeps the current week one tap away', () => {
  const onSelectWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={3}
        onSelectWeek={onSelectWeek}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Week 2 is current')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Return to current week, Week 2'));
  expect(onSelectWeek).toHaveBeenCalledWith(2);
});

test('settling the phase reel selects the centered week', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  const onSelectWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={1}
        onSelectWeek={onSelectWeek}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  fireEvent(screen.getByTestId('plan-week-reel'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 92 } },
  });
  expect(onSelectWeek).toHaveBeenCalledWith(2);
  dimensions.mockRestore();
});

test('carousel arrows stop at the containing phase boundary', () => {
  const onSelectWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={onSelectWeek}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  const next = screen.getByLabelText('Next week');
  expect(next.props.accessibilityState).toEqual({ disabled: true });
  fireEvent.press(next);
  expect(onSelectWeek).not.toHaveBeenCalled();
});

test('recovery weeks communicate strategy instead of an outcome state', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={4}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Recovery · miles open')).toBeTruthy();
  expect(screen.getByTestId('plan-week-recovery-4')).toBeTruthy();
  expect(screen.queryByText('Upcoming')).toBeNull();
  dimensions.mockRestore();
});

test('an overscheduled weekly contract is visible before opening the editor', () => {
  const over = {
    ...weeks[2]!,
    allocationDeltaMeters: -5 * 1609.344,
    qualityOpenMeters: 0,
    longOpenMeters: 0,
  };
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={[weeks[0]!, weeks[1]!, over, weeks[3]!]}
        selectedWeekIndex={3}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('5 mi over contract')).toBeTruthy();
});

test('over-allocation stays visible when a supporting contract is also open', () => {
  const compound = {
    ...weeks[2]!,
    allocationDeltaMeters: -5 * 1609.344,
    qualityOpenMeters: 2 * 1609.344,
    longOpenMeters: 6 * 1609.344,
  };
  render(
    <ThemeProvider preference="dark">
      <PlanLedger
        weeks={[weeks[0]!, weeks[1]!, compound, weeks[3]!]}
        selectedWeekIndex={3}
        onSelectWeek={jest.fn()}
        onAdjustWeek={jest.fn()}
        onOpenWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('5 over · 2 quality · 6 long open')).toBeTruthy();
});

function makeWeek(
  weekIndex: number,
  structuralPhase: string,
  state: PlanBlueprintWeek['state'],
  targetMi: number,
  actualMi: number,
  isRecovery = false,
): PlanBlueprintWeek {
  const meters = (miles: number) => miles * 1609.344;
  return {
    weekId: `week-${weekIndex}`,
    weekIndex,
    weekStart: `2026-06-${String(1 + (weekIndex - 1) * 7).padStart(2, '0')}`,
    phase: isRecovery ? 'recovery' : structuralPhase,
    structuralPhase,
    isRecovery,
    targetMeters: meters(targetMi),
    originalTargetMeters: null,
    qualityTargetMeters: meters(8),
    longTargetMeters: meters(18),
    actualMeters: meters(actualMi),
    isCurrent: state === 'current',
    isFuture: state === 'future',
    state,
    revised: false,
    revisionDeltaMeters: 0,
    runDays: 5,
    keySessions: [],
    scheduledSupportMeters: meters(targetMi),
    scheduledSupportDays: 5,
    scheduledTotalMeters: meters(targetMi),
    allocationDeltaMeters: 0,
    qualityCoverageMeters: 0,
    longCoverageMeters: 0,
    qualityOpenMeters: meters(8),
    longOpenMeters: meters(18),
  };
}
