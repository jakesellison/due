/**
 * mapWorkoutRow — maps a raw `workouts` DB row into a WorkoutRow, running the
 * jsonb `structure` column through normalizeStructure so malformed/"fat" legacy
 * jsonb is sanitized on the read path before it can reach renderers.
 */
// The supabase client throws at import time without baked config; mapWorkoutRow
// is pure, so stub the module out.
jest.mock('../../supabase', () => ({ supabase: {} }));

import { mapWorkoutRow } from '../activePlan';

const baseRow = (over: Record<string, unknown>) => ({
  id: 'w1',
  week_id: 'wk1',
  date: '2026-06-15',
  type: 'quality',
  title: 'Intervals',
  planned_distance_meters: 10000,
  planned_duration_s: null,
  structure: [],
  is_quality: true,
  notes: null,
  ...over,
});

describe('mapWorkoutRow', () => {
  it('passes through scalar columns unchanged', () => {
    const out = mapWorkoutRow(baseRow({}));
    expect(out.id).toBe('w1');
    expect(out.week_id).toBe('wk1');
    expect(out.type).toBe('quality');
    expect(out.is_quality).toBe(true);
    expect(out.planned_distance_meters).toBe(10000);
  });

  it('normalizes a malformed/fat structure jsonb into the clean Segment union', () => {
    // A "fat" wire shape: nullable target axes, sets/children on leaves, an
    // invalid kind, and an empty repeat — all of which normalizeStructure drops.
    const out = mapWorkoutRow(
      baseRow({
        structure: [
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
          {
            kind: 'repeat',
            target: null,
            sets: 4,
            children: [
              {
                kind: 'work',
                target: { by: ['distance'], distance_m: 400, duration_s: null },
                note: null,
              },
            ],
            note: null,
          },
          // junk that must be discarded
          { kind: 'bogus', target: { by: ['distance'], distance_m: 100 } },
          { kind: 'repeat', target: null, sets: 3, children: [], note: null },
        ],
      }),
    );

    expect(out.structure).toEqual([
      { kind: 'warmup', target: { by: ['distance'], distance_m: 3219 } },
      {
        kind: 'repeat',
        sets: 4,
        children: [{ kind: 'work', target: { by: ['distance'], distance_m: 400 } }],
      },
    ]);
  });

  it('coerces a non-array / null structure jsonb to an empty WorkoutStructure', () => {
    expect(mapWorkoutRow(baseRow({ structure: null })).structure).toEqual([]);
    expect(mapWorkoutRow(baseRow({ structure: 'garbage' })).structure).toEqual([]);
    expect(mapWorkoutRow(baseRow({ structure: undefined })).structure).toEqual([]);
  });
});
