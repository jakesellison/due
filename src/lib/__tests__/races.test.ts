/**
 * Node tests for race detection (`src/lib/predict/races.ts`): the Strava
 * race-tag path, distance-inference thresholds (±2% distance AND ≥12% faster
 * than trailing easy pace), and the negative case (a hard long run that is NOT a
 * round race distance is not detected). Fixtures mirror the real subject: a
 * 42.5 km @ ~4:03/km marathon against ~5:08/km easy training.
 */
import {
  detectRaceResults,
  RACE_DISTANCE_TOL,
  RACE_PACE_MARGIN,
  type RaceCandidate,
} from '../predict/races';

/** Build an easy-run block of `nWeeks` ending the day before `lastDay`. */
function easyBlock(lastDay: string, nWeeks: number, paceSecPerKm = 308): RaceCandidate[] {
  const out: RaceCandidate[] = [];
  let day = shift(lastDay, -(nWeeks * 7));
  for (let w = 0; w < nWeeks; w++) {
    for (let i = 0; i < 5; i++) {
      const km = 14;
      out.push({
        localDate: shift(day, i),
        distanceMeters: km * 1000,
        movingTimeS: Math.round(km * paceSecPerKm),
        workoutType: 0,
      });
    }
    day = shift(day, 7);
  }
  return out;
}

describe('detectRaceResults — Strava race tag', () => {
  it('detects a workout_type=1 run regardless of pace/distance', () => {
    const acts: RaceCandidate[] = [
      { localDate: '2026-05-30', distanceMeters: 10000, movingTimeS: 2400, workoutType: 1 },
    ];
    const out = detectRaceResults(acts, '2026-05-31');
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('strava_race_tag');
    expect(out[0]!.distanceClass).toBe('10k');
    expect(out[0]!.seconds).toBe(2400);
  });

  it('uses elapsed time when moving time is absent', () => {
    const acts: RaceCandidate[] = [
      { localDate: '2026-05-30', distanceMeters: 21097, elapsedTimeS: 4500, workoutType: 1 },
    ];
    const out = detectRaceResults(acts, '2026-05-31');
    expect(out[0]!.seconds).toBe(4500);
    expect(out[0]!.distanceClass).toBe('half');
  });
});

describe('detectRaceResults — distance inference', () => {
  const lastEasy = '2026-04-19';
  const easy = easyBlock(lastEasy, 8); // ~5:08/km easy baseline

  it("infers the subject's real marathon: 42.4 km @ 4:03/km vs 5:08 easy", () => {
    // 42519 m, 10305 s → 242.4 s/km (4:02/km), ~25% faster than ~308 s/km easy.
    const acts: RaceCandidate[] = [
      ...easy,
      { localDate: '2026-04-20', distanceMeters: 42519, movingTimeS: 10305, workoutType: null },
    ];
    const out = detectRaceResults(acts, '2026-04-25');
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('distance_inference');
    expect(out[0]!.distanceClass).toBe('marathon');
    expect(out[0]!.date).toBe('2026-04-20');
  });

  it('does NOT infer a non-canonical-distance hard long run (33 km tempo)', () => {
    // A genuinely hard 33 km run at race pace — fast, but NOT a round distance.
    const acts: RaceCandidate[] = [
      ...easy,
      { localDate: '2026-04-20', distanceMeters: 33000, movingTimeS: 33 * 245, workoutType: 0 },
    ];
    const out = detectRaceResults(acts, '2026-04-25');
    expect(out).toHaveLength(0);
  });

  it('does NOT infer a canonical distance run at EASY pace (a marathon-length easy day)', () => {
    // 42 km but at easy pace (only ~3% faster than baseline, under the 12% gate).
    const acts: RaceCandidate[] = [
      ...easy,
      { localDate: '2026-04-20', distanceMeters: 42195, movingTimeS: Math.round(42.195 * 300), workoutType: 0 },
    ];
    const out = detectRaceResults(acts, '2026-04-25');
    expect(out).toHaveLength(0);
  });

  it('respects the ±2% distance tolerance band', () => {
    // 5000 ± 2% = [4900, 5100]. A 5150 m effort (3% over) is NOT a 5k.
    const fast = (d: number): RaceCandidate => ({
      localDate: '2026-04-20',
      distanceMeters: d,
      movingTimeS: Math.round((d / 1000) * 220), // ~3:40/km, well under easy
      workoutType: 0,
    });
    expect(detectRaceResults([...easy, fast(5050)], '2026-04-25')).toHaveLength(1); // within
    expect(detectRaceResults([...easy, fast(5150)], '2026-04-25')).toHaveLength(0); // 3% over
    // sanity on the published constants
    expect(RACE_DISTANCE_TOL).toBeCloseTo(0.02, 6);
    expect(RACE_PACE_MARGIN).toBeCloseTo(0.12, 6);
  });

  it('returns races newest-first and only on/before asOf', () => {
    const acts: RaceCandidate[] = [
      ...easyBlock('2026-02-28', 6),
      { localDate: '2026-03-01', distanceMeters: 10000, movingTimeS: 2200, workoutType: 1 },
      { localDate: '2026-05-10', distanceMeters: 10000, movingTimeS: 2150, workoutType: 1 },
      // A future race relative to asOf is excluded.
      { localDate: '2026-06-30', distanceMeters: 10000, movingTimeS: 2100, workoutType: 1 },
    ];
    const out = detectRaceResults(acts, '2026-05-31');
    expect(out.map((r) => r.date)).toEqual(['2026-05-10', '2026-03-01']);
  });
});

