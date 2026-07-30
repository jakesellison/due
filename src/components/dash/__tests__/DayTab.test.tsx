/**
 * DayTab — render tests for the calendar-tab day cell.
 *
 * Two axes on two marks: the NUMBER COLOUR carries status, a DOT under the
 * number carries workout type. Tests assert the resolved colour of the date
 * glyph + the type dot plus a11y semantics.
 *
 * Uses @testing-library/react-native wrapped in ThemeProvider.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import type { CalendarDay } from '@/lib';
import { DayTab } from '../DayTab';

const C = THEMES.dark;

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDay(overrides: Partial<CalendarDay> = {}): CalendarDay {
  return {
    localDate: '2026-06-23',
    dayIndex: 1, // Tuesday
    initial: 'T',
    state: 'upcoming',
    plannedMeters: 8000,
    actualMeters: 0,
    isQuality: false,
    isRace: false,
    isDouble: false,
    isToday: false,
    target: { kind: 'none' },
    workouts: [],
    activities: [],
    primary: null,
    ...overrides,
  };
}

function renderTab(day: CalendarDay, selected = false, onPress = jest.fn()) {
  return render(
    <ThemeProvider preference="dark">
      <DayTab day={day} selected={selected} onPress={onPress} />
    </ThemeProvider>,
  );
}

/** Resolved colour of the date glyph. */
function dateColor(): string | undefined {
  const node = screen.getByTestId('daytab-date');
  return StyleSheet.flatten(node.props.style)?.color as string | undefined;
}

/** Resolved colour of each type pip, in order — the fill when banked, else the
 *  ring's border colour (upcoming pips are hollow). Empty when a day has none. */
function pipColors(): string[] {
  return screen.queryAllByTestId('daytab-typedot').map((n) => {
    const s = StyleSheet.flatten(n.props.style);
    return (s?.backgroundColor !== 'transparent' ? s?.backgroundColor : s?.borderColor) as string;
  });
}

