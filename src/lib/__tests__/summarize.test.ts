import {
  summarizeBlock,
  bucketForDistance,
  type SummaryWeekInput,
  type SummaryWorkoutInput,
  type SummaryActivityInput,
} from '../kpi/summarize';

const weeks: SummaryWeekInput[] = [
  { weekIndex: 1, phase: 'base', weekStart: '2026-05-04', targetMeters: 64000, isRecovery: false },
  { weekIndex: 2, phase: 'base', weekStart: '2026-05-11', targetMeters: 70000, isRecovery: false },
  { weekIndex: 3, phase: 'build', weekStart: '2026-05-18', targetMeters: 80000, isRecovery: false },
  { weekIndex: 4, phase: 'build', weekStart: '2026-05-25', targetMeters: 88000, isRecovery: false },
];

const TODAY = '2026-05-20'; // Wednesday of week 3 (weekStart 2026-05-18)

describe('bucketForDistance', () => {
  const ref = 12000;
  test('rest day is bucket 0', () => {
    expect(bucketForDistance(0, ref)).toBe(0);
  });
  test('scales low -> high', () => {
    expect(bucketForDistance(5000, ref)).toBe(1); // < 0.6
    expect(bucketForDistance(10000, ref)).toBe(2); // < 1.1
    expect(bucketForDistance(18000, ref)).toBe(3); // < 1.7
    expect(bucketForDistance(30000, ref)).toBe(4);
  });
  test('guards a zero reference', () => {
    expect(bucketForDistance(5000, 0)).toBe(4);
  });
});

describe('summarizeBlock', () => {
  const workouts: SummaryWorkoutInput[] = [
    { date: '2026-05-19', isQuality: true }, // Tue of current week
    { date: '2026-05-24', isQuality: false }, // Sun of current week
  ];
  const activities: SummaryActivityInput[] = [
    // current week (2026-05-18..24): two runs totalling 40k vs 80k target
    { localDate: '2026-05-18', distanceMeters: 16000 },
    { localDate: '2026-05-19', distanceMeters: 24000 }, // on the quality day
    // prior week (2026-05-11..17): hit target
    { localDate: '2026-05-13', distanceMeters: 35000 },
    { localDate: '2026-05-16', distanceMeters: 40000 },
  ];

  const summary = summarizeBlock(weeks, workouts, activities, TODAY);

  test('returns one weekly bar per plan week, ordered', () => {
    expect(summary.weeks.map((w) => w.weekIndex)).toEqual([1, 2, 3, 4]);
  });

  test('sums actuals into the correct week by week-start', () => {
    const wk3 = summary.weeks.find((w) => w.weekIndex === 3)!;
    expect(wk3.actualMeters).toBe(40000);
    const wk2 = summary.weeks.find((w) => w.weekIndex === 2)!;
    expect(wk2.actualMeters).toBe(75000);
  });

  test('flags current and future weeks', () => {
    const flags = summary.weeks.map((w) => ({
      i: w.weekIndex,
      cur: w.isCurrent,
      fut: w.isFuture,
    }));
    expect(flags).toEqual([
      { i: 1, cur: false, fut: false },
      { i: 2, cur: false, fut: false },
      { i: 3, cur: true, fut: false },
      { i: 4, cur: false, fut: true },
    ]);
  });

  test('bands each week via bandFor', () => {
    const wk2 = summary.weeks.find((w) => w.weekIndex === 2)!; // 75k/70k
    expect(wk2.band).toBe('green');
    const wk3 = summary.weeks.find((w) => w.weekIndex === 3)!; // 40k/80k
    expect(wk3.band).toBe('red');
  });

  test('current-week KPI: mileage, fraction and band', () => {
    expect(summary.current).not.toBeNull();
    const c = summary.current!;
    expect(c.weekIndex).toBe(3);
    expect(c.actualMeters).toBe(40000);
    expect(c.targetMeters).toBe(80000);
    expect(c.fraction).toBeCloseTo(0.5, 6);
    // Full-week band against the full target is red (40k/80k mid-week)...
    expect(c.band).toBe('red');
  });

  test('current-week pace band is prorated (on pace mid-week, not red)', () => {
    const c = summary.current!;
    // TODAY is Wednesday -> elapsedFraction 3/7. Pace line = 80000 * 3/7 ≈ 34286.
    expect(c.elapsedFraction).toBeCloseTo(3 / 7, 6);
    // Pace line uses COMPLETED days (through yesterday) — today counts only
    // in the runner's favor, mirroring schedule.ts and the adaptation engine.
    expect(c.paceLineMeters).toBeCloseTo(80000 * (2 / 7), 0);
    // 40000 actual is ahead of the ~34286 pace line -> green.
    expect(c.paceBand).toBe('green');
    // The current weekly BAR exposes the same pace band.
    const wk3 = summary.weeks.find((w) => w.weekIndex === 3)!;
    expect(wk3.isCurrent).toBe(true);
    expect(wk3.band).toBe('red'); // full-target band unchanged
    expect(wk3.paceBand).toBe('green'); // prorated
  });

  test('past/future weeks have paceBand === band', () => {
    for (const w of summary.weeks) {
      if (!w.isCurrent) expect(w.paceBand).toBe(w.band);
    }
  });

  test('current-week quality completed counts activity on the quality date', () => {
    const c = summary.current!;
    expect(c.qualityPlanned).toBe(1);
    expect(c.qualityCompleted).toBe(1);
  });

  test('heatmap has N rows of 7 cells ending on the current week, today flagged', () => {
    expect(summary.heatmap).toHaveLength(4);
    for (const row of summary.heatmap) expect(row.cells).toHaveLength(7);
    const lastRow = summary.heatmap[summary.heatmap.length - 1]!;
    expect(lastRow.weekStart).toBe('2026-05-18');
    const todayCell = lastRow.cells.find((c) => c.isToday);
    expect(todayCell?.localDate).toBe(TODAY);
  });

  test('heatmap rings quality days and buckets distance', () => {
    const lastRow = summary.heatmap[summary.heatmap.length - 1]!;
    const tue = lastRow.cells.find((c) => c.localDate === '2026-05-19')!;
    expect(tue.isQuality).toBe(true);
    expect(tue.bucket).toBeGreaterThan(0);
    const rest = lastRow.cells.find((c) => c.localDate === '2026-05-21')!;
    expect(rest.bucket).toBe(0);
  });

  test('handles an empty block gracefully', () => {
    const s = summarizeBlock([], [], [], TODAY);
    expect(s.weeks).toEqual([]);
    expect(s.current).toBeNull();
    expect(s.heatmap).toHaveLength(4);
  });
});
