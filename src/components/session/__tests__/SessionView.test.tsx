/**
 * SessionView.test.tsx — pins the "intrinsic quality section must agree with
 * the stored verdict" fix under the `app` Jest project (jest-expo).
 *
 * Pins the "intrinsic quality section must agree with the stored verdict" fix
 * (.git/sdd/detector-fix-review.md): the fixture is a real interval workout the
 * LIVE `detectQuality` reads as quality intervals. When a stored current-version
 * verdict says NOT quality (e.g. a guard the live detector doesn't apply demoted
 * it), SessionView must NOT show the "Session" section + "INTERVALS" hero off the
 * live detector — the stored verdict wins. The fix short-circuits `quality` to
 * null when a stored current-version verdict says not-quality, and keeps the live
 * path only as a fallback for rows that predate it
 * (`stored.v !== STREAM_SUMMARY_VERSION`).
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import type { ActivityRow } from '@/app-lib/queries';
import type { RunStream } from '@/lib/kpi/qualityDetect';
import type { RunStreams } from '@/lib';
import { STREAM_SUMMARY_VERSION } from '@/lib/kpi/ingestVerdict';

// ---- Mocks ------------------------------------------------------------------

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null, retry: jest.fn() }),
}));

jest.mock('@/app-lib/routes', () => ({
  useWorkoutRoute: () => ({ data: null, isLoading: false, error: null, refetch: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

// Only `useActivity` (activity id path) is exercised; the workoutId path,
// corpus/plan/prediction lookups are all fed empty/idle so Body renders off
// exactly the fixture activity below.
const mockActivity: { value: ActivityRow | null } = { value: null };
jest.mock('@/app-lib/queries', () => ({
  useActivity: (_userId: unknown, id: string | null) => ({
    loading: false,
    error: null,
    activity: id ? mockActivity.value : null,
    weekIndex: null,
    today: '2026-07-06',
    refetch: jest.fn(),
  }),
  useWorkoutDetail: () => ({
    loading: false, error: null, workout: null, activities: [], matchedActivities: [],
    actual: null, primaryActivityId: null, weekIndex: null, today: '2026-07-06',
  }),
  useActivities: () => ({ data: [] }),
  useActivePlan: () => ({ data: null }),
  useWeeklyMileage: () => ({ easyBaseline: 495 }),
  useRacePrediction: () => null,
  useSetQualityOverride: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/app-lib/weekEdit', () => ({
  saveWeekEdits: jest.fn(async () => undefined),
}));

// The recovery door reads the adapt engine's own entry condition. Mocked for
// the same reason `@/app-lib/queries` is: the real module reaches Supabase at
// import time. No proposals here → no drifting week, no door.
jest.mock('@/app-lib/adapt', () => ({
  useAdaptations: () => ({ loading: false, error: null, planId: null, weekId: null, adaptations: [] }),
}));

// `@/app-lib/qualityCredit` is intentionally NOT mocked — its
// `useActivityQualityDetect` reads `activity.stream_summary.quality` for real,
// so the test exercises the actual chip-vs-section agreement the fix targets.

import {
  buildSplits,
  computeZones,
  displayHeartRate,
  edgeAwareTickLabel,
  SessionView,
  splitColumnMode,
  summarizeSplits,
} from '../SessionView';

// ---- Fixture stream ---------------------------------------------------------
// 2mi warmup @ 8:30 + 4×[~1000m @5:40 (340 s/mi) + 90s recovery] + cooldown, no
// HR, no laps. A real interval workout the LIVE v4 detector reads as quality
// intervals — the shape the legacy-fallback test needs (an unversioned row must
// fall back to the live detector and surface the Session section). The reps run
// well under the floor (340 clears the v4 ENTER band, floor 456 − 50 = 406).

const METERS_PER_MILE = 1609.344;
const SAMPLE_S = 11;
const vel = (secPerMi: number) => METERS_PER_MILE / secPerMi;

function buildStream(segs: Array<{ durationS: number; paceSecPerMi: number }>): {
  t: number[]; d: number[]; v: number[]; hr: null[];
} {
  const d: number[] = [], v: number[] = [], t: number[] = [], hr: null[] = [];
  let cumD = 0, cumT = 0;
  for (const s of segs) {
    const speed = vel(s.paceSecPerMi);
    const nSamples = Math.max(1, Math.round(s.durationS / SAMPLE_S));
    const dPer = speed * SAMPLE_S;
    for (let i = 0; i < nSamples; i++) {
      cumT += SAMPLE_S; cumD += dPer;
      t.push(cumT); d.push(cumD); v.push(speed); hr.push(null);
    }
  }
  return { t, d, v, hr };
}

const WORKOUT_SEGS: Array<{ durationS: number; paceSecPerMi: number }> = [
  { durationS: 2 * 8 * 60, paceSecPerMi: 510 },
  ...Array.from({ length: 4 }, () => [
    { durationS: 210, paceSecPerMi: 340 }, // ~1000m rep, clears ENTER
    { durationS: 90, paceSecPerMi: 540 },  // recovery
  ]).flat(),
  { durationS: 5 * 60, paceSecPerMi: 510 },
];
const workoutStream = buildStream(WORKOUT_SEGS);
const distanceMeters = workoutStream.d[workoutStream.d.length - 1] ?? 0;
const movingS = workoutStream.t[workoutStream.t.length - 1] ?? 0;

// Premise this test pins: the live v4 detector reads this shape as quality
// intervals (isQuality true, kind 'intervals', 4 ~1000m blocks) — so a stored
// not-quality verdict is the only thing that can silence the Session section.
const FLOOR = { paceFloorSecPerMi: 456, hrFloor: null as number | null, easyBaselineSecPerMi: 510 };

function baseActivity(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 'act-stride',
    source: 'strava',
    source_id: 'sid-1',
    name: 'Long run + strides',
    local_date: '2026-07-02',
    distance_meters: distanceMeters,
    moving_time_s: movingS,
    elapsed_time_s: movingS,
    avg_hr: null,
    user_note: null,
    start_date: '2026-07-02T13:00:00Z',
    avg_temp_c: null,
    best_efforts: null,
    workout_type: null,
    stream_summary: null,
    streams: workoutStream,
    route: null,
    laps: null,
    max_hr: null,
    suffer_score: null,
    shoe_id: null,
    ...overrides,
  } as ActivityRow;
}

/** A genuinely easy steady stream — nothing for the live interpreter to find.
 *  The Session section is now driven by the LIVE interpreter resolved through
 *  overrides (the stored short-circuit was removed with the v9 CP engine, and a
 *  current-version stored verdict can never disagree with the live read anyway
 *  — ingest ran the same engine on the same stream). So the not-quality fixture
 *  must carry a stream the interpreter also rules not-quality. */
