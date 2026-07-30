/**
 * planHeaderInfo — the registered `days_to_race` fact deriver (test-audit
 * gap #4). Zero-covered until now despite feeding the Dash header countdown.
 */
import { planHeaderInfo } from '../planHeader';

const plan = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Chicago 2026', race_name: 'Chicago 2026', race_date: '2026-10-11',
  goal_time: '2:36:00', num_weeks: 23, start_date: '2026-05-04', ...extra,
});
const TODAY = '2026-07-30';

test('days_to_race is a whole-day civil difference', () => {
  expect(planHeaderInfo(plan() as never, null, TODAY).daysToRace).toBe(73);
});

test('race day itself is 0, the day after is negative', () => {
  expect(planHeaderInfo(plan() as never, null, '2026-10-11').daysToRace).toBe(0);
  expect(planHeaderInfo(plan() as never, null, '2026-10-12').daysToRace).toBe(-1);
});

test('no race date -> null countdown, never NaN', () => {
  const out = planHeaderInfo(plan({ race_date: null }) as never, null, TODAY);
  expect(out.daysToRace).toBeNull();
});

test('race line composes name + formatted goal, and survives a missing goal', () => {
  expect(planHeaderInfo(plan() as never, null, TODAY).raceLine).toBe('Chicago 2026  2:36');
  expect(planHeaderInfo(plan({ goal_time: null }) as never, null, TODAY).raceLine).toBe('Chicago 2026');
});

test('no plan at all renders the em-dash placeholder shape', () => {
  const out = planHeaderInfo(null, null, TODAY);
  expect(out.raceName).toBe('—');
  expect(out.daysToRace).toBeNull();
});

test('recovery week label composes phase + Recovery', () => {
  const summary = { current: { phase: 'build', isRecovery: true, weekIndex: 12 } } as never;
  expect(planHeaderInfo(plan() as never, summary, TODAY).phaseLabel).toBe('Build  Recovery');
});
