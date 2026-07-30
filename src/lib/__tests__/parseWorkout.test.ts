import {
  parseWorkoutDescription,
} from '../workout/parse';

describe('parseWorkoutDescription', () => {
  test('parses threshold mile repeats with timed jog recovery', () => {
    const structure = parseWorkoutDescription('2mi WU + 3x2mi @ threshold (2min jog) + 2mi CD');
    expect(structure).toHaveLength(3);
    expect(structure[0]).toMatchObject({ kind: 'warmup', target: { distance_m: 3219 } });
    expect(structure[1]).toMatchObject({
      kind: 'repeat',
      sets: 3,
      children: [
        { kind: 'interval', target: { distance_m: 3219, hr_zone: 'threshold' }, note: 'threshold' },
        { kind: 'recovery', target: { duration_s: 120 }, note: 'jog' },
      ],
    });
    expect(structure[2]).toMatchObject({ kind: 'cooldown', target: { distance_m: 3219 } });
  });

  test('parses 200m sharpener repeats with distance jog recovery', () => {
    const structure = parseWorkoutDescription(
      'Pre-race sharpener: 2mi WU + 6x200m @ 5K effort (200m jog) + 2mi CD',
    );
    expect(structure[1]).toMatchObject({
      kind: 'repeat',
      sets: 6,
      children: [
        { kind: 'interval', target: { distance_m: 200, hr_zone: 'interval' }, note: '5K effort' },
        { kind: 'recovery', target: { distance_m: 200 }, note: 'jog' },
      ],
    });
  });

  test('parses Canova float alternations with pace targets', () => {
    const structure = parseWorkoutDescription(
      'Canova 1k/1k float: 2mi WU + 8x(1km @ 110% MP/5:29, 1km @ 85% MP/7:05) + 2mi CD',
    );
    expect(structure[1]).toMatchObject({
      kind: 'repeat',
      sets: 8,
      note: 'float',
      children: [
        {
          kind: 'interval',
          target: {
            distance_m: 1000,
            pace: {
              kind: 'relative',
              reference: 'MP',
              speed_fraction: 1.1,
              resolved: { fast_s_per_km: 204, slow_s_per_km: 204 },
            },
          },
          note: '110% MP/5:29',
        },
        {
          kind: 'steady',
          target: {
            distance_m: 1000,
            pace: {
              kind: 'relative',
              reference: 'MP',
              speed_fraction: 0.85,
              resolved: { fast_s_per_km: 264, slow_s_per_km: 264 },
            },
          },
          note: '85% MP/7:05',
        },
      ],
    });
  });

  test('parses whole easy runs with planned distance and pace range', () => {
    const structure = parseWorkoutDescription('Easy run @ 7:30-8:00/mi', Math.round(12 * 1609.344));
    expect(structure).toMatchObject([
      {
        kind: 'steady',
        target: {
          distance_m: 19312,
          pace: {
            kind: 'absolute',
            band: { fast_s_per_km: 280, slow_s_per_km: 298 },
          },
          hr_zone: 'easy',
        },
      },
    ]);
  });

  test('parses long runs with a marathon-pace middle block', () => {
    const structure = parseWorkoutDescription(
      'Long run @ 7:45-8:15/mi w/ 8mi @ 87% MP (6:56/mi) in middle',
      Math.round(20 * 1609.344),
    );
    expect(structure).toMatchObject([
      { kind: 'steady', target: { distance_m: 19312, hr_zone: 'easy' } },
      {
        kind: 'steady',
        target: {
          distance_m: 12875,
          hr_zone: 'steady',
          pace: {
            kind: 'relative',
            reference: 'MP',
            speed_fraction: 0.87,
            resolved: { fast_s_per_km: 258, slow_s_per_km: 258 },
          },
        },
      },
    ]);
  });

  test('parses shakeouts with stride repeats', () => {
    const structure = parseWorkoutDescription('Easy shakeout w/ 4x20s strides', Math.round(5 * 1609.344));
    expect(structure).toMatchObject([
      { kind: 'steady', target: { distance_m: 8047, hr_zone: 'easy' } },
      { kind: 'repeat', sets: 4, children: [{ kind: 'interval', target: { duration_s: 20 }, note: 'strides' }] },
    ]);
  });

  test('parses key middle-block long runs without a long-run prefix', () => {
    const structure = parseWorkoutDescription(
      'KEY SESSION: 22mi w/ 14mi @ 95% MP (6:21/mi) in middle — Canova-style MP long run.',
    );
    expect(structure).toMatchObject([
      { kind: 'steady', target: { distance_m: 12875, hr_zone: 'easy' } },
      {
        kind: 'steady',
        target: {
          distance_m: 22531,
          hr_zone: 'steady',
          pace: {
            kind: 'relative',
            reference: 'MP',
            speed_fraction: 0.95,
            resolved: { fast_s_per_km: 237, slow_s_per_km: 237 },
          },
        },
      },
    ]);
  });

  test('parses races with planned distance and pace target', () => {
    const structure = parseWorkoutDescription(
      'CHICAGO MARATHON — Goal: 2:38:00 (6:02/mi). Start easy, build through halfway, negative split.',
      42195,
    );
    expect(structure).toMatchObject([
      {
        kind: 'steady',
        target: {
          distance_m: 42195,
          pace: {
            kind: 'absolute',
            band: { fast_s_per_km: 225, slow_s_per_km: 225 },
            intent: 'MP',
          },
          hr_zone: 'steady',
        },
      },
    ]);
  });

  test('captures relative pace + zone for threshold reps', () => {
    const s = parseWorkoutDescription('2mi WU + 3x2mi @ threshold (2min jog) + 2mi CD', 20921);
    const json = JSON.stringify(s);
    expect(json).toContain('"repeat"');
    expect(json).toContain('"sets":3');
    expect(json).toContain('"reference":"threshold"');
    expect(json).toContain('"speed_fraction":1');
    expect(json).toContain('"hr_zone":"threshold"');
    expect(json).toContain('"duration_s":120');
  });

  test('captures a relative MP prescription', () => {
    const s = parseWorkoutDescription('2mi WU + 3x2mi @ MP + 2mi CD', 20921);
    expect(JSON.stringify(s)).toContain('"reference":"MP"');
  });
});