function qualityPrimary(): CalendarDay['primary'] {
  return {
    id: 'w1', type: 'quality', title: 'Threshold', isQuality: true,
    structure: [], plannedMeters: 13000, completed: false, outcome: 'planned', actualMeters: 0, sealed: false, tone: 'quality',
  };
}
function longPrimary(): CalendarDay['primary'] {
  return {
    id: 'w2', type: 'long', title: 'Long Run', isQuality: false,
    structure: [], plannedMeters: 32000, completed: false, outcome: 'planned', actualMeters: 0, sealed: false, tone: 'long',
  };
}
function easyWorkout(): CalendarDay['primary'] {
  return {
    id: 'w3', type: 'easy', title: 'Easy Run', isQuality: false,
    structure: [], plannedMeters: 8000, completed: false, outcome: 'planned', actualMeters: 0, sealed: false, tone: 'easy',
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('past day: renders date, role=tab, selected=false, neutral (grey) number — no completion colour', () => {
  const day = makeDay({ state: 'done', localDate: '2026-06-23', dayIndex: 1, initial: 'T' });
  renderTab(day, false);

  const tab = screen.getByRole('tab');
  expect(tab.props.accessibilityState?.selected).toBe(false);
  expect(screen.getByText('23')).toBeTruthy();
  expect(dateColor()).toBe(C.mute); // grey — the strip doesn't track done/missed
});

test('selected day: accessibilityState.selected is true', () => {
  const day = makeDay({ state: 'done', localDate: '2026-06-23' });
  renderTab(day, true);
  expect(screen.getByRole('tab').props.accessibilityState?.selected).toBe(true);
});

test('today, not selected: keeps the neutral number but pins the yellow now-mark', () => {
  const day = makeDay({ state: 'today-pending', localDate: '2026-06-24', isToday: true });
  renderTab(day, false);
  // Selection owns brightness; today owns the mark. Sharing ink between them
  // made an inspected day read as the current position (DESIGN.md "current
  // position and temporary inspection are separate states").
  expect(dateColor()).toBe(C.mute);
  const mark = StyleSheet.flatten(screen.getByTestId('daytab-today-mark').props.style);
  expect(mark.backgroundColor).toBe(C.yellow);
  expect(screen.getByRole('tab').props.accessibilityLabel).toMatch(/today/i);
});

test('selected day: number brightens to ink; a non-today day carries no now-mark', () => {
  const day = makeDay({ state: 'upcoming', localDate: '2026-06-25' });
  renderTab(day, true);
  expect(dateColor()).toBe(C.ink);
  expect(screen.queryByTestId('daytab-today-mark')).toBeNull();
});

test('today AND selected: both states show — ink number plus the now-mark', () => {
  const day = makeDay({ state: 'today-pending', localDate: '2026-06-24', isToday: true });
  renderTab(day, true);
  expect(dateColor()).toBe(C.ink);
  expect(screen.getByTestId('daytab-today-mark')).toBeTruthy();
});

test('upcoming quality day: grey number + a single pink (z5) pip', () => {
  const q = qualityPrimary()!;
  const day = makeDay({ state: 'upcoming', primary: q, workouts: [q] });
  renderTab(day, false);
  expect(dateColor()).toBe(C.mute);
  expect(pipColors()).toEqual([C.qualText]); // contrast-safe violet = quality
});

test('upcoming long day: grey number + a single cyan pip', () => {
  const l = longPrimary()!;
  const day = makeDay({ state: 'upcoming', primary: l, workouts: [l] });
  renderTab(day, false);
  expect(dateColor()).toBe(C.mute);
  expect(pipColors()).toEqual([C.cyanText]); // contrast-safe cyan = long
});

test('easy day: a single steel-blue pip', () => {
  const e = easyWorkout()!;
  const day = makeDay({ state: 'upcoming', primary: e, workouts: [e] });
  renderTab(day, false);
  expect(pipColors()).toEqual([C.easyText]);
});

test('double day (easy + quality): two pips, steel blue then violet, in plan order', () => {
  const e = easyWorkout()!;
  const q = qualityPrimary()!;
  const day = makeDay({ state: 'upcoming', primary: q, workouts: [e, q], isDouble: true });
  renderTab(day, false);
  expect(pipColors()).toEqual([C.easyText, C.qualText]);
});

test('rest day: no pips', () => {
  const day = makeDay({ state: 'rest', primary: null, workouts: [] });
  renderTab(day, false);
  expect(pipColors()).toEqual([]);
});

test('upcoming workout: pip is a hollow ring; completed workout: pip is filled', () => {
  const upcoming = makeDay({ state: 'upcoming', primary: qualityPrimary()!, workouts: [qualityPrimary()!] });
  renderTab(upcoming, false);
  const sUp = StyleSheet.flatten(screen.getAllByTestId('daytab-typedot')[0]!.props.style);
  expect(sUp.backgroundColor).toBe('transparent'); // hollow ring while to-do
  expect(sUp.borderColor).toBe(C.qualText);

  const done = { ...qualityPrimary()!, completed: true };
  const completed = makeDay({ state: 'done', primary: done, workouts: [done] });
  renderTab(completed, false);
  const sDone = StyleSheet.flatten(screen.getAllByTestId('daytab-typedot')[0]!.props.style);
  expect(sDone.backgroundColor).toBe(C.qualText); // filled once banked
});

test('missed day: neutral (grey) number, no strikethrough, a11y still says "missed"', () => {
  const day = makeDay({ state: 'missed', localDate: '2026-06-20', dayIndex: 5, initial: 'S' });
  renderTab(day, false);
  const tab = screen.getByRole('tab');
  expect(tab.props.accessibilityLabel).toMatch(/missed/i); // a11y keeps it; the visual doesn't
  expect(dateColor()).toBe(C.mute);
  expect(StyleSheet.flatten(screen.getByTestId('daytab-date').props.style)?.textDecorationLine).toBeUndefined();
});

test('rest day: a11y contains "rest"', () => {
  const day = makeDay({ state: 'rest', localDate: '2026-06-28', dayIndex: 6, initial: 'S' });
  renderTab(day, false);
  expect(screen.getByRole('tab').props.accessibilityLabel).toMatch(/rest/i);
});
