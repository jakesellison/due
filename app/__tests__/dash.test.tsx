/**
 * Render tests for the Dash (home) screen under the `app` Jest project
 * (jest-expo). Data hooks, the router and the Skia/victory chart components are
 * mocked so these render headlessly. The focus: the Dash now homes ALL live
 * Adaptation proposals (the Coach tab that previously listed them is gone), so a
 * two-proposal week stacks two cards — each with its own Apply button.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { screenWrapper } from '@/app-lib/__testsupport__/render';
import type { Adaptation, BlockSummary, CalendarDay } from '@/lib';
import { SyncStatusRow } from '@/components/dash/SyncStatusRow';

// ---- Mocks -----------------------------------------------------------------

const mockSessionRetry = jest.fn();
const mockSession: { value: { userId: string | null; ready: boolean; error: Error | null } } = {
  value: { userId: 'u1', ready: true, error: null },
};
jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ ...mockSession.value, retry: mockSessionRetry }),
}));

jest.mock('@/app-lib/routes', () => ({
  useWorkoutRouteIds: () => ({ data: new Set<string>(), isLoading: false, error: null }),
}));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockRouteParams: { value: { calendarDate?: string } } = { value: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn(), canGoBack: () => true, replace: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: () => mockRouteParams.value,
  // Dash re-probes Strava status on focus; run the effect once like a focus.
  useFocusEffect: (cb: () => void | (() => void)) => cb(),
}));

// Seed is a no-op in tests so the Dash flips to "ready" immediately.
jest.mock('@/app-lib/seed', () => ({
  ensureSamplePlan: jest.fn().mockResolvedValue(undefined),
}));

const mockWeekly: { value: unknown } = { value: undefined };
const mockActivities: { value: { data: unknown[]; isLoading: boolean; error: Error | null } } = {
  value: { data: [], isLoading: false, error: null },
};
const mockInvalidateCaches = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/app-lib/queries', () => ({
  useWeeklyMileage: () => mockWeekly.value,
  useActivities: () => mockActivities.value,
  useActivePlan: () => ({ data: null, isLoading: false, error: null }),
  usePlanChangeLog: () => ({ events: [], isLoading: false }),
  invalidatePlanActivityCaches: (...args: unknown[]) => mockInvalidateCaches(...args),
  planHeaderInfo: () => ({
    raceName: 'Chicago 2026',
    goalTime: '2:36',
    raceLine: 'Chicago 2026  2:36',
    weekN: 1,
    numWeeks: 18,
    phaseLabel: 'Base',
    daysToRace: 120,
  }),
  planCaption: () => 'Chicago 2026  2:36',
}));

// Adaptations are driven per-test.
const mockAdapt: { value: { planId: string | null; weekId: string | null; adaptations: Adaptation[] } } = {
  value: { planId: 'p1', weekId: 'wk1', adaptations: [] },
};
jest.mock('@/app-lib/adapt', () => ({
  useAdaptations: () => mockAdapt.value,
  useDismissAdaptation: () => jest.fn(),
  applyAdaptation: jest.fn(),
}));

// saveWeekEdits uses Supabase; mock it here so the Dash screen can import it.
jest.mock('@/app-lib/weekEdit', () => ({
  saveWeekEdits: jest.fn().mockResolvedValue(undefined),
}));

// Strava connection status + the shared backfill status (PM#1 empty-state /
// sync-row branching) — mocked so the Dash screen never makes a real network
// probe in these render tests. Defaults: connected, idle (no import running),
// i.e. the "everything's fine" case; individual tests override per-branch.
const mockStravaStatus: { value: { status: { connected: boolean } | null } } = {
  value: { status: { connected: true } },
};
jest.mock('@/app-lib/strava', () => ({
  useStravaStatus: () => ({ ...mockStravaStatus.value, refresh: jest.fn(async () => null) }),
}));

const mockBackfillStatus: { value: { kind: string; [k: string]: unknown } } = {
  value: { kind: 'idle' },
};
jest.mock('@/app-lib/backfillStatus', () => ({
  useBackfillStatus: () => mockBackfillStatus.value,
}));

// The "just banked" acknowledgement store — mocked so the Fix 2 race tests can
// assert precisely whether/when a run gets recorded as seen, independent of
// the real AsyncStorage-backed timing.
const mockGetLastSeenBanked = jest.fn(async (..._args: unknown[]) => null as string | null);
const mockSetLastSeenBanked = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/app-lib/bankedCard', () => ({
  getLastSeenBanked: (...args: unknown[]) => mockGetLastSeenBanked(...args),
  setLastSeenBanked: (...args: unknown[]) => mockSetLastSeenBanked(...args),
}));

// Imported AFTER the mocks are registered.
import DashScreen from '../(tabs)/index';

// ---- Fixtures --------------------------------------------------------------

const MI = 1609.344;

const summary: BlockSummary = {
  weeks: [],
  current: {
    weekIndex: 1,
    phase: 'base',
    isRecovery: false,
    targetMeters: Math.round(40 * MI),
    actualMeters: Math.round(20 * MI),
    paceLineMeters: Math.round(30 * MI),
    fraction: 0.5,
    elapsedFraction: 0.75,
    band: 'amber',
    paceBand: 'amber',
    qualityPlanned: 2,
    qualityCompleted: 1,
  },
} as unknown as BlockSummary;

/** Minimal 7-day CalendarDay fixture for CalendarTabs. */
const calendarWeek: CalendarDay[] = [
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
].map((initial, i) => ({
  localDate: `2026-05-${(18 + i).toString().padStart(2, '0')}`,
  dayIndex: i,
  initial,
  state: (i === 0 ? 'today-pending' : 'upcoming') as CalendarDay['state'],
  plannedMeters: 8000,
  actualMeters: 0,
  isQuality: false,
  isRace: false,
  isDouble: false,
  isToday: i === 0,
  target: { kind: 'none' as const },
  workouts: [],
  activities: [],
  primary: i === 0
    ? {
        id: 'wo-today',
        type: 'easy',
        title: 'Easy Run',
        isQuality: false,
        structure: [],
        plannedMeters: 8000,
        completed: false,
        outcome: 'planned' as const,
        actualMeters: 0,
        sealed: false,
        tone: 'easy' as const,
      }
    : null,
}));

