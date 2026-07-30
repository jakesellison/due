/**
 * Tests for qualityCredit.ts.
 *
 * Covers the sync, IO-free logic:
 *  - computeEasyBaselineSecPerMi
 *  - detectWeekQuality
 *
 * ...and the async hooks, via renderHook + a real QueryClient:
 *  - useActivityQualityDetect (reads the precomputed stream_summary.quality
 *    verdict + the AsyncStorage override — the run-detail quality chip)
 *  - useSetQualityOverride (persist + optimistic cache flip + invalidate — the
 *    chip's tap-to-undo)
 *
 * detectWeekQuality / useActivityQualityDetect read the PRECOMPUTED
 * per-activity verdict off `stream_summary.quality` (Task 2) — list rows no
 * longer carry raw streams, so these fixtures set `streams: null` and populate
 * `stream_summary.quality` directly instead of building synthetic pace streams.
 *
 * Uses the same mock pattern as adaptDerive.test.ts (mock supabase + AsyncStorage).
 */

// Supabase is not called inside the pure helpers; mock to satisfy imports.
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

// AsyncStorage is imported transitively; provide a minimal stub. Individual
// hook tests override the resolved value per-test via the imported mock.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  blendWeekQuality,
  computeEasyBaselineSecPerMi,
  detectWeekQuality,
  isProvenStreamless,
  qualityDayFallbackMeters,
  useActivityQualityDetect,
  useSetQualityOverride,
  FALLBACK_EASY_BASELINE_SEC_PER_MI,
} from '../qualityCredit';
import type { ActivityRow, WorkoutRow } from '../queries';
import type { WorkoutStructure } from '@/lib';
import type { QualitySummary } from '@/lib/run/streamSummary';

const METERS_PER_MILE = 1609.344;
const EMPTY_STRUCTURE: WorkoutStructure = [];

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeActivity(
  overrides: Partial<ActivityRow> & { id: string },
): ActivityRow {
  return {
    source: 'strava',
    source_id: overrides.id,
    name: null,
    local_date: '2026-06-15',
    distance_meters: 8 * METERS_PER_MILE,
    moving_time_s: 3600, // 8:00/mi (480 s/mi)
    elapsed_time_s: null,
    avg_hr: null,
    user_note: null,
    start_date: null,
    avg_temp_c: null,
    best_efforts: null,
    workout_type: null,
    stream_summary: null,
    streams: null,
    route: null,
    laps: null,
    max_hr: null,
    suffer_score: null,
    shoe_id: null,
    ...overrides,
  };
}

function makeWorkout(
  overrides: Partial<WorkoutRow> & { id: string },
): WorkoutRow {
  return {
    week_id: 'week-1',
    date: '2026-06-15',
    type: 'easy',
    title: 'Easy run',
    planned_distance_meters: 12000,
    planned_duration_s: null,
    structure: EMPTY_STRUCTURE,
    is_quality: false,
    notes: null,
    ...overrides,
  };
}

/**
 * A lean list-row activity carrying a PRECOMPUTED quality verdict in
 * `stream_summary.quality` — the shape written server-side at ingest (Task 2).
 * `streams: null` mirrors the real list-query row (C2's whole point).
 */
function qualityActivity(
  id: string,
  meters: number,
  opts?: { local_date?: string; isQuality?: boolean; kind?: QualitySummary['kind'] },
): ActivityRow {
  const isQuality = opts?.isQuality ?? true;
  // kind tracks block structure: the detector emits 'none' whenever a run isn't
  // quality (hasStructure ⇒ isQuality), and resolveQuality's flat-row fallback
  // credits off `kind` — so a non-quality fixture must carry kind 'none' like
  // every real row does.
  const kind = opts?.kind ?? (isQuality ? 'intervals' : 'none');
  const quality: QualitySummary = {
    isQuality,
    kind,
    blocks: [
      { distanceMeters: meters / 4, paceSecPerMi: 400, durationS: 180, startIdx: 0, endIdx: 10 },
      { distanceMeters: meters / 4, paceSecPerMi: 400, durationS: 180, startIdx: 20, endIdx: 30 },
      { distanceMeters: meters / 4, paceSecPerMi: 400, durationS: 180, startIdx: 40, endIdx: 50 },
      { distanceMeters: meters / 4, paceSecPerMi: 400, durationS: 180, startIdx: 60, endIdx: 70 },
    ],
    summary: '12 min @ threshold + 4×0.5mi @ 6:40',
    qualityTimeMin: 12,
    qualityDistanceMeters: meters,
    floor: { paceFloorSecPerMi: 450, hrFloor: null, easyBaselineSecPerMi: 495 },
  };
  return makeActivity({
    id,
    ...(opts?.local_date ? { local_date: opts.local_date } : {}),
    streams: null,
    stream_summary: {
      pace_curve: [],
      pace_duration_curve: [],
      early_miles: null,
      quality,
    },
  });
}

