/**
 * CalendarTabs — the composed calendar content for the Dash.
 *
 * Builds one continuous list of days across the whole plan and hands it to
 * `CalendarMonth` in its compact week-pager mode. The selected day drives
 * `DayPanel` below, and follows the pager to the same weekday when the runner
 * browses another week so the contract, strip, and workout never describe
 * different periods. The compact rail expands in place into the full month,
 * keeping the weekly contract anchored above it.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { AccessibilityInfo, LayoutAnimation } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { useAppPreferences } from '@/app-lib/preferences';
import { useSession } from '@/app-lib/auth';
import { DayPanelSkeleton } from '@/components/loading/TabSkeletons';
import { useTheme } from '@/theme/ThemeProvider';
import type { CalendarDay, WeekGoal } from '@/lib';
import { addDays, metersToUnits, weekPaceExpectation } from '@/lib';
import type { GaugeStats, WeekContractStatus, WeekPeriod } from './WeekGauges';

import { CalendarMonth } from './CalendarMonth';
import { stripToneColor } from './DayTab';
import { DayPanel } from './DayPanel';
import { WeekGauges } from './WeekGauges';

// Ease the day panel between heights when you cut between days (a quality day with
// steps is taller than an easy run). easeInEaseOut on the size change; the opacity
// property fades rows that appear/disappear. Reduce-motion snaps instantly.
const PANEL_RESIZE = LayoutAnimation.create(230, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);
const GOAL_EPS_METERS = 400; // ~0.25 mi — below this, a pace gap is not meaningfully actionable.
/** An over-allocated week only earns a row once the plan runs a full mile (or
 *  km) past the contract. Smaller overages are the normal texture of running by
 *  feel, and inviting a plan edit for 0.3 mi would be noise. */
const OVER_ALLOCATION_MIN_UNITS = 1;
const MILEAGE_COMPLETE_EPS_METERS = 1; // Float tolerance only: mileage still requires the full target.

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function weekRangeLabel(start: string, end: string): string {
  const [, startMonth, startDay] = start.split('-').map(Number);
  const [, endMonth, endDay] = end.split('-').map(Number);
  if (!startMonth || !startDay || !endMonth || !endDay) return '';
  const startName = MONTHS_SHORT[startMonth - 1] ?? '';
  const endName = MONTHS_SHORT[endMonth - 1] ?? '';
  return startMonth === endMonth
    ? `${startName} ${startDay}\u2013${endDay}`
    : `${startName} ${startDay}\u2013${endName} ${endDay}`;
}

function monthYearLabel(date: string): string {
  const [year, month] = date.split('-').map(Number);
  if (!year || !month) return '';
  const monthName = MONTHS_LONG[month - 1];
  return monthName ? `${monthName} ${year}` : '';
}

export interface CalendarTabsHandle {
  scrollToToday: () => void;
  /** Toggle the inline month calendar. */
  openCalendar: () => void;
}

export interface CalendarTabsState {
  weekLabel: string;
  monthLabel: string;
  offToday: boolean;
  periodBankedMeters: number;
  periodLabel: string;
  calendarExpanded: boolean;
}

export interface CalendarTabsProps {
  initialWeekDays: CalendarDay[];
  weekDaysFor: (anchor: string) => CalendarDay[];
  currentWeekStart: string;
  currentWeekNumber: number;
  planWeeks: number;
  easyBaseline: number;
  /** Per-plan-week goal attainment (mileage/quality/long actual vs target) —
   *  feeds the fused gauges; Quality here is DETECTED vs PRESCRIBED quality. */
  weekGoals: WeekGoal[];
  /** This-week mileage shortfall (meters, ≥0) from the adaptation engine. Drives
   *  the projected finish and the contract's concise behind detail. */
  weekDeficitMeters?: number;
  /** This-week mileage SURPLUS (meters, >=0): banked + still-planned exceeds the
   *  contract. The mirror of the deficit, and never styled like it. */
  weekSurplusMeters?: number;
  /** Date chosen in the calendar navigator sheet. */
  focusDate?: string;
  /** Clears the transient route parameter after the date has been applied. */
  onFocusDateHandled?: () => void;
  /** Opens the tactical planner for the requested one-based plan week. */
  onEditWeek?: (weekNumber: number) => void;
  /** Reports the browsed week header, banked mileage, and inline-calendar state
   *  to the sticky period control. */
  onStateChange?: (s: CalendarTabsState) => void;
  /** Meters a just-banked run contributed to the LIVE week, else null. */
  arrivalMeters?: number | null;
  /** Fired once when that arrival finishes. */
  onArrivalSettled?: () => void;
  /** True while cached day data is being refreshed in the background. */
  dayPending?: boolean;
}

