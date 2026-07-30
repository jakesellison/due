/**
 * CalendarTabs + DayPanel — render + interaction tests.
 *
 * Uses @testing-library/react-native wrapped in ThemeProvider. Mocks
 * expo-router's useRouter and react-native-reanimated (both already in
 * jest.setup.app.js; the router is mocked locally since different tests
 * need different push mocks).
 *
 * Does NOT assert SVG path pixels or slide-animation state.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import type { CalendarDay, DayActivity, DayWorkout, WeekGoal } from '@/lib';
import { addDays, METERS_PER_MILE } from '@/lib';
import { CalendarTabs, type CalendarTabsHandle } from '../CalendarTabs';
import { CalendarCell } from '../CalendarCell';
import { dayMarks } from '../CalendarMonth';
import { WeekGauges } from '../WeekGauges';

const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
  width: 390,
  height: 844,
  scale: 3,
  fontScale: 1,
});
afterAll(() => dimensions.mockRestore());

/** Tap a specific day cell in the collapsed week pager (by civil date). */
function tapDay(localDate: string) {
  fireEvent.press(screen.getByTestId(`cal-day-${localDate}`));
}

// ── expo-router mock ──────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));
jest.mock('@/app-lib/routes', () => ({
  useWorkoutRouteIds: () => ({ data: new Set<string>(), isLoading: false, error: null }),
}));

// ── Fixture helpers ───────────────────────────────────────────────────────────

const WEEK_START = '2026-06-22'; // Monday

function makePrimary(overrides: Partial<DayWorkout> = {}): DayWorkout {
  return {
    id: 'wo-default',
    type: 'easy',
    title: 'Easy Run',
    isQuality: false,
    structure: [{ kind: 'steady', target: { by: 'distance', distance_m: 9656 } }],
    plannedMeters: 9656,
    completed: false,
    outcome: 'planned',
    actualMeters: 0,
    sealed: false,
    tone: 'easy',
    ...overrides,
  };
}

function makeDay(
  localDate: string,
  dayIndex: number,
  initial: string,
  overrides: Partial<CalendarDay> = {},
): CalendarDay {
  return {
    localDate,
    dayIndex,
    initial,
    state: 'upcoming',
    plannedMeters: 8000,
    actualMeters: 0,
    isQuality: false,
    isRace: false,
    isDouble: false,
    isToday: false,
    target: { kind: 'none' },
    workouts: [],
    primary: null,
    activities: [],
    ...overrides,
  };
}