// ── computeEasyBaselineSecPerMi ───────────────────────────────────────────────

describe('computeEasyBaselineSecPerMi', () => {
  test('returns FALLBACK when no activities', () => {
    const result = computeEasyBaselineSecPerMi([], []);
    expect(result).toBe(FALLBACK_EASY_BASELINE_SEC_PER_MI);
  });

  test('returns FALLBACK when fewer than 3 easy activities', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-06-10', type: 'easy', is_quality: false }),
      makeWorkout({ id: 'w2', date: '2026-06-12', type: 'easy', is_quality: false }),
    ];
    const activities = [
      makeActivity({ id: 'a1', local_date: '2026-06-10', distance_meters: 5000, moving_time_s: 1500 }),
      makeActivity({ id: 'a2', local_date: '2026-06-12', distance_meters: 5000, moving_time_s: 1500 }),
    ];
    expect(computeEasyBaselineSecPerMi(activities, workouts)).toBe(FALLBACK_EASY_BASELINE_SEC_PER_MI);
  });

  test('returns median pace from 5 easy activities (ignores quality dates)', () => {
    // 5 easy days at known paces
    const dates = ['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-07', '2026-06-09'];
    // Paces: 480, 490, 500, 510, 520 s/mi → median = 500
    const times = [480, 490, 500, 510, 520]; // sec/mi

    const workouts = dates.map((date, i) =>
      makeWorkout({ id: `w${i}`, date, type: 'easy', is_quality: false }),
    );
    // Add a quality workout on a separate date — its activity should be excluded.
    workouts.push(makeWorkout({ id: 'wq', date: '2026-06-08', type: 'quality', is_quality: true }));

    const activities = dates.map((date, i) =>
      makeActivity({
        id: `a${i}`,
        local_date: date,
        distance_meters: METERS_PER_MILE,
        moving_time_s: times[i]!,
      }),
    );
    // Quality-day activity — should NOT be included.
    activities.push(
      makeActivity({ id: 'aq', local_date: '2026-06-08', distance_meters: 10000, moving_time_s: 3000 }),
    );

    const result = computeEasyBaselineSecPerMi(activities, workouts);
    expect(result).toBeCloseTo(500, 0); // median of 480,490,500,510,520
  });

  test('excludes sub-km activities', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-06-10', type: 'easy', is_quality: false }),
      makeWorkout({ id: 'w2', date: '2026-06-11', type: 'easy', is_quality: false }),
      makeWorkout({ id: 'w3', date: '2026-06-12', type: 'easy', is_quality: false }),
    ];
    const activities = [
      makeActivity({ id: 'a1', local_date: '2026-06-10', distance_meters: 5000, moving_time_s: 1500 }),
      makeActivity({ id: 'a2', local_date: '2026-06-11', distance_meters: 5000, moving_time_s: 1500 }),
      // Sub-km: should be excluded
      makeActivity({ id: 'a3', local_date: '2026-06-12', distance_meters: 500, moving_time_s: 100 }),
    ];
    // Only 2 valid easy activities → fallback
    expect(computeEasyBaselineSecPerMi(activities, workouts)).toBe(FALLBACK_EASY_BASELINE_SEC_PER_MI);
  });
});

// ── detectWeekQuality ─────────────────────────────────────────────────────────

