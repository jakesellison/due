import {
  applyEdits,
  type DragDay,
  type EditableDay,
  type EditOp,
  type WorkoutType,
} from '../plan/weekEdit';

const MI = 1609.344;

function makeDay(
  overrides: Partial<EditableDay> & { date: string },
): EditableDay {
  return {
    id: `id-${overrides.date}`,
    type: 'easy' as WorkoutType,
    title: 'Easy run',
    plannedDistanceMeters: 10 * MI,
    isQuality: false,
    ...overrides,
  };
}

const WEEK: EditableDay[] = [
  makeDay({ date: '2026-06-15', type: 'easy', plannedDistanceMeters: 8 * MI }),
  makeDay({ date: '2026-06-16', type: 'quality', plannedDistanceMeters: 10 * MI, isQuality: true }),
  makeDay({ date: '2026-06-17', type: 'easy', plannedDistanceMeters: 6 * MI }),
  makeDay({ date: '2026-06-18', type: 'rest', plannedDistanceMeters: 0, isQuality: false }),
  makeDay({ date: '2026-06-19', type: 'easy', plannedDistanceMeters: 8 * MI }),
  makeDay({ date: '2026-06-20', type: 'long', plannedDistanceMeters: 18 * MI }),
  makeDay({ date: '2026-06-21', type: 'rest', plannedDistanceMeters: 0, isQuality: false }),
];

describe('applyEdits — setType', () => {
  test('changes type and clears isQuality when retyped to easy', () => {
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-16', newType: 'easy' },
    ];
    const result = applyEdits(WEEK, ops);
    const day = result.find((d) => d.date === '2026-06-16')!;
    expect(day.type).toBe('easy');
    expect(day.isQuality).toBe(false);
  });

  test('sets isQuality=true when retyped to quality', () => {
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-15', newType: 'quality' },
    ];
    const result = applyEdits(WEEK, ops);
    const day = result.find((d) => d.date === '2026-06-15')!;
    expect(day.type).toBe('quality');
    expect(day.isQuality).toBe(true);
  });

  test('retitles a generic "Rest Day" label when rest is retyped to easy', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-18', type: 'rest', title: 'Rest Day', plannedDistanceMeters: 0 }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-18', newType: 'easy' },
    ];
    const day = applyEdits(week, ops).find((d) => d.date === '2026-06-18')!;
    expect(day.type).toBe('easy');
    expect(day.title).toBe('Easy Run');
  });

  test('retitles the bare generic "Rest" label when rest is retyped to long', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-18', type: 'rest', title: 'Rest', plannedDistanceMeters: 0 }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-18', newType: 'long' },
    ];
    const day = applyEdits(week, ops).find((d) => d.date === '2026-06-18')!;
    expect(day.title).toBe('Long Run');
  });

  test('preserves a custom user-authored title when the type changes', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-18', type: 'rest', title: "Grandma's loop", plannedDistanceMeters: 0 }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-18', newType: 'easy' },
    ];
    const day = applyEdits(week, ops).find((d) => d.date === '2026-06-18')!;
    expect(day.type).toBe('easy');
    expect(day.title).toBe("Grandma's loop");
  });

  test('retitles to the canonical "Quality Run" when retyped to quality', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-15', type: 'easy', title: 'Easy Run' }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-15', newType: 'quality' },
    ];
    const day = applyEdits(week, ops)[0]!;
    expect(day.title).toBe('Quality Run');
    expect(day.isQuality).toBe(true);
  });

  test('treats the former "Quality Workout" default as generic (retitled on retype)', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-16', type: 'quality', title: 'Quality Workout', isQuality: true }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-16', newType: 'easy' },
    ];
    const day = applyEdits(week, ops)[0]!;
    expect(day.title).toBe('Easy Run');
  });

  test('retitles a generic label to "Rest Day" when retyped to rest', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-19', type: 'easy', title: 'Easy run' }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-19', newType: 'rest' },
    ];
    const day = applyEdits(week, ops)[0]!;
    expect(day.title).toBe('Rest Day');
  });

  test('preserves the custom title "Track Tuesday" when retyped', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-16', type: 'quality', title: 'Track Tuesday', isQuality: true }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-16', newType: 'easy' },
    ];
    const day = applyEdits(week, ops)[0]!;
    expect(day.title).toBe('Track Tuesday');
  });
});

