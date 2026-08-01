/**
 * CalendarCell — one day cell in the Dash week/month grid, and the SAME cell
 * reused as a drop target in the week planner (app/planner/[id]).
 *
 * Presentational: it takes already-computed primitives (day-of-month, the
 * headline mileage + its shared type marks, the past-miss / rest / today flags) so
 * each surface derives its own numbers while the LOOK stays identical — the
 * Google-Flights anatomy (bold date hero, lighter unit'd mileage below, a
 * yellow today pin, an honest dash for a miss, a moon for rest). Extracted from
 * CalendarMonth so the two surfaces can never drift.
 *
 * `hollow` is the planner-only empty state: a day with nothing on it reads as
 * an open slot (date only, no phantom number) — see the owner's "hollow if
 * we've removed a date" rule.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { statValueText } from '@/components/ui/Stat';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';
import { TypeMarks, type CellMark } from './TypeMarks';

export type { CellMark };

export interface CalendarCellProps {
  /** Day-of-month, the bold hero number. */
  dom: number;
  isToday?: boolean;
  /** Headline miles (rounded). 0/undefined → no number (see missed/rest/hollow). */
  miles?: number;
  /** Display unit for the headline distance. */
  unit?: 'mi' | 'km';
  /** true = banked mileage, false = still-planned mileage. */
  actual?: boolean;
  /** Type marks rendered as a top notch inside the cell: one bar per distinct run
   *  type (solid), a split bar for a dual (type + quality). Separate bars = separate
   *  runs (a double); a single split bar = one run that's both. */
  marks?: CellMark[];
  /** Past day, nothing ran → an honest dash in the number slot. */
  missed?: boolean;
  /** Rest day → a faint moon in the number slot. */
  rest?: boolean;
  /** Planner empty slot — date only, no number, muted. */
  hollow?: boolean;
  /** Month-view selection: shade the cell in the panel surface. */
  selected?: boolean;
  /** True when this cell is the collapsed pager's raised tab (skip the fill —
   *  the tab outline supplies it). */
  isSelectedTab?: boolean;
  /** Dim an adjacent-month day. */
  outMonth?: boolean;
  /** Reduce a dense seven-column instrument to dates. Defaults on for Dynamic
   *  Type accessibility sizes; the full state remains in accessibilityLabel. */
  simplified?: boolean;
  /** Row height (square cells) — omit to size by content. */
  height?: number;
  /** Full spoken date/state supplied by the owning calendar surface. */
  accessibilityLabel?: string;
  /** Calendar cells are tabs; planner reuse remains a standard button. */
  accessibilityRole?: 'button' | 'tab';
  onPress?: () => void;
  testID?: string;
}

export function CalendarCell({
  dom,
  isToday,
  miles = 0,
  unit = 'mi',
  actual,
  marks,
  missed,
  rest,
  hollow,
  selected,
  isSelectedTab,
  outMonth,
  simplified,
  height,
  accessibilityLabel,
  accessibilityRole = 'button',
  onPress,
  testID,
}: CalendarCellProps) {
  const styles = useThemedStyles(makeStyles);
  const showDateOnly = simplified ?? false;
  // The Dash strip lets number tone carry banked vs planned. The lower lane is
  // reserved for workout type, so it never doubles as a completion glyph.
  // Planner cells omit `actual` and retain their full marks.
  const visibleMarks = actual === false ? marks?.slice(0, 1) : marks;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={2}
      accessibilityRole={accessibilityRole}
      accessibilityState={selected == null ? undefined : { selected }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.cell,
        height ? { height } : null,
        selected && !isSelectedTab && !outMonth && styles.cellSelected,
        isSelectedTab && styles.cellSelectedTab,
        outMonth && styles.cellOut,
        hollow && styles.cellHollow,
        pressed && styles.pressed,
      ]}
    >
      {/* Selection owns the quiet cell fill. Today is typographic, so the two
          independent states never create a nested cell-within-a-cell. */}
      {!showDateOnly && miles > 0 && !isSelectedTab && visibleMarks && visibleMarks.length > 0 ? (
        <TypeMarks
          marks={visibleMarks}
          testID="daycell-marks-lane"
          style={[styles.marksLane, actual === false && styles.marksPlanned]}
        />
      ) : null}
      <View
        style={styles.dateBadge}
        testID={isToday ? 'daycell-today-badge' : undefined}
      >
        {isToday ? <View testID="daycell-today-indicator" style={styles.todayIndicator} /> : null}
        <Text
          style={[styles.cellDate, hollow && styles.dim]}
          maxFontSizeMultiplier={1.2}
        >
          {dom}
        </Text>
      </View>
      {!showDateOnly && miles > 0 ? (
        <>
          <Text
            style={[
              styles.cellMi,
              actual === true && styles.cellMiActual,
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {miles}
            <Text style={styles.cellUnit} maxFontSizeMultiplier={1.2}>{unit}</Text>
          </Text>
        </>
      ) : !showDateOnly && missed ? (
        <Text style={[styles.cellMi, styles.dim]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          —
        </Text>
      ) : !showDateOnly && rest ? (
        <SymbolView name="moon.zzz.fill" size={11} tintColor={styles.restTint.color} resizeMode="scaleAspectFit" style={styles.cellRest} />
      ) : null}
    </Pressable>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    cell: {
      flex: 1,
      borderRadius: radius.md,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    cellSelected: { backgroundColor: C.panel },
    // The selected tab needs breathing room at its bottom seam. Its workout
    // type is already expressed in the panel, so no mark is repeated here.
    cellSelectedTab: { paddingBottom: space.nudge },
    cellOut: { opacity: 0.32 },
    cellHollow: { borderColor: C.line, borderStyle: 'dashed' },
    pressed: { opacity: 0.55 },
    cellDate: {
      ...statValueText(C, 'body', 'system'),
      fontWeight: '700',
      letterSpacing: -0.3,
    },
    dateBadge: {
      minWidth: 27,
      height: 24,
      paddingHorizontal: space.s,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    todayIndicator: {
      position: 'absolute',
      top: 1,
      right: -2,
      width: 8,
      height: 8,
      borderRadius: radius.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.yellowText,
      backgroundColor: C.yellow,
    },
    cellMi: {
      ...statValueText(C, 'micro', 'system'),
      marginTop: 1,
      fontWeight: '700',
      // Neutral by default — type now lives in the marks lane below, not the number.
      color: C.mute,
    },
    // Banked days step forward; the road ahead remains legible but quieter.
    cellMiActual: { color: C.ink, fontWeight: '800' },
    cellUnit: { fontSize: fontSizes.micro, fontWeight: '700' },
    // Type is an inset notch, not a third content row. Absolute positioning
    // keeps every date and mileage baseline aligned whether a mark exists or not.
    marksLane: {
      position: 'absolute',
      top: 1,
      alignSelf: 'center',
    },
    marksPlanned: { opacity: 0.5 },
    cellRest: { width: 12, height: 12, marginTop: 1.5 },
    restTint: { color: C.faint },
    dim: { opacity: 0.45 },
  });
