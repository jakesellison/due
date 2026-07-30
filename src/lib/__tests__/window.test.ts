/**
 * Node tests for steady-state windowing (`src/lib/predict/window.ts`): a race
 * block's taper/race/recovery weeks are excluded and the surviving clean weeks
 * are compacted onto a contiguous timeline; a race-free history passes through
 * unchanged.
 */
import {
  steadyStateWindow,
  MAX_LOOKBACK_WEEKS,
  type WindowRun,
} from '../predict/window';
import {
  weekStartOf,
} from '../time/week';

/** A flat week-by-week block: `kmByWeek[0]` is the OLDEST week. */
function block(firstMonday: string, kmByWeek: number[], paceSecPerKm = 300): WindowRun[] {
  const out: WindowRun[] = [];
  for (let w = 0; w < kmByWeek.length; w++) {
    const monday = shift(firstMonday, w * 7);
    const km = kmByWeek[w]!;
    if (km <= 0) continue;
    // Put the whole week's volume on Wednesday for simplicity.
    out.push({
      localDate: shift(monday, 2),
      distanceMeters: km * 1000,
      movingTimeS: Math.round(km * paceSecPerKm),
      workoutType: 0,
    });
  }
  return out;
}

describe('steadyStateWindow', () => {
  it('passes runs through unchanged when no race is detected', () => {
    const runs = block('2026-04-06', [60, 65, 70, 72, 75]);
    const out = steadyStateWindow(runs, '2026-05-10', 16);
    expect(out.hadRace).toBe(false);
    expect(out.excludedWeekStarts).toEqual([]);
    expect(out.runs).toBe(runs); // same reference, untouched
  });

  it('excludes the taper, race and 2 recovery weeks around a detected race', () => {
    // 10 weeks of steady ~80 km, then taper(40)/RACE/recovery(35,37), then 3 more
    // strong weeks. The race is a tagged marathon in week index 10.
    const runs: WindowRun[] = [
      ...block('2026-02-09', [80, 82, 80, 84, 81, 83, 80, 82, 79, 85]),
      // taper week
      ...block('2026-04-20', [40]),
      // race week (tagged marathon)
      { localDate: '2026-04-27', distanceMeters: 42195, movingTimeS: 10300, workoutType: 1 },
      // recovery weeks
      ...block('2026-05-04', [35, 37]),
      // back to strong training
      ...block('2026-05-18', [90, 100, 120]),
    ];
    const asOf = '2026-06-07'; // Sunday after the last block week
    const out = steadyStateWindow(runs, asOf, 16);
    expect(out.hadRace).toBe(true);
    // Race week is 2026-04-27 (Mon). Excluded = that ± taper(1 before)/recovery(2 after).
    expect(out.excludedWeekStarts).toEqual([
      '2026-04-20', // taper
      '2026-04-27', // race
      '2026-05-04', // recovery 1
      '2026-05-11', // recovery 2
    ]);
    // None of the surviving runs fall in an excluded SOURCE week — and crucially
    // the contaminated low-volume weeks (35/37/40) and the race are gone: the
    // remaining weekly volumes should all be the strong steady-state values.
    const weeklyKm = sumByCompactedWeek(out.runs, asOf);
    // The most-recent three compacted weeks are the 120/100/90 block.
    expect(weeklyKm.slice(0, 3)).toEqual([120, 100, 90]);
    // The race-day 42 km and the 35/37/40 recovery/taper weeks are absent.
    expect(weeklyKm).not.toContain(40);
    expect(weeklyKm).not.toContain(35);
    expect(weeklyKm.some((v) => v > 41 && v < 43)).toBe(false);
  });

  it('looks back up to MAX_LOOKBACK_WEEKS to fill the active-week count', () => {
    expect(MAX_LOOKBACK_WEEKS).toBe(24);
    // A single race recently, with plenty of clean weeks behind it; ask for 8
    // active weeks. The window should reach past the excluded block to gather 8.
    const runs: WindowRun[] = [
      ...block('2026-01-05', [70, 72, 71, 73, 70, 74, 72, 75, 71, 70]),
      { localDate: '2026-03-18', distanceMeters: 42195, movingTimeS: 10300, workoutType: 1 },
      ...block('2026-03-23', [30, 32]),
      ...block('2026-04-06', [80, 82]),
    ];
    const asOf = '2026-04-19';
    const out = steadyStateWindow(runs, asOf, 8);
    const weeklyKm = sumByCompactedWeek(out.runs, asOf).filter((v) => v > 0);
    // At least 8 active clean weeks gathered, none of them the 30/32 recovery.
    expect(weeklyKm.length).toBeGreaterThanOrEqual(8);
    expect(weeklyKm).not.toContain(30);
    expect(weeklyKm).not.toContain(32);
  });
});

/** Sum km per compacted week index (0 = the asOf week), oldest trimmed to nonzero. */
function sumByCompactedWeek(runs: WindowRun[], asOf: string): number[] {
  const asOfWeek = weekStartOf(asOf, 'mon');
  const byWeek = new Map<number, number>();
  for (const r of runs) {
    const ws = weekStartOf(r.localDate, 'mon');
    const idx = Math.round(
      (new Date(`${asOfWeek}T12:00:00Z`).getTime() - new Date(`${ws}T12:00:00Z`).getTime()) /
        (7 * 86_400_000),
    );
    byWeek.set(idx, (byWeek.get(idx) ?? 0) + r.distanceMeters / 1000);
  }
  const maxIdx = Math.max(...byWeek.keys());
  const out: number[] = [];
  for (let i = 0; i <= maxIdx; i++) out.push(Math.round(byWeek.get(i) ?? 0));
  return out;
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD'. */
function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
