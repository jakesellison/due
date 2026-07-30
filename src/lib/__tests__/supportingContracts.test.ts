import {
  deriveSupportingContractTargets,
  longestContinuousActivityMeters,
} from '../plan/supportingContracts';

describe('weekly supporting contracts', () => {
  it('captures long from an explicit continuous long workout, never the longest easy day', () => {
    expect(deriveSupportingContractTargets([
      { type: 'easy', isQuality: false, plannedDistanceMeters: 27_359, structure: [] },
      { type: 'long', isQuality: false, plannedDistanceMeters: 32_187, structure: [] },
    ])).toEqual({ qualityTargetMeters: 0, longTargetMeters: 32_187 });
  });

  it('does not invent a long-run contract from an ordinary high-volume workout', () => {
    expect(deriveSupportingContractTargets([
      { type: 'easy', isQuality: false, plannedDistanceMeters: 27_359, structure: [] },
    ]).longTargetMeters).toBe(0);
  });

  it('captures prescribed hard distance across the whole week', () => {
    const targets = deriveSupportingContractTargets([
      {
        type: 'quality',
        isQuality: true,
        plannedDistanceMeters: 22_531,
        structure: [{
          kind: 'repeat',
          sets: 5,
          children: [{
            kind: 'interval',
            target: { by: ['distance', 'pace'], distance_m: 3_219, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } },
          }],
        }],
      },
    ]);

    expect(targets.qualityTargetMeters).toBe(16_095);
  });

  it('prefers a captured duration-work distance over generic pace fallback', () => {
    const targets = deriveSupportingContractTargets([{
      type: 'quality',
      isQuality: true,
      plannedDistanceMeters: 10_000,
      prescribedQualityMeters: 4_321.4,
      structure: [{
        kind: 'repeat',
        sets: 6,
        children: [{ kind: 'work', target: { by: ['time', 'pace'], duration_s: 180, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } }],
      }],
    }]);
    expect(targets.qualityTargetMeters).toBe(4_321);
  });
});

describe('longestContinuousActivityMeters', () => {
  it('does not combine three activities from one day into a long run', () => {
    expect(longestContinuousActivityMeters([
      { distanceMeters: 9_683 },
      { distanceMeters: 12_909 },
      { distanceMeters: 4_879 },
    ])).toBe(12_909);
  });

  it('uses the longest individual activity across the week', () => {
    expect(longestContinuousActivityMeters([
      { distanceMeters: 9_683 },
      { distanceMeters: 27_373 },
      { distanceMeters: 12_909 },
    ])).toBe(27_373);
  });
});