describe('detectWeekQuality', () => {
  const FOUR_MILES = 4 * METERS_PER_MILE;

  test('returns qualityDetected=false when no activities', () => {
    const result = detectWeekQuality([], null, new Set());
    expect(result.qualityDetected).toBe(false);
    expect(result.bestActivityId).toBeNull();
    expect(result.detectResult).toBeNull();
    expect(result.matchNote).toBeNull();
  });

  test('returns qualityDetected=false for a lean row with no stream_summary.quality', () => {
    // The lean list-row shape: no raw streams AND no precomputed verdict.
    const activities = [makeActivity({ id: 'a1', streams: null, stream_summary: null })];
    const result = detectWeekQuality(activities, null, new Set());
    expect(result.qualityDetected).toBe(false);
    expect(result.bestActivityId).toBeNull();
  });

  test('returns qualityDetected=false when stream_summary exists but quality is absent (pre-C2 row)', () => {
    const activities = [
      makeActivity({
        id: 'a1',
        streams: null,
        stream_summary: { pace_curve: [], pace_duration_curve: [], early_miles: null },
      }),
    ];
    const result = detectWeekQuality(activities, null, new Set());
    expect(result.qualityDetected).toBe(false);
  });

  test('returns qualityDetected=true for an activity with a precomputed quality verdict', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    const result = detectWeekQuality(activities, null, new Set());
    expect(result.qualityDetected).toBe(true);
    expect(result.bestActivityId).toBe('a-intervals');
    expect(result.detectResult).not.toBeNull();
    expect(result.detectResult?.isQuality).toBe(true);
    expect(result.detectedQualityMeters).toBeCloseTo(FOUR_MILES, 0);
  });

  test('respects overrides — overridden activity is not credited', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    const overrides = new Set(['a-intervals']);
    const result = detectWeekQuality(activities, null, overrides);
    expect(result.qualityDetected).toBe(false);
  });

  test('picks the first quality activity when multiple exist', () => {
    const activities = [
      qualityActivity('a-first', FOUR_MILES, { local_date: '2026-06-17' }),
      qualityActivity('a-second', FOUR_MILES, { local_date: '2026-06-18' }),
    ];
    const result = detectWeekQuality(activities, null, new Set());
    expect(result.qualityDetected).toBe(true);
    expect(result.bestActivityId).toBe('a-first');
  });

  test('returns matchNote when planned quality workout structure matches the stored blocks', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    // A planned 4x1mi structure — the fixture's 4 equal-sized blocks should match.
    const structure: WorkoutStructure = [
      {
        kind: 'repeat',
        sets: 4,
        children: [
          { kind: 'interval', target: { by: 'distance', distance_m: METERS_PER_MILE } },
          { kind: 'recovery', target: { by: 'time', duration_s: 90 } },
        ],
      },
    ];
    const plannedQuality = { id: 'wq', structure };
    const result = detectWeekQuality(activities, plannedQuality, new Set());
    expect(result.qualityDetected).toBe(true);
    expect(result.matchNote).not.toBeNull();
    expect(result.matchNote).toContain('matches your planned');
  });

  test('returns matchNote=null when no planned quality workout', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    const result = detectWeekQuality(activities, null, new Set());
    expect(result.qualityDetected).toBe(true);
    expect(result.matchNote).toBeNull();
  });

  test('returns matchNote=null when planned workout has empty structure', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    const plannedQuality = { id: 'wq', structure: EMPTY_STRUCTURE };
    const result = detectWeekQuality(activities, plannedQuality, new Set());
    expect(result.qualityDetected).toBe(true);
    expect(result.matchNote).toBeNull();
  });

  // ── Sufficiency gate ────────────────────────────────────────────────────────

  test('sufficiency gate: detected distance meeting ≥60% of prescribed credits the session', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    // Prescribed via a small structure well below the detected 4-mile distance.
    const structure: WorkoutStructure = [
      {
        kind: 'repeat',
        sets: 1,
        children: [
          { kind: 'interval', target: { by: 'distance', distance_m: Math.round(0.5 * METERS_PER_MILE) } },
        ],
      },
    ];
    const plannedQuality = {
      id: 'wq',
      structure,
      plannedDistanceMeters: Math.round(0.5 * METERS_PER_MILE),
    };
    const result = detectWeekQuality(activities, plannedQuality, new Set());
    expect(result.qualityDetected).toBe(true);
  });

  test('sufficiency gate: detected distance < 60% of prescribed zeroes qualityDetected but keeps detectedQualityMeters', () => {
    // Detected quality distance is small (1 mile equivalent).
    const oneMile = METERS_PER_MILE;
    const activities = [qualityActivity('a-small', oneMile)];
    // Large prescription via empty structure + big planned distance (10mi):
    // prescribedQualityMeters falls back to 60% of planned distance = 6mi.
    // gate: detected (1mi) ≥ 60% × 6mi (3.6mi)? No → fails.
    const largePlannedDistM = 10 * METERS_PER_MILE;
    const result = detectWeekQuality(
      activities,
      { id: 'wq', structure: EMPTY_STRUCTURE, plannedDistanceMeters: largePlannedDistM },
      new Set(),
    );

    expect(result.qualityDetected).toBe(false);
    expect(result.bestActivityId).toBeNull();
    // detectResult still carries the raw detection (for the chip / matchNote).
    expect(result.detectResult).not.toBeNull();
    expect(result.detectResult?.isQuality).toBe(true);
    // detectedQualityMeters is preserved even though the gate failed — the
    // Dash "X / Y mi" tile still needs the partial numerator.
    expect(result.detectedQualityMeters).toBeCloseTo(oneMile, 0);
    expect(result.prescribedQualityMeters).toBeCloseTo(largePlannedDistM * 0.6, 0);
  });

  test('sufficiency gate passes when no planned quality workout (no gate applied)', () => {
    const activities = [qualityActivity('a-intervals', FOUR_MILES)];
    // No planned quality workout → gate not applied → qualityDetected=true
    const result = detectWeekQuality(activities, null, new Set());
    expect(result.qualityDetected).toBe(true);
  });
});

