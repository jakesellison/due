/**
 * CalendarMonth — the unified Dash calendar.
 *
 * COLLAPSED: a horizontal week pager — each page is one Mon→Sun row. Swiping
 * browses weeks while preserving the selected weekday, so the selected cell and
 * DayPanel always follow the week contract. EXPANDED:
 * the same rows become a vertical month grid. One driver makes expanding
 * continuous — a clip window grows from the viewed row to the month while it
 * slides into place; the pager cross-fades out. Same cells throughout.
 *
 * Mon→Sun columns; each cell shows banked mileage for closed days and planned
 * mileage ahead. Banked days carry a quiet completion check; the road ahead
 * carries one subdued plan-type cue.
 * Adjacent-month days dim.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppPreferences } from '@/app-lib/preferences';
import { metersToUnits, type CalendarDay, type DayWorkout, type WeekGoal, type WorkoutTone } from '@/lib';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

import { CalendarCell, type CellMark } from './CalendarCell';
import { stripToneColor } from './DayTab';
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const GAP = 5;
const COLS = 7;
const CONTRACT_SEAM_H = 14;
// The grid keeps the page gutter, but selection is now contained by its own day
// cell rather than a full-width Chrome-tab outline.
const EDGE = space.md;

function ContractSeam({ goal }: { goal: WeekGoal | undefined }) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  if (!goal || goal.isFuture || goal.mileage.targetMeters <= 0) {
    return <View style={styles.contractSeamSpace} />;
  }

  const { actualMeters, targetMeters, fraction, hit } = goal.mileage;
  const current = goal.isCurrent;
  const settledMiss = !current && !hit;
  const shortMeters = Math.max(0, targetMeters - actualMeters);
  const shortDistance = metersToUnits(shortMeters, units);
  const shortLabel = shortDistance < 10
    ? shortDistance.toFixed(1).replace(/\.0$/, '')
    : String(Math.round(shortDistance));
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%` as `${number}%`;
  const a11y = current
    ? `Week ${goal.label}, mileage contract in progress, ${Math.round(fraction * 100)} percent banked`
    : hit
      ? `Week ${goal.label}, mileage contract met`
      : `Week ${goal.label}, mileage contract short by ${shortLabel} ${unitWord}`;

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={styles.contractSeam}
      testID={`contract-seam-${goal.weekStart}`}
    >
      <View style={styles.contractTrackFrame}>
        <View style={styles.contractTrack}>
          <View
            style={[
              styles.contractFill,
              current && styles.contractFillCurrent,
              { width },
            ]}
          />
        </View>
        {!current && hit ? (
          <View
            style={[styles.contractVerdictHead, { left: width }]}
            testID={`contract-verdict-anchor-${goal.weekStart}`}
          >
            <View
              style={styles.contractVerdictDot}
              testID={`contract-verdict-met-${goal.weekStart}`}
            />
          </View>
        ) : settledMiss ? (
          <View
            style={[styles.contractVerdictHead, { left: width }]}
            testID={`contract-verdict-anchor-${goal.weekStart}`}
          >
            <SymbolView
              name="xmark"
              size={10}
              tintColor={C.mute}
              weight="black"
              resizeMode="scaleAspectFit"
              testID={`contract-verdict-short-${goal.weekStart}`}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The day's type marks for the strip lane: ONE bar per distinct run type
 * (`{color}`), a split bar (`{color, split}`) for a dual (a long/easy run that
 * banks quality). Deduping by (type, dual) means run COUNT never matters — 8 easy
 * runs collapse to one easy bar — so the lane is bounded (capped at 3). Separate
 * bars = separate runs (a double); one split bar = a single run that's both.
 */
