/**
 * WeekGauges — the mileage-led weekly contract. Pins the visual hierarchy,
 * final tween values, Reduce Motion path, and empty-week target-forward copy.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import {
  WeekGauges,
  type GaugeStats,
  type WeekContractStatus,
  type WeekPeriod,
} from '../WeekGauges';
import { ARRIVAL_HOLD_MS, MOUNT_SWEEP_MS } from '../useArrivalMeters';

const METERS_PER_MILE = 1609.344;
const mi = (n: number) => n * METERS_PER_MILE;

const populated: GaugeStats = {
  mileage: { actualMeters: mi(20), targetMeters: mi(40) },
  quality: { actualMeters: mi(5), targetMeters: mi(10) },
  long: { actualMeters: mi(12), targetMeters: mi(18) },
};

const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
  width: 390,
  height: 844,
  scale: 3,
  fontScale: 1,
});
afterAll(() => dimensions.mockRestore());

function renderGauges(
  stats: GaugeStats,
  opts: {
    reduceMotion?: boolean;
    weekKey?: string;
    weekRangeLabel?: string;
    period?: WeekPeriod;
    status?: WeekContractStatus;
    arrivalMeters?: number | null;
    onArrivalSettled?: () => void;
  } = {},
) {
  return render(
    <ThemeProvider preference="dark">
      <WeekGauges
        stats={stats}
        weekKey={opts.weekKey ?? 'week:1'}
        weekRangeLabel={opts.weekRangeLabel}
        reduceMotion={opts.reduceMotion ?? false}
        period={opts.period}
        status={opts.status}
        arrivalMeters={opts.arrivalMeters}
        onArrivalSettled={opts.onArrivalSettled}
      />
    </ThemeProvider>,
  );
}

test('reaches final values immediately on the normal (animated) path', () => {
  renderGauges(populated);
  expect(screen.getByTestId('mileage-primary')).toBeTruthy();
  const contract = within(screen.getByTestId('mileage-primary'));
  expect(contract.getByTestId('supporting-goal-quality')).toBeTruthy();
  expect(contract.getByTestId('supporting-goal-long')).toBeTruthy();
  expect(contract.getByTestId('supporting-goal-quality-progress')).toBeTruthy();
  expect(contract.getByTestId('supporting-goal-long-progress')).toBeTruthy();
  expect(screen.getAllByText('20.0')).toHaveLength(2);
  expect(screen.getByText('5.0')).toBeTruthy();
  expect(screen.getByText('12.0')).toBeTruthy();
  expect(screen.getByText('5.0 mi left')).toBeTruthy();
  expect(screen.getByText('6.0 mi left')).toBeTruthy();
});

test('keeps the selected date explicit to accessibility without repeating it visibly', () => {
  renderGauges(populated, { weekRangeLabel: 'Aug 3–9', period: 'future' });
  expect(screen.queryByText('Aug 3–9')).toBeNull();
  expect(screen.getByText('Weekly contract · 40 mi')).toBeTruthy();
  expect(screen.queryByText('40 mi')).toBeNull();
  expect(screen.getByLabelText(/Aug 3–9.*40 miles planned/)).toBeTruthy();
});

test('reaches final values immediately under Reduce Motion', () => {
  renderGauges(populated, { reduceMotion: true });
  expect(screen.getAllByText('20.0')).toHaveLength(2);
  expect(screen.getByText('5.0')).toBeTruthy();
  expect(screen.getByText('12.0')).toBeTruthy();
});

test('labels full scheduled coverage as allocated, not already-banked work', () => {
  renderGauges(
    {
      ...populated,
      mileage: { ...populated.mileage, projectedMeters: mi(40), paceMeters: mi(15) },
    },
    { period: 'current' },
  );
  expect(screen.getByText('Rest of week allocated')).toBeTruthy();
  expect(screen.queryByText('Target banked')).toBeNull();
});

test('keeps a healthy live week quiet while preserving week adjustment', () => {
  const onAdjust = jest.fn();
  renderGauges(
    {
      ...populated,
      mileage: { ...populated.mileage, projectedMeters: mi(40), paceMeters: mi(15) },
    },
    {
      period: 'current',
      status: { state: 'on-pace', headline: '3 days left', quiet: true, onAdjust },
    },
  );

  expect(screen.queryByText('On mileage pace')).toBeNull();
  expect(screen.getByText('3 days left')).toBeTruthy();
  expect(screen.queryByText('15 mi scheduled')).toBeNull();
  expect(screen.queryByLabelText(/scheduled through yesterday/)).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('mileage-primary').props.style)?.padding).toBe(space.lg);
  expect(StyleSheet.flatten(screen.getByTestId('week-contract-status').props.style)?.minHeight).toBe(56);
  expect(screen.queryByTestId('week-contract-status-mark')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Adjust this week' }));
  expect(onAdjust).toHaveBeenCalledTimes(1);
});

test('a future week leads with its plan and offers the planner action', () => {
  const onEditWeek = jest.fn();
  const empty: GaugeStats = {
    mileage: { actualMeters: 0, targetMeters: mi(91) },
    quality: { actualMeters: 0, targetMeters: mi(10) },
    long: { actualMeters: 0, targetMeters: mi(20) },
  };
  renderGauges(empty, {
    period: 'future',
    status: {
      state: 'planned',
      headline: 'Week planned',
      detail: '91 mi target',
      onAdjust: onEditWeek,
      actionLabel: 'Edit',
      actionAccessibilityLabel: 'Edit week 2',
    },
  });
  expect(screen.getByText('91')).toBeTruthy();
  expect(screen.getByText('mi planned')).toBeTruthy();
  expect(screen.queryByText('Week not started')).toBeNull();
  expect(screen.getByText('10 mi planned')).toBeTruthy();
  expect(screen.getByText('20 mi planned')).toBeTruthy();
  expect(screen.queryByText('Planned')).toBeNull();
  expect(screen.queryByText('0 of')).toBeNull();
  expect(screen.queryByText('0.0')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Edit week 2' }));
  expect(onEditWeek).toHaveBeenCalledTimes(1);
});

test('an empty current week leads with zero banked and the full contract remaining', () => {
  const empty: GaugeStats = {
    mileage: { actualMeters: 0, targetMeters: mi(40) },
    quality: { actualMeters: 0, targetMeters: mi(6), scheduledToday: true },
    long: { actualMeters: 0, targetMeters: mi(18) },
  };
  renderGauges(empty, { period: 'current' });
  expect(screen.getAllByText('0.0')).toHaveLength(3);
  expect(screen.getByText('mi banked')).toBeTruthy();
  expect(screen.getByText('40.0')).toBeTruthy();
  expect(screen.getByText('mi left')).toBeTruthy();
  expect(screen.queryByText('Week in progress')).toBeNull();
  expect(screen.getByText('6.0 mi left')).toBeTruthy();
  expect(screen.getByText('18.0 mi left')).toBeTruthy();
  expect(screen.queryByText('mi this week')).toBeNull();
  expect(screen.queryByText('Today')).toBeNull();
  expect(screen.queryByText('Scheduled')).toBeNull();
});

test('a settled week reads as a recap with independent supporting outcomes', () => {
  const past: GaugeStats = {
    mileage: { actualMeters: mi(20), targetMeters: mi(40) },
    quality: { actualMeters: mi(5), targetMeters: mi(10), hit: false },
    long: { actualMeters: mi(18), targetMeters: mi(18), hit: true },
  };
  renderGauges(past, {
    period: 'past',
    status: { state: 'behind', headline: 'Mileage short', detail: '20.0 mi short' },
  });
  expect(screen.getByText('Weekly contract')).toBeTruthy();
  expect(screen.getByText('40 mi')).toBeTruthy();
  expect(screen.getByText('20.0 mi short')).toBeTruthy();
  expect(screen.getByText('5.0 mi short')).toBeTruthy();
  expect(screen.queryByText('Final mileage')).toBeNull();
  expect(screen.queryByText('Goal met')).toBeNull();
  expect(screen.queryByTestId('supporting-goal-quality-complete')).toBeNull();
  expect(screen.getByTestId('supporting-goal-long-complete')).toBeTruthy();
  expect(screen.getByTestId('supporting-goal-long-complete-fill')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Adjust|Edit week/ })).toBeNull();
  expect(screen.getByTestId('week-contract-status-mark')).toBeTruthy();
  expect(screen.getByTestId('week-contract-status-mark-short')).toBeTruthy();
});

test('supporting goals use remaining mileage instead of internal credit or timing labels', () => {
  renderGauges({
    mileage: { actualMeters: mi(20), targetMeters: mi(40) },
    quality: { actualMeters: mi(7.8), targetMeters: mi(10), hit: true },
    long: { actualMeters: mi(17), targetMeters: mi(20), hit: false },
  });

  expect(screen.getByText('2.2 mi left')).toBeTruthy();
  expect(screen.getByText('3.0 mi left')).toBeTruthy();
  expect(screen.queryByText('Credited')).toBeNull();
  expect(screen.queryByText('Today')).toBeNull();
});

test('a week with SOME progress does not get the empty-week target-forward treatment', () => {
  // Only the long pillar has logged miles — Mileage/Quality/Long stats
  // shouldn't all flip to "lead with target" just because the mileage total
  // stat happens to read 0 in isolation (mirrors the CalendarTabs "sums
  // long-run miles" fixture, which zeroes mileage/quality deliberately).
  const partial: GaugeStats = {
    mileage: { actualMeters: 0, targetMeters: 0 },
    quality: { actualMeters: 0, targetMeters: 0 },
    long: { actualMeters: mi(18), targetMeters: mi(18) },
  };
  renderGauges(partial);
  expect(screen.getByText('18.0')).toBeTruthy();
  expect(screen.queryByText('mi this week')).toBeNull();
});

describe('just-banked arrival', () => {
  const STATS: GaugeStats = {
    mileage: { actualMeters: 90_000, targetMeters: 100_000 },
    quality: { actualMeters: 0, targetMeters: 0 },
    long: { actualMeters: 0, targetMeters: 0 },
  };

  it('holds the pre-run fill before releasing to the true value', () => {
    jest.useFakeTimers();
    const tree = renderGauges(STATS, {
      arrivalMeters: 12_000,
      reduceMotion: false,
    });
    const trackBefore = tree.root.findByProps({ testID: 'week-contract-mileage-track' });
    // 78/100 — the pre-run fraction, not 0.9.
    expect(trackBefore.props.actualFraction).toBeCloseTo(0.78, 2);

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS + 1);
    });
    const trackAfter = tree.root.findByProps({ testID: 'week-contract-mileage-track' });
    expect(trackAfter.props.arrivingFromFraction).toBeCloseTo(0.78, 2);
    jest.useRealTimers();
  });

  it('does not stage anything on an ordinary render', () => {
    const tree = renderGauges(STATS, { reduceMotion: true });
    const track = tree.root.findByProps({ testID: 'week-contract-mileage-track' });
    expect(track.props.actualFraction).toBeCloseTo(0.9, 2);
    expect(track.props.arrivingFromFraction ?? null).toBeNull();
  });

  // FIX 3b — spec: under Reduce Motion "the leading-edge highlight appears
  // and fades without movement." Before the fix, `useArrivalMeters` folded
  // `!reduceMotion` into its `arriving` gate, so `arrivingFromFraction` was
  // ALWAYS null here regardless of a real arrival — the highlight could never
  // render for a Reduce-Motion user.
  it('renders the leading-edge highlight immediately under Reduce Motion when there IS an arrival', () => {
    const tree = renderGauges(STATS, {
      arrivalMeters: 12_000,
      reduceMotion: true,
    });
    const track = tree.root.findByProps({ testID: 'week-contract-mileage-track' });
    // Renders at the TRUE value immediately (no two-stage) ...
    expect(track.props.actualFraction).toBeCloseTo(0.9, 2);
    // ... but the arrival span is still present, not null.
    expect(track.props.arrivingFromFraction).toBeCloseTo(0.78, 2);
  });

  // Important 2 — the above test pins `arrivingFromFraction` from a single,
  // static render; it never exercises the ack loop, so it couldn't have caught
  // the regression where the highlight existed for exactly one commit before
  // being destroyed. This one drives the real loop: `onArrivalSettled` acks
  // upstream (nulling `arrivalMeters`, as the Dash does), and the highlight
  // must still be ON THE SCREEN right up to that ack, not gone before it.
  it('keeps the Reduce Motion highlight on screen for a perceivable beat before settling', () => {
    jest.useFakeTimers();
    let arrivalMeters: number | null = 12_000;
    const handleSettled = jest.fn(() => {
      arrivalMeters = null; // mirrors the Dash nulling `justBanked.banked` on ack
    });
    const { rerender } = renderGauges(STATS, {
      arrivalMeters,
      reduceMotion: true,
      onArrivalSettled: handleSettled,
    });

    // Still lit just before the hold elapses — NOT settled yet.
    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS - 1);
    });
    expect(handleSettled).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('week-contract-mileage-track-arrival').props.style,
    ).toBeTruthy();

    // The hold elapses: NOW it settles.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(handleSettled).toHaveBeenCalledTimes(1);

    // Mirrors the Dash's own re-render once the ack nulls the arrival prop.
    rerender(
      <ThemeProvider preference="dark">
        <WeekGauges
          stats={STATS}
          weekKey="week:1"
          reduceMotion
          arrivalMeters={arrivalMeters}
          onArrivalSettled={handleSettled}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('week-contract-mileage-track-arrival')).toBeNull();
    jest.useRealTimers();
  });
});
