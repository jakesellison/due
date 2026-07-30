/**
 * Node tests for how the v3 ladder supersedes the legacy race-anchor blend:
 * a tagged race now drives a TIER-1 personal projection (race_anchor_v3),
 * while the legacy ensemble (with its anchor blend) survives as the
 * cross-check components on the same prediction.
 */
import {
  predictRace,
  type PredictActivity,
} from '../predict/ensemble';
import {
  MARATHON_METERS,
} from '../predict/tanda';

const asOf = '2026-06-04';

function steadyBlock(asOf: string, weeklyKm: number, paceSecPerKm: number): PredictActivity[] {
  const out: PredictActivity[] = [];
  let day = shift(asOf, -(16 * 7 - 1));
  for (let w = 0; w < 16; w++) {
    for (let i = 0; i < 5; i++) {
      out.push({
        localDate: shift(day, i),
        distanceMeters: (weeklyKm / 5) * 1000,
        movingTimeS: (weeklyKm / 5) * paceSecPerKm,
        workoutType: 0,
      });
    }
    day = shift(day, 7);
  }
  return out;
}

function marathonRace(asOf: string, ageDays: number, seconds: number): PredictActivity {
  return {
    localDate: shift(asOf, -ageDays),
    distanceMeters: 42519,
    movingTimeS: seconds,
    workoutType: 1,
  };
}

describe('race-anchored prediction (v3 ladder)', () => {
  it('a recent tagged marathon drives a tier-1 projection near the race time', () => {
    const acts = [...steadyBlock(asOf, 95, 305), marathonRace(asOf, 45, 10305)];
    const pred = predictRace(acts, asOf, MARATHON_METERS)!;
    expect(pred.modelVersion).toBe('race_anchor_v3');
    // Target ≈ race distance ⇒ prediction ≈ the race time, fitness-scaled:
    // within a sane window around 2:51:45, far from the old +30-min blends.
    expect(pred.seconds).toBeGreaterThan(10305 * 0.9);
    expect(pred.seconds).toBeLessThan(10305 * 1.1);
  });

  it('keeps the legacy anchor blend visible in the cross-check components', () => {
    const acts = [...steadyBlock(asOf, 95, 305), marathonRace(asOf, 45, 10305)];
    const pred = predictRace(acts, asOf, MARATHON_METERS)!;
    // The legacy ensemble (tier-0 fallback) still computed its anchor.
    expect(pred.components.anchor).toBeGreaterThan(0);
    expect(pred.components.anchorMeta?.raceDate).toBe(shift(asOf, -45));
    expect(pred.components.ridgeV2 ?? pred.components.ridge).toBeGreaterThan(0);
  });

  it('is much closer to the race than the population model is', () => {
    const acts = [...steadyBlock(asOf, 95, 305), marathonRace(asOf, 45, 10305)];
    const pred = predictRace(acts, asOf, MARATHON_METERS)!;
    const model = (pred.components.ridgeV2 ?? pred.components.ridge) as number;
    expect(Math.abs(pred.seconds - 10305)).toBeLessThan(Math.abs(model - 10305));
  });

  it('a race beyond the legacy 180-day anchor window still drives tier 1', () => {
    const acts = [...steadyBlock(asOf, 95, 305), marathonRace(asOf, 200, 10305)];
    const pred = predictRace(acts, asOf, MARATHON_METERS)!;
    expect(pred.modelVersion).toBe('race_anchor_v3'); // v3 has no 180-day cliff
    expect(pred.components.anchor).toBeUndefined(); // legacy blend ignored it
  });
});

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD'. */
function shift(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
