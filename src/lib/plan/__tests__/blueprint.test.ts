import {
  blueprintAllocationGaps,
  buildPlanBlueprint,
  type BlueprintWeekInput,
} from '../blueprint';

const base: BlueprintWeekInput = {
  weekId: 'week-2',
  weekIndex: 2,
  weekStart: '2026-07-13',
  phase: 'build',
  isRecovery: false,
  targetMeters: 80_000,
  originalTargetMeters: 85_000,
  qualityTargetMeters: 12_000,
  longTargetMeters: 30_000,
  actualMeters: 31_000,
  isCurrent: true,
  isFuture: false,
  workouts: [
    { id: 'rest', date: '2026-07-13', type: 'rest', title: 'Rest', plannedDistanceMeters: 0, isQuality: false },
    { id: 'easy', date: '2026-07-14', type: 'easy', title: 'Easy', plannedDistanceMeters: 12_000, isQuality: false },
    { id: 'quality', date: '2026-07-15', type: 'easy', title: 'Cruise intervals', plannedDistanceMeters: 16_000, prescribedQualityMeters: 8_000, isQuality: true },
    { id: 'long-small', date: '2026-07-18', type: 'long', title: 'Medium long', plannedDistanceMeters: 24_000, isQuality: false },
    { id: 'long', date: '2026-07-19', type: 'long', title: 'Long run', plannedDistanceMeters: 28_000, isQuality: false },
  ],
};

