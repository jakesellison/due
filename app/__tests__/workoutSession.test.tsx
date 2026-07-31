/**
 * SessionView, entered by workoutId — the workout/[id] route.
 *
 * Three states:
 *  (a) completed-planned: a matched run drives the full run readout (verdict
 *      header, same tree as run/[id]).
 *  (b) upcoming-planned: no run yet, date ≥ today → Planned chip + the
 *      PRESCRIBED SESSION table (set headers + resolved target pace) + the
 *      planned total. No pace/HR charts.
 *  (c) missed-planned: same, date < today → Missed chip.
 *
 * The data hooks and the router are mocked so these render headlessly without
 * Supabase or navigation.
 */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

/** Flatten nested string/number children to a single string. */
function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

import { waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { screenWrapper } from '@/app-lib/__testsupport__/render';
import { THEMES } from '@/theme/tokens';

import type { ActivityRow, WorkoutDetail } from '@/app-lib/queries';
import type { QualitySummary } from '@/lib/run/streamSummary';
import { STREAM_SUMMARY_VERSION } from '@/lib/kpi/ingestVerdict';

// ---- Mocks -----------------------------------------------------------------

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useAnimatedReaction: () => undefined,
    runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => false,
    Easing: { bezier: () => (t: number) => t },
    withTiming: (v: unknown) => v,
  };
});

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

const mockWorkoutRoute: { value: { data: unknown; isLoading: boolean; error: Error | null; refetch: jest.Mock } } = {
  value: { data: null, isLoading: false, error: null, refetch: jest.fn() },
};
jest.mock('@/app-lib/routes', () => ({
  useWorkoutRoute: () => mockWorkoutRoute.value,
}));

jest.mock('@/app-lib/weekEdit', () => ({
  saveWeekEdits: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'w-quality' }),
}));

const mockDetail: { value: WorkoutDetail } = { value: undefined as unknown as WorkoutDetail };
// useActivity is called up to TWICE per render (once for activityId path, once
// for matched-activity detail refetch on the workoutId path). The mock records
// calls so tests can assert which ids were requested and what was returned.
type ActivityResult = {
  loading: boolean;
  error: null | Error;
  activity: ActivityRow | null;
  weekIndex: number | null;
  today: string;
  refetch: () => void;
};
const mockActivityFn = jest.fn<ActivityResult, [string | null, string | null]>();
const mockPrediction: { value: unknown } = { value: { prediction: { seconds: 9360 } } };

// The banked-forward line reads `summary.weeks` (banked vs target for EVERY
// plan week), and `currentWeekIndex` decides which recovery door a miss offers.
const mockWeekly: { value: Record<string, unknown> } = {
  value: { easyBaseline: 480, summary: null, currentWeekIndex: -1 },
};
jest.mock('@/app-lib/queries', () => ({
  useWorkoutDetail: () => mockDetail.value,
  useActivity: (...args: [string | null, string | null]) => mockActivityFn(...args),
  useRacePrediction: () => mockPrediction.value,
  useWeeklyMileage: () => mockWeekly.value,
  useActivities: () => ({ data: [], isLoading: false }),
  useActivePlan: () => ({ data: null, isLoading: false }),
  useSetQualityOverride: () => ({ mutate: jest.fn() }),
}));

// The adapt engine's entry condition — the signal that picks Realign over
// Adjust. Mocked like the queries layer: the real module imports Supabase.
const mockAdaptations: { value: unknown[] } = { value: [] };
jest.mock('@/app-lib/adapt', () => ({
  useAdaptations: () => ({
    loading: false, error: null, planId: 'p1', weekId: 'wk7',
    adaptations: mockAdaptations.value,
  }),
}));

// Imported AFTER the mocks are registered.
import { SessionView } from '@/components/session/SessionView';

function renderTree(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(screenWrapper(node));
  });
  return tree!;
}

function textOf(tree: ReactTestRenderer): string {
  return tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('|');
}

// ---- Fixtures --------------------------------------------------------------