/** Quality today (Wed) + Saturday long run week fixture. */
function makeWeek(): CalendarDay[] {
  const todayPrimary = makePrimary({
    id: 'wo-quality',
    type: 'threshold',
    title: 'Threshold Repeats',
    isQuality: true,
    tone: 'quality',
    plannedMeters: 20921, // ~13 mi
    structure: [
      { kind: 'warmup', target: { by: 'distance', distance_m: 3218 } },
      { kind: 'work', target: { by: 'distance', distance_m: 3218, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
      { kind: 'recovery', target: { by: 'distance', distance_m: 800 } },
      { kind: 'work', target: { by: 'distance', distance_m: 3218, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
      { kind: 'cooldown', target: { by: 'distance', distance_m: 1609 } },
    ],
  });

  const saturdayPrimary = makePrimary({
    id: 'wo-long',
    type: 'long',
    title: 'Long Run',
    isQuality: false,
    tone: 'long',
    plannedMeters: 28968, // ~18 mi
    structure: [{ kind: 'steady', target: { by: 'distance', distance_m: 28968 } }],
  });

  return [
    makeDay('2026-06-22', 0, 'M', { state: 'done', actualMeters: 12000 }),
    makeDay('2026-06-23', 1, 'T', { state: 'done', actualMeters: 9000 }),
    makeDay('2026-06-24', 2, 'W', {
      isToday: true,
      state: 'today-pending',
      isQuality: true,
      primary: todayPrimary,
      workouts: [todayPrimary],
    }),
    makeDay('2026-06-25', 3, 'T'),
    makeDay('2026-06-26', 4, 'F'),
    makeDay('2026-06-27', 5, 'S', {
      primary: saturdayPrimary,
      workouts: [saturdayPrimary],
    }),
    makeDay('2026-06-28', 6, 'S', { state: 'rest' }),
  ];
}

// The continuous rail is built week-by-week across the plan. Only the current
// week (WEEK_START anchor) carries the rich fixture (today + long run); the
// other weeks are plain so the continuous indices are realistic.
function weekDaysFor(anchor: string): CalendarDay[] {
  if (anchor === WEEK_START) return makeWeek();
  return Array.from({ length: 7 }, (_, i) =>
    makeDay(addDays(anchor, i), i, ('MTWTFSS'[i] ?? 'M')),
  );
}

function renderCalendarTabs() {
  const initialWeekDays = makeWeek();
  return render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={initialWeekDays}
        weekDaysFor={weekDaysFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
      />
    </ThemeProvider>,
  );
}

test('renders the current week pager on the first paint', () => {
  renderCalendarTabs();

  // CalendarMonth starts from the known screen gutter instead of waiting for
  // its asynchronous onLayout measurement, so the date row cannot trail the
  // rest of the ready Week screen.
  expect(screen.getByTestId('cal-day-2026-06-24')).toBeTruthy();
});

/** Sibling of `renderCalendarTabs()`: same fixture, but lets a test browse to a
 *  specific day (via `focusDate`, which drives `viewWeek`/`period`) and supply
 *  `arrivalMeters`, so the current/past/future arrival guard can be exercised
 *  without threading new params through every existing call site. */
function renderCalendarTabsAt({
  focusDate,
  arrivalMeters,
}: {
  focusDate?: string;
  arrivalMeters?: number | null;
}) {
  const initialWeekDays = makeWeek();
  return render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={initialWeekDays}
        weekDaysFor={weekDaysFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
        focusDate={focusDate}
        arrivalMeters={arrivalMeters}
      />
    </ThemeProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

test('renders the today panel title (Threshold Repeats) by default', () => {
  renderCalendarTabs();
  expect(screen.getByText('Threshold Repeats')).toBeTruthy();
});

test('today panel shows quality type label', () => {
  renderCalendarTabs();
  // TONE_WORD for quality is "Quality" — may appear in type line or eyebrow
  const qualityItems = screen.getAllByText(/Quality/);
  expect(qualityItems.length).toBeGreaterThan(0);
});

test('tapping the Saturday long run day swaps the panel', async () => {
  renderCalendarTabs();

  // Initially shows today's panel (today = Wed 2026-06-24).
  expect(screen.getByText('Threshold Repeats')).toBeTruthy();

  // Tap Saturday of the current week (the long run).
  await act(async () => {
    tapDay('2026-06-27');
  });

  expect(screen.getByText('Long Run')).toBeTruthy();
  expect(screen.queryByText('Threshold Repeats')).toBeNull();
});

test('the compact workout card exposes an accessibility label summarising the day', () => {
  renderCalendarTabs();
  expect(screen.getByRole('link', { name: /Open Threshold Repeats details/i })).toBeTruthy();
});

test('the workout card is content-sized and does not repeat a View workout CTA', () => {
  renderCalendarTabs();
  expect(screen.getByTestId('day-workout-card')).toBeTruthy();
  expect(screen.queryByText('View workout')).toBeNull();
});

test('tapping the compact workout card opens the workout', async () => {
  mockPush.mockClear();
  renderCalendarTabs();

  const card = screen.getByRole('link', { name: /Open Threshold Repeats details/i });
  await act(async () => {
    fireEvent.press(card);
  });
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/workout/[id]',
    params: { id: 'wo-quality' },
  });
});

test('tapping the Sunday rest day shows the rest-day panel', async () => {
  renderCalendarTabs();

  // Tap Sunday of the current week (rest).
  await act(async () => {
    tapDay('2026-06-28');
  });

  expect(screen.getByText('Rest day')).toBeTruthy();
});

// ── completed-day activity picker (N-generalized) ────────────────────────────
//
// On a COMPLETED day (≥1 logged activity) the single "View workout" CTA is
// replaced by one flat tappable record per logged activity, each routing to
// THAT activity's run detail (/run/[id]). N=1 → a single row; N≥2 → the picker.

function mkAct(id: string, distanceMeters: number, startDate: string | null, qualityDetected: boolean | null = null): DayActivity {
  return { id, distanceMeters, movingTimeS: null, startDate, qualityDetected, actualBar: null };
}

/** A week whose TODAY (Wed) is a completed workout day carrying `activities`. */
function makeCompletedTodayWeek(activities: DayActivity[]): CalendarDay[] {
  const primary = makePrimary({
    id: 'wo-easy',
    type: 'easy',
    title: 'Easy Run',
    isQuality: false,
    tone: 'easy',
    completed: true,
    actualMeters: activities.reduce((s, a) => s + a.distanceMeters, 0),
    plannedMeters: 12000,
  });
  return [
    makeDay('2026-06-22', 0, 'M', { state: 'done', actualMeters: 12000 }),
    makeDay('2026-06-23', 1, 'T', { state: 'done', actualMeters: 9000 }),
    makeDay('2026-06-24', 2, 'W', {
      isToday: true,
      state: 'done',
      primary,
      workouts: [primary],
      activities,
    }),
    makeDay('2026-06-25', 3, 'T'),
    makeDay('2026-06-26', 4, 'F'),
    makeDay('2026-06-27', 5, 'S'),
    makeDay('2026-06-28', 6, 'S', { state: 'rest' }),
  ];
}

function renderCompletedToday(activities: DayActivity[]) {
  const week = makeCompletedTodayWeek(activities);
  const wkFor = (anchor: string) =>
    anchor === WEEK_START ? week : Array.from({ length: 7 }, (_, i) => makeDay(addDays(anchor, i), i, 'MTWTFSS'[i] ?? 'M'));
  return render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={week}
        weekDaysFor={wkFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
      />
    </ThemeProvider>,
  );
}

const MI = 1609.344;

function mileageGoal({
  weekStart,
  label,
  actualMi,
  targetMi,
  isCurrent = false,
}: {
  weekStart: string;
  label: string;
  actualMi: number;
  targetMi: number;
  isCurrent?: boolean;
}): WeekGoal {
  const hit = actualMi >= targetMi;
  return {
    weekIndex: Number(label.replace(/\D/g, '')) - 1,
    weekStart,
    label,
    isCurrent,
    isFuture: false,
    mileage: {
      actualMeters: actualMi * MI,
      targetMeters: targetMi * MI,
      hit,
      fraction: Math.min(1, actualMi / targetMi),
    },
    quality: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
    long: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
    allMet: false,
  };
}

test('expanded month rows show met, missed, and current mileage contracts', () => {
  const goals = [
    mileageGoal({ weekStart: '2026-06-08', label: 'W5', actualMi: 42, targetMi: 40 }),
    mileageGoal({ weekStart: '2026-06-15', label: 'W6', actualMi: 32, targetMi: 40 }),
    mileageGoal({ weekStart: WEEK_START, label: 'W7', actualMi: 20, targetMi: 50, isCurrent: true }),
  ];

  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={makeWeek()}
        weekDaysFor={weekDaysFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={goals}
      />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByTestId('calendar-hinge'));
  expect(screen.getByTestId('calendar-hinge').props.accessibilityState?.expanded).toBe(true);
  expect(screen.getByLabelText('Week W5, mileage contract met')).toBeTruthy();
  expect(screen.getByLabelText('Week W6, mileage contract short by 8 miles')).toBeTruthy();
  expect(screen.getByLabelText('Week W7, mileage contract in progress, 40 percent banked')).toBeTruthy();
  expect(screen.getAllByTestId('contract-verdict-met-2026-06-08').length).toBeGreaterThan(0);
  expect(screen.getAllByTestId('contract-verdict-short-2026-06-15').length).toBeGreaterThan(0);
  const metDot = StyleSheet.flatten(
    screen.getAllByTestId('contract-verdict-met-2026-06-08')[0]?.props.style,
  );
  const shortMark = screen.getAllByTestId('contract-verdict-short-2026-06-15')[0];
  const metAnchor = StyleSheet.flatten(
    screen.getAllByTestId('contract-verdict-anchor-2026-06-08')[0]?.props.style,
  );
  const shortAnchor = StyleSheet.flatten(
    screen.getAllByTestId('contract-verdict-anchor-2026-06-15')[0]?.props.style,
  );
  expect(metDot?.width).toBe(8);
  expect(metDot?.backgroundColor).toBe(THEMES.dark.mute);
  expect(shortMark?.props.name).toBe('xmark');
  expect(shortMark?.props.size).toBe(10);
  expect(shortMark?.props.weight).toBe('black');
  expect(shortMark?.props.tintColor).toBe(THEMES.dark.mute);
  expect(metAnchor?.left).toBe('100%');
  expect(shortAnchor?.left).toBe('80%');
  expect(screen.queryByText('−8 mi')).toBeNull();
});

test('today uses a compact yellow pin without nesting another filled cell', () => {
  render(
    <ThemeProvider preference="light">
      <CalendarCell dom={24} miles={0} isToday />
    </ThemeProvider>,
  );

  expect(StyleSheet.flatten(screen.getByTestId('daycell-today-badge').props.style)?.backgroundColor)
    .toBeUndefined();
  expect(StyleSheet.flatten(screen.getByText('24').props.style)?.color)
    .toBe(THEMES.light.ink);
  const indicator = StyleSheet.flatten(screen.getByTestId('daycell-today-indicator').props.style);
  expect(indicator?.backgroundColor).toBe(THEMES.light.yellow);
  expect(indicator?.borderColor).toBe(THEMES.light.yellowText);
  expect(indicator?.width).toBe(8);
  expect(indicator?.borderWidth).toBe(StyleSheet.hairlineWidth);
});

test('workout type marks are inset top notches and do not change number alignment', () => {
  render(
    <ThemeProvider preference="dark">
      <CalendarCell dom={24} miles={6} actual marks={[{ color: THEMES.dark.qualText }]} />
    </ThemeProvider>,
  );

  const lane = StyleSheet.flatten(screen.getByTestId('daycell-marks-lane').props.style);
  expect(lane?.position).toBe('absolute');
  expect(lane?.top).toBe(1);
  expect(StyleSheet.flatten(screen.getByText('24').props.style)?.marginTop).toBeUndefined();
});

test('accessibility-size calendar cells preserve selection while deferring detail to the spoken label', () => {
  render(
    <ThemeProvider preference="dark">
      <CalendarCell
        dom={24}
        miles={6}
        actual={false}
        simplified
        selected
        accessibilityLabel="Wednesday, June 24. 6 miles planned"
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('24')).toBeTruthy();
  expect(screen.queryByText('6mi')).toBeNull();
  expect(screen.getByLabelText(/6 miles planned/)).toBeTruthy();
});

test('completed day with 2 activities renders 2 picker rows (labels + distances), no CTA', () => {
  renderCompletedToday([
    mkAct('a-am', 6 * MI, '2026-06-24T13:00:00Z', null),   // 13-4=9h → Morning
    mkAct('a-pm', 4 * MI, '2026-06-24T21:00:00Z', true),   // 21-4=17h → Evening, Quality
  ]);

  // The single CTA is gone.
  expect(screen.queryByText('View workout')).toBeNull();

  // Two rows: time-of-day labels + distances. (The intrinsic hint is asserted
  // via each row's a11y label below — "Quality"/"Easy" also appear on the gauge
  // pillar / header type line, so bare-text lookups would be ambiguous.)
  expect(screen.getByText('Morning')).toBeTruthy();
  expect(screen.getByText('Evening')).toBeTruthy();
  // Distances are asserted via each row's a11y label below (the "6.0" digits
  // sit in a nested Text alongside the " mi" unit, so a bare-text lookup misses).
  // AM row is a pending-verdict "Run"; PM row is "Quality".
  expect(screen.getByRole('link', { name: /Open Morning run, 6\.0 miles, Run/i })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Open Evening run, 4\.0 miles, Quality/i })).toBeTruthy();

  // Historical records live on the card plane; they have no permanent button fill.
  const morningRow = StyleSheet.flatten(screen.getByTestId('day-activity-row-a-am').props.style);
  expect(morningRow?.backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(screen.getByTestId('day-activity-hint-a-am').props.style)?.color)
    .toBe(THEMES.dark.mute);
  expect(StyleSheet.flatten(screen.getByTestId('day-activity-hint-a-pm').props.style)?.color)
    .toBe(THEMES.dark.qualText);
});

test('tapping an activity row opens THAT run detail (/run/[id]) with its id', async () => {
  mockPush.mockClear();
  renderCompletedToday([
    mkAct('a-am', 6 * MI, '2026-06-24T13:00:00Z', null),
    mkAct('a-pm', 4 * MI, '2026-06-24T21:00:00Z', true),
  ]);

  const row2 = screen.getByRole('link', { name: /Open Evening run, 4\.0 miles, Quality/i });
  await act(async () => {
    fireEvent.press(row2);
  });
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/run/[id]', params: { id: 'a-pm' } });

  const row1 = screen.getByRole('link', { name: /Open Morning run, 6\.0 miles, Run/i });
  await act(async () => {
    fireEvent.press(row1);
  });
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/run/[id]', params: { id: 'a-am' } });
});

test('completed day with a single activity renders exactly one row (replaces the CTA)', () => {
  renderCompletedToday([mkAct('a-solo', 8 * MI, '2026-06-24T13:00:00Z', false)]);

  expect(screen.queryByText('View workout')).toBeNull();
  expect(screen.getByText('Morning')).toBeTruthy();
  // Exactly one openable activity row; qualityDetected === false → "Easy" hint.
  const rows = screen.getAllByRole('link', { name: /Open .* run, .* miles/i });
  expect(rows).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Open Morning run, 8\.0 miles, Easy/i })).toBeTruthy();
});