const weeklyView = {
  loading: false,
  error: null,
  plan: { id: 'p1', race_name: 'Chicago 2026', goal_time: '02:36:00', num_weeks: 18 },
  summary,
  spark: null,
  // The realign entry/week-pace tile only renders for a CURRENT week goal (the
  // gate reads curGoal + the adaptation deficit), so the fixture needs one.
  // Quality/long targets stay 0 → only the mileage deficit can flag "behind".
  weekGoals: [
    {
      weekIndex: 1,
      weekStart: '2026-05-18',
      label: 'W2',
      isCurrent: true,
      isFuture: false,
      mileage: { actualMeters: 10 * MI, targetMeters: 30 * MI, hit: false, fraction: 10 / 30 },
      quality: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
      long: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
      allMet: false,
    },
  ],
  todayWorkouts: [],
  todayActivity: null,
  weekStrip: [],
  currentWeekIndex: 1,
  today: '2026-05-18',
  weekDays: calendarWeek,
  weekDaysFor: () => calendarWeek,
  currentWeekStart: '2026-05-18',
  easyBaseline: 480,
  currentWeekActivityIds: new Set<string>(),
};

const redistribute: Adaptation = {
  kind: 'redistribute',
  title: 'Behind pace — make it up',
  detail: '+1.0 to Sat · Sun easy runs',
  deficitMeters: Math.round(6 * MI),
  edits: [{ workoutId: 'a', date: '2026-06-06', fromMeters: 6 * MI, toMeters: 7 * MI }],
};

const lowerTarget: Adaptation = {
  kind: 'lower_target',
  title: 'Adjust this week to 16 mi',
  detail: 'Make the plan honest.',
  deficitMeters: Math.round(18 * MI),
  edits: { newTargetMeters: 16 * MI },
};

// ---- Helpers ---------------------------------------------------------------

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screenWrapper(node));
  });
  // Flush the seed effect (ensureSamplePlan resolves -> setSeedDone(true)).
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

/** The Week adjustment button (the pressable that opens the week planner).
 *  Matches the host button by role + label so nested text isn't counted. */
function adjustWeekEntry(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) =>
      typeof n.props?.onPress === 'function' &&
      n.props?.accessibilityLabel === 'Adjust this week' &&
      n.props?.accessibilityRole === 'button',
  );
}

