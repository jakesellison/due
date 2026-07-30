import { anchorPlan, normalizeRelativePlan } from '@/lib';

import { exportPlanToRelative, parseGoalIntervalSeconds, planDueFilename } from '../planExport';
import type { PlanRow, PlanWeekRow, WorkoutRow } from '../rows';

describe('parseGoalIntervalSeconds', () => {
  it('parses HH:MM:SS and H:MM:SS to seconds', () => {
    expect(parseGoalIntervalSeconds('2:36:00')).toBe(9360);
    expect(parseGoalIntervalSeconds('02:36:00')).toBe(9360);
    expect(parseGoalIntervalSeconds('42:00')).toBe(2520); // MM:SS
  });
  it('returns null for empty/garbage', () => {
    expect(parseGoalIntervalSeconds(null)).toBeNull();
    expect(parseGoalIntervalSeconds('soon')).toBeNull();
  });
});

describe('planDueFilename', () => {
  it('makes a filesystem-safe <name>.due', () => {
    expect(planDueFilename('Boston Marathon')).toBe('Boston-Marathon.due');
    expect(planDueFilename(null)).toBe('plan.due');
    expect(planDueFilename('  ')).toBe('plan.due');
  });
});

describe('exportPlanToRelative round-trip', () => {
  // A 2-week plan starting Monday 2026-06-08, with a quality workout on the wk1
  // Tuesday (2026-06-09) and a long run on the wk2 Saturday (2026-06-20).
  const plan: PlanRow = {
    id: 'p1',
    race_name: 'Boston Marathon',
    race_date: '2026-06-21',
    distance_kind: 'marathon',
    start_date: '2026-06-08',
    num_weeks: 2,
    status: 'archived',
    goal_time: '2:36:00',
  };
  const weeks: PlanWeekRow[] = [
    {
      id: 'w1',
      week_index: 1,
      phase: 'base',
      target_meters: 80000,
      original_target_meters: 80000,
      quality_target_meters: 800,
      long_target_meters: 24000,
      is_recovery: false,
    },
    {
      id: 'w2',
      week_index: 2,
      phase: 'build',
      target_meters: 90000,
      original_target_meters: 90000,
      quality_target_meters: 6000,
      long_target_meters: 26000,
      is_recovery: false,
    },
  ];
  const workouts: WorkoutRow[] = [
    {
      id: 'k1',
      week_id: 'w1',
      date: '2026-06-09',
      type: 'quality',
      title: '6x800m',
      planned_distance_meters: 12000,
      planned_duration_s: null,
      structure: [{
        kind: 'interval',
        target: {
          by: ['distance', 'pace'],
          distance_m: 800,
          pace: {
            kind: 'relative',
            reference: '5K',
            speed_fraction: 0.95,
            resolved: { fast_s_per_km: 240, slow_s_per_km: 250 },
          },
        },
      }],
      is_quality: true,
      notes: 'Controlled and smooth.',
    },
    {
      id: 'k2',
      week_id: 'w2',
      date: '2026-06-20',
      type: 'long',
      title: 'Long run',
      planned_distance_meters: 24000,
      planned_duration_s: null,
      structure: [],
      is_quality: false,
      notes: null,
    },
  ];

  it('emits a relative v3 file whose (week, day) offsets re-anchor to the source dates', () => {
    const file = exportPlanToRelative(plan, weeks, workouts);
    expect(file.formatVersion).toBe(3);
    expect(file.workouts[0]).toMatchObject({ week: 1, day: 1 });
    expect(file.workouts[1]).toMatchObject({ week: 2, day: 5 });
    expect((file.workouts[0] as { date?: string }).date).toBeUndefined();

    // Meta carries over; structure survives; no dates leak into the file.
    expect(file.plan.name).toBe('Boston Marathon');
    expect(file.workouts[0]?.title).toBe('6x800m');
    expect(file.workouts[0]?.structure.length).toBeGreaterThan(0);
    const exportedTarget = file.workouts[0]?.structure[0];
    expect(exportedTarget?.kind === 'interval' ? exportedTarget.target.pace : null).toEqual({
      kind: 'relative',
      reference: '5K',
      speed_fraction: 0.95,
    });

    // full round-trip: re-anchor at the same Monday reproduces the dates
    const re = anchorPlan(normalizeRelativePlan(file), { kind: 'start', startDate: '2026-06-08' }, '2026-06-01');
    if (!re.ok) throw new Error('anchor failed');
    expect(re.draft.workouts![0]!.date).toBe('2026-06-09');
    expect(re.draft.workouts![1]!.date).toBe('2026-06-20');
  });
});
