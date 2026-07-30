/**
 * prescribedQuality.test.ts — TDD tests for prescribedQualityMinutes and
 * meetsSufficiencyGate.
 *
 * Spec: docs/superpowers/specs/2026-06-18-quality-aware-adaptation-design.md §2
 *
 * Key scenarios from the spec / plan:
 *   - 37-min detection vs 25-min prescription → credits (passes gate)
 *   - 2-min detection → does not credit (fails gate)
 *   - prescribedMinutes derivation from repeat structure with known pace
 *   - prescribedMinutes derivation from structure with pace range
 *   - fallback: 60% of total planned distance at floor pace when no hard dist
 *   - prescribedMinutes = 0 when truly no information → gate always passes
 */

import {
  prescribedQualityMinutes,
  prescribedQualityMeters,
  meetsSufficiencyGate,
  SUFFICIENCY_FRACTION,
} from '../kpi/prescribedQuality';
import type { QualityFloor } from '../kpi/qualityFloor';
import {
  runnerRacePaces,
} from '../kpi/targetPace';
import type { Segment, WorkoutStructure } from '../workout/types';

const METERS_PER_MILE = 1609.344;

// ── Floor fixtures ────────────────────────────────────────────────────────────

/** 6:30/mi = 390 s/mi floor (Jake's validated floor). */
const FLOOR: QualityFloor = { paceFloorSecPerMi: 390, hrFloor: null, qualityFloorSecPerMi: 370 };

// ── Structure fixtures ────────────────────────────────────────────────────────

/**
 * 4×2mi intervals @ 6:15/mi pace.
 * pace = 6:15/mi ÷ 1.60934 ≈ 234 s/km → rounded from 375 s/mi / 1.60934
 * Each rep: 2mi × 375 s/mi = 750 s → 4 reps → 3000 s = 50 min
 */
