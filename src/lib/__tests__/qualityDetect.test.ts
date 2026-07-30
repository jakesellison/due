/**
 * qualityDetect.test.ts — TDD tests for the stream quality detector (v2).
 *
 * v2 metric: quality-time = Σ sample-duration where pace ≤ paceFloor
 * (or HR ≥ hrFloor when HR stream present). A run IS quality when
 * qualityTimeMin ≥ 15 OR interval structure is detected.
 *
 * Fixtures are built at ~11 s/sample cadence to mirror real stored streams.
 *
 * Floor for all "real workout" fixtures:
 *   paceFloor = 6:30/mi = 390 s/mi  (the moderate/MP boundary)
 *   (derived from easyBaseline 8:15=495 and MP estimate ~7:15=435 → midpoint ~465,
 *    but spec says validated floor for Jake is 6:30/mi; use 390 directly as paceFloor)
 *
 * The segmenter's "hard" test is re-pointed to paceFloor (≤ 390 s/mi).
 * Warmup/cooldown at 8:00–8:15 and floats at 7:45 are all ABOVE 390 → not quality-time.
 * Rep pace 6:15 (375 s/mi) is BELOW 390 → quality-time.
 */

import {
  detectQuality,
  extractPlannedIntervals,
  matchPlannedQuality,
  type RunStream,
} from '../kpi/qualityDetect';
import type { QualityFloor } from '../kpi/qualityFloor';
import type { Segment } from '../workout/types';

// ── helpers ──────────────────────────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;

/** Convert min:sec pace (min/mi) to seconds/mile. */
function pace(minPerMi: number, secRemainder = 0): number {
  return minPerMi * 60 + secRemainder;
}

/** Convert sec/mi pace to velocity m/s. */
function vel(secPerMi: number): number {
  return METERS_PER_MILE / secPerMi;
}

/**
 * Build a RunStream from a sequence of [duration_s, pace_s_per_mi] segments.
 * Samples are emitted at ~SAMPLE_INTERVAL_S cadence.
 * Returns { d, v, t } with cumulative distance (m), velocity (m/s), elapsed (s).
 */
function buildStream(
  segments: Array<{ durationS: number; paceSecPerMi: number; hr?: number }>,
  sampleIntervalS = 11,
): RunStream & { hr?: number[] } {
  const d: number[] = [];
  const v: number[] = [];
  const t: number[] = [];
  const hr: number[] = [];
  let hasHr = false;

  let cumDist = 0;
  let cumTime = 0;

  for (const seg of segments) {
    const velocity = vel(seg.paceSecPerMi);
    const distPerSample = velocity * sampleIntervalS;
    const nSamples = Math.max(1, Math.round(seg.durationS / sampleIntervalS));

    for (let i = 0; i < nSamples; i++) {
      cumTime += sampleIntervalS;
      cumDist += distPerSample;
      t.push(cumTime);
      d.push(cumDist);
      v.push(velocity);
      if (seg.hr != null) {
        hr.push(seg.hr);
        hasHr = true;
      } else {
        hr.push(0); // placeholder
      }
    }
  }

  const stream: RunStream & { hr?: number[] } = { d, v, t };
  if (hasHr) stream.hr = hr;
  return stream;
}

// ── Floors ───────────────────────────────────────────────────────────────────

/** paceFloor = 6:30/mi (390 s/mi). Used for main fixtures. */
const PACE_FLOOR: QualityFloor = { paceFloorSecPerMi: pace(6, 30), hrFloor: null, qualityFloorSecPerMi: pace(6, 30) - 20 }; // 390

// ── Fixture 1: Real-run-shaped 4×2mi intervals ───────────────────────────────
// Structure:
//   2.5mi warmup  @ 8:10 (490 s/mi)   — above floor (490 > 390) → not quality-time
//   4 × [ 2mi @ 6:15 (375 s/mi) + 0.25mi float @ 7:45 (465 s/mi) ]
//     reps: 375 ≤ 390 → quality-time;  floats: 465 > 390 → not
//   2.5mi cooldown @ 8:00 (480 s/mi)  — above floor → not quality-time
//
// Rep duration: 2mi @ 6:15 = 2 × 375 = 750 s per rep; 4 reps → 4 × 750 = 3000 s = 50 min
// qualityTimeMin ≈ 50 min → well above 15-min gate AND has 4 blocks → intervals
//
function make4x2miStream(): RunStream {
  const easyPace  = pace(8, 10); // 490 s/mi
  // v4 regime: a rep must clear the ENTER band (floor − 50 = 340) to register as
  // WORK — real threshold reps run well below the moderate floor (the corpus's
  // reps sit ~60–84 s/mi under it), so this fixture uses 5:30 (well under ENTER),
  // not the old 6:15 that only nicked a 6:30 floor.
  const repPace   = pace(5, 30); // 330 s/mi — clears ENTER (≤ 340)
  const floatPace = pace(7, 45); // 465 s/mi — above EXIT (420)

  const segments = [
    { durationS: Math.round(2.5 * easyPace),  paceSecPerMi: easyPace  },
    ...Array.from({ length: 4 }, () => [
      { durationS: Math.round(2 * repPace),        paceSecPerMi: repPace   },
      { durationS: Math.round(0.25 * floatPace),   paceSecPerMi: floatPace },
    ]).flat(),
    { durationS: Math.round(2.5 * easyPace),  paceSecPerMi: easyPace  },
  ];

  return buildStream(segments);
}