const qualityWorkout = {
  id: 'w-quality',
  week_id: 'wk2',
  date: '2026-05-20',
  type: 'quality',
  title: '4 × 2mi @ threshold',
  planned_distance_meters: 16000,
  planned_duration_s: null,
  is_quality: true,
  notes: 'Hold the last rep.',
  workout_type: null,
  structure: [
    { kind: 'warmup' as const, target: { by: 'distance' as const, distance_m: 2400 } },
    {
      kind: 'repeat' as const,
      sets: 4,
      children: [
        { kind: 'interval' as const, target: { by: 'distance' as const, distance_m: 3200, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } as const }, note: 'threshold' },
        { kind: 'recovery' as const, target: { by: 'time' as const, duration_s: 90 } },
      ],
    },
    { kind: 'cooldown' as const, target: { by: 'distance' as const, distance_m: 1600 } },
  ],
};

/** Build a LEAN activity row (no streams/route/laps — as returned by list query). */
function mkLeanActivity(id: string, distM: number, durS: number): ActivityRow {
  return {
    id,
    source: 'strava',
    source_id: `strava-${id}`,
    name: 'Threshold Repeats',
    local_date: '2026-05-12',
    distance_meters: distM,
    moving_time_s: durS,
    elapsed_time_s: null,
    avg_hr: 162,
    user_note: null,
    start_date: '2026-05-12T13:00:00Z',
    avg_temp_c: 14,
    best_efforts: null,
    workout_type: null,
    streams: null,
    route: null,
    laps: null,
    max_hr: 178,
    suffer_score: 88,
    shoe_id: null,
  } as ActivityRow;
}

/** Build a DETAIL activity row (with full-res streams — as returned by single-activity query). */
function mkDetailActivity(id: string, distM: number, durS: number): ActivityRow {
  const n = 60;
  const t: number[] = [];
  const d: number[] = [];
  const v: number[] = [];
  const hr: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    t.push(Math.round(frac * durS));
    d.push(Math.round(frac * distM * 100) / 100);
    v.push(distM / durS);
    hr.push(Math.round(150 + 14 * frac));
  }
  return {
    ...mkLeanActivity(id, distM, durS),
    streams: { t, d, v, hr, alt: null },
  } as ActivityRow;
}

// Keep a backward-compat alias so any future callers that expect the old name still work.
function mkActivity(id: string, distM: number, durS: number): ActivityRow {
  return mkDetailActivity(id, distM, durS);
}

/**
 * A DETAIL activity row carrying a PRECOMPUTED quality verdict in
 * `stream_summary.quality` — the shape server-side ingest writes. Drives the
 * restored run-detail quality chip (Fix 2), independent of Body's own live
 * intrinsic-type recompute.
 */
function mkQualityDetailActivity(id: string, distM: number, durS: number): ActivityRow {
  const quality: QualitySummary = {
    isQuality: true,
    kind: 'intervals',
    blocks: [
      { distanceMeters: distM / 4, paceSecPerMi: 400, durationS: 180, startIdx: 0, endIdx: 10 },
      { distanceMeters: distM / 4, paceSecPerMi: 400, durationS: 180, startIdx: 20, endIdx: 30 },
    ],
    summary: '8 min @ threshold + 2×0.5mi',
    qualityTimeMin: 8,
    qualityDistanceMeters: distM / 2,
    floor: { paceFloorSecPerMi: 450, hrFloor: null, easyBaselineSecPerMi: 495 },
  };
  return {
    ...mkDetailActivity(id, distM, durS),
    stream_summary: { pace_curve: [], pace_duration_curve: [], early_miles: null, quality },
  } as ActivityRow;
}

function baseDetail(over: Partial<WorkoutDetail>): WorkoutDetail {
  return {
    loading: false,
    error: null,
    workout: qualityWorkout as unknown as WorkoutDetail['workout'],
    activities: [],
    matchedActivities: [],
    actual: null,
    primaryActivityId: null,
    weekIndex: 7,
    today: '2026-05-18',
    refetch: () => undefined,
    ...over,
  } as WorkoutDetail;
}