// ── blendWeekQuality (quality banks wherever it appears) ──────────────────────

describe('blendWeekQuality', () => {
  const MI = 1609.344;
  // 5×2mi @ threshold (the tagged quality session) → 10mi hard.
  const intervals: WorkoutStructure = [
    {
      kind: 'repeat',
      sets: 5,
      children: [
        { kind: 'interval', target: { by: 'distance', distance_m: 2 * MI, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 }, hr_zone: 'threshold' } },
        { kind: 'recovery', target: { by: 'time', duration_s: 90 } },
      ],
    },
  ];
  // A 20mi long run: 10mi easy (hr_zone easy, but a relative MP reference)
  // then a 10mi MP finish (hr_zone steady). Only the finish is quality.
  const longWithMp: WorkoutStructure = [
    { kind: 'steady', target: { by: 'distance', distance_m: 10 * MI, hr_zone: 'easy', pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 } } },
    { kind: 'steady', target: { by: 'distance', distance_m: 10 * MI, hr_zone: 'steady', pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 } } },
  ];

  test('sums prescribed hard-miles across all week workouts; the long run adds only its MP finish', () => {
    const res = blendWeekQuality(
      [
        { structure: intervals, plannedTotalMeters: 14 * MI },
        { structure: longWithMp, plannedTotalMeters: null },
      ],
      [],
      new Set(),
    );
    // 10mi threshold + 10mi MP finish (the easy leg is excluded despite its MP label).
    expect(res.prescribedMeters).toBeCloseTo(20 * MI, 0);
    expect(res.detectedMeters).toBe(0);
  });

  test('sums detected hard-miles across ALL activities (not just the single best)', () => {
    const res = blendWeekQuality([], [qualityActivity('a1', 8 * MI), qualityActivity('a2', 9 * MI)], new Set());
    expect(res.detectedMeters).toBeCloseTo(17 * MI, 0);
  });

  test('excludes overridden activities from the detected sum', () => {
    const res = blendWeekQuality([], [qualityActivity('a1', 8 * MI), qualityActivity('a2', 9 * MI)], new Set(['a2']));
    expect(res.detectedMeters).toBeCloseTo(8 * MI, 0);
  });

  test('honors the authoritative quality_override column in plan-wide mileage totals', () => {
    const suppressed = qualityActivity('a2', 9 * MI);
    suppressed.quality_override = { choice: 'none' };
    const res = blendWeekQuality([], [qualityActivity('a1', 8 * MI), suppressed], new Set());
    expect(res.detectedMeters).toBeCloseTo(8 * MI, 0);
  });

  test('a pure-easy run contributes 0 quality (no hard segments, no 0.6×total fallback)', () => {
    const easy: WorkoutStructure = [{ kind: 'steady', target: { by: 'distance', distance_m: 10 * MI, hr_zone: 'easy' } }];
    const res = blendWeekQuality([{ structure: easy, plannedTotalMeters: null }], [], new Set());
    expect(res.prescribedMeters).toBe(0);
  });
});

