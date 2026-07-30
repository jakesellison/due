import {
  weekPaceExpectation,
} from '../kpi/weekPace';
import type { CalendarDay } from '../kpi/weekDays';
import type { WorkoutTone } from '../workout/structureBar';

const M = 1609.344;

type W = { plannedMeters: number; isQuality?: boolean; tone?: WorkoutTone };

/** Minimal CalendarDay for the pace math — only the fields the helper reads. */
function day(dayIndex: number, isToday: boolean, workouts: W[]): CalendarDay {
  return {
    dayIndex,
    isToday,
    workouts: workouts.map((w) => ({
      plannedMeters: w.plannedMeters,
      isQuality: w.isQuality ?? false,
      tone: w.tone ?? 'easy',
    })),
  } as unknown as CalendarDay;
}

// Mon(0) easy 10, Tue(1) quality 8, Wed(2) easy 6, Thu(3) easy 10,
// Sat(5) long 20 — a representative week.
const week = (todayIdx: number) => [
  day(0, todayIdx === 0, [{ plannedMeters: 10 * M }]),
  day(1, todayIdx === 1, [{ plannedMeters: 8 * M, isQuality: true }]),
  day(2, todayIdx === 2, [{ plannedMeters: 6 * M }]),
  day(3, todayIdx === 3, [{ plannedMeters: 10 * M }]),
  day(4, todayIdx === 4, []),
  day(5, todayIdx === 5, [{ plannedMeters: 20 * M, tone: 'long' }]),
  day(6, todayIdx === 6, []),
];

// A structure-less quality workout falls back to 60% of its distance for the
// prescribed-hard-miles metric: 8 mi → 4.8 mi ≈ 5.
test('sums only days strictly before today', () => {
  // Today = Wed(2): Mon + Tue are due (10 + 8 = 18 mi), Wed not yet.
  const p = weekPaceExpectation(week(2));
  expect(Math.round(p.mileageMeters / M)).toBe(18);
  expect(Math.round(p.qualityMeters / M)).toBe(5); // Tue quality due, prescribed hard-miles
  expect(p.longMeters).toBe(0); // Sat long not due yet
});

test('quality not yet due reads zero (its day is upcoming)', () => {
  // Today = Mon(0): nothing before it.
  const p = weekPaceExpectation(week(0));
  expect(p.mileageMeters).toBe(0);
  expect(p.qualityMeters).toBe(0);
  expect(p.longMeters).toBe(0);
});

test('long run counts once its day has elapsed', () => {
  // Today = Sun(6): everything before Sun is due, including Sat long.
  const p = weekPaceExpectation(week(6));
  expect(Math.round(p.longMeters / M)).toBe(20);
  expect(Math.round(p.qualityMeters / M)).toBe(5); // prescribed hard-miles (60% of 8)
  expect(Math.round(p.mileageMeters / M)).toBe(10 + 8 + 6 + 10 + 20);
});

test('no today in the set → all zero (non-current week)', () => {
  const p = weekPaceExpectation(week(-1));
  expect(p).toEqual({ mileageMeters: 0, qualityMeters: 0, longMeters: 0 });
});
