import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { State } from 'react-native-gesture-handler';

import { goalStat, type PlanBlueprintWeek, type WeekGoal } from '@/lib';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { radius, THEMES } from '@/theme/tokens';
import {
  blueprintIndexAtX,
  blueprintIndexAtXWithHysteresis,
  PlanBlueprint,
} from '../PlanBlueprint';

const weeks: PlanBlueprintWeek[] = [
  makeWeek(1, 55, 57, 'past'),
  makeWeek(2, 65, 61, 'current'),
  makeWeek(3, 60, 0, 'future', { isRecovery: true, originalTargetMi: 72 }),
  makeWeek(4, 76, 0, 'future'),
];

const progress: WeekGoal[] = [
  makeGoal(1, 55, 57, 8, 9, 18, 18, 'past'),
  makeGoal(2, 65, 61, 8, 5, 18, 16, 'current'),
  makeGoal(3, 60, 0, 4, 0, 14, 0, 'future'),
  makeGoal(4, 76, 0, 10, 0, 20, 0, 'future'),
];

test('the overview makes the whole plan legible without narrating its encoding', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint weeks={weeks} selectedWeekIndex={2} onSelectWeek={jest.fn()} />
    </ThemeProvider>,
  );

  expect(screen.getByText(/Mileage profile/)).toBeTruthy();
  expect(screen.queryByText('HEIGHT CONTRACT · FILL BANKED')).toBeNull();
  expect(screen.queryByText(/CAP OVER/)).toBeNull();
  expect(screen.getByText('Week 2 · May 11–17')).toBeTruthy();
  expect(screen.getByText('Plan mileage')).toBeTruthy();
  expect(screen.getByText('256')).toBeTruthy();
  expect(screen.getByText('4 weeks · 76 mi peak')).toBeTruthy();
  expect(within(screen.getByTestId('plan-blueprint-quality-trace')).getByText('Quality')).toBeTruthy();
  expect(within(screen.getByTestId('plan-blueprint-quality-trace')).getByText('0 mi')).toBeTruthy();
  expect(within(screen.getByTestId('plan-blueprint-long-trace')).getByText('0')).toBeTruthy();
  expect(screen.getAllByTestId(/^plan-blueprint-vessel-\d+$/, { includeHiddenElements: true })).toHaveLength(4);
  expect(screen.queryByTestId('plan-blueprint-recovery-3', { includeHiddenElements: true })).toBeNull();
  dimensions.mockRestore();
});

test('the mileage profile uses the same neutral card surface as the week view', () => {
  render(
    <ThemeProvider preference="light">
      <PlanBlueprint weeks={weeks} selectedWeekIndex={2} onSelectWeek={jest.fn()} />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('plan-blueprint')).toHaveStyle({
    backgroundColor: THEMES.light.card,
    borderColor: THEMES.light.line,
    borderRadius: radius.md,
  });
});

test('the chart readout does not drop below the Week surface text scale', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint weeks={weeks} selectedWeekIndex={2} onSelectWeek={jest.fn()} />
    </ThemeProvider>,
  );

  expect(screen.getByText('Plan mileage')).toHaveStyle({ fontSize: 12 });
  expect(screen.getByText('256')).toHaveStyle({ fontSize: 38 });
  expect(screen.getByText('4 weeks · 76 mi peak')).toHaveStyle({ fontSize: 11 });
  expect(screen.getByText('Quality')).toHaveStyle({ fontSize: 12 });
  dimensions.mockRestore();
});

test('supporting progress metrics reflow before labels can collapse at larger text sizes', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1.2,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        progress={{ weekGoals: progress }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('plan-blueprint-supporting')).toHaveStyle({
    flexDirection: 'column',
  });
  expect(screen.getByText('Quality').props.numberOfLines).toBe(1);
  expect(screen.getByText('13/30').props.numberOfLines).toBe(1);
  dimensions.mockRestore();
});