// ── Fixture 2: Warmup + 4×2mi reps + floats + cooldown (realistic variant) ───
// Same structure but verified qualityTimeMin calculation:
//   4 reps × 750s = 3000s = 50min (all counted as quality via pace ≤ 390)
//   isQuality via BOTH qualityTimeMin ≥ 15 AND interval structure
//
// qualityTimeMin expected: ~35–50 min depending on sampling precision
// (the spec says "~37 min" for 6:30 floor; our 6:15 reps give ~50 min at 6:30 floor)
// NOTE: spec §1 says validated 37.5 min for 6:30 floor on Jake's 4×2mi.
// Our fixture uses 6:15 reps (all count) → ~50 min of quality time.
// Both are "≥ 15" so the test just checks the range.
//

// ── Fixture 3: 10×400m intervals ─────────────────────────────────────────────
// 400m @ 5:10 (310 s/mi) — below floor (390)
// 0.15mi jog @ 8:30 (510 s/mi) — above floor
// quality-time: 10 × 400m@5:10 ≈ 10 × ~77s = 770s ≈ 12.8 min
// BUT structure has ≥2 blocks → intervals → isQuality via structure
//
function make400mRepsStream(): RunStream {
  const repPace  = pace(5, 10);  // 310 s/mi
  const jogPace  = pace(8, 30);  // 510 s/mi
  const easyPace = pace(8, 15);  // 495 s/mi

  const repDistMi   = 400 / METERS_PER_MILE;
  const repDuration = repDistMi * repPace; // ≈ 77s per rep

  const segments = [
    { durationS: Math.round(0.5 * easyPace), paceSecPerMi: easyPace },
    ...Array.from({ length: 10 }, () => [
      { durationS: Math.round(repDuration),        paceSecPerMi: repPace  },
      { durationS: Math.round(0.15 * jogPace),     paceSecPerMi: jogPace  },
    ]).flat(),
    { durationS: Math.round(0.5 * easyPace), paceSecPerMi: easyPace },
  ];

  return buildStream(segments, 11);
}

// ── Fixture 4: Tempo run ──────────────────────────────────────────────────────
// 1mi easy @ 8:15 (495) + 4mi @ 6:30 (390) + 1mi easy @ 8:15
// 6:30 = paceFloor exactly — boundary samples count as quality
// quality-time: 4mi × 390s/mi = 1560s ≈ 26 min → ≥ 15 → quality
// 1 block ≥ 50% moving time → 'tempo'
//
function makeTempoStream(): RunStream {
  const easyPace  = pace(8, 15); // 495
  // v4 regime: the sustained effort must clear ENTER (floor − 50 = 340); a real
  // tempo runs below the moderate floor, so 5:30 (was 6:30 = the floor exactly,
  // which no longer registers as WORK under hysteresis).
  const tempoPace = pace(5, 30); // 330 — clears ENTER (≤ 340)

  const segments = [
    { durationS: Math.round(1 * easyPace),  paceSecPerMi: easyPace  },
    { durationS: Math.round(4 * tempoPace), paceSecPerMi: tempoPace },
    { durationS: Math.round(1 * easyPace),  paceSecPerMi: easyPace  },
  ];

  return buildStream(segments);
}

// ── Fixture 5: Easy run ───────────────────────────────────────────────────────
// 6mi @ 8:00–8:30, varying; all well above paceFloor (390)
// quality-time ≈ 0; isQuality = false
//
function makeEasyStream(): RunStream {
  const noisePattern = [490, 500, 495, 488, 502, 498, 493, 505, 491, 497];
  const segments = Array.from({ length: 30 }, (_, i) => ({
    durationS: Math.round(0.2 * (noisePattern[i % noisePattern.length]!)),
    paceSecPerMi: noisePattern[i % noisePattern.length]!,
  }));
  return buildStream(segments);
}

// ── Fixture 6: 1-minute hard blip ────────────────────────────────────────────
// 5mi easy @ 8:15 then 1 min @ 6:00 (360 s/mi) then 1mi easy
// quality-time ≈ 60s ≈ 1 min — below 15-min gate; no interval structure
// → NOT quality
//
function make1MinBlipStream(): RunStream {
  const easyPace = pace(8, 15); // 495
  const hardPace = pace(6, 0);  // 360 — below floor

  const segments = [
    { durationS: Math.round(5 * easyPace), paceSecPerMi: easyPace },
    { durationS: 60,                       paceSecPerMi: hardPace  },
    { durationS: Math.round(1 * easyPace), paceSecPerMi: easyPace  },
  ];

  return buildStream(segments);
}

// ── Fixture 7: HR-based detection ────────────────────────────────────────────
// Stream where pace is all easy (above paceFloor) but HR is elevated (≥ hrFloor).
// Should detect quality via HR even though pace wouldn't trigger.
//
function makeHrElevatedStream(): RunStream & { hr: number[] } {
  const easyPace = pace(8, 15); // 495 — all above paceFloor of 390

  // 5mi easy-pace run with HR = 155 throughout (above floor 148)
  const segments = Array.from({ length: 5 }, () => ({
    durationS: Math.round(1 * easyPace),
    paceSecPerMi: easyPace,
    hr: 155,
  }));

  return buildStream(segments) as RunStream & { hr: number[] };
}

