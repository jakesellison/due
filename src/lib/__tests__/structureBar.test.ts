import {
  structureBarSegments,
  estimatePlannedDurationSec,
  estimatedStructureDistanceMeters,
  estimateWorkoutDurationSec,
  formatDurationApprox,
  workoutTone,
  dominantWorkLabel,
  structureLines,
} from '../workout/structureBar';
import type { WorkoutStructure } from '../workout/types';

const MI = 1609.344;

// 2mi WU + 4×(2mi @ threshold / 0.5mi recovery) + 1mi CD = 13mi
const threshold: WorkoutStructure = [
  { kind: 'warmup', target: { by: 'distance', distance_m: 2 * MI } },
  {
    kind: 'repeat',
    sets: 4,
    children: [
      { kind: 'work', target: { by: 'pace', pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 }, distance_m: 2 * MI } },
      { kind: 'recovery', target: { by: 'distance', distance_m: 0.5 * MI } },
    ],
  },
  { kind: 'cooldown', target: { by: 'distance', distance_m: 1 * MI } },
];

const easy: WorkoutStructure = [{ kind: 'steady', target: { by: 'pace', distance_m: 6 * MI } }];

describe('structureBarSegments', () => {
  it('flattens a repeat session into ordered, paintable segments', () => {
    const segs = structureBarSegments(threshold);
    expect(segs.map((s) => s.kind)).toEqual([
      'wu', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'cd',
    ]);
    expect(segs[1]!.meters).toBeCloseTo(2 * MI, 0); // a work rep is 2mi
  });

  it('reduces an easy run to a single steady block', () => {
    const segs = structureBarSegments(easy);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe('steady');
  });

  it('paints an MP steady block as work while preserving an explicitly easy MP-reference leg', () => {
    const segs = structureBarSegments([
      { kind: 'steady', target: { by: ['distance', 'pace'], distance_m: 10 * MI, hr_zone: 'easy', pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 } } },
      { kind: 'steady', target: { by: ['distance', 'pace'], distance_m: 12 * MI, hr_zone: 'steady', pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 } } },
    ]);
    expect(segs.map((s) => s.kind)).toEqual(['steady', 'work']);
  });

  it('sizes a duration-only segment from a nominal speed', () => {
    const segs = structureBarSegments([{ kind: 'work', target: { by: 'time', duration_s: 60 } }]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.meters).toBeGreaterThan(0);
  });

  it('estimates distance for time-only leaves from their prescribed pace', () => {
    const timed: WorkoutStructure = [
      { kind: 'warmup', target: { by: ['distance', 'pace'], distance_m: 3 * MI, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
      {
        kind: 'repeat',
        sets: 6,
        children: [
          { kind: 'strides', target: { by: ['time', 'pace'], duration_s: 20, pace: { kind: 'relative', reference: 'rep', speed_fraction: 1 } } },
          { kind: 'recovery', target: { by: ['time', 'pace'], duration_s: 60, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
        ],
      },
    ];

    expect(estimatedStructureDistanceMeters(timed, 480)).toBeGreaterThan(3 * MI);
  });
});

describe('structureLines', () => {
  // The July 25 long run: 10 mi easy plus 12 mi at 92% of MP. The easy leg
  // must not inherit the MP wording, and the work leg must retain its fraction.
  const mpLongRun: WorkoutStructure = [
    {
      kind: 'steady',
      note: 'easy',
      target: {
        by: ['distance', 'pace'],
        hr_zone: 'easy',
        distance_m: 16094,
        pace: {
          kind: 'absolute',
          band: { fast_s_per_km: 289, slow_s_per_km: 308 },
        },
      },
    },
    {
      kind: 'steady',
      note: '92% MP (6:33/mi)',
      target: {
        by: ['distance', 'pace'],
        hr_zone: 'steady',
        distance_m: 19312,
        pace: {
          kind: 'relative',
          reference: 'MP',
          speed_fraction: 0.92,
          resolved: { fast_s_per_km: 244, slow_s_per_km: 244 },
        },
      },
    },
  ];

  it('renders an easy-zone leg as easy, not its MP reference label', () => {
    const lines = structureLines(mpLongRun).map((l) => l.text);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/@ .+\/mi–.+\/mi easy$/);
    expect(lines[0]).not.toMatch(/MP/);
    expect(lines[1]).toMatch(/@ 6:33\/mi · 92% MP$/);
    expect(lines[1]).not.toMatch(/@ MP$/);
  });

  it('still shows a real relative pace when the zone is not easy', () => {
    const tempo: WorkoutStructure = [
      { kind: 'steady', target: { by: 'pace', hr_zone: 'steady', pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 }, distance_m: 3 * MI } as any },
    ];
    expect(structureLines(tempo)[0]!.text).toMatch(/@ threshold$/);
  });
});