test('a NOT-completed workout day uses the card itself as its only open affordance', () => {
  // Default week: today (Wed) is today-pending with NO activities.
  renderCalendarTabs();
  expect(screen.queryByText('View workout')).toBeNull();
  expect(screen.getByRole('link', { name: /Open Threshold Repeats details/i })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Open .* run, .* miles/i })).toBeNull();
});

describe('dayMarks — a CLOSED day reads what RAN, an open day reads the plan', () => {
  const C = { cyanText: '#45C0E6', qualText: '#B08AD9', ink: '#FFFFFF', faint: '#777777' } as unknown as import('@/theme/tokens').Tokens;
  const closed = { closed: true, ranSomething: true } as const;
  const w = (tone: 'easy' | 'quality' | 'long') => makePrimary({ tone });

  it('planned easy but ran quality → quality pip (not the planned easy)', () => {
    expect(dayMarks(C, [w('easy')], { ...closed, ranQuality: true })).toEqual([{ color: '#B08AD9' }]);
  });
  it('planned quality but ran easy → easy pip', () => {
    expect(dayMarks(C, [w('quality')], { ...closed, ranQuality: false })).toEqual([{ color: '#777777' }]);
  });
  it('completed long run (no quality) keeps its long pip (blue)', () => {
    expect(dayMarks(C, [w('long')], { ...closed, ranQuality: false })).toEqual([{ color: '#45C0E6' }]);
  });
  it('long run that banks quality → long+quality split', () => {
    expect(dayMarks(C, [w('long')], { ...closed, ranQuality: true })).toEqual([{ color: '#45C0E6', split: '#B08AD9' }]);
  });
  it('an OPEN (upcoming) day still shows the PLANNED tone', () => {
    expect(dayMarks(C, [w('quality')], { closed: false, ranSomething: false, ranQuality: false })).toEqual([{ color: '#B08AD9' }]);
  });
});