/** Idle result returned when useActivity is called with a null id. */
const idleActivity: ActivityResult = {
  loading: false,
  error: null,
  activity: null,
  weekIndex: null,
  today: '2026-05-18',
  refetch: () => undefined,
};

// ---- Tests -----------------------------------------------------------------

describe('SessionView via workoutId', () => {
  beforeEach(() => {
    mockWorkoutRoute.value = { data: null, isLoading: false, error: null, refetch: jest.fn() };
    mockActivityFn.mockReset();
    // Default: both calls return idle (null activity). Tests override as needed.
    mockActivityFn.mockReturnValue(idleActivity);
    mockWeekly.value = { easyBaseline: 480, summary: null, currentWeekIndex: -1 };
    mockAdaptations.value = [];
    mockPush.mockReset();
  });

  test('(a) completed planned — lean matched row + detail refetch supplies streams to Body', () => {
    // The list-side matched row is LEAN (no streams), mirroring useWorkoutDetail's
    // matchedActivities which come from the lean list query.
    const leanRun = mkLeanActivity('a-run', Math.round(10 * 1609.344), 4200);
    // The single-activity detail query returns the full-res row (streams present).
    const detailRun = mkDetailActivity('a-run', Math.round(10 * 1609.344), 4200);

    mockDetail.value = baseDetail({
      matchedActivities: [leanRun],
      primaryActivityId: 'a-run',
      actual: { distanceMeters: leanRun.distance_meters!, movingTimeS: 4200, avgHr: 162 },
    });
    mockWeekly.value = {
      easyBaseline: 480,
      currentWeekIndex: 7,
      summary: { weeks: [{ weekIndex: 7, actualMeters: 62 * 1609.344, targetMeters: 70 * 1609.344 }] },
    };
    // useActivity is called twice per render in SessionView:
    //   1st call: activityId path (activityId=undefined → null id) → idle
    //   2nd call: matched detail refetch (id='a-run') → full-res detail row
    mockActivityFn.mockImplementation((_userId, actId) => {
      if (actId === 'a-run') {
        return { loading: false, error: null, activity: detailRun, weekIndex: 7, today: '2026-05-18', refetch: () => undefined };
      }
      return idleActivity;
    });

    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(tree);

    // The run readout: its name, the Analysis section, and the per-mile splits.
    expect(text).toContain('Threshold Repeats');
    expect(text).toContain('Analysis');
    // No planned-state chips on a run that happened.
    expect(text).not.toContain('Planned');
    expect(text).not.toContain('Missed');

    // The session scorecard states a shortfall ONCE. The old orange summary
    // line ("1 rep short · +24s/mi off target") restated the COMPLETED /
    // AVG REP / TARGET row above it and is deleted — replaces the three
    // `sessionExceptionLabel` formatting tests in SessionView.test.tsx.
    expect(text).not.toMatch(/reps? short/);
    expect(text).not.toContain('off target');

    // Banked forward: the run names what it put in and where the week landed.
    expect(text).toContain('Banked');
    expect(text).toContain('Week 7');
    expect(text).toContain('62.0 / 70.0');

    // Verify that useActivity was called with the matched activity id — confirming
    // the detail refetch path fired (not just the lean row).
    const detailCalls = mockActivityFn.mock.calls.filter(([, id]) => id === 'a-run');
    expect(detailCalls.length).toBeGreaterThan(0);

    act(() => tree.unmount());
  });

  test('(a2) completed planned — loading gate: spinner while matched detail loads, then run readout', () => {
    const leanRun = mkLeanActivity('a-run', Math.round(10 * 1609.344), 4200);
    const detailRun = mkDetailActivity('a-run', Math.round(10 * 1609.344), 4200);

    mockDetail.value = baseDetail({
      matchedActivities: [leanRun],
      primaryActivityId: 'a-run',
      actual: { distanceMeters: leanRun.distance_meters!, movingTimeS: 4200, avgHr: 162 },
    });

    // Phase 1: detail fetch still loading → spinner, no "Run not found"
    mockActivityFn.mockImplementation((_userId, actId) => {
      if (actId === 'a-run') {
        return { loading: true, error: null, activity: null, weekIndex: null, today: '2026-05-18', refetch: () => undefined };
      }
      return idleActivity;
    });

    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text1 = textOf(tree);
    expect(text1).not.toContain('Run not found');
    expect(text1).not.toContain('Threshold Repeats');

    // Phase 2: detail fetch resolves → run readout renders
    act(() => {
      mockActivityFn.mockImplementation((_userId, actId) => {
        if (actId === 'a-run') {
          return { loading: false, error: null, activity: detailRun, weekIndex: 7, today: '2026-05-18', refetch: () => undefined };
        }
        return idleActivity;
      });
      tree.update(screenWrapper(<SessionView workoutId="w-quality" />));
    });
    const text2 = textOf(tree);
    expect(text2).toContain('Threshold Repeats');
    expect(text2).not.toContain('Run not found');

    act(() => tree.unmount());
  });

  test('(b) upcoming planned — Planned chip + workout identity + prescription + planned total', () => {
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-18' }); // 05-18 < 05-20
    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(tree);
    expect(text).toContain('Planned');
    expect(text).not.toContain('Missed');
    // The card's identity row was deleted (it restated the hero); the type
    // now renders exactly once, in the hero eyebrow.
    expect(text).toContain('Quality  THRESHOLD');
    expect((text.match(/4 × 2 ?mi @ threshold/g) ?? []).length).toBeLessThanOrEqual(2); // hero title + structure bullet, no third copy
    expect(text).toContain('~1h11m');
    // The prescribed row: 4 reps of ~2mi at the resolved threshold pace.
    expect(text).toMatch(/4 × 2 mi/); // ~1.99mi prescribed → clean whole-mile display
    expect(text).toMatch(/threshold \d:\d\d/);
    // The planned total (16 km ≈ 9.9 mi) in the hero.
    expect(text).toContain('9.9');
    expect(text).toContain('Plan route');
    // No charts on the planned state.
    expect(text).not.toContain('Pace curve');
    act(() => tree.unmount());
  });

  test('(c) missed planned — Missed chip when the date is past', () => {
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-25' }); // 05-25 > 05-20
    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(tree);
    expect(text).toContain('Missed');
    expect(text).not.toContain('Planned');
    // The card's identity row was deleted (it restated the hero); the type
    // now renders exactly once, in the hero eyebrow.
    expect(text).toContain('Quality  THRESHOLD');
    expect((text.match(/4 × 2 ?mi @ threshold/g) ?? []).length).toBeLessThanOrEqual(2); // hero title + structure bullet, no third copy
    expect(text).toMatch(/4 × 2 mi/); // ~1.99mi prescribed → clean whole-mile display
    expect(text).not.toContain('Plan route');

    // The LABEL stays; the judgment colour does not. The week is the contract,
    // so a missed day is a fact in the neutral chip family — the warning tone
    // (C.warningText) now belongs to week-level surfaces only.
    const missedNode = tree.root
      .findAllByType(Text)
      .find((n) => flattenText(n.props.children) === 'Missed');
    expect(missedNode).toBeDefined();
    const missedStyle = StyleSheet.flatten(missedNode!.props.style);
    expect(missedStyle.color).toBe(THEMES.dark.mute);
    expect(missedStyle.color).not.toBe(THEMES.dark.warningText);
    act(() => tree.unmount());
  });

  // A week-level action does NOT belong on a single run's detail. Adjusting the
  // week is a CONTRACT-level decision and lives on the Dash contract card's
  // "Adjust", which is the one door. The detail previously offered its own
  // "Realign week"/"Adjust week" button (and a bespoke realign sheet behind it);
  // both were removed, so a miss here reports the miss and nothing more.
  test('(c3) missed planned — the detail offers no week-level door', () => {
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-25' });
    mockWeekly.value = { easyBaseline: 480, summary: null, currentWeekIndex: 7 };
    mockAdaptations.value = [];
    const tree = renderTree(<SessionView workoutId="w-quality" />);

    expect(textOf(tree)).not.toContain('Adjust week');
    expect(textOf(tree)).not.toContain('Realign week');
    expect(
      tree.root.findAll((n) => n.props?.testID === 'session-week-door'),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  test('(c4) a drifting week does not resurrect the door on the run detail', () => {
    // Even with the engine raising proposals — the case that used to route to
    // the realign sheet — the detail stays out of week-level decisions.
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-25' });
    mockWeekly.value = { easyBaseline: 480, summary: null, currentWeekIndex: 7 };
    mockAdaptations.value = [{ kind: 'redistribute', deficitMeters: 12000 }];
    const tree = renderTree(<SessionView workoutId="w-quality" />);

    expect(textOf(tree)).not.toContain('Realign week');
    expect(mockPush).not.toHaveBeenCalledWith('/realign');
    act(() => tree.unmount());
  });

  // Banked-forward: the day names the week it fed, in labels + numbers.
  test('(c5) the detail carries the week its day fed, and omits it when the week is unknown', () => {
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-25' });
    mockWeekly.value = {
      easyBaseline: 480,
      currentWeekIndex: 7,
      summary: { weeks: [{ weekIndex: 7, actualMeters: 78.3 * 1609.344, targetMeters: 100 * 1609.344 }] },
    };
    // `Week 7` is the Eyebrow's own text — the uppercase is a style, not copy.
    const withWeek = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(withWeek);
    expect(text).toContain('Week 7');
    expect(text).toContain('78.3 / 100.0');
    act(() => withWeek.unmount());

    // A week with no contract in the summary shows NOTHING rather than a
    // wrong-week total.
    mockWeekly.value = { easyBaseline: 480, currentWeekIndex: 7, summary: { weeks: [] } };
    const noWeek = renderTree(<SessionView workoutId="w-quality" />);
    expect(textOf(noWeek)).not.toContain('Week 7');
    expect(textOf(noWeek)).not.toContain('78.3 / 100.0');
    act(() => noWeek.unmount());
  });

  test('(c2) missed planned — preserves an attached route as read-only history', () => {
    mockWorkoutRoute.value = {
      data: {
        workoutId: 'w-quality',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        route: {
          id: 'r1', name: 'River loop', points: [[41.88, -87.62], [41.89, -87.61]],
          drawPath: [[41.88, -87.62], [41.89, -87.61]], distanceMeters: 9800,
          createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
          archivedAt: null, provenance: 'due_builder',
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-25' });
    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(tree);
    expect(text).toContain('Planned route');
    expect(text).toContain('River loop');
    expect(text).toContain('Read only');
    expect(text).not.toContain('Change');
    act(() => tree.unmount());
  });

  test('(b2) upcoming planned — attached route is the map-forward preparation object', () => {
    mockWorkoutRoute.value = {
      data: {
        workoutId: 'w-quality',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        route: {
          id: 'r1', name: 'River loop', points: [[41.88, -87.62], [41.89, -87.61]],
          drawPath: [[41.88, -87.62], [41.89, -87.61]], distanceMeters: 9800,
          createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
          archivedAt: null, provenance: 'due_builder',
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
    mockDetail.value = baseDetail({ matchedActivities: [], today: '2026-05-18' });
    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(tree);
    expect(text).toContain('River loop');
    expect(text).toContain('3.9 mi short');
    expect(text).toContain('Change');
    expect(text).not.toContain('Plan route');
    act(() => tree.unmount());
  });

  // The restored quality chip (Fix 2): reads the PRECOMPUTED stream_summary.quality
  // verdict (independent of Body's own live intrinsic-type recompute) and its
  // tap-to-undo persists an AsyncStorage override.
  test('(d) a run with a precomputed quality verdict shows the QUALITY chip; tapping persists the override and hides it', async () => {
    await AsyncStorage.clear();
    const qualityRun = mkQualityDetailActivity('a-run', Math.round(6 * 1609.344), 2400);

    mockDetail.value = baseDetail({
      matchedActivities: [{ ...qualityRun, streams: null, stream_summary: null }],
      primaryActivityId: 'a-run',
      actual: { distanceMeters: qualityRun.distance_meters!, movingTimeS: 2400, avgHr: 162 },
    });
    mockActivityFn.mockImplementation((_userId, actId) => {
      if (actId === 'a-run') {
        return { loading: false, error: null, activity: qualityRun, weekIndex: 7, today: '2026-05-18', refetch: () => undefined };
      }
      return idleActivity;
    });

    const tree = renderTree(<SessionView workoutId="w-quality" />);

    const findChip = () =>
      tree.root.findAll(
        (n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Quality'),
      );

    const [chip] = findChip();
    expect(chip).toBeDefined();
    expect(chip!.props.accessibilityLabel).toBe('Quality · Intervals, tap to undo');

    // Tap → persists the override (tap-to-undo). React Query batches the
    // resulting refetch notification onto a real timer (notifyManager), so the
    // re-render lands a tick after the awaited promise settles — poll for it.
    await act(async () => {
      await chip!.props.onPress();
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('quality-detect-override-a-run', '1');
    // Once the override lands, the chip no longer renders (qualityDetected flips false).
    await waitFor(() => expect(findChip()).toHaveLength(0));

    act(() => tree.unmount());
  });

  // audit-ux H2/M2 (chip exclusivity): a precomputed quality verdict is the
  // ONE chip for "what kind of run this was" — the bare intrinsic sessionType
  // read (INTERVALS/TEMPO/PROGRESSION) must not ALSO render beside it.
  test('(f) chip exclusivity — a quality verdict suppresses the bare sessionType chip', () => {
    const qualityRun = mkQualityDetailActivity('a-run', Math.round(6 * 1609.344), 2400);
    mockDetail.value = baseDetail({
      matchedActivities: [{ ...qualityRun, streams: null, stream_summary: null }],
      primaryActivityId: 'a-run',
      actual: { distanceMeters: qualityRun.distance_meters!, movingTimeS: 2400, avgHr: 162 },
    });
    mockActivityFn.mockImplementation((_userId, actId) => {
      if (actId === 'a-run') {
        return { loading: false, error: null, activity: qualityRun, weekIndex: 7, today: '2026-05-18', refetch: () => undefined };
      }
      return idleActivity;
    });

    const tree = renderTree(<SessionView workoutId="w-quality" />);

    const qualityChip = tree.root.findAll(
      (n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Quality'),
    );
    expect(qualityChip.length).toBeGreaterThan(0);

    // No bare INTERVALS/TEMPO/PROGRESSION text node renders alongside the
    // quality chip (an exact match, not a substring — the quality chip's own
    // label is "Quality · Intervals", a different string).
    const bareTypeLabels = tree.root
      .findAllByType(Text)
      .filter((n) => ['INTERVALS', 'TEMPO', 'PROGRESSION'].includes(flattenText(n.props.children)));
    expect(bareTypeLabels).toHaveLength(0);

    act(() => tree.unmount());
  });

  test('(f2) a current stored quality verdict survives after full streams are purged', () => {
    const qualityRun = mkQualityDetailActivity('a-run', Math.round(6 * 1609.344), 2400);
    const storedOnly = {
      ...qualityRun,
      streams: null,
      stream_summary: {
        ...qualityRun.stream_summary!,
        quality: { ...qualityRun.stream_summary!.quality!, v: STREAM_SUMMARY_VERSION },
      },
    } as ActivityRow;
    mockDetail.value = baseDetail({
      matchedActivities: [{ ...storedOnly, stream_summary: null }],
      primaryActivityId: 'a-run',
      actual: { distanceMeters: storedOnly.distance_meters!, movingTimeS: 2400, avgHr: 162 },
    });
    mockActivityFn.mockImplementation((_userId, actId) => (
      actId === 'a-run'
        ? { loading: false, error: null, activity: storedOnly, weekIndex: 7, today: '2026-05-18', refetch: () => undefined }
        : idleActivity
    ));

    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const chips = tree.root.findAll(
      (n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Quality'),
    );
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]!.props.accessibilityLabel).toBe('Quality · Intervals, tap to undo');
    act(() => tree.unmount());
  });

  // audit-ux H2: with no quality verdict (older rows), the bare sessionType
  // chip still renders — but neutral (no yellow), not the old solid pill.
  test('(g) no quality verdict — the intrinsic sessionType chip renders neutral, not yellow', () => {
    const leanRun = mkLeanActivity('a-run', Math.round(10 * 1609.344), 4200);
    // v4's regime segmenter needs a genuinely-hard block to classify a session
    // (a dead-constant 7:00/mi never clears the ENTER band). Build an explicit
    // tempo: easy → a sustained 15 min clearly under floor (6:00/mi) → easy.
    // The live detector reads this as TEMPO so the intrinsic chip renders.
    const detailRun = ((): ActivityRow => {
      const segs = [
        { durS: 300, paceSecMi: 510 }, // 5 min easy @ 8:30
        { durS: 900, paceSecMi: 360 }, // 15 min tempo @ 6:00 (clears floor−50)
        { durS: 300, paceSecMi: 510 }, // 5 min easy @ 8:30
      ];
      const t: number[] = [];
      const d: number[] = [];
      const v: number[] = [];
      const hr: (number | null)[] = [];
      let tAcc = 0;
      let dAcc = 0;
      for (const seg of segs) {
        const speed = 1609.344 / seg.paceSecMi; // m/s
        for (let s = 0; s < seg.durS; s += 5) {
          tAcc += 5;
          dAcc += speed * 5;
          t.push(tAcc);
          d.push(Math.round(dAcc * 100) / 100);
          v.push(speed);
          hr.push(seg.paceSecMi < 420 ? 168 : 150);
        }
      }
      return {
        ...mkLeanActivity('a-run', Math.round(dAcc), tAcc),
        streams: { t, d, v, hr, alt: null },
      } as ActivityRow;
    })();

    mockDetail.value = baseDetail({
      matchedActivities: [leanRun],
      primaryActivityId: 'a-run',
      actual: { distanceMeters: leanRun.distance_meters!, movingTimeS: 4200, avgHr: 162 },
    });
    mockActivityFn.mockImplementation((_userId, actId) => {
      if (actId === 'a-run') {
        return { loading: false, error: null, activity: detailRun, weekIndex: 7, today: '2026-05-18', refetch: () => undefined };
      }
      return idleActivity;
    });

    const tree = renderTree(<SessionView workoutId="w-quality" />);

    // No precomputed verdict on this row → no QUALITY chip.
    const qualityChip = tree.root.findAll(
      (n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Quality'),
    );
    expect(qualityChip).toHaveLength(0);

    // The bare sessionType chip renders instead — its container must NOT use
    // the yellow fill (yellow is CTA-only).
    const typeLabelNode = tree.root
      .findAllByType(Text)
      .find((n) => ['INTERVALS', 'TEMPO', 'PROGRESSION'].includes(flattenText(n.props.children)));
    expect(typeLabelNode).toBeDefined();
    const chipStyle = StyleSheet.flatten(typeLabelNode!.parent!.props.style);
    expect(chipStyle.backgroundColor).not.toBe(THEMES.dark.yellow);

    act(() => tree.unmount());
  });

  // audit-code Lane 2 [High]: the error state must offer a real retry, not a
  // dead-end message. Pressing it re-runs the underlying query (`refetch`).
  test('(e) an error state offers a Retry action that refetches the failed query', () => {
    const refetch = jest.fn();
    mockDetail.value = baseDetail({
      matchedActivities: [],
      today: '2026-05-18',
      error: new Error('network unreachable'),
      refetch,
    });
    const tree = renderTree(<SessionView workoutId="w-quality" />);
    const text = textOf(tree);
    expect(text).toContain('network unreachable');

    const retry = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Retry',
    );
    expect(retry.length).toBeGreaterThan(0);
    act(() => retry[0]!.props.onPress());
    expect(refetch).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });
});