describe('buildPlanBlueprint', () => {
  test('sorts weeks and derives contract-supporting cues', () => {
    const future = { ...base, weekId: 'week-3', weekIndex: 3, isCurrent: false, isFuture: true };
    const model = buildPlanBlueprint([future, base]);

    expect(model.map((week) => week.weekIndex)).toEqual([2, 3]);
    expect(model[0]).toMatchObject({
      state: 'current',
      revised: true,
      revisionDeltaMeters: -5_000,
      runDays: 4,
      keySessions: [
        { id: 'quality', title: 'Cruise intervals', roles: ['quality'] },
        { id: 'long-small', title: 'Medium long', roles: ['long'] },
        { id: 'long', title: 'Long run', roles: ['long'] },
      ],
      scheduledSupportMeters: 12_000,
      scheduledSupportDays: 1,
      scheduledTotalMeters: 80_000,
      allocationDeltaMeters: 0,
      qualityCoverageMeters: 8_000,
      longCoverageMeters: 28_000,
      qualityOpenMeters: 4_000,
      longOpenMeters: 2_000,
      structuralPhase: 'build',
    });
    expect(model[1]!.state).toBe('future');
    expect(blueprintAllocationGaps(model[0]!)).toEqual([
      { kind: 'quality', meters: 4_000, label: 'quality', shortLabel: 'quality' },
      { kind: 'long', meters: 2_000, label: 'continuous long run', shortLabel: 'long' },
    ]);
  });

  test('keeps recovery weeks inside the surrounding structural phase', () => {
    const model = buildPlanBlueprint([
      { ...base, weekId: 'build-1', weekIndex: 1, phase: 'build', isCurrent: false },
      { ...base, weekId: 'cutback', weekIndex: 2, phase: 'recovery', isRecovery: true, isCurrent: false },
      { ...base, weekId: 'build-3', weekIndex: 3, phase: 'build', isCurrent: false },
    ]);
    expect(model.map((week) => week.structuralPhase)).toEqual(['build', 'build', 'build']);
    expect(model[1]!.isRecovery).toBe(true);
  });

  test('does not fabricate an imported revision when no baseline is stored', () => {
    const [week] = buildPlanBlueprint([{ ...base, originalTargetMeters: null, isCurrent: false, isFuture: false }]);
    expect(week).toMatchObject({ state: 'past', revised: false, revisionDeltaMeters: 0 });
  });

  test('preserves every quality session and deduplicates a quality long run', () => {
    const [week] = buildPlanBlueprint([{
      ...base,
      targetMeters: 50_000,
      qualityTargetMeters: 12_000,
      longTargetMeters: 24_000,
      workouts: [
        { id: 'q1', date: '2026-07-14', type: 'quality', title: 'Tempo', plannedDistanceMeters: 12_000, prescribedQualityMeters: 5_000, isQuality: true },
        { id: 'q2', date: '2026-07-16', type: 'easy', title: 'Intervals', plannedDistanceMeters: 10_000, prescribedQualityMeters: 4_000, isQuality: true },
        { id: 'race', date: '2026-07-19', type: 'race', title: 'Race simulation', plannedDistanceMeters: 24_000, prescribedQualityMeters: 3_000, isQuality: true },
      ],
    }]);

    expect(week!.keySessions.map((session) => ({ id: session.id, roles: session.roles }))).toEqual([
      { id: 'q1', roles: ['quality'] },
      { id: 'q2', roles: ['quality'] },
      { id: 'race', roles: ['quality', 'long'] },
    ]);
    expect(week).toMatchObject({
      qualityCoverageMeters: 12_000,
      longCoverageMeters: 24_000,
      qualityOpenMeters: 0,
      longOpenMeters: 0,
    });
  });

  test('derives embedded hard work and never sums separate long runs', () => {
    const [week] = buildPlanBlueprint([{
      ...base,
      qualityTargetMeters: 4_800,
      longTargetMeters: 32_000,
      workouts: [
        {
          id: 'structured',
          date: '2026-07-15',
          type: 'easy',
          title: '6 by 800',
          plannedDistanceMeters: 10_000,
          isQuality: false,
          structure: [{
            kind: 'repeat',
            sets: 6,
            children: [{ kind: 'work', target: { by: 'distance', distance_m: 800, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } }],
          }],
        },
        { id: 'long-a', date: '2026-07-18', type: 'long', title: 'Long A', plannedDistanceMeters: 17_000, isQuality: false },
        { id: 'long-b', date: '2026-07-19', type: 'long', title: 'Long B', plannedDistanceMeters: 15_000, isQuality: false },
      ],
    }]);

    expect(week!.keySessions[0]).toMatchObject({ id: 'structured', roles: ['quality'], qualityMeters: 4_800 });
    expect(week).toMatchObject({
      qualityCoverageMeters: 4_800,
      qualityOpenMeters: 0,
      longCoverageMeters: 17_000,
      longOpenMeters: 15_000,
    });
  });

  test('keeps supporting mileage separate from open allocation', () => {
    const [week] = buildPlanBlueprint([{
      ...base,
      targetMeters: 90_000,
      workouts: base.workouts.slice(0, 4),
    }]);

    expect(week).toMatchObject({
      scheduledSupportMeters: 12_000,
      scheduledSupportDays: 1,
      scheduledTotalMeters: 52_000,
      allocationDeltaMeters: 38_000,
    });
  });

  test('a live week replaces resolved prescriptions with banked mileage in its projection', () => {
    const mi = (value: number) => value * 1609.344;
    const [week] = buildPlanBlueprint([{
      ...base,
      targetMeters: mi(100),
      actualMeters: mi(47.1),
      workouts: [
        { id: 'mon', date: '2026-07-20', type: 'easy', title: 'Easy', plannedDistanceMeters: mi(16), actualDistanceMeters: mi(12), isPast: true, isQuality: false },
        { id: 'mon-double', date: '2026-07-20', type: 'easy', title: 'Easy (2nd)', plannedDistanceMeters: mi(7), actualDistanceMeters: null, isPast: true, isQuality: false },
        { id: 'tue', date: '2026-07-21', type: 'quality', title: 'Quality', plannedDistanceMeters: mi(14), actualDistanceMeters: mi(17.1), isPast: true, isQuality: true },
        { id: 'wed', date: '2026-07-22', type: 'easy', title: 'Easy', plannedDistanceMeters: mi(18), actualDistanceMeters: mi(18), isPast: false, isQuality: false },
        { id: 'thu', date: '2026-07-23', type: 'easy', title: 'Easy', plannedDistanceMeters: mi(16), actualDistanceMeters: null, isPast: false, isQuality: false },
        { id: 'fri', date: '2026-07-24', type: 'easy', title: 'Easy', plannedDistanceMeters: mi(15), actualDistanceMeters: null, isPast: false, isQuality: false },
        { id: 'sat', date: '2026-07-25', type: 'long', title: 'Long', plannedDistanceMeters: mi(22), actualDistanceMeters: null, isPast: false, isQuality: false },
      ],
    }]);

    expect(week).toMatchObject({
      scheduledTotalMeters: mi(108),
      // 47.1 banked + 53 still scheduled = 100.1, inside the established
      // projection noise floor rather than eight miles over.
      allocationDeltaMeters: 0,
    });
  });

  test('a material live projection overage remains visible', () => {
    const mi = (value: number) => value * 1609.344;
    const [week] = buildPlanBlueprint([{
      ...base,
      targetMeters: mi(100),
      actualMeters: mi(50),
      workouts: [
        { id: 'resolved', date: '2026-07-20', type: 'easy', title: 'Easy', plannedDistanceMeters: mi(55), actualDistanceMeters: mi(50), isPast: true, isQuality: false },
        { id: 'remaining', date: '2026-07-24', type: 'long', title: 'Long', plannedDistanceMeters: mi(53), actualDistanceMeters: null, isPast: false, isQuality: false },
      ],
    }]);

    expect(week!.allocationDeltaMeters).toBeCloseTo(mi(-3), 5);
  });
});
