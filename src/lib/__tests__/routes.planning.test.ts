import {
  routeDistanceFit,
  routePlanningBlock,
} from '../routes/planning';

describe('route planning lifecycle', () => {
  const workout = { type: 'easy', date: '2026-07-22', plannedDistanceMeters: 9656 };

  test('allows an upcoming distance workout', () => {
    expect(routePlanningBlock(workout, '2026-07-21', false)).toBeNull();
  });

  test.each([
    ['completed', workout, true],
    ['past', { ...workout, date: '2026-07-20' }, false],
    ['rest', { ...workout, type: 'rest' }, false],
    ['no-distance', { ...workout, plannedDistanceMeters: 0 }, false],
  ])('blocks %s workouts', (reason, candidate, completed) => {
    expect(routePlanningBlock(candidate, '2026-07-21', completed)).toBe(reason);
  });
});

describe('route distance fit', () => {
  test('uses the same quarter-mile tolerance on both sides of the target', () => {
    expect(routeDistanceFit(9600, 9656).fit).toBe('on-target');
    expect(routeDistanceFit(9255, 9656).fit).toBe('short');
    expect(routeDistanceFit(10057, 9656).fit).toBe('over');
  });
});
