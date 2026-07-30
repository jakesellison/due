/**
 * Node tests for reflowWeek — bounded-recovery policy (adapt-study §3 v2.2).
 *
 * Three fixture weeks:
 *
 * LEGACY canonical week (kept from v1 so the A/B/D/E/I/K/L scenario names survive):
 *   Mon E16 · Tue Q12 · Wed E10 · Thu E12 · Fri E10 · Sat L24 · Sun R0(row)
 *   TARGET = 84.0 mi.  Constants: L=24, E=16, M=median(16,12,10,12,10,24)=12,
 *   DAY_TOTAL_MAX=23, HYBRID_MIN_ABS=max(2%·84, 1)=1.68 mi.
 *
 * W91 corpus week (study §5 — the real incident week):
 *   Mon E14+6PM · Tue Q14 · Wed E16 · Thu E12 · Fri E9 · Sat L20 · Sun R0(row)
 *   TARGET = 91.  Constants: L=20, E=16, M=median(14,14,16,12,9,20)=14,
 *   DAY_TOTAL_MAX=19, post-long rest cap=min(16, 0.6·20)=12.
 *
 * W35 novice week (study §8b) and a custom 62-mi week for the R9 swap.
 *
 * Every expected number is hand-computed in the comments; nothing asserts the
 * code's own output back at itself.
 */

import {
  extensionHeadroom,
  reflowWeek,
  type ReflowInput,
  type ReflowResult,
} from '../reflow';
import type { WeekDay } from '../propose';

const MI = 1609.344;
const m = (miles: number) => Math.round(miles * MI);

/** Whole-meter rounding of m() drifts a couple meters over sums — allow ±3 m. */
function expectNear(actual: number | null | undefined, expectedMeters: number): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect(Math.abs((actual as number) - expectedMeters)).toBeLessThanOrEqual(3);
}

function setDistanceOf(r: ReflowResult, workoutId: string): number | null {
  const op = r.ops.find((o) => o.kind === 'setDistance' && o.workoutId === workoutId);
  return op && op.kind === 'setDistance' ? op.newDistanceMeters : null;
}

function setTypeOf(r: ReflowResult, workoutId: string): string | null {
  const op = r.ops.find((o) => o.kind === 'setType' && o.workoutId === workoutId);
  return op && op.kind === 'setType' ? op.newType : null;
}

function addDoubles(r: ReflowResult): { onDate: string; distanceMeters: number }[] {
  return r.ops.flatMap((o) => (o.kind === 'addDouble' ? [o] : []));
}

