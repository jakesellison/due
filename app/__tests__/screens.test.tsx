/**
 * Render smoke tests for the Plan screen + the workout detail,
 * under the `app` Jest project (jest-expo). The data hooks and the router are
 * mocked so these confirm the screens render from a realistic derived view
 * without touching Supabase or navigation.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

/**
 * All pressable instances that carry an onPress, deduped to the innermost node
 * in each chain. DayRow and PressableScale both receive/forward onPress (and
 * the row's height style) down to a single underlying Pressable, so without
 * deduping one tappable row would match two or three times up the chain — we
 * keep the innermost (the real Pressable) and drop its onPress-bearing
 * ancestors.
 */
function pressables(tree: ReactTestRenderer) {
  const all = tree.root.findAll((n) => typeof n.props?.onPress === 'function');
  const set = new Set(all);
  return all.filter((n) => !n.findAll((c) => c !== n && set.has(c)).length);
}

/** Flatten nested string/number children to a single string. */
function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

/** Flatten a (possibly nested/array) RN style prop into one object. */
function flattenStyle(style: unknown): Record<string, unknown> | undefined {
  if (style == null) return undefined;
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>((acc, s) => ({ ...acc, ...(flattenStyle(s) ?? {}) }), {});
  }
  if (typeof style === 'function') return flattenStyle((style as (a: { pressed: boolean }) => unknown)({ pressed: false }));
  if (typeof style === 'object') return style as Record<string, unknown>;
  return undefined;
}
import { screenWrapper } from '@/app-lib/__testsupport__/render';

import type { ActivityDetail, ActivityRow, PlanView, RacePredictionView, WeekDetail, WorkoutDetail } from '@/app-lib/queries';
import { goalStat, summarizeBlock, type WeekGoal } from '@/lib';

// ---- Mocks -----------------------------------------------------------------

// The insight charts use victory-native's CartesianChart (Skia + gestures) and
// reanimated; stub both so the screen renders headlessly (Skia itself is mocked
// globally via the project's setupFiles). PressableScale (via the day rows and
// primary buttons) needs createAnimatedComponent + the timing/style hooks too.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const layoutAnimation = {
    duration: () => layoutAnimation,
    easing: () => layoutAnimation,
    reduceMotion: () => layoutAnimation,
  };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useAnimatedReaction: () => undefined,
    useEvent: () => () => undefined,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false }),
    runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => false,
    LinearTransition: layoutAnimation,
    FadeInUp: layoutAnimation,
    FadeOutUp: layoutAnimation,
    ReduceMotion: { System: 'system' },
    Easing: { bezier: () => (t: number) => t, out: (fn: (t: number) => number) => fn, cubic: (t: number) => t, quad: (t: number) => t },
    withTiming: (v: unknown) => v,
  };
});

jest.mock('victory-native', () => {
  const React = require('react');
  return {
    CartesianChart: ({ children }: { children: (a: unknown) => React.ReactNode }) =>
      React.createElement(
        React.Fragment,
        null,
        children({
          chartBounds: { left: 0, right: 300, top: 0, bottom: 130 },
          xScale: () => 0,
          yScale: () => 0,
          points: { v: [] },
        }),
      ),
    useChartPressState: () => ({
      state: {
        isActive: { value: false },
        matchedIndex: { value: -1 },
        x: { value: { value: 0 }, position: { value: 0 } },
        y: { v: { value: { value: 0 }, position: { value: 0 } } },
        yIndex: { value: 0 },
      },
      isActive: false,
    }),
  };
});

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

jest.mock('@/app-lib/routes', () => ({
  useWorkoutRoute: () => ({ data: null, isLoading: false, error: null, refetch: jest.fn() }),
  useWorkoutRouteIds: () => ({ data: new Set<string>(), isLoading: false, error: null }),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
const mockScreenRouteParams: { value: Record<string, string | undefined> } = { value: { id: 'w-quality' } };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: mockReplace, setParams: mockSetParams }),
  useLocalSearchParams: () => mockScreenRouteParams.value,
}));

const mockPlanView: { value: PlanView } = { value: undefined as unknown as PlanView };
const mockPredictionView: { value: RacePredictionView } = { value: undefined as unknown as RacePredictionView };
const mockWeeklyMileage: { value: { weekGoals: WeekGoal[]; loading: boolean; error: Error | null } } = {
  value: { weekGoals: [], loading: false, error: null },
};
const mockDetail: { value: WorkoutDetail } = { value: undefined as unknown as WorkoutDetail };
const mockWeek: { value: WeekDetail } = { value: undefined as unknown as WeekDetail };
const mockActivity: { value: ActivityDetail } = { value: undefined as unknown as ActivityDetail };
const mockInvalidateCaches = jest.fn(async (..._args: unknown[]) => undefined);
const mockMyPlansRefetch = jest.fn();
const mockMyPlans: {
  value: { data: unknown[]; isLoading: boolean; error: Error | null; refetch: typeof mockMyPlansRefetch };
} = {
  value: {
    data: [{ id: 'p1', raceName: 'Chicago 2026', goalTime: '2:36', numWeeks: 18, status: 'active' }],
    isLoading: false,
    error: null,
    refetch: mockMyPlansRefetch,
  },
};