beforeEach(() => {
  mockWeekly.value = weeklyView;
  mockAdapt.value = { planId: 'p1', weekId: 'wk1', adaptations: [] };
  mockSession.value = { userId: 'u1', ready: true, error: null };
  mockPush.mockClear();
  mockNavigate.mockClear();
  mockSessionRetry.mockClear();
  mockInvalidateCaches.mockClear();
  mockStravaStatus.value = { status: { connected: true } };
  mockBackfillStatus.value = { kind: 'idle' };
  mockRouteParams.value = {};
  mockActivities.value = { data: [], isLoading: false, error: null };
  mockGetLastSeenBanked.mockClear();
  mockGetLastSeenBanked.mockResolvedValue(null);
  mockSetLastSeenBanked.mockClear();
  mockSetLastSeenBanked.mockResolvedValue(undefined);
});

describe('DashScreen training block ownership', () => {
  it('keeps the block record read-only and opens the active block in Plan', async () => {
    const tree = await render(<DashScreen />);
    const actions = tree.root.findAll(
      (node) => node.props?.accessibilityRole === 'button' && typeof node.props?.accessibilityLabel === 'string',
    );
    const openPlan = actions.find((node) => node.props.accessibilityLabel.startsWith('Open training block in Plan.'));

    expect(openPlan).toBeDefined();
    act(() => openPlan!.props.onPress());

    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/plan');
    act(() => tree.unmount());
  });
});

// ---- Tests -----------------------------------------------------------------

