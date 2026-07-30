import {
  weekStripDays,
  type WeekStripActivityInput,
  type WeekStripWorkoutInput,
} from '../kpi/weekStrip';

// A Monday-started week: Mon 2026-06-01 .. Sun 2026-06-07.
const MON = '2026-06-01';
const TUE = '2026-06-02';
const WED = '2026-06-03';
const THU = '2026-06-04';
const FRI = '2026-06-05';
const SAT = '2026-06-06';
const SUN = '2026-06-07';

function wo(p: Partial<WeekStripWorkoutInput> & { date: string }): WeekStripWorkoutInput {
  return {
    id: `w-${p.date}-${p.type ?? 'easy'}`,
    type: 'easy',
    plannedMeters: 16000,
    isQuality: false,
    ...p,
  };
}
function act(p: Partial<WeekStripActivityInput> & { localDate: string }): WeekStripActivityInput {
  return { id: `a-${p.localDate}`, distanceMeters: 16000, ...p };
}

describe('weekStripDays', () => {
  test('returns 7 Mon→Sun chips with the right initials and dates', () => {
    const days = weekStripDays([], [], WED, { weekStartDate: MON });
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.initial)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(days.map((d) => d.localDate)).toEqual([MON, TUE, WED, THU, FRI, SAT, SUN]);
    expect(days.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('a day with an activity → done, actual miles, workout tap target', () => {
    const days = weekStripDays(
      [wo({ date: MON, plannedMeters: 16000 })],
      [act({ localDate: MON, distanceMeters: 19400 })],
      WED,
      { weekStartDate: MON },
    );
    const mon = days[0]!;
    expect(mon.state).toBe('done');
    expect(mon.actualMeters).toBe(19400);
    expect(mon.plannedMeters).toBe(16000);
    expect(mon.target).toEqual({ kind: 'workout', id: 'w-2026-06-01-easy' });
  });

  test('past scheduled run with no activity → missed', () => {
    const days = weekStripDays([wo({ date: MON })], [], WED, { weekStartDate: MON });
    expect(days[0]!.state).toBe('missed');
    expect(days[0]!.plannedMeters).toBe(16000);
  });

  test('today scheduled, not yet run → today-pending (never a miss)', () => {
    const days = weekStripDays([wo({ date: WED })], [], WED, { weekStartDate: MON });
    const wed = days[2]!;
    expect(wed.state).toBe('today-pending');
    expect(wed.isToday).toBe(true);
  });

  test('today counts only in favor: a run today → done, not pending', () => {
    const days = weekStripDays(
      [wo({ date: WED })],
      [act({ localDate: WED, distanceMeters: 12000 })],
      WED,
      { weekStartDate: MON },
    );
    expect(days[2]!.state).toBe('done');
    expect(days[2]!.actualMeters).toBe(12000);
  });

  test('future scheduled run → upcoming', () => {
    const days = weekStripDays([wo({ date: FRI })], [], WED, { weekStartDate: MON });
    expect(days[4]!.state).toBe('upcoming');
  });

  test('rest day (no workout) → rest, no-op tap, past or future', () => {
    const days = weekStripDays([], [], WED, { weekStartDate: MON });
    expect(days[0]!.state).toBe('rest'); // past
    expect(days[6]!.state).toBe('rest'); // future
    expect(days[0]!.target).toEqual({ kind: 'none' });
  });

  test('explicit rest-typed workout → rest (not a run day)', () => {
    const days = weekStripDays(
      [wo({ date: SUN, type: 'rest', plannedMeters: 0 })],
      [],
      WED,
      { weekStartDate: MON },
    );
    expect(days[6]!.state).toBe('rest');
    expect(days[6]!.target).toEqual({ kind: 'none' });
  });

  test('quality day carries the volt accent and prefers the quality workout for tap', () => {
    const days = weekStripDays(
      [
        wo({ date: TUE, type: 'easy', isQuality: false }),
        wo({ date: TUE, type: 'quality', isQuality: true, plannedMeters: 12800 }),
      ],
      [],
      MON,
      { weekStartDate: MON },
    );
    const tue = days[1]!;
    expect(tue.isQuality).toBe(true);
    expect(tue.isDouble).toBe(true); // two planned workouts
    expect(tue.target).toEqual({ kind: 'workout', id: 'w-2026-06-02-quality' });
  });

  test('race day flags isRace + isQuality and prefers the race workout', () => {
    const days = weekStripDays(
      [wo({ date: SUN, type: 'race', isQuality: false, plannedMeters: 42195 })],
      [],
      MON,
      { weekStartDate: MON },
    );
    const sun = days[6]!;
    expect(sun.isRace).toBe(true);
    expect(sun.isQuality).toBe(true);
    expect(sun.target).toEqual({ kind: 'workout', id: 'w-2026-06-07-race' });
  });

  test('double day sums actuals and is flagged', () => {
    const days = weekStripDays(
      [wo({ date: MON, plannedMeters: 16000 })],
      [
        act({ localDate: MON, id: 'am', distanceMeters: 8000 }),
        act({ localDate: MON, id: 'pm', distanceMeters: 6000 }),
      ],
      WED,
      { weekStartDate: MON },
    );
    const mon = days[0]!;
    expect(mon.isDouble).toBe(true);
    expect(mon.actualMeters).toBe(14000);
    expect(mon.state).toBe('done');
  });

  test('unplanned run (no workout) → done with a run tap target (largest)', () => {
    const days = weekStripDays(
      [],
      [
        act({ localDate: THU, id: 'small', distanceMeters: 5000 }),
        act({ localDate: THU, id: 'big', distanceMeters: 18000 }),
      ],
      FRI,
      { weekStartDate: MON },
    );
    const thu = days[3]!;
    expect(thu.state).toBe('done');
    expect(thu.target).toEqual({ kind: 'run', id: 'big' });
  });

  test('a run on a scheduled rest day still reads as done', () => {
    const days = weekStripDays([], [act({ localDate: SUN })], MON, { weekStartDate: MON });
    expect(days[6]!.state).toBe('done');
  });

  test('weekStartDate snaps to the Monday of its week', () => {
    // Passing a mid-week date resolves the same Mon→Sun span.
    const days = weekStripDays([], [], THU, { weekStartDate: THU });
    expect(days[0]!.localDate).toBe(MON);
    expect(days[6]!.localDate).toBe(SUN);
  });
});