jest.mock('@/app-lib/queries', () => ({
  usePlanView: () => mockPlanView.value,
  usePlanChangeLog: () => ({ events: [], isLoading: false }),
  useWeeklyMileage: () => mockWeeklyMileage.value,
  useRacePrediction: () => mockPredictionView.value,
  useWorkoutDetail: () => mockDetail.value,
  useWeek: () => mockWeek.value,
  useActivity: () => mockActivity.value,
  useMyPlans: () => mockMyPlans.value,
  invalidatePlanActivityCaches: (...args: unknown[]) => mockInvalidateCaches(...args),
  switchActivePlan: jest.fn(async () => undefined),
  useActivePlan: () => ({ data: null, isLoading: false }),
  useActivities: () => ({ data: [], isLoading: false }),
  useShoes: () => ({ data: [], isLoading: false }),
  assignShoeToActivity: jest.fn(async () => undefined),
  useSetQualityOverride: () => ({ mutate: jest.fn() }),
  // Lightweight stand-in: the screens read `raceName`/`raceLine` from this.
  planHeaderInfo: (plan: { race_name?: string | null; goal_time?: string | null } | null) => {
    if (!plan) {
      return { raceName: '—', goalTime: null, raceLine: '—', weekN: null, numWeeks: null, phaseLabel: null, daysToRace: null };
    }
    const raceName = plan.race_name ?? 'Training block';
    const raceLine = plan.goal_time ? `${raceName}  2:36` : raceName;
    return { raceName, goalTime: plan.goal_time ? '2:36' : null, raceLine, weekN: null, numWeeks: null, phaseLabel: null, daysToRace: null };
  },
  // The Plan/Trends screen subtitle composer — stand-in that mirrors the real
  // priority-drop just enough for the smoke tests (race + goal).
  planCaption: (h: { raceName?: string | null; goalTime?: string | null }) => {
    const race = h.raceName && h.raceName !== '—' ? h.raceName : 'Training block';
    return h.goalTime ? `${race}  ${h.goalTime}` : race;
  },
}));

jest.mock('@/app-lib/weekEdit', () => ({
  saveWeekEdits: jest.fn(async () => undefined),
}));

// SessionView's recovery door reads the adapt engine's entry condition. Mocked
// alongside the queries layer for the same reason: the real module imports
// Supabase at load. Empty proposals → the door falls back to the week planner.
jest.mock('@/app-lib/adapt', () => ({
  useAdaptations: () => ({ loading: false, error: null, planId: null, weekId: null, adaptations: [] }),
}));

jest.mock('@/app-lib/qualityCredit', () => ({
  computeEasyBaselineSecPerMi: () => 495,
  useActivityQualityDetect: () => ({ loading: false, qualityDetected: false, detectResult: null, overridden: false, matchNote: null }),
  useSetQualityOverride: () => jest.fn(async () => undefined),
  useWeekQualityDetect: () => ({ loading: false, qualityDetected: false, bestActivityId: null, detectResult: null, matchNote: null, easyBaselineSecPerMi: 495 }),
  setQualityOverride: jest.fn(async () => undefined),
  getQualityOverride: jest.fn(async () => false),
  readQualityOverrides: jest.fn(async () => new Set()),
  detectWeekQuality: () => ({ qualityDetected: false, bestActivityId: null, detectResult: null, matchNote: null }),
  FALLBACK_EASY_BASELINE_SEC_PER_MI: 495,
}));

// Imported AFTER the mocks are registered.
import PlanScreen from '../(tabs)/plan';
import WorkoutDetailScreen from '../workout/[id]';
import WeekDetailScreen from '../week/[id]';
import ActivityDetailScreen from '../run/[id]';

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockSetParams.mockClear();
  mockScreenRouteParams.value = { id: 'w-quality' };
  mockInvalidateCaches.mockClear();
  mockMyPlansRefetch.mockClear();
  mockMyPlans.value = {
    data: [{ id: 'p1', raceName: 'Chicago 2026', goalTime: '2:36', numWeeks: 18, status: 'active' }],
    isLoading: false,
    error: null,
    refetch: mockMyPlansRefetch,
  };
  mockWeeklyMileage.value = { weekGoals: progressGoals, loading: false, error: null };
});

// ---- Fixtures --------------------------------------------------------------

const weeks = [
  { weekIndex: 1, phase: 'base' as const, weekStart: '2026-05-04', targetMeters: 64000, isRecovery: false },
  { weekIndex: 2, phase: 'build' as const, weekStart: '2026-05-11', targetMeters: 80000, isRecovery: false },
  { weekIndex: 3, phase: 'peak' as const, weekStart: '2026-05-18', targetMeters: 96000, isRecovery: false },
];
const activities = [
  { localDate: '2026-05-05', distanceMeters: 12000 },
  { localDate: '2026-05-12', distanceMeters: 80000 },
];
const block = summarizeBlock(weeks, [{ date: '2026-05-12', isQuality: true }], activities, '2026-05-18');

/**
 * A current-week bar for week 1 — the Plan screen now only renders a full
 * day-row card for the CURRENT week (past weeks collapse to compact History
 * rows), so the day-row anatomy/nav tests pin week 1 as current.
 */
