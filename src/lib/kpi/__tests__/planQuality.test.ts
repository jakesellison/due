import {
  planQualityFromWorkout,
} from '../planQuality';
import {
  prescribedQualityMeters,
} from '../prescribedQuality';
import {
  METERS_PER_MILE,
} from '../../units';
import type { WorkoutStructure } from '../../workout/types';

describe('planQualityFromWorkout', () => {
  test('a repeat block → intervals, qualityMi = prescribed hard distance', () => {
    // 6 × 600m @ threshold
    const structure: WorkoutStructure = [
      { kind: 'warmup', target: { by: 'distance', distance_m: 1600, hr_zone: 'easy' } },
      {
        kind: 'repeat',
        sets: 6,
        children: [
          { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 600, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
          { kind: 'recovery', target: { by: 'distance', distance_m: 200, hr_zone: 'easy' } },
        ],
      },
      { kind: 'cooldown', target: { by: 'distance', distance_m: 1600, hr_zone: 'easy' } },
    ];
    const q = planQualityFromWorkout({ id: 'w1', structure });
    expect(q).not.toBeNull();
    expect(q!.kind).toBe('intervals');
    expect(q!.qualityMi).toBeCloseTo(prescribedQualityMeters(structure) / METERS_PER_MILE, 5);
    expect(q!.workoutId).toBe('w1');
    expect(q!.repDistancesMi).toHaveLength(6);
    expect(q!.repDistancesMi?.[0]).toBeCloseTo(600 / METERS_PER_MILE, 5);
  });

  test('a continuous steady MP block (no repeat) → tempo', () => {
    // long run with a 10mi @ MP block embedded
    const structure: WorkoutStructure = [
      { kind: 'warmup', target: { by: 'distance', distance_m: 3200, hr_zone: 'easy' } },
      { kind: 'steady', target: { by: ['distance', 'pace'], distance_m: 16090, pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 } } },
      { kind: 'cooldown', target: { by: 'distance', distance_m: 3200, hr_zone: 'easy' } },
    ];
    const q = planQualityFromWorkout({ id: 'w2', structure });
    expect(q).not.toBeNull();
    expect(q!.kind).toBe('tempo');
    expect(q!.qualityMi).toBeCloseTo(16090 / METERS_PER_MILE, 1);
  });

  test('an easy run (no hard segments, no fallback distance) → null', () => {
    const structure: WorkoutStructure = [
      { kind: 'steady', target: { by: 'distance', distance_m: 8000, hr_zone: 'easy' } },
    ];
    expect(planQualityFromWorkout({ id: 'w3', structure })).toBeNull();
  });

  test('time-based repeats produce a plan-aware interval target', () => {
    const structure: WorkoutStructure = [{
      kind: 'repeat',
      sets: 6,
      children: [
        { kind: 'work', target: { by: ['time', 'pace'], duration_s: 180, pace: { kind: 'absolute', band: { fast_s_per_km: 245, slow_s_per_km: 245 }, intent: '5K' } } },
        { kind: 'recovery', target: { by: 'time', duration_s: 60, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
      ],
    }];
    const q = planQualityFromWorkout({ id: 'timed', structure });
    expect(q).toMatchObject({ kind: 'intervals', reps: 6, workoutId: 'timed' });
    expect(q!.qualityMi).toBeGreaterThan(2);
  });

  test('a saved duration-work snapshot remains the interpreter prior', () => {
    const structure: WorkoutStructure = [{
      kind: 'repeat',
      sets: 6,
      children: [{ kind: 'work', target: { by: ['time', 'pace'], duration_s: 180, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } }],
    }];
    const q = planQualityFromWorkout({
      id: 'timed-saved',
      structure,
      prescribedQualityMeters: 3 * METERS_PER_MILE,
    });
    expect(q?.qualityMi).toBeCloseTo(3, 5);
    expect(q?.reps).toBe(6);
  });

  test('multiple repeat blocks contribute their combined rep count', () => {
    const structure: WorkoutStructure = [
      { kind: 'repeat', sets: 4, children: [
        { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 400, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } },
      ] },
      { kind: 'repeat', sets: 4, children: [
        { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 800, pace: { kind: 'relative', reference: '3K', speed_fraction: 1 } } },
      ] },
    ];
    const quality = planQualityFromWorkout({ id: 'mixed', structure });
    expect(quality?.reps).toBe(8);
    expect(quality?.repDistancesMi?.slice(0, 4)).toEqual(Array(4).fill(400 / METERS_PER_MILE));
    expect(quality?.repDistancesMi?.slice(4)).toEqual(Array(4).fill(800 / METERS_PER_MILE));
  });
});