// ── Fixture 8: HR present but below floor ────────────────────────────────────
// All samples have pace above paceFloor AND HR below hrFloor.
// → NOT quality (HR wins when present)
//
function makeHrLowStream(): RunStream & { hr: number[] } {
  const easyPace = pace(8, 15); // 495

  const segments = Array.from({ length: 5 }, () => ({
    durationS: Math.round(1 * easyPace),
    paceSecPerMi: easyPace,
    hr: 130, // below hrFloor of 148
  }));

  return buildStream(segments) as RunStream & { hr: number[] };
}

// ── QualityFloor with HR model ────────────────────────────────────────────────
const HR_FLOOR: QualityFloor = { paceFloorSecPerMi: pace(6, 30), hrFloor: 148, qualityFloorSecPerMi: pace(6, 30) - 20 };

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Fixture 1: 4×2mi intervals (main real-run fixture) ───────────────────────

describe('detectQuality — 4×2mi intervals (real-run fixture)', () => {
  let stream: RunStream;
  beforeAll(() => { stream = make4x2miStream(); });

  test('isQuality is true', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.isQuality).toBe(true);
  });

  test('kind is intervals', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.kind).toBe('intervals');
  });

  test('detects exactly 4 hard blocks', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.blocks).toHaveLength(4);
  });

  test('each block is ~2mi in distance', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    for (const block of r.blocks) {
      const miles = block.distanceMeters / METERS_PER_MILE;
      expect(miles).toBeGreaterThan(1.5);
      expect(miles).toBeLessThan(2.5);
    }
  });

  test('each block has ~5:30 pace', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    for (const block of r.blocks) {
      expect(block.paceSecPerMi).toBeGreaterThan(300);
      expect(block.paceSecPerMi).toBeLessThan(370);
    }
  });

  test('qualityTimeMin is ≥ 35 (4 reps × ~660s @ 5:30)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.qualityTimeMin).toBeGreaterThanOrEqual(35);
  });

  test('qualityTimeMin is in realistic range (35–55 min)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.qualityTimeMin).toBeGreaterThanOrEqual(35);
    expect(r.qualityTimeMin).toBeLessThanOrEqual(55);
  });

  test('qualityDistanceMeters ≈ 8 hard miles (sum of the 4 reps)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    // The pace-invariant quality measure: 4×2mi ≈ 8mi of hard running.
    expect(r.qualityDistanceMeters / 1609.344).toBeCloseTo(8, 0);
  });

  test('summary contains "4×2mi"', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.summary).toMatch(/4×2mi/);
  });

  test('summary contains an "@" pace string', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.summary).toMatch(/@\s*\d+:\d+/);
  });

  test('summary reports minutes', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.summary).toMatch(/\d+\s*min/);
  });

  test('summary mentions quality minutes before the structure', () => {
    // e.g. "50 min @ threshold · 4×2mi"
    const r = detectQuality(stream, PACE_FLOOR);
    const minPart = r.summary.indexOf('min');
    const structurePart = r.summary.indexOf('4×');
    expect(minPart).toBeGreaterThanOrEqual(0);
    expect(structurePart).toBeGreaterThan(minPart);
  });
});

// ── Fixture: 400m×10 intervals ────────────────────────────────────────────────

describe('detectQuality — 400m×10 intervals', () => {
  let stream: RunStream;
  beforeAll(() => { stream = make400mRepsStream(); });

  test('isQuality is true (interval structure even if qualityTimeMin < 15)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.isQuality).toBe(true);
  });

  test('kind is intervals', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.kind).toBe('intervals');
  });

  test('detects 10 blocks (40s min-block catches 400m reps)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.blocks).toHaveLength(10);
  });

  test('each block is ~400m in distance', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    for (const block of r.blocks) {
      expect(block.distanceMeters).toBeGreaterThan(250);
      expect(block.distanceMeters).toBeLessThan(600);
    }
  });
});

// ── Fixture: 1-minute hard blip → NOT quality ────────────────────────────────

describe('detectQuality — 1-min hard blip (NOT quality)', () => {
  let stream: RunStream;
  beforeAll(() => { stream = make1MinBlipStream(); });

  test('isQuality is false (< 15 min quality time, no structure)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.isQuality).toBe(false);
  });

  test('qualityTimeMin is very small (< 2 min)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.qualityTimeMin).toBeLessThan(2);
  });

  test('kind is none', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.kind).toBe('none');
  });
});

// ── Fixture: Tempo ────────────────────────────────────────────────────────────

describe('detectQuality — tempo fixture', () => {
  let stream: RunStream;
  beforeAll(() => { stream = makeTempoStream(); });

  test('isQuality is true', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.isQuality).toBe(true);
  });

  test('kind is tempo', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.kind).toBe('tempo');
  });

  test('exactly 1 block', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.blocks).toHaveLength(1);
  });

  test('qualityTimeMin ≈ 22 min (4mi @ 5:30 = 1320s)', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    // 4mi @ 330 s/mi = 1320s = 22min (sampling introduces small variation)
    expect(r.qualityTimeMin).toBeGreaterThan(18);
    expect(r.qualityTimeMin).toBeLessThan(35);
  });

  test('summary contains "tempo" marker or pace', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.summary.length).toBeGreaterThan(0);
  });

  test('summary reports minutes', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.summary).toMatch(/\d+\s*min/);
  });
});

