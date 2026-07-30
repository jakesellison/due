// src/lib/kpi/__tests__/lapIntervals.test.ts
import {
  repsFromLaps,
  lapPaceSecPerMi,
} from '../lapIntervals';
import type { StravaLap } from '../../run/analysis';

const MI = 1609.344;

/**
 * The real 6×200m session (Strava activity 19129230293): 3 warm-up miles, six
 * work reps alternating with recovery jogs, then a cool-down. Distances/times/HR
 * are the athlete's watch-marked laps verbatim.
 */
const REAL_LAPS: StravaLap[] = [
  { distance: 1609, moving_time: 526, average_heartrate: 128 }, // warmup mi 1
  { distance: 1609, moving_time: 523, average_heartrate: 145 }, // warmup mi 2
  { distance: 1609, moving_time: 507, average_heartrate: 158 }, // warmup mi 3 (8:28/mi)
  { distance: 221.4, moving_time: 50, average_heartrate: 168.6 }, // rep 1 → 6:03
  { distance: 208, moving_time: 74, average_heartrate: 165 },     // recovery (9:33)
  { distance: 217, moving_time: 46, average_heartrate: 173.2 },   // rep 2 → 5:42
  { distance: 215, moving_time: 72, average_heartrate: 164 },     // recovery
  { distance: 235, moving_time: 47, average_heartrate: 166.7 },   // rep 3 → 5:22
  { distance: 205, moving_time: 61, average_heartrate: 170 },     // recovery
  { distance: 222, moving_time: 43, average_heartrate: 171.8 },   // rep 4 → 5:12
  { distance: 206, moving_time: 70, average_heartrate: 172 },     // recovery
  { distance: 218, moving_time: 48, average_heartrate: 179.6 },   // rep 5 → 5:54
  { distance: 236, moving_time: 78, average_heartrate: 174 },     // recovery
  { distance: 215, moving_time: 41, average_heartrate: 181.3 },   // rep 6 → 5:07
  { distance: 848, moving_time: 264, average_heartrate: 170 },    // cooldown start (8:21/mi)
  { distance: 1609, moving_time: 514, average_heartrate: 165 },   // cooldown mi
  { distance: 1592, moving_time: 522, average_heartrate: 160 },   // cooldown mi
];

const FLOOR = 454; // 7:34/mi

describe('lapPaceSecPerMi', () => {
  test('computes pace from distance + moving time', () => {
    expect(lapPaceSecPerMi({ distance: 221.4, moving_time: 50 })).toBeCloseTo(50 / (221.4 / MI), 1);
  });
  test('null for a zero-distance or zero-time lap', () => {
    expect(lapPaceSecPerMi({ distance: 0, moving_time: 50 })).toBeNull();
    expect(lapPaceSecPerMi({ distance: 200, moving_time: 0 })).toBeNull();
  });
});

