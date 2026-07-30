import {
  normalizeStructure,
} from '../plan/normalizeStructure';

describe('normalizeStructure', () => {
  it('returns [] for non-array / empty input', () => {
    expect(normalizeStructure(null)).toEqual([]);
    expect(normalizeStructure(undefined)).toEqual([]);
    expect(normalizeStructure('nope')).toEqual([]);
    expect(normalizeStructure([])).toEqual([]);
  });

  it('cleans a leaf segment: drops null target fields, keeps real ones', () => {
    const out = normalizeStructure([
      {
        kind: 'warmup',
        target: {
          by: ['distance'],
          distance_m: 3219,
          duration_s: null,
          pace: null,
          hr_zone: null,
          effort: null,
          note: null,
        },
        sets: null,
        children: null,
        note: null,
      },
    ]);
    expect(out).toEqual([
      { kind: 'warmup', target: { by: ['distance'], distance_m: 3219 } },
    ]);
  });

  it('maps a fat repeat object into a clean RepeatSegment with leaf children', () => {
    const out = normalizeStructure([
      {
        kind: 'repeat',
        target: null,
        sets: 4,
        children: [
          {
            kind: 'work',
            target: {
              by: ['distance', 'pace'],
              distance_m: 3219,
              duration_s: null,
              pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 },
              hr_zone: 'threshold',
              effort: null,
              note: null,
            },
            note: null,
          },
          {
            kind: 'recovery',
            target: {
              by: ['time'],
              distance_m: null,
              duration_s: 90,
              pace: null,
              hr_zone: null,
              effort: null,
              note: null,
            },
            note: 'jog',
          },
        ],
        note: null,
      },
    ]);
    expect(out).toEqual([
      {
        kind: 'repeat',
        sets: 4,
        children: [
          { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 3219, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 }, hr_zone: 'threshold' } },
          { kind: 'recovery', target: { by: ['time'], duration_s: 90 }, note: 'jog' },
        ],
      },
    ]);
  });

  it('drops invalid kinds, invalid enum values, and structurally empty segments', () => {
    const out = normalizeStructure([
      { kind: 'bogus', target: { by: ['distance'], distance_m: 100 }, sets: null, children: null, note: null },
      { kind: 'steady', target: { by: ['pace'], pace: { kind: 'relative', reference: 'WAT', speed_fraction: 1 }, hr_zone: 'nope' }, sets: null, children: null, note: null },
      { kind: 'repeat', target: null, sets: 3, children: [], note: null },
      { kind: 'work', target: null, sets: null, children: null, note: null },
    ]);
    // bogus kind dropped; steady kept but bad enums stripped; empty repeat dropped; targetless work dropped
    expect(out).toEqual([
      { kind: 'steady', target: { by: ['pace'] } },
    ]);
  });

  it('coerces a repeat with no/invalid sets to at least 1 and ignores nested repeats in children', () => {
    const out = normalizeStructure([
      {
        kind: 'repeat',
        target: null,
        sets: 0,
        children: [
          { kind: 'interval', target: { by: ['distance'], distance_m: 400 }, note: null },
          { kind: 'repeat', target: null, sets: 2, children: [], note: null },
        ],
        note: null,
      },
    ]);
    expect(out).toEqual([
      {
        kind: 'repeat',
        sets: 1,
        children: [{ kind: 'interval', target: { by: ['distance'], distance_m: 400 } }],
      },
    ]);
  });
});