// ── day cell: sums every run + tints by the most significant run ─────────────

/** Resolve the flattened `color` from a Text node's style array. */
function styleColor(node: { props: Record<string, unknown> }): string | undefined {
  const s = node.props.style;
  const flat = Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s;
  return (flat as { color?: string } | undefined)?.color;
}

/** Flattened backgroundColor of a mark View's style array. */
function markColor(node: { props: Record<string, unknown> }): string | undefined {
  const s = node.props.style;
  const flat = Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s;
  return (flat as { backgroundColor?: string } | undefined)?.backgroundColor;
}

test('a day cell sums every run; type lives in neutral-number + colour marks', () => {
  const longRun = makePrimary({ id: 'wo-long', type: 'long', tone: 'long', title: 'Long Run', plannedMeters: 18 * METERS_PER_MILE });
  const easyShake = makePrimary({ id: 'wo-shake', type: 'easy', tone: 'easy', title: 'Shakeout', plannedMeters: 4 * METERS_PER_MILE });
  const quality = makePrimary({ id: 'wo-q', type: 'threshold', isQuality: true, tone: 'quality', title: 'Threshold', plannedMeters: 10 * METERS_PER_MILE });
  const easyPm = makePrimary({ id: 'wo-pm', type: 'easy', tone: 'easy', title: 'PM Easy', plannedMeters: 3 * METERS_PER_MILE });

  const week: CalendarDay[] = [
    // Mon: long + easy → 22 mi total, tinted LONG (cyan) over easy.
    makeDay('2026-06-22', 0, 'M', { primary: longRun, workouts: [longRun, easyShake] }),
    // Tue (today): quality + easy → 13 mi total, tinted QUALITY (pink) over easy.
    makeDay('2026-06-23', 1, 'T', { isToday: true, state: 'today-pending', primary: quality, workouts: [quality, easyPm] }),
    makeDay('2026-06-24', 2, 'W'),
    makeDay('2026-06-25', 3, 'T'),
    makeDay('2026-06-26', 4, 'F'),
    makeDay('2026-06-27', 5, 'S'),
    makeDay('2026-06-28', 6, 'S', { state: 'rest' }),
  ];
  const wkFor = (anchor: string) =>
    anchor === WEEK_START ? week : Array.from({ length: 7 }, (_, i) => makeDay(addDays(anchor, i), i, 'MTWTFSS'[i] ?? 'M'));

  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={week}
        weekDaysFor={wkFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
      />
    </ThemeProvider>,
  );

  // The number is now NEUTRAL (pure magnitude) — type moved off it into marks.
  // Colours referenced via THEMES.dark so a palette retune doesn't break this
  // test (it asserts ROLES: planned number = mute; long → cyan, quality → qual).
  const monday = screen.getByText('22mi');
  expect(styleColor(monday)).toBe(THEMES.dark.mute);
  const tuesday = screen.getByText('13mi');
  expect(styleColor(tuesday)).toBe(THEMES.dark.mute);

  // Both are doubles → two distinct type marks each. The colours (long-cyan +
  // easy on Mon, quality-violet + easy on Tue) live in the marks lane, not the number.
  const markColors = screen.getAllByTestId('daycell-mark').map(markColor);
  expect(markColors).toContain(THEMES.dark.cyanText); // long (Mon)
  expect(markColors).toContain(THEMES.dark.qualText); // quality (Tue) — violet
  expect(markColors).not.toContain(THEMES.dark.faint); // easy is the unmarked default
});

