import {
  prescribedSets,
} from '../prescribedSets';
import {
  extractPlannedSets,
} from '../drillVerdict';
import {
  runnerRacePaces,
  resolveTargetPace,
} from '../targetPace';
import {
  paceIntent,
} from '../../workout/pace';
import type { WorkoutStructure } from '../../workout/types';

const MI = 1609.344;

const STRUCT: WorkoutStructure = [
  { kind: 'warmup', target: { by: 'distance', distance_m: 2 * MI, hr_zone: 'easy' } },
  { kind: 'repeat', sets: 4, children: [
    { kind: 'work', target: { by: 'pace', distance_m: 2 * MI, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
    { kind: 'recovery', target: { by: 'time', duration_s: 90, hr_zone: 'easy' } } ] },
  { kind: 'cooldown', target: { by: 'distance', distance_m: 1 * MI, hr_zone: 'easy' } },
];

const PACES = runnerRacePaces(3 * 3600);

test('one planned set for the threshold reps, no actual reps', () => {
  const sets = prescribedSets(STRUCT, PACES);
  expect(sets).toHaveLength(1);
  expect(sets[0]!.plannedReps).toBe(4);
  expect(Math.round(sets[0]!.distPerRepMeters)).toBe(Math.round(2 * MI));
  expect(sets[0]!.zoneLabel).toBe('threshold');
  expect(sets[0]!.reps).toEqual([]);
  expect(sets[0]!.targetSecPerMi).toBeGreaterThan(0);
});

test('zone-label only (null pace) when no paces', () => {
  expect(prescribedSets(STRUCT, null)[0]!.targetSecPerMi).toBeNull();
});

test('a top-level non-repeat leaf yields ZERO sets (matching the drill)', () => {
  const topLevelTempo: WorkoutStructure = [
    { kind: 'work', target: { by: 'pace', distance_m: 4 * MI, pace: { kind: 'relative', reference: 'tempo', speed_fraction: 1 } } },
  ];
  expect(prescribedSets(topLevelTempo, null)).toEqual([]);
});

test('parity: prescribedSets and extractPlannedSets agree on plannedReps/distPerRepMeters/targetSecPerMi/zoneLabel', () => {
  const defs = extractPlannedSets(STRUCT);
  const expected = defs.map((def) => ({
    plannedReps: def.reps,
    distPerRepMeters: def.distPerRepMeters,
    targetSecPerMi: def.target ? resolveTargetPace(def.target, PACES) : null,
    zoneLabel: paceIntent(def.target?.pace),
  }));
  const actual = prescribedSets(STRUCT, PACES).map(({ plannedReps, distPerRepMeters, targetSecPerMi, zoneLabel }) => ({
    plannedReps, distPerRepMeters, targetSecPerMi, zoneLabel,
  }));
  expect(actual).toEqual(expected);
});
