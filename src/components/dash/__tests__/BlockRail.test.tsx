import { fireEvent, render, screen } from '@testing-library/react-native';
import { processColor } from 'react-native';
import type { WeekGoal } from '@/lib';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import { BlockRail } from '../BlockRail';

const MI = 1609.344;

function week(
  weekIndex: number,
  status: 'hit' | 'miss' | 'current' | 'future',
  opts: { targetMi?: number; qualityHit?: boolean; longHit?: boolean } = {},
): WeekGoal {
  const targetMeters = (opts.targetMi ?? 70) * MI;
  const stat = (target: number, hit: boolean) => ({
    actualMeters: hit ? target : target * 0.5,
    targetMeters: target,
    hit,
    fraction: hit ? 1 : 0.5,
  });
  const isFuture = status === 'future';
  const isCurrent = status === 'current';
  const mileageHit = status === 'hit';
  return {
    weekIndex,
    weekStart: `2026-06-${String(weekIndex).padStart(2, '0')}`,
    label: String(weekIndex),
    isCurrent,
    isFuture,
    mileage: stat(targetMeters, mileageHit),
    quality: stat(10 * MI, !!opts.qualityHit),
    long: stat(20 * MI, !!opts.longHit),
    allMet: mileageHit && !!opts.qualityHit && !!opts.longHit,
  };
}

test('renders readable weekly contract stamps with one evidence destination', () => {
  const onOpenPlan = jest.fn();
  const weeks = [
    week(1, 'hit', { targetMi: 55, qualityHit: true, longHit: true }),
    week(2, 'hit', { targetMi: 65, qualityHit: true }),
    week(3, 'miss', { targetMi: 76, longHit: true }),
    week(4, 'current', { targetMi: 68, qualityHit: true }),
    week(5, 'future', { targetMi: 72 }),
  ];

  render(
    <ThemeProvider preference="dark">
      <BlockRail
        weeks={weeks}
        settledWeeks={3}
        hitWeeks={2}
        phaseLabel="Build"
        onOpenPlan={onOpenPlan}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Training block')).toBeTruthy();
  expect(screen.getByText('Build')).toBeTruthy();
  expect(screen.getByText('2/3 contracts met')).toBeTruthy();
  expect(screen.getByText('55', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('76', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByText(/mi banked/i)).toBeNull();
  expect(screen.queryByText(/current streak/i)).toBeNull();

  const currentProgress = screen.getByTestId('block-stamp-progress-4', { includeHiddenElements: true });
  expect(currentProgress.props.stroke).toMatchObject({ payload: processColor(THEMES.dark.yellow) });
  expect(screen.getByTestId('block-stamp-4', { includeHiddenElements: true }).props.accessibilityValue.now).toBe(50);

  const hitProgress = screen.getByTestId('block-stamp-progress-1', { includeHiddenElements: true });
  expect(hitProgress.props.stroke).toMatchObject({ payload: processColor(THEMES.dark.mute) });
  expect(screen.getByTestId('block-stamp-1', { includeHiddenElements: true }).props.accessibilityValue.now).toBe(100);

  const futureTrack = screen.getByTestId('block-stamp-track-5', { includeHiddenElements: true });
  expect(futureTrack.props.stroke).toMatchObject({ payload: processColor(THEMES.dark.line) });
  expect(screen.queryByTestId('block-stamp-progress-5', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('block-stamp-miss-3', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('block-stamp-quality-1', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('block-stamp-long-1', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('block-stamp-long-4', { includeHiddenElements: true })).toBeNull();

  fireEvent.press(screen.getByRole('button', { name: /Open training block in Plan/ }));
  expect(onOpenPlan).toHaveBeenCalledTimes(1);
});

test('lays a long block out in six-stamp rows without hiding future contracts', () => {
  const weeks = Array.from({ length: 23 }, (_, index) =>
    week(index + 1, index < 10 ? 'hit' : index === 10 ? 'current' : 'future', { targetMi: 60 + index }),
  );

  render(
    <ThemeProvider preference="dark">
      <BlockRail
        weeks={weeks}
        settledWeeks={10}
        hitWeeks={10}
        phaseLabel="Build"
        onOpenPlan={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('block-stamp-row-0').children).toHaveLength(6);
  expect(screen.getByTestId('block-stamp-row-1').children).toHaveLength(6);
  expect(screen.getByTestId('block-stamp-row-2').children).toHaveLength(6);
  expect(screen.getByTestId('block-stamp-row-3').children).toHaveLength(6);
  expect(screen.getByTestId('block-stamp-23', { includeHiddenElements: true })).toBeTruthy();
});