test('the week strip uses number tone for banked mileage and reserves marks for type', () => {
  render(
    <ThemeProvider preference="dark">
      <>
        <CalendarCell dom={22} miles={7} actual marks={[{ color: THEMES.dark.ink }]} />
        <CalendarCell dom={27} miles={18} actual={false} marks={[{ color: THEMES.dark.cyanText }]} />
      </>
    </ThemeProvider>,
  );

  expect(styleColor(screen.getByText('7mi'))).toBe(THEMES.dark.ink);
  expect(styleColor(screen.getByText('18mi'))).toBe(THEMES.dark.mute);
  expect(screen.queryByTestId('daycell-completed')).toBeNull();
  expect(screen.getAllByTestId('daycell-mark')).toHaveLength(2);
});

test('open quality mileage stays independent from the mileage pace verdict', () => {
  const quality = makePrimary({
    id: 'wo-monday-quality',
    type: 'threshold',
    title: 'Monday Threshold',
    isQuality: true,
    tone: 'quality',
    plannedMeters: 6 * METERS_PER_MILE,
    structure: [
      { kind: 'work', target: { by: 'distance', distance_m: 3 * METERS_PER_MILE, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
    ],
  });
  const week = Array.from({ length: 7 }, (_, i) =>
    makeDay(addDays(WEEK_START, i), i, 'MTWTFSS'[i] ?? 'M', {
      isToday: i === 2,
      state: i === 0 ? 'missed' : i < 2 ? 'done' : i === 2 ? 'today-pending' : 'upcoming',
      primary: i === 0 ? quality : null,
      workouts: i === 0 ? [quality] : [],
    }),
  );
  const goals: WeekGoal[] = [{
    weekIndex: 0,
    weekStart: WEEK_START,
    label: 'W1',
    isCurrent: true,
    isFuture: false,
    mileage: { actualMeters: 10 * MI, targetMeters: 40 * MI, hit: false, fraction: 0.25 },
    quality: { actualMeters: 0, targetMeters: 3 * MI, hit: false, fraction: 0 },
    long: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
    allMet: false,
  }];

  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={week}
        weekDaysFor={() => week}
        currentWeekStart={WEEK_START}
        currentWeekNumber={1}
        planWeeks={1}
        easyBaseline={480}
        weekGoals={goals}
        weekDeficitMeters={0}
      />
    </ThemeProvider>,
  );

  expect(screen.queryByText('On mileage pace')).toBeNull();
  expect(screen.getByText('5 days left')).toBeTruthy();
  expect(screen.queryByTestId('week-contract-status-mark')).toBeNull();
  expect(screen.getByText('3.0 mi left')).toBeTruthy();
  expect(screen.queryByText(/unallocated/i)).toBeNull();
});

test('the calendar handle toggles the anchored inline month', () => {
  mockPush.mockClear();
  const ref = React.createRef<CalendarTabsHandle>();
  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        ref={ref}
        initialWeekDays={makeWeek()}
        weekDaysFor={weekDaysFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
      />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('calendar-hinge').props.accessibilityState?.expanded).toBe(false);
  act(() => ref.current?.openCalendar());
  expect(screen.getByTestId('calendar-hinge').props.accessibilityState?.expanded).toBe(true);
  expect(mockPush).not.toHaveBeenCalled();
});

test('a date returned by the month navigator selects that date and its week', () => {
  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={makeWeek()}
        weekDaysFor={weekDaysFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
        focusDate="2026-06-27"
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Long Run')).toBeTruthy();
  expect(screen.getAllByRole('tab', { name: /Saturday, 2026-06-27/i, selected: true }).length).toBeGreaterThan(0);
});

test('swiping to another week preserves the selected weekday', () => {
  renderCalendarTabs();
  fireEvent(screen.getByTestId('calendar-month'), 'layout', {
    nativeEvent: { layout: { width: 350, height: 52, x: 0, y: 0 } },
  });
  const pager = screen.UNSAFE_getAllByType(ScrollView).find(
    (node) => node.props.horizontal && node.props.scrollEnabled !== false,
  );
  expect(pager).toBeTruthy();

  // Current plan page is 6 (week 7); page 7 is the next week. Wednesday should
  // remain selected, so the panel and strip advance together to July 1.
  fireEvent(pager!, 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 7 * 350, y: 0 } },
  });
  expect(screen.getAllByRole('tab', { name: /Wednesday, 2026-07-01/i, selected: true }).length).toBeGreaterThan(0);
});

