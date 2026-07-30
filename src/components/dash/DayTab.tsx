/**
 * DayTab — one day cell in the Dash "calendar-as-tabs" week bar.
 *
 * This screen is a plan browser, not a completion tracker, so the NUMBER stays
 * neutral — the SELECTED day → ink (white / near-black, so it stands out by
 * brightness not hue), every other day → grey — and never encodes done/missed.
 * TODAY is a separate state from selection and carries its own yellow now-mark
 * (matching CalendarCell's month-grid today), so browsing another day never
 * hides where the runner actually is. Workout TYPE is what carries colour, on
 * two marks:
 *   - one PIP per planned workout under the number (Runna's pattern): long → cyan,
 *     quality → violet (speed folds in), easy → steel blue. A double shows
 *     two pips side by side; rest shows none.
 *   - the selected tab's BORDERLINE (drawn in CalendarTabs) takes the primary
 *     workout's type colour for the day in focus (neutral when there's no
 *     workout) — it follows the workout, not the date, so today is no exception.
 *
 * Accessibility: role="tab" with accessibilityState.selected and a descriptive
 * accessibilityLabel built from the day's date, state, and tone.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { eyebrowText } from '@/components/ui/Eyebrow';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, space, type Tokens } from '@/theme/tokens';
import { toneColor } from '@/theme/tone';
import type { CalendarDay, WorkoutTone } from '@/lib';

// ── DOW / month names for the accessibilityLabel ────────────────────────────
const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Parse a 'YYYY-MM-DD' civil date at noon UTC — same anchor the rest of the project uses. */
function parseCivil(localDate: string): Date {
  return new Date(`${localDate}T12:00:00Z`);
}

// ── accessibilityLabel builder ───────────────────────────────────────────────
function buildA11yLabel(day: CalendarDay, selected: boolean): string {
  const parts: string[] = [];

  try {
    const d = parseCivil(day.localDate);
    const dowName = DOW_NAMES[day.dayIndex] ?? '';
    const monthName = MONTH_NAMES[d.getUTCMonth()] ?? '';
    const dayOfMonth = d.getUTCDate();
    parts.push(`${dowName} ${monthName} ${dayOfMonth}`);
  } catch {
    parts.push(day.initial);
  }

  if (day.isToday) parts.push('today');

  switch (day.state) {
    case 'done':
      parts.push('completed');
      break;
    case 'missed':
      parts.push('missed');
      break;
    case 'rest':
      parts.push('rest');
      break;
    case 'upcoming':
      parts.push('upcoming');
      break;
    case 'today-pending':
      break;
  }

  if (day.primary?.tone === 'quality' || day.primary?.tone === 'speed') {
    parts.push('quality');
  } else if (day.primary?.tone === 'long') {
    parts.push('long');
  }

  if (selected) parts.push('selected');

  return parts.join(', ');
}

/**
 * Date number colour — neutral. This is a plan browser, not a completion
 * tracker, so the number never encodes done/missed: the SELECTED day → ink
 * (brightness, no hue), every other day → grey. Workout type lives on the pips
 * + the selected borderline, never on the number.
 *
 * Today deliberately does NOT borrow this: "current position and temporary
 * inspection are separate states" (DESIGN.md), and today already owns the
 * yellow now-mark — the same mark CalendarCell pins to the month grid's today.
 * Sharing ink between the two made a browsed day look like today.
 */
function dateColor(C: Tokens, selected: boolean): string {
  return selected ? C.ink : C.mute;
}

/**
 * The carousel's TYPE colour map, shared by the per-day pips and the selected
 * tab's borderline (in CalendarTabs) so the two never disagree: long → cyan,
 * quality → violet (speed folds in), easy → steel blue. Anything else
 * (rest / untyped) → null. Delegates to `tone.ts`, the canonical map.
 */
export function stripToneColor(C: Tokens, tone: WorkoutTone): string | null {
  return toneColor(C, tone);
}

interface Pip {
  color: string;
  done: boolean;
  /** When set, the pip is dual: `color` on one half, `split` (quality violet) on
   *  the other — a run that is BOTH its type AND carries embedded quality work. */
  split?: string;
}

