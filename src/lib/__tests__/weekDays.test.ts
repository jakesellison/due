import {
  buildWeekDays,
  workoutSealed,
} from '../kpi/weekDays';
import type { WorkoutStructure } from '../workout/types';

const MI = 1609.344;
const threshold: WorkoutStructure = [
  { kind: 'warmup', target: { by: 'distance', distance_m: 2 * MI } },
  { kind: 'repeat', sets: 4, children: [
    { kind: 'work', target: { by: 'pace', pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 }, distance_m: 2 * MI } },
    { kind: 'recovery', target: { by: 'distance', distance_m: 0.5 * MI } },
  ] },
  { kind: 'cooldown', target: { by: 'distance', distance_m: 1 * MI } },
];

// Week of Mon 2026-06-22 .. Sun 2026-06-28; today = Wed 2026-06-24
const input = {
  today: '2026-06-24',
  weekStartDate: '2026-06-24',
  workouts: [
    { id:'w-mon', date:'2026-06-22', type:'easy',  title:'Easy Run',  is_quality:false, structure:[], planned_distance_meters: 8*MI },
    { id:'w-wed', date:'2026-06-24', type:'quality',title:'Threshold Repeats', is_quality:true, structure:threshold, planned_distance_meters: 13*MI },
    { id:'w-sat', date:'2026-06-27', type:'long',   title:'Long Run',  is_quality:false, structure:[], planned_distance_meters: 18*MI },
  ],
  activities: [
    { id:'a-mon', local_date:'2026-06-22', distance_meters: 8.1*MI }, // Mon banked
  ],
};

describe('buildWeekDays', () => {
  it('returns seven Mon→Sun days', () => {
    expect(buildWeekDays(input)).toHaveLength(7);
  });
  it('marks Monday banked/completed with its workout', () => {
    const mon = buildWeekDays(input)[0]!;
    expect(mon.state).toBe('done');
    expect(mon.primary?.completed).toBe(true);
    expect(mon.primary?.id).toBe('w-mon');
  });
  it('today (Wed) carries the quality workout + tone', () => {
    const wed = buildWeekDays(input)[2]!;
    expect(wed.isToday).toBe(true);
    expect(wed.primary?.id).toBe('w-wed');
    expect(wed.primary?.tone).toBe('quality');
    expect(wed.primary?.completed).toBe(false);
  });
  it('Saturday is the long run (tone long), upcoming', () => {
    const sat = buildWeekDays(input)[5]!;
    expect(sat.state).toBe('upcoming');
    expect(sat.primary?.tone).toBe('long');
  });
  it('rest day (Sunday) has no workouts', () => {
    const sun = buildWeekDays(input)[6]!;
    expect(sun.state).toBe('rest');
    expect(sun.workouts).toEqual([]);
    expect(sun.primary).toBeNull();
  });
  it('a completed non-quality day is sealed (distance-based, unchanged)', () => {
    const mon = buildWeekDays(input)[0]!;
    expect(mon.primary?.sealed).toBe(true);
  });
});

// ── Per-day logged activities (completed-day picker source) ──────────────────
//
// Each day exposes its LOGGED activities (one openable run-detail target each),
// sorted by start_date ascending (nulls last), for the Dash completed-day rows.

