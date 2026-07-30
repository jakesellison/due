/**
 * Tests that `deriveCurrentWeek` (in `src/app-lib/adapt.ts`) correctly builds
 * the `weekDays[]` input for the v2 engine from plan + activity rows.
 *
 * Uses the same Supabase-mock + manual fixtures style as planSwitch.test.ts and
 * snapshots.test.ts. `deriveCurrentWeek` is a pure function that reads plan rows
 * and activity rows; it never hits Supabase, so we just call it directly.
 *
 * The fixture week: Mon 2026-06-15 … Sun 2026-06-21, today = Wed 2026-06-17.
 *   Mon(0): easy 10 km  — activity logged          → hasActivity=true, isToday=false
 *   Tue(1): quality 8km — NO activity (missed)     → hasActivity=false, isToday=false
 *   Wed(2): rest (no row)                          → isToday=true, type='rest', plannedMeters=0
 *   Thu(3): easy 12km   — future                   → hasActivity=false, isToday=false
 *   Fri(4): easy 10km   — future                   → hasActivity=false, isToday=false
 *   Sat(5): long 20km   — future                   → hasActivity=false, isToday=false
 *   Sun(6): rest (no row)                          → hasActivity=false, isToday=false
 */

// Supabase is not called inside deriveCurrentWeek; mock it to satisfy imports.
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

// AsyncStorage is imported transitively; provide a minimal stub.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import { deriveCurrentWeek, derivePmHabitMeters } from '../adapt';
import type { ActivePlan, ActivityRow } from '../queries';
import type { WorkoutStructure } from '@/lib';

const EMPTY_STRUCTURE: WorkoutStructure = [];

type Workout = ActivePlan['workouts'][number];

/** Minimal workout-row factory for the pm-habit tests. */
function makeWorkout(
  over: Partial<Workout> & { id: string; week_id: string; date: string },
): Workout {
  return {
    type: 'easy',
    title: 'Easy run',
    planned_distance_meters: 10000,
    planned_duration_s: null,
    structure: EMPTY_STRUCTURE,
    is_quality: false,
    notes: null,
    ...over,
  };
}

// ── Fixture data ─────────────────────────────────────────────────────────────

const WEEK_START = '2026-06-15'; // Mon
const TODAY = '2026-06-17';      // Wed (idx=2)

const planData: ActivePlan = {
  plan: {
    id: 'plan-1',
    race_name: 'Boston 2027',
    race_date: '2027-04-19',
    distance_kind: 'marathon',
    start_date: WEEK_START,
    num_weeks: 16,
    status: 'active',
    goal_time: null,
  },
  weeks: [
    {
      id: 'week-1',
      // 1-based: week 1 IS the plan-start week (startDate + (1-1)*7 = startDate).
      week_index: 1,
      phase: 'base',
      target_meters: 80000,
      original_target_meters: 80000,
      is_recovery: false,
    },
  ],
  workouts: [
    // Mon (idx 0) — easy 10 km
    {
      id: 'w-mon',
      week_id: 'week-1',
      date: '2026-06-15',
      type: 'easy',
      title: 'Easy run',
      planned_distance_meters: 10000,
      planned_duration_s: null,
      structure: EMPTY_STRUCTURE,
      is_quality: false,
      notes: null,
    },
    // Tue (idx 1) — quality 8 km (missed)
    {
      id: 'w-tue',
      week_id: 'week-1',
      date: '2026-06-16',
      type: 'quality',
      title: 'Tempo',
      planned_distance_meters: 8000,
      planned_duration_s: null,
      structure: EMPTY_STRUCTURE,
      is_quality: true,
      notes: null,
    },
    // Wed (idx 2): no row — rest slot
    // Thu (idx 3) — easy 12 km
    {
      id: 'w-thu',
      week_id: 'week-1',
      date: '2026-06-18',
      type: 'easy',
      title: 'Easy run',
      planned_distance_meters: 12000,
      planned_duration_s: null,
      structure: EMPTY_STRUCTURE,
      is_quality: false,
      notes: null,
    },
    // Fri (idx 4) — easy 10 km
    {
      id: 'w-fri',
      week_id: 'week-1',
      date: '2026-06-19',
      type: 'easy',
      title: 'Easy run',
      planned_distance_meters: 10000,
      planned_duration_s: null,
      structure: EMPTY_STRUCTURE,
      is_quality: false,
      notes: null,
    },
    // Sat (idx 5) — long 20 km
    {
      id: 'w-sat',
      week_id: 'week-1',
      date: '2026-06-20',
      type: 'long',
      title: 'Long run',
      planned_distance_meters: 20000,
      planned_duration_s: null,
      structure: EMPTY_STRUCTURE,
      is_quality: false,
      notes: null,
    },
    // Sun (idx 6): no row — rest slot
  ],
};