describe('estimatePlannedDurationSec', () => {
  it('uses distance × easy baseline for an easy run', () => {
    // 6mi @ 9:00/mi (540 s/mi) = 3240s
    expect(estimatePlannedDurationSec(easy, 540)).toBeCloseTo(3240, 0);
  });

  it('runs work reps faster than easy via the label offset', () => {
    // wu 2×540 + 4×(2mi@470 + 0.5mi@540) + cd 540 = 6460s
    expect(estimatePlannedDurationSec(threshold, 540)).toBeCloseTo(6460, 0);
  });

  it('adds explicit durations directly', () => {
    const s: WorkoutStructure = [{ kind: 'strides', target: { by: 'time', duration_s: 120 } }];
    expect(estimatePlannedDurationSec(s, 540)).toBe(120);
  });
});

describe('estimateWorkoutDurationSec', () => {
  // A 9mi quality day whose structure (2mi WU + 6×200m@5K/200m jog + 2mi CD)
  // only spells out ~5.5mi — the remaining ~3.5mi of easy filler must count.
  const quality: WorkoutStructure = [
    { kind: 'warmup', target: { by: 'distance', distance_m: 2 * MI } },
    {
      kind: 'repeat',
      sets: 6,
      children: [
        { kind: 'interval', target: { by: 'pace', pace: { kind: 'relative', reference: '5K', speed_fraction: 1 }, distance_m: 200 } },
        { kind: 'recovery', target: { by: 'distance', distance_m: 200 } },
      ],
    },
    { kind: 'cooldown', target: { by: 'distance', distance_m: 2 * MI } },
  ];

  it('adds easy filler for planned distance the structure does not cover', () => {
    const structureOnly = estimatePlannedDurationSec(quality, 540);
    const whole = estimateWorkoutDurationSec(quality, 9 * MI, 540);
    // The structure accounts for ~5.5mi; the whole-workout estimate is larger.
    expect(whole).toBeGreaterThan(structureOnly);
    // ~9mi total ≈ structure time + (9 − structMiles)×540; well over an hour.
    expect(whole).toBeGreaterThan(60 * 60);
  });

  it('equals the structure estimate when the structure already covers the distance', () => {
    // easy = one 6mi steady block; planned 6mi → no filler.
    expect(estimateWorkoutDurationSec(easy, 6 * MI, 540)).toBeCloseTo(
      estimatePlannedDurationSec(easy, 540),
      0,
    );
  });

  it('estimates a structureless run at distance × easy baseline', () => {
    expect(estimateWorkoutDurationSec([], 5 * MI, 540)).toBeCloseTo(5 * 540, 0);
  });
});

describe('formatDurationApprox', () => {
  it('shows minutes under an hour', () => {
    expect(formatDurationApprox(3240)).toBe('~54m');
  });
  it('shows h + zero-padded minutes over an hour', () => {
    expect(formatDurationApprox(6460)).toBe('~1h48m');
    expect(formatDurationApprox(3 * 3600 + 5 * 60)).toBe('~3h05m');
  });
});

describe('workoutTone', () => {
  it('reads a non-quality long run as long', () => {
    expect(workoutTone({ type: 'long', is_quality: false, structure: [] })).toBe('long');
  });
  it('reads a plain non-quality run as easy', () => {
    expect(workoutTone({ type: 'easy', is_quality: false, structure: easy })).toBe('easy');
  });
  it('reads a threshold session as quality', () => {
    expect(workoutTone({ type: 'quality', is_quality: true, structure: threshold })).toBe('quality');
  });
  it('reads short fast reps as speed', () => {
    const reps: WorkoutStructure = [
      {
        kind: 'repeat',
        sets: 6,
        children: [{ kind: 'work', target: { by: 'pace', pace: { kind: 'relative', reference: '5K', speed_fraction: 1 }, distance_m: 800 } }],
      },
    ];
    expect(workoutTone({ type: 'quality', is_quality: true, structure: reps })).toBe('speed');
  });
});

describe('dominantWorkLabel', () => {
  it('returns the first work pace label, lowercased', () => {
    expect(dominantWorkLabel(threshold)).toBe('threshold');
  });
  it('returns null when no work segment carries a label', () => {
    expect(dominantWorkLabel(easy)).toBeNull();
  });
});
