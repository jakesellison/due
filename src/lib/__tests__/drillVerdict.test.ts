import {
  buildDrillVerdict,
} from '../kpi/drillVerdict';
import type { RunStream } from '../kpi/qualityDetect';
import type { WorkoutStructure } from '../workout/types';
import type { QualityFloor } from '../kpi/qualityFloor';
import {
  runnerRacePaces,
} from '../kpi/targetPace';
import {
  METERS_PER_MILE,
} from '../units';

const floor: QualityFloor = { paceFloorSecPerMi: 420, hrFloor: null, qualityFloorSecPerMi: 400 };
const paces = runnerRacePaces(12600);

// 6×~400m at ~5:00/mi (3.0 m/s ≈ 322 s/mi... use 5.36 m/s ≈ 5:00/mi) with jogs.
function intervalStream(reps = 6): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [];
  let dist = 0;
  const push = (speed: number, secs: number) => {
    for (let i = 0; i < secs; i++) { dist += speed; d.push(dist); v.push(speed); t.push(t.length); }
  };
  for (let r = 0; r < reps; r++) { push(5.36, 75); push(2.2, 60); } // ~402 m hard @ ~5:00/mi, then jog
  return { d, v, t };
}

const intervalsStructure: WorkoutStructure = [
  { kind: 'repeat', sets: 6, children: [
    { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
    { kind: 'recovery', target: { by: 'distance', distance_m: 200 } },
  ] },
];

test('null planned → no band', () => {
  expect(buildDrillVerdict({ planned: null, stream: null, floor, runMeters: 0, paces })).toBeNull();
});

test('distance day with a zero/absent target → null (unplanned, never "met 0.00")', () => {
  // Audit U2: an extra run on a rest/unplanned day used to grade as MET with
  // an "x / 0.00 mi  OVER +x" card — a zero target is nothing to grade.
  for (const planned_distance_meters of [0, null]) {
    expect(
      buildDrillVerdict({
        planned: { is_quality: false, structure: [], planned_distance_meters },
        stream: null,
        floor,
        runMeters: 4800,
        paces,
      }),
    ).toBeNull();
  }
});

test('quality day with matching intervals → matched + rep rows', () => {
  const v = buildDrillVerdict({
    planned: { is_quality: true, structure: intervalsStructure, planned_distance_meters: 8000 },
    stream: intervalStream(), floor, runMeters: 8050, paces,
  })!;
  expect(v.kind).toBe('quality');
  expect(v.qualityState).toBe('matched');
  expect(v.plannedStructure).toBe('6×400m');
  expect(v.plannedZoneLabel).toBe('5K');
  expect(v.targetSecPerMi).not.toBeNull();
  expect(v.reps!.length).toBe(6);
  expect(v.reps![0]!.startIdx).toBeLessThan(v.reps![0]!.endIdx);
  expect(typeof v.reps![0]!.deltaSec).toBe('number');
  expect(v.recoveries!.length).toBe(5); // between the 6 reps
});

test('a tolerated plan match remains partial when the displayed reps are short of the prescription', () => {
  const fiveRepStructure: WorkoutStructure = [{
    kind: 'repeat',
    sets: 5,
    children: [
      { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
      { kind: 'recovery', target: { by: 'distance', distance_m: 200 } },
    ],
  }];
  const v = buildDrillVerdict({
    planned: { is_quality: true, structure: fiveRepStructure, planned_distance_meters: 7000 },
    // Four versus five is inside matchPlannedQuality's 25% tolerance, but the
    // drill can only show four reconciled reps and therefore must not say matched.
    stream: intervalStream(4),
    floor,
    runMeters: 6000,
    paces,
  })!;

  expect(v.qualityState).toBe('partial');
  expect(v.sets?.[0]?.plannedReps).toBe(5);
  expect(v.sets?.[0]?.reps).toHaveLength(4);
});

test('canonical detected reading owns the drill count and distances', () => {
  const structure: WorkoutStructure = [{
    kind: 'repeat', sets: 5, children: [
      { kind: 'work', target: { by: 'distance', distance_m: 2 * METERS_PER_MILE } },
      { kind: 'recovery', target: { by: 'time', duration_s: 90 } },
    ],
  }];
  const t = Array.from({ length: 11 }, (_, i) => i * 360);
  const d = Array.from({ length: 11 }, (_, i) => i * METERS_PER_MILE);
  const stream: RunStream = { t, d, v: Array(11).fill(4.47) };
  const blocks = Array.from({ length: 5 }, (_, i) => ({
    distanceMeters: 2 * METERS_PER_MILE,
    paceSecPerMi: 360,
    durationS: 720,
    startIdx: i * 2,
    endIdx: i * 2 + 1,
  }));
  const v = buildDrillVerdict({
    planned: { is_quality: true, structure, planned_distance_meters: 14 * METERS_PER_MILE },
    stream,
    detected: {
      isQuality: true,
      kind: 'intervals',
      blocks,
      summary: '5×2mi @ 6:00',
      qualityTimeMin: 60,
      qualityDistanceMeters: 10 * METERS_PER_MILE,
    },
    floor,
    runMeters: 14 * METERS_PER_MILE,
    paces: null,
  })!;

  expect(v.plannedStructure).toBe('5×2.00mi');
  expect(v.repCount).toBe(5);
  expect(v.reps).toHaveLength(5);
  expect(v.reps?.every((rep) => rep.distanceMeters === 2 * METERS_PER_MILE)).toBe(true);
});

test('quality planned but no stream → missed, planned-only', () => {
  const v = buildDrillVerdict({
    planned: { is_quality: true, structure: intervalsStructure, planned_distance_meters: 8000 },
    stream: null, floor, runMeters: 0, paces,
  })!;
  expect(v.qualityState).toBe('missed');
  expect(v.reps).toEqual([]);
  expect(v.plannedStructure).toBe('6×400m');
});

test('timed reps use the saved hard-distance snapshot for display, match, and snap', () => {
  const timedStructure: WorkoutStructure = [{
    kind: 'repeat',
    sets: 6,
    children: [
      { kind: 'work', target: { by: ['time', 'pace'], duration_s: 75, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
      { kind: 'recovery', target: { by: ['time', 'pace'], duration_s: 60, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
    ],
  }];
  const v = buildDrillVerdict({
    planned: {
      is_quality: true,
      structure: timedStructure,
      planned_distance_meters: 8_000,
      prescribed_quality_meters: 2_400,
    },
    stream: intervalStream(),
    floor,
    runMeters: 8_050,
    paces,
  })!;

  expect(v.plannedStructure).toBe('6×400m');
  expect(v.qualityState).toBe('matched');
  expect(v.sets?.[0]?.distPerRepMeters).toBeCloseTo(400, 4);
  expect(v.reps?.[0]?.distanceMeters).toBeCloseTo(400, -1);
});

test('quality with no resolvable target → null delta, null target', () => {
  const noPaceStructure: WorkoutStructure = [
    { kind: 'repeat', sets: 6, children: [
      { kind: 'work', target: { by: 'distance', distance_m: 400 } },
      { kind: 'recovery', target: { by: 'distance', distance_m: 200 } },
    ] },
  ];
  const v = buildDrillVerdict({
    planned: { is_quality: true, structure: noPaceStructure, planned_distance_meters: 8000 },
    stream: intervalStream(), floor, runMeters: 8050, paces: null,
  })!;
  expect(v.targetSecPerMi).toBeNull();
  expect(v.reps!.every((r) => r.deltaSec === null)).toBe(true);
});

test('easy day meeting distance → met', () => {
  const v = buildDrillVerdict({
    planned: { is_quality: false, structure: [], planned_distance_meters: 8047 }, // 5.0 mi
    stream: null, floor, runMeters: 8200, paces,
  })!;
  expect(v.kind).toBe('distance');
  expect(v.distanceState).toBe('met');
});

test('easy day under distance (beyond tolerance) → short', () => {
  const v = buildDrillVerdict({
    planned: { is_quality: false, structure: [], planned_distance_meters: 9656 }, // 6.0 mi
    stream: null, floor, runMeters: 6920, paces, // 4.3 mi
  })!;
  expect(v.distanceState).toBe('short');
});

// Two repeat blocks (6×400 @ 5K, then 6×400 @ 3K) — a mixed-set session.
const twoSetStructure: WorkoutStructure = [
  { kind: 'repeat', sets: 6, children: [
    { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
    { kind: 'recovery', target: { by: 'distance', distance_m: 200 } },
  ] },
  { kind: 'repeat', sets: 6, children: [
    { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '3K', speed_fraction: 1 } } },
    { kind: 'recovery', target: { by: 'distance', distance_m: 200 } },
  ] },
];
function twelveRepStream(): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [];
  let dist = 0;
  const push = (speed: number, secs: number) => {
    for (let i = 0; i < secs; i++) { dist += speed; d.push(dist); v.push(speed); t.push(t.length); }
  };
  for (let r = 0; r < 12; r++) { push(5.36, 75); push(2.2, 60); }
  return { d, v, t };
}

test('multi-set workout groups reps into sets with per-set targets', () => {
  const v = buildDrillVerdict({
    planned: { is_quality: true, structure: twoSetStructure, planned_distance_meters: 9000 },
    stream: twelveRepStream(), floor, runMeters: 9000, paces,
  })!;
  expect(v.sets!.length).toBe(2);
  expect(v.sets![0]!.plannedReps).toBe(6);
  expect(v.sets![0]!.reps.length).toBe(6);
  expect(v.sets![1]!.reps.length).toBe(6);
  expect(v.sets![0]!.zoneLabel).toBe('5K');
  expect(v.sets![1]!.zoneLabel).toBe('3K');
  // 3K target pace is faster (fewer s/mi) than 5K.
  expect(v.sets![1]!.targetSecPerMi!).toBeLessThan(v.sets![0]!.targetSecPerMi!);
  expect(v.repCount).toBe(12);
  // Reps 7-12 belong to set index 1.
  expect(v.reps![6]!.setIndex).toBe(1);
  expect(v.reps![0]!.setIndex).toBe(0);
});
