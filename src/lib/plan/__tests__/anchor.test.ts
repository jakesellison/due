import {
  anchorPlan,
  nextMondayIso,
} from '../anchor';
import {
  normalizeRelativePlan,
} from '../relative';

// 4-week plan, race on final-week Saturday (day 5)
const plan = () => normalizeRelativePlan({
  formatVersion: 3, source: 'starter',
  plan: { name: '5K test', distanceKind: '5k', numWeeks: 4, minWeeks: 3 },
  weeks: [1, 2, 3, 4].map((w) => ({ week: w, phase: w === 4 ? 'taper' : 'build', targetMeters: 40000 })),
  workouts: [
    ...[1, 2, 3, 4].flatMap((w) => [
      { week: w, day: 1, type: 'quality', title: 'Q', plannedDistanceMeters: 8000 },
      { week: w, day: 3, type: 'easy', title: 'E', plannedDistanceMeters: 8000 },
    ]),
    { week: 4, day: 5, type: 'race', title: 'Race', plannedDistanceMeters: 5000 },
    { week: 4, day: 6, type: 'easy', title: 'Shakeout', plannedDistanceMeters: 5000 },
  ],
});

describe('anchorPlan', () => {
  const today = '2026-07-21'; // a Tuesday; its Monday is 2026-07-20

  it('start anchor: full length from the given Monday', () => {
    const r = anchorPlan(plan(), { kind: 'start', startDate: '2026-07-27' }, today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.joinAtWeek).toBeNull();
    expect(r.keptWeeks).toBe(4);
    expect(r.draft.workouts![0]!.date).toBe('2026-07-28'); // wk1 day1 = Tue
    expect(r.raceDate).toBe('2026-08-22');                 // wk4 day5 = Sat
  });

  it('race anchor with room: no trim, race lands on race day', () => {
    const r = anchorPlan(plan(), { kind: 'race', raceDate: '2026-08-22' }, today);
    if (!r.ok) throw new Error('expected ok');
    expect(r.joinAtWeek).toBeNull();
    expect(r.startDate).toBe('2026-07-27');
    const race = r.draft.workouts!.find((w) => w.type === 'race')!;
    expect(race.date).toBe('2026-08-22');
  });

  it('race anchor closer than plan length trims from the front', () => {
    const r = anchorPlan(plan(), { kind: 'race', raceDate: '2026-08-08' }, today);
    if (!r.ok) throw new Error('expected ok');
    expect(r.keptWeeks).toBe(3);                 // weeks available: Jul20,27,Aug3 race week
    expect(r.joinAtWeek).toBe(2);                // joined at original week 2
    expect(r.draft.plan!.numWeeks).toBe(3);
    expect(r.draft.weeks![0]!.weekIndex).toBe(1); // renumbered
  });

  it('race off the authored weekday snaps the race workout to race day', () => {
    // authored day 5 (Sat); race actually Sunday 2026-08-23
    const r = anchorPlan(plan(), { kind: 'race', raceDate: '2026-08-23' }, today);
    if (!r.ok) throw new Error('expected ok');
    const race = r.draft.workouts!.find((w) => w.type === 'race')!;
    expect(race.date).toBe('2026-08-23');
    // the day-6 shakeout would land ON race day → dropped with a warning
    expect(r.draft.workouts!.some((w) => w.title === 'Shakeout')).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('below minWeeks refuses', () => {
    const r = anchorPlan(plan(), { kind: 'race', raceDate: '2026-08-01' }, today);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too-close');
    expect(r.weeksAvailable).toBe(2);
    expect(r.minWeeks).toBe(3);
  });

  it('race in the past refuses', () => {
    const r = anchorPlan(plan(), { kind: 'race', raceDate: '2026-07-01' }, today);
    expect(r.ok).toBe(false);
  });

  it('nextMondayIso', () => {
    expect(nextMondayIso('2026-07-21')).toBe('2026-07-27'); // Tue → next Mon
    expect(nextMondayIso('2026-07-20')).toBe('2026-07-27'); // Mon → NEXT Mon (never today)
  });
});