function arrangedTotal(r: ReflowResult): number {
  return r.arrangement.reduce((s, a) => s + a.meters, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic scenario builder
// ─────────────────────────────────────────────────────────────────────────────

interface DayDef {
  type: WeekDay['type'];
  planned: number;
  plannedPm?: number;
  workoutId: string | null;
}

function buildWeek(
  defs: DayDef[],
  dates: string[],
  todayIdx: number,
  acts: Partial<Record<number, number>>,
): { weekDays: WeekDay[]; actualMeters: number } {
  let actual = 0;
  const weekDays: WeekDay[] = defs.map((d, i) => {
    const isPast = i < todayIdx;
    let hasActivity = false;
    if (isPast && d.type !== 'rest') {
      const actVal = i in acts ? acts[i]! : d.planned + (d.plannedPm ?? 0);
      if (actVal > 0) {
        actual += actVal;
        hasActivity = true;
      }
    }
    return {
      workoutId: d.workoutId,
      date: dates[i]!,
      idx: i,
      type: d.type,
      plannedMeters: d.planned,
      plannedPmMeters: d.plannedPm ?? 0,
      hasActivity,
      isToday: i === todayIdx,
    };
  });
  return { weekDays, actualMeters: actual };
}

// ═════════════════════════════════════════════════════════════════════════════
// LEGACY canonical week (84 mi)
// ═════════════════════════════════════════════════════════════════════════════

const LEGACY_DATES = [
  '2026-06-15', // Mon
  '2026-06-16', // Tue
  '2026-06-17', // Wed
  '2026-06-18', // Thu
  '2026-06-19', // Fri
  '2026-06-20', // Sat
  '2026-06-21', // Sun
];

const LEGACY_DEFS: DayDef[] = [
  { type: 'easy',    planned: m(16), workoutId: 'w0' },
  { type: 'quality', planned: m(12), workoutId: 'w1' },
  { type: 'easy',    planned: m(10), workoutId: 'w2' },
  { type: 'easy',    planned: m(12), workoutId: 'w3' },
  { type: 'easy',    planned: m(10), workoutId: 'w4' },
  { type: 'long',    planned: m(24), workoutId: 'w5' },
  { type: 'rest',    planned: 0,     workoutId: 'w6' }, // rest rows exist in this plan
];
const TARGET = LEGACY_DEFS.reduce((s, d) => s + d.planned, 0); // 84 mi

const QUALITY_DAY = { idx: 1, plannedMeters: m(12), workoutId: 'w1', date: LEGACY_DATES[1]! };
const LONG_DAY = { idx: 5, plannedMeters: m(24), workoutId: 'w5', date: LEGACY_DATES[5]! };

function legacyInput(
  todayIdx: number,
  acts: Partial<Record<number, number>>,
  opts: {
    qualitySatisfied?: boolean;
    useRestDay?: boolean;
    pmHabitMeters?: number | null;
  } = {},
): ReflowInput {
  const { weekDays, actualMeters } = buildWeek(LEGACY_DEFS, LEGACY_DATES, todayIdx, acts);
  return {
    weekDays,
    weekTargetMeters: TARGET,
    actualMeters,
    qualitySatisfied: opts.qualitySatisfied ?? false,
    useRestDay: opts.useRestDay ?? true,
    pmHabitMeters: opts.pmHabitMeters ?? null,
    qualityDay: QUALITY_DAY,
    longDay: LONG_DAY,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario F — On pace → no card
// ─────────────────────────────────────────────────────────────────────────────

test('F: on pace → returns null', () => {
  // All days run on plan through Sunday → weekEndGap = 0 → null.
  const input = legacyInput(7, {}, { qualitySatisfied: true });
  expect(reflowWeek(input)).toBeNull();
});

test('F: remaining planned covers gap → returns null (weekEndGap = 0)', () => {
  // today = Thu (idx=3), Mon-Wed ran as planned.
  // actual = 16+12+10 = 38, remaining planned = 12+10+24+0 = 46 → gap = 84-38-46 = 0.
  const input = legacyInput(3, {}, { qualitySatisfied: true });
  expect(reflowWeek(input)).toBeNull();
});

test('F/T9: future planned PM double counts toward remPlanned → no card when on pace', () => {
  // today = Wed (idx=2), Mon+Tue ran to plan (28mi). Thu has a planned 6mi PM
  // double and the target includes it: target = 90, remaining planned =
  // 10+12+6(PM)+10+24+0 = 62 → weekEndGap = 90−28−62 = 0 → null.
  const { weekDays, actualMeters } = buildWeek(LEGACY_DEFS, LEGACY_DATES, 2, {});
  weekDays[3] = { ...weekDays[3]!, plannedPmMeters: m(6) };
  const input: ReflowInput = {
    weekDays,
    weekTargetMeters: TARGET + m(6),
    actualMeters,
    qualitySatisfied: true,
    useRestDay: true,
    pmHabitMeters: null,
    qualityDay: QUALITY_DAY,
    longDay: LONG_DAY,
  };
  expect(reflowWeek(input)).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D — nothing recoverable → feasible:false
// ─────────────────────────────────────────────────────────────────────────────

test('D: keep-rest with only long+rest remaining → feasible:false, all conceded', () => {
  // Miss everything Mon–Fri, today=Sat. Only Sat (long, kept) + Sun (rest) remain.
  // D = 84 − 0 − 24 = 60. `feasible` now means "recovered ≥ HYBRID_MIN_ABS":
  //   extensions: no easy day → 0; double: pmHabit null → 0;
  //   rest lever: useRestDay=false → 0;
  //   R5 quality re-place: no easy slot, rest fallback Sun is adjacent to the
  //     Sat long → conceded.
  // recovered 0 < 1.68 → feasible:false, no ops, newTarget = 84−60 = 24.
  const input = legacyInput(5, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, { useRestDay: false });
  const result = reflowWeek(input)!;
  expect(result).not.toBeNull();
  expect(result.feasible).toBe(false);
  expect(result.ops).toHaveLength(0);
  expect(result.recoveredMeters).toBe(0);
  expectNear(result.concededMeters, m(60));
  expectNear(result.newTargetMeters, m(24));
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — mileage-only miss, extensions + one double fully recover
// ─────────────────────────────────────────────────────────────────────────────

test('A: miss Tue Q (satisfied), today=Wed → extensions + Wed double fully recover', () => {
  // actual = 16 (Mon). D = 84 − 16 − (10+12+10+24) = 12.
  // R2 headroom: Wed 10 → floor(12.5)=12 → +2; Thu 12 → floor(15)=15 → +3;
  //   Fri 10 → +2 (pre-long is fine for EXTENSIONS). Σ=7 ≤ 12 → take all. D_rem 5.
  // R4 (pmHabit 5): hosts with planned AM ≤ M=12 and not pre-long: Wed(10), Thu(12)
  //   → lightest = Wed. PM = min(5, 5) = 5; Wed 12+5 = 17 ≤ 23 → no trim. D_rem 0.
  // R3 never needed → Sun untouched. Fully recovered → newTarget null.
  const input = legacyInput(2, { 1: 0 }, { qualitySatisfied: true, pmHabitMeters: m(5) });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expectNear(setDistanceOf(result, 'w2'), m(12));
  expectNear(setDistanceOf(result, 'w3'), m(15));
  expectNear(setDistanceOf(result, 'w4'), m(12));
  const dbl = addDoubles(result);
  expect(dbl).toHaveLength(1);
  expect(dbl[0]!.onDate).toBe(LEGACY_DATES[2]);
  expectNear(dbl[0]!.distanceMeters, m(5));
  // Sun rest stays rest — no ops touch w6.
  expect(setTypeOf(result, 'w6')).toBeNull();
  expect(setDistanceOf(result, 'w6')).toBeNull();
  // Long kept at 24; no quality placed (satisfied).
  const longEntry = result.arrangement.find((r) => r.type === 'long');
  expectNear(longEntry?.meters, m(24));
  expect(result.arrangement.find((r) => r.type === 'quality')).toBeUndefined();
  expectNear(result.recoveredMeters, m(12));
  expect(result.concededMeters).toBeLessThanOrEqual(3);
  expect(result.newTargetMeters).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario E — quality re-placed (R5), partial recovery, keep-rest variant
// ─────────────────────────────────────────────────────────────────────────────

test('E: miss Mon+Tue (quality unmet), today=Wed, keep-rest → quality re-placed on Thu', () => {
  // actual = 0. D = 84 − (10+12+10+24) = 28.
  // R5: safe easy slots = Wed(10), Thu(12) (Fri is adjacent to Sat long).
  //   |10−12|=2 vs |12−12|=0 → Thu hosts Q12 at planned distance → credit 0.
  // R9: day after Thu is Fri(10); lightest other easy = Wed(10); 10 > 10 is false → no swap.
  // R2: Wed +2 → 12, Fri +2 → 12 (Thu is quality now). D_rem 24.
  // R4: host = Wed (10 ≤ M=12; Thu is the re-placed quality; Fri pre-long) → PM 5.
  //   Wed 12+5 = 17 ≤ 23. D_rem 19.
  // R3: useRestDay=false → skipped. recovered = 0+4+5 = 9; conceded 19 → 84−19 = 65.
  const input = legacyInput(2, { 0: 0, 1: 0 }, { useRestDay: false, pmHabitMeters: m(5) });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  const qualityEntry = result.arrangement.find((r) => r.type === 'quality');
  expect(qualityEntry).toBeTruthy();
  expect(qualityEntry!.date).toBe(LEGACY_DATES[3]);
  expectNear(qualityEntry!.meters, m(12));
  expect(setTypeOf(result, 'w3')).toBe('quality');
  // Thu's distance is unchanged (12 → Q12) → no setDistance op for w3.
  expect(setDistanceOf(result, 'w3')).toBeNull();
  expectNear(setDistanceOf(result, 'w2'), m(12));
  expectNear(setDistanceOf(result, 'w4'), m(12));
  const dbl = addDoubles(result);
  expect(dbl).toHaveLength(1);
  expect(dbl[0]!.onDate).toBe(LEGACY_DATES[2]);
  expectNear(result.recoveredMeters, m(9));
  expectNear(result.concededMeters, m(19));
  expectNear(result.newTargetMeters, m(65));
  // Long entry kept.
  expect(result.arrangement.find((r) => r.type === 'long')).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario I — quality has NO safe slot → conceded (strict adjacency, R5)
// ─────────────────────────────────────────────────────────────────────────────

test('I: miss Tue Q (unmet), today=Fri → no safe slot, quality conceded; mileage recovered', () => {
  // actual = 16+10+12 = 38 (Mon, Wed, Thu). Remaining: Fri 10 · Sat L24 · Sun R.
  // D = 84 − 38 − 34 = 12.
  // R5: Fri is adjacent to Sat long; rest fallback Sun is also adjacent → CONCEDED
  //   (v1 planted it adjacent anyway; the new policy refuses back-to-back hard).
  // R2: Fri +2 → 12. D_rem 10. R4: pmHabit null → none.
  // R3: Sun follows the long → cap = min(16, 0.6·24=14.4); rest = min(14.4, 10) = 10.
  // Fully recovered → newTarget null.
  const input = legacyInput(4, { 1: 0 }, {});
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expect(result.arrangement.find((r) => r.type === 'quality')).toBeUndefined();
  expectNear(setDistanceOf(result, 'w4'), m(12));
  expect(setTypeOf(result, 'w6')).toBe('easy');
  expectNear(setDistanceOf(result, 'w6'), m(10));
  expectNear(result.recoveredMeters, m(12));
  expect(result.newTargetMeters).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario E2 (v2.3.1) — quality day ELAPSED with a (non-quality) activity but
// UNSATISFIED → R5 still re-places. The runner ran EASY on their quality day;
// the old `wasMissed` guard (needs !hasActivity) refused to restore quality
// solely because a run happened. The new elapsed-and-unmet trigger fixes it.
// ─────────────────────────────────────────────────────────────────────────────

test('E2: ran EASY on Tue quality (unmet), today=Wed → quality RE-PLACED on Thu', () => {
  // Tue quality "ran" 8 mi easy (hasActivity true) but qualitySatisfied=false;
  // Mon ran its 16. actual = 24. today Wed. Remaining Wed10·Thu12·Fri10·Sat L24·Sun R.
  // D = 84 − 24 − 56 = 4.
  // R5 (v2.3.1): Tue is elapsed + unsatisfied → fires DESPITE the easy run.
  //   Wed is adjacent to the ran-quality Tue (isHardAt) → excluded; Fri is
  //   adjacent to the Sat long → excluded; Thu(12) is the only safe host →
  //   Q12 at planned distance (credit 0). R2: Wed +2, Fri +2 → D_rem 0.
  const input = legacyInput(2, { 1: m(8) }, { useRestDay: false });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  // Quality restored — the whole point of the fix.
  const qualityEntry = result.arrangement.find((r) => r.type === 'quality');
  expect(qualityEntry).toBeTruthy();
  expect(qualityEntry!.date).toBe(LEGACY_DATES[3]);
  expectNear(qualityEntry!.meters, m(12));
  expect(result.qualityReplaced).not.toBeNull();
  expect(result.qualityReplaced!.date).toBe(LEGACY_DATES[3]);
  expect(setTypeOf(result, 'w3')).toBe('quality');
  expectNear(result.recoveredMeters, m(4));
  expect(result.newTargetMeters).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario I2 (v2.3.1 guard) — quality day elapsed + unsatisfied (ran easy) but
// NO safe host (only long-adjacent Fri + long-adjacent rest Sun, no viable swap)
// → still CONCEDES. Proves the elapsed trigger did not over-force placement.
// ─────────────────────────────────────────────────────────────────────────────

test('I2: ran EASY on Tue quality (unmet), today=Fri, no safe host → quality CONCEDED', () => {
  // Tue quality "ran" 8 mi easy (unsatisfied); Mon/Wed/Thu on plan. actual = 46.
  // today Fri. Remaining: Fri10 · Sat L24 · Sun R. D = 84 − 46 − 34 = 4.
  // R5 fires (elapsed + unmet) but Fri is adjacent to the Sat long, the Sun rest
  // fallback is also long-adjacent, and the one slot-opening swap yields no
  // eligible easy slot → quality conceded (seal stays open). Mileage still
  // recovers: Fri 10→12; Sun rest floors to 2 (<3) so it stays rest.
  const input = legacyInput(4, { 1: m(8) }, {});
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expect(result.arrangement.find((r) => r.type === 'quality')).toBeUndefined();
  expect(result.qualityReplaced).toBeNull();
  expectNear(setDistanceOf(result, 'w4'), m(12));
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario K — quality satisfied → no quality placed, same recovery as I
// ─────────────────────────────────────────────────────────────────────────────

test('K: miss Tue (quality satisfied), today=Fri → mileage-only recovery, no quality', () => {
  // Same arithmetic as I but no R5 at all: Fri 10→12, Sun rest→10.
  const input = legacyInput(4, { 1: 0 }, { qualitySatisfied: true });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expect(result.arrangement.find((r) => r.type === 'quality')).toBeUndefined();
  expectNear(setDistanceOf(result, 'w4'), m(12));
  expectNear(setDistanceOf(result, 'w6'), m(10));
  expect(result.newTargetMeters).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — rest day is the LAST lever and receives only the remainder
// ─────────────────────────────────────────────────────────────────────────────

test('B: miss Mon (16), today=Wed → extensions+double first, Sun gets ONLY the remainder', () => {
  // actual = 12 (Tue quality ran). D = 84 − 12 − 56 = 16.
  // R2: Wed +2 → 12 · Thu +3 → 15 · Fri +2 → 12 (Σ7). D_rem 9.
  // R4: host Wed (lightest ≤ M) → PM 5, 12+5=17 ≤ 23. D_rem 4.
  // R3 (LAST): Sun rest → min(cap 14.4, 4) = 4 ≥ 3 → easy 4. Fully recovered.
  const input = legacyInput(2, { 0: 0 }, { qualitySatisfied: true, pmHabitMeters: m(5) });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expectNear(setDistanceOf(result, 'w2'), m(12));
  expectNear(setDistanceOf(result, 'w3'), m(15));
  expectNear(setDistanceOf(result, 'w4'), m(12));
  expect(addDoubles(result)).toHaveLength(1);
  // The rest day was activated explicitly, with the REMAINDER only (4), never a spread share.
  expect(setTypeOf(result, 'w6')).toBe('easy');
  expectNear(setDistanceOf(result, 'w6'), m(4));
  expectNear(result.recoveredMeters, m(16));
  expect(result.newTargetMeters).toBeNull();

  // Keep-rest variant omits Sun entirely and concedes the 4.
  const keepRest = reflowWeek(
    legacyInput(2, { 0: 0 }, { qualitySatisfied: true, pmHabitMeters: m(5), useRestDay: false }),
  )!;
  expect(setTypeOf(keepRest, 'w6')).toBeNull();
  expect(setDistanceOf(keepRest, 'w6')).toBeNull();
  expect(keepRest.arrangement.find((r) => r.date === LEGACY_DATES[6])).toBeUndefined();
  expectNear(keepRest.recoveredMeters, m(12));
  expectNear(keepRest.concededMeters, m(4));
  expectNear(keepRest.newTargetMeters, m(80));
});

test('B2: only Fri+long+rest remain → Fri is pre-long, NO double; rest lever capped post-long', () => {
  // Miss Tue+Thu, today=Fri, quality satisfied. actual = 16+10 = 26.
  // Remaining: Fri 10 · Sat L24 · Sun R. D = 84 − 26 − 34 = 24.
  // R2: Fri +2 → 12. D_rem 22.
  // R4: the only easy day (Fri) is pre-long → NO double even with a habit (v1 forced one).
  // R3: Sun follows the long → cap = min(16, 0.6·24 = 14.4) → 14 (whole mile).
  // recovered 2+14 = 16 · conceded 8 → 84−8 = 76.
  const input = legacyInput(4, { 1: 0, 3: 0 }, { qualitySatisfied: true, pmHabitMeters: m(5) });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expect(addDoubles(result)).toHaveLength(0);
  expect(result.arrangement.some((r) => r.isDouble)).toBe(false);
  expectNear(setDistanceOf(result, 'w4'), m(12));
  expect(setTypeOf(result, 'w6')).toBe('easy');
  expectNear(setDistanceOf(result, 'w6'), m(14));
  expectNear(result.recoveredMeters, m(16));
  expectNear(result.concededMeters, m(8));
  expectNear(result.newTargetMeters, m(76));
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario L — over-run day feeds actual; small deficit fully recovered
// ─────────────────────────────────────────────────────────────────────────────

test('L: Mon missed, Wed over-ran (20 of 10), today=Fri → Fri +2 and Sun rest→4', () => {
  // actual = 12 (Tue) + 20 (Wed) + 12 (Thu) = 44. D = 84 − 44 − 34 = 6.
  // R2: Fri +2 → 12. D_rem 4. R4: pmHabit null. R3: Sun → min(14.4, 4) = 4 ≥ 3.
  const input = legacyInput(4, { 0: 0, 2: m(20) }, { qualitySatisfied: true });
  const result = reflowWeek(input)!;
  expect(result.feasible).toBe(true);
  expectNear(setDistanceOf(result, 'w4'), m(12));
  expectNear(setDistanceOf(result, 'w6'), m(4));
  expectNear(result.recoveredMeters, m(6));
  expect(result.newTargetMeters).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Arrangement totals — actual + arranged ≈ (newTarget ?? weekTarget)
// ─────────────────────────────────────────────────────────────────────────────

test('arrangement total + actual ≈ weekTarget for scenario A (fully recovered)', () => {
  const input = legacyInput(2, { 1: 0 }, { qualitySatisfied: true, pmHabitMeters: m(5) });
  const result = reflowWeek(input)!;
  // newTarget null → totals must hit the original target: 16 + (12+5+15+12+24) = 84.
  expect(result.newTargetMeters).toBeNull();
  expect(Math.abs(input.actualMeters + arrangedTotal(result) - TARGET)).toBeLessThan(m(0.2));
});

test('arrangement total + actual ≈ newTarget for scenario E (partial recovery)', () => {
  const input = legacyInput(2, { 0: 0, 1: 0 }, { useRestDay: false, pmHabitMeters: m(5) });
  const result = reflowWeek(input)!;
  // conceding → totals hit the ADJUSTED target: 0 + (12+5 + 12 + 12 + 24) = 65.
  expectNear(result.newTargetMeters, m(65));
  expect(
    Math.abs(input.actualMeters + arrangedTotal(result) - result.newTargetMeters!),
  ).toBeLessThan(m(0.2));
});

// ═════════════════════════════════════════════════════════════════════════════
// W91 corpus (study §4/§5) — the real incident week
// ═════════════════════════════════════════════════════════════════════════════

const W91_DATES = [
  '2026-07-06', // Mon
  '2026-07-07', // Tue
  '2026-07-08', // Wed
  '2026-07-09', // Thu
  '2026-07-10', // Fri
  '2026-07-11', // Sat
  '2026-07-12', // Sun
];

const W91_DEFS: DayDef[] = [
  { type: 'easy',    planned: m(14), plannedPm: m(6), workoutId: 'w0' }, // the planned 14+6 double
  { type: 'quality', planned: m(14), workoutId: 'w1' },
  { type: 'easy',    planned: m(16), workoutId: 'w2' },
  { type: 'easy',    planned: m(12), workoutId: 'w3' },
  { type: 'easy',    planned: m(9),  workoutId: 'w4' },
  { type: 'long',    planned: m(20), workoutId: 'w5' },
  { type: 'rest',    planned: 0,     workoutId: 'w6' }, // Sun row exists
];
const W91_TARGET = m(91);
const W91_QUALITY = { idx: 1, plannedMeters: m(14), workoutId: 'w1', date: W91_DATES[1]! };
const W91_LONG = { idx: 5, plannedMeters: m(20), workoutId: 'w5', date: W91_DATES[5]! };

function w91Input(
  todayIdx: number,
  acts: Partial<Record<number, number>>,
  opts: {
    qualitySatisfied?: boolean;
    useRestDay?: boolean;
    pmHabitMeters?: number | null;
    defs?: DayDef[];
    weekTargetMeters?: number;
  } = {},
): ReflowInput {
  const defs = opts.defs ?? W91_DEFS;
  const { weekDays, actualMeters } = buildWeek(defs, W91_DATES, todayIdx, acts);
  return {
    weekDays,
    weekTargetMeters: opts.weekTargetMeters ?? W91_TARGET,
    actualMeters,
    qualitySatisfied: opts.qualitySatisfied ?? false,
    useRestDay: opts.useRestDay ?? true,
    // PM habit: the runner's own PM size — §4 worked example uses 5 mi.
    pmHabitMeters: opts.pmHabitMeters === undefined ? m(5) : opts.pmHabitMeters,
    qualityDay: W91_QUALITY,
    longDay: W91_LONG,
  };
}

describe('W91 corpus', () => {
  test('T1 max-recovery (§4 PRIMARY): Thu 14+5 · Fri 11 · Sun rest→11 · recover 20 · 91', () => {
    // Mon (14+6 double) fully missed, today Tue. D = 91 − 0 − 71 = 20.
    // Missed day was easy+PM → mileage-only (R6): no re-place, no swap.
    // R2: Wed +0 (16 = E cap) · Thu floor(12·1.25)=15 → +3 · Fri floor(11.25)=11 → +2. D_rem 15.
    // R4: hosts = Thu only (Fri pre-long, Wed 16 > M=14). PM = min(5, 15) = 5.
    //   Thu 15+5 = 20 > DAY_TOTAL_MAX 19 → trim ext by 1 → Thu 14+5 = 19. D_rem 11.
    // R3: Sun rest (post-long cap min(16, 0.6·20)=12) → min(12, 11) = 11. D_rem 0.
    const result = reflowWeek(w91Input(1, { 0: 0 }))!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);

    // Exactly the §4 ops: Thu→14, Fri→11, addDouble Thu 5, Sun setType+setDistance 11.
    expect(result.ops).toHaveLength(5);
    expectNear(setDistanceOf(result, 'w3'), m(14));
    expectNear(setDistanceOf(result, 'w4'), m(11));
    const dbl = addDoubles(result);
    expect(dbl).toHaveLength(1);
    expect(dbl[0]!.onDate).toBe(W91_DATES[3]);
    expectNear(dbl[0]!.distanceMeters, m(5));
    expect(setTypeOf(result, 'w6')).toBe('easy');
    expectNear(setDistanceOf(result, 'w6'), m(11));
    // Wed NEVER reduced (R0) — and never touched (16 stays 16, no op).
    expect(setDistanceOf(result, 'w2')).toBeNull();

    expectNear(result.recoveredMeters, m(20));
    expect(result.concededMeters).toBeLessThanOrEqual(3);
    expect(result.newTargetMeters).toBeNull();

    // Arrangement describes the whole running week: Q14+16+14+5+11+20+11 = 91.
    expect(Math.abs(arrangedTotal(result) - W91_TARGET)).toBeLessThan(m(0.2));
    const thuPm = result.arrangement.find((r) => r.date === W91_DATES[3] && r.isDouble);
    expectNear(thuPm?.meters, m(5));
  });

  test('T1 keep-rest (§4 SECONDARY): Thu 14+5 · Fri 11 · Sun untouched · 91→80', () => {
    // Same as above minus R3: recovered = 3+2+5−1(trim) = 9, conceded 11 → 91→80.
    const result = reflowWeek(w91Input(1, { 0: 0 }, { useRestDay: false }))!;
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(3);
    expectNear(setDistanceOf(result, 'w3'), m(14));
    expectNear(setDistanceOf(result, 'w4'), m(11));
    expect(addDoubles(result)).toHaveLength(1);
    expect(setTypeOf(result, 'w6')).toBeNull();
    expectNear(result.recoveredMeters, m(9));
    expectNear(result.concededMeters, m(11));
    expectNear(result.newTargetMeters, m(80));
    // Totals hit the adjusted target: 0 + (14+16+14+5+11+20) = 80.
    expect(Math.abs(arrangedTotal(result) - result.newTargetMeters!)).toBeLessThan(m(0.2));
  });

  test('T2 engine half: Mon ran AM only (PM skipped) → extensions + residual closer FULLY recover', () => {
    // Mon ran 14 of 14+6, today Tue. D = 91 − 14 − 71 = 6.
    // R2: Thu +3, Fri +2 (Σ5 ≤ 6 → all). D_rem 1.
    // R4: PM = min(5, 1) = 1 < 0.5·5 = 2.5 → skipped (junk-PM floor).
    // R3: min(12, 1) = 1 < 3 → skipped (junk-run floor). A Sun rest row exists,
    //   so the R2 escalation is skipped too → residual conceded 1 mi.
    // CLOSER (v2.5): 0.5 < 1 mi ≤ CLOSE_THRESHOLD max(1, 0.02·91=1.82)=1.82 →
    //   the 1 mi residual is topped up onto Thu (14→15 shape cap → 16, still
    //   within E=16). FULLY recovered → newTarget null (was 91→90 pre-v2.5).
    const result = reflowWeek(w91Input(1, { 0: m(14) }))!;
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(2);
    expectNear(setDistanceOf(result, 'w3'), m(16));
    expectNear(setDistanceOf(result, 'w4'), m(11));
    expect(addDoubles(result)).toHaveLength(0);
    expect(setTypeOf(result, 'w6')).toBeNull();
    expectNear(result.recoveredMeters, m(6));
    expect(result.concededMeters).toBe(0);
    expect(result.newTargetMeters).toBeNull();
  });

  test('T6: deficit discovered on Saturday → only the rest lever, post-long capped at 12', () => {
    // Mon–Fri all ran short (14+10+12+9+6 = 51), today Sat. Remaining: Sat L20 + Sun R.
    // D = 91 − 51 − 20 = 20. Extensions 0 (no easy day), double 0 (no host).
    // R3: Sun follows the long → cap = min(16, 0.6·20 = 12) → rest = min(12, 20) = 12.
    // recovered 12 · conceded 8 → 91→83 (v2.2.1 post-long cap; was 16/87 pre-amendment).
    const result = reflowWeek(
      w91Input(5, { 0: m(14), 1: m(10), 2: m(12), 3: m(9), 4: m(6) }),
    )!;
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(2);
    expect(setTypeOf(result, 'w6')).toBe('easy');
    expectNear(setDistanceOf(result, 'w6'), m(12));
    // The long itself is untouched.
    expect(setDistanceOf(result, 'w5')).toBeNull();
    expectNear(result.recoveredMeters, m(12));
    expectNear(result.concededMeters, m(8));
    expectNear(result.newTargetMeters, m(83));
    // Keep-rest recovers 0 → feasible false (pure lower_target takes over in R7).
    const keepRest = reflowWeek(
      w91Input(5, { 0: m(14), 1: m(10), 2: m(12), 3: m(9), 4: m(6) }, { useRestDay: false }),
    )!;
    expect(keepRest.feasible).toBe(false);
    expect(keepRest.recoveredMeters).toBe(0);
  });

  test('short25 (eval W91-short25-t3): rest lever FLOORS vs D_rem → Sun rest→3, ≤0.5 mi residue = fully recovered', () => {
    // All of Mon-Wed ran 25% short: Mon 15 of 14+6, Tue 10.5 of 14, Wed 12 of 16.
    // actual = 37.5, today Thu. Remaining: Thu 12 · Fri 9 · Sat L20 · Sun R.
    // D = 91 − 37.5 − 41 = 12.5.
    // R2: Thu round(15)=15 → +3 · Fri round(11.25)=11 → +2 (Σ5 ≤ 12.5 → all). D_rem 7.5.
    // R4: host Thu (Fri pre-long): PM 5; 15+5 = 20 > DTM 19 → trim ext by 1 →
    //   Thu 14+5 = 19. D_rem = 7.5 + 1 − 5 = 3.5.
    // R3 (v2.2.2): Sun post-long cap 12 → val = floor_mi(min(12, 3.5)) = 3 ≥ 3.
    //   (The old round-half-up gave 4 and out-recovered D by 0.5 — eval I5.)
    // recovered = 2+2+5+3 = 12 · conceded 0.5 ≤ 0.5 → fully recovered, newTarget null.
    // qualitySatisfied: the runner ran the Tue quality workout (10.5 of 14) at
    // quality effort — this test exercises the rest-lever FLOOR math, not R5.
    // With the v2.3.1 quality trigger keying off elapsed-and-unmet (not "no
    // activity"), leaving quality unsatisfied here would (correctly) re-place it
    // and change the arithmetic; marking it satisfied keeps this case on-topic.
    const result = reflowWeek(
      w91Input(3, { 0: m(15), 1: m(10.5), 2: m(12) }, { qualitySatisfied: true }),
    )!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    expectNear(setDistanceOf(result, 'w3'), m(14));
    expectNear(setDistanceOf(result, 'w4'), m(11));
    const dbl = addDoubles(result);
    expect(dbl).toHaveLength(1);
    expect(dbl[0]!.onDate).toBe(W91_DATES[3]);
    expectNear(dbl[0]!.distanceMeters, m(5));
    expect(setTypeOf(result, 'w6')).toBe('easy');
    expectNear(setDistanceOf(result, 'w6'), m(3));
    expectNear(result.recoveredMeters, m(12));
    expectNear(result.concededMeters, m(0.5));
    expect(result.newTargetMeters).toBeNull();
    // Invariants: recovered never exceeds D, and accounting balances exactly.
    const D = m(12.5);
    expect(result.recoveredMeters).toBeLessThanOrEqual(D + m(0.2));
    expect(Math.abs(result.recoveredMeters + result.concededMeters - D)).toBeLessThanOrEqual(3);
  });

  test('T7: week with NO rest day (Sun easy 6, target 97) → double lands on Sun, 97→88', () => {
    // Mon 14+6 missed, today Tue. D = 97 − 0 − 77 = 20.
    // R2: Thu +3 → 15 · Fri +2 → 11 · Sun floor(6·1.25 = 7.5)=7 → +1. Σ6. D_rem 14.
    // R4: hosts ≤ M=14 (AMs 14,14,16,12,9,20,6 → median 14), not pre-long:
    //   Thu(12) and Sun(6) → lightest = Sun. PM = min(5, 14) = 5; Sun 7+5 = 12 ≤ 19.
    // R3: no rest day exists → nothing to activate even with useRestDay:true.
    // recovered 11 · conceded 9 → 97→88.
    const defs: DayDef[] = [...W91_DEFS];
    defs[6] = { type: 'easy', planned: m(6), workoutId: 'w6' };
    const target = m(97);
    const result = reflowWeek(w91Input(1, { 0: 0 }, { defs, weekTargetMeters: target }))!;
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(4);
    expectNear(setDistanceOf(result, 'w3'), m(15));
    expectNear(setDistanceOf(result, 'w4'), m(11));
    expectNear(setDistanceOf(result, 'w6'), m(7));
    const dbl = addDoubles(result);
    expect(dbl).toHaveLength(1);
    expect(dbl[0]!.onDate).toBe(W91_DATES[6]);
    expectNear(dbl[0]!.distanceMeters, m(5));
    expectNear(result.recoveredMeters, m(11));
    expectNear(result.concededMeters, m(9));
    expectNear(result.newTargetMeters, m(88));
  });

  test('T8: race week → no doubles, no rest lever, no pre-race extension; only Thu +3', () => {
    // Sat is a RACE (20). Mon 14+6 missed, today Tue. D = 20.
    // R8: Fri (pre-race) gets no extension; doubles and rest activation banned.
    // R2: Wed +0 (at E), Thu +3 → 15. recovered 3 · conceded 17 → 91→74.
    // (R7's ratio rule makes lower_target PRIMARY — that's the caller's job;
    //  the engine still reports feasible since 3 ≥ HYBRID_MIN_ABS 1.82.)
    const defs: DayDef[] = [...W91_DEFS];
    defs[5] = { type: 'race', planned: m(20), workoutId: 'w5' };
    const result = reflowWeek(w91Input(1, { 0: 0 }, { defs }))!;
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(1);
    expectNear(setDistanceOf(result, 'w3'), m(15));
    expect(addDoubles(result)).toHaveLength(0);
    expect(setTypeOf(result, 'w6')).toBeNull();
    expect(setDistanceOf(result, 'w4')).toBeNull(); // Fri pre-race: untouched
    expectNear(result.recoveredMeters, m(3));
    expectNear(result.concededMeters, m(17));
    expectNear(result.newTargetMeters, m(74));
    // The race day itself runs in the arrangement, untouched.
    const race = result.arrangement.find((r) => r.type === 'race');
    expectNear(race?.meters, m(20));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// W35 novice week (study §8b) — plan-relative caps, doubles gate, R5 re-place
// ═════════════════════════════════════════════════════════════════════════════

describe('W35 novice week', () => {
  // Mon rest · Tue e5 · Wed Q6 · Thu e5 · Fri rest · Sat L10 · Sun e9 · target 35.
  // Constants resolve RELATIVE to this plan: L=10 · E=9 · M=median(5,6,5,10,9)=6 ·
  // DAY_TOTAL_MAX = L−1 = 9 · HYBRID_MIN_ABS = max(2%·35, 1) = 1 mi. PM_HABIT null.
  const W35_DEFS: DayDef[] = [
    { type: 'rest',    planned: 0,     workoutId: 'w0' },
    { type: 'easy',    planned: m(5),  workoutId: 'w1' },
    { type: 'quality', planned: m(6),  workoutId: 'w2' },
    { type: 'easy',    planned: m(5),  workoutId: 'w3' },
    { type: 'rest',    planned: 0,     workoutId: 'w4' },
    { type: 'long',    planned: m(10), workoutId: 'w5' },
    { type: 'easy',    planned: m(9),  workoutId: 'w6' },
  ];
  const W35_TARGET = m(35);

  function w35Input(useRestDay: boolean): ReflowInput {
    // Tue ran its 5; Wed quality missed (unsatisfied); today Thu.
    const { weekDays, actualMeters } = buildWeek(W35_DEFS, W91_DATES, 3, { 2: 0 });
    return {
      weekDays,
      weekTargetMeters: W35_TARGET,
      actualMeters, // 5
      qualitySatisfied: false,
      useRestDay,
      pmHabitMeters: null, // novice: no doubling habit → R4 gate closed
      qualityDay: { idx: 2, plannedMeters: m(6), workoutId: 'w2', date: W91_DATES[2]! },
      longDay: { idx: 5, plannedMeters: m(10), workoutId: 'w5', date: W91_DATES[5]! },
    };
  }

  test('quality re-placed on Thu, Sun capped by E=9 (no extension), rest lever finishes it', () => {
    // D = 35 − 5 − (5+0+10+9) = 6.
    // R5: safe easy slots = Thu (5, neighbors Wed-missed + Fri-rest) — Sun is
    //   adjacent to the Sat long → excluded. Thu → Q6 at planned quality distance.
    //   Credit = 6−5 = +1. D_rem 5.
    // R9: day after Thu is Fri (rest) → no swap.
    // R2: only easy day left is Sun 9: min(floor(9·1.25)=11, E=9, DTM=9) − 9 = 0 → nothing.
    // R4: PM_HABIT null → NO double may ever appear (gate).
    // R3: Fri rest (prev day = Thu quality, NOT long → full cap E=9) → min(9, 5) = 5 ≥ 3.
    // recovered 1+5 = 6 = D → fully recovered.
    const result = reflowWeek(w35Input(true))!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(4);
    expect(setTypeOf(result, 'w3')).toBe('quality');
    expectNear(setDistanceOf(result, 'w3'), m(6));
    expect(setTypeOf(result, 'w4')).toBe('easy');
    expectNear(setDistanceOf(result, 'w4'), m(5));
    // Gate: no double is EVER proposed for a runner without the habit.
    expect(addDoubles(result)).toHaveLength(0);
    expect(result.arrangement.some((r) => r.isDouble)).toBe(false);
    // Sun untouched at 9 (headroom 0 under the plan-relative E cap).
    expect(setDistanceOf(result, 'w6')).toBeNull();
    expectNear(result.recoveredMeters, m(6));
    expect(result.newTargetMeters).toBeNull();
    // Arranged (Q6 + 5 + L10 + 9 = 30) + actual 5 = 35.
    expect(Math.abs(arrangedTotal(result) + m(5) - W35_TARGET)).toBeLessThan(m(0.2));
  });

  test('miss2 (eval W35-miss2-TueWed-t3): PRE-long cap 0.6×L → Fri rest activates at 6, not 9', () => {
    // Tue e5 AND Wed Q6 missed (quality unsatisfied), today Thu. actual = 0.
    // Remaining: Thu e5 · Fri R · Sat L10 · Sun e9. D = 35 − 0 − 24 = 11.
    // R5: safe easy slot = Thu (Wed neighbor missed, Fri rest); Sun is adjacent
    //   to the Sat long → excluded. Thu → Q6, credit +1. D_rem 10.
    // R9: day after Thu is Fri (rest) → no swap.
    // R2: only easy day is Sun 9 → min(round(11.25)=11, E=9, DTM=9) − 9 = 0.
    // R4: pmHabit null → no double.
    // R3 (v2.2.2): Fri rest immediately PRECEDES the Sat long → cap tightens to
    //   min(E 9, DTM 9, 0.6×10 = 6) = 6 → val = floor(min(6, 10)) = 6 ≥ 3.
    //   (Pre-amendment the cap was min(9, 9) and Fri activated at 9 the day
    //   before a 10-mi novice long — the eval-grid near-miss.)
    // recovered 1+6 = 7 · conceded 4 → newTarget 35−4 = 31.
    const { weekDays, actualMeters } = buildWeek(W35_DEFS, W91_DATES, 3, { 1: 0, 2: 0 });
    const result = reflowWeek({
      weekDays,
      weekTargetMeters: W35_TARGET,
      actualMeters, // 0
      qualitySatisfied: false,
      useRestDay: true,
      pmHabitMeters: null,
      qualityDay: { idx: 2, plannedMeters: m(6), workoutId: 'w2', date: W91_DATES[2]! },
      longDay: { idx: 5, plannedMeters: m(10), workoutId: 'w5', date: W91_DATES[5]! },
    })!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(4);
    // Thu hosts the re-placed quality at its planned 6.
    expect(setTypeOf(result, 'w3')).toBe('quality');
    expectNear(setDistanceOf(result, 'w3'), m(6));
    // Fri rest activates AT THE PRE-LONG CAP: 0.6 × 10 = 6, never 9.
    expect(setTypeOf(result, 'w4')).toBe('easy');
    expectNear(setDistanceOf(result, 'w4'), m(6));
    // Sun untouched at 9 (zero headroom under E=9).
    expect(setDistanceOf(result, 'w6')).toBeNull();
    expectNear(result.recoveredMeters, m(7));
    expectNear(result.concededMeters, m(4));
    expectNear(result.newTargetMeters, m(31));
    // Arranged (Q6 + 6 + L10 + 9 = 31) + actual 0 = newTarget 31.
    expect(Math.abs(arrangedTotal(result) - result.newTargetMeters!)).toBeLessThan(m(0.2));
  });

  test('keep-rest: only the re-place credit (+1) recovers; 1 ≥ HYBRID_MIN_ABS=1 is INCLUSIVE', () => {
    // Same but useRestDay:false → recovered = credit 1 only; conceded 5 → 35→30.
    // HYBRID_MIN_ABS = max(0.02·35 = 0.7, 1) = 1 mi → recovered 1 passes (inclusive ≥).
    const result = reflowWeek(w35Input(false))!;
    expect(result.ops).toHaveLength(2);
    expect(setTypeOf(result, 'w3')).toBe('quality');
    expectNear(setDistanceOf(result, 'w3'), m(6));
    expect(setTypeOf(result, 'w4')).toBeNull();
    expectNear(result.recoveredMeters, m(1));
    expectNear(result.concededMeters, m(5));
    expectNear(result.newTargetMeters, m(30));
    expect(result.feasible).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// R2 v2.2.2 — extension headroom ROUNDS to the nearest mile (ties down)
// ═════════════════════════════════════════════════════════════════════════════

describe('R2 extension rounding (v2.2.2)', () => {
  test('headroom fractions: .75 up (3→4), .25 down (9→11), exact .5 down (10→12)', () => {
    // Beginner 3 mi day (W20 caps E=4, DTM=5): 3 × 1.25 = 3.75 ROUNDS to 4 →
    // +1 headroom. Under the old floor this was 3 → zero headroom (eval grid:
    // "W20 extensions never fire").
    expectNear(extensionHeadroom(m(3), m(4), m(5)), m(1));
    // Owner-week 9 mi day (W91 caps E=16, DTM=19): 11.25 rounds DOWN to 11 →
    // +2, exactly as before — the owner's week must not move.
    expectNear(extensionHeadroom(m(9), m(16), m(19)), m(2));
    // Exact half stays DOWN: 10 × 1.25 = 12.5 → 12 → +2 (legacy corpus
    // unchanged; round-half-up would have leaked +3 into every 10 mi day).
    expectNear(extensionHeadroom(m(10), m(16), m(23)), m(2));
    // Caps still bind after rounding: 4 × 1.25 = 5 but E=4 → zero headroom.
    expect(extensionHeadroom(m(4), m(4), m(5))).toBe(0);
  });
});

test('W20 beginner week (eval W20-miss-Tue-t2 shape): the 3 mi Fri can now extend to 4', () => {
  // Mon R(row) · Tue e3 · Wed e4 · Thu R(row) · Fri e3 · Sat L6 · Sun e4 · target 20.
  // Constants: L=6 · E=4 · M=median(3,4,3,6,4)=4 · DTM=5 · HYBRID_MIN_ABS=1.
  // Tue e3 missed, today Wed. actual 0. D = 20 − 0 − (4+0+3+6+4) = 3.
  // R2 (v2.2.2): Wed 4 → min(round(5)=5, E=4) − 4 = 0 · Fri 3 → min(round(3.75)=4,
  //   4, 5) − 3 = +1 (was 0 under floor) · Sun 4 → 0. Σ1 ≤ 3 → Fri 4. D_rem 2.
  // R4: pmHabit null. R3: Thu rest → val = floor(min(cap 4, 2)) = 2 < 3 → junk gate.
  // recovered 1 · conceded 2 → newTarget 18.
  const DEFS: DayDef[] = [
    { type: 'rest', planned: 0,    workoutId: 'w0' },
    { type: 'easy', planned: m(3), workoutId: 'w1' },
    { type: 'easy', planned: m(4), workoutId: 'w2' },
    { type: 'rest', planned: 0,    workoutId: 'w3' },
    { type: 'easy', planned: m(3), workoutId: 'w4' },
    { type: 'long', planned: m(6), workoutId: 'w5' },
    { type: 'easy', planned: m(4), workoutId: 'w6' },
  ];
  const { weekDays, actualMeters } = buildWeek(DEFS, W91_DATES, 2, { 1: 0 });
  const result = reflowWeek({
    weekDays,
    weekTargetMeters: m(20),
    actualMeters, // 0
    qualitySatisfied: true,
    useRestDay: true,
    pmHabitMeters: null,
    longDay: { idx: 5, plannedMeters: m(6), workoutId: 'w5', date: W91_DATES[5]! },
  })!;
  expect(result).not.toBeNull();
  expect(result.feasible).toBe(true);
  // THE amendment: a beginner 3 mi day extends to 4 (3.75 rounds up).
  expectNear(setDistanceOf(result, 'w4'), m(4));
  // Wed and Sun stay at 4 (5.0 hits the E cap → zero headroom).
  expect(setDistanceOf(result, 'w2')).toBeNull();
  expect(setDistanceOf(result, 'w6')).toBeNull();
  // Thu rest is NOT activated (remainder 2 < 3 mi junk gate).
  expect(setTypeOf(result, 'w3')).toBeNull();
  expect(result.ops).toHaveLength(1);
  expectNear(result.recoveredMeters, m(1));
  expectNear(result.concededMeters, m(2));
  expectNear(result.newTargetMeters, m(18));
});

// ═════════════════════════════════════════════════════════════════════════════
// R3 — rest-lever base cap is min(E, DTM): low-volume degenerate plan (E ≥ L)
// ═════════════════════════════════════════════════════════════════════════════

test('R3 low-volume week with E ≥ L: rest activation capped at L−1, never at E', () => {
  // Week: Mon e7 · Tue e5 · Wed rest(row) · Thu e4 · Fri e6 · Sat L7 · Sun rest(row).
  // Target 29. Constants: L=7 · E=7 (Mon) · M=median(7,5,4,6,7)=6 · DTM = L−1 = 6.
  // Miss Mon+Tue, today Wed. actual 0. D = 29 − 0 − (0+4+6+7+0) = 12.
  // R2: Thu 4 → min(floor(5)=5, E=7, DTM=6) − 4 = +1; Fri is pre-long → excluded.
  //   D_rem 11.
  // R4: pmHabit null → no double.
  // R3: candidates Wed (prev Tue easy → base cap min(E 7, DTM 6) = 6 → val 6)
  //   and Sun (post-long → cap min(7, 6, 0.6·7=4.2) → val 4). Best = Wed at 6 —
  //   with an E-only cap it would activate at 7 = L, out-sizing the long run.
  // recovered 1+6 = 7 · conceded 5 → 29→24.
  const DEFS: DayDef[] = [
    { type: 'easy', planned: m(7), workoutId: 'w0' },
    { type: 'easy', planned: m(5), workoutId: 'w1' },
    { type: 'rest', planned: 0,    workoutId: 'w2' },
    { type: 'easy', planned: m(4), workoutId: 'w3' },
    { type: 'easy', planned: m(6), workoutId: 'w4' },
    { type: 'long', planned: m(7), workoutId: 'w5' },
    { type: 'rest', planned: 0,    workoutId: 'w6' },
  ];
  const { weekDays, actualMeters } = buildWeek(DEFS, W91_DATES, 2, { 0: 0, 1: 0 });
  const result = reflowWeek({
    weekDays,
    weekTargetMeters: m(29),
    actualMeters, // 0
    qualitySatisfied: true,
    useRestDay: true,
    pmHabitMeters: null,
    longDay: { idx: 5, plannedMeters: m(7), workoutId: 'w5', date: W91_DATES[5]! },
  })!;
  expect(result).not.toBeNull();
  expect(result.feasible).toBe(true);
  expectNear(setDistanceOf(result, 'w3'), m(5));
  expect(setTypeOf(result, 'w2')).toBe('easy');
  // The activated rest day lands at 6 = L − 1, NOT at E = 7.
  expectNear(setDistanceOf(result, 'w2'), m(6));
  // Sun stays rest (only one rest day activates).
  expect(setTypeOf(result, 'w6')).toBeNull();
  expectNear(result.recoveredMeters, m(7));
  expectNear(result.concededMeters, m(5));
  expectNear(result.newTargetMeters, m(24));
});

// ═════════════════════════════════════════════════════════════════════════════
// R9 — sequencing swap after a re-placed quality session
// ═════════════════════════════════════════════════════════════════════════════

test('R9: quality re-placed on Wed → heavy Thu swaps with light Fri; extensions post-swap', () => {
  // Week: Mon e8 · Tue Q10 · Wed e10 · Thu e12 · Fri e6 · Sat L16 · Sun rest. Target 62.
  // Constants: L=16 · E=12 · M=median(8,10,10,12,6,16)=10 · DTM=15.
  // Mon ran 8; Tue quality missed (unsatisfied); today Wed. D = 62 − 8 − 44 = 10.
  // R5: safe easy = Wed(10), Thu(12) (Fri adjacent to long). |10−10|=0 → Wed → Q10.
  //   Credit 0 (distance unchanged → setType only, no setDistance for Wed).
  // R9: day after Wed = Thu(12) > lightest other easy Fri(6) → SWAP: Thu 6 · Fri 12.
  // R2 (post-swap values!): Thu 6 → floor(7.5)=7 → +1; Fri 12 → min(15, E=12) → +0.
  //   D_rem 10 ≥ Σ1 → Thu 7. recovered = 0 (swap net-zero) + 1 = 1.
  // conceded 9 → 62→53. feasible: 1 < max(2%·62 = 1.24, 1) → FALSE (cosmetic recovery).
  const DEFS: DayDef[] = [
    { type: 'easy',    planned: m(8),  workoutId: 'w0' },
    { type: 'quality', planned: m(10), workoutId: 'w1' },
    { type: 'easy',    planned: m(10), workoutId: 'w2' },
    { type: 'easy',    planned: m(12), workoutId: 'w3' },
    { type: 'easy',    planned: m(6),  workoutId: 'w4' },
    { type: 'long',    planned: m(16), workoutId: 'w5' },
    { type: 'rest',    planned: 0,     workoutId: 'w6' },
  ];
  const { weekDays, actualMeters } = buildWeek(DEFS, W91_DATES, 2, { 1: 0 });
  const result = reflowWeek({
    weekDays,
    weekTargetMeters: m(62),
    actualMeters, // 8
    qualitySatisfied: false,
    useRestDay: false,
    pmHabitMeters: null,
    qualityDay: { idx: 1, plannedMeters: m(10), workoutId: 'w1', date: W91_DATES[1]! },
    longDay: { idx: 5, plannedMeters: m(16), workoutId: 'w5', date: W91_DATES[5]! },
  })!;
  expect(result).not.toBeNull();

  // Quality landed on Wed at its planned 10 → type change only.
  expect(setTypeOf(result, 'w2')).toBe('quality');
  expect(setDistanceOf(result, 'w2')).toBeNull();

  // The swap: Thu 12→6(+1 ext = 7), Fri 6→12 — net-zero, both flagged.
  expectNear(setDistanceOf(result, 'w3'), m(7));
  expectNear(setDistanceOf(result, 'w4'), m(12));
  const thu = result.arrangement.find((r) => r.date === W91_DATES[3] && !r.isDouble);
  const fri = result.arrangement.find((r) => r.date === W91_DATES[4] && !r.isDouble);
  expect(thu?.swappedWith).toBe(W91_DATES[4]);
  expect(fri?.swappedWith).toBe(W91_DATES[3]);

  expect(result.ops).toHaveLength(3);
  expectNear(result.recoveredMeters, m(1));
  expectNear(result.concededMeters, m(9));
  expectNear(result.newTargetMeters, m(53));
  expect(result.feasible).toBe(false);

  // Totals: 8 actual + (Q10 + 7 + 12 + L16 = 45) = 53 = newTarget.
  expect(Math.abs(actualMeters + arrangedTotal(result) - result.newTargetMeters!)).toBeLessThan(
    m(0.2),
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// v2.3 amendments (panel round 1) — R6 re-place rewrite, R8 race weeks,
// R2 last-lever escalation, R5 slot-opening swap
// ═════════════════════════════════════════════════════════════════════════════

describe('v2.3 amendments', () => {
  // W50 intermediate template (study §8b):
  // Mon e6 · Tue Q8 · Wed e7 · Thu e6 · Fri e5 · Sat L14 · Sun e4 · target 50.
  // Constants: L=14 · E=7 · M=median(6,8,7,6,5,14,4)=6 · DTM=13 ·
  // HYBRID_MIN_ABS = max(2%·50, 1) = 1 mi. No rest days, pmHabit null.
  const W50_DEFS: DayDef[] = [
    { type: 'easy',    planned: m(6),  workoutId: 'w0' },
    { type: 'quality', planned: m(8),  workoutId: 'w1' },
    { type: 'easy',    planned: m(7),  workoutId: 'w2' },
    { type: 'easy',    planned: m(6),  workoutId: 'w3' },
    { type: 'easy',    planned: m(5),  workoutId: 'w4' },
    { type: 'long',    planned: m(14), workoutId: 'w5' },
    { type: 'easy',    planned: m(4),  workoutId: 'w6' },
  ];

  function w50Input(
    todayIdx: number,
    acts: Partial<Record<number, number>>,
    opts: { qualitySatisfied?: boolean; useRestDay?: boolean } = {},
  ): ReflowInput {
    const { weekDays, actualMeters } = buildWeek(W50_DEFS, W91_DATES, todayIdx, acts);
    return {
      weekDays,
      weekTargetMeters: m(50),
      actualMeters,
      qualitySatisfied: opts.qualitySatisfied ?? false,
      useRestDay: opts.useRestDay ?? true,
      pmHabitMeters: null,
      qualityDay: { idx: 1, plannedMeters: m(8), workoutId: 'w1', date: W91_DATES[1]! },
      longDay: { idx: 5, plannedMeters: m(14), workoutId: 'w5', date: W91_DATES[5]! },
    };
  }

  test('W50-missLong-t6 (R6 v2.3): Sun e4 hosts the FULL L14, flagged, week 50→46', () => {
    // Mon-Fri ran to plan (32), Sat L14 missed, today Sun. D = 50−32−4 = 14.
    // R6 v2.3: eligibility no longer requires slot ≥ 0.5×L. Host = latest
    // remaining easy day = Sun e4 (Sat neighbor was MISSED → never blocks;
    // day total 14 ≤ L). Zero-run streak before Sun = 1 (Sat only; Fri ran)
    // ≤ 2 → FULL 14. slotPlanned 4 < 0.5·14 = 7 → longReplaceFlagged (opt-in
    // "Long today" read — the runner decides about time, not the engine).
    // Credit 14−4 = 10; nothing else remains to extend → conceded 4 → 50→46.
    const result = reflowWeek(w50Input(6, { 5: 0 }, { qualitySatisfied: true }))!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    expect(setTypeOf(result, 'w6')).toBe('long');
    expectNear(setDistanceOf(result, 'w6'), m(14));
    expect(result.ops).toHaveLength(2);
    expect(result.longReplaceFlagged).toBe(true);
    const long = result.arrangement.find((r) => r.type === 'long');
    expect(long?.date).toBe(W91_DATES[6]);
    expectNear(long?.meters, m(14));
    expectNear(result.recoveredMeters, m(10));
    expectNear(result.concededMeters, m(4));
    expectNear(result.newTargetMeters, m(46));
  });

  test('W50-miss3-Thu-Sat-t6 (R6 v2.3): ≥3 zero-run days → medium-long round_mi(0.8×14) = 11', () => {
    // Mon-Wed ran (21); Thu, Fri AND Sat all missed; today Sun. D = 50−21−4 = 25.
    // Host = Sun e4 again, but the zero-run streak before Sun is 3 (Sat, Fri,
    // Thu — all past with no activity) ≥ 3 → the salvage long trims to
    // round_mi(0.8·14 = 11.2) = 11. Still flagged (4 < 7). Credit 11−4 = 7;
    // conceded 18 → 50→32.
    const result = reflowWeek(w50Input(6, { 3: 0, 4: 0, 5: 0 }, { qualitySatisfied: true }))!;
    expect(result).not.toBeNull();
    expect(setTypeOf(result, 'w6')).toBe('long');
    expectNear(setDistanceOf(result, 'w6'), m(11));
    expect(result.longReplaceFlagged).toBe(true);
    expectNear(result.recoveredMeters, m(7));
    expectNear(result.concededMeters, m(18));
    expectNear(result.newTargetMeters, m(32));
  });

  test('R5 slot-opening swap (v2.3): no safe slot → long Sat⇄Sun opens Fri for the quality', () => {
    // Tue Q8 missed (unsatisfied); Mon/Wed/Thu ran (19); today Fri.
    // Remaining: Fri e5 · Sat L14 · Sun e4. D = 50−19−23 = 8.
    // R5: Fri and Sun are both long-adjacent, no rest day → pre-v2.3 this
    // CONCEDED quality. v2.3 slot-opening swap: exchange Sat L14 ⇄ Sun e4
    // (Sun total 14 ≤ L; the moved long has no hard neighbor) → Fri (Thu ran
    // easy · Sat now e4) becomes eligible → Q8 lands on Fri (credit +3).
    // R9 is skipped (one-swap budget). R2 post-swap: Sat 4 → +1 (min(round(5),
    // E 7, DTM 13) − 4). No PM/rest lever → v2.3 escalation: latest easy Sat
    // is adjacent to the Sun long → cap min(E 7, DTM 13, 0.6·14 = 8.4) = 7 →
    // Sat 7 (+2 more). Recovered 3+1+2 = 6 · conceded 2 → 50→48.
    const result = reflowWeek(w50Input(4, { 1: 0 }))!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    // Quality on Fri at its planned 8.
    expect(setTypeOf(result, 'w4')).toBe('quality');
    expectNear(setDistanceOf(result, 'w4'), m(8));
    // The swap: Sat becomes easy 7 (4 + 3 ext), Sun becomes the long 14.
    expect(setTypeOf(result, 'w5')).toBe('easy');
    expectNear(setDistanceOf(result, 'w5'), m(7));
    expect(setTypeOf(result, 'w6')).toBe('long');
    expectNear(setDistanceOf(result, 'w6'), m(14));
    expect(result.ops).toHaveLength(6);
    const sat = result.arrangement.find((r) => r.date === W91_DATES[5] && !r.isDouble);
    const sun = result.arrangement.find((r) => r.date === W91_DATES[6] && !r.isDouble);
    expect(sat?.swappedWith).toBe(W91_DATES[6]);
    expect(sun?.swappedWith).toBe(W91_DATES[5]);
    // Not an R6 re-place: the long moved by SWAP, no flag.
    expect(result.longReplaceFlagged).toBe(false);
    expectNear(result.recoveredMeters, m(6));
    expectNear(result.concededMeters, m(2));
    expectNear(result.newTargetMeters, m(48));
  });

  // W70 advanced template (study §8b):
  // Mon e10 · Tue Q11 · Wed e12 · Thu e8 · Fri e7 · Sat L18 · Sun e4 · target 70.
  // Constants: L=18 · E=12 · M=median(10,11,12,8,7,18,4)=10 · DTM=17.
  const W70_DEFS: DayDef[] = [
    { type: 'easy',    planned: m(10), workoutId: 'w0' },
    { type: 'quality', planned: m(11), workoutId: 'w1' },
    { type: 'easy',    planned: m(12), workoutId: 'w2' },
    { type: 'easy',    planned: m(8),  workoutId: 'w3' },
    { type: 'easy',    planned: m(7),  workoutId: 'w4' },
    { type: 'long',    planned: m(18), workoutId: 'w5' },
    { type: 'easy',    planned: m(4),  workoutId: 'w6' },
  ];

  test('W70-miss-Fri-t5 (R2 v2.3 last lever): Sun 4 → 10 under the post-long 0.6×18 bound', () => {
    // Mon-Thu ran (41), Fri e7 missed, today Sat. Remaining: Sat L18 · Sun e4.
    // D = 70−41−22 = 7. R2: Sun +1 → 5 (round(5) caps the 1.25). No doubles
    // (habit null), NO rest day in the whole week → pre-v2.3 the engine
    // conceded 6 of 7. v2.3 escalation: the LATEST (only) remaining easy day
    // extends past the shape cap up to min(E 12, DTM 17, 0.6·18 = 10.8 —
    // Sun is adjacent to the long) → floor_mi(10.8) → Sun 10 (+5 more), leaving
    // a 1 mi residual. CLOSER (v2.5): 0.5 < 1 mi ≤ CLOSE_THRESHOLD max(1,
    // 0.02·70=1.4)=1.4 → the residual tops Sun up 10→11 (a slight nudge past
    // 0.6·18) → FULLY recovered, newTarget null (was 70→69 pre-v2.5).
    const { weekDays, actualMeters } = buildWeek(W70_DEFS, W91_DATES, 5, { 4: 0 });
    const result = reflowWeek({
      weekDays,
      weekTargetMeters: m(70),
      actualMeters, // 41
      qualitySatisfied: true,
      useRestDay: true,
      pmHabitMeters: null,
      qualityDay: { idx: 1, plannedMeters: m(11), workoutId: 'w1', date: W91_DATES[1]! },
      longDay: { idx: 5, plannedMeters: m(18), workoutId: 'w5', date: W91_DATES[5]! },
    })!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    expect(result.ops).toHaveLength(1);
    expectNear(setDistanceOf(result, 'w6'), m(11));
    // The long itself is untouched; Sun stays an easy day (no type op).
    expect(setDistanceOf(result, 'w5')).toBeNull();
    expect(setTypeOf(result, 'w6')).toBeNull();
    expectNear(result.recoveredMeters, m(7));
    expect(result.concededMeters).toBe(0);
    expect(result.newTargetMeters).toBeNull();
  });

  test('W70-race-missQ-t2 (R8 v2.3): Q re-placed ≥3 days pre-race at 0.6×11 = 7; post-race Sun frozen; no swaps', () => {
    // Race-week variant: Sat = race 18. Tue Q11 missed (unsatisfied), today
    // Wed. actual = 10 (Mon). Remaining: Wed e12 · Thu e8 · Fri e7 · Sat race
    // 18 · Sun e4. D = 70−10−49 = 11. Constants unchanged (L falls back to the
    // largest planned day = 18).
    // R5 race override: eligible slots need ≥ 3 days pre-race → only Wed
    // (5−2 = 3; Thu is 2 days out) — the search maximizes days-to-race — and
    // the session trims to round_mi(0.6·11 = 6.6) = 7 (tune-up size). Credit
    // 7−12 = −5. R9/slot-swaps disabled in race weeks. R2: Thu +2 → 10; Fri
    // is pre-race (no extension); Sun is POST-RACE → cap-frozen at plan (no
    // lever may raise it; pre-v2.3 it took +1). No doubles/rest/escalation in
    // a race week. Recovered −5+2 = −3 · conceded 14 → 70→56; feasible false
    // (the caller's R7 session-value exemption keeps the card alive).
    const defs: DayDef[] = [...W70_DEFS];
    defs[5] = { type: 'race', planned: m(18), workoutId: 'w5' };
    const { weekDays, actualMeters } = buildWeek(defs, W91_DATES, 2, { 1: 0 });
    const result = reflowWeek({
      weekDays,
      weekTargetMeters: m(70),
      actualMeters, // 10
      qualitySatisfied: false,
      useRestDay: true,
      pmHabitMeters: null,
      qualityDay: { idx: 1, plannedMeters: m(11), workoutId: 'w1', date: W91_DATES[1]! },
    })!;
    expect(result).not.toBeNull();
    // Wed hosts the tune-up quality at 7 (typed R5 exception to R0).
    expect(setTypeOf(result, 'w2')).toBe('quality');
    expectNear(setDistanceOf(result, 'w2'), m(7));
    // Thu extends within R2; Fri (pre-race) and Sun (post-race) are untouched.
    expectNear(setDistanceOf(result, 'w3'), m(10));
    expect(setDistanceOf(result, 'w4')).toBeNull();
    expect(setDistanceOf(result, 'w6')).toBeNull();
    expect(result.ops).toHaveLength(3);
    // No swap machinery anywhere in a race week.
    expect(result.arrangement.every((r) => r.swappedWith === undefined)).toBe(true);
    const q = result.arrangement.find((r) => r.type === 'quality');
    expect(q?.date).toBe(W91_DATES[2]);
    expectNear(q?.meters, m(7));
    expectNear(result.recoveredMeters, m(-3));
    expectNear(result.concededMeters, m(14));
    expectNear(result.newTargetMeters, m(56));
    expect(result.feasible).toBe(false);
  });

  test('R6 v2.3: the remaining day right after a re-placed long caps at 0.6×L (extension denied)', () => {
    // Custom week: Mon e10 · Tue e5 · Wed L14 · Thu e6 · Fri e8 · Sat Q8 ·
    // Sun R(row) · target 51. Constants: L=14 · E=10 · M=median(10,5,14,6,8,8)
    // = 8 · DTM=13. Mon+Tue ran (15), Wed long missed, today Thu.
    // D = 51−15−22 = 14.
    // R6: host candidates — Thu ✓ (Wed neighbor missed, Fri easy); Fri ✗
    // (adjacent to the Sat quality); latest eligible = Thu. Streak = 1 → full
    // L14 (flagged: 6 < 7). Credit 8. R9: no other easy day → no swap.
    // R2: Fri would take +2 (round(10) ∧ E ∧ DTM = 10) but it now sits right
    // AFTER the re-placed long → whole-mile allowance under 0.6·14 = 8.4 is
    // floor(0.4) = 0 → Fri untouched (the generalized post-long cap).
    // R3: Sun rest (prev = Sat quality, not long) → min(E 10, DTM 13, D_rem 6)
    // = 6 ≥ 3 → rest→6. Fully recovered (8+6 = 14) → newTarget null.
    const DEFS: DayDef[] = [
      { type: 'easy',    planned: m(10), workoutId: 'w0' },
      { type: 'easy',    planned: m(5),  workoutId: 'w1' },
      { type: 'long',    planned: m(14), workoutId: 'w2' },
      { type: 'easy',    planned: m(6),  workoutId: 'w3' },
      { type: 'easy',    planned: m(8),  workoutId: 'w4' },
      { type: 'quality', planned: m(8),  workoutId: 'w5' },
      { type: 'rest',    planned: 0,     workoutId: 'w6' },
    ];
    const { weekDays, actualMeters } = buildWeek(DEFS, W91_DATES, 3, { 2: 0 });
    const result = reflowWeek({
      weekDays,
      weekTargetMeters: m(51),
      actualMeters, // 15
      qualitySatisfied: true,
      useRestDay: true,
      pmHabitMeters: null,
      longDay: { idx: 2, plannedMeters: m(14), workoutId: 'w2', date: W91_DATES[2]! },
    })!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    // Thu hosts the full re-placed long.
    expect(setTypeOf(result, 'w3')).toBe('long');
    expectNear(setDistanceOf(result, 'w3'), m(14));
    expect(result.longReplaceFlagged).toBe(true);
    // THE assertion: Fri (day after the re-placed long) gets NO extension.
    expect(setDistanceOf(result, 'w4')).toBeNull();
    // Sun rest carries the remainder instead.
    expect(setTypeOf(result, 'w6')).toBe('easy');
    expectNear(setDistanceOf(result, 'w6'), m(6));
    expect(result.ops).toHaveLength(4);
    expectNear(result.recoveredMeters, m(14));
    expect(result.newTargetMeters).toBeNull();
  });
});

// =============================================================================
// v2.3.1 fixes (review M1/m2/m3)
// =============================================================================

describe('v2.3.1 - zero-run streak counts today/future rest days (m2)', () => {
  // Mon e6 ran, Tue e6 ran, Wed L14 MISSED, Thu e6 MISSED, Fri rest (row,
  // today), Sat e8, Sun rest (row-less -> not a host). Host = Sat.
  // Streak before Sat: Fri (today, planned rest -> cannot run) + Thu (missed)
  // + Wed (missed) = 3 -> salvage round_mi(0.8 x 14) = 11.2 -> 11.
  // Pre-fix the walk broke at Fri (not a past day) -> streak 0 -> full 14.
  const DATES = ['2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-21'];
  const DEFS: DayDef[] = [
    { type: 'easy', planned: m(6),  workoutId: 'z0' },
    { type: 'easy', planned: m(6),  workoutId: 'z1' },
    { type: 'long', planned: m(14), workoutId: 'z2' },
    { type: 'easy', planned: m(6),  workoutId: 'z3' },
    { type: 'rest', planned: 0,     workoutId: 'z4' },
    { type: 'easy', planned: m(8),  workoutId: 'z5' },
    { type: 'rest', planned: 0,     workoutId: null },
  ];
  const TGT = m(40); // 6+6+14+6+8 = 40 planned run miles

  test('host after a planned-rest today gets the 0.8L salvage, not full L', () => {
    const { weekDays, actualMeters } = buildWeek(DEFS, DATES, 4, { 2: 0, 3: 0 });
    const r = reflowWeek({
      weekDays,
      weekTargetMeters: TGT,
      actualMeters, // Mon+Tue = 12mi
      qualitySatisfied: true,
      useRestDay: false,
      pmHabitMeters: null,
      longDay: { idx: 2, plannedMeters: m(14), workoutId: 'z2', date: DATES[2]! },
    });
    expect(r).not.toBeNull();
    // Sat hosts the salvage long at round_mi(0.8 x 14 = 11.2) = 11, not 14.
    expect(setTypeOf(r!, 'z5')).toBe('long');
    expectNear(setDistanceOf(r!, 'z5'), m(11));
    expect(r!.longReplaced).not.toBeNull();
    expectNear(r!.longReplaced!.meters, m(11));
    expect(r!.longReplaced!.date).toBe(DATES[5]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// v2.5 residual closer — a SMALL leftover reaches the FULL target; a LARGE
// deficit still concedes honestly. CLOSE_THRESHOLD = max(1 mi, 2% of target).
// ═════════════════════════════════════════════════════════════════════════════

describe('v2.5 residual closer', () => {
  // RC week: Mon e8 · Tue e6 · Wed e6 · Thu e6 · Fri e6 · Sat L10 · Sun rest(row).
  // Target 42. Constants: L=10 · E=8 · M=median(8,6,6,6,6,10)=6 · DTM=9 ·
  // CLOSE_THRESHOLD = max(1, 0.02·42 = 0.84) = 1 mi. pmHabit null (no double).
  const RC_DEFS: DayDef[] = [
    { type: 'easy', planned: m(8), workoutId: 'w0' },
    { type: 'easy', planned: m(6), workoutId: 'w1' },
    { type: 'easy', planned: m(6), workoutId: 'w2' },
    { type: 'easy', planned: m(6), workoutId: 'w3' },
    { type: 'easy', planned: m(6), workoutId: 'w4' },
    { type: 'long', planned: m(10), workoutId: 'w5' },
    { type: 'rest', planned: 0, workoutId: 'w6' },
  ];
  const RC_TARGET = m(42);
  const RC_LONG = { idx: 5, plannedMeters: m(10), workoutId: 'w5', date: W91_DATES[5]! };

  test('small ~1 mi residual is topped up to FULL recovery (max variant)', () => {
    // Today Thu. Mon+Tue ran to plan; Wed ran SHORT (3 of 6, hasActivity → NOT
    // a missed day). actual = 8+6+3 = 17. Remaining Thu6·Fri6·Sat L10·Sun rest.
    // D = 42 − 17 − 22 = 3.
    // R2: Thu 6 → min(round(7.5)=7, E8, DTM9) − 6 = +1 → 7; Fri 6 (pre-long) → +1
    //   → 7. Σ2; D_rem 3 ≥ 2 → take all → D_rem 1.
    // R4: pmHabit null. R3: Sun post-long cap min(8,9,0.6·10=6)=6 → val
    //   floor(min(6,1))=1 < 3 → junk gate, stays rest. R2 escalation: a rest row
    //   exists (Sun) → skipped. recovered 2 → residual conceded 1 mi.
    // CLOSER (v2.5): 0.5 < 1 mi ≤ CLOSE_THRESHOLD → top up. Fri is already past
    //   its adjacent-long 0.6·10=6 cap (at 7) → no slack; Thu has 1 mi of slack
    //   to E=8 → Thu 7 → 8. recovered 3 = D → FULLY recovered, newTarget null.
    const { weekDays, actualMeters } = buildWeek(RC_DEFS, W91_DATES, 3, { 2: m(3) });
    const result = reflowWeek({
      weekDays,
      weekTargetMeters: RC_TARGET,
      actualMeters, // 17
      qualitySatisfied: true,
      useRestDay: true,
      pmHabitMeters: null,
      longDay: RC_LONG,
    })!;
    expect(result).not.toBeNull();
    expect(result.feasible).toBe(true);
    // Thu absorbs the 1 mi residual (7 → 8, a modest step past the +25% shape
    // cap of 7, still within E=8); Fri keeps its +25% extension at 7.
    expectNear(setDistanceOf(result, 'w3'), m(8));
    expectNear(setDistanceOf(result, 'w4'), m(7));
    // Sun rest never activates (residual was closed on an easy day, not here).
    expect(setTypeOf(result, 'w6')).toBeNull();
    // Full recovery — the whole point of the closer.
    expectNear(result.recoveredMeters, m(3));
    expect(result.concededMeters).toBe(0);
    expect(result.newTargetMeters).toBeNull();
    // Never over-recovers: recovered lands exactly on the deficit.
    expect(result.recoveredMeters).toBeLessThanOrEqual(m(3) + 3);
    // Arrangement + actual hits the ORIGINAL target (42), not a conceded one.
    expect(Math.abs(actualMeters + arrangedTotal(result) - RC_TARGET)).toBeLessThan(m(0.2));
  });

  test('a LARGE deficit far exceeding headroom still concedes honestly', () => {
    // Same week, but Mon+Tue MISSED entirely; today Thu, Wed ran short (3).
    // actual = 3. D = 42 − 3 − 22 = 17. R2: Thu+1, Fri+1 (Σ2). R3: Sun post-long
    // cap 6 → val floor(min(6, 15)) = 6 ≥ 3 → Sun 6. recovered 2+6 = 8; residual
    // conceded 9 ≫ CLOSE_THRESHOLD 1 mi → the closer does NOT fire; concede.
    const { weekDays, actualMeters } = buildWeek(RC_DEFS, W91_DATES, 3, { 0: 0, 1: 0, 2: m(3) });
    const result = reflowWeek({
      weekDays,
      weekTargetMeters: RC_TARGET,
      actualMeters, // 3
      qualitySatisfied: true,
      useRestDay: true,
      pmHabitMeters: null,
      longDay: RC_LONG,
    })!;
    expect(result).not.toBeNull();
    expectNear(result.recoveredMeters, m(8));
    // Still an honest concession — newTarget present, conceded > 0.
    expect(result.newTargetMeters).not.toBeNull();
    expectNear(result.concededMeters, m(9));
    expectNear(result.newTargetMeters, m(33)); // 42 − 9
    expect(result.recoveredMeters).toBeLessThan(m(17)); // never fully recovers
  });
});

describe('v2.3.1 - race-week missed-long re-place (m3, quality analog)', () => {
  // Mon L16 MISSED, today Tue; Sat race 13. Hosts need raceIdx - idx >= 3
  // -> only Tue (1) / Wed (2); latest eligible = Wed. Race week always trims
  // to round_mi(0.8 x 16 = 12.8) = 13. Thu (2 days pre-race) must NOT host.
  const DATES = ['2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-21'];
  const DEFS: DayDef[] = [
    { type: 'long', planned: m(16), workoutId: 'r0' },
    { type: 'easy', planned: m(6),  workoutId: 'r1' },
    { type: 'easy', planned: m(6),  workoutId: 'r2' },
    { type: 'easy', planned: m(6),  workoutId: 'r3' },
    { type: 'easy', planned: m(4),  workoutId: 'r4' },
    { type: 'race', planned: m(13), workoutId: 'r5' },
    { type: 'rest', planned: 0,     workoutId: 'r6' },
  ];
  const TGT = m(51); // 16+6+6+6+4+13

  test('host >= 3 days pre-race, trimmed to 0.8L; closer days never host', () => {
    const { weekDays, actualMeters } = buildWeek(DEFS, DATES, 1, { 0: 0 });
    const r = reflowWeek({
      weekDays,
      weekTargetMeters: TGT,
      actualMeters, // 0
      qualitySatisfied: true,
      useRestDay: true, // rest activation is race-week banned regardless
      pmHabitMeters: null,
      longDay: { idx: 0, plannedMeters: m(16), workoutId: 'r0', date: DATES[0]! },
    });
    expect(r).not.toBeNull();
    // Wed (latest eligible >= 3 days out) hosts at round_mi(0.8 x 16) = 13.
    expect(setTypeOf(r!, 'r2')).toBe('long');
    expectNear(setDistanceOf(r!, 'r2'), m(13));
    // Thu/Fri (< 3 days pre-race) and the rest day never host or activate.
    expect(setTypeOf(r!, 'r3')).toBeNull();
    expect(setTypeOf(r!, 'r4')).toBeNull();
    expect(setTypeOf(r!, 'r6')).toBeNull();
    expectNear(r!.longReplaced!.meters, m(13));
  });
});