const easyStream = buildStream([{ durationS: 50 * 60, paceSecPerMi: 510 }]);

/** Stored current-version verdict — the guarded ingest tree correctly ruled NOT quality. */
const v2NotQuality = baseActivity({
  streams: easyStream,
  distance_meters: easyStream.d[easyStream.d.length - 1] ?? 0,
  moving_time_s: easyStream.t[easyStream.t.length - 1] ?? 0,
  elapsed_time_s: easyStream.t[easyStream.t.length - 1] ?? 0,
  stream_summary: {
    pace_curve: [],
    pace_duration_curve: [],
    early_miles: null,
    quality: {
      v: STREAM_SUMMARY_VERSION,
      isQuality: false,
      kind: 'none',
      blocks: [],
      summary: '',
      qualityTimeMin: 0,
      qualityDistanceMeters: 0,
      source: 'stream',
      floor: FLOOR,
    },
  } as ActivityRow['stream_summary'],
});

/** Pre-v2 legacy row — no version stamp on the stored verdict (predates the
 *  laps+stream+HR ingest tree). The live detector remains the ONLY fallback
 *  for rows like this until they're re-enriched. */
const preV2Legacy = baseActivity({
  stream_summary: {
    pace_curve: [],
    pace_duration_curve: [],
    early_miles: null,
    quality: {
      // no `v` field — simulates a row written before STREAM_SUMMARY_VERSION.
      isQuality: false,
      kind: 'none',
      blocks: [],
      summary: '',
      qualityTimeMin: 0,
      qualityDistanceMeters: 0,
      source: 'stream',
      floor: FLOOR,
    },
  } as ActivityRow['stream_summary'],
});