test('canonical progress fills elapsed mileage and summarizes quality and long runs', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        progress={{ weekGoals: progress }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Banked in this plan')).toBeTruthy();
  expect(screen.getByText('118')).toBeTruthy();
  expect(screen.getByText('of 256 plan mi')).toBeTruthy();
  expect(screen.getByText('1/1')).toBeTruthy();
  expect(screen.getByText('CONTRACTS MET')).toBeTruthy();
  expect(screen.getByText('Plan')).toBeTruthy();
  expect(screen.getByText('Banked')).toBeTruthy();
  expect(screen.getByLabelText(/Quality miles, 13 of 30 miles, 17 miles left/)).toBeTruthy();
  expect(screen.getByLabelText(/Long runs, 1 of 4, 3 left/)).toBeTruthy();
  expect(screen.getByTestId('plan-blueprint-actual-1', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('plan-blueprint-actual-2', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('plan-blueprint-actual-3', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('plan-blueprint-actual-4', { includeHiddenElements: true })).toBeNull();
  const firstBanked = StyleSheet.flatten(
    screen.getByTestId('plan-blueprint-actual-1', { includeHiddenElements: true }).props.style,
  );
  const firstContract = StyleSheet.flatten(
    screen.getByTestId('plan-blueprint-vessel-shape-1', { includeHiddenElements: true }).props.style,
  );
  expect(firstBanked.height).toBeGreaterThan(firstContract.height);
  expect(screen.queryByTestId('plan-blueprint-over-1', { includeHiddenElements: true })).toBeNull();
  dimensions.mockRestore();
});

test('current position persists when the user inspects a different week', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint
        weeks={weeks}
        selectedWeekIndex={4}
        onSelectWeek={jest.fn()}
        progress={{ weekGoals: progress }}
      />
    </ThemeProvider>,
  );

  act(() => {
    fireEvent(screen.getByTestId('plan-blueprint-plot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 240 } },
    });
  });

  expect(screen.getByTestId('plan-blueprint-actual-key')).toBeTruthy();
  expect(screen.getByTestId('plan-blueprint-current-2')).toBeTruthy();
  expect(screen.getByText('Week 4 · 76 mi plan')).toBeTruthy();
  expect(screen.getByLabelText(/Week 4, Build/)).toBeTruthy();
  expect(screen.getByTestId('plan-blueprint-vessel-shape-4', { includeHiddenElements: true })).toHaveStyle({
    borderColor: THEMES.dark.ink,
  });
  dimensions.mockRestore();
});

test('current-week overage stays one continuous yellow bar beyond its contract vessel', () => {
  const meters = (miles: number) => miles * 1609.344;
  const overWeeks = weeks.map((week) => week.weekIndex === 2
    ? { ...week, actualMeters: meters(70) }
    : week);
  const overProgress = progress.map((goal) => goal.weekIndex === 2
    ? { ...goal, mileage: goalStat(meters(70), meters(65), 1) }
    : goal);
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint
        weeks={overWeeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        progress={{ weekGoals: overProgress }}
      />
    </ThemeProvider>,
  );

  const banked = screen.getByTestId('plan-blueprint-actual-2', { includeHiddenElements: true });
  const contract = screen.getByTestId('plan-blueprint-vessel-shape-2', { includeHiddenElements: true });
  expect(banked).toHaveStyle({
    backgroundColor: THEMES.dark.yellow,
  });
  expect(StyleSheet.flatten(banked.props.style).height).toBeGreaterThan(
    StyleSheet.flatten(contract.props.style).height,
  );
  expect(screen.queryByTestId('plan-blueprint-over-2', { includeHiddenElements: true })).toBeNull();
});

test('the profile is adjustable without requiring a precision scrub gesture', () => {
  const onSelectWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint weeks={weeks} selectedWeekIndex={2} onSelectWeek={onSelectWeek} />
    </ThemeProvider>,
  );

  const profile = screen.getByRole('adjustable');
  fireEvent(profile, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  fireEvent(profile, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(onSelectWeek).toHaveBeenNthCalledWith(1, 3);
  expect(onSelectWeek).toHaveBeenNthCalledWith(2, 1);
});

test('accessibility text sizes keep the instrument intact and collapse subordinate chrome', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 2,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint
        weeks={weeks}
        selectedWeekIndex={2}
        onSelectWeek={jest.fn()}
        progress={{ weekGoals: progress }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByRole('summary').props.accessibilityLabel).toContain('1 of 1 completed weekly contracts met');
  expect(screen.queryByText('CONTRACTS MET')).toBeNull();
  expect(screen.getByText('1/1 weeks met')).toBeTruthy();
  expect(screen.getByRole('adjustable').props.accessibilityValue).toEqual({
    text: 'Week 2 of 4, Build, 61 of 65 miles banked',
  });
  expect(screen.getByTestId('plan-blueprint-quality-trace')).toHaveStyle({ minHeight: 44 });
  expect(screen.getByTestId('plan-blueprint-long-trace')).toHaveStyle({ minHeight: 44 });
  dimensions.mockRestore();
});

test('future selections do not fabricate an actual-mileage marker', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint
        weeks={weeks}
        selectedWeekIndex={3}
        onSelectWeek={jest.fn()}
        progress={{ weekGoals: progress }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('plan-blueprint-actual-key')).toBeTruthy();
  expect(screen.queryByTestId('plan-blueprint-actual-3', { includeHiddenElements: true })).toBeNull();
  dimensions.mockRestore();
});

