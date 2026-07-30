import {
  adherenceSummary,
  goalStat,
  GOAL_GATES,
  type WeekGoal,
} from '../kpi/weekGoals';

function week(
  weekIndex: number,
  opts: {
    isCurrent?: boolean;
    isFuture?: boolean;
    allMet: boolean;
    mileageHit?: boolean;
    qualityHit?: boolean;
    longHit?: boolean;
  },
): WeekGoal {
  const stat = (hit: boolean) => ({ actualMeters: hit ? 100 : 50, targetMeters: 100, hit, fraction: hit ? 1 : 0.5 });
  const mileageHit = opts.mileageHit ?? opts.allMet;
  const qualityHit = opts.qualityHit ?? opts.allMet;
  const longHit = opts.longHit ?? opts.allMet;
  return {
    weekIndex,
    weekStart: `2026-0${1 + weekIndex}-01`,
    label: `${weekIndex}`,
    isCurrent: !!opts.isCurrent,
    isFuture: !!opts.isFuture,
    mileage: stat(mileageHit),
    quality: stat(qualityHit),
    long: stat(longHit),
    allMet: !opts.isFuture && !opts.isCurrent && opts.allMet,
  };
}

describe('goalStat', () => {
  it('hits at/above the gated fraction of target, misses below', () => {
    expect(goalStat(100, 100, GOAL_GATES.mileage).hit).toBe(true);
    expect(goalStat(99, 100, GOAL_GATES.mileage).hit).toBe(false);
    expect(goalStat(60, 100, GOAL_GATES.quality).hit).toBe(true);
    expect(goalStat(59, 100, GOAL_GATES.quality).hit).toBe(false);
  });
  it('never hits without a target', () => {
    expect(goalStat(50, 0, GOAL_GATES.mileage).hit).toBe(false);
  });
});

describe('adherenceSummary', () => {
  it('headline, streak, and dots all read the same mileage-contract flag', () => {
    // 3 hit, 1 miss, all settled — the streak breaks on the trailing miss.
    const weeks = [
      week(1, { allMet: true }),
      week(2, { allMet: true }),
      week(3, { allMet: true }),
      week(4, { allMet: false }),
    ];
    const s = adherenceSummary(weeks);
    expect(s.statuses).toEqual(['hit', 'hit', 'hit', 'miss']);
    expect(s.settledN).toBe(4);
    expect(s.hitN).toBe(3);
    // The most recent settled week missed, so the CURRENT streak is 0 —
    // this is a genuinely different number from "3/4 hit" (total count vs.
    // trailing streak), not a contradiction; the UI labels it "Streak" so it
    // never reads as a second, disagreeing "hit" count.
    expect(s.streak).toBe(0);
  });

  it('counts a mileage-complete week even when quality and long-run goals miss', () => {
    const s = adherenceSummary([
      week(1, { allMet: false, mileageHit: true, qualityHit: false, longHit: false }),
    ]);

    expect(s.statuses).toEqual(['hit']);
    expect(s.hitN).toBe(1);
    expect(s.streak).toBe(1);
    expect(s.qualityHitN).toBe(0);
    expect(s.qualityPlannedN).toBe(1);
    expect(s.longHitN).toBe(0);
    expect(s.longPlannedN).toBe(1);
  });

  it('this is the runner#5 case: reads consistent even mid-way through 8 weeks', () => {
    const weeks = [
      week(1, { allMet: true }),
      week(2, { allMet: true }),
      week(3, { allMet: true }),
      week(4, { allMet: true }),
      week(5, { allMet: true }),
      week(6, { allMet: true }),
      week(7, { allMet: true }),
      week(8, { isCurrent: true, allMet: false }),
    ];
    const s = adherenceSummary(weeks);
    // 7 settled weeks, all hit, current week excluded from both N and streak.
    expect(s.settledN).toBe(7);
    expect(s.hitN).toBe(7);
    expect(s.streak).toBe(7);
    expect(s.statuses[7]).toBe('current');
  });

  it('excludes future weeks from settledN, hitN, and the streak', () => {
    const weeks = [
      week(1, { allMet: true }),
      week(2, { isCurrent: true, allMet: false }),
      week(3, { isFuture: true, allMet: false }),
      week(4, { isFuture: true, allMet: false }),
    ];
    const s = adherenceSummary(weeks);
    expect(s.statuses).toEqual(['hit', 'current', 'future', 'future']);
    expect(s.settledN).toBe(1);
    expect(s.hitN).toBe(1);
    expect(s.streak).toBe(1);
  });

  it('sorts by weekIndex before deriving (input order does not matter)', () => {
    const weeks = [
      week(2, { allMet: false }),
      week(1, { allMet: true }),
    ];
    const s = adherenceSummary(weeks);
    expect(s.statuses).toEqual(['hit', 'miss']);
  });

  it('empty input yields a zeroed, empty summary', () => {
    const s = adherenceSummary([]);
    expect(s).toEqual({
      statuses: [],
      settledN: 0,
      hitN: 0,
      streak: 0,
      qualityPlannedN: 0,
      qualityHitN: 0,
      longPlannedN: 0,
      longHitN: 0,
    });
  });
});