// ── Fixture: Easy run ─────────────────────────────────────────────────────────

describe('detectQuality — easy run fixture', () => {
  let stream: RunStream;
  beforeAll(() => { stream = makeEasyStream(); });

  test('isQuality is false', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.isQuality).toBe(false);
  });

  test('kind is none', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.kind).toBe('none');
  });

  test('no blocks detected', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.blocks).toHaveLength(0);
  });

  test('summary is empty string', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.summary).toBe('');
  });

  test('qualityTimeMin is 0', () => {
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.qualityTimeMin).toBe(0);
  });
});

// ── HR-based detection ────────────────────────────────────────────────────────

describe('detectQuality — HR wins when present', () => {
  test('elevated HR stream detects quality even at easy pace', () => {
    const stream = makeHrElevatedStream();
    const r = detectQuality(stream, HR_FLOOR);
    expect(r.isQuality).toBe(true);
    // 5mi × 495s/mi = 2475s ≈ 41 min all at HR 155 ≥ 148
    expect(r.qualityTimeMin).toBeGreaterThan(35);
  });

  test('low HR stream is NOT quality even when hrFloor is set', () => {
    const stream = makeHrLowStream();
    const r = detectQuality(stream, HR_FLOOR);
    // All HR below hrFloor AND all pace above paceFloor → not quality
    expect(r.isQuality).toBe(false);
    expect(r.qualityTimeMin).toBe(0);
  });

  test('when hrFloor is null, pace-based detection runs (not HR)', () => {
    const stream = makeHrElevatedStream();
    // paceFloor only (no HR) — all pace is easy (490), above floor (390)
    const paceOnlyFloor: QualityFloor = { paceFloorSecPerMi: pace(6, 30), hrFloor: null, qualityFloorSecPerMi: pace(6, 30) - 20 };
    const r = detectQuality(stream, paceOnlyFloor);
    // All easy pace → no quality time via pace
    expect(r.isQuality).toBe(false);
  });
});

// ── Grade-adjusted pace (elevation array present) ────────────────────────────

describe('detectQuality — grade-adjusted pace when elevation present', () => {
  test('GAP still accrues quality-time but no longer banks quality on time alone', () => {
    // Build a slow-on-pace but uphill stream: ~9:00/mi pace on a steep grade
    // GAP would be ~6:00/mi (equivalent flat pace) → below floor → quality-time
    // elevation array has a big positive slope
    const easyPace = pace(9, 0); // 540 s/mi raw (slow due to hill)
    const segments = Array.from({ length: 6 }, () => ({
      durationS: Math.round(1 * easyPace),
      paceSecPerMi: easyPace,
    }));
    const stream = buildStream(segments);

    // Add elevation: ascending at ~0.1m per meter of distance (10% grade)
    // distance goes from 0 to ~ 6 * distance_per_min
    const elevDelta = 0.10; // 10% grade → big GAP adjustment
    const alt: number[] = stream.d.map((distM) => distM * elevDelta);

    const streamWithElev = { ...stream, altitude: alt };

    // GAP quality-time is still ACCUMULATED (the effort measure is unchanged)…
    const r = detectQuality(streamWithElev, PACE_FLOOR);
    expect(r.qualityTimeMin).toBeGreaterThan(15);
    // …but the FM-1 fix means GAP-time ALONE (no HR, no rep structure) must NOT
    // flag a run as quality — a long climb trivially clears 15 min of GAP.
    expect(r.isQuality).toBe(false);
  });

  test('stream without elevation uses raw pace', () => {
    // Same 9:00/mi without elevation — raw pace 540 > floor 390 → not quality
    const easyPace = pace(9, 0);
    const segments = Array.from({ length: 6 }, () => ({
      durationS: Math.round(1 * easyPace),
      paceSecPerMi: easyPace,
    }));
    const stream = buildStream(segments);
    // No altitude field
    const r = detectQuality(stream, PACE_FLOOR);
    expect(r.isQuality).toBe(false);
  });
});

// ── Options ───────────────────────────────────────────────────────────────────

describe('detectQuality — options', () => {
  test('v ≤ 0.3 samples are skipped (stop samples)', () => {
    const stream = make4x2miStream();
    const patchedV = [...stream.v];
    patchedV[5] = 0.1; // stop
    const patched: RunStream = { d: stream.d, v: patchedV, t: stream.t };
    expect(() => detectQuality(patched, PACE_FLOOR)).not.toThrow();
    expect(detectQuality(patched, PACE_FLOOR).isQuality).toBe(true);
  });

  test('custom minBlockS option respected', () => {
    // With a high minBlockS (600s), short 400m reps (~77s) are filtered out
    // → 10×400m would produce 0 blocks → not quality
    const stream = make400mRepsStream();
    const r = detectQuality(stream, PACE_FLOOR, { minBlockS: 600 });
    expect(r.blocks).toHaveLength(0);
    expect(r.isQuality).toBe(false);
  });
});

// ── QualityDetect shape ───────────────────────────────────────────────────────