function make4x2miStructure(paceNote = '6:15'): WorkoutStructure {
  const paceSecPerKm = Math.round((375 / METERS_PER_MILE) * 1000);
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
          target: {
            by: ['distance', 'pace'],
            distance_m: Math.round(2 * METERS_PER_MILE),
            pace: {
              kind: 'absolute',
              band: { fast_s_per_km: paceSecPerKm, slow_s_per_km: paceSecPerKm },
            },
          },
          note: paceNote,
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

/**
 * 4×2mi without pace info (target pace null).
 * Falls back to floor pace: 4 reps × 2mi × 390 s/mi = 3120 s = 52 min.
 */
function make4x2miNoPaceStructure(): WorkoutStructure {
  return [
    {
      kind: 'repeat',
      sets: 4,
      children: [
        {
          kind: 'interval',
          target: { by: 'distance', distance_m: Math.round(2 * METERS_PER_MILE) },
        },
        {
          kind: 'recovery',
          target: { by: 'distance', distance_m: Math.round(0.25 * METERS_PER_MILE) },
        },
      ],
    },
  ];
}

/**
 * 4mi tempo (steady, non-easy) with a pace range (6:20–6:40/mi).
 * Midpoint = 6:30/mi = 390 s/mi.
 * prescribedMinutes = 4mi × 390 s/mi / 60 = 26 min.
 */
function makeTempoWithPaceRangeStructure(): WorkoutStructure {
  const minPaceSecPerMi = 380; // 6:20/mi
  const maxPaceSecPerMi = 400; // 6:40/mi
  const fastSecPerKm = Math.round((minPaceSecPerMi / METERS_PER_MILE) * 1000);
  const slowSecPerKm = Math.round((maxPaceSecPerMi / METERS_PER_MILE) * 1000);
  return [
    {
      kind: 'warmup',
      target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
    },
    {
      kind: 'steady',
      target: {
        by: ['distance', 'pace'],
        distance_m: Math.round(4 * METERS_PER_MILE),
        pace: {
          kind: 'absolute',
          band: { fast_s_per_km: fastSecPerKm, slow_s_per_km: slowSecPerKm },
        },
      },
      note: 'threshold',
    },
    {
      kind: 'cooldown',
      target: { by: 'distance', distance_m: Math.round(1 * METERS_PER_MILE) },
    },
  ];
}

/**
 * A structure with a steady/easy segment only (no hard work).
 * Hard distance = 0 → falls back to 60% of totalPlannedDistM at floor pace.
 */
function makeEasyOnlyStructure(): WorkoutStructure {
  return [
    {
      kind: 'steady',
      target: {
        by: 'distance',
        distance_m: Math.round(6 * METERS_PER_MILE),
        hr_zone: 'easy',
      },
    },
  ];
}

function makeTimedIntervals(numericPace = true): WorkoutStructure {
  const paceSecPerKm = Math.round((390 / METERS_PER_MILE) * 1000);
  return [{
    kind: 'repeat',
    sets: 6,
    children: [
      {
        kind: 'work',
        target: {
          by: ['time', 'pace'],
          duration_s: 180,
          pace: numericPace
            ? {
                kind: 'absolute',
                band: { fast_s_per_km: paceSecPerKm, slow_s_per_km: paceSecPerKm },
                intent: '5K',
              }
            : { kind: 'relative', reference: '5K', speed_fraction: 1 },
        },
      },
      { kind: 'recovery', target: { by: 'time', duration_s: 60, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
    ],
  }];
}

// ═══════════════════════════════════════════════════════════════════════════════
// prescribedQualityMinutes
// ═══════════════════════════════════════════════════════════════════════════════

describe('prescribedQualityMinutes — 4×2mi @ 6:15/mi', () => {
  test('returns ~50 min (4 × 2mi × 375 s/mi)', () => {
    const result = prescribedQualityMinutes(make4x2miStructure(), FLOOR);
    // 4 × 2mi × 375 s/mi = 3000s = 50 min
    expect(result).toBeGreaterThan(45);
    expect(result).toBeLessThan(55);
  });

  test('only counts hard (interval) children, not warmup/cooldown/recovery', () => {
    const result = prescribedQualityMinutes(make4x2miStructure(), FLOOR);
    // warmup (1mi easy), recovery (0.25mi each × 4), cooldown (1mi easy)
    // should NOT be included. Only the 4 × 2mi intervals.
    // ~50 min is well below 70 min (which would include warmup/cooldown/recovery).
    expect(result).toBeLessThan(70);
    expect(result).toBeGreaterThan(40);
  });
});

describe('prescribedQualityMinutes — 4×2mi without pace info (fallback to floor)', () => {
  test('falls back to floor pace (390 s/mi) for each rep', () => {
    const result = prescribedQualityMinutes(make4x2miNoPaceStructure(), FLOOR);
    // 4 × 2mi × 390 s/mi = 3120s = 52 min
    expect(result).toBeGreaterThan(48);
    expect(result).toBeLessThan(58);
  });
});

describe('prescribedQualityMinutes — 4mi tempo with pace range [6:20–6:40]', () => {
  test('uses midpoint pace (6:30/mi = 390 s/mi)', () => {
    const result = prescribedQualityMinutes(makeTempoWithPaceRangeStructure(), FLOOR);
    // 4mi × 390 s/mi = 1560s = 26 min
    expect(result).toBeGreaterThan(22);
    expect(result).toBeLessThan(30);
  });
});

describe('prescribedQualityMinutes — easy-only structure (no hard distance)', () => {
  test('falls back to 60% of totalPlannedDistM at floor pace', () => {
    const totalDistM = 10 * METERS_PER_MILE; // 10mi run
    const result = prescribedQualityMinutes(makeEasyOnlyStructure(), FLOOR, totalDistM);
    // 60% × 10mi × 390 s/mi = 6mi × 390 = 2340s = 39 min
    expect(result).toBeGreaterThan(35);
    expect(result).toBeLessThan(43);
  });

  test('returns 0 when no totalPlannedDistM and no hard distance', () => {
    const result = prescribedQualityMinutes(makeEasyOnlyStructure(), FLOOR);
    expect(result).toBe(0);
  });
});

describe('prescribedQualityMinutes — empty structure', () => {
  test('returns 0 for empty structure with no planned distance', () => {
    expect(prescribedQualityMinutes([], FLOOR)).toBe(0);
  });

  test('uses 60% fallback when empty structure but totalPlannedDistM given', () => {
    const totalDistM = 6 * METERS_PER_MILE;
    const result = prescribedQualityMinutes([], FLOOR, totalDistM);
    // 60% × 6mi × 390 s/mi = 3.6mi × 390 = 1404s = 23.4 min
    expect(result).toBeGreaterThan(20);
    expect(result).toBeLessThan(27);
  });
});

describe('prescribedQualityMinutes — timed hard work', () => {
  test('uses explicit hard duration and repeat count, excluding recovery', () => {
    expect(prescribedQualityMinutes(makeTimedIntervals(), FLOOR)).toBe(18);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// prescribedQualityMeters — the distance denominator (pace-invariant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('prescribedQualityMeters', () => {
  test('4×2mi → ~8 hard miles regardless of pace', () => {
    // 4 reps × 2mi = 8mi of hard work; recoveries + WU/CD excluded.
    const meters = prescribedQualityMeters(make4x2miStructure());
    expect(meters / METERS_PER_MILE).toBeCloseTo(8, 1);
  });

  test('is pace-invariant — same distance whether the plan notes 6:15 or 7:00', () => {
    expect(prescribedQualityMeters(make4x2miStructure('6:15'))).toBe(
      prescribedQualityMeters(make4x2miStructure('7:00')),
    );
  });

  test('falls back to 60% of total planned distance when no hard segment', () => {
    const totalDistM = 6 * METERS_PER_MILE;
    expect(prescribedQualityMeters([], totalDistM)).toBeCloseTo(0.6 * totalDistM, 5);
  });

  test('returns 0 with no structure and no planned distance', () => {
    expect(prescribedQualityMeters([])).toBe(0);
  });

  test('converts timed hard work to meters at its numeric pace', () => {
    const meters = prescribedQualityMeters(makeTimedIntervals());
    expect(meters / METERS_PER_MILE).toBeCloseTo((6 * 180) / 390, 1);
  });

  test('named-pace timed work remains a non-zero quality prescription', () => {
    expect(prescribedQualityMeters(makeTimedIntervals(false))).toBeGreaterThan(2 * METERS_PER_MILE);
  });

  test('runner race paces resolve named timed work without mutating the prescription', () => {
    const paces = runnerRacePaces(3 * 3600)!;
    const structure = makeTimedIntervals(false);
    const meters = prescribedQualityMeters(structure, undefined, { paces });
    expect(meters / METERS_PER_MILE).toBeCloseTo((6 * 180) / paces['5k'], 4);
    const work = structure[0]!.kind === 'repeat' ? structure[0]!.children[0] : null;
    expect(work?.kind === 'work' ? work.target.pace?.kind : null).toBe('relative');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// meetsSufficiencyGate
// ═══════════════════════════════════════════════════════════════════════════════

describe('meetsSufficiencyGate — spec examples', () => {
  test('37-min detection vs 25-min prescription → passes (37 ≥ 0.6×25=15)', () => {
    expect(meetsSufficiencyGate(37, 25)).toBe(true);
  });

  test('2-min detection vs 25-min prescription → fails (2 < 0.6×25=15)', () => {
    expect(meetsSufficiencyGate(2, 25)).toBe(false);
  });

  test('exactly at threshold (15 min detection vs 25-min prescription: 15 ≥ 15) → passes', () => {
    expect(meetsSufficiencyGate(15, 25)).toBe(true);
  });

  test('just below threshold (14.9 vs 25-min prescription) → fails', () => {
    expect(meetsSufficiencyGate(14.9, 25)).toBe(false);
  });
});

describe('meetsSufficiencyGate — edge cases', () => {
  test('prescribedMin=0 → gate always passes (no structure to compare against)', () => {
    expect(meetsSufficiencyGate(0, 0)).toBe(true);
    expect(meetsSufficiencyGate(2, 0)).toBe(true);
  });

  test('SUFFICIENCY_FRACTION is exported and is 0.6', () => {
    expect(SUFFICIENCY_FRACTION).toBe(0.6);
  });

  test('detectedMin=0 fails gate when prescribedMin > 0', () => {
    expect(meetsSufficiencyGate(0, 30)).toBe(false);
  });

  test('large detected (50 min) vs typical prescription (25 min) → passes', () => {
    expect(meetsSufficiencyGate(50, 25)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: prescribedQualityMinutes → meetsSufficiencyGate
// ═══════════════════════════════════════════════════════════════════════════════

describe('integration — 4×2mi structure + gate', () => {
  test('37-min detection passes gate vs 4×2mi @ 6:15 prescription (~50 min prescribed)', () => {
    const prescribed = prescribedQualityMinutes(make4x2miStructure(), FLOOR);
    // 37 min ≥ 0.6 × 50 = 30 min → passes
    expect(meetsSufficiencyGate(37, prescribed)).toBe(true);
  });

  test('2-min detection fails gate vs 4×2mi prescription', () => {
    const prescribed = prescribedQualityMinutes(make4x2miStructure(), FLOOR);
    expect(meetsSufficiencyGate(2, prescribed)).toBe(false);
  });

  test('50-min detection passes gate vs 4×2mi prescription', () => {
    const prescribed = prescribedQualityMinutes(make4x2miStructure(), FLOOR);
    expect(meetsSufficiencyGate(50, prescribed)).toBe(true);
  });
});

test('a `work` leaf with a relative threshold pace counts as prescribed quality minutes', () => {
  const structure = [
    { kind: 'warmup', target: { by: 'distance', distance_m: 3219 } },
    { kind: 'repeat', sets: 3, children: [
      { kind: 'work', target: { by: ['distance','pace'], distance_m: 3219, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
      { kind: 'recovery', target: { by: 'time', duration_s: 120 } },
    ] },
  ] as any;
  const floor = { paceFloorSecPerMi: 390, hrFloor: null, qualityFloorSecPerMi: 370 };
  expect(prescribedQualityMinutes(structure, floor)).toBeGreaterThan(15);
});
