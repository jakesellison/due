import {
  weekDayBars,
  type SummaryWeekInput,
  type SummaryWorkoutInput,
  type SummaryActivityInput,
} from '../kpi/summarize';

// Four plan weeks, Monday starts. TODAY is Tue of the last (current) week.
const weeks: SummaryWeekInput[] = [
  { weekIndex: 2, phase: 'base', weekStart: '2026-05-04', targetMeters: 45000, isRecovery: false },
  { weekIndex: 3, phase: 'base', weekStart: '2026-05-11', targetMeters: 45000, isRecovery: false },
  { weekIndex: 4, phase: 'base', weekStart: '2026-05-18', targetMeters: 37000, isRecovery: false },
  { weekIndex: 5, phase: 'base', weekStart: '2026-05-25', targetMeters: 49000, isRecovery: false },
];

const TODAY = '2026-05-26'; // Tuesday of week starting 2026-05-25

// Each week: runs Mon..Sat (Sun is rest, no row). Tue is the quality day.
const PLAN_WINDOW = { from: '2026-05-04', to: '2026-05-31' };
const workouts: SummaryWorkoutInput[] = (() => {
  const out: SummaryWorkoutInput[] = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 0; d < 6; d++) {
      const date = shiftDate('2026-05-04', w * 7 + d);
      const isQuality = d === 1; // Tuesday
      out.push({ date, isQuality, type: isQuality ? 'quality' : 'easy' });
    }
    // Sunday (d=6) has no workout row → scheduled rest.
  }
  return out;
})();