const currentBarWk1 = { ...block.weeks[0]!, isCurrent: true, isFuture: false };

const plan = {
  id: 'p1',
  race_name: 'Chicago 2026',
  race_date: '2026-10-11',
  distance_kind: 'marathon',
  start_date: '2026-05-04',
  num_weeks: 18,
  status: 'active',
  goal_time: '02:36:00',
};

const qualityWorkout = {
  id: 'w-quality',
  week_id: 'wk2',
  date: '2026-05-12',
  type: 'quality',
  title: '4 × 1mi @ threshold',
  planned_distance_meters: 12800,
  planned_duration_s: null,
  is_quality: true,
  notes: 'Hold the last rep.',
  structure: [
    { kind: 'warmup' as const, target: { by: 'distance' as const, distance_m: 2400 } },
    {
      kind: 'repeat' as const,
      sets: 4,
      children: [
        { kind: 'interval' as const, target: { by: 'distance' as const, distance_m: 1600 }, note: 'threshold' },
        { kind: 'recovery' as const, target: { by: 'time' as const, duration_s: 90 } },
      ],
    },
    { kind: 'cooldown' as const, target: { by: 'distance' as const, distance_m: 1600 } },
  ],
};

const easyWorkout = {
  id: 'w-easy',
  week_id: 'wk1',
  date: '2026-05-05',
  type: 'easy',
  title: 'Easy run',
  planned_distance_meters: 10000,
  planned_duration_s: null,
  is_quality: false,
  notes: null,
  structure: [],
};

function liveProjectionDays() {
  const mi = (value: number) => Math.round(value * 1609.344);
  const row = (
    id: string,
    date: string,
    plannedMi: number,
    actualMi: number | null,
    isPast: boolean,
    type = 'easy',
  ) => ({
    workout: {
      ...easyWorkout,
      id,
      date,
      type,
      title: type === 'long' ? 'Long run' : 'Easy run',
      planned_distance_meters: mi(plannedMi),
    },
    actual: actualMi == null
      ? null
      : { distanceMeters: mi(actualMi), movingTimeS: null, avgHr: null },
    isPast,
    isMissed: isPast && actualMi == null,
  });
  return [
    row('mon', '2026-07-20', 16, 12, true),
    row('mon-double', '2026-07-20', 7, null, true),
    row('tue', '2026-07-21', 14, 17.1, true),
    row('wed', '2026-07-22', 18, 18, true),
    row('thu', '2026-07-23', 16, null, false),
    row('fri', '2026-07-24', 15, null, false),
    row('sat', '2026-07-25', 22, null, false, 'long'),
  ];
}

function renderTree(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(screenWrapper(node));
  });
  return tree!;
}

function renderOk(node: React.ReactElement) {
  let tree: ReactTestRenderer | undefined;
  expect(() => {
    tree = renderTree(node);
  }).not.toThrow();
  act(() => {
    tree?.unmount();
  });
}

// ---- Plan ------------------------------------------------------------------

