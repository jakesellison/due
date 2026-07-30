import {
  buildSampleBlock,
  SAMPLE_PLAN_META,
} from '../plan/sampleBlock';

// startDate is a Monday ~18 weeks before "today" in these tests.
const START = '2026-02-09'; // Monday
const TODAY = '2026-03-11'; // Wednesday, ~week 5 of the block

describe('buildSampleBlock', () => {
  const block = buildSampleBlock({ startDate: START, today: TODAY });

  test('produces 18 weeks aligned to weekly Mondays from startDate', () => {
    expect(block.weeks).toHaveLength(18);
    expect(block.weeks[0]!.weekStart).toBe(START);
    expect(block.weeks[0]!.weekIndex).toBe(1);
    expect(block.weeks[1]!.weekStart).toBe('2026-02-16');
    expect(block.weeks[17]!.weekIndex).toBe(18);
  });

  test('carries original_target_meters == target_meters and phases through', () => {
    for (const w of block.weeks) {
      expect(w.originalTargetMeters).toBe(w.targetMeters);
      expect(['base', 'build', 'peak', 'taper', 'recovery']).toContain(w.phase);
    }
  });

  test('ends in taper weeks', () => {
    expect(block.weeks[17]!.phase).toBe('taper');
  });

  test('only the first ~5 weeks get workouts', () => {
    const weekIdxsWithWorkouts = new Set(block.workouts.map((w) => w.weekIndex));
    expect(Math.max(...weekIdxsWithWorkouts)).toBeLessThanOrEqual(5);
    expect(block.workouts.length).toBeGreaterThan(0);
  });

  test('each workout week has exactly one quality day with a structure', () => {
    for (let wi = 1; wi <= 5; wi++) {
      const q = block.workouts.filter((w) => w.weekIndex === wi && w.isQuality);
      expect(q).toHaveLength(1);
      expect(q[0]!.structure.length).toBeGreaterThan(0);
      expect(q[0]!.type).toBe('quality');
    }
  });

  test('non-quality workouts have no structure and are not quality', () => {
    for (const w of block.workouts.filter((w) => !w.isQuality)) {
      expect(w.structure).toEqual([]);
      expect(w.isQuality).toBe(false);
    }
  });

  test('emits past activities with stable seed ids, all on/before today', () => {
    expect(block.activities.length).toBeGreaterThan(0);
    for (const a of block.activities) {
      expect(a.sourceId).toMatch(/^seed-\d+$/);
      expect(a.localDate <= TODAY).toBe(true);
      expect(a.distanceMeters).toBeGreaterThan(0);
    }
    const ids = block.activities.map((a) => a.sourceId);
    expect(new Set(ids).size).toBe(ids.length); // unique
  });

  test('every seeded activity is enriched: moving time, HR, temp, start time', () => {
    for (const a of block.activities) {
      expect(a.movingTimeS).toBeGreaterThan(0);
      expect(a.avgHr).toBeGreaterThan(100);
      expect(a.avgHr).toBeLessThan(200);
      expect(a.avgTempC).toBeGreaterThanOrEqual(8);
      expect(a.avgTempC).toBeLessThanOrEqual(28);
      // start_date is a UTC ISO instant whose civil date matches localDate.
      expect(a.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z$/);
    }
  });

  test('easy-run HR drifts gently DOWNWARD across the window', () => {
    // Compare per-week mean easy HR for the first vs last activity week.
    const easy = block.activities.filter((a) => a.avgHr != null);
    expect(easy.length).toBeGreaterThan(5);
    const firstSix = easy.slice(0, 6).reduce((s, a) => s + (a.avgHr ?? 0), 0) / 6;
    const lastSix = easy.slice(-6).reduce((s, a) => s + (a.avgHr ?? 0), 0) / 6;
    expect(lastSix).toBeLessThan(firstSix);
  });

  test('best efforts are sprinkled on ~6 activities with the migration shape', () => {
    const withEfforts = block.activities.filter((a) => a.bestEfforts && a.bestEfforts.length > 0);
    expect(withEfforts.length).toBeGreaterThanOrEqual(4);
    expect(withEfforts.length).toBeLessThanOrEqual(6);
    for (const a of withEfforts) {
      for (const e of a.bestEfforts!) {
        expect(typeof e.name).toBe('string');
        expect(e.distance_m).toBeGreaterThan(0);
        expect(e.elapsed_s).toBeGreaterThan(0);
        expect(typeof e.start_date).toBe('string');
      }
    }
  });

  test('is deterministic', () => {
    const again = buildSampleBlock({ startDate: START, today: TODAY });
    expect(again).toEqual(block);
  });

  test('exposes plan metadata for the seed wrapper', () => {
    expect(SAMPLE_PLAN_META.raceName).toBe('Chicago 2026');
    expect(SAMPLE_PLAN_META.distanceKind).toBe('marathon');
    expect(SAMPLE_PLAN_META.numWeeks).toBe(18);
  });

  // Dash's quality tile reads `activity.stream_summary?.quality` — a seeded
  // account with `streams` but no `stream_summary` always shows 0/N (audit-code
  // Lane 3 Medium). Every seeded activity should carry a precomputed summary.
  test('every seeded activity carries a precomputed stream_summary', () => {
    expect(block.activities.length).toBeGreaterThan(0);
    for (const a of block.activities) {
      expect(a.streamSummary).toBeTruthy();
      expect(Array.isArray(a.streamSummary!.pace_curve)).toBe(true);
      expect(Array.isArray(a.streamSummary!.pace_duration_curve)).toBe(true);
      expect(typeof a.streamSummary!.quality?.isQuality).toBe('boolean');
    }
  });

  test('the seeded quality sessions (4x1mi @ threshold) are detected as real quality', () => {
    const detectedQuality = block.activities.filter((a) => a.streamSummary?.quality?.isQuality);
    expect(detectedQuality.length).toBeGreaterThan(0);
  });
});