export function dayMarks(
  C: Tokens,
  workouts: DayWorkout[],
  opts: { closed: boolean; ranSomething: boolean; ranQuality: boolean },
): CellMark[] {
  const { closed, ranSomething, ranQuality } = opts;
  const out: CellMark[] = [];
  const seen = new Set<string>();
  const push = (tone: WorkoutTone, dual: boolean) => {
    const color = tone === 'easy' ? C.faint : stripToneColor(C, tone);
    if (color == null) return;
    const key = `${tone}:${dual ? 'd' : 's'}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(dual ? { color, split: C.qualText } : { color });
  };
  if (workouts.length > 0) {
    for (const w of workouts) {
      if (closed && ranSomething) {
        // CLOSED day → the pip reads what was RUN, not the plan. The quality axis
        // flips on DETECTION: a detected session reads quality (a long that banks
        // quality reads a long+quality split); an undetected quality day (ran
        // easy) reads easy; a long/easy day keeps its own tone.
        const isQualityTone = w.tone === 'quality' || w.tone === 'speed';
        if (ranQuality) {
          if (w.tone === 'long') push('long', true);
          else push('quality', false);
        } else {
          push(isQualityTone ? 'easy' : w.tone, false);
        }
      } else {
        // PLANNED (upcoming/today, or a missed day with nothing run): the plan's tone.
        const dual = w.hasEmbeddedQuality === true && w.tone !== 'quality' && w.tone !== 'speed';
        push(w.tone, dual);
      }
    }
  } else if (ranSomething) {
    // Ran with nothing planned that day — a single mark from what ran.
    push(ranQuality ? 'quality' : 'easy', false);
  }
  return out.slice(0, 3);
}

export interface CalendarMonthProps {
  days: CalendarDay[];
  totalWeeks: number;
  /** The SELECTED day (tab + panel) — fixed by tapping, not by swiping. */
  selectedIndex: number;
  /** The week being BROWSED (the pager's current page). */
  viewWeek: number;
  expanded: boolean;
  /** Per-week mileage contracts, rendered as compact seams in month view. */
  weekGoals?: WeekGoal[];
  /** Supplied on the Week tab. Omitted on the standalone month navigator. */
  onExpandedChange?: (expanded: boolean) => void;
  reduceMotion?: boolean;
  onSelectDay: (index: number) => void;
  onViewWeek: (week: number) => void;
}

export function CalendarMonth({
  days,
  totalWeeks,
  selectedIndex,
  viewWeek,
  expanded,
  weekGoals = [],
  onExpandedChange,
  reduceMotion = false,
  onSelectDay,
  onViewWeek,
}: CalendarMonthProps) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const simplifiedCells = usesAccessibilityTextLayout(fontScale);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  // Both calendar surfaces sit inside the canonical page gutter. Use that
  // geometry for the first render so the current week is already parked and
  // visible; the native measurement takes over as soon as it arrives. Starting
  // at zero withheld the pager until onLayout, which made its numbers appear to
  // slide in after the rest of an otherwise-ready Week tab.
  const width = measuredWidth || Math.max(0, windowWidth - space.lg * 2);
  const pagerRef = useRef<ScrollView>(null);
  const monthPagerRef = useRef<ScrollView>(null);
  const dragStart = useRef(expanded ? 1 : 0);

  const progress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion
      ? (expanded ? 1 : 0)
      : withTiming(expanded ? 1 : 0, {
          duration: 260,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
        });
  }, [expanded, progress, reduceMotion]);

  // Geometry from the measured width (cells are square), inset by EDGE each side.
  const cellW = width > 0 ? (width - 2 * EDGE - GAP * (COLS - 1)) / COLS : 0;
  const rowH = cellW;
  const showContractSeams = weekGoals.length > 0;
  const rowMetaH = showContractSeams ? CONTRACT_SEAM_H : 0;
  const stride = rowH + rowMetaH + GAP;

  // ── Month model ────────────────────────────────────────────────────────────
  // A week belongs to a month page when ANY of its days fall in that month, so a
  // boundary week shows (dimmed) in both neighbours — the familiar calendar grid.
  // The ORDERED list of distinct months keys off each week's mid-week (Thursday)
  // day, so every month appears exactly once in chronological order.
  const monthKey = (wi: number) =>
    (days[wi * 7 + 3]?.localDate ?? days[wi * 7]?.localDate ?? '').slice(0, 7);
  const weeksInMonth = (mk: string) => {
    const out: number[] = [];
    for (let w = 0; w < totalWeeks; w++) {
      if (days.slice(w * 7, w * 7 + 7).some((d) => d.localDate.slice(0, 7) === mk)) out.push(w);
    }
    return out;
  };
  const monthKeys: string[] = [];
  for (let w = 0; w < totalWeeks; w++) {
    const mk = monthKey(w);
    if (mk && monthKeys[monthKeys.length - 1] !== mk) monthKeys.push(mk);
  }
  // The active page follows the BROWSED week (its mid-week day).
  const activeMonth = monthKey(viewWeek);
  const activeMonthIdx = Math.max(0, monthKeys.indexOf(activeMonth));
  const activeWeeks = weeksInMonth(activeMonth);
  const curRow = Math.max(0, activeWeeks.indexOf(viewWeek));
  // Expanded height fits the ACTIVE month's rows — no reserved dead space for the
  // tallest month; swiping to a month with a different row count resizes on settle.
  const rows = activeWeeks.length;
  const collapsedH = rowH;
  const expandedH = rowH > 0 && rows > 0 ? rows * (rowH + rowMetaH) + (rows - 1) * GAP : 0;
  const goalByStart = useMemo(() => {
    const map = new Map<string, WeekGoal>();
    for (const goal of weekGoals) map.set(goal.weekStart, goal);
    return map;
  }, [weekGoals]);

  const settleExpanded = useCallback((next: boolean) => {
    const target = next ? 1 : 0;
    progress.value = reduceMotion
      ? target
      : withTiming(target, {
          duration: 260,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
        });
    if (next !== expanded) {
      onExpandedChange?.(next);
      if (!reduceMotion) void Haptics.selectionAsync().catch(() => undefined);
    }
  }, [expanded, onExpandedChange, progress, reduceMotion]);

  const hingePan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-6, 6])
        .failOffsetX([-18, 18])
        .onBegin(() => {
          dragStart.current = progress.value;
        })
        .onUpdate((event) => {
          const travel = Math.max(1, expandedH - collapsedH);
          progress.value = Math.max(0, Math.min(1, dragStart.current + event.translationY / travel));
        })
        .onEnd((event) => {
          const travel = Math.max(1, expandedH - collapsedH);
          const projected = progress.value + (event.velocityY / travel) * 0.1;
          settleExpanded(projected >= 0.45);
        }),
    [collapsedH, expandedH, progress, settleExpanded],
  );

  // Park the pager on the browsed week when it changes from OUTSIDE a swipe
  // (a tap, jump-to-today). A swipe already leaves it there, so this is a no-op.
  useEffect(() => {
    if (width > 0) pagerRef.current?.scrollTo({ x: viewWeek * width, y: 0, animated: false });
  }, [viewWeek, width]);

  // Park the month carousel on the browsed month when the active month changes
  // from outside a horizontal swipe (a week swipe, tap, or jump-to-today).
  useEffect(() => {
    if (width > 0) monthPagerRef.current?.scrollTo({ x: activeMonthIdx * width, y: 0, animated: false });
  }, [activeMonthIdx, width]);

  const onPagerSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== viewWeek) onViewWeek(page);
  };

  // Settle the month carousel → browse to the settled month's HOME week (the week
  // whose mid-week day is in that month), so the header and a later collapse land
  // inside the month rather than on a shared boundary week.
  const onMonthSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    const mk = monthKeys[page];
    if (!mk || mk === activeMonth) return;
    const weeks = weeksInMonth(mk);
    const home = weeks.find((wi) => monthKey(wi) === mk) ?? weeks[0];
    if (home != null) onViewWeek(home);
  };

  // One driver: clip grows + the inner grid slides so the viewed week sits at the
  // window top (collapsed) and in place (expanded); the pager fades out.
  const clipStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [collapsedH, expandedH]),
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-curRow * stride, 0]) }],
  }));
  const pagerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12], [1, 0], 'clamp'),
  }));

  const renderCell = (
    d: CalendarDay,
    idx: number,
    layer: 'pager' | 'month',
    pageMonth: string,
  ) => {
    // A day's headline mileage is the SUM of EVERY run that day (a workout plus a
    // shake-out easy run reads as the full load, not just the first run).
    const workouts = d.workouts ?? [];
    const planned = workouts.length
      ? workouts.reduce((s, w) => s + (w.plannedMeters ?? 0), 0)
      : d.plannedMeters ?? 0;
    // State-based headline (owner rule): the ACTUAL takes precedence when it
    // exists OR the day is past; the PLAN shows when nothing ran and the day is
    // today/upcoming. So a completed/deviated day reads what you RAN, a missed
    // past day reads a miss, and the road ahead reads the plan. The full
    // plan-vs-actual + how the day's plan evolved lives in the day detail.
    const actualM = d.actualMeters ?? 0;
    const hasActual = actualM > 0;
    const isPastOutcome = d.state === 'done' || d.state === 'missed';
    const showActual = hasActual || isPastOutcome;
    const displayM = showActual ? actualM : planned;
    // Google-Flights pattern: the DATE is the bold hero; the mileage sits below as
    // a lighter, smaller, UNIT'd secondary number, tinted by type.
    const miles = displayM > 0 ? Math.round(metersToUnits(displayM, units)) : 0;
    const dom = Number(d.localDate.slice(8, 10));
    // A past day with no run = an honest miss (a dash), never a phantom planned number.
    const missed = showActual && !hasActual && d.state !== 'rest';
    // The number is neutral magnitude. Easy is the unmarked default; only
    // Quality / Long (including duals and doubles) earn the scarce type lane.
    // Completion itself lives in the banked-vs-planned number treatment.
    const ranQuality = (d.activities ?? []).some((a) => a.qualityDetected === true);
    const marks = dayMarks(C, workouts, {
      closed: isPastOutcome,
      ranSomething: hasActual,
      ranQuality,
    }).filter((mark) => mark.color !== C.faint || mark.split != null);
    const outMonth = d.localDate.slice(0, 7) !== pageMonth;
    const selected = idx === selectedIndex;
    const rest = d.state === 'rest';
    const spokenState = rest
      ? 'Rest day'
      : missed
        ? 'No run logged'
        : miles > 0
          ? `${miles} ${unitWord} ${showActual ? 'completed' : 'planned'}`
          : 'No run planned';
    // Shared cell: selection is a contained neutral fill in both week and month
    // views. A past miss reads an honest dash; rest reads a moon.
    return (
      <CalendarCell
        key={d.localDate}
        dom={dom}
        isToday={d.isToday}
        miles={miles}
        unit={units}
        actual={showActual && hasActual}
        marks={marks}
        missed={missed}
        rest={rest}
        selected={selected}
        outMonth={outMonth}
        simplified={simplifiedCells}
        height={rowH || undefined}
        accessibilityRole="tab"
        accessibilityLabel={`${WEEKDAY_NAMES[d.dayIndex] ?? 'Day'}, ${d.localDate}. ${spokenState}`}
        onPress={() => onSelectDay(idx)}
        testID={`${layer === 'pager' ? 'cal-day' : 'cal-mday'}-${d.localDate}`}
      />
    );
  };

  const renderWeekRow = (wi: number, layer: 'pager' | 'month', pageMonth: string, topGap?: boolean) => {
    const wk = days.slice(wi * 7, wi * 7 + 7);
    const goal = goalByStart.get(wk[0]?.localDate ?? '');
    return (
      <View style={topGap && { marginTop: GAP }}>
        <View style={styles.weekRow}>
          {wk.map((d, di) => renderCell(d, wi * 7 + di, layer, pageMonth))}
        </View>
        {layer === 'month' && showContractSeams ? <ContractSeam goal={goal} /> : null}
      </View>
    );
  };

  return (
    <View
      style={styles.month}
      onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
      testID="calendar-month"
    >
      <View style={styles.headRow}>
        {WD.map((d, i) => (
          <Text key={i} style={styles.headCell} maxFontSizeMultiplier={1.2}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.body}>
        {/* Expanded month: a horizontal month carousel inside the growing clip
            window. Collapsed, the clip reveals one row (the browsed week) of the
            active month; expanding grows it to the full month while the pager
            fades. Swiping the carousel BROWSES months (selection stays put). */}
        <Animated.View
          style={[styles.clip, clipStyle]}
          accessibilityElementsHidden={width > 0 && !expanded}
          importantForAccessibility={width > 0 && !expanded ? 'no-hide-descendants' : 'auto'}
        >
          {width > 0 ? (
            <ScrollView
              ref={monthPagerRef}
              horizontal
              snapToInterval={width}
              snapToAlignment="start"
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              scrollEnabled={expanded}
              contentOffset={{ x: activeMonthIdx * width, y: 0 }}
              onMomentumScrollEnd={onMonthSettle}
              style={{ height: expandedH }}
            >
              {monthKeys.map((mk, monthIndex) => (
                <Animated.View
                  key={mk}
                  style={[{ width, height: expandedH }, innerStyle]}
                  accessibilityElementsHidden={!expanded || monthIndex !== activeMonthIdx}
                  importantForAccessibility={!expanded || monthIndex !== activeMonthIdx ? 'no-hide-descendants' : 'auto'}
                >
                  {weeksInMonth(mk).map((wi, ri) => (
                    <View key={wi}>{renderWeekRow(wi, 'month', mk, ri > 0)}</View>
                  ))}
                </Animated.View>
              ))}
            </ScrollView>
          ) : (
            // Width not yet measured (first paint / tests): render the active month
            // statically so the day cells exist for tap + initial layout.
            <Animated.View style={innerStyle}>
              {activeWeeks.map((wi, ri) => (
                <View key={wi}>{renderWeekRow(wi, 'month', activeMonth, ri > 0)}</View>
              ))}
            </Animated.View>
          )}
        </Animated.View>

        {/* Collapsed pager: swipe BROWSES weeks. Selection is contained by the
            day cell, so the rail and the workout card remain independent. */}
        {width > 0 ? (
          <Animated.View
            style={[styles.pager, { height: rowH }, pagerStyle]}
            pointerEvents={expanded ? 'none' : 'auto'}
            accessibilityElementsHidden={expanded}
            importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'}
          >
            <ScrollView
              ref={pagerRef}
              horizontal
              // Momentum carousel (not hard paging): fling across weeks and glide
              // to a gentle stop on a week boundary, neighbours easing past.
              snapToInterval={width}
              snapToAlignment="start"
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              contentOffset={{ x: viewWeek * width, y: 0 }}
              onMomentumScrollEnd={onPagerSettle}
            >
              {Array.from({ length: totalWeeks }, (_, wi) => (
                <View
                  key={wi}
                  style={{ width }}
                  accessibilityElementsHidden={expanded || wi !== viewWeek}
                  importantForAccessibility={expanded || wi !== viewWeek ? 'no-hide-descendants' : 'auto'}
                >
                  {renderWeekRow(wi, 'pager', activeMonth)}
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}
      </View>
      {onExpandedChange ? (
        <GestureDetector gesture={hingePan}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse month calendar' : 'Expand month calendar'}
            accessibilityHint="Drag vertically or double tap"
            accessibilityState={{ expanded }}
            onPress={() => settleExpanded(!expanded)}
            style={({ pressed }) => [styles.hinge, pressed && styles.hingePressed]}
            testID="calendar-hinge"
          >
            <View style={styles.hingeGrip} />
          </Pressable>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    month: { paddingTop: space.xxs },

    headRow: { flexDirection: 'row', gap: GAP, paddingBottom: GAP, paddingHorizontal: EDGE },
    headCell: {
      flex: 1,
      textAlign: 'center',
      color: C.mute,
      fontSize: fontSizes.micro,
      fontWeight: '800',
      letterSpacing: 0.5,
    },

    body: { position: 'relative' },
    clip: { overflow: 'hidden' },
    // Solid page backing so the stationary month layer beneath never shows
    // through the inter-cell gaps as the reel scrolls.
    pager: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: C.bg },

    weekRow: { flexDirection: 'row', gap: GAP, paddingHorizontal: EDGE },
    contractSeamSpace: { height: CONTRACT_SEAM_H },
    contractSeam: {
      height: CONTRACT_SEAM_H,
      paddingHorizontal: EDGE,
      justifyContent: 'center',
    },
    contractTrackFrame: {
      height: CONTRACT_SEAM_H,
      marginHorizontal: space.xs,
      justifyContent: 'center',
      position: 'relative',
    },
    contractTrack: {
      height: 3,
      borderRadius: 2,
      backgroundColor: C.fill,
      overflow: 'hidden',
    },
    contractFill: { height: '100%', borderRadius: 2, backgroundColor: C.faint, opacity: 0.78 },
    contractFillCurrent: { backgroundColor: C.yellow },
    // Settled weeks stay neutral: position carries the quantity while the small
    // endpoint shape carries the verdict (solid = met, x = short).
    contractVerdictHead: {
      position: 'absolute',
      top: -1,
      marginLeft: -8,
      width: 16,
      height: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contractVerdictDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: C.mute,
    },
    hinge: {
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hingeGrip: { width: 28, height: 4, borderRadius: 2, backgroundColor: C.faint },
    hingePressed: { opacity: 0.58 },
    // Per-cell rendering (date hero + mileage + today bar + miss/rest) lives in
    // the shared CalendarCell — the planner reuses the same component.
  });