describe('PlanScreen', () => {
  test('uses a structural skeleton while the active plan is loading', () => {
    mockPlanView.value = {
      loading: true,
      error: null,
      plan: null,
      today: '2026-05-18',
      currentIndex: -1,
      sections: [],
    };

    const tree = renderTree(<PlanScreen />);
    expect(tree.root.findByProps({ testID: 'plan-loading-skeleton' })).toBeDefined();
    expect(tree.root.findByProps({ accessibilityLabel: 'Loading your plan' })).toBeDefined();
    act(() => tree.unmount());
  });

  test('a Week-tab block link selects that plan week and returns to the active profile', () => {
    mockScreenRouteParams.value = { week: '6' };
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 2,
      sections: [
        {
          weekId: 'wk3',
          weekIndex: 3,
          weekStart: '2026-05-18',
          bar: block.weeks[2]!,
          days: [],
          unplanned: [],
        },
        {
          weekId: 'wk-future',
          weekIndex: 6,
          weekStart: '2026-06-08',
          bar: {
            weekIndex: 6,
            phase: 'build' as const,
            targetMeters: 103000,
            actualMeters: 0,
            band: 'green' as const,
            paceBand: 'green' as const,
            isRecovery: true,
            isCurrent: false,
            isFuture: true,
          },
          days: [],
          unplanned: [],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const text = tree.root.findAllByType(Text).map((node) => flattenText(node.props.children));
    expect(text).toContain('Jun 8–14');
    expect(text).toContain('Recovery · miles open');
    expect(mockSetParams).toHaveBeenCalledWith({ week: undefined });
    act(() => tree.unmount());
  });

  test('renders week sections with day rows', () => {
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 2,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: block.weeks[0]!,
          days: [
            { workout: easyWorkout, actual: { distanceMeters: 12000, movingTimeS: 3600, avgHr: 140 }, isPast: true, isMissed: false },
            { workout: qualityWorkout, actual: null, isPast: true, isMissed: true },
          ],
          unplanned: [],
        },
        {
          weekId: 'wk3',
          weekIndex: 3,
          weekStart: '2026-05-18',
          bar: block.weeks[2]!,
          days: [],
          unplanned: [],
        },
        // A future week with no workouts -> renders the collapsed compact row.
        {
          weekId: 'wk-future',
          weekIndex: 6,
          weekStart: '2026-06-08',
          bar: {
            weekIndex: 6,
            phase: 'build' as const,
            targetMeters: 103000,
            actualMeters: 0,
            band: 'green' as const,
            paceBand: 'green' as const,
            isRecovery: true,
            isCurrent: false,
            isFuture: true,
          },
          days: [],
          unplanned: [],
        },
      ],
    };
    renderOk(<PlanScreen />);
  });

  test('empty state opens the plan installer', () => {
    mockPlanView.value = {
      loading: false,
      error: null,
      plan: null,
      today: '2026-05-18',
      currentIndex: -1,
      sections: [],
    };
    const tree = renderTree(<PlanScreen />);
    const install = pressables(tree).find((n) =>
      n.findAllByType(Text).some((c) => flattenText(c.props.children) === 'Import plan'),
    );
    expect(install).toBeDefined();
    act(() => {
      install!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/plans/install');
    act(() => tree.unmount());
  });

  test('selected week stays strategic and leaves workout detail to the week drill', () => {
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 0,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: currentBarWk1,
          days: [
            { workout: easyWorkout, actual: { distanceMeters: 12000, movingTimeS: 3600, avgHr: 140 }, isPast: true, isMissed: false },
            { workout: qualityWorkout, actual: null, isPast: true, isMissed: true },
          ],
          unplanned: [],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);

    const textContents = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
    expect(textContents).toContain('Training blocks');
    expect(textContents).toContain('Weekly contract');
    expect(textContents).toContain('Quality');
    expect(textContents).toContain('Long run');
    expect(textContents).toContain('Miles open');
    expect(textContents.some((t) => t.includes('4×1mi @ threshold'))).toBe(false);
    expect(textContents.some((t) => t.includes('assigned'))).toBe(false);

    act(() => {
      tree.unmount();
    });
  });

  test('selected execution is labeled without adding a verdict to the strategic plan surface', () => {
    // planned 7.1 mi, actual 9.8 mi (chosen to format cleanly).
    const plannedMeters = Math.round(7.1 * 1609.344);
    const actualMeters = Math.round(9.8 * 1609.344);
    const longRun = { ...easyWorkout, id: 'w-long', title: 'Long run', planned_distance_meters: plannedMeters };
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 0,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: currentBarWk1,
          days: [
            { workout: longRun, actual: { distanceMeters: actualMeters, movingTimeS: 3600, avgHr: 140 }, isPast: true, isMissed: false },
          ],
          unplanned: [],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const all = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
    const joined = all.join('|');

    const [profileSummary] = tree.root.findAllByProps({ testID: 'plan-blueprint-summary' });
    expect(profileSummary?.props.accessibilityLabel).toContain('7.5 of 39.8 plan miles banked');
    expect(joined).toContain('Banked in this plan');
    expect(joined.includes('✓')).toBe(false);
    expect(joined).toContain('Weekly contract');

    act(() => tree.unmount());
  });

  test('unplanned daily mileage stays out of the block-level intent dossier', () => {
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 0,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: currentBarWk1,
          days: [
            { workout: easyWorkout, actual: { distanceMeters: 12000, movingTimeS: 3600, avgHr: 140 }, isPast: true, isMissed: false },
          ],
          unplanned: [
            {
              activityId: 'act-double',
              localDate: '2026-05-06',
              startDate: '2026-05-06T12:10:00Z',
              name: 'Lunch Run',
              distanceMeters: Math.round(4.2 * 1609.344),
            },
          ],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const all = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
    expect(all.some((t) => t.includes('4.2'))).toBe(false);
    expect(tree.root.findAll((node) => String(node.props.accessibilityLabel ?? '').startsWith('Week 1 strategy.')).length).toBeGreaterThan(0);

    act(() => tree.unmount());
  });

  test('completed activities reconcile into one compact selected-week readout', () => {
    const fourMiles = Math.round(4 * 1609.344);
    const threeMiles = Math.round(3 * 1609.344);
    mockWeeklyMileage.value = {
      loading: false,
      error: null,
      weekGoals: progressGoals.map((goal) => goal.weekIndex === 1
        ? {
            ...goal,
            mileage: goalStat(
              fourMiles + threeMiles,
              goal.mileage.targetMeters,
              1,
            ),
          }
        : goal),
    };
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 0,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: { ...currentBarWk1, actualMeters: fourMiles + threeMiles },
          days: [
            { workout: { ...easyWorkout, id: 'am-run' }, actual: { distanceMeters: fourMiles, movingTimeS: 1800, avgHr: 140 }, isPast: true, isMissed: false },
            { workout: { ...easyWorkout, id: 'pm-run', title: 'PM easy' }, actual: { distanceMeters: threeMiles, movingTimeS: 1400, avgHr: 138 }, isPast: true, isMissed: false },
          ],
          unplanned: [],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const all = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
    const [profileSummary] = tree.root.findAllByProps({ testID: 'plan-blueprint-summary' });
    expect(profileSummary?.props.accessibilityLabel).toContain('7 of 39.8 plan miles banked');
    expect(all).toContain('Banked in this plan');
    expect(all).toContain('Weekly contract');
    act(() => tree.unmount());
  });

  test('the current phase uses banked plus unresolved mileage instead of stale authored allocation', () => {
    const mi = (value: number) => Math.round(value * 1609.344);
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-07-23',
      currentIndex: 0,
      sections: [{
        weekId: 'wk11',
        weekIndex: 11,
        weekStart: '2026-07-20',
        bar: {
          weekIndex: 11,
          phase: 'build',
          targetMeters: mi(100),
          actualMeters: mi(47.1),
          band: 'green',
          paceBand: 'green',
          isRecovery: false,
          isCurrent: true,
          isFuture: false,
        },
        qualityTargetMeters: 0,
        longTargetMeters: 0,
        days: liveProjectionDays(),
        unplanned: [],
      }],
    };

    const tree = renderTree(<PlanScreen />);
    const text = tree.root.findAllByType(Text).map((node) => flattenText(node.props.children)).join('|');
    expect(text).not.toContain('8 mi over contract');
    expect(text).toContain('Week shape');
    act(() => tree.unmount());
  });

  test('the plan roadmap omits mileage outcome verdicts', () => {
    const targetMeters = 55.4 * 1609.344;
    const actualMeters = 55.1 * 1609.344;
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: -1,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: {
            ...currentBarWk1,
            targetMeters,
            actualMeters,
            isCurrent: false,
            isFuture: false,
          },
          days: [],
          unplanned: [],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const ledgerWeek = tree.root.findAll((node) => (
      node.props.accessibilityRole === 'text' && String(node.props.accessibilityLabel ?? '').startsWith('Week 1,')
    ))[0];
    expect(ledgerWeek?.props.accessibilityLabel).toContain('55.4 mile contract');
    expect(ledgerWeek?.props.accessibilityLabel).not.toContain('short');
    act(() => tree.unmount());
  });

  test('selecting a roadmap week updates strategy without navigating', () => {
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 1,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: { ...currentBarWk1, isCurrent: false, isFuture: false },
          days: [{ workout: easyWorkout, actual: null, isPast: true, isMissed: false }],
          unplanned: [],
        },
        {
          weekId: 'wk2',
          weekIndex: 2,
          weekStart: '2026-05-11',
          bar: { ...currentBarWk1, weekIndex: 2, isCurrent: true, isFuture: false },
          days: [{ workout: qualityWorkout, actual: null, isPast: false, isMissed: false }],
          unplanned: [],
        },
      ],
    };
    const tree = renderTree(<PlanScreen />);
    const previous = pressables(tree).find((node) => node.props.accessibilityLabel === 'Previous week');
    expect(previous).toBeDefined();
    act(() => previous!.props.onPress());
    expect(mockPush).not.toHaveBeenCalled();
    const text = tree.root.findAllByType(Text).map((node) => flattenText(node.props.children)).join('|');
    expect(text).toContain('View week');
    act(() => tree.unmount());
  });

  test('renders the complete training blocks with the current week selected by default', () => {
    const settledBar = {
      weekIndex: 1,
      phase: 'base' as const,
      targetMeters: 122000, // ~76 mi
      actualMeters: 124000, // ~77 mi → HIT
      band: 'green' as const,
      paceBand: 'green' as const,
      isRecovery: false,
      isCurrent: false,
      isFuture: false,
    };
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: 1,
      sections: [
        {
          weekId: 'wk1',
          weekIndex: 1,
          weekStart: '2026-05-04',
          bar: settledBar,
          days: [{ workout: easyWorkout, actual: { distanceMeters: 12000, movingTimeS: 3600, avgHr: 140 }, isPast: true, isMissed: false }],
          unplanned: [],
        },
        {
          weekId: 'wk-current',
          weekIndex: 2,
          weekStart: '2026-05-11',
          bar: currentBarWk1,
          days: [{ workout: qualityWorkout, actual: null, isPast: false, isMissed: false }],
          unplanned: [],
        },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const allText = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
    const joined = allText.join('|');

    expect(joined).toContain('Training blocks');
    expect(joined).toContain('May 4–17');
    expect(joined).toContain('Week 2');
    expect(joined).toContain('Week 2 of 2');
    expect(joined).toContain('Week 2 of 18 · Base');
    expect(joined).not.toContain('Now · Base');
    expect(joined).not.toContain('+1.2 mi');
    expect(joined).not.toContain('Plan ·');
    expect(joined).not.toContain('77 / 76');
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'text' && String(node.props.accessibilityLabel ?? '').startsWith('Week 2,')).length).toBeGreaterThan(0);

    act(() => tree.unmount());
  });

  // Durable plan objects now belong to You. Plan's header stays focused on the
  // active plan rather than retaining a second library shortcut.
  test('does not duplicate the plan library in the active-plan header', () => {
    mockPlanView.value = {
      loading: false,
      error: null,
      plan,
      today: '2026-05-18',
      currentIndex: -1,
      sections: [
        { weekId: 'wk1', weekIndex: 1, weekStart: '2026-05-04', bar: block.weeks[0]!, days: [], unplanned: [] },
      ],
    };

    const tree = renderTree(<PlanScreen />);
    const library = pressables(tree).find((node) => node.props.accessibilityLabel === 'Open plan library');
    expect(library).toBeUndefined();

    act(() => tree.unmount());
  });
});

