import {
  assignMatches,
  type PlannedDay,
  type Activity,
} from '../match/assign';

const workouts: PlannedDay[] = [
  { workoutId: 'w-mon', localDate: '2026-06-01', isQuality: false },
  { workoutId: 'w-tue', localDate: '2026-06-02', isQuality: true },
  { workoutId: 'w-wed', localDate: '2026-06-03', isQuality: false },
];

const activities: Activity[] = [
  { activityId: 'a1', localDate: '2026-06-01', distanceMeters: 10000 },
  { activityId: 'a2', localDate: '2026-06-01', distanceMeters: 9500 },
  { activityId: 'a3', localDate: '2026-06-02', distanceMeters: 15000 },
  { activityId: 'a4', localDate: '2026-06-05', distanceMeters: 8000 },
];

describe('assignMatches', () => {
  test('matches activities to same-date workouts, sums multi-run days', () => {
    const { matches, byWorkout } = assignMatches(workouts, activities);
    expect(matches.filter((m) => m.workoutId === 'w-mon').map((m) => m.activityId))
      .toEqual(['a1', 'a2']);
    expect(byWorkout['w-mon']!.totalMeters).toBe(19500);
    expect(byWorkout['w-tue']!.totalMeters).toBe(15000);
  });

  test('reports planned workouts with no activity as missed', () => {
    const { missedWorkoutIds } = assignMatches(workouts, activities);
    expect(missedWorkoutIds).toEqual(['w-wed']);
  });

  test('reports activities with no planned workout as unplanned', () => {
    const { unplannedActivityIds } = assignMatches(workouts, activities);
    expect(unplannedActivityIds).toEqual(['a4']);
  });

  test('double-planned day: activity attributes to the quality workout', () => {
    const ws: PlannedDay[] = [
      { workoutId: 'w-q', localDate: '2026-06-02', isQuality: true },
      { workoutId: 'w-easy', localDate: '2026-06-02', isQuality: false },
    ];
    const acts: Activity[] = [
      { activityId: 'a1', localDate: '2026-06-02', distanceMeters: 12000 },
    ];
    const { byWorkout, missedWorkoutIds, matches } = assignMatches(ws, acts);
    expect(matches).toEqual([{ workoutId: 'w-q', activityId: 'a1' }]);
    expect(byWorkout['w-q']!.totalMeters).toBe(12000);
    expect(byWorkout['w-easy']).toBeUndefined();
    expect(missedWorkoutIds).not.toContain('w-q');
    expect(missedWorkoutIds).not.toContain('w-easy');
  });

  test('double-planned day: quality is primary even when listed second', () => {
    const ws: PlannedDay[] = [
      { workoutId: 'w-easy', localDate: '2026-06-02', isQuality: false },
      { workoutId: 'w-q', localDate: '2026-06-02', isQuality: true },
    ];
    const acts: Activity[] = [
      { activityId: 'a1', localDate: '2026-06-02', distanceMeters: 12000 },
    ];
    const { byWorkout, missedWorkoutIds } = assignMatches(ws, acts);
    expect(byWorkout['w-q']!.totalMeters).toBe(12000);
    expect(byWorkout['w-easy']).toBeUndefined();
    expect(missedWorkoutIds).toEqual([]);
  });

  test('empty inputs yield all-empty result', () => {
    const r = assignMatches([], []);
    expect(r.matches).toEqual([]);
    expect(r.byWorkout).toEqual({});
    expect(r.missedWorkoutIds).toEqual([]);
    expect(r.unplannedActivityIds).toEqual([]);
  });

  test('no activities: all workouts missed', () => {
    const r = assignMatches(workouts, []);
    expect(r.missedWorkoutIds).toEqual(['w-mon', 'w-tue', 'w-wed']);
    expect(r.matches).toEqual([]);
    expect(r.unplannedActivityIds).toEqual([]);
  });

  test('no workouts: all activities unplanned', () => {
    const r = assignMatches([], activities);
    expect(r.unplannedActivityIds).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(r.matches).toEqual([]);
    expect(r.missedWorkoutIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Distance-greedy day pairing (multi-workout dates) — the user's real shape.
// The Chicago plan has many easy+easy double days (a short run + a long run).
// ---------------------------------------------------------------------------
describe('assignMatches — distance-greedy day pairing', () => {
  const DATE = '2026-06-08';
  // Planned double: a 10 mi long + a 5 mi short on the same day.
  const dbl: PlannedDay[] = [
    { workoutId: 'w-long', localDate: DATE, isQuality: false, plannedMeters: 10000 },
    { workoutId: 'w-short', localDate: DATE, isQuality: false, plannedMeters: 5000 },
  ];

  test('planned [10, 5] with runs [10.2, 4.8] pairs 10.2→10 and 4.8→5', () => {
    const acts: Activity[] = [
      { activityId: 'a-102', localDate: DATE, distanceMeters: 10200 },
      { activityId: 'a-48', localDate: DATE, distanceMeters: 4800 },
    ];
    const { byWorkout, matches, missedWorkoutIds } = assignMatches(dbl, acts);
    // Each run lands on its best-fitting workout (not summed onto one).
    expect(byWorkout['w-long']!.activityIds).toEqual(['a-102']);
    expect(byWorkout['w-long']!.totalMeters).toBe(10200);
    expect(byWorkout['w-short']!.activityIds).toEqual(['a-48']);
    expect(byWorkout['w-short']!.totalMeters).toBe(4800);
    expect(matches).toEqual(
      expect.arrayContaining([
        { workoutId: 'w-long', activityId: 'a-102' },
        { workoutId: 'w-short', activityId: 'a-48' },
      ]),
    );
    expect(missedWorkoutIds).toEqual([]);
  });

  test('planned [10, 5] with a single run [15]: 15→10 (closest), 5-row not missed', () => {
    const acts: Activity[] = [
      { activityId: 'a-15', localDate: DATE, distanceMeters: 15000 },
    ];
    const { byWorkout, missedWorkoutIds } = assignMatches(dbl, acts);
    // 15 is closer to 10 (|15-10|=5) than to 5 (|15-5|=10) → attaches to w-long.
    expect(byWorkout['w-long']!.totalMeters).toBe(15000);
    expect(byWorkout['w-short']).toBeUndefined();
    // The unpaired short row is NOT missed — the date had a run.
    expect(missedWorkoutIds).toEqual([]);
  });

  test('planned double with zero runs: both workouts missed', () => {
    const { byWorkout, missedWorkoutIds } = assignMatches(dbl, []);
    expect(byWorkout).toEqual({});
    expect(missedWorkoutIds).toEqual(['w-long', 'w-short']);
  });

  test('more runs than workouts: overflow attaches to the closest workout', () => {
    const acts: Activity[] = [
      { activityId: 'a-102', localDate: DATE, distanceMeters: 10200 }, // → w-long
      { activityId: 'a-48', localDate: DATE, distanceMeters: 4800 }, // → w-short
      { activityId: 'a-2', localDate: DATE, distanceMeters: 2000 }, // overflow → w-short (closest)
    ];
    const { byWorkout } = assignMatches(dbl, acts);
    expect(byWorkout['w-long']!.totalMeters).toBe(10200);
    // The 2 mi overflow run is closer to the 5 than the 10 → sums onto w-short.
    expect(byWorkout['w-short']!.totalMeters).toBe(6800);
    expect(byWorkout['w-short']!.activityIds).toEqual(
      expect.arrayContaining(['a-48', 'a-2']),
    );
  });

  test('single-workout date is unchanged: all runs sum onto it', () => {
    const single: PlannedDay[] = [
      { workoutId: 'w-solo', localDate: DATE, isQuality: false, plannedMeters: 10000 },
    ];
    const acts: Activity[] = [
      { activityId: 'a1', localDate: DATE, distanceMeters: 6000 },
      { activityId: 'a2', localDate: DATE, distanceMeters: 4500 },
    ];
    const { byWorkout, matches } = assignMatches(single, acts);
    expect(byWorkout['w-solo']!.totalMeters).toBe(10500);
    expect(matches.map((m) => m.activityId)).toEqual(['a1', 'a2']);
  });

  test('quality only breaks an exact-distance tie', () => {
    const ws: PlannedDay[] = [
      { workoutId: 'w-q', localDate: DATE, isQuality: true, plannedMeters: 8000 },
      { workoutId: 'w-e', localDate: DATE, isQuality: false, plannedMeters: 8000 },
    ];
    const acts: Activity[] = [
      { activityId: 'a-8', localDate: DATE, distanceMeters: 8000 }, // ties both → quality wins
      { activityId: 'a-7', localDate: DATE, distanceMeters: 7000 },
    ];
    const { byWorkout } = assignMatches(ws, acts);
    expect(byWorkout['w-q']!.activityIds).toEqual(['a-8']);
    expect(byWorkout['w-e']!.activityIds).toEqual(['a-7']);
  });
});