// ── isProvenStreamless / qualityDayFallbackMeters (issue #139) ────────────────

describe('isProvenStreamless', () => {
  test('pending enrichment (enriched_at null, no summary) is NOT proven streamless', () => {
    const a = makeActivity({ id: 'a1', enriched_at: null, stream_summary: null });
    expect(isProvenStreamless(a)).toBe(false);
  });

  test('enriched_at absent (locally built row) is NOT proven streamless', () => {
    const a = makeActivity({ id: 'a1', stream_summary: null });
    expect(isProvenStreamless(a)).toBe(false);
  });

  test('enrich attempted with no streams (enriched_at set, summary null) IS proven streamless', () => {
    const a = makeActivity({ id: 'a1', enriched_at: '2026-07-06T12:00:00Z', stream_summary: null });
    expect(isProvenStreamless(a)).toBe(true);
  });

  test('an enriched row carrying a summary (streams existed) is NOT streamless', () => {
    const a = qualityActivity('a1', 4 * METERS_PER_MILE);
    a.enriched_at = '2026-07-06T12:00:00Z';
    expect(isProvenStreamless(a)).toBe(false);
  });
});

describe('qualityDayFallbackMeters', () => {
  const QUALITY_DAY = '2026-06-15';
  const PRESCRIBED = 10 * METERS_PER_MILE;
  const EASY_BASELINE = 501; // 8:21/mi — hard ceiling = 501−60 = 441s/mi (7:21)
  // Pace helper: moving_time_s for `mi` miles at `paceSecMi` per mile.
  const timeFor = (mi: number, paceSecMi: number) => Math.round(mi * paceSecMi);

  test('a PENDING-enrichment activity on the quality day credits 0 (issue #139 repro)', () => {
    // The live repro: an easy 14mi run on the Q14 day, streams + verdict not
    // yet ingested (enriched_at null). Must contribute NO quality credit.
    const acts = [
      makeActivity({
        id: 'a-pending',
        local_date: QUALITY_DAY,
        distance_meters: 14 * METERS_PER_MILE,
        enriched_at: null,
        stream_summary: null,
      }),
    ];
    expect(qualityDayFallbackMeters(acts, QUALITY_DAY, PRESCRIBED, EASY_BASELINE)).toBe(0);
  });

  test('a proven-streamless HARD-average run on the quality day credits the prescribed distance', () => {
    // A streamless quality session: 14mi averaging 7:10/mi (reps drag the whole
    // run under easy) — clears the hard ceiling, so it credits.
    const acts = [
      makeActivity({
        id: 'a-manual',
        local_date: QUALITY_DAY,
        distance_meters: 14 * METERS_PER_MILE,
        moving_time_s: timeFor(14, 430),
        enriched_at: '2026-06-15T18:00:00Z',
        stream_summary: null,
      }),
    ];
    expect(qualityDayFallbackMeters(acts, QUALITY_DAY, PRESCRIBED, EASY_BASELINE)).toBe(PRESCRIBED);
  });

  test('a proven-streamless EASY-average run on the quality day credits 0 (2026-07-07 repro)', () => {
    // The live incident: an easy 14mi run (8:35/mi avg) on the quality day,
    // streams lost. "Ran on the quality day" must NOT be a binary tag — an
    // easy-paced run is not the threshold session.
    const acts = [
      makeActivity({
        id: 'a-easy-streamless',
        local_date: QUALITY_DAY,
        distance_meters: 14 * METERS_PER_MILE,
        moving_time_s: timeFor(14, 515), // 8:35/mi — above the hard ceiling
        enriched_at: '2026-07-07T18:00:00Z',
        stream_summary: null,
      }),
    ];
    expect(qualityDayFallbackMeters(acts, QUALITY_DAY, PRESCRIBED, EASY_BASELINE)).toBe(0);
  });

  test('a verdict-bearing activity on the quality day gets NO fallback credit (verdict decides)', () => {
    // A negative verdict (easy run) on the quality day: the fallback must not
    // resurrect credit that detection explicitly denied.
    const easyOnQualityDay = qualityActivity('a-easy', 14 * METERS_PER_MILE, {
      local_date: QUALITY_DAY,
      isQuality: false,
    });
    easyOnQualityDay.enriched_at = '2026-06-15T18:00:00Z';
    expect(qualityDayFallbackMeters([easyOnQualityDay], QUALITY_DAY, PRESCRIBED, EASY_BASELINE)).toBe(0);
  });

  test('proven-streamless run on a DIFFERENT day credits nothing', () => {
    const acts = [
      makeActivity({
        id: 'a-other-day',
        local_date: '2026-06-16',
        distance_meters: 14 * METERS_PER_MILE,
        moving_time_s: timeFor(14, 430),
        enriched_at: '2026-06-16T18:00:00Z',
        stream_summary: null,
      }),
    ];
    expect(qualityDayFallbackMeters(acts, QUALITY_DAY, PRESCRIBED, EASY_BASELINE)).toBe(0);
  });

  test('no quality day / no prescription / no baseline credits nothing', () => {
    const acts = [
      makeActivity({
        id: 'a-manual',
        local_date: QUALITY_DAY,
        distance_meters: 14 * METERS_PER_MILE,
        moving_time_s: timeFor(14, 430),
        enriched_at: '2026-06-15T18:00:00Z',
        stream_summary: null,
      }),
    ];
    expect(qualityDayFallbackMeters(acts, null, PRESCRIBED, EASY_BASELINE)).toBe(0);
    expect(qualityDayFallbackMeters(acts, QUALITY_DAY, 0, EASY_BASELINE)).toBe(0);
    expect(qualityDayFallbackMeters(acts, QUALITY_DAY, PRESCRIBED, 0)).toBe(0);
  });
});