// ---- Week-goal fixtures (PlanScreen weekly-mileage mock) --------------------
const progressGoals: WeekGoal[] = block.weeks.map((bar) => ({
  weekIndex: bar.weekIndex,
  weekStart: weeks[bar.weekIndex - 1]!.weekStart,
  label: `${bar.weekIndex}`,
  isCurrent: bar.isCurrent,
  isFuture: bar.isFuture,
  mileage: goalStat(bar.actualMeters, bar.targetMeters, 1),
  quality: goalStat(bar.weekIndex === 2 ? 6_000 : 0, bar.weekIndex === 2 ? 8_000 : 0, 0.6),
  long: goalStat(bar.weekIndex === 2 ? 20_000 : 0, bar.weekIndex === 2 ? 20_000 : 0, 0.9),
  allMet: bar.weekIndex === 2,
}));

describe('WorkoutDetailScreen', () => {
  // workout/[id] is now a SessionView wrapper: a planned/no-run-yet day renders
  // the canonical workout identity and prescription (no charts); a matched run drives
  // the full run readout (the same tree as run/[id]).

  test('upcoming quality day → PLANNED chip + prescribed table, no charts', () => {
    mockDetail.value = {
      loading: false,
      error: null,
      workout: qualityWorkout,
      activities: [],
      matchedActivities: [],
      actual: null,
      primaryActivityId: null,
      weekIndex: 2,
      today: '2026-05-05', // before the 05-12 workout date → upcoming
      refetch: () => undefined,
    } as WorkoutDetail;
    const tree = renderTree(<WorkoutDetailScreen />);
    const text = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
    expect(text).toContain('Planned');
    expect(text).not.toContain('Missed');
    expect(text).toContain('Quality');
    expect(text).toMatch(/~\d+(?:h\d{2}m|m)/);
    // The prescribed set header (4 × ~1mi reps) is present; no charts/route.
    expect(text).toContain('4 × 1 mi, 1:30 jog');
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Edit workout').length).toBeGreaterThan(0);
    expect(tree.root.findAll((node) => node.props.testID === 'workout-detail-prescription-rail').length).toBeGreaterThan(0);
    expect(text).not.toContain('Pace curve');
    expect(text).toContain('Route');
    expect(text).toContain('Plan route');
    act(() => tree.unmount());
  });

  test('past quality day with no run → Missed chip', () => {
    mockDetail.value = {
      loading: false,
      error: null,
      workout: qualityWorkout,
      activities: [],
      matchedActivities: [],
      actual: null,
      primaryActivityId: null,
      weekIndex: 2,
      today: '2026-05-18', // after the 05-12 workout date → missed
      refetch: () => undefined,
    } as WorkoutDetail;
    const tree = renderTree(<WorkoutDetailScreen />);
    const text = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
    expect(text).toContain('Missed');
    expect(text).not.toContain('Planned');
    expect(text).toContain('Quality');
    act(() => tree.unmount());
  });

  test('upcoming easy day → a single easy line, no prescribed table', () => {
    mockDetail.value = {
      loading: false,
      error: null,
      workout: easyWorkout,
      activities: [],
      matchedActivities: [],
      actual: null,
      primaryActivityId: null,
      weekIndex: 1,
      today: '2026-05-01', // before the 05-05 workout date → upcoming
      refetch: () => undefined,
    } as WorkoutDetail;
    const tree = renderTree(<WorkoutDetailScreen />);
    const text = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
    expect(text).toContain('Planned');
    expect(text).toContain('Easy');
    expect(text).toContain('easy');
    act(() => tree.unmount());
  });

  // A matched run drives the full run readout (Analysis/Splits), the same tree
  // run/[id] renders — the workout screen no longer carries its own ledger.
  test('completed quality day with a matched run → the run readout', () => {
    const n = 60;
    const distM = 4800;
    const durS = 1500;
    const t: number[] = [];
    const d: number[] = [];
    const v: number[] = [];
    const hr: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const frac = i / (n - 1);
      t.push(Math.round(frac * durS));
      d.push(Math.round(frac * distM * 100) / 100);
      v.push(distM / durS);
      hr.push(Math.round(140 + 14 * frac));
    }
    const run: ActivityRow = {
      id: 'a1',
      source: 'strava',
      source_id: 'strava-a1',
      name: 'Threshold Repeats',
      local_date: '2026-05-12',
      distance_meters: distM,
      moving_time_s: durS,
      elapsed_time_s: null,
      avg_hr: 150,
      user_note: null,
      start_date: '2026-05-12T13:00:00Z',
      avg_temp_c: 14,
      best_efforts: null,
      workout_type: null,
      stream_summary: null,
      streams: { t, d, v, hr, alt: null },
      route: null,
      laps: null,
      max_hr: 168,
      suffer_score: 64,
      shoe_id: null,
    };
    mockDetail.value = {
      loading: false,
      error: null,
      workout: qualityWorkout,
      activities: [run],
      // matchedActivities intentionally contains the LEAN row (no streams) to
      // mirror the real useWorkoutDetail → list-query path. SessionView must
      // re-fetch the detail row via useActivity to get full-res streams.
      matchedActivities: [{ ...run, streams: null }] as ActivityRow[],
      actual: { distanceMeters: distM, movingTimeS: durS, avgHr: 150 },
      primaryActivityId: 'a1',
      weekIndex: 2,
      today: '2026-05-18',
      refetch: () => undefined,
    } as WorkoutDetail;
    // SessionView calls useActivity twice: once for the activityId path (null →
    // idle) and once for the matched-activity detail refetch (id='a1' → full-res).
    // Both calls use the same mock value here; returning the detail row satisfies
    // the matched-detail gate.
    mockActivity.value = {
      loading: false,
      error: null,
      activity: run,
      weekIndex: 2,
      today: '2026-05-18',
      refetch: () => undefined,
    };
    const tree = renderTree(<WorkoutDetailScreen />);
    const text = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
    expect(text).toContain('Threshold Repeats');
    expect(text).toContain('Analysis');
    // The planned-state chips do NOT appear on a completed run.
    expect(text).not.toContain('Planned');
    expect(text).not.toContain('Missed');
    act(() => tree.unmount());
  });
});