test('reports the centred week label + offToday via onStateChange', () => {
  const onStateChange = jest.fn();
  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={makeWeek()}
        weekDaysFor={weekDaysFor}
        currentWeekStart={WEEK_START}
        currentWeekNumber={7}
        planWeeks={23}
        easyBaseline={480}
        weekGoals={[]}
        onStateChange={onStateChange}
      />
    </ThemeProvider>,
  );
  // Today is week 7 of the 23-week plan, and we open on it. With no weekGoals the
  // browsed period banks nothing, and collapsed the slice is labelled "This week".
  expect(onStateChange).toHaveBeenCalledWith({
    weekLabel: 'Week 7/23 \u00b7 Jun 22\u201328',
    monthLabel: 'June 2026',
    offToday: false,
    periodBankedMeters: 0,
    periodLabel: 'This week',
    calendarExpanded: false,
  });
});

// \u2500\u2500 arrival staging is scoped to the LIVE week \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// The "just banked run" arrival animation holds the pre-run value and releases
// to the true one so new miles read as arriving. That staging is only honest
// for the week the run actually landed in \u2014 forwarding it while browsing a
// PAST (or future) week would animate miles filling a week that never had
// them, a wrong-number bug on a surface whose whole premise is a true number.
// CalendarTabs gates this with `period === 'current' ? arrivalMeters : null`;
// these tests pin that gate so it can't silently regress.

