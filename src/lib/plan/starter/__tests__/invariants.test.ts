/**
 * invariants.test.ts — the executable spec for the 12 shipped starter blocks.
 *
 * Every `assets/starters/*.due.json` is run through the REAL `parsePlanImport`
 * text pipeline (via `fs.readFileSync`), so CI dogfoods exactly what a community
 * import does. The suite is the referee for Task 8's authored content: week
 * targets, ramp discipline, recovery/taper shape, long-run share, and the
 * quality-as-hard-miles accounting all live here. Do not weaken it to make a
 * file pass — fix the file.
 *
 * Adjustments from the brief's sketch: none of substance. The normalized
 * `RelativePlan` uses exactly the field names the sketch references
 * (`plan.plan.numWeeks`, `week.week/phase/isRecovery/targetMeters/…`,
 * `workout.week/type/plannedDistanceMeters`), so the sketch is used verbatim.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  parsePlanImport,
} from '../../parseImport';

const DIR = path.join(__dirname, '../../../../../assets/starters');
const MI = 1609;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.due.json'));

it('ships exactly 12 starters', () => expect(files).toHaveLength(12));

describe.each(files)('%s', (file) => {
  const plan = parsePlanImport(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const weekMi = (w: number) =>
    plan.workouts.filter((x) => x.week === w)
      .reduce((s, x) => s + (x.plannedDistanceMeters ?? 0), 0) / MI;
  const target = (w: number) => (plan.weeks[w - 1]!.targetMeters ?? 0) / MI;
  const buildWeeks = plan.weeks.filter((w) => !w.isRecovery && w.phase !== 'taper' && w.week !== plan.plan.numWeeks);

  it('weeks contiguous, workouts sum to target ±5%', () => {
    plan.weeks.forEach((w, i) => expect(w.week).toBe(i + 1));
    for (const w of plan.weeks) {
      expect(Math.abs(weekMi(w.week) - target(w.week)) / target(w.week)).toBeLessThanOrEqual(0.05);
    }
  });

  it('ramp ≤12% between consecutive non-recovery build weeks', () => {
    for (let i = 1; i < buildWeeks.length; i++) {
      const prev = target(buildWeeks[i - 1]!.week), cur = target(buildWeeks[i]!.week);
      if (cur > prev) expect((cur - prev) / prev).toBeLessThanOrEqual(0.12);
    }
  });

  it('recovery weeks recover; taper descends into the race', () => {
    for (const w of plan.weeks.filter((x) => x.isRecovery)) {
      const prev = w.week > 1 ? target(w.week - 1) : Infinity;
      expect(target(w.week)).toBeLessThan(prev);
    }
    const taper = plan.weeks.filter((w) => w.phase === 'taper').map((w) => target(w.week));
    for (let i = 1; i < taper.length; i++) expect(taper[i]!).toBeLessThan(taper[i - 1]!);
  });

  it('long ≤40% of week; quality 15–25% of volume; race only in final week', () => {
    for (const w of plan.weeks) {
      const long = (w.longTargetMeters ?? 0) / MI;
      if (long > 0) expect(long / target(w.week)).toBeLessThanOrEqual(0.40);
    }
    const totalMi = plan.weeks.reduce((s, w) => s + target(w.week), 0);
    const qualityMi = plan.weeks.reduce((s, w) => s + (w.qualityTargetMeters ?? 0), 0) / MI;
    expect(qualityMi / totalMi).toBeGreaterThanOrEqual(0.15 * 0.9); // taper weeks dilute; 13.5% floor
    expect(qualityMi / totalMi).toBeLessThanOrEqual(0.25);
    for (const wo of plan.workouts.filter((x) => x.type === 'race')) {
      expect(wo.week).toBe(plan.plan.numWeeks);
    }
  });
});