// ---- Week detail -----------------------------------------------------------

describe('WeekDetailScreen', () => {
  test('carries an unresolved contract gap into the week allocation drill', () => {
    const longTargetMeters = Math.round(16 * 1609.344);
    mockWeek.value = {
      weekStart: '2026-05-11',
      weekId: 'wk-gap',
      loading: false,
      error: null,
      weekIndex: 6,
      phase: 'build',
      isRecovery: false,
      bar: {
        weekIndex: 6,
        phase: 'build',
        targetMeters: Math.round(30 * 1609.344),
        actualMeters: 0,
        band: 'green',
        paceBand: 'green',
        isRecovery: false,
        isCurrent: false,
        isFuture: true,
      },
      elapsedFraction: 0,
      today: '2026-05-18',
      qualityTargetMeters: 0,
      longTargetMeters,
      days: [{ workout: { ...easyWorkout, date: '2026-05-12', planned_distance_meters: Math.round(10 * 1609.344) }, actual: null, isPast: false, isMissed: false }],
      unplanned: [],
    };

    const tree = renderTree(<WeekDetailScreen />);
    const text = tree.root.findAllByType(Text).map((node) => flattenText(node.props.children)).join('|');
    expect(text).toContain('Allocation gap');
    expect(text).toContain('20 mi weekly');
    expect(text).toContain('16 mi long');
    act(() => tree.unmount());
  });

  test('a live week resolves completed and missed work before judging allocation', () => {
    const mi = (value: number) => Math.round(value * 1609.344);
    const days = liveProjectionDays();
    mockWeek.value = {
      weekStart: '2026-07-20',
      weekId: 'wk11',
      loading: false,
      error: null,
      weekIndex: 11,
      phase: 'build',
      isRecovery: false,
      bar: {
        weekIndex: 11,
        phase: 'build',
        targetMeters: mi(100),
        actualMeters: mi(47.1),
        band: 'green',
        paceBand: 'green',
        isRecovery: false,
        isCurrent: true,
        isFuture: false,
      },
      elapsedFraction: 0.5,
      today: '2026-07-23',
      qualityTargetMeters: 0,
      longTargetMeters: 0,
      days,
      editableDays: days,
      unplanned: [],
    };

    const tree = renderTree(<WeekDetailScreen />);
    const text = tree.root.findAllByType(Text).map((node) => flattenText(node.props.children)).join('|');
    expect(text).toContain('47.1');
    expect(text).not.toContain('over contract');
    expect(text).not.toContain('Allocation gap');
    act(() => tree.unmount());
  });

  test('renders a past week as a seven-day manifest without a duplicate verdict dashboard', () => {
    const pastQualityWorkout = { ...qualityWorkout, date: '2026-05-06' };
    mockWeek.value = {
      weekStart: '2026-05-04',
      weekId: null,
      loading: false,
      error: null,
      weekIndex: 1,
      phase: 'base',
      isRecovery: false,
      bar: block.weeks[0]!,
      elapsedFraction: 0,
      today: '2026-05-18',
      days: [
        { workout: easyWorkout, actual: { distanceMeters: 12000, movingTimeS: 3600, avgHr: 140 }, isPast: true, isMissed: false },
        { workout: pastQualityWorkout, actual: null, isPast: true, isMissed: true },
      ],
      unplanned: [
        {
          activityId: 'act-extra',
          localDate: '2026-05-07',
          startDate: '2026-05-07T06:00:00Z',
          name: 'Evening Run',
          distanceMeters: Math.round(3.3 * 1609.344),
        },
      ],
    };
    const tree = renderTree(<WeekDetailScreen />);
    const texts = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
    expect(texts.some((t) => t.includes('Week 1'))).toBe(true);
    expect(texts.some((t) => t.includes('WEEKLY CONTRACT'))).toBe(true);
    expect(texts.some((t) => t.includes('Week allocation'))).toBe(true);
    expect(texts.some((t) => t.includes('4 × 1 mi'))).toBe(true);
    expect(texts.some((t) => t.includes('Warm-up'))).toBe(false);
    const manifestDates = new Set(
      tree.root
        .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('manifest-day-'))
        .map((n) => n.props.testID as string),
    );
    expect(manifestDates.size).toBe(7);
    expect(tree.root.findAllByProps({ testID: 'week-punch-card' })).toHaveLength(0);
    expect(texts.some((t) => t.includes('BEHIND'))).toBe(false);
    // The unplanned run shows up in the week-detail list too.
    expect(texts.some((t) => t.includes('Evening Run'))).toBe(true);

    // Tapping a planned allocation navigates to its workout detail. Outcome
    // glyphs stay out of this prescription-first surface.
    expect(texts.some((t) => t.includes('✓'))).toBe(false);
    const dayRow = tree.root.findAllByProps({ testID: 'manifest-workout-w-easy' })[0];
    expect(dayRow).toBeDefined();
    act(() => dayRow!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/workout/[id]', params: { id: 'w-easy' } });

    act(() => tree.unmount());
  });

  test('renders a future week empty state when there are no workouts', () => {
    mockWeek.value = {
      weekStart: '2026-05-11',
      loading: false,
      error: null,
      weekIndex: 6,
      phase: 'build',
      isRecovery: false,
      bar: {
        weekIndex: 6,
        phase: 'build',
        targetMeters: 103000,
        actualMeters: 0,
        band: 'green',
        paceBand: 'green',
        isRecovery: false,
        isCurrent: false,
        isFuture: true,
      },
      elapsedFraction: 0,
      today: '2026-05-18',
      days: [],
      unplanned: [],
      weekId: null,
    };
    const tree = renderTree(<WeekDetailScreen />);
    const texts = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
    expect(texts.some((t) => t.includes('No workouts allocated yet'))).toBe(true);
    expect(texts.some((t) => t.includes('mileage contract is ready for workouts'))).toBe(true);

    const edit = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Adjust week 6',
    )[0];
    expect(edit).toBeDefined();
    act(() => edit!.props.onPress());
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/planner/[id]', params: { id: '6' } });
    act(() => tree.unmount());
  });

  // audit-code Lane 2: the error branch had no retry affordance.
  test('an error state offers Retry, which invalidates the plan/activity caches', () => {
    mockWeek.value = {
      weekStart: null,
      loading: false,
      error: new Error('network unreachable'),
      weekIndex: null,
      phase: null,
      isRecovery: false,
      bar: null,
      elapsedFraction: 0,
      today: '2026-05-18',
      days: [],
      unplanned: [],
      weekId: null,
    };
    const tree = renderTree(<WeekDetailScreen />);
    const text = tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
    expect(text).toContain('network unreachable');

    const retry = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Retry',
    );
    expect(retry.length).toBeGreaterThan(0);
    act(() => retry[0]!.props.onPress());
    expect(mockInvalidateCaches).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });
});