describe('buildWeekDays day.activities', () => {
  // Mon (2026-06-22) already banks a-mon. Add a second Monday run so a double
  // shows both, plus a null-start run to check the nulls-last ordering.
  const doubleInput = {
    ...input,
    activities: [
      { id: 'a-mon-pm', local_date: '2026-06-22', distance_meters: 4 * MI, start_date: '2026-06-22T22:00:00Z', qualityDetected: true },
      { id: 'a-mon-am', local_date: '2026-06-22', distance_meters: 8 * MI, start_date: '2026-06-22T13:00:00Z', qualityDetected: false },
      { id: 'a-mon-nostart', local_date: '2026-06-22', distance_meters: 2 * MI, start_date: null, qualityDetected: null },
    ],
  };

  it('exposes both runs on a 2-activity day, sorted by start_date ascending (nulls last)', () => {
    const mon = buildWeekDays(doubleInput)[0]!;
    expect(mon.activities.map((a) => a.id)).toEqual(['a-mon-am', 'a-mon-pm', 'a-mon-nostart']);
  });

  it('carries the right fields per activity', () => {
    const mon = buildWeekDays(doubleInput)[0]!;
    const am = mon.activities[0]!;
    expect(am).toEqual({
      id: 'a-mon-am',
      distanceMeters: 8 * MI,
      movingTimeS: null,
      startDate: '2026-06-22T13:00:00Z',
      qualityDetected: false,
      actualBar: null,
    });
    expect(mon.activities[2]!.startDate).toBeNull();
    expect(mon.activities[1]!.qualityDetected).toBe(true);
  });

  it('surfaces a stored actualBar (and defaults to null when absent)', () => {
    const bar = [{ kind: 'steady' as const, meters: 8 * MI }];
    const withBar = {
      ...input,
      activities: [
        { id: 'a-mon', local_date: '2026-06-22', distance_meters: 8 * MI, start_date: '2026-06-22T13:00:00Z', qualityDetected: false, actualBar: bar },
      ],
    };
    const mon = buildWeekDays(withBar)[0]!;
    expect(mon.activities[0]!.actualBar).toEqual(bar);
    // The base fixture (no actualBar on its activities) defaults to null.
    expect(buildWeekDays(input)[0]!.activities[0]!.actualBar).toBeNull();
  });

  it('a day with no logged activity has an empty activities array', () => {
    // Wed (today) is planned but not run in the base fixture.
    const wed = buildWeekDays(input)[2]!;
    expect(wed.activities).toEqual([]);
  });

  it('matches a partial double per workout instead of completing the whole day', () => {
    const partialDouble = {
      ...input,
      workouts: [
        ...input.workouts,
        { id: 'w-mon-short', date: '2026-06-22', type: 'easy', title: 'Easy Run', is_quality: false, structure: [], planned_distance_meters: 4 * MI },
      ],
      activities: [
        { id: 'a-mon-short', local_date: '2026-06-22', distance_meters: 4.01 * MI, start_date: '2026-06-22T13:00:00Z' },
      ],
    };

    const mon = buildWeekDays(partialDouble)[0]!;
    const long = mon.workouts.find((w) => w.id === 'w-mon')!;
    const short = mon.workouts.find((w) => w.id === 'w-mon-short')!;

    expect(mon.state).toBe('done');
    expect(long.completed).toBe(false);
    expect(long.outcome).toBe('missed');
    expect(long.actualMeters).toBe(0);
    expect(long.matchedActivityIds).toEqual([]);
    expect(short.completed).toBe(true);
    expect(short.outcome).toBe('met');
    expect(short.actualMeters).toBeCloseTo(4.01 * MI);
    expect(short.matchedActivityIds).toEqual(['a-mon-short']);
  });

  it('marks a short matched leg and an unmatched elapsed leg independently', () => {
    const elapsedDouble = {
      ...input,
      workouts: [
        ...input.workouts.filter((workout) => workout.date !== '2026-06-22'),
        { id: 'w-mon-first', date: '2026-06-22', type: 'easy', title: 'Easy Run', is_quality: false, structure: [], planned_distance_meters: 16 * MI },
        { id: 'w-mon-second', date: '2026-06-22', type: 'easy', title: 'Easy Run (2nd)', is_quality: false, structure: [], planned_distance_meters: 7 * MI },
      ],
      activities: [
        { id: 'a-mon', local_date: '2026-06-22', distance_meters: 12 * MI, start_date: '2026-06-22T20:00:00Z' },
      ],
    };

    const mon = buildWeekDays(elapsedDouble)[0]!;
    const first = mon.workouts.find((workout) => workout.id === 'w-mon-first')!;
    const second = mon.workouts.find((workout) => workout.id === 'w-mon-second')!;

    expect(first.outcome).toBe('short');
    expect(first.sealed).toBe(false);
    expect(first.matchedActivityIds).toEqual(['a-mon']);
    expect(second.outcome).toBe('missed');
    expect(second.sealed).toBe(false);
    expect(second.matchedActivityIds).toEqual([]);
  });

  it('pairs two actuals to their closest planned legs on a completed double', () => {
    const completedDouble = {
      ...input,
      workouts: [
        ...input.workouts,
        { id: 'w-mon-short', date: '2026-06-22', type: 'easy', title: 'Easy Run', is_quality: false, structure: [], planned_distance_meters: 4 * MI },
      ],
      activities: [
        { id: 'a-mon-long', local_date: '2026-06-22', distance_meters: 8.1 * MI, start_date: '2026-06-22T18:00:00Z' },
        { id: 'a-mon-short', local_date: '2026-06-22', distance_meters: 3.95 * MI, start_date: '2026-06-22T12:00:00Z' },
      ],
    };

    const mon = buildWeekDays(completedDouble)[0]!;
    const long = mon.workouts.find((w) => w.id === 'w-mon')!;
    const short = mon.workouts.find((w) => w.id === 'w-mon-short')!;

    expect(long.completed).toBe(true);
    expect(long.matchedActivityIds).toEqual(['a-mon-long']);
    expect(short.completed).toBe(true);
    expect(short.matchedActivityIds).toEqual(['a-mon-short']);
  });

  it('uses explicit run ordinals for future double chronology when database tie order is arbitrary', () => {
    const futureDouble = {
      ...input,
      workouts: [
        ...input.workouts,
        { id: 'w-sat-2', date: '2026-06-27', type: 'easy', title: 'Easy Run (2nd)', is_quality: false, structure: [], planned_distance_meters: 4 * MI },
        { id: 'w-sat-1', date: '2026-06-27', type: 'easy', title: 'Easy Run', is_quality: false, structure: [], planned_distance_meters: 10 * MI },
      ],
    };

    const sat = buildWeekDays(futureDouble)[5]!;
    expect(sat.workouts.map((workout) => workout.id)).toEqual(['w-sat', 'w-sat-1', 'w-sat-2']);
  });
});

