import type { LeafSegment, RepeatSegment, Target, WorkoutStructure } from '../types';

test('Target carries named pace, effort, and pace ranges', () => {
  const t: Target = {
    by: ['distance', 'pace'],
    distance_m: 3219,
    pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 },
    effort: 'comfortably hard',
  };
  expect(t.pace).toEqual({ kind: 'relative', reference: 'MP', speed_fraction: 1 });
  expect(t.effort).toBe('comfortably hard');
});

test('work and strides are valid leaf kinds; repeat nests', () => {
  const rep: RepeatSegment = {
    kind: 'repeat',
    sets: 3,
    children: [
      { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 3219, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
      { kind: 'recovery', target: { by: 'time', duration_s: 120 } },
    ],
  };
  const strides: LeafSegment = { kind: 'strides', target: { by: 'time', duration_s: 20 } };
  const ws: WorkoutStructure = [
    { kind: 'warmup', target: { by: 'distance', distance_m: 3219 } },
    rep,
    strides,
  ];
  expect(ws).toHaveLength(3);
});