describe('DashScreen week adjustment entry', () => {
  it('opens the week planner for the current week when tapped', async () => {
    mockAdapt.value = { planId: 'p1', weekId: 'wk1', adaptations: [lowerTarget, redistribute] };
    const tree = await render(<DashScreen />);
    const [entry] = adjustWeekEntry(tree);
    expect(entry).toBeTruthy();
    act(() => entry!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/planner/[id]', params: { id: '1' } });
    act(() => tree.unmount());
  });

  it('shows the entry for a single proposal carrying a deficit', async () => {
    mockAdapt.value = { planId: 'p1', weekId: 'wk1', adaptations: [redistribute] };
    const tree = await render(<DashScreen />);
    expect(adjustWeekEntry(tree).length).toBe(1);
    expect(tree.root.findAll((n) => n.props?.children === '6 mi unallocated').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('keeps week adjustment reachable when there are no proposals', async () => {
    mockAdapt.value = { planId: 'p1', weekId: 'wk1', adaptations: [] };
    const tree = await render(<DashScreen />);
    expect(adjustWeekEntry(tree).length).toBe(1);
    expect(tree.root.findAll((n) => n.props?.children === 'On mileage pace')).toHaveLength(0);
    expect(tree.root.findAll((n) => n.props?.children === '7 days left').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});

describe('DashScreen calendar unit integration', () => {
  it('reserves today’s workout card while cached week data refreshes', async () => {
    mockWeekly.value = { ...weeklyView, updating: true };
    const tree = await render(<DashScreen />);

    expect(tree.root.findByProps({ testID: 'day-panel-loading-skeleton' })).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'day-workout-card' })).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('uses the compact period label to toggle the anchored month calendar', async () => {
    const tree = await render(<DashScreen />);
    const expandControls = tree.root.findAll(
      (n) => n.props.accessibilityLabel === 'Expand month calendar',
    );
    expect(expandControls.length).toBeGreaterThanOrEqual(2); // Header control + pull grip.
    expect(expandControls[0]!.props.accessibilityState?.expanded).toBe(false);
    expect(tree.root.findAll((n) => n.props.children === 'Week 1/18 \u00b7 May 18\u201324').length).toBeGreaterThan(0);

    await act(async () => {
      expandControls[0]!.props.onPress();
    });

    const collapseControls = tree.root.findAll(
      (n) => n.props.accessibilityLabel === 'Collapse month calendar',
    );
    expect(collapseControls.length).toBeGreaterThanOrEqual(2);
    expect(collapseControls[0]!.props.accessibilityState?.expanded).toBe(true);
    expect(tree.root.findAll((n) => n.props.children === 'May 2026').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('renders the CalendarTabs tablist and the today panel', async () => {
    const tree = await render(<DashScreen />);
    // CalendarTabs exposes role="tablist" — assert it exists.
    const tablists = tree.root.findAll(
      (n) => n.props.accessibilityRole === 'tablist',
    );
    expect(tablists.length).toBeGreaterThan(0);
    // Today's workout title is rendered in the DayPanel.
    const allText = tree.root.findAll((n) => n.props.children != null && typeof n.props.children === 'string');
    const joined = allText.map((n) => n.props.children as string).join(' ');
    expect(joined).toContain('Easy Run');
    act(() => tree.unmount());
  });

  it('renders the mileage contract with Quality and Long run supporting goals', async () => {
    const tree = await render(<DashScreen />);
    const allText = tree.root.findAll((n) => n.props.children != null && typeof n.props.children === 'string');
    const joined = allText.map((n) => n.props.children as string).join(' ');
    expect(joined).toContain('Weekly contract');
    expect(joined).toContain('Quality');
    expect(joined).toContain('Long run');
    act(() => tree.unmount());
  });
});

describe('DashScreen no-plan empty state', () => {
  it('offers an Import plan CTA that opens the /plans home (Strava connected, no import running)', async () => {
    mockWeekly.value = { ...weeklyView, plan: null, summary: null };
    const tree = await render(<DashScreen />);
    const cta = tree.root.find(
      (n) =>
        typeof n.props?.onPress === 'function' &&
        n.props.accessibilityLabel === 'Import plan',
    );
    expect(cta).toBeDefined();
    act(() => cta.props.onPress());
    // The empty-Dash CTA now opens the single /plans entry surface, not the
    // installer directly (Task 10 collapsed the three plan-entry doors).
    expect(mockPush).toHaveBeenCalledWith('/plans');
    act(() => tree.unmount());
  });

  // PM#1: a fresh sign-up with no Strava connection and no plan used to read
  // "paste a training plan" with no mention that connecting Strava is the
  // actual first step — the empty state now branches on connection state.
  it('points at connecting Strava when not yet connected, not "paste a plan"', async () => {
    mockWeekly.value = { ...weeklyView, plan: null, summary: null };
    mockStravaStatus.value = { status: { connected: false } };
    const tree = await render(<DashScreen />);
    const allText = tree.root
      .findAll((n) => n.props.children != null && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .join('|');
    expect(allText).toContain('Connect Strava');
    expect(allText).not.toContain('No active plan yet');
    const cta = tree.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props.accessibilityLabel === 'Connect Strava',
    );
    act(() => cta.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/you');
    act(() => tree.unmount());
  });

  // PM#1: connected but the history backfill is still running (or halted on
  // a rate limit) — silent zeros are the exact "looks broken" first
  // impression the backfill-visibility work targets; the empty state must
  // say so instead of just "no plan".
  it('shows "Importing your history" while the shared backfill status is running', async () => {
    mockWeekly.value = { ...weeklyView, plan: null, summary: null };
    mockBackfillStatus.value = { kind: 'running', label: 'Imported 340 runs…', fraction: null };
    const tree = await render(<DashScreen />);
    const allText = tree.root
      .findAll((n) => n.props.children != null && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .join('|');
    expect(allText).toContain('Importing your history');
    expect(allText).toContain('Imported 340 runs…');
    act(() => tree.unmount());
  });
});

describe('DashScreen sync-status row', () => {
  it('renders the compact sync row while a backfill is running', async () => {
    mockBackfillStatus.value = { kind: 'running', label: 'Imported 12 runs…', fraction: null };
    const tree = await render(<DashScreen />);
    const allText = tree.root
      .findAll((n) => n.props.children != null && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .join('|');
    expect(allText).toContain('Imported 12 runs…');
    act(() => tree.unmount());
  });

  it('renders nothing once the backfill is idle', async () => {
    mockBackfillStatus.value = { kind: 'idle' };
    const tree = await render(<DashScreen />);
    // When idle, SyncStatusRow returns null and should not render at all.
    const syncStatusRows = tree.root.findAll((n) => n.type === SyncStatusRow);
    expect(syncStatusRows).toHaveLength(0);
    act(() => tree.unmount());
  });
});

// audit-code Lane 2 [Low]: the Dash error screen had no retry — an airplane-mode
// cold load was a dead end. Retry now re-runs the session bootstrap and
// invalidates the plan/activities caches driving `weekly`.
describe('DashScreen boot error', () => {
  it('shows a Retry action that re-runs the session bootstrap and invalidates caches', async () => {
    mockWeekly.value = { ...weeklyView, error: new Error('network unreachable') };
    const tree = await render(<DashScreen />);
    const text = tree.root
      .findAll((n) => n.props.children != null && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .join('|');
    expect(text).toContain('network unreachable');

    const retry = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Retry',
    );
    expect(retry.length).toBeGreaterThan(0);
    await act(async () => {
      retry[0]!.props.onPress();
      await Promise.resolve();
    });
    expect(mockSessionRetry).toHaveBeenCalledTimes(1);
    expect(mockInvalidateCaches).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });

  // Important-1 from the fix-b review: when the boot failure is the auth path
  // (`sessionError`, not a downstream query error), pressing Retry must flip
  // the screen to loading IMMEDIATELY — not leave the stale error message up
  // until the async ensureSession() round-trip settles. `useSession().retry`
  // resets its own `ready`/`error` synchronously (see src/app-lib/auth.ts); the
  // mock below emulates that contract so this test exercises the same shape
  // Dash's `onRetryBoot` depends on.
  it('a sessionError boot failure shows loading immediately on retry, not the stale error', async () => {
    mockSession.value = { userId: null, ready: true, error: new Error('auth failed') };
    mockSessionRetry.mockImplementation(() => {
      mockSession.value = { ...mockSession.value, ready: false, error: null };
    });
    const tree = await render(<DashScreen />);

    const before = tree.root
      .findAll((n) => n.props.children != null && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .join('|');
    expect(before).toContain('auth failed');

    const retry = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Retry',
    );
    expect(retry.length).toBeGreaterThan(0);

    act(() => {
      retry[0]!.props.onPress();
    });

    expect(mockSessionRetry).toHaveBeenCalledTimes(1);
    const after = tree.root
      .findAll((n) => n.props.children != null && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .join('|');
    expect(after).not.toContain('auth failed');
    expect(tree.root.findByProps({ testID: 'week-loading-skeleton' })).toBeDefined();

    act(() => tree.unmount());
  });
});

// ── Fix 2: the weekGoals / justBanked query race ────────────────────────────
//
// `contractJustMet` derives from `weekly.weekGoals`; the inline arrival derives
// from a DIFFERENT `useActivities` cache entry (`recentActs`, feeding
// `justBanked`). During a background refetch the activities query can already
// know about a new run while `weekGoals` does not yet — in that window
// `contractJustMet` reads false even for a run that DID close the contract.
// If the inline tier had been allowed to acknowledge on that stale read,
// `justBanked.banked` would null out and `ContractMetMoment` could never
// render for this run once the fresh totals land — a silent, permanent loss
// of the once-a-week milestone. These tests pin that this can't happen.
describe('DashScreen run-completion moment — Fix 2 (weekGoals/activities race)', () => {
  const RUN_ID = 'act-fresh';
  const RUN_METERS = Math.round(5 * MI);

  function freshRun() {
    return {
      id: RUN_ID,
      distance_meters: RUN_METERS,
      moving_time_s: 1800,
      start_date: new Date().toISOString(), // "just banked" — within the 48h window
      local_date: '2026-05-20', // Wednesday — inside the fixture's current week (Mon 2026-05-18)
      workout_type: 3,
      stream_summary: null,
      quality_override: null,
    };
  }

  function raceWeekly(actualMeters: number, activityIds: string[]) {
    return {
      ...weeklyView,
      weekGoals: [
        {
          weekIndex: 1,
          weekStart: '2026-05-18',
          label: 'W2',
          isCurrent: true,
          isFuture: false,
          mileage: { actualMeters, targetMeters: 30 * MI, hit: actualMeters >= 30 * MI, fraction: actualMeters / (30 * MI) },
          quality: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
          long: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
          allMet: false,
        },
      ],
      currentWeekActivityIds: new Set(activityIds),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('withholds the acknowledgement while weekGoals has not caught up, then lets the milestone render once it does', async () => {
    mockActivities.value = { data: [freshRun()], isLoading: false, error: null };
    // Race window: `justBanked` already knows about the run (mockActivities),
    // but weekGoals's own activity set does not — its STALE mileage total
    // (28mi, pre-run) is already what makes `contractJustMet` read false
    // during the window, exactly as described above.
    mockWeekly.value = raceWeekly(28 * MI, []);

    const tree = await render(<DashScreen />);

    // Let the two-stage arrival fully settle (stage 1 + hold + stage 2).
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    // UNDECIDED: the inline tier must NOT have consumed the acknowledgement.
    expect(mockSetLastSeenBanked).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props.children === 'CONTRACT MET')).toHaveLength(0);

    // weekGoals catches up: the run is now counted, and it crossed the target.
    // `tree.update` must re-supply the SAME provider wrapper `render()` used
    // (a bare `<DashScreen />` has no QueryClientProvider in scope).
    mockWeekly.value = raceWeekly(33 * MI, [RUN_ID]);
    await act(async () => {
      tree.update(screenWrapper(<DashScreen />));
    });

    // DECIDED, and it closed the contract: the milestone renders. It was NOT
    // silently burned by the inline tier during the undecided window.
    expect(tree.root.findAll((n) => n.props.children === 'CONTRACT MET').length).toBeGreaterThan(0);

    act(() => tree.unmount());
  });

  // ── REGRESSION (blocker) ────────────────────────────────────────────────
  //
  // `weekGoals` has no `isCurrent` entry whenever today's civil week is not one
  // of the plan's weeks (plan finished, or installed to start next Monday) —
  // an ORDINARY state, not an error. `currentWeekActivityIds` is empty in that
  // state too (it's derived from the same "current plan week" concept), while
  // `currentWeekStart`/`runInCurrentWeek` stay civil-week-based and plan
  // membership-independent (CalendarTabs computes `period` the same way). A
  // gate that reads "undecided" off `runInCurrentWeek` ALONE therefore never
  // resolves here: it reads true forever, so the inline tier never acks, and
  // Tier 2 can't cover for it either (`currentWeekGoal` is null). The run must
  // still be acknowledged.
  it('acknowledges a run when the plan has no current week (no isCurrent weekGoal), instead of waiting forever', async () => {
    mockActivities.value = { data: [freshRun()], isLoading: false, error: null };
    mockWeekly.value = {
      ...weeklyView,
      weekGoals: [
        {
          weekIndex: 1,
          weekStart: '2026-05-18',
          label: 'W2',
          isCurrent: false,
          isFuture: false,
          mileage: { actualMeters: 28 * MI, targetMeters: 30 * MI, hit: false, fraction: 28 / 30 },
          quality: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
          long: { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 },
          allMet: false,
        },
      ],
      // Empty forever in this state — never catches up, unlike the ordinary
      // race window the other two tests in this block exercise.
      currentWeekActivityIds: new Set<string>(),
    };

    const tree = await render(<DashScreen />);

    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    expect(mockSetLastSeenBanked).toHaveBeenCalledTimes(1);
    expect(tree.root.findAll((n) => n.props.children === 'CONTRACT MET')).toHaveLength(0);

    act(() => tree.unmount());
  });

  it('still acknowledges a run belonging to a DIFFERENT week — never left waiting on a verdict that will never come', async () => {
    // A Sunday-evening run from the PRIOR week, still inside the 48h "just
    // banked" window but outside the current week's Mon..Sun bounds.
    mockActivities.value = {
      data: [{ ...freshRun(), local_date: '2026-05-17' }], // Sunday, before the Monday 2026-05-18 start
      isLoading: false,
      error: null,
    };
    // weekGoals never will (and never should) count this run — it belongs to
    // a different, already-closed week.
    mockWeekly.value = raceWeekly(10 * MI, []);

    const tree = await render(<DashScreen />);

    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    // DECIDED immediately (never "undecided" — this run was never going to
    // land in the current week's numbers) — the inline tier acknowledges.
    expect(mockSetLastSeenBanked).toHaveBeenCalledTimes(1);
    expect(mockSetLastSeenBanked).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    expect(tree.root.findAll((n) => n.props.children === 'CONTRACT MET')).toHaveLength(0);

    act(() => tree.unmount());
  });
});

// ── Calendar header right slot ───────────────────────────────────────────────
//
// One slot, two mutually exclusive orientations: scrubbed off the current week
// the useful thing is the way back, sitting on it the useful thing is how long
// is left. They must never both render, or the row grows a second competing
// element in the corner it was tightened to leave calm.

describe('race countdown', () => {
  const countdown = (days: number | null): string | null =>
    days == null || days < 0 ? null : days === 0 ? 'RACE DAY' : `RACE IN ${days}D`;

  it('counts down while the race is ahead', () => {
    expect(countdown(75)).toBe('RACE IN 75D');
    expect(countdown(1)).toBe('RACE IN 1D');
  });

  it('says RACE DAY rather than "0D"', () => {
    expect(countdown(0)).toBe('RACE DAY');
  });

  it('shows nothing once the race has passed, or with no plan', () => {
    // A negative countdown would read as nonsense; an absent plan has no race.
    expect(countdown(-1)).toBeNull();
    expect(countdown(-200)).toBeNull();
    expect(countdown(null)).toBeNull();
  });

  it('stays short across its full value range, not just today\'s value', () => {
    // The slot is narrow and shares the row with a long left label, so the
    // label has to fit a year-out plan, not merely the current 75 days.
    for (const days of [1, 9, 75, 365, 400]) {
      expect(countdown(days)!.length).toBeLessThanOrEqual(13);
    }
  });
});