describe('repsFromLaps', () => {
  test('extracts exactly the 6 work reps at their true paces (excludes warmup/cooldown/recovery)', () => {
    const reps = repsFromLaps(REAL_LAPS, { paceFloorSecPerMi: FLOOR });
    expect(reps).toHaveLength(6);
    const paces = reps.map((r) => Math.round(r.paceSecPerMi));
    // 6:03, 5:41, 5:22, 5:12, 5:54, 5:07 (sec/mi, from distance ÷ moving time)
    expect(paces).toEqual([363, 341, 322, 312, 354, 307]);
    expect(reps.map((r) => r.avgHr)).toEqual([169, 173, 167, 172, 180, 181]);
    // every rep is faster than the floor and rep-sized
    for (const r of reps) {
      expect(r.paceSecPerMi).toBeLessThanOrEqual(FLOOR);
      expect(r.distanceMeters).toBeLessThan(MI);
    }
  });

  test('maps rep boundaries onto the stream when provided', () => {
    // A tiny synthetic stream whose cumulative distance is the lap totals.
    const cum: number[] = [];
    let c = 0;
    for (const l of REAL_LAPS) { c += l.distance ?? 0; cum.push(c); }
    const d = [0, ...cum];
    const stream = { d, v: d.map(() => 4), t: d.map((_, i) => i * 5) };
    const reps = repsFromLaps(REAL_LAPS, { paceFloorSecPerMi: FLOOR, stream });
    expect(reps).toHaveLength(6);
    for (const r of reps) {
      expect(r.startIdx).toBeGreaterThanOrEqual(0);
      expect(r.endIdx).toBeGreaterThan(r.startIdx);
    }
  });

  test('returns [] when there is no interval structure (easy run, few laps)', () => {
    const easy: StravaLap[] = [
      { distance: 1609, moving_time: 540, average_heartrate: 140 },
      { distance: 1609, moving_time: 545, average_heartrate: 142 },
      { distance: 1609, moving_time: 538, average_heartrate: 144 },
    ];
    expect(repsFromLaps(easy, { paceFloorSecPerMi: FLOOR })).toEqual([]);
  });

  test('returns [] for a single-lap run (no lap marks)', () => {
    expect(repsFromLaps([{ distance: 10000, moving_time: 2700 }], { paceFloorSecPerMi: FLOOR })).toEqual([]);
  });

  /**
   * The real uphill/altitude hill-repeat session (Strava activity 19257392136):
   * a warm-up mile, then 6 work reps up a ~9% grade at 8k ft, each followed by an
   * easy downhill float, then cool-down miles. The reps are barely faster than
   * easy on PACE (the hill + altitude suppress it) but unmistakable on HR
   * (164–169 vs 141–147 on the floats). Watch-marked laps verbatim.
   */
  const HILL_LAPS: StravaLap[] = [
    { distance: 1609, moving_time: 545, average_heartrate: 117 }, // warmup mi
    { distance: 276, moving_time: 100, average_heartrate: 132 },
    { distance: 563, moving_time: 154, average_heartrate: 165 }, // rep 1 uphill (7:20)
    { distance: 576, moving_time: 208, average_heartrate: 144 }, // float (9:41)
    { distance: 564, moving_time: 172, average_heartrate: 164 }, // rep 2 uphill (8:11)
    { distance: 574, moving_time: 209, average_heartrate: 141 }, // float
    { distance: 564, moving_time: 173, average_heartrate: 166 }, // rep 3 (8:14)
    { distance: 574, moving_time: 213, average_heartrate: 144 }, // float
    { distance: 562, moving_time: 169, average_heartrate: 167 }, // rep 4 (8:04)
    { distance: 580, moving_time: 206, average_heartrate: 145 }, // float
    { distance: 562, moving_time: 168, average_heartrate: 168 }, // rep 5 (8:01)
    { distance: 574, moving_time: 217, average_heartrate: 147 }, // float
    { distance: 562, moving_time: 163, average_heartrate: 169 }, // rep 6 (7:47)
    { distance: 648, moving_time: 229, average_heartrate: 144 }, // float
    { distance: 1609, moving_time: 546, average_heartrate: 144 }, // cooldown mi
    { distance: 1609, moving_time: 558, average_heartrate: 146 },
    { distance: 1609, moving_time: 567, average_heartrate: 150 },
    { distance: 948, moving_time: 332, average_heartrate: 150 },
  ];

  test('pace-only MISSES the uphill hill session (reps too slow on pace)', () => {
    // Floor 465 s/mi (7:45); only one uphill rep clears it on pace, so <2 work
    // laps → falls through to stream detection (which also finds nothing → none).
    const reps = repsFromLaps(HILL_LAPS, { paceFloorSecPerMi: 465 });
    expect(reps.length).toBeLessThan(2);
  });

  test('HR floor rescues the uphill hill session: 6 slow-but-hard reps', () => {
    const reps = repsFromLaps(HILL_LAPS, { paceFloorSecPerMi: 465, hrFloor: 154 });
    expect(reps).toHaveLength(6);
    expect(reps.map((r) => r.avgHr)).toEqual([165, 164, 166, 167, 168, 169]);
    // The reps are the uphill efforts — several are SLOWER than the pace floor.
    expect(reps.some((r) => r.paceSecPerMi > 465)).toBe(true);
    // Floats (HR ≤ 147) and warm-up/cool-down are never counted.
    for (const r of reps) expect(r.avgHr!).toBeGreaterThanOrEqual(164);
  });

  test('HR floor does NOT chop a hard mile-auto-lapped continuous run into intervals', () => {
    // A hard progression / race recorded with mile auto-laps: every mile sits
    // above the HR floor, and HR drift makes the "work" miles non-contiguous — but
    // full-mile laps must clear on PACE, so the HR leg never fires here.
    const hardMiles: StravaLap[] = [
      { distance: 1609, moving_time: 480, average_heartrate: 166 }, // 7:59/mi, HR>floor
      { distance: 1609, moving_time: 495, average_heartrate: 160 }, // dips below floor
      { distance: 1609, moving_time: 478, average_heartrate: 167 },
      { distance: 1609, moving_time: 496, average_heartrate: 159 },
      { distance: 1609, moving_time: 477, average_heartrate: 168 },
      { distance: 1609, moving_time: 494, average_heartrate: 161 },
    ];
    // Pace floor 465 (all miles slower), hrFloor 163 → no sub-mile rep qualifies.
    expect(repsFromLaps(hardMiles, { paceFloorSecPerMi: 465, hrFloor: 163 })).toEqual([]);
  });

  test('HR floor does not turn a sustained high-HR tempo into intervals (contiguity guard)', () => {
    const tempo: StravaLap[] = [
      { distance: 1609, moving_time: 540, average_heartrate: 130 }, // warmup
      { distance: 1609, moving_time: 470, average_heartrate: 160 }, // tempo mi (contiguous)
      { distance: 1609, moving_time: 470, average_heartrate: 163 }, // tempo mi
      { distance: 1609, moving_time: 475, average_heartrate: 165 }, // tempo mi
      { distance: 1609, moving_time: 545, average_heartrate: 150 }, // cooldown
    ];
    // The three hot laps are contiguous → not an interval set → [] (stream path
    // handles it as a tempo).
    expect(repsFromLaps(tempo, { paceFloorSecPerMi: 465, hrFloor: 154 })).toEqual([]);
  });

  test('keeps contiguous fast tempo miles as reps (classification is the verdict’s job)', () => {
    const tempo: StravaLap[] = [
      { distance: 1609, moving_time: 540 }, // warmup
      { distance: 1609, moving_time: 360 }, // 6:00/mi tempo mile — fast but a MILE
      { distance: 1609, moving_time: 360 }, // another tempo mile
      { distance: 1609, moving_time: 540 }, // cooldown
    ];
    // repsFromLaps now SEGMENTS only — it no longer drops contiguous fast laps.
    // The two tempo miles come back as reps; computeIngestVerdict classifies the
    // contiguous, high-coverage set as tempo (not intervals). See ingestVerdict.
    const reps = repsFromLaps(tempo, { paceFloorSecPerMi: FLOOR });
    expect(reps).toHaveLength(2);
    expect(reps.every((r) => r.distanceMeters === 1609)).toBe(true);
  });

  test('drops sub-150m auto-lap fragments (never a real rep)', () => {
    const withFragment: StravaLap[] = [
      { distance: 400, moving_time: 80 }, // 5:22/mi rep
      { distance: 200, moving_time: 60 }, // recovery jog (slow) — not work
      { distance: 400, moving_time: 80 }, // rep
      { distance: 200, moving_time: 60 }, // recovery
      { distance: 400, moving_time: 80 }, // rep
      { distance: 40, moving_time: 8 }, // 5:22/mi but a 40m auto-lap tail — NOT a rep
    ];
    const reps = repsFromLaps(withFragment, { paceFloorSecPerMi: FLOOR });
    // Three 400m reps; the fast 40m fragment is dropped by the min-rep floor.
    expect(reps).toHaveLength(3);
    expect(reps.every((r) => r.distanceMeters === 400)).toBe(true);
  });
});