/** One pip per planned workout (capped at two, Runna-style), in plan order, each
 *  tagged with completion — filled once banked, a hollow ring while still to do.
 *  A non-quality workout with embedded quality (a long run w/ an MP block) gets a
 *  half type-colour / half quality-violet pip. */
function typePips(C: Tokens, day: CalendarDay): Pip[] {
  return day.workouts
    .map((w): Pip | null => {
      const color = stripToneColor(C, w.tone);
      if (color == null) return null;
      return w.hasEmbeddedQuality ? { color, done: w.completed, split: C.qual } : { color, done: w.completed };
    })
    .filter((p): p is Pip => p != null)
    .slice(0, 2);
}

// ── Component ────────────────────────────────────────────────────────────────
function DayTabImpl({
  day,
  selected,
  onPress,
}: {
  day: CalendarDay;
  selected: boolean;
  onPress: () => void;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);

  const dateNum = day.localDate.slice(8); // last two chars = day of month
  const a11yLabel = buildA11yLabel(day, selected);
  const pips = typePips(C, day);

  return (
    <Pressable
      onPress={onPress}
      style={styles.cell}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={a11yLabel}
    >
      <Text style={[styles.dow, selected && { color: C.ink }]}>
        {day.initial}
      </Text>
      {/* Two independent states, two marks: SELECTION brightens + weights the
          numeral (the strip's fill sits behind it), TODAY pins the yellow
          now-dot — so today stays unmistakable while another day is inspected. */}
      <View style={styles.dateBadge}>
        {day.isToday ? <View testID="daytab-today-mark" style={styles.todayMark} /> : null}
        <Text
          testID="daytab-date"
          style={[
            styles.dt,
            { color: dateColor(C, selected) },
            selected && styles.dtSel,
          ]}
        >
          {dateNum}
        </Text>
      </View>
      {/* Type pips — one per workout (≤2). Filled once the workout is banked, a
          hollow ring while it's still upcoming. Reserve the row height on every
          cell so the numbers stay aligned whether or not a day has pips. */}
      <View style={styles.dotRow}>
        {pips.map((p, i) =>
          p.split != null ? (
            // Dual pip: half type-colour, half quality-violet (dimmed while upcoming).
            <View key={i} testID="daytab-typedot" style={[styles.dot, styles.dotSplit, !p.done && styles.dotUpcoming]}>
              <View style={[styles.dotHalf, { backgroundColor: p.color }]} />
              <View style={[styles.dotHalf, { backgroundColor: p.split }]} />
            </View>
          ) : (
            <View
              key={i}
              testID="daytab-typedot"
              style={[
                styles.dot,
                p.done
                  ? { backgroundColor: p.color }
                  : { borderColor: p.color, borderWidth: 1.4, backgroundColor: 'transparent' },
              ]}
            />
          ),
        )}
      </View>
    </Pressable>
  );
}

/**
 * Memoised: the carousel renders one cell per plan day, so only the cells whose
 * `day` or `selected` actually change should re-render on a scroll settle.
 */
export const DayTab = memo(
  DayTabImpl,
  (a, b) => a.day === b.day && a.selected === b.selected,
);

// ── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    cell: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      paddingTop: space.md,
      paddingBottom: space.s,
    },
    dow: {
      ...eyebrowText(C, 'micro'),
      color: C.faint,
      marginBottom: space.s,
    },
    // Wraps the numeral so the now-mark can hang off its corner without
    // shifting any baseline — the same anatomy as CalendarCell's date badge.
    dateBadge: { alignItems: 'center', justifyContent: 'center' },
    todayMark: {
      position: 'absolute',
      top: -2,
      right: -7,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: C.yellow,
    },
    dt: {
      fontSize: fontSizes.sectionTitle,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      lineHeight: 19,
      color: C.mute,
    },
    dtSel: {
      fontWeight: '800',
    },
    dotRow: {
      height: 6,
      marginTop: space.xs,
      flexDirection: 'row',
      gap: 3,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
    },
    // Dual pip: two colour halves clipped to the dot's rounded shape.
    dotSplit: { flexDirection: 'row', overflow: 'hidden' },
    dotHalf: { flex: 1 },
    dotUpcoming: { opacity: 0.45 },
  });