describe('detectQuality — output shape', () => {
  test('always includes qualityTimeMin field', () => {
    const stream = makeEasyStream();
    const r = detectQuality(stream, PACE_FLOOR);
    expect('qualityTimeMin' in r).toBe(true);
    expect(typeof r.qualityTimeMin).toBe('number');
  });

  test('qualityTimeMin is always ≥ 0', () => {
    for (const stream of [makeEasyStream(), make4x2miStream(), make1MinBlipStream()]) {
      const r = detectQuality(stream, PACE_FLOOR);
      expect(r.qualityTimeMin).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// matchPlannedQuality — kept intact; now passes a floor instead of baseline
// ═══════════════════════════════════════════════════════════════════════════════

/** Build a WorkoutStructure for 4×2mi intervals. */
function make4x2miStructure(): Segment[] {
  return [
    {
      kind: 'warmup',
      target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
    },
    {
      kind: 'repeat',
      sets: 4,
      children: [
        {
          kind: 'interval',
          target: { by: 'distance', distance_m: Math.round(2 * METERS_PER_MILE) },
          note: '6:15',
        },
        {
          kind: 'recovery',
          target: { by: 'distance', distance_m: Math.round(0.25 * METERS_PER_MILE) },
        },
      ],
    },
    {
      kind: 'cooldown',
      target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
    },
  ];
}

/** Build a WorkoutStructure for a 4mi tempo run. */
function makeTempoStructure(): Segment[] {
  return [
    {
      kind: 'warmup',
      target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
    },
    {
      kind: 'steady',
      target: { by: 'distance', distance_m: Math.round(4 * METERS_PER_MILE) },
    },
    {
      kind: 'cooldown',
      target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
    },
  ];
}

describe('matchPlannedQuality — planned 4×2mi + detected 4×2mi → matched', () => {
  test('returns matched:true when rep count and distance align', () => {
    const stream = make4x2miStream();
    const detected = detectQuality(stream, PACE_FLOOR);
    const result = matchPlannedQuality(detected, make4x2miStructure());
    expect(result.matched).toBe(true);
  });

  test('note is non-null and contains rep count', () => {
    const stream = make4x2miStream();
    const detected = detectQuality(stream, PACE_FLOOR);
    const result = matchPlannedQuality(detected, make4x2miStructure());
    expect(result.note).not.toBeNull();
    expect(result.note).toMatch(/4/);
  });
});

test('time-based planned intervals expose an estimated per-rep distance', () => {
  const planned = extractPlannedIntervals([{
    kind: 'repeat',
    sets: 6,
    children: [
      { kind: 'work', target: { by: ['time', 'pace'], duration_s: 180, pace: { kind: 'absolute', band: { fast_s_per_km: 245, slow_s_per_km: 245 }, intent: '5K' } } },
      { kind: 'recovery', target: { by: 'time', duration_s: 60 } },
    ],
  }]);
  expect(planned).toMatchObject({ reps: 6 });
  expect(planned!.distPerRepMeters).toBeGreaterThan(700);
});

test('mixed repeat blocks aggregate rep counts and match each set in order', () => {
  const structure: Segment[] = [
    { kind: 'repeat', sets: 4, children: [
      { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
    ] },
    { kind: 'repeat', sets: 4, children: [
      { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 800, pace: { kind: 'relative', reference: '3K', speed_fraction: 1 } } },
    ] },
  ];
  const planned = extractPlannedIntervals(structure)!;
  expect(planned.reps).toBe(8);
  expect(planned.groups).toEqual([
    { reps: 4, distPerRepMeters: 400 },
    { reps: 4, distPerRepMeters: 800 },
  ]);

  const blocks = [400, 405, 395, 400, 800, 810, 790, 805].map((distanceMeters, index) => ({
    distanceMeters,
    paceSecPerMi: 360,
    durationS: 90,
    startIdx: index * 10,
    endIdx: index * 10 + 9,
  }));
  const result = matchPlannedQuality({
    isQuality: true,
    kind: 'intervals',
    blocks,
    summary: 'mixed set',
    qualityTimeMin: 24,
    qualityDistanceMeters: blocks.reduce((sum, block) => sum + block.distanceMeters, 0),
  }, structure);
  expect(result.matched).toBe(true);
});

test('a snapshot scales only timed reps and never changes explicit distances', () => {
  const planned = extractPlannedIntervals([
    { kind: 'repeat', sets: 2, children: [
      { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
    ] },
    { kind: 'repeat', sets: 2, children: [
      { kind: 'work', target: { by: ['time', 'pace'], duration_s: 300, pace: { kind: 'absolute', band: { fast_s_per_km: 300, slow_s_per_km: 300 }, intent: 'threshold' } } },
    ] },
  ], { prescribedTotalMeters: 2_400 });

  expect(planned?.groups[0]?.distPerRepMeters).toBe(400);
  expect(planned?.groups[1]?.distPerRepMeters).toBeCloseTo(800, 4);
});

describe('matchPlannedQuality — planned tempo + detected intervals → unmatched', () => {
  test('returns matched:false when structure types differ', () => {
    const stream = make4x2miStream();
    const detected = detectQuality(stream, PACE_FLOOR);
    const result = matchPlannedQuality(detected, makeTempoStructure());
    expect(result.matched).toBe(false);
  });

  test('note is null when unmatched', () => {
    const stream = make4x2miStream();
    const detected = detectQuality(stream, PACE_FLOOR);
    const result = matchPlannedQuality(detected, makeTempoStructure());
    expect(result.note).toBeNull();
  });
});

describe('matchPlannedQuality — planned 4×2mi + detected tempo → unmatched', () => {
  test('tempo does not match interval plan', () => {
    const stream = makeTempoStream();
    const detected = detectQuality(stream, PACE_FLOOR);
    const result = matchPlannedQuality(detected, make4x2miStructure());
    expect(result.matched).toBe(false);
    expect(result.note).toBeNull();
  });
});

describe('matchPlannedQuality — easy run → unmatched against any plan', () => {
  test('easy run does not match any quality plan', () => {
    const stream = makeEasyStream();
    const detected = detectQuality(stream, PACE_FLOOR);
    const result = matchPlannedQuality(detected, make4x2miStructure());
    expect(result.matched).toBe(false);
    expect(result.note).toBeNull();
  });
});

describe('matchPlannedQuality — mismatched rep count → unmatched', () => {
  test('4×2mi detected vs 6×1mi planned → unmatched', () => {
    const stream = make4x2miStream();
    const detected = detectQuality(stream, PACE_FLOOR);

    const planned6x1mi: Segment[] = [
      {
        kind: 'repeat',
        sets: 6,
        children: [
          {
            kind: 'interval',
            target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
          },
        ],
      },
    ];

    const result = matchPlannedQuality(detected, planned6x1mi);
    expect(result.matched).toBe(false);
  });
});

// ── A few brief surges on an easy run are NOT a quality session ──────────────
// Regression for the false "3 × 200 m" detection: an easy run (8:00/mi) with 3
// short ~44s pickups below the floor produces ≥2 blocks (so the old structure
// rule flagged it), but only ~2 min of total hard time — not a workout.
describe('detectQuality — brief surges on an easy run', () => {
  function makeBriefSurges(): RunStream {
    const easy = pace(8, 0); // 480 > floor (390)
    const surge = pace(6, 0); // 360 < floor → "hard"
    const segments = [
      { durationS: 600, paceSecPerMi: easy },
      { durationS: 45, paceSecPerMi: surge },
      { durationS: 300, paceSecPerMi: easy },
      { durationS: 45, paceSecPerMi: surge },
      { durationS: 300, paceSecPerMi: easy },
      { durationS: 45, paceSecPerMi: surge },
      { durationS: 600, paceSecPerMi: easy },
    ];
    return buildStream(segments);
  }

  // v4 regime: the 6:00 surges sit ABOVE ENTER (floor − 50 = 340) — near-floor
  // pickups never sustain into a WORK regime, so they no longer split off as
  // fake reps at all. The verdict (not a session) is unchanged; the improvement
  // is that hysteresis rejects them at the source rather than counting then
  // gating them out.
  test('no regime blocks — near-floor surges never enter WORK', () => {
    const r = detectQuality(makeBriefSurges(), PACE_FLOOR);
    expect(r.blocks.length).toBe(0);
  });

  test('is NOT quality', () => {
    const r = detectQuality(makeBriefSurges(), PACE_FLOOR);
    expect(r.isQuality).toBe(false);
    expect(r.kind).toBe('none');
  });
});

// ── A progression (one dominant sustained block + warmup pickups) is a TEMPO,
// not "N intervals" — mirrors the McCarren-track run that detected "7 hard reps".
describe('detectQuality — progression / dominant block', () => {
  function makeProgression(): RunStream {
    const easy = pace(8, 0); // 480 > EXIT (420)
    const work = pace(5, 20); // 320 — clears ENTER (≤ 340)
    const segments = [
      { durationS: 120, paceSecPerMi: easy },
      { durationS: 60, paceSecPerMi: work }, // warmup pickup (block)
      { durationS: 90, paceSecPerMi: easy }, // recovery
      { durationS: 60, paceSecPerMi: work }, // another pickup (block)
      { durationS: 90, paceSecPerMi: easy },
      { durationS: 1200, paceSecPerMi: work }, // the 20-min sustained effort (dominates)
      { durationS: 120, paceSecPerMi: easy },
    ];
    return buildStream(segments);
  }

  test('finds ≥3 blocks but classifies as tempo, not intervals', () => {
    const r = detectQuality(makeProgression(), PACE_FLOOR);
    expect(r.blocks.length).toBeGreaterThanOrEqual(3);
    expect(r.kind).toBe('tempo');
    expect(r.isQuality).toBe(true);
  });
});

// ── Normal long-run pace variance is NOT a workout. The corpus sweep showed 38%
// of runs mislabeled "N hard reps": an absolute floor + greedy per-sample
// segmenter shreds the faster moments of continuous running into fake blocks.
// In pure pace-mode, quality now requires real STRUCTURE (a coherent rep set or
// a sustained block), not scattered time below the floor.
describe('detectQuality — scattered variance is not quality', () => {
  // Pace oscillates around the floor; the sub-floor stretches form many blocks of
  // VARIED size — no coherent reps, no dominant block, none sustained.
  function makeScatteredLongRun(): RunStream {
    const below = pace(6, 10); // 370 ≤ floor
    const rec = pace(7, 40); // 460 > floor
    const workDurs = [50, 200, 80, 300, 60, 450, 90, 250];
    const segments = workDurs.flatMap((dur) => [
      { durationS: dur, paceSecPerMi: below },
      { durationS: 45, paceSecPerMi: rec },
    ]);
    return buildStream(segments);
  }

  // Continuous fast-ish running chopped by micro-dips into many similar tiny
  // blocks — coherent by size, but far too many to be a real rep set (the "39
  // hard reps" on a 24-miler case).
  function makeManyTinyBlocks(): RunStream {
    const below = pace(6, 20); // 380 ≤ floor
    const rec = pace(6, 50); // 410 > floor — barely slower (continuous)
    const segments = Array.from({ length: 18 }, () => [
      { durationS: 50, paceSecPerMi: below },
      { durationS: 20, paceSecPerMi: rec },
    ]).flat();
    return buildStream(segments);
  }

  // v4 regime: the sub-floor stretches (6:10) sit ABOVE ENTER (340), so
  // moderate variance never enters a WORK regime — no fake blocks, not quality.
  // (Under the old per-sample glue these fragmented into scattered blocks that
  // the coherence gate then had to reject; hysteresis rejects at the source.)
  test('moderate variance → no regime blocks, not quality', () => {
    const r = detectQuality(makeScatteredLongRun(), PACE_FLOOR);
    expect(r.blocks.length).toBe(0);
    expect(r.kind).toBe('none');
    expect(r.isQuality).toBe(false);
  });

  // v4 regime: continuous near-floor running with micro-dips (the "39 hard reps
  // on a 24-miler" case) is exactly what hysteresis erases — the 6:20 stretches
  // never clear ENTER, so no block explosion. Not quality.
  test('continuous micro-dips → no regime blocks, not quality', () => {
    const r = detectQuality(makeManyTinyBlocks(), PACE_FLOOR);
    expect(r.blocks.length).toBe(0);
    expect(r.kind).toBe('none');
    expect(r.isQuality).toBe(false);
  });
});

// ── v4 hysteresis REGIME detection replaces the raw-pace threshold+glue
// segmenter (and its v3 block-merge). Four locked-design scenarios
// (interval-detection-diagnosis.md): (a) mid-rep sag stays one rep, (b) a
// warm-up surge never becomes a rep, (c) short 200 m reps survive MIN_REP, and
// (d) end-of-run strides don't cohere into a quality verdict. Streams are built
// at 1 Hz (full-res storage cadence) so the smoothing window spans real samples.
describe('detectQuality — v4 regime detection', () => {
  // (a) 3×2mi with a mid-rep pace SAG — samples pop above the floor mid-rep
  // (a hill/turnaround, the real 2026-05-26 shape). The hysteresis dead-band
  // (EXIT = floor + 30 = 420) bridges the sag, so each rep stays ONE ~2mi block
  // instead of fragmenting. Reps run at 5:20 (well under ENTER 340).
  function make3x2miWithSag(): RunStream {
    const rep = pace(5, 20);   // 320 — clears ENTER (340)
    const sag = pace(6, 40);   // 400 — ABOVE the 390 floor but BELOW EXIT (420)
    const rec = pace(8, 0);    // 480 — above EXIT → separates reps
    const easy = pace(8, 10);  // 490
    // Each rep ≈ 2mi: 300s @320 + 20s @400 (the sag) + 320s @320 ≈ 640s ≈ 2mi.
    const oneRep = [
      { durationS: 300, paceSecPerMi: rep },
      { durationS: 20, paceSecPerMi: sag },
      { durationS: 320, paceSecPerMi: rep },
    ];
    const segments = [
      { durationS: 300, paceSecPerMi: easy },
      ...Array.from({ length: 3 }, () => [...oneRep, { durationS: 150, paceSecPerMi: rec }]).flat(),
      { durationS: 300, paceSecPerMi: easy },
    ];
    return buildStream(segments, 1);
  }

  test('(a) mid-rep sag → 3 clean ~2mi blocks, NOT fragmented', () => {
    const r = detectQuality(make3x2miWithSag(), PACE_FLOOR);
    expect(r.blocks).toHaveLength(3);
    expect(r.isQuality).toBe(true);
    expect(r.kind).toBe('intervals');
    for (const b of r.blocks) {
      const miles = b.distanceMeters / METERS_PER_MILE;
      expect(miles).toBeGreaterThan(1.7);
      expect(miles).toBeLessThan(2.3);
    }
  });

  // (b) A warm-up surge (a stride under the floor but not sustained deep enough)
  // before the main set must NOT read as a rep. The surge at 6:00 (360) sits
  // ABOVE ENTER (340) — hysteresis never latches it as WORK — so only the 4 real
  // reps register.
  function makeWarmupSurgeThenSet(): RunStream {
    const surge = pace(6, 0);  // 360 — under floor, ABOVE ENTER → never WORK
    const rep = pace(5, 15);   // 315 — clears ENTER
    const rec = pace(8, 30);   // 510 — above EXIT
    const easy = pace(8, 15);  // 495
    const segments = [
      { durationS: 400, paceSecPerMi: easy },
      { durationS: 60, paceSecPerMi: surge },  // the warm-up surge
      { durationS: 200, paceSecPerMi: easy },
      ...Array.from({ length: 4 }, () => [
        { durationS: 120, paceSecPerMi: rep },
        { durationS: 90, paceSecPerMi: rec },
      ]).flat(),
      { durationS: 300, paceSecPerMi: easy },
    ];
    return buildStream(segments, 1);
  }

  test('(b) warm-up surge is not a rep — 4 blocks, not 5', () => {
    const r = detectQuality(makeWarmupSurgeThenSet(), PACE_FLOOR);
    expect(r.blocks).toHaveLength(4);
    expect(r.kind).toBe('intervals');
    expect(r.isQuality).toBe(true);
  });

  // (c) 6×~300m short reps all survive MIN_REP (25s) — short-rep workouts aren't
  // killed. A large per-rep minimum (120s) would drop these; MIN_REP keeps them.
  // (The ±20s smoothing clips the measured span, so a ~300m rep reads ~215m/~44s
  // — still well past MIN_REP. Real 6×200m clears via the lap-first path.)
  function make6xShortReps(): RunStream {
    const rep = pace(5, 30);   // 330 — clears ENTER
    const rec = pace(8, 30);   // 510 — above EXIT
    const easy = pace(8, 15);  // 495
    const repDurS = Math.round((300 / METERS_PER_MILE) * 330); // ≈ 62s
    const segments = [
      { durationS: 400, paceSecPerMi: easy },
      ...Array.from({ length: 6 }, () => [
        { durationS: repDurS, paceSecPerMi: rep },
        { durationS: 90, paceSecPerMi: rec },
      ]).flat(),
      { durationS: 400, paceSecPerMi: easy },
    ];
    return buildStream(segments, 1);
  }

  test('(c) 6×~300m short reps all survive MIN_REP', () => {
    const r = detectQuality(make6xShortReps(), PACE_FLOOR);
    expect(r.blocks).toHaveLength(6);
    expect(r.kind).toBe('intervals');
    expect(r.isQuality).toBe(true);
    for (const b of r.blocks) {
      expect(b.durationS).toBeGreaterThan(25); // survives MIN_REP
      expect(b.distanceMeters).toBeGreaterThan(120);
      expect(b.distanceMeters).toBeLessThan(300);
    }
  });

  // (d) Strides at the END of an easy run: 6×~15s hard bursts with long easy
  // between. Each burst is far shorter than MIN_REP (25s), so regime keeps no
  // sustained blocks → the structure gates reject → NOT a coherent quality
  // verdict (the 2026-07-02 strides guard).
  function makeEndOfRunStrides(): RunStream {
    const stride = pace(5, 0);  // 300 — fast, but each burst is only ~15s
    const easy = pace(8, 15);   // 495
    const segments = [
      { durationS: 2400, paceSecPerMi: easy }, // 40 min easy run
      ...Array.from({ length: 6 }, () => [
        { durationS: 15, paceSecPerMi: stride },
        { durationS: 100, paceSecPerMi: easy },
      ]).flat(),
    ];
    return buildStream(segments, 1);
  }

  test('(d) end-of-run strides do NOT produce a quality verdict', () => {
    const r = detectQuality(makeEndOfRunStrides(), PACE_FLOOR);
    expect(r.isQuality).toBe(false);
    expect(r.kind).toBe('none');
    expect(r.blocks.length).toBeLessThanOrEqual(1);
  });
});

// ── HR confirms which efforts are real. The corpus sweep + HR diagnostic showed
// the 7:00/mi "intervals" split by effort: real ones run at ~88% max HR, moderate
// ones at ~75%. When an HR floor is set and the run carries HR, a pace-segmented
// block only counts as a rep if its average HR clears the floor.
describe('detectQuality — HR confirms which efforts are real', () => {
  const HR_FLOOR: QualityFloor = { paceFloorSecPerMi: pace(6, 30), hrFloor: 160, qualityFloorSecPerMi: pace(6, 30) - 20 };

  // 4 reps that clear the pace ENTER band but run at EASY HR — moderate running,
  // not a workout (HR confirmation drops the blocks).
  function makeModerateHrReps(): RunStream {
    const rep = pace(5, 30); // 330 — clears ENTER (≤ 340)
    const rec = pace(7, 40); // 460 > EXIT (420)
    const segs = Array.from({ length: 4 }, () => [
      { durationS: 120, paceSecPerMi: rep, hr: 140 }, // ~72% max — aerobic
      { durationS: 60, paceSecPerMi: rec, hr: 128 },
    ]).flat();
    return buildStream(segs);
  }

  // Same pace structure, but the reps are at WORKOUT HR — real intervals.
  function makeHardHrReps(): RunStream {
    const rep = pace(5, 30); // 330 — clears ENTER (≤ 340)
    const rec = pace(7, 40);
    const segs = Array.from({ length: 4 }, () => [
      { durationS: 120, paceSecPerMi: rep, hr: 178 }, // ~92% max — hard
      { durationS: 60, paceSecPerMi: rec, hr: 150 },
    ]).flat();
    return buildStream(segs);
  }

  test('moderate-HR reps are NOT quality (blocks fail HR confirmation)', () => {
    const r = detectQuality(makeModerateHrReps(), HR_FLOOR);
    expect(r.isQuality).toBe(false);
    expect(r.kind).toBe('none');
  });

  test('workout-HR reps ARE quality intervals', () => {
    const r = detectQuality(makeHardHrReps(), HR_FLOOR);
    expect(r.kind).toBe('intervals');
    expect(r.isQuality).toBe(true);
  });
});
