import {
  runnerRacePaces,
  resolveTargetPace,
} from '../kpi/targetPace';
import type { Target } from '../workout/types';

describe('runnerRacePaces', () => {
  test('derives faster paces for shorter races from a 3:30 marathon', () => {
    const p = runnerRacePaces(3 * 3600 + 30 * 60)!; // 12600 s
    // MP for 3:30 over 26.2188 mi ≈ 480.6 s/mi
    expect(p.mp).toBeGreaterThan(470);
    expect(p.mp).toBeLessThan(490);
    // shorter races are faster (lower s/mi)
    expect(p['5k']).toBeLessThan(p['10k']);
    expect(p['10k']).toBeLessThan(p.hmp);
    expect(p.hmp).toBeLessThan(p.mp);
    expect(p.mile).toBeLessThan(p['3k']);
  });

  test('returns null for a non-positive prediction', () => {
    expect(runnerRacePaces(0)).toBeNull();
  });
});

describe('resolveTargetPace', () => {
  const paces = runnerRacePaces(12600)!;

  test('prefers an explicit numeric pace (s/km → s/mi)', () => {
    const t: Target = {
      by: 'pace',
      pace: { kind: 'absolute', band: { fast_s_per_km: 300, slow_s_per_km: 300 } },
    }; // 5:00/km
    expect(resolveTargetPace(t, paces)).toBeCloseTo((300 / 1000) * 1609.344, 1);
  });

  test('uses the midpoint of a pace range', () => {
    const t: Target = {
      by: 'pace',
      pace: { kind: 'absolute', band: { fast_s_per_km: 280, slow_s_per_km: 320 } },
    };
    expect(resolveTargetPace(t, paces)).toBeCloseTo((300 / 1000) * 1609.344, 1);
  });

  test('resolves a named label against race paces', () => {
    expect(resolveTargetPace({ by: 'pace', pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } }, paces)).toBe(paces['5k']);
    expect(resolveTargetPace({ by: 'pace', pace: { kind: 'relative', reference: 'MP', speed_fraction: 1 } }, paces)).toBe(paces.mp);
    expect(resolveTargetPace({ by: 'pace', pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } }, paces)).toBe(paces.threshold);
  });

  test('interprets a relative fraction as speed, so 92% MP is slower than MP', () => {
    const target: Target = {
      by: 'pace',
      pace: { kind: 'relative', reference: 'MP', speed_fraction: 0.92 },
    };
    expect(resolveTargetPace(target, paces)).toBeCloseTo(paces.mp / 0.92, 6);
    expect(resolveTargetPace(target, paces)).toBeGreaterThan(paces.mp);
  });

  test('keeps an absolute band authoritative even when it carries MP intent', () => {
    const target: Target = {
      by: 'pace',
      pace: {
        kind: 'absolute',
        band: { fast_s_per_km: 240, slow_s_per_km: 250 },
        intent: 'MP',
      },
    };
    expect(resolveTargetPace(target, paces)).toBeCloseTo((245 / 1000) * 1609.344, 6);
  });

  test('returns null when a label cannot be resolved without paces', () => {
    expect(resolveTargetPace({ by: 'pace', pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } }, null)).toBeNull();
    expect(resolveTargetPace({ by: 'effort', effort: 'RPE 8' }, paces)).toBeNull();
  });
});