// `WeekGauges` is `memo(WeekGaugesInner)`; react-test-renderer's instance tree
// collapses the memo wrapper away and exposes the inner render function as the
// node type, so `UNSAFE_getByType(WeekGauges)` finds nothing. Unwrap to the
// memoized inner component (`.type`) to locate the actual instance and read
// the `arrivalMeters` prop CalendarTabs passed it.
const WeekGaugesInner = (WeekGauges as unknown as { type: React.ComponentType<{ arrivalMeters?: number | null }> }).type;

test('the live (current) week receives the supplied arrivalMeters', () => {
  renderCalendarTabsAt({ arrivalMeters: 2000 });
  const gauges = screen.UNSAFE_getByType(WeekGaugesInner);
  expect(gauges.props.arrivalMeters).toBe(2000);
});

test('browsing to a PAST week nulls arrivalMeters \u2014 it must never fake-animate a historical week filling up', () => {
  // '2026-06-15' is the Monday one week before WEEK_START, so this focusDate
  // lands the browsed week one week earlier than today's, and period resolves
  // to 'past'.
  renderCalendarTabsAt({ focusDate: '2026-06-15', arrivalMeters: 2000 });
  const gauges = screen.UNSAFE_getByType(WeekGaugesInner);
  expect(gauges.props.arrivalMeters).toBeNull();
});

test('browsing to a FUTURE week also nulls arrivalMeters \u2014 the arrival belongs to the week it landed in, not one that has not happened yet', () => {
  // '2026-06-29' is the Monday of the week after WEEK_START.
  renderCalendarTabsAt({ focusDate: '2026-06-29', arrivalMeters: 2000 });
  const gauges = screen.UNSAFE_getByType(WeekGaugesInner);
  expect(gauges.props.arrivalMeters).toBeNull();
});