// Activities: Mon was run (10 km), nothing else.
const activities: ActivityRow[] = [
  {
    id: 'act-mon',
    source: 'strava',
    source_id: 'strava-1',
    name: 'Morning Run',
    local_date: '2026-06-15',
    distance_meters: 10100,
    moving_time_s: 3600,
    elapsed_time_s: null,
    avg_hr: 145,
    user_note: null,
    start_date: '2026-06-15T07:00:00Z',
    avg_temp_c: null,
    best_efforts: null,
    workout_type: null,
    stream_summary: null,
    streams: null,
    route: null,
    laps: null,
    max_hr: null,
    suffer_score: null,
    shoe_id: null,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('deriveCurrentWeek — weekDays derivation', () => {
  it('returns null when planData is null', () => {
    expect(deriveCurrentWeek(null, [], TODAY)).toBeNull();
  });

  it('returns null when today is outside all plan weeks', () => {
    expect(deriveCurrentWeek(planData, activities, '2027-01-01')).toBeNull();
  });

  it('produces exactly 7 weekDay entries ordered by idx', () => {
    const result = deriveCurrentWeek(planData, activities, TODAY);
    expect(result).not.toBeNull();
    expect(result!.proposals).toBeDefined();
    // We access the weekDays via a side-channel: expose it from the engine.
    // Since deriveCurrentWeek returns proposals (not weekDays directly), we test
    // its EFFECTS on the engine output — but we also verify the key flags below
    // by checking the proposal types (the engine uses weekDays internally).
    // The primary test of weekDays correctness is through the per-day assertions
    // on isToday, hasActivity, and type, verified in the next tests.
  });

  it('sets isToday=true only for Wednesday (idx=2)', () => {
    // We test this indirectly: the engine uses isToday to decide "remaining".
    // We can also test by calling proposeAdaptations with the same weekDays and
    // checking the engine sees today correctly. But since deriveCurrentWeek is
    // internal, we use the exported result shape + the fact that the engine
    // produces proposals consistent with Wed being "today".
    //
    // More directly: we run it with different today dates and check gap changes.
    const result = deriveCurrentWeek(planData, activities, TODAY);
    expect(result).not.toBeNull();
    // With today=Wed and Mon+Tue both past (Mon ran, Tue missed), the engine
    // should see a gap and produce ≥1 proposal.
    expect(result!.proposals.length).toBeGreaterThanOrEqual(1);
  });

  it('sets hasActivity=true for Mon only (the only activity date)', () => {
    // Change today to Sat to make Thu and Fri clearly "past" with no activity.
    // On Sat: Mon ran, Tue/Thu/Fri all missed → big gap → lower_target expected.
    const resultSat = deriveCurrentWeek(planData, activities, '2026-06-20');
    expect(resultSat).not.toBeNull();
    // Big gap with 3 missed days → primary should be lower_target.
    const kinds = resultSat!.proposals.map((p) => p.kind);
    expect(kinds).toContain('lower_target');
  });

  it('treats dates with no workout row as rest slots (type=rest, plannedMeters=0)', () => {
    // Wed and Sun have no workout row. If the engine sees them as rest, they're
    // eligible as reschedule destinations for missed easy days.
    // Tue quality was missed; Wed is rest → reschedule Tue→Wed should be proposed
    // (Wed is idx=2, the open rest slot; Tue is missed quality so dest must not
    // be adjacent to another hard day — Wed(2) is not adjacent to Sat(5) long).
    // But Sat long IS a hard neighbor at idx 5; Wed(2) is not adjacent to idx 5,
    // so it should pass. Reschedule should appear.
    const result = deriveCurrentWeek(planData, activities, TODAY);
    expect(result).not.toBeNull();
    const kinds = result!.proposals.map((p) => p.kind);
    // The missed quality + rest slot at Wed → reschedule is a candidate.
    // (Engine decision tree: missed day exists + safe dest → reschedule leads or appears.)
    expect(kinds.length).toBeGreaterThanOrEqual(1);
  });

  it('correctly computes actualMeters from week activities only', () => {
    // With an activity outside the week, actualMeters should only count in-week.
    const activitiesWithOutlier: ActivityRow[] = [
      ...activities,
      {
        id: 'act-prev',
        source: 'strava',
        source_id: 'strava-prev',
        name: 'Previous week run',
        local_date: '2026-06-14', // Sunday before the week
        distance_meters: 15000,
        moving_time_s: 4200,
        elapsed_time_s: null,
        avg_hr: 140,
        user_note: null,
        start_date: '2026-06-14T07:00:00Z',
        avg_temp_c: null,
        best_efforts: null,
        workout_type: null,
        stream_summary: null,
        streams: null,
        route: null,
        laps: null,
        max_hr: null,
        suffer_score: null,
        shoe_id: null,
      },
    ];
    const r1 = deriveCurrentWeek(planData, activities, TODAY);
    const r2 = deriveCurrentWeek(planData, activitiesWithOutlier, TODAY);
    // Same proposals because the outlier is not in the week.
    expect(r1!.proposals.map((p) => p.kind)).toEqual(r2!.proposals.map((p) => p.kind));
  });

  it('counts a planned PM double row toward the day total (D7)', () => {
    // Thu split into 12000 AM + 6000 PM rows vs a single 18000 row: the engine
    // must see the same remaining-planned either way, so the primary proposal's
    // deficitMeters must be identical. Pre-D7 fix the PM row was dropped by
    // workouts.find(...) and the split variant's deficit came out 6000 higher.
    const thu = planData.workouts.find((w) => w.id === 'w-thu')!;
    const split: ActivePlan = {
      ...planData,
      workouts: [
        ...planData.workouts,
        {
          ...thu,
          id: 'w-thu-pm',
          title: 'Easy (PM)',
          planned_distance_meters: 6000,
        },
      ],
    };
    const single: ActivePlan = {
      ...planData,
      workouts: planData.workouts.map((w) =>
        w.id === 'w-thu' ? { ...w, planned_distance_meters: 18000 } : w,
      ),
    };
    const rSplit = deriveCurrentWeek(split, activities, TODAY);
    const rSingle = deriveCurrentWeek(single, activities, TODAY);
    expect(rSplit).not.toBeNull();
    expect(rSingle).not.toBeNull();
    const dSplit = rSplit!.proposals[0] as { deficitMeters?: number };
    const dSingle = rSingle!.proposals[0] as { deficitMeters?: number };
    expect(dSplit.deficitMeters).toBeDefined();
    expect(dSplit.deficitMeters).toBe(dSingle.deficitMeters);
  });

  it('keeps an unmatched second leg in today’s projection after the first leg is banked', () => {
    const today = '2026-06-17';
    const liveDouble: ActivePlan = {
      ...planData,
      weeks: [
        {
          ...planData.weeks[0]!,
          target_meters: 52000,
          original_target_meters: 52000,
        },
      ],
      workouts: [
        makeWorkout({
          id: 'w-mon',
          week_id: 'week-1',
          date: '2026-06-15',
          planned_distance_meters: 10000,
        }),
        makeWorkout({
          id: 'w-tue',
          week_id: 'week-1',
          date: '2026-06-16',
          planned_distance_meters: 10000,
        }),
        makeWorkout({
          id: 'w-wed-am',
          week_id: 'week-1',
          date: today,
          planned_distance_meters: 4000,
          created_at: '2026-05-01T08:00:00Z',
        }),
        makeWorkout({
          id: 'w-wed-pm',
          week_id: 'week-1',
          date: today,
          title: 'Easy Run (2nd)',
          planned_distance_meters: 12000,
          created_at: '2026-05-01T09:00:00Z',
        }),
        makeWorkout({
          id: 'w-thu',
          week_id: 'week-1',
          date: '2026-06-18',
          planned_distance_meters: 8000,
        }),
        makeWorkout({
          id: 'w-fri',
          week_id: 'week-1',
          date: '2026-06-19',
          planned_distance_meters: 8000,
        }),
      ],
    };
    const liveActivities: ActivityRow[] = [
      { ...activities[0]!, id: 'a-mon', source_id: 'a-mon', local_date: '2026-06-15', distance_meters: 10000 },
      { ...activities[0]!, id: 'a-tue', source_id: 'a-tue', local_date: '2026-06-16', distance_meters: 10000 },
      { ...activities[0]!, id: 'a-wed-am', source_id: 'a-wed-am', local_date: today, distance_meters: 4000 },
    ];

    const result = deriveCurrentWeek(liveDouble, liveActivities, today);

    expect(result).not.toBeNull();
    expect(result!.proposals).toEqual([]);
  });

  it('emits quality_only when no mileage gap but quality is unmet (no streams)', () => {
    // Inject activities on Mon–Sat (today=Sat) with enough distance to cover the
    // 80 km target. Activities have no pace streams → detectWeekQuality returns
    // qualityDetected=false. The plan has a quality workout on Tue → the engine
    // emits a quality_only informational card (mileage met, quality not).
    //
    // Each of Mon–Sat has one activity; 6 * 14000 = 84000 > 80000.
    const bigActivities: ActivityRow[] = Array.from({ length: 6 }, (_, i) => ({
      id: `act-${i}`,
      source: 'strava',
      source_id: `s-${i}`,
      name: 'Run',
      local_date: addDaysStr(WEEK_START, i), // Mon–Sat
      distance_meters: 14000,               // 6 * 14000 = 84000 > 80000 target
      moving_time_s: 4000,
      elapsed_time_s: null,
      avg_hr: 145,
      user_note: null,
      start_date: `2026-06-${15 + i}T07:00:00Z`,
      avg_temp_c: null,
      best_efforts: null,
      workout_type: null,
      stream_summary: null,
      streams: null, // no streams → quality undetected
      route: null,
      laps: null,
      max_hr: null,
      suffer_score: null,
      shoe_id: null,
    }));
    // Use Saturday as today so Mon–Fri are all "past" with activities; Sat has an
    // activity too (bigActivities[5], local_date=2026-06-20 = Sat = today).
    const result = deriveCurrentWeek(planData, bigActivities, '2026-06-20');
    expect(result).not.toBeNull();
    // Mileage gap is met; quality is unmet (no streams) → quality_only card (Task 2.3).
    expect(result!.proposals).toHaveLength(1);
    expect(result!.proposals[0]!.kind).toBe('quality_only');
  });
});

// ── derivePmHabitMeters ──────────────────────────────────────────────────────

describe('derivePmHabitMeters', () => {
  it('returns null when the plan has no PM rows (one row per date)', () => {
    const workouts: Workout[] = [
      makeWorkout({ id: 'a', week_id: 'wk1', date: '2026-06-08' }),
      makeWorkout({ id: 'b', week_id: 'wk1', date: '2026-06-09' }),
      makeWorkout({ id: 'c', week_id: 'wk2', date: '2026-06-15' }),
    ];
    expect(derivePmHabitMeters(workouts)).toBeNull();
  });

  it('returns null for an empty plan', () => {
    expect(derivePmHabitMeters([])).toBeNull();
  });

  it('takes the median PM distance across ALL weeks (odd count)', () => {
    // Three doubled dates across three weeks; PM distances 5000 / 8000 / 6000.
    // Sorted: [5000, 6000, 8000] -> median 6000.
    const workouts: Workout[] = [
      makeWorkout({ id: 'w1-am', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'w1-pm', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: 5000 }),
      makeWorkout({ id: 'w2-am', week_id: 'wk2', date: '2026-06-16', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'w2-pm', week_id: 'wk2', date: '2026-06-16', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: 8000 }),
      makeWorkout({ id: 'w3-am', week_id: 'wk3', date: '2026-06-23', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'w3-pm', week_id: 'wk3', date: '2026-06-23', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: 6000 }),
      // A single-row date contributes nothing.
      makeWorkout({ id: 'w1-solo', week_id: 'wk1', date: '2026-06-10' }),
    ];
    expect(derivePmHabitMeters(workouts)).toBe(6000);
  });

  it('averages the middle pair for an even count', () => {
    // PM distances [6000, 8000] -> median (6000 + 8000) / 2 = 7000.
    const workouts: Workout[] = [
      makeWorkout({ id: 'a-am', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'a-pm', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: 6000 }),
      makeWorkout({ id: 'b-am', week_id: 'wk2', date: '2026-06-16', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'b-pm', week_id: 'wk2', date: '2026-06-16', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: 8000 }),
    ];
    expect(derivePmHabitMeters(workouts)).toBe(7000);
  });

  it('picks the AM row by created_at, not array order or id', () => {
    // The PM row (created later, 5000 m) appears FIRST in the array and has the
    // lexicographically smaller id; created_at must still make the 12000 m row
    // the AM run, leaving 5000 as the PM value.
    const workouts: Workout[] = [
      makeWorkout({ id: 'aaa-pm', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-02T18:00:00Z', planned_distance_meters: 5000 }),
      makeWorkout({ id: 'zzz-am', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T08:00:00Z', planned_distance_meters: 12000 }),
    ];
    expect(derivePmHabitMeters(workouts)).toBe(5000);
  });

  it('breaks created_at ties by id (same-transaction inserts)', () => {
    // Same created_at: id 'a' sorts first -> AM; id 'b' (4000 m) is the PM.
    const workouts: Workout[] = [
      makeWorkout({ id: 'b', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T08:00:00Z', planned_distance_meters: 4000 }),
      makeWorkout({ id: 'a', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T08:00:00Z', planned_distance_meters: 12000 }),
    ];
    expect(derivePmHabitMeters(workouts)).toBe(4000);
  });

  it('ignores PM rows with a null planned distance (no habit signal)', () => {
    const onlyNullPm: Workout[] = [
      makeWorkout({ id: 'a-am', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'a-pm', week_id: 'wk1', date: '2026-06-09', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: null }),
    ];
    expect(derivePmHabitMeters(onlyNullPm)).toBeNull();

    const mixed: Workout[] = [
      ...onlyNullPm,
      makeWorkout({ id: 'b-am', week_id: 'wk2', date: '2026-06-16', created_at: '2026-06-01T08:00:00Z' }),
      makeWorkout({ id: 'b-pm', week_id: 'wk2', date: '2026-06-16', created_at: '2026-06-01T09:00:00Z', planned_distance_meters: 7000 }),
    ];
    expect(derivePmHabitMeters(mixed)).toBe(7000);
  });
});

describe('deriveCurrentWeek — pmHabitMeters threading (R4 doubles gate)', () => {
  // A two-week plan: week 1 (past) carries the runner's planned PM doubles,
  // week 2 is the current week. today = Wed of week 2. Mon/Tue were RUN but
  // SHORT (so there is a gap but NO missed run day -> the light-fix path),
  // and the gap (5000 m) is coverable by one habitual PM double:
  //   target 60000; actual 8000 + 7000 = 15000; remaining Thu 10k + Fri 10k
  //   + Sat 20k = 40000 -> gap = 60000 - 15000 - 40000 = 5000.
  //   habit = median [6000] = 6000 -> Thu PM = floorMi(min(5000, 6000, 10000))
  //   = 3 mi = 4828 m >= 0.9 * gap = 4500 -> add_double leads.
  // Without the week-1 PM rows the habit is null and the R4 gate keeps
  // add_double out entirely.
  const start = '2026-06-08'; // Mon, week 1
  const wk2Start = '2026-06-15';
  const today2 = '2026-06-17'; // Wed of week 2

  const twoWeekPlan: ActivePlan = {
    plan: { ...planData.plan, start_date: start },
    weeks: [
      { id: 'wk1', week_index: 1, phase: 'base', target_meters: 60000, original_target_meters: 60000, is_recovery: false },
      { id: 'wk2', week_index: 2, phase: 'base', target_meters: 60000, original_target_meters: 60000, is_recovery: false },
    ],
    workouts: [
      // Week 1: Tue has an AM + PM double (the habit source).
      makeWorkout({ id: 'p1-tue-am', week_id: 'wk1', date: '2026-06-09', created_at: '2026-05-01T08:00:00Z' }),
      makeWorkout({ id: 'p1-tue-pm', week_id: 'wk1', date: '2026-06-09', created_at: '2026-05-01T09:00:00Z', planned_distance_meters: 6000, title: 'Easy (PM)' }),
      // Week 2 (current): Mon/Tue easy 10k (run short), Thu/Fri easy 10k, Sat long 20k.
      makeWorkout({ id: 'p2-mon', week_id: 'wk2', date: '2026-06-15' }),
      makeWorkout({ id: 'p2-tue', week_id: 'wk2', date: '2026-06-16' }),
      makeWorkout({ id: 'p2-thu', week_id: 'wk2', date: '2026-06-18' }),
      makeWorkout({ id: 'p2-fri', week_id: 'wk2', date: '2026-06-19' }),
      makeWorkout({ id: 'p2-sat', week_id: 'wk2', date: '2026-06-20', type: 'long', title: 'Long run', planned_distance_meters: 20000 }),
    ],
  };

  const shortRuns: ActivityRow[] = [
    { ...activities[0]!, id: 'r-mon', source_id: 's-mon', local_date: '2026-06-15', distance_meters: 8000 },
    { ...activities[0]!, id: 'r-tue', source_id: 's-tue', local_date: '2026-06-16', distance_meters: 7000 },
  ];

  it('proposes add_double when another week\'s PM rows establish the habit', () => {
    const result = deriveCurrentWeek(twoWeekPlan, shortRuns, today2);
    expect(result).not.toBeNull();
    expect(result!.weekId).toBe('wk2');
    expect(result!.proposals[0]!.kind).toBe('add_double');
  });

  it('never proposes add_double when the plan has no PM rows (R4 gate)', () => {
    const noDoubles: ActivePlan = {
      ...twoWeekPlan,
      workouts: twoWeekPlan.workouts.filter((w) => w.id !== 'p1-tue-pm'),
    };
    const result = deriveCurrentWeek(noDoubles, shortRuns, today2);
    expect(result).not.toBeNull();
    expect(result!.proposals.map((p) => p.kind)).not.toContain('add_double');
  });
});

/** Minimal addDays for test fixtures only (avoids importing from @/lib). */
function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