describe('applyEdits — setDistance', () => {
  test('updates planned distance on the target row', () => {
    const ops: EditOp[] = [
      { kind: 'setDistance', workoutId: 'id-2026-06-15', newDistanceMeters: 12 * MI },
    ];
    const result = applyEdits(WEEK, ops);
    const day = result.find((d) => d.date === '2026-06-15')!;
    expect(day.plannedDistanceMeters).toBeCloseTo(12 * MI);
  });

  test('other days are unchanged', () => {
    const ops: EditOp[] = [
      { kind: 'setDistance', workoutId: 'id-2026-06-15', newDistanceMeters: 12 * MI },
    ];
    const result = applyEdits(WEEK, ops);
    const long = result.find((d) => d.date === '2026-06-20')!;
    expect(long.plannedDistanceMeters).toBeCloseTo(18 * MI);
  });

  test('never touches the title (even a stale generic one)', () => {
    // A distance change alone must not retitle: "Rest Day" keeps its label
    // until a setType op actually changes the day's type.
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-21', type: 'rest', title: 'Rest Day', plannedDistanceMeters: 0 }),
    ];
    const ops: EditOp[] = [
      { kind: 'setDistance', workoutId: 'id-2026-06-21', newDistanceMeters: 13 * MI },
    ];
    const day = applyEdits(week, ops)[0]!;
    expect(day.title).toBe('Rest Day');
    expect(day.plannedDistanceMeters).toBeCloseTo(13 * MI);
  });
});

describe('applyEdits — move', () => {
  test('relocates workout to toDate', () => {
    // Move quality day from 2026-06-16 to 2026-06-18 (rest day)
    const ops: EditOp[] = [
      { kind: 'move', workoutId: 'id-2026-06-16', toDate: '2026-06-18' },
    ];
    const result = applyEdits(WEEK, ops);
    const moved = result.find((d) => d.id === 'id-2026-06-16')!;
    expect(moved.date).toBe('2026-06-18');
  });

  test('vacated date becomes rest when no other run remains there', () => {
    // 2026-06-16 had only one run; after moving it should become rest
    const ops: EditOp[] = [
      { kind: 'move', workoutId: 'id-2026-06-16', toDate: '2026-06-18' },
    ];
    const result = applyEdits(WEEK, ops);
    // The vacated rest slot (originally 2026-06-18) now hosts the moved run
    // and the original 2026-06-16 slot should be rest
    const vacated = result.find((d) => d.date === '2026-06-16' && d.id !== 'id-2026-06-16');
    // OR: the original row was moved away, leaving that date with a rest placeholder
    // The implementation places a rest row at the vacated date when no run remains.
    const allDates = result.map((d) => d.date);
    expect(allDates).toContain('2026-06-16');
    const dayAt16 = result.filter((d) => d.date === '2026-06-16');
    expect(dayAt16.every((d) => d.type === 'rest')).toBe(true);
    // The synthetic placeholder carries the canonical rest title.
    expect(dayAt16.some((d) => d.title === 'Rest Day')).toBe(true);
  });
});

describe('applyEdits — addDouble', () => {
  test('inserts a second easy run on the date', () => {
    const ops: EditOp[] = [
      { kind: 'addDouble', onDate: '2026-06-15', distanceMeters: 5 * MI },
    ];
    const result = applyEdits(WEEK, ops);
    const onDate = result.filter((d) => d.date === '2026-06-15');
    expect(onDate).toHaveLength(2);
    const pm = onDate.find((d) => d.isInserted);
    expect(pm).toBeDefined();
    expect(pm!.type).toBe('easy');
    expect(pm!.plannedDistanceMeters).toBeCloseTo(5 * MI);
    expect(pm!.id).toBeNull();
  });
});