// ── Over-allocated week ──────────────────────────────────────────────────────
// The mirror of "N mi unallocated": earlier days ran long, so the workouts still
// on the calendar add up to MORE than the contract needs. Nothing is wrong, so
// this must never wear the deficit's orange — but the plan and the contract now
// disagree, and only the runner can decide which one gives.

function renderWeekWithSurplus(surplusMeters: number) {
  const week = Array.from({ length: 7 }, (_, i) =>
    makeDay(addDays(WEEK_START, i), i, 'MTWTFSS'[i] ?? 'M', {
      isToday: i === 2,
      state: i < 2 ? 'done' : i === 2 ? 'today-pending' : 'upcoming',
      workouts: [],
    }),
  );
  const goals: WeekGoal[] = [{
    weekIndex: 0,
    weekStart: WEEK_START,
    label: 'W1',
    isCurrent: true,
    isFuture: false,
    mileage: { actualMeters: 41.1 * MI, targetMeters: 70 * MI, hit: false, fraction: 0.587 },
    quality: { actualMeters: 4 * MI, targetMeters: 6 * MI, hit: false, fraction: 0.67 },
    long: { actualMeters: 16.8 * MI, targetMeters: 16 * MI, hit: true, fraction: 1 },
    allMet: false,
  }];
  return render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={week}
        weekDaysFor={() => week}
        currentWeekStart={WEEK_START}
        currentWeekNumber={1}
        planWeeks={1}
        easyBaseline={480}
        weekGoals={goals}
        weekDeficitMeters={0}
        weekSurplusMeters={surplusMeters}
        onEditWeek={jest.fn()}
      />
    </ThemeProvider>,
  );
}

test('an over-allocated week invites a plan trim, in green rather than the deficit orange', () => {
  renderWeekWithSurplus(3.1 * MI);

  expect(screen.getByText('3.1 mi over contract')).toBeTruthy();
  expect(screen.getByText('5 days left')).toBeTruthy();

  // Green, NOT the `behind` orange: being ahead of the plan is not a warning.
  const action = screen.getByText('Reduce');
  expect(styleColor(action)).toBe(THEMES.dark.positiveText);
  expect(styleColor(action)).not.toBe(THEMES.dark.warningText);

  // It states a verdict, so it earns the mark — and the mark is the positive one.
  expect(screen.getByTestId('week-contract-status-mark-positive')).toBeTruthy();
});

test('an overage under a mile stays quiet', () => {
  renderWeekWithSurplus(0.9 * MI);

  expect(screen.queryByText(/over contract/i)).toBeNull();
  expect(screen.queryByText('Reduce')).toBeNull();
  // Falls back to the quiet on-pace row, which has no verdict mark.
  expect(screen.getByText('5 days left')).toBeTruthy();
  expect(screen.queryByTestId('week-contract-status-mark')).toBeNull();
});

test('a behind week still outranks a surplus and keeps its orange', () => {
  const view = renderWeekWithSurplus(0);
  view.unmount();

  const week = Array.from({ length: 7 }, (_, i) =>
    makeDay(addDays(WEEK_START, i), i, 'MTWTFSS'[i] ?? 'M', {
      isToday: i === 2,
      state: i < 2 ? 'done' : i === 2 ? 'today-pending' : 'upcoming',
      workouts: [],
    }),
  );
  const goals: WeekGoal[] = [{
    weekIndex: 0,
    weekStart: WEEK_START,
    label: 'W1',
    isCurrent: true,
    isFuture: false,
    mileage: { actualMeters: 10 * MI, targetMeters: 40 * MI, hit: false, fraction: 0.25 },
    quality: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
    long: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
    allMet: false,
  }];
  render(
    <ThemeProvider preference="dark">
      <CalendarTabs
        initialWeekDays={week}
        weekDaysFor={() => week}
        currentWeekStart={WEEK_START}
        currentWeekNumber={1}
        planWeeks={1}
        easyBaseline={480}
        weekGoals={goals}
        weekDeficitMeters={5 * MI}
        weekSurplusMeters={3 * MI}
        onEditWeek={jest.fn()}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('5 mi unallocated')).toBeTruthy();
  expect(screen.queryByText(/over contract/i)).toBeNull();
  expect(styleColor(screen.getByText('Adjust'))).toBe(THEMES.dark.warningText);
});