// ── useActivityQualityDetect / useSetQualityOverride (run-detail chip) ────────

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useActivityQualityDetect', () => {
  const FOUR_MILES = 4 * METERS_PER_MILE;

  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset().mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  test('a null activity detects nothing (no override query fired)', () => {
    const { result } = renderHook(() => useActivityQualityDetect(null), { wrapper: wrapper(makeQc()) });
    expect(result.current.qualityDetected).toBe(false);
    expect(result.current.detectResult).toBeNull();
    expect(result.current.overridden).toBe(false);
  });

  test('reads the precomputed verdict off stream_summary.quality — detected, not overridden', async () => {
    const activity = qualityActivity('a1', FOUR_MILES);
    const { result } = renderHook(() => useActivityQualityDetect(activity), { wrapper: wrapper(makeQc()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.qualityDetected).toBe(true);
    expect(result.current.detectResult?.kind).toBe('intervals');
    expect(result.current.overridden).toBe(false);
  });

  test('a non-quality verdict never credits and never queries the override', () => {
    const activity = qualityActivity('a1', FOUR_MILES, { isQuality: false });
    const { result } = renderHook(() => useActivityQualityDetect(activity), { wrapper: wrapper(makeQc()) });
    expect(result.current.qualityDetected).toBe(false);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  test('an overridden activity is not credited (tap-to-undo takes effect)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('1');
    const activity = qualityActivity('a1', FOUR_MILES);
    const { result } = renderHook(() => useActivityQualityDetect(activity), { wrapper: wrapper(makeQc()) });
    await waitFor(() => expect(result.current.overridden).toBe(true));
    expect(result.current.qualityDetected).toBe(false);
    // The raw verdict is still exposed even when overridden (chip logic decides).
    expect(result.current.detectResult?.isQuality).toBe(true);
  });

  test('matchNote surfaces when the planned structure matches the stored blocks', async () => {
    const activity = qualityActivity('a1', FOUR_MILES);
    const structure: WorkoutStructure = [
      {
        kind: 'repeat',
        sets: 4,
        children: [
          { kind: 'interval', target: { by: 'distance', distance_m: METERS_PER_MILE } },
          { kind: 'recovery', target: { by: 'time', duration_s: 90 } },
        ],
      },
    ];
    const { result } = renderHook(() => useActivityQualityDetect(activity, structure), { wrapper: wrapper(makeQc()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matchNote).toContain('matches your planned');
  });

  test('matchNote is null with no planned structure', async () => {
    const activity = qualityActivity('a1', FOUR_MILES);
    const { result } = renderHook(() => useActivityQualityDetect(activity), { wrapper: wrapper(makeQc()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matchNote).toBeNull();
  });
});

describe('useSetQualityOverride', () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset().mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  test('persists the override, optimistically flips the cache, and invalidates override queries', async () => {
    const qc = makeQc();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetQualityOverride('a1'), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current();
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('quality-detect-override-a1', '1');
    // Optimistic: the cache reflects the override immediately (test asserts the
    // final state, which the optimistic write plus the reconciling invalidation
    // both converge on).
    expect(qc.getQueryData(['quality-override', 'a1'])).toBe(true);
    expect(invalidateSpy).toHaveBeenCalled();
    const predicate = invalidateSpy.mock.calls[0]?.[0]?.predicate as
      | ((q: { queryKey: readonly unknown[] }) => boolean)
      | undefined;
    expect(predicate).toBeDefined();
    expect(predicate!({ queryKey: ['quality-override', 'a1'] })).toBe(true);
    expect(predicate!({ queryKey: ['quality-overrides', 'p1', '2026-06-01', '2026-06-07'] })).toBe(true);
    // The Dash adaptation tray's scheme (adapt.ts useCurrentWeekAdaptations) —
    // must also be hit so tap-to-undo can't leave the tray disagreeing with
    // the gauge (PM#3).
    expect(predicate!({ queryKey: ['quality-overrides-adapt', 'a1,a2,a3'] })).toBe(true);
    expect(predicate!({ queryKey: ['activities', 'u1'] })).toBe(false);
  });

  test('no-ops when activityId is null', async () => {
    const qc = makeQc();
    const { result } = renderHook(() => useSetQualityOverride(null), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current();
    });

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('detectWeekQuality picks the verdict with the MOST quality distance (May 12 incident)', () => {
  const makeQ = (meters: number, summary: string) => ({
    isQuality: true,
    qualityDistanceMeters: meters,
    summary,
    blocks: [],
  });

  test('a zero-distance HR-threshold verdict never shadows the interval session', () => {
    const { detectWeekQuality } = require('../qualityCredit');
    // Later long run first in date-DESC order, quality verdict but 0 interval
    // meters; the earlier interval session carries 4769m. Pre-fix the loop took
    // the FIRST verdict -> gate read 0m -> week miss.
    const weekActivities = [
      { id: 'long-0516', local_date: '2026-05-16', stream_summary: { quality: makeQ(0, '29 min @ threshold') } },
      { id: 'intervals-0512', local_date: '2026-05-12', stream_summary: { quality: makeQ(4769, '3x1mi') } },
    ];
    const workout = {
      id: 'w-q', plannedDistanceMeters: 14484,
      // 3 x 1609m intervals -> prescribed quality ~4827m; 60% gate ~2896m.
      structure: [
        { kind: 'warmup', target: { by: 'distance', distance_m: 3219 } },
        { kind: 'repeat', sets: 3, children: [
          { kind: 'interval', note: 'threshold', target: { by: 'distance', distance_m: 1609 } },
          { kind: 'recovery', target: { by: 'time', seconds: 90 } },
        ] },
      ],
    };
    const r = detectWeekQuality(weekActivities, workout, new Set());
    expect(r.bestActivityId).toBe('intervals-0512');
    expect(r.detectedQualityMeters).toBe(4769);
    expect(r.qualityDetected).toBe(true);
  });
});
