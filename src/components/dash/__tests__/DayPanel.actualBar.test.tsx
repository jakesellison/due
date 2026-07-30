/**
 * DayPanel — compact outcomes on completed days, prescription detail on open days.
 *
 * Completed analysis is deliberately one tap deeper; the Week surface reports
 * banked mileage and the plan delta without reproducing the full ledger.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { space, THEMES } from '@/theme/tokens';
import type { CalendarDay, DayActivity, DayWorkout, BarSeg } from '@/lib';
import { DayPanel } from '../DayPanel';

const D = THEMES.dark;

const rtl = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

function easyPrimary(overrides: Partial<DayWorkout> = {}): DayWorkout {
  return {
    id: 'wo-easy',
    type: 'easy',
    title: 'Easy Run',
    isQuality: false,
    structure: [{ kind: 'steady', target: { by: 'distance', distance_m: 9656 } }],
    plannedMeters: 9656,
    completed: true,
    outcome: 'met',
    actualMeters: 9800,
    sealed: true,
    tone: 'easy',
    ...overrides,
  };
}

function act(id: string, actualBar: BarSeg[] | null, distanceMeters = 9800): DayActivity {
  return { id, distanceMeters, movingTimeS: 2940, startDate: '2026-07-07T12:00:00Z', qualityDetected: null, actualBar };
}

function completedDay(primary: DayWorkout, activities: DayActivity[]): CalendarDay {
  return {
    localDate: '2026-07-07', dayIndex: 1, initial: 'T', state: 'done',
    plannedMeters: primary.plannedMeters ?? 0, actualMeters: primary.actualMeters,
    isQuality: primary.isQuality, isRace: false, isDouble: false, isToday: true,
    target: { kind: 'none' }, workouts: [primary], primary, activities,
  };
}

const noop = () => {};
const panel = (day: CalendarDay) =>
  rtl(<DayPanel day={day} accent={D.z2} easyBaseline={480} onOpenWorkout={noop} onOpenActivity={noop} />);

describe('DayPanel outcome hierarchy', () => {
  test('completed easy run → compact banked result with its parsed actual shape', () => {
    const day = completedDay(easyPrimary(), [act('a1', [{ kind: 'steady', meters: 9800 }])]);
    const r = panel(day);
    expect(r.getByText('Banked')).toBeTruthy();
    expect(r.getByText('Easy')).toBeTruthy();
    expect(r.getByTestId('day-outcome-plan-value')).toHaveTextContent('6.0 mi planned');
    expect(r.getByTestId('day-outcome-type-token')).toBeTruthy();
    expect(r.getByTestId('day-workout-gradient-easy').props.colors).toHaveLength(3);
    expect(StyleSheet.flatten(r.getByTestId('day-outcome-actual-value').props.style)?.fontSize).toBe(22);
    expect(r.getByTestId('day-actual-rail-a1', { includeHiddenElements: true })).toBeTruthy();
    expect(r.queryByTestId('day-prescription-rail', { includeHiddenElements: true })).toBeNull();
    expect(r.getByTestId('day-outcome-variance')).toHaveTextContent('On allocation');
  });

  test('completed quality run keeps a matching classification quiet and renders actual intervals', () => {
    const bars: BarSeg[] = [
      { kind: 'wu', meters: 2000 },
      { kind: 'work', meters: 3218 },
      { kind: 'rest', meters: 800 },
      { kind: 'work', meters: 3218 },
      { kind: 'cd', meters: 1600 },
    ];
    const day = completedDay(
      easyPrimary({ id: 'wo-q', isQuality: true, tone: 'quality', title: 'Threshold' }),
      [{ ...act('a1', bars), qualityDetected: true }],
    );
    const r = panel(day);
    expect(r.getByTestId('day-activity-hint-a1')).toHaveTextContent('Quality');
    expect(r.queryByText('Quality detected')).toBeNull();
    expect(r.getByTestId('day-actual-rail-a1', { includeHiddenElements: true })).toBeTruthy();
  });

  test('quality detected on a planned Easy day is surfaced as useful mismatch information', () => {
    const day = completedDay(
      easyPrimary(),
      [{ ...act('a1', [{ kind: 'work', meters: 9800 }]), qualityDetected: true }],
    );
    const r = panel(day);
    expect(r.getByTestId('day-activity-hint-a1')).toHaveTextContent('Quality detected');
  });

  test('completed day remains compact when stored shape data is unavailable', () => {
    const day = completedDay(easyPrimary(), [act('a1', null)]);
    const r = panel(day);
    expect(r.getByText('Banked')).toBeTruthy();
    expect(r.queryByTestId('day-actual-rail-a1', { includeHiddenElements: true })).toBeNull();
  });

  test('a double preserves one actual rail per recording', () => {
    const day = completedDay(
      easyPrimary({ actualMeters: 19600 }),
      [
        act('a1', [{ kind: 'steady', meters: 9800 }]),
        act('a2', [{ kind: 'steady', meters: 9800 }]),
      ],
    );
    const r = panel(day);
    expect(r.getByTestId('day-actual-rail-a1', { includeHiddenElements: true })).toBeTruthy();
    expect(r.getByTestId('day-actual-rail-a2', { includeHiddenElements: true })).toBeTruthy();
  });

  test('a partial double keeps the unmatched leg open after the chronological actual ledger', () => {
    const long = easyPrimary({
      id: 'wo-long',
      plannedMeters: 12 * 1609.344,
      completed: false,
      outcome: 'planned',
      actualMeters: 0,
      sealed: false,
      matchedActivityIds: [],
    });
    const short = easyPrimary({
      id: 'wo-short',
      plannedMeters: 4 * 1609.344,
      completed: true,
      outcome: 'met',
      actualMeters: 4 * 1609.344,
      matchedActivityIds: ['a-am'],
    });
    const day: CalendarDay = {
      ...completedDay(long, [act('a-am', [{ kind: 'steady', meters: 4 * 1609.344 }], 4 * 1609.344)]),
      plannedMeters: 16 * 1609.344,
      actualMeters: 4 * 1609.344,
      isDouble: true,
      workouts: [long, short],
      primary: long,
    };
    const r = panel(day);

    expect(r.getByTestId('day-workout-card')).toBeTruthy();
    expect(r.queryByText('On allocation')).toBeNull();
    expect(r.getByTestId('day-double-rail')).toBeTruthy();
    expect(StyleSheet.flatten(r.getByTestId('day-double-fill-wo-long').props.style)?.width).toBe('0%');
    expect(StyleSheet.flatten(r.getByTestId('day-double-fill-wo-short').props.style)?.width).toBe('100%');
    expect(r.getByTestId('day-remaining-workout-wo-long')).toBeTruthy();

    const renderedText = r.UNSAFE_getAllByType(Text)
      .map((node) => String(node.props.children ?? ''));
    expect(renderedText.indexOf('Morning')).toBeLessThan(renderedText.indexOf('Still planned'));
  });

  test('one full-distance easy run satisfies the aggregate allocation of an easy double', () => {
    const first = easyPrimary({
      id: 'wo-first',
      plannedMeters: 11 * 1609.344,
      completed: true,
      outcome: 'met',
      actualMeters: 15 * 1609.344,
      matchedActivityIds: ['a-single'],
    });
    const second = easyPrimary({
      id: 'wo-second',
      title: 'Easy Run (2nd)',
      plannedMeters: 4 * 1609.344,
      completed: false,
      outcome: 'planned',
      actualMeters: 0,
      sealed: false,
      matchedActivityIds: [],
    });
    const day: CalendarDay = {
      ...completedDay(first, [
        { ...act('a-single', [{ kind: 'steady', meters: 15 * 1609.344 }], 15 * 1609.344), qualityDetected: false },
      ]),
      plannedMeters: 15 * 1609.344,
      actualMeters: 15 * 1609.344,
      isDouble: true,
      workouts: [first, second],
      primary: first,
    };
    const r = panel(day);

    expect(r.getByTestId('day-outcome-card')).toBeTruthy();
    expect(r.getByText('Easy double')).toBeTruthy();
    expect(r.getByTestId('day-outcome-plan-value')).toHaveTextContent('11.0 + 4.0 mi planned');
    expect(r.getByTestId('day-outcome-actual-value')).toHaveTextContent('15.0 mi');
    expect(r.getByTestId('day-outcome-variance')).toHaveTextContent('On allocation');
    expect(r.getByTestId('day-activity-row-a-single')).toBeTruthy();
    expect(r.queryByTestId('day-remaining-plan')).toBeNull();
  });

  test('aggregate mileage cannot substitute for a mixed easy and quality prescription', () => {
    const easy = easyPrimary({
      id: 'wo-easy',
      plannedMeters: 11 * 1609.344,
      completed: true,
      outcome: 'met',
      actualMeters: 15 * 1609.344,
      matchedActivityIds: ['a-single'],
    });
    const quality = easyPrimary({
      id: 'wo-quality',
      title: 'Threshold',
      tone: 'quality',
      isQuality: true,
      plannedMeters: 4 * 1609.344,
      completed: false,
      outcome: 'planned',
      actualMeters: 0,
      sealed: false,
      matchedActivityIds: [],
    });
    const day: CalendarDay = {
      ...completedDay(easy, [
        { ...act('a-single', [{ kind: 'steady', meters: 15 * 1609.344 }], 15 * 1609.344), qualityDetected: false },
      ]),
      plannedMeters: 15 * 1609.344,
      actualMeters: 15 * 1609.344,
      isDouble: true,
      workouts: [easy, quality],
      primary: quality,
    };
    const r = panel(day);

    expect(r.getByTestId('day-workout-card')).toBeTruthy();
    expect(r.getByTestId('day-remaining-workout-wo-quality')).toBeTruthy();
    expect(r.queryByText('On allocation')).toBeNull();
  });

  test('an elapsed partial double distinguishes the short run from the missed leg', () => {
    const ranShort = easyPrimary({
      id: 'wo-first',
      title: 'Easy Run',
      plannedMeters: 16 * 1609.344,
      completed: true,
      outcome: 'short',
      actualMeters: 12 * 1609.344,
      sealed: false,
      matchedActivityIds: ['a-pm'],
    });
    const missed = easyPrimary({
      id: 'wo-second',
      title: 'Easy Run (2nd)',
      plannedMeters: 7 * 1609.344,
      completed: false,
      outcome: 'missed',
      actualMeters: 0,
      sealed: false,
      matchedActivityIds: [],
    });
    const day: CalendarDay = {
      ...completedDay(ranShort, [
        { ...act('a-pm', [{ kind: 'steady', meters: 12 * 1609.344 }], 12 * 1609.344), startDate: '2026-07-07T20:00:00Z' },
      ]),
      isToday: false,
      plannedMeters: 23 * 1609.344,
      actualMeters: 12 * 1609.344,
      isDouble: true,
      workouts: [ranShort, missed],
      primary: ranShort,
    };
    const r = panel(day);

    expect(r.queryByTestId('day-workout-card')).toBeTruthy();
    expect(r.queryByText('Still planned')).toBeNull();
    expect(r.getByText('4.0 mi short')).toBeTruthy();
    expect(r.getByTestId('day-remaining-state-wo-second')).toHaveTextContent('Missed');
    expect(r.queryByTestId('day-outcome-type-token')).toBeNull();
  });

  test('a rest-day double renders the backend actuals instead of hiding them behind Rest day', () => {
    const primary = easyPrimary();
    const day: CalendarDay = {
      ...completedDay(primary, [
        act('a-am', null, 7 * 1609.344),
        { ...act('a-pm', null, 7.5 * 1609.344), startDate: '2026-07-07T22:00:00Z' },
      ]),
      primary: null,
      workouts: [],
      plannedMeters: 0,
      actualMeters: 14.5 * 1609.344,
      state: 'done',
    };
    const r = panel(day);

    expect(r.getByTestId('day-unplanned-card')).toBeTruthy();
    expect(r.getByText('2 runs')).toBeTruthy();
    expect(r.getByText('Rest day plan')).toBeTruthy();
    expect(r.getByTestId('day-activity-row-a-am')).toBeTruthy();
    expect(r.getByTestId('day-activity-row-a-pm')).toBeTruthy();
    expect(r.queryByTestId('day-rest-card')).toBeNull();
  });

  test('a meaningful overage is neutral information, not a success verdict', () => {
    const day = completedDay(
      easyPrimary({ actualMeters: 20000 }),
      [act('a1', [{ kind: 'steady', meters: 20000 }], 20000)],
    );
    const r = panel(day);
    expect(r.getByTestId('day-outcome-variance')).toHaveTextContent('6.4 mi over allocation');
    expect(StyleSheet.flatten(r.getByTestId('day-outcome-variance').props.style)?.color).toBe(D.mute);
    expect(StyleSheet.flatten(r.getByTestId('day-outcome-variance-mark').props.style)?.backgroundColor).toBe(D.faint);
  });

  test('a simple upcoming run renders its single-segment prescription shape', () => {
    const day: CalendarDay = {
      ...completedDay(easyPrimary({ completed: false, actualMeters: 0, sealed: false }), []),
      state: 'upcoming',
    };
    const r = panel(day);
    expect(r.getByTestId('day-prescription-rail', { includeHiddenElements: true })).toBeTruthy();
    expect(r.queryByText('View workout')).toBeNull();
    expect(r.getByRole('link', { name: /Open Easy Run details/i })).toBeTruthy();
  });

  test('a multi-phase upcoming workout keeps its prescription diagram', () => {
    const day: CalendarDay = {
      ...completedDay(easyPrimary({
        completed: false,
        actualMeters: 0,
        sealed: false,
        isQuality: true,
        tone: 'quality',
        structure: [
          { kind: 'warmup', target: { by: 'distance', distance_m: 1609 } },
          { kind: 'work', target: { by: 'distance', distance_m: 3218 } },
          { kind: 'cooldown', target: { by: 'distance', distance_m: 1609 } },
        ],
      }), []),
      state: 'upcoming',
    };
    const r = panel(day);
    expect(r.getByTestId('day-prescription-rail', { includeHiddenElements: true })).toBeTruthy();
  });

  test('a missed workout in a settled week is archival, not re-allocatable', () => {
    const onAdjustWeek = jest.fn();
    const day: CalendarDay = {
      ...completedDay(easyPrimary({ completed: false, actualMeters: 0, sealed: false }), []),
      state: 'missed',
      isToday: false,
    };
    const r = rtl(
      <DayPanel
        day={day}
        accent={D.z2}
        easyBaseline={480}
        historical
        onOpenWorkout={noop}
        onOpenActivity={noop}
        onAdjustWeek={onAdjustWeek}
      />,
    );

    expect(r.getByText('6.0 mi not banked')).toBeTruthy();
    expect(r.queryByText('Adjust week')).toBeNull();
    expect(r.queryByText(/remains in the week contract/i)).toBeNull();
  });

  test('a missed workout in the live week retains its reallocation action', () => {
    const onAdjustWeek = jest.fn();
    const day: CalendarDay = {
      ...completedDay(easyPrimary({ completed: false, actualMeters: 0, sealed: false }), []),
      state: 'missed',
    };
    const r = rtl(
      <DayPanel
        day={day}
        accent={D.z2}
        easyBaseline={480}
        onOpenWorkout={noop}
        onOpenActivity={noop}
        onAdjustWeek={onAdjustWeek}
      />,
    );

    expect(r.queryByText(/remains in the week contract/i)).toBeNull();
    expect(r.queryByTestId('day-outcome-variance')).toBeNull();
    expect(r.getByTestId('day-outcome-plan-value')).toHaveTextContent('6.0 mi planned');
    expect(r.getByText('Adjust week')).toBeTruthy();
  });

  test('a missed mixed long run keeps its full identity above the prescription', () => {
    const onAdjustWeek = jest.fn();
    const day: CalendarDay = {
      ...completedDay(
        easyPrimary({
          type: 'long',
          title: 'Long Run',
          tone: 'long',
          completed: false,
          outcome: 'missed',
          actualMeters: 0,
          sealed: false,
          structure: [
            { kind: 'steady', target: { by: 'distance', distance_m: 16093 } },
            { kind: 'work', target: { by: 'distance', distance_m: 3219 } },
          ],
          plannedMeters: 19312,
        }),
        [],
      ),
      state: 'missed',
    };
    const r = rtl(
      <DayPanel
        day={day}
        accent={D.cyanText}
        easyBaseline={480}
        onOpenWorkout={noop}
        onOpenActivity={noop}
        onAdjustWeek={onAdjustWeek}
      />,
    );

    expect(r.getByText('Long')).toBeTruthy();
    expect(r.getByText('Quality')).toBeTruthy();
    expect(r.getByTestId('day-outcome-plan-value')).toHaveTextContent('12.0 mi planned');
    expect(r.queryByText(/remains in the week contract/i)).toBeNull();
  });

  test('a rest day in a settled week has no allocation action', () => {
    const onAdjustWeek = jest.fn();
    const day: CalendarDay = {
      ...completedDay(easyPrimary(), []),
      state: 'rest',
      primary: null,
      workouts: [],
      plannedMeters: 0,
    };
    const r = rtl(
      <DayPanel
        day={day}
        accent={D.mute}
        easyBaseline={480}
        historical
        onOpenWorkout={noop}
        onOpenActivity={noop}
        onAdjustWeek={onAdjustWeek}
      />,
    );

    expect(r.getByText('Rest day')).toBeTruthy();
    expect(r.queryByText('Adjust week')).toBeNull();
    const cardStyle = StyleSheet.flatten(r.getByTestId('day-rest-card').props.style);
    expect(cardStyle.paddingTop).toBe(space.lg);
    expect(cardStyle.paddingTop).toBe(cardStyle.paddingBottom);
    expect(StyleSheet.flatten(r.getByTestId('day-rest-hero').props.style).paddingTop ?? 0).toBe(0);
  });

  test('a live rest day stays compact and leaves adjustment to the weekly contract', () => {
    const day: CalendarDay = {
      ...completedDay(easyPrimary(), []),
      state: 'rest',
      primary: null,
      workouts: [],
      plannedMeters: 0,
    };
    const r = rtl(
      <DayPanel
        day={day}
        accent={D.mute}
        easyBaseline={480}
        onOpenWorkout={noop}
        onOpenActivity={noop}
        onAdjustWeek={noop}
      />,
    );

    expect(r.queryByText('Adjust week')).toBeNull();
    expect(StyleSheet.flatten(r.getByTestId('day-rest-card').props.style).paddingTop).toBe(space.lg);
    expect(StyleSheet.flatten(r.getByTestId('day-rest-hero').props.style).paddingTop ?? 0).toBe(0);
  });
});