// ---- Helpers -----------------------------------------------------------------

async function render(activity: ActivityRow): Promise<ReactTestRenderer> {
  mockActivity.value = activity;
  const qc = new QueryClient();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={qc}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 47, left: 0, right: 0, bottom: 34 },
          }}
        >
          <ThemeProvider preference="dark">
            <SessionView activityId={activity.id} />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

/** Count rendered <Text> nodes whose flattened string content is exactly `want`. */
function countText(tree: ReactTestRenderer, want: string): number {
  const json = tree.toJSON();
  let count = 0;
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    const n = node as { type?: string; children?: unknown[] };
    if (n.type === 'Text' && Array.isArray(n.children)) {
      const text = n.children.filter((c) => typeof c === 'string').join('');
      if (text === want) count++;
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(json);
  return count;
}

// ---- Tests -------------------------------------------------------------------

describe('SessionView intrinsic quality section vs stored verdict', () => {
  it('current-version stored not-quality (easy stream, live interpreter agrees): no "Session" section, no bare INTERVALS hero label', async () => {
    const tree = await render(v2NotQuality);
    expect(countText(tree, 'Session')).toBe(0);
    expect(countText(tree, 'INTERVALS')).toBe(0);
    expect(tree.root.findAll((node) => node.props?.accessibilityLabel === 'Back')).not.toHaveLength(0);
    expect(tree.root.findAll((node) => node.props?.accessibilityLabel === 'Close')).toHaveLength(0);
    // The safe-area offset lives on the nav ROW (OverlayNav), not on this
    // wrapper. It used to sit on both: the wrapper applied `topInset +
    // space.sm` and the nested OverlayNav added another `space.sm`, so the
    // rendered offset was 8pt larger than this assertion ever checked. Reading
    // the row is what actually pins the runner-visible position.
    const compact = tree.root.findByProps({ testID: 'session-hero-compact' });
    expect(StyleSheet.flatten(compact.props.style).paddingTop).toBeUndefined();
    const navRow = compact.findAll((n) => typeof StyleSheet.flatten(n.props?.style)?.paddingTop === 'number')[0];
    expect(navRow).toBeDefined();
    expect(StyleSheet.flatten(navRow!.props.style).paddingTop).toBe(47 + space.sm);
    act(() => tree.unmount());
  });

  it('unversioned legacy row: live-detector fallback still renders the Session section + INTERVALS label', async () => {
    const tree = await render(preV2Legacy);
    expect(countText(tree, 'Session')).toBeGreaterThan(0);
    expect(countText(tree, 'INTERVALS')).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('puts the Due-specific session read before generic analysis and raw ledgers', async () => {
    const tree = await render({
      ...preV2Legacy,
      laps: [{ distance: METERS_PER_MILE, moving_time: 360, average_heartrate: 160 }],
    });
    const sectionLabels = tree.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Open '))
      .map((node) => node.props.accessibilityLabel as string);

    expect(sectionLabels.indexOf('Open Session details')).toBeLessThan(sectionLabels.indexOf('Open Analysis details'));
    expect(sectionLabels.indexOf('Open Pace curve details')).toBeLessThan(sectionLabels.indexOf('Open Splits details'));
    act(() => tree.unmount());
  });

  it('does not render a dead hero menu and exposes chart and rep controls semantically', async () => {
    const tree = await render(preV2Legacy);
    expect(tree.root.findAll((node) => node.props?.accessibilityLabel === 'More actions')).toHaveLength(0);

    const selectedPeriod = tree.root.findAll((node) => node.props?.accessibilityLabel === '12W comparison period')[0];
    expect(selectedPeriod?.props.accessibilityRole).toBe('button');
    expect(selectedPeriod?.props.accessibilityState).toEqual({ selected: true });

    const rep = tree.root.findAll((node) => typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Rep '))[0];
    expect(rep?.props.accessibilityRole).toBe('button');
    expect(rep?.props.accessibilityState).toEqual({ selected: false });
    act(() => tree.unmount());
  });

  it('uses the Analysis scorecard grammar, names rep time precisely, and removes the single-series pace legend', async () => {
    const tree = await render(preV2Legacy);
    expect(countText(tree, 'Avg rep')).toBeGreaterThan(0);
    expect(countText(tree, 'Target')).toBeGreaterThan(0);
    expect(countText(tree, 'Rep time')).toBeGreaterThan(0);
    expect(countText(tree, 'Work')).toBe(0);
    expect(countText(tree, 'ACTUAL  ')).toBeGreaterThan(0);
    expect(countText(tree, 'pace')).toBe(0);
    act(() => tree.unmount());
  });

  it('labels the best-effort ledger so elapsed time and pace are unambiguous', async () => {
    const tree = await render({
      ...preV2Legacy,
      best_efforts: [{ name: '1 mile', distance_m: METERS_PER_MILE, elapsed_s: 363, start_date: '2026-07-02T13:00:00Z' }],
    });
    expect(countText(tree, 'DISTANCE')).toBeGreaterThan(0);
    expect(countText(tree, 'TIME')).toBeGreaterThan(0);
    expect(countText(tree, 'PACE')).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('retires the pace-curve scrub guidance after the runner uses it once', async () => {
    const tree = await render(preV2Legacy);
    expect(countText(tree, 'Drag to inspect any duration')).toBe(1);

    const scrubber = tree.root.findAll((node) => node.props?.testID === 'pace-curve-scrubber')[0];
    expect(scrubber).toBeDefined();
    act(() => {
      scrubber!.props.onTouchStart({ nativeEvent: { locationX: 140 } });
    });

    expect(countText(tree, 'Drag to inspect any duration')).toBe(0);
    const activeChart = tree.root.findAll((node) => (
      node.props?.accessibilityRole === 'image'
      && typeof node.props?.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.startsWith('Pace curve for this run')
    ))[0];
    expect(activeChart?.props.accessibilityLabel).toMatch(/Inspecting \d+\.\d{2} miles over/);
    act(() => tree.unmount());
  });
});

// `sessionExceptionLabel` and its three formatting tests are GONE: the line it
// formatted ("1 rep short · +24s/mi off target") was a restatement of the
// COMPLETED / AVG REP / TARGET row directly above it, and it wore the week's
// warning colour on a day surface. The behaviour that replaced it — the
// scorecard states the shortfall once and no restatement line follows — is
// pinned on the plan-aware path in `app/__tests__/workoutSession.test.tsx` (a),
// which is where a real prescription vs. a real run actually renders.

describe('displayHeartRate', () => {
  it('keeps the raw peak but excludes optical-sensor acquisition values', () => {
    const hr = [48, 52, 61, 84, 102, 121, 138, 150, 160, 171, 184, 178, 168, 162, 158, 154, 150];
    const streams = {
      t: hr.map((_, index) => index * 5),
      d: hr.map((_, index) => index * 20),
      v: hr.map(() => 4),
      hr,
    } as RunStreams;

    const display = displayHeartRate(streams);
    expect(display).not.toBeNull();
    expect(display?.values[0]).toBeNull();
    expect(display?.min).toBeGreaterThan(48);
    expect(display?.max).toBe(184);
  });
});

describe('split hardening', () => {
  const lap = (distance: number, movingTime: number, averageHr = 140) => ({
    distance,
    moving_time: movingTime,
    average_heartrate: averageHr,
  });

  it('preserves every valid backend lap, including a tiny terminal lap', () => {
    const splits = buildSplits(baseActivity({
      laps: [lap(METERS_PER_MILE, 500), lap(METERS_PER_MILE, 490), lap(51, 14)],
    }));

    expect(splits).toHaveLength(3);
    expect(splits.map((split) => split.distanceMeters)).toEqual([METERS_PER_MILE, METERS_PER_MILE, 51]);
    expect(splits.map((split) => split.label)).toEqual(['1', '2', '3']);
  });

  it('preserves a tiny interior lap and a small final rep near the workout cadence', () => {
    const interior = buildSplits(baseActivity({
      laps: [lap(METERS_PER_MILE, 500), lap(50, 10), lap(METERS_PER_MILE, 490)],
    }));
    const shortCadence = buildSplits(baseActivity({
      laps: [lap(400, 80), lap(50, 10)],
    }));

    expect(interior).toHaveLength(3);
    expect(interior[1]?.distanceMeters).toBe(50);
    expect(shortCadence).toHaveLength(2);
    expect(shortCadence[1]?.distanceMeters).toBe(50);
  });

  it('does not derive a second split ledger when the backend has no laps', () => {
    expect(buildSplits(baseActivity({ laps: null }))).toEqual([]);
  });

  it('uses # + distance for a singleton whole-run lap and mixed workout laps', () => {
    const wholeRun = buildSplits(baseActivity({ laps: [lap(9761, 3169)] }));
    const mixed = buildSplits(baseActivity({ laps: [lap(METERS_PER_MILE, 500), lap(400, 90)] }));
    const miles = buildSplits(baseActivity({ laps: [lap(METERS_PER_MILE, 500), lap(METERS_PER_MILE, 490)] }));

    expect(splitColumnMode(wholeRun)).toBe('distance');
    expect(splitColumnMode(mixed)).toBe('distance');
    expect(splitColumnMode(miles)).toBe('mile');
  });

  it('distance-weights every displayed backend lap in the summary', () => {
    const rows = buildSplits(baseActivity({
      laps: [lap(METERS_PER_MILE, 500), lap(100, 20)],
    }));
    const summary = summarizeSplits(rows);

    expect(summary?.avg).toBeCloseTo(((500 + 20) / (METERS_PER_MILE + 100)) * 1000);
    expect(summary?.fastSplit.label).toBe('2');
    expect(summary?.slowSplit.label).toBe('1');
  });

  it('renders a single whole-run lap as a compact lap summary', async () => {
    const tree = await render(baseActivity({ laps: [lap(9761, 3169)] }));
    expect(countText(tree, '1 lap')).toBe(1);
    expect(countText(tree, '6.07 mi')).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});

describe('heart-rate hardening', () => {
  it('does not charge an auto-pause gap or stopped samples to a heart-rate zone', () => {
    const streams = {
      t: [0, 1, 2, 102, 103, 104],
      d: [0, 4, 8, 8, 12, 16],
      v: [4, 4, 4, 0, 4, 4],
      hr: [130, 130, 130, 130, 130, 130],
    } as RunStreams;

    const zones = computeZones(streams, 200);
    expect(zones.rows.reduce((sum, row) => sum + row.sec, 0)).toBe(4);
    expect(zones.rows[1]?.sec).toBe(4);
    expect(zones.rows[1]?.avgHr).toBe(130);
  });

  it('time-weights zone pace so a brief fast sample cannot dominate the readout', () => {
    const streams = {
      t: [0, 1, 2, 12],
      d: [0, 10, 14, 54],
      v: [4, 10, 4, 4],
      hr: [130, 130, 130, 130],
    } as RunStreams;

    const zones = computeZones(streams, 200);
    // One second at 10 m/s and eleven seconds at 4 m/s. A sample-count mean
    // would let the brief burst own one third of the result; moving-time
    // weighting keeps it to its honest one-twelfth contribution.
    expect(zones.rows[1]?.avgPace).toBeCloseTo(((METERS_PER_MILE / 10) + (METERS_PER_MILE / 4) * 11) / 12);
  });

  it('anchors a tick label inside either chart edge', () => {
    expect(edgeAwareTickLabel(2, 0, 338)).toEqual({ x: 0, anchor: 'start' });
    expect(edgeAwareTickLabel(337, 0, 338)).toEqual({ x: 338, anchor: 'end' });
    expect(edgeAwareTickLabel(170, 0, 338)).toEqual({ x: 170, anchor: 'middle' });
  });
});