test('scrub coordinates snap across the full plot, including both edges', () => {
  expect(blueprintIndexAtX(0, 400, 4)).toBe(0);
  expect(blueprintIndexAtX(99, 400, 4)).toBe(0);
  expect(blueprintIndexAtX(100, 400, 4)).toBe(1);
  expect(blueprintIndexAtX(250, 400, 4)).toBe(2);
  expect(blueprintIndexAtX(400, 400, 4)).toBe(3);
});

test('invalid plot geometry never selects a week', () => {
  expect(blueprintIndexAtX(20, 0, 4)).toBe(-1);
  expect(blueprintIndexAtX(20, 400, 0)).toBe(-1);
  expect(blueprintIndexAtX(Number.NaN, 400, 4)).toBe(-1);
});

test('scrub hysteresis prevents adjacent weeks from flickering at a boundary', () => {
  expect(blueprintIndexAtXWithHysteresis(110, 400, 4, 0)).toBe(0);
  expect(blueprintIndexAtXWithHysteresis(119, 400, 4, 0)).toBe(1);
  expect(blueprintIndexAtXWithHysteresis(90, 400, 4, 1)).toBe(1);
  expect(blueprintIndexAtXWithHysteresis(81, 400, 4, 1)).toBe(0);
  expect(blueprintIndexAtXWithHysteresis(320, 400, 4, 0)).toBe(3);
});

test('a drag previews locally and commits only its final week to the plan surface', () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  const onSelectWeek = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <PlanBlueprint weeks={weeks} selectedWeekIndex={1} onSelectWeek={onSelectWeek} />
    </ThemeProvider>,
  );

  act(() => {
    fireEvent(screen.getByTestId('plan-blueprint-plot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 240 } },
    });
  });
  act(() => {
    fireGestureHandler(getByGestureTestId('plan-blueprint-pan'), [
      { state: State.BEGAN, x: 50 },
      { state: State.ACTIVE, x: 250 },
      { state: State.ACTIVE, x: 350 },
      { state: State.END, x: 350 },
    ]);
  });

  expect(onSelectWeek).toHaveBeenCalledTimes(1);
  expect(onSelectWeek).toHaveBeenCalledWith(4);
  expect(screen.getByText('Week 4 · May 25–31')).toBeTruthy();
  dimensions.mockRestore();
});

function makeWeek(
  weekIndex: number,
  targetMi: number,
  actualMi: number,
  state: PlanBlueprintWeek['state'],
  overrides: { isRecovery?: boolean; originalTargetMi?: number } = {},
): PlanBlueprintWeek {
  const meters = (miles: number) => miles * 1609.344;
  return {
    weekId: `week-${weekIndex}`,
    weekIndex,
    weekStart: `2026-05-${String(4 + (weekIndex - 1) * 7).padStart(2, '0')}`,
    phase: overrides.isRecovery ? 'recovery' : 'build',
    structuralPhase: 'build',
    isRecovery: overrides.isRecovery ?? false,
    targetMeters: meters(targetMi),
    originalTargetMeters: overrides.originalTargetMi == null ? null : meters(overrides.originalTargetMi),
    actualMeters: meters(actualMi),
    isCurrent: state === 'current',
    isFuture: state === 'future',
    state,
    revised: overrides.originalTargetMi != null && overrides.originalTargetMi !== targetMi,
    revisionDeltaMeters: overrides.originalTargetMi == null ? 0 : meters(targetMi - overrides.originalTargetMi),
    runDays: 6,
    qualityTargetMeters: 0,
    longTargetMeters: 0,
    keySessions: [],
    scheduledSupportMeters: meters(targetMi),
    scheduledSupportDays: 6,
    scheduledTotalMeters: meters(targetMi),
    allocationDeltaMeters: 0,
    qualityCoverageMeters: 0,
    longCoverageMeters: 0,
    qualityOpenMeters: 0,
    longOpenMeters: 0,
  };
}

function makeGoal(
  weekIndex: number,
  targetMi: number,
  actualMi: number,
  qualityTargetMi: number,
  qualityActualMi: number,
  longTargetMi: number,
  longActualMi: number,
  state: PlanBlueprintWeek['state'],
): WeekGoal {
  const meters = (miles: number) => miles * 1609.344;
  const mileage = goalStat(meters(actualMi), meters(targetMi), 1);
  const quality = goalStat(meters(qualityActualMi), meters(qualityTargetMi), 0.6);
  const long = goalStat(meters(longActualMi), meters(longTargetMi), 0.9);
  return {
    weekIndex,
    weekStart: weeks[weekIndex - 1]!.weekStart,
    label: `W${weekIndex}`,
    isCurrent: state === 'current',
    isFuture: state === 'future',
    mileage,
    quality,
    long,
    allMet: mileage.hit && quality.hit && long.hit,
  };
}