describe('applyEdits — setRest', () => {
  test('zeroes a workout row and sets type=rest', () => {
    const ops: EditOp[] = [
      { kind: 'setRest', workoutId: 'id-2026-06-16' },
    ];
    const result = applyEdits(WEEK, ops);
    const day = result.find((d) => d.id === 'id-2026-06-16')!;
    expect(day.type).toBe('rest');
    expect(day.plannedDistanceMeters).toBe(0);
    expect(day.isQuality).toBe(false);
  });

  test('retitles a generic label to "Rest Day" (setRest changes the type too)', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-19', type: 'easy', title: 'Easy run' }),
    ];
    const day = applyEdits(week, [{ kind: 'setRest', workoutId: 'id-2026-06-19' }])[0]!;
    expect(day.type).toBe('rest');
    expect(day.title).toBe('Rest Day');
  });

  test('preserves a custom title when zeroing to rest', () => {
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-19', type: 'easy', title: 'River loop shakeout' }),
    ];
    const day = applyEdits(week, [{ kind: 'setRest', workoutId: 'id-2026-06-19' }])[0]!;
    expect(day.title).toBe('River loop shakeout');
  });
});

describe('applyEdits — reflow max compound (rest activation)', () => {
  test('setType(rest->easy) + setDistance yields a coherent "Easy Run" day', () => {
    // The reflow 'max' variant activates a rest day by emitting the compound
    // op pair setType(rest->easy) THEN setDistance (see reflow.ts ops build).
    // The activated row must come out fully coherent: type easy, canonical
    // "Easy Run" title (never a stale "Rest Day" carrying miles), the assigned
    // distance, and not quality.
    const week: EditableDay[] = [
      makeDay({ date: '2026-06-18', type: 'rest', title: 'Rest Day', plannedDistanceMeters: 0 }),
    ];
    const ops: EditOp[] = [
      { kind: 'setType', workoutId: 'id-2026-06-18', newType: 'easy' },
      { kind: 'setDistance', workoutId: 'id-2026-06-18', newDistanceMeters: 4 * MI },
    ];
    const day = applyEdits(week, ops)[0]!;
    expect(day.type).toBe('easy');
    expect(day.title).toBe('Easy Run');
    expect(day.plannedDistanceMeters).toBeCloseTo(4 * MI);
    expect(day.isQuality).toBe(false);
  });
});

describe('applyEdits — swap', () => {
  test('two occupied days trade workouts (dates exchanged)', () => {
    // Swap Mon (easy 8) and Sat (long 18).
    const ops: EditOp[] = [{ kind: 'swap', dateA: '2026-06-15', dateB: '2026-06-20' }];
    const result = applyEdits(WEEK, ops);
    const mon = result.find((d) => d.date === '2026-06-15')!;
    const sat = result.find((d) => d.date === '2026-06-20')!;
    expect(mon.type).toBe('long');
    expect(mon.plannedDistanceMeters).toBeCloseTo(18 * MI);
    expect(sat.type).toBe('easy');
    expect(sat.plannedDistanceMeters).toBeCloseTo(8 * MI);
  });

  test('swap moves every row on each date (a two-a-day swaps as a group)', () => {
    const withDouble = applyEdits(WEEK, [
      { kind: 'addDouble', onDate: '2026-06-15', distanceMeters: 4 * MI },
    ]);
    const result = applyEdits(withDouble, [{ kind: 'swap', dateA: '2026-06-15', dateB: '2026-06-17' }]);
    // Both Monday rows (easy 8 + PM 4) now live on Wed (2026-06-17).
    const wed = result.filter((d) => d.date === '2026-06-17' && d.type !== 'rest');
    expect(wed).toHaveLength(2);
    // Wed's original easy 6 now sits on Mon.
    const mon = result.filter((d) => d.date === '2026-06-15' && d.type !== 'rest');
    expect(mon).toHaveLength(1);
    expect(mon[0]!.plannedDistanceMeters).toBeCloseTo(6 * MI);
  });

  test('swap clears settled flags so the moved miles re-count', () => {
    const settledWeek: EditableDay[] = [
      makeDay({ date: '2026-06-15', plannedDistanceMeters: 8 * MI, isCompleted: true, actualDistanceMeters: 8 * MI }),
      makeDay({ date: '2026-06-19', type: 'long', plannedDistanceMeters: 18 * MI }),
    ];
    const result = applyEdits(settledWeek, [{ kind: 'swap', dateA: '2026-06-15', dateB: '2026-06-19' }]);
    for (const d of result) {
      expect(d.isCompleted).toBe(false);
      expect(d.actualDistanceMeters).toBe(0);
    }
  });
});



