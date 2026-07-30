import {
  derivePlanIdentity,
} from '../identity';

describe('derivePlanIdentity', () => {
  it('derives fixed stats and folds recovery weeks into the structural phase', () => {
    const identity = derivePlanIdentity({
      name: 'City Marathon Build',
      distanceKind: 'marathon',
      numWeeks: 4,
      weeks: [
        { weekIndex: 1, phase: 'base', targetMeters: 40_000 },
        { weekIndex: 2, phase: 'recovery', targetMeters: 32_000, isRecovery: true },
        { weekIndex: 3, phase: 'build', targetMeters: 48_000 },
        { weekIndex: 4, phase: 'taper', targetMeters: 24_000 },
      ],
      workouts: [
        { weekIndex: 1, type: 'quality', isQuality: true, plannedDistanceMeters: 8_000, prescribedQualityMeters: 8_000 },
        { weekIndex: 3, type: 'quality', isQuality: true, plannedDistanceMeters: 10_000, prescribedQualityMeters: 10_000 },
        { weekIndex: 4, type: 'race', isQuality: true, plannedDistanceMeters: 42_195 },
      ],
    });

    expect(identity.distanceLabel).toBe('Marathon');
    expect(identity.averageWeeklyMeters).toBe(36_000);
    expect(identity.peakWeeklyMeters).toBe(48_000);
    expect(identity.qualityShare).toBeCloseTo(18_000 / 144_000);
    expect(identity.phases).toEqual([
      { label: 'Base', weeks: 2 },
      { label: 'Build', weeks: 1 },
      { label: 'Taper', weeks: 1 },
    ]);
  });

  it('does not invent a quality percentage when workout evidence is unavailable', () => {
    const identity = derivePlanIdentity({
      name: '10K',
      distanceKind: '10k',
      weeks: [
        { weekIndex: 1, targetMeters: 40_000 },
        { weekIndex: 2, targetMeters: 50_000 },
      ],
    });
    expect(identity.qualityShare).toBe(0);
    expect(identity.numWeeks).toBe(2);
  });
});