// ---- Standalone activity detail --------------------------------------------

describe('ActivityDetailScreen', () => {
  test('renders an unplanned run with its name, Wk context, charts and route', () => {
    const n = 60;
    const distM = Math.round(4.2 * 1609.344);
    const durS = 1800;
    const t: number[] = [];
    const d: number[] = [];
    const v: number[] = [];
    const hr: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const frac = i / (n - 1);
      t.push(Math.round(frac * durS));
      d.push(Math.round(frac * distM * 100) / 100);
      v.push(distM / durS);
      hr.push(Math.round(138 + 10 * frac));
    }
    const route: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      route.push([41.88 + 0.01 * Math.sin(a), -87.62 + 0.014 * Math.cos(a)]);
    }
    mockActivity.value = {
      loading: false,
      error: null,
      weekIndex: 2,
      today: '2026-05-18',
      refetch: () => undefined,
      activity: {
        id: 'act-double',
        source: 'strava',
        source_id: 'strava-1',
        name: 'Lunch Run',
        local_date: '2026-05-06',
        distance_meters: distM,
        moving_time_s: durS,
        elapsed_time_s: null,
        avg_hr: 143,
        user_note: 'Easy shakeout.',
        start_date: '2026-05-06T12:10:00Z',
        avg_temp_c: 18,
        best_efforts: null,
        workout_type: null,
        stream_summary: null,
        streams: { t, d, v, hr, alt: null },
        route,
        laps: [{ distance: distM, moving_time: durS, average_heartrate: 143 }],
        max_hr: 150,
        suffer_score: 28,
        shoe_id: null,
      },
    };
    let tree: ReactTestRenderer | undefined;
    expect(() => {
      tree = renderTree(<ActivityDetailScreen />);
    }).not.toThrow();
    const text = tree!.root.findAllByType(Text).map((nn) => flattenText(nn.props.children)).join(' ');
    expect(text).toContain('Lunch Run');
    expect(text).toContain('Wk 2');
    expect(text).toContain('Analysis');
    expect(text).toContain('Pace curve');
    expect(text).toContain('Splits');
    expect(text).toContain('Easy shakeout.');
    // No planned/actual plan tiles on a standalone run.
    expect(text).not.toContain('Planned');
    act(() => tree?.unmount());
  });
});
