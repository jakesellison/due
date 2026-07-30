import {
  normalizeRelativePlan,
} from '../relative';
import {
  PlanImportError,
} from '../parseImport';

const valid = () => ({
  formatVersion: 3,
  source: 'starter',
  plan: { name: 'Half · 45 mpw', distanceKind: 'half', numWeeks: 2 },
  weeks: [{ week: 1, phase: 'base', targetMeters: 64374 }],
  workouts: [
    { week: 1, day: 1, type: 'quality', title: '6×800m @ 5K',
      plannedDistanceMeters: 11265,
      structure: [{ kind: 'repeat', sets: 6, children: [
        { kind: 'interval', target: { distance_m: 800, hr_zone: 'interval',
          pace: { kind: 'absolute', band: { fast_s_per_km: 248, slow_s_per_km: 258 }, intent: '5K' } } } ] }] },
    { week: 2, day: 5, type: 'long', title: 'Long 12 mi', plannedDistanceMeters: 19312 },
  ],
});

describe('normalizeRelativePlan', () => {
  it('accepts a valid v3 file and fills defaults', () => {
    const plan = normalizeRelativePlan(valid());
    expect(plan.formatVersion).toBe(3);
    expect(plan.plan.minWeeks).toBe(2);            // max(4, ceil(2*2/3)) capped at numWeeks
    expect(plan.weeks).toHaveLength(2);            // week 2 synthesized
    expect(plan.weeks[1]!.phase).toBe('build');    // synthesized default
    expect(plan.workouts[0]!.structure[0]!.kind).toBe('repeat');
  });

  it('rejects every formatVersion other than v3', () => {
    expect(() => normalizeRelativePlan({ ...valid(), formatVersion: 2 }))
      .toThrow(PlanImportError);
  });

  it('rejects out-of-range week/day', () => {
    const bad = valid();
    bad.workouts[0]!.day = 7 as never;
    expect(() => normalizeRelativePlan(bad)).toThrow(PlanImportError);
    const bad2 = valid();
    bad2.workouts[0]!.week = 3 as never;           // > numWeeks
    expect(() => normalizeRelativePlan(bad2)).toThrow(PlanImportError);
  });

  it('rejects a plan with no workouts', () => {
    expect(() => normalizeRelativePlan({ ...valid(), workouts: [] }))
      .toThrow(PlanImportError);
  });

  it('respects an explicit minWeeks and caps numWeeks at 53', () => {
    const p = normalizeRelativePlan({ ...valid(),
      plan: { name: 'X', distanceKind: 'custom', numWeeks: 2, minWeeks: 2 } });
    expect(p.plan.minWeeks).toBe(2);
    expect(() => normalizeRelativePlan({ ...valid(),
      plan: { name: 'X', distanceKind: 'custom', numWeeks: 60 } }))
      .toThrow(PlanImportError);
  });

  it('rejects a plan with too many workouts', () => {
    const workouts = Array.from({ length: 1201 }, () => ({ week: 1, day: 0, type: 'easy', title: 'Easy' }));
    expect(() =>
      normalizeRelativePlan({ ...valid(), plan: { name: 'X', distanceKind: 'custom', numWeeks: 53 }, workouts }),
    ).toThrow(PlanImportError);
  });

  it('accepts miles convenience field distanceMiles', () => {
    const p = normalizeRelativePlan({ ...valid(), workouts: [
      { week: 1, day: 2, type: 'easy', title: 'Easy 5', distanceMiles: 5 }] });
    expect(p.workouts[0]!.plannedDistanceMeters).toBe(8047);
  });

  it('keeps relative intent distinct from an absolute pace band', () => {
    const p = normalizeRelativePlan({
      ...valid(),
      workouts: [{
        week: 1,
        day: 2,
        type: 'quality',
        title: 'MP progression',
        structure: [
          {
            kind: 'steady',
            target: {
              distance_m: 5000,
              pace: { kind: 'relative', reference: 'MP', speed_fraction: 0.92 },
            },
          },
          {
            kind: 'steady',
            target: {
              distance_m: 5000,
              pace: {
                kind: 'absolute',
                band: { fast_s_per_km: 248, slow_s_per_km: 258 },
                intent: 'MP',
              },
            },
          },
        ],
      }],
    });
    const [relative, absolute] = p.workouts[0]!.structure;
    expect(relative?.kind === 'steady' ? relative.target.pace : null).toEqual({
      kind: 'relative',
      reference: 'MP',
      speed_fraction: 0.92,
    });
    expect(absolute?.kind === 'steady' ? absolute.target.pace : null).toEqual({
      kind: 'absolute',
      band: { fast_s_per_km: 248, slow_s_per_km: 258 },
      intent: 'MP',
    });
  });
});
