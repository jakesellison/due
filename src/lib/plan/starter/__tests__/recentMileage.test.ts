import {
  isoDaysAgo,
  weeklyMilesFromRows,
} from '../recentMileage';

const TODAY = '2026-07-21';
const MPM = 1609.344;

describe('weeklyMilesFromRows', () => {
  it('returns null when there are no rows', () => {
    expect(weeklyMilesFromRows([], TODAY)).toBe(null);
  });

  it('returns null when no row falls in the 28-day window', () => {
    // 29 days ago is just outside the trailing window.
    expect(
      weeklyMilesFromRows([{ local_date: '2026-06-22', distance_meters: 10000 }], TODAY),
    ).toBe(null);
  });

  it('averages 4 weeks of distance into weekly miles, one decimal', () => {
    // 160 total miles of meters over 4 weeks → 40.0 mpw.
    const rows = [
      { local_date: '2026-07-21', distance_meters: 40 * MPM },
      { local_date: '2026-07-14', distance_meters: 40 * MPM },
      { local_date: '2026-07-07', distance_meters: 40 * MPM },
      { local_date: '2026-06-30', distance_meters: 40 * MPM },
    ];
    expect(weeklyMilesFromRows(rows, TODAY)).toBe(40);
  });

  it('rounds to one decimal', () => {
    // 1 mile total over 4 weeks → 0.25 → 0.3 rounded.
    expect(
      weeklyMilesFromRows([{ local_date: TODAY, distance_meters: MPM }], TODAY),
    ).toBe(0.3);
  });

  it('ignores rows outside the window and non-positive/absent distances', () => {
    const rows = [
      { local_date: TODAY, distance_meters: 20 * MPM },
      { local_date: '2026-01-01', distance_meters: 999 * MPM }, // way out of window
      { local_date: TODAY, distance_meters: 0 }, // zero
      { local_date: TODAY, distance_meters: null }, // missing
      { local_date: null, distance_meters: 5 * MPM }, // no date
    ];
    // Only the 20-mile row counts → 20/4 = 5.0.
    expect(weeklyMilesFromRows(rows, TODAY)).toBe(5);
  });
});

describe('isoDaysAgo', () => {
  it('returns the ISO date N days before today', () => {
    expect(isoDaysAgo('2026-07-21', 28)).toBe('2026-06-23');
    expect(isoDaysAgo('2026-01-01', 1)).toBe('2025-12-31');
  });
});