// ── Success-seal gating (issue #139) ─────────────────────────────────────────
//
// A QUALITY workout's checkmark seal requires the intrinsic per-run verdict
// (stored isQuality, minus user overrides) — a distance/day match alone shows
// the neutral ran-mileage WITHOUT the seal, and a pending verdict is neutral.

describe('workoutSealed', () => {
  const day = (qualityDetected?: boolean | null) => [
    { id: 'a1', local_date: '2026-06-24', distance_meters: 14 * MI, qualityDetected },
  ];

  it('not completed is never sealed', () => {
    expect(workoutSealed(false, false, day(true))).toBe(false);
    expect(workoutSealed(true, false, day(true))).toBe(false);
  });
  it('non-quality: completed alone seals (current behavior kept)', () => {
    expect(workoutSealed(false, true, day(null))).toBe(true);
    expect(workoutSealed(false, true, [])).toBe(true);
  });
  it('quality: a distance match with NO verdict (pending) stays neutral — no seal', () => {
    // The live repro: easy 14mi on the Q14 day, enrichment pending.
    expect(workoutSealed(true, true, day(null))).toBe(false);
    expect(workoutSealed(true, true, day(undefined))).toBe(false);
  });
  it('quality: a negative verdict never seals', () => {
    expect(workoutSealed(true, true, day(false))).toBe(false);
  });
  it('quality: a positive verdict seals', () => {
    expect(workoutSealed(true, true, day(true))).toBe(true);
  });
  it('quality: a user-overridden positive verdict does not seal', () => {
    expect(workoutSealed(true, true, day(true), new Set(['a1']))).toBe(false);
  });
});

describe('buildWeekDays seal wiring', () => {
  // Wed 2026-06-24 is the quality day; bank a run on it.
  const ranQualityDay = (qualityDetected: boolean | null) => ({
    ...input,
    activities: [
      ...input.activities,
      { id: 'a-wed', local_date: '2026-06-24', distance_meters: 14 * MI, qualityDetected },
    ],
  });

  it('quality day ran with a pending verdict: completed but NOT sealed', () => {
    const wed = buildWeekDays(ranQualityDay(null))[2]!;
    expect(wed.primary?.completed).toBe(true);
    expect(wed.primary?.sealed).toBe(false);
  });
  it('quality day ran with a positive verdict: sealed', () => {
    const wed = buildWeekDays(ranQualityDay(true))[2]!;
    expect(wed.primary?.sealed).toBe(true);
  });
  it('quality day ran with a positive verdict but overridden: not sealed', () => {
    const wed = buildWeekDays({ ...ranQualityDay(true), qualityOverrides: new Set(['a-wed']) })[2]!;
    expect(wed.primary?.sealed).toBe(false);
  });
});