describe('detectRaceResults — dedup + pace monotonicity', () => {
  const block = easyBlock('2026-04-01', 9); // ~308 s/km easy baseline

  it('collapses duplicate race rows (same effort ingested twice)', () => {
    const marathon: RaceCandidate = {
      localDate: '2026-04-05',
      distanceMeters: 42195,
      movingTimeS: Math.round(42.195 * 245), // ~4:05/km
      workoutType: 0,
    };
    const out = detectRaceResults([...block, marathon, { ...marathon }], '2026-04-10');
    expect(out.filter((r) => r.distanceClass === 'marathon')).toHaveLength(1);
  });

  it('rejects a slow "half" that is slower per-km than the marathon (a hard long run, not a race)', () => {
    const marathon: RaceCandidate = {
      localDate: '2026-04-05',
      distanceMeters: 42195,
      movingTimeS: Math.round(42.195 * 245), // 4:05/km — a real marathon
      workoutType: 0,
    };
    const slowHalf: RaceCandidate = {
      localDate: '2026-04-09',
      distanceMeters: 21097,
      movingTimeS: Math.round(21.097 * 265), // 4:25/km — SLOWER than the marathon
      workoutType: 0,
    };
    const out = detectRaceResults([...block, marathon, slowHalf], '2026-04-12');
    // The slow half trips the ±12% inference gate but violates distance→pace
    // monotonicity, so it must NOT be detected as a race.
    expect(out.map((r) => r.distanceClass)).toEqual(['marathon']);
  });

  it('keeps a genuinely fast half (faster per-km than the marathon)', () => {
    const marathon: RaceCandidate = {
      localDate: '2026-04-05',
      distanceMeters: 42195,
      movingTimeS: Math.round(42.195 * 245),
      workoutType: 0,
    };
    const fastHalf: RaceCandidate = {
      localDate: '2026-04-09',
      distanceMeters: 21097,
      movingTimeS: Math.round(21.097 * 230), // 3:50/km — faster than the marathon
      workoutType: 0,
    };
    const out = detectRaceResults([...block, marathon, fastHalf], '2026-04-12');
    expect(out.map((r) => r.distanceClass).sort()).toEqual(['half', 'marathon']);
  });
});

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD'. */
function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
