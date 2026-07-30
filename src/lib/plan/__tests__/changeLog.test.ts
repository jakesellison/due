import {
  buildChangeLog,
  dateToWeek,
  type RawPlanChange,
  type ChangeWorkout,
} from '../changeLog';

const START = '2026-06-01'; // a Monday
const WORKOUTS: ChangeWorkout[] = [
  { id: 'w-mon', date: '2026-06-15', type: 'easy' }, // week 3
  { id: 'w-wed', date: '2026-06-17', type: 'long' }, // week 3
];

function row(over: Partial<RawPlanChange>): RawPlanChange {
  return { id: 'r', actor_type: 'user', source: 'manual', change: {}, created_at: '2026-06-20T10:00:00Z', ...over };
}


describe('dateToWeek', () => {
  test('1-based week from plan start', () => {
    expect(dateToWeek('2026-06-01', '2026-06-01')).toBe(1);
    expect(dateToWeek('2026-06-01', '2026-06-07')).toBe(1);
    expect(dateToWeek('2026-06-01', '2026-06-08')).toBe(2);
    expect(dateToWeek('2026-06-01', '2026-06-15')).toBe(3);
    expect(dateToWeek('2026-06-01', '2026-05-30')).toBeNull(); // before start
  });
});
