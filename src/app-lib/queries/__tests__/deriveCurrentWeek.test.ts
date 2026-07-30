/**
 * deriveCurrentWeek resolves the current plan week from each week's date span.
 * Plan weeks are 1-BASED: the importer assigns week_index = weeksBetween(start, …)
 * + 1, and `draft.ts` anchors each week at startDate + (week_index − 1) * 7, so
 * week 1 IS the plan-start week. Verifies the date-based resolution holds when
 * weeks are out of order or have gaps, and — critically — that a workout in the
 * current week is mapped (not dropped because currentWeekId landed on the wrong
 * plan-week row, which made the whole week look like rest days and drove a bogus
 * "rearrange your week" reflow).
 */

// adapt.ts imports the supabase client at module load; stub it (the derivation
// under test is pure and never touches it).
jest.mock('../../supabase', () => ({ supabase: {} }));

import { deriveCurrentWeek } from '../../adapt';
import type { ActivePlan, PlanWeekRow, WorkoutRow } from '../rows';

const START = '2026-01-05'; // a Monday; week 1 = Jan 5–11 (1-based)
const week = (id: string, weekIndex: number): PlanWeekRow => ({
  id,
  week_index: weekIndex,
  phase: 'base',
  target_meters: 40_000,
  original_target_meters: 40_000,
  is_recovery: false,
});

function plan(weeks: PlanWeekRow[], workouts: WorkoutRow[] = []): ActivePlan {
  return {
    plan: {
      id: 'p1',
      race_name: 'Test',
      race_date: null,
      distance_kind: 'marathon',
      start_date: START,
      num_weeks: 8,
      status: 'active',
      goal_time: null,
    },
    weeks,
    workouts,
  };
}

describe('deriveCurrentWeek — resolves by 1-based week date range, not array index', () => {
  // 1-based: week 1 = [Jan 5, Jan 12), week 2 = [Jan 12, Jan 19),
  // week 3 = [Jan 19, Jan 26). Today Jan 21 is in WEEK 3.
  test('picks the week whose [start, start+7) span contains today', () => {
    const weeks = [week('w1', 1), week('w2', 2), week('w3', 3), week('w4', 4)];
    const out = deriveCurrentWeek(plan(weeks), [], '2026-01-21');
    expect(out?.weekId).toBe('w3');
  });

  test('resolves correctly when weeks are out of array order', () => {
    const weeks = [week('w4', 4), week('w1', 1), week('w3', 3), week('w2', 2)];
    const out = deriveCurrentWeek(plan(weeks), [], '2026-01-21');
    expect(out?.weekId).toBe('w3');
  });

  test('resolves correctly when an early week is missing (gap in week_index)', () => {
    const weeks = [week('w1', 1), week('w3', 3), week('w4', 4)];
    const out = deriveCurrentWeek(plan(weeks), [], '2026-01-21');
    expect(out?.weekId).toBe('w3');
  });

  test('returns null when today falls outside every week span', () => {
    const weeks = [week('w1', 1), week('w2', 2)]; // plan ends Jan 19
    const out = deriveCurrentWeek(plan(weeks), [], '2026-03-01');
    expect(out).toBeNull();
  });

  // Regression: the off-by-one (week_index*7) resolved currentWeekId to the wrong
  // plan-week row, so `workouts.find(w.week_id === currentWeekId)` dropped every
  // real workout — the week looked like all rest days and a bogus reflow proposed
  // converting the (apparently empty) long-run day.
  test('selects the week whose week_id owns the current-week workouts', () => {
    const weeks = [week('w1', 1), week('w2', 2), week('w3', 3)];
    const longRun = {
      id: 'long-1',
      plan_id: 'p1',
      week_id: 'w3',
      date: '2026-01-24', // Saturday of week 3
      type: 'long',
      title: 'Long Run',
      planned_distance_meters: 32000,
      structure: [],
      is_quality: false,
    } as unknown as WorkoutRow;
    const out = deriveCurrentWeek(plan(weeks, [longRun]), [], '2026-01-21');
    // The current week resolves to w3 — the row that actually owns Saturday's
    // long run — not w2 (the off-by-one), which would orphan the workout.
    expect(out?.weekId).toBe('w3');
  });
});