/**
 * `React.memo`'d: `calState` (lifted into `DashScreen` from `onStateChange`)
 * changes on every browsed-week swipe, forcing `DashScreen` to
 * re-render — without this memo, that re-render always re-ran this whole
 * subtree (WeekGauges / CalendarMonth / DayPanel) even though none of THIS
 * component's actual props changed. `useWeeklyMileage` already keeps
 * `weekDaysFor` / `weekGoals` referentially stable across such renders, so the
 * memo can genuinely bail (audit-code Lane 6 Medium).
 */
export const CalendarTabs = memo(forwardRef<CalendarTabsHandle, CalendarTabsProps>(function CalendarTabs(
  { initialWeekDays, weekDaysFor, currentWeekStart, currentWeekNumber, planWeeks, easyBaseline, weekGoals, weekDeficitMeters = 0, weekSurplusMeters = 0, focusDate, onFocusDateHandled, onEditWeek, onStateChange, arrivalMeters, onArrivalSettled, dayPending = false },
  ref,
) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const router = useRouter();
  const { userId } = useSession();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      // `false` is already the initial state; avoid a redundant async render.
      if (on && v) setReduceMotion(true);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      on = false;
      sub.remove();
    };
  }, []);

  const totalWeeks = Math.max(1, planWeeks);

  // Monday of plan week 1 (so the calendar covers the entire plan).
  const planStartMonday = useMemo(
    () => addDays(currentWeekStart, -(Math.max(1, currentWeekNumber) - 1) * 7),
    [currentWeekStart, currentWeekNumber],
  );

  const days = useMemo(() => {
    const out: CalendarDay[] = [];
    for (let w = 0; w < totalWeeks; w++) {
      const wk = weekDaysFor(addDays(planStartMonday, w * 7));
      for (const d of wk) out.push(d);
    }
    return out;
  }, [weekDaysFor, planStartMonday, totalWeeks]);
  const todayIndex = useMemo(() => {
    const i = days.findIndex((d) => d.isToday);
    return i >= 0 ? i : 0;
  }, [days]);

  const [selectedIndex, setSelectedIndex] = useState<number>(todayIndex);
  const todayWeek = Math.floor(todayIndex / 7);
  const [viewWeek, setViewWeek] = useState<number>(todayWeek);
  const selectedDay = days[selectedIndex] ?? days[todayIndex] ?? days[0];
  const period: WeekPeriod = viewWeek < todayWeek ? 'past' : viewWeek > todayWeek ? 'future' : 'current';

  // A date supplied by the standalone navigator becomes the selected day and
  // browsed week. The inline month remains the primary Week-tab interaction.
  useEffect(() => {
    if (!focusDate) return;
    const nextIndex = days.findIndex((d) => d.localDate === focusDate);
    if (nextIndex < 0) return;
    setSelectedIndex(nextIndex);
    setViewWeek(Math.floor(nextIndex / 7));
    setExpanded(false);
    onFocusDateHandled?.();
  }, [days, focusDate, onFocusDateHandled]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToToday: () => {
        setSelectedIndex(todayIndex);
        setViewWeek(todayWeek);
        setExpanded(false);
      },
      openCalendar: () => {
        setExpanded((value) => !value);
        if (!reduceMotion) void Haptics.selectionAsync().catch(() => undefined);
      },
    }),
    [reduceMotion, todayIndex, todayWeek],
  );

  // Header identity follows the browsed week and includes its civil date range,
  // so "Week 10" never asks the runner to remember where that lands.
  const viewStart = days[viewWeek * 7]?.localDate ?? '';
  const viewEnd = days[viewWeek * 7 + 6]?.localDate ?? '';
  // The expanded month pager assigns a boundary week to its Thursday's month;
  // report that same identity so the sticky title and visible page never differ.
  const viewMonthDate = days[viewWeek * 7 + 3]?.localDate ?? viewStart;
  const rangeLabel = weekRangeLabel(viewStart, viewEnd);
  const weekLabel = `Week ${viewWeek + 1}/${totalWeeks}${rangeLabel ? ` \u00b7 ${rangeLabel}` : ''}`;
  const monthLabel = monthYearLabel(viewMonthDate);
  const offToday = viewWeek !== todayWeek;

  // Gauge stats always follow the browsed WEEK. Expanding the calendar never
  // changes the contract's measurement period.
  const goalByStart = useMemo(() => {
    const m = new Map<string, WeekGoal>();
    for (const g of weekGoals) m.set(g.weekStart, g);
    return m;
  }, [weekGoals]);

  const gaugeStats = useMemo<GaugeStats>(() => {
    const acc = { mA: 0, mT: 0, qA: 0, qT: 0, lA: 0, lT: 0 };
    const g = goalByStart.get(days[viewWeek * 7]?.localDate ?? '');
    if (g) {
      acc.mA += g.mileage.actualMeters;
      acc.mT += g.mileage.targetMeters;
      acc.qA += g.quality.actualMeters;
      acc.qT += g.quality.targetMeters;
      acc.lA += g.long.actualMeters;
      acc.lT += g.long.targetMeters;
    }
    // Schedule ticks apply only to the in-progress week (a past/future week has
    // no "through yesterday"). MILEAGE is the plan on elapsed days; QUALITY and
    // LONG use the same elapsed-day boundary on their own measurement scales.
    // The end-of-week mileage gap is separate: the adaptation engine compares
    // banked + still-scheduled mileage with the weekly contract.
    const current = viewWeek === todayWeek;
    const paceExp = current ? weekPaceExpectation(initialWeekDays) : null;
    const qPace = paceExp?.qualityMeters;
    const lPace = paceExp?.longMeters;
    const mPace = paceExp?.mileageMeters;
    const today = current ? initialWeekDays.find((d) => d.isToday) : undefined;
    const qualityToday = today?.workouts.some(
      (w) => w.isQuality || w.tone === 'quality' || w.tone === 'speed',
    ) ?? false;
    const longToday = today?.workouts.some((w) => w.tone === 'long') ?? false;
    // Projection is current-week only and clamped between banked and target.
    // For mileage, `actual + weekDeficitMeters` makes this resolve to
    // target − the uncovered contract gap. Supporting goals use elapsed-plan
    // shortfall because their scheduled sessions are already represented here.
    const proj = (target: number, actual: number, paceDue: number | undefined) =>
      !current ? undefined : Math.max(actual, Math.min(target, target - Math.max(0, (paceDue ?? actual) - actual)));
    return {
      mileage: { actualMeters: acc.mA, targetMeters: acc.mT, paceMeters: mPace, projectedMeters: proj(acc.mT, acc.mA, acc.mA + weekDeficitMeters) },
      quality: {
        actualMeters: acc.qA,
        targetMeters: acc.qT,
        hit: g?.quality.hit,
        paceMeters: qPace,
        projectedMeters: proj(acc.qT, acc.qA, qPace),
        scheduledToday: qualityToday,
      },
      long: {
        actualMeters: acc.lA,
        targetMeters: acc.lT,
        hit: g?.long.hit,
        paceMeters: lPace,
        projectedMeters: proj(acc.lT, acc.lA, lPace),
        scheduledToday: longToday,
      },
    };
  }, [goalByStart, days, initialWeekDays, viewWeek, todayWeek, weekDeficitMeters]);

  const handleEditViewedWeek = useCallback(() => {
    onEditWeek?.(viewWeek + 1);
  }, [onEditWeek, viewWeek]);

  // Projection belongs to the mileage rail. This row only adds information the
  // rail cannot: a settled result, an actionable gap, or quiet time remaining.
  const contractStatus = useMemo<WeekContractStatus | undefined>(() => {
    if (gaugeStats.mileage.targetMeters <= 0) return undefined;

    const target = gaugeStats.mileage.targetMeters;
    const actual = gaugeStats.mileage.actualMeters;
    if (period === 'future') {
      // One-number-one-screen: 'Week planned' restated the header's PLANNED
      // and 'Unbanked work can move' was a narrated sentence. The row survives
      // only to host the Edit action.
      return {
        state: 'planned',
        headline: '',
        quiet: true,
        onAdjust: onEditWeek ? handleEditViewedWeek : undefined,
        actionLabel: 'Edit',
        actionAccessibilityLabel: `Edit week ${viewWeek + 1}`,
      };
    }

    if (period === 'past') {
      const complete = actual >= target - MILEAGE_COMPLETE_EPS_METERS;
      // A met week gets NO status row: the header already reads
      // '100.3 MI BANKED / +0.3 MI OVER' over a full yellow bar, and
      // 'Mileage met · 0.3 mi over target' repeated both — the critique's
      // canonical restatement. A short week keeps its single week-level
      // verdict mark (judgment lives at week altitude), but not the delta,
      // which the header states.
      if (complete) return undefined;
      return {
        state: 'behind',
        headline: 'Mileage short',
      };
    }

    const today = initialWeekDays.find((d) => d.isToday);
    const daysLeft = today ? 7 - today.dayIndex : 7;
    const daysCopy = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
    const complete =
      gaugeStats.mileage.actualMeters >=
      gaugeStats.mileage.targetMeters - MILEAGE_COMPLETE_EPS_METERS;
    if (complete) return undefined;

    const hasUnallocatedDistance = !complete && weekDeficitMeters > GOAL_EPS_METERS;
    const unallocatedDistance = Math.max(1, Math.round(metersToUnits(weekDeficitMeters, units)));
    if (!hasUnallocatedDistance) {
      // OVER-ALLOCATED: the rest of the week is planned for more than the
      // contract still needs, because earlier days ran long. This is the exact
      // mirror of "unallocated", but it is NOT a problem and never wears the
      // deficit's orange — the runner is ahead. It only earns a row once the
      // overage clears a full unit; below that, trimming the plan would be
      // fussier than just running it.
      const surplusDistance = metersToUnits(weekSurplusMeters, units);
      if (surplusDistance >= OVER_ALLOCATION_MIN_UNITS) {
        return {
          state: 'over-allocated',
          headline: `${surplusDistance.toFixed(1)} ${units} over contract`,
          detail: daysCopy,
          onAdjust: onEditWeek ? handleEditViewedWeek : undefined,
          actionLabel: 'Reduce',
          actionAccessibilityLabel: 'Reduce this week\u2019s planned mileage',
        };
      }
      return {
        state: 'on-pace',
        headline: daysCopy,
        quiet: true,
        onAdjust: onEditWeek ? handleEditViewedWeek : undefined,
        actionLabel: 'Adjust',
        actionAccessibilityLabel: 'Adjust this week',
      };
    }

    return {
      state: 'behind',
      headline: `${unallocatedDistance} ${units} unallocated`,
      detail: daysCopy,
      onAdjust: onEditWeek ? handleEditViewedWeek : undefined,
      actionLabel: 'Adjust',
      actionAccessibilityLabel: 'Adjust this week',
    };
  }, [gaugeStats.mileage, period, initialWeekDays, weekDeficitMeters, weekSurplusMeters, onEditWeek, handleEditViewedWeek, units, viewWeek]);

  // Report the state up to the Dash section header. The browsed period's banked
  // mileage (the gauge's authoritative actual) drives the plan-progress slice.
  const periodBankedMeters = gaugeStats.mileage.actualMeters;
  const periodLabel = offToday ? `Week ${viewWeek + 1}` : 'This week';
  useEffect(() => {
    onStateChange?.({ weekLabel, monthLabel, offToday, periodBankedMeters, periodLabel, calendarExpanded: expanded });
  }, [weekLabel, monthLabel, offToday, periodBankedMeters, periodLabel, expanded, onStateChange]);

  // The selected day's TYPE colour (stripToneColor: long → cyan, quality → pink,
  // easy → green), neutral when there's no workout — drives the today ring.
  const acc = useMemo(() => {
    const day = days[selectedIndex];
    const tone = day?.primary?.tone;
    return (tone ? stripToneColor(C, tone) : null) ?? C.mute;
  }, [days, selectedIndex, C]);

  // Tapping a day selects it and keeps the visible week aligned.
  const handleSelectDay = useCallback(
    (i: number) => {
      void Haptics.selectionAsync(); // a light tick on picking a day
      if (!reduceMotion) LayoutAnimation.configureNext(PANEL_RESIZE);
      setSelectedIndex(i);
      setViewWeek(Math.floor(i / 7));
      setExpanded(false);
    },
    [reduceMotion],
  );

  // Swiping preserves the selected weekday (Friday -> Friday), so the strip,
  // selected tab, and day panel always describe the browsed week together.
  const handleViewWeek = useCallback((w: number) => {
    const nextWeek = Math.max(0, Math.min(totalWeeks - 1, w));
    const weekday = selectedIndex % 7;
    const nextIndex = Math.min(days.length - 1, nextWeek * 7 + weekday);
    if (!reduceMotion) LayoutAnimation.configureNext(PANEL_RESIZE);
    setViewWeek(nextWeek);
    if (nextIndex >= 0) setSelectedIndex(nextIndex);
  }, [days.length, reduceMotion, selectedIndex, totalWeeks]);

  const handleOpenWorkout = useCallback(
    (id: string) => {
      router.push({ pathname: '/workout/[id]', params: { id } });
    },
    [router],
  );

  // Open a specific LOGGED activity's run detail (completed-day picker rows).
  const handleOpenActivity = useCallback(
    (activityId: string) => {
      router.push({ pathname: '/run/[id]', params: { id: activityId } });
    },
    [router],
  );

  // Identity of the browsed week — a change replays the gauge sweep (UX#3).
  const weekKey = `week:${viewWeek}`;

  return (
    <>
      <WeekGauges
        stats={gaugeStats}
        weekKey={weekKey}
        weekRangeLabel={rangeLabel}
        reduceMotion={reduceMotion}
        period={period}
        status={contractStatus}
        arrivalMeters={period === 'current' ? arrivalMeters ?? null : null}
        onArrivalSettled={onArrivalSettled}
      />
      <CalendarMonth
        days={days}
        totalWeeks={totalWeeks}
        selectedIndex={selectedIndex}
        viewWeek={viewWeek}
        expanded={expanded}
        weekGoals={weekGoals}
        onExpandedChange={setExpanded}
        reduceMotion={reduceMotion}
        onSelectDay={handleSelectDay}
        onViewWeek={handleViewWeek}
      />
      {selectedDay?.isToday && dayPending ? (
        <DayPanelSkeleton />
      ) : selectedDay != null ? (
        <DayPanel
          day={selectedDay}
          accent={acc}
          easyBaseline={easyBaseline}
          historical={period === 'past'}
          onOpenWorkout={handleOpenWorkout}
          onOpenActivity={handleOpenActivity}
          onAdjustWeek={period !== 'past' && onEditWeek ? handleEditViewedWeek : undefined}
        />
      ) : null}
    </>
  );
}));