function shiftDate(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const activities: SummaryActivityInput[] = [
  // Week 2 (05-04..10): hits 45k. Mon short, Tue quality, Sun long (biggest).
  { localDate: '2026-05-04', distanceMeters: 5000 },
  { localDate: '2026-05-05', distanceMeters: 10000 },
  { localDate: '2026-05-10', distanceMeters: 30000 },
  // Week 3 (05-11..17): 38k — short of 45k. Thu (05-14) is a zero day.
  { localDate: '2026-05-11', distanceMeters: 5000 },
  { localDate: '2026-05-12', distanceMeters: 10000 },
  { localDate: '2026-05-17', distanceMeters: 23000 },
  // Week 4 (05-18..24): 40k ≥ 37k target → hit.
  { localDate: '2026-05-18', distanceMeters: 6000 },
  { localDate: '2026-05-19', distanceMeters: 11000 },
  { localDate: '2026-05-24', distanceMeters: 23000 },
  // Week 5 (current, 05-25..): only Mon + today so far (15k of 49k).
  { localDate: '2026-05-25', distanceMeters: 8000 },
  { localDate: '2026-05-26', distanceMeters: 7000 },
];

describe('weekDayBars', () => {
  const summary = weekDayBars(weeks, workouts, activities, TODAY, {
    planWindow: PLAN_WINDOW,
  });

  test('produces one row per visible week, labelled W1..W4', () => {
    expect(summary.weeks).toHaveLength(4);
    expect(summary.weeks.map((w) => w.label)).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(summary.windowDays).toBe(28);
    // Each row has 7 day bars.
    for (const w of summary.weeks) expect(w.days).toHaveLength(7);
  });

  test('each row carries the matching plan week index (for tap-through)', () => {
    // weekStart → weekIndex is resolved from the inputs; a visible week that maps
    // to a plan week carries its index, and the slot before the plan starts is null.
    const wk = summary.weeks.find((w) => w.weekStart === '2026-05-11')!;
    expect(wk.weekIndex).toBe(3);
    const preplan = summary.weeks.find((w) => w.weekStart === '2026-04-27');
    if (preplan) expect(preplan.weekIndex).toBeNull();
  });

  test('heights are max-normalized across the whole window', () => {
    // The single biggest day in the window is 30k (week 2 Sunday).
    const all = summary.weeks.flatMap((w) => w.days);
    const peak = all.find((d) => d.distanceMeters === 30000)!;
    expect(peak.heightFraction).toBeCloseTo(1, 6);
    // A 15k day (week 5 today is 7k; week 2 Tue is 10k) is proportional.
    const tenK = all.find((d) => d.distanceMeters === 10000)!;
    expect(tenK.heightFraction).toBeCloseTo(10000 / 30000, 6);
  });

  test('zero days carry a zero fraction + isZero flag', () => {
    const wk3 = summary.weeks.find((w) => w.weekStart === '2026-05-11')!;
    const thu = wk3.days[3]!; // 2026-05-14, no activity
    expect(thu.localDate).toBe('2026-05-14');
    expect(thu.distanceMeters).toBe(0);
    expect(thu.isZero).toBe(true);
    expect(thu.heightFraction).toBe(0);
  });

  test('four-state day classification', () => {
    const byStart = new Map(summary.weeks.map((w) => [w.weekStart, w]));
    // W3 Thu 05-14: elapsed scheduled run, no activity → missed.
    expect(byStart.get('2026-05-11')!.days[3]!.state).toBe('missed');
    // W3 Sun 05-17: scheduled rest, but a run landed there → ran.
    expect(byStart.get('2026-05-11')!.days[6]!.state).toBe('ran');
    // W2 Sun 05-10: scheduled rest with a run → ran; W4 Wed 05-20 no run, run day, past → missed.
    expect(byStart.get('2026-05-18')!.days[2]!.state).toBe('missed'); // 05-20
    // Current week W5: today 05-26 ran → ran; Wed 05-27 future → future; Sun 05-31 rest+future → future.
    const wk5 = byStart.get('2026-05-25')!;
    expect(wk5.days[1]!.localDate).toBe('2026-05-26');
    expect(wk5.days[1]!.state).toBe('ran');
    expect(wk5.days[2]!.localDate).toBe('2026-05-27');
    expect(wk5.days[2]!.state).toBe('future');
    expect(wk5.days[6]!.localDate).toBe('2026-05-31');
    expect(wk5.days[6]!.state).toBe('future');
    // A scheduled rest day with no run in the past would be 'rest' — none here
    // (every Sunday in the past carries a long run), so assert the synthetic case
    // via the unit test in schedule.test.ts.
  });

  test('flags the quality day and today', () => {
    const wk5 = summary.weeks.find((w) => w.weekStart === '2026-05-25')!;
    const mon = wk5.days[0]!; // 2026-05-25 (no quality)
    const tue = wk5.days[1]!; // 2026-05-26 today + quality
    expect(mon.isQuality).toBe(false);
    expect(tue.isToday).toBe(true);
    expect(tue.isQuality).toBe(true);
    // tone follows the planned workout type (colours the cell): easy vs quality.
    expect(mon.tone).toBe('easy');
    expect(tue.tone).toBe('quality');
    // No other day is "today".
    expect(summary.weeks.flatMap((w) => w.days).filter((d) => d.isToday)).toHaveLength(1);
  });

  test('verdicts: hit when ≥ target, short otherwise, current week in progress', () => {
    const byStart = new Map(summary.weeks.map((w) => [w.weekStart, w]));
    expect(byStart.get('2026-05-04')!.verdict).toBe('hit'); // 45k ≥ 45k
    expect(byStart.get('2026-05-11')!.verdict).toBe('short'); // 38k < 45k
    expect(byStart.get('2026-05-11')!.deficitMeters).toBe(-7000);
    expect(byStart.get('2026-05-18')!.verdict).toBe('hit'); // 40k ≥ 37k
    const current = byStart.get('2026-05-25')!;
    expect(current.isCurrent).toBe(true);
    expect(current.verdict).toBe('inProgress');
  });

  test('schedule-aware show-up rate + settled-week hits', () => {
    // Window = 05-04..05-26 (today). Scheduled run days (Mon–Sat) = 20 (the 3
    // Sundays 05-10/17/24 are rest, excluded); all elapsed, today (05-26) ran.
    expect(summary.showUpExpected).toBe(20);
    expect(summary.showUpScheduled).toBe(true);
    // Ran on expected (run) days: Mon/Tue of wk2,3,4,5 + the wk-end runs that
    // landed on Sundays (rest) don't count. 05-04,05,11,12,18,19,25,26 = 8.
    expect(summary.showUpDays).toBe(8);
    expect(summary.weeksSettled).toBe(3); // weeks 2,3,4 are settled
    expect(summary.weeksHit).toBe(2); // weeks 2 and 4 hit
  });
});
