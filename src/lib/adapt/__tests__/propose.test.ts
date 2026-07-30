/**
 * v2.1 adaptation engine — pure engine tests (adapt-study §3 R7 selection).
 *
 * LEGACY canonical week (kept from v1 so scenario names survive):
 *   Mon easy 14mi · Tue long 20mi · Wed quality 10mi · Thu easy 12mi
 *   Fri rest (NO row) · Sat long 22mi · Sun easy 6mi  = 84.0mi
 * Plan-relative constants for this week: L=22 · E=14 (Mon) · DTM=21 ·
 * M=median(14,20,10,12,22,6)=13 · HYBRID_MIN_ABS=max(2%·84, 1)=1.68mi.
 * Fri's rest slot has NO workout row → the R3 rest lever can never fire here
 * (no AM insert op exists), so max and keep-rest variants are identical and
 * the secondary is always pure lower_target.
 *
 * W91 corpus week (study §4/§5 — the real incident week) is exercised at the
 * proposeAdaptations level below (T1–T5) with pmHabitMeters = 5mi passed
 * EXPLICITLY (§4 numbers are only reproducible with habit 5; the real
 * derivation is Task 4's).
 *
 * Every expected number is hand-computed in comments; nothing asserts the
 * code's own output back at itself.
 */

import {
  proposeAdaptations,
  deriveContext,
  dayTotal,
  WeekDay,
  ProposeInput,
  QualityOnlyAdaptation,
  ReflowAdaptation,
  ReflowDiffDay,
} from '../propose';

const MI = 1609.344;
const mi2m = (miles: number) => Math.round(miles * MI);

/** Whole-meter rounding of mi2m drifts a few meters over sums — allow ±3 m. */
function expectNear(actual: number | null | undefined, expectedMeters: number): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect(Math.abs((actual as number) - expectedMeters)).toBeLessThanOrEqual(3);
}

/** Assert one §6 diff entry (AM/PM/changed) with meter tolerance. */
function expectDiffDay(
  d: ReflowDiffDay | undefined,
  exp: {
    type: ReflowDiffDay['type'];
    fromAm: number;
    toAm: number;
    fromPm?: number;
    toPm?: number;
    changed: boolean;
  },
): void {
  expect(d).toBeDefined();
  expect(d!.type).toBe(exp.type);
  expectNear(d!.fromAmMeters, exp.fromAm);
  expectNear(d!.toAmMeters, exp.toAm);
  expectNear(d!.fromPmMeters, exp.fromPm ?? 0);
  expectNear(d!.toPmMeters, exp.toPm ?? 0);
  expect(d!.changed).toBe(exp.changed);
}

// --- canonical week ---
const WEEK_TEMPLATE: Omit<WeekDay, 'hasActivity' | 'isToday'>[] = [
  { workoutId: 'w0', date: '2026-06-15', idx: 0, type: 'easy',    plannedMeters: mi2m(14), plannedPmMeters: 0 },
  { workoutId: 'w1', date: '2026-06-16', idx: 1, type: 'long',    plannedMeters: mi2m(20), plannedPmMeters: 0 },
  { workoutId: 'w2', date: '2026-06-17', idx: 2, type: 'quality', plannedMeters: mi2m(10), plannedPmMeters: 0 },
  { workoutId: 'w3', date: '2026-06-18', idx: 3, type: 'easy',    plannedMeters: mi2m(12), plannedPmMeters: 0 },
  { workoutId: null, date: '2026-06-19', idx: 4, type: 'rest',    plannedMeters: 0, plannedPmMeters: 0 },
  { workoutId: 'w5', date: '2026-06-20', idx: 5, type: 'long',    plannedMeters: mi2m(22), plannedPmMeters: 0 },
  { workoutId: 'w6', date: '2026-06-21', idx: 6, type: 'easy',    plannedMeters: mi2m(6), plannedPmMeters: 0 },
];
const TARGET = WEEK_TEMPLATE.reduce((s, d) => s + d.plannedMeters, 0);

/**
 * Build a ProposeInput for a scenario.
 *
 * @param todayIdx  - which day idx is "today" (days 0..todayIdx-1 are past)
 * @param acts      - map from idx to actual meters run (0 = missed entirely)
 *                    undefined = full planned distance
 * @param extra     - extra ProposeInput fields (pmHabitMeters, quality info…)
 */
function buildInput(
  todayIdx: number,
  acts: Record<number, number> = {},
  extra: Partial<ProposeInput> = {},
): ProposeInput {
  const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => {
    const isPast = d.idx < todayIdx;
    const isToday = d.idx === todayIdx;
    let actual: number | undefined;
    if (isPast) {
      if (d.type === 'rest') {
        actual = 0;
      } else if (d.idx in acts) {
        actual = acts[d.idx]!;
      } else {
        actual = d.plannedMeters; // full
      }
    }
    return {
      ...d,
      hasActivity: isPast ? (actual! > 0) : false,
      isToday,
    };
  });

  // actualMeters = sum of actuals for past days
  const actualMeters = WEEK_TEMPLATE.reduce((s, d) => {
    if (d.idx >= todayIdx) return s;
    if (d.type === 'rest') return s;
    if (d.idx in acts) return s + acts[d.idx]!;
    return s + d.plannedMeters;
  }, 0);

  return {
    weekTargetMeters: TARGET,
    actualMeters,
    elapsedFraction: todayIdx / 7,
    weekDays,
    ...extra,
  };
}

// ============================================================
// D7 / study T9: planned PM doubles must be visible
// ============================================================

describe('deriveContext — planned doubles (D7 / T9)', () => {
  const PM6 = mi2m(6);
  const TOL = mi2m(0.1); // ±0.1 mi in meters

  test('missed Mon 14+6 double, today Tue → gap = 20mi (missed-day size is AM+PM total)', () => {
    // Mon has a 14mi AM + 6mi PM double planned; the whole day was missed.
    // Target includes the PM 6, so gap = (TARGET+6) − 0 − (TARGET − 14) = 20mi.
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      plannedPmMeters: d.idx === 0 ? PM6 : 0,
      hasActivity: false,
      isToday: d.idx === 1,
    }));
    const input: ProposeInput = {
      weekTargetMeters: TARGET + PM6,
      actualMeters: 0,
      elapsedFraction: 1 / 7,
      weekDays,
    };
    const ctx = deriveContext(input);
    expect(Math.abs(ctx.gap - mi2m(20))).toBeLessThanOrEqual(TOL);
    // Mon appears in missed and its day total counts the PM.
    expect(ctx.missed.map((d) => d.idx)).toEqual([0]);
    expect(Math.abs(dayTotal(ctx.missed[0]!) - mi2m(20))).toBeLessThanOrEqual(TOL);
  });

  test('future Wed 14+6 double, today Tue → gap NOT inflated by the PM 6', () => {
    // Mon ran its full 14. Wed is a future 14 AM + 6 PM double, target includes
    // both. remPlanned must count 20 for Wed → gap = 0 (pre-fix it read 6mi).
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      plannedMeters: d.idx === 2 ? mi2m(14) : d.plannedMeters,
      plannedPmMeters: d.idx === 2 ? PM6 : 0,
      hasActivity: d.idx === 0,
      isToday: d.idx === 1,
    }));
    const input: ProposeInput = {
      // TARGET had Wed at 10mi; now Wed is 14+6.
      weekTargetMeters: TARGET + (mi2m(14) - mi2m(10)) + PM6,
      actualMeters: mi2m(14),
      elapsedFraction: 1 / 7,
      weekDays,
    };
    const ctx = deriveContext(input);
    expect(Math.abs(ctx.gap)).toBeLessThanOrEqual(TOL);
  });

  test('add_double skips a remaining easy day that already has a planned PM double', () => {
    // Behind from a short run only (no missed day): Mon ran 10 of 14, today=Tue.
    // Thu (idx 3, easy) already carries a 6mi PM double; Sun (idx 6, easy) has none.
    // pmHabitMeters = 5mi (the R4 gate is open, junk-PM floor = 2.5mi).
    //
    // Hand-computed gap: target = TARGET + PM6 and remaining-planned counts Thu's
    // PM via dayTotal, so the PM6 cancels and the gap is exactly Mon's shortfall:
    //   mi2m(14) − mi2m(10) = 22531 − 16093 = 6438 m  (~4 mi)
    // Thu is skipped (already a double); Sun hosts floor_mi(min(4, 5, 6)) = 4mi
    // ≥ 2.5mi floor → covers ≥90% → add_double is the primary proposal.
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      plannedPmMeters: d.idx === 3 ? PM6 : 0,
      hasActivity: d.idx === 0,
      isToday: d.idx === 1,
    }));
    const input: ProposeInput = {
      weekTargetMeters: TARGET + PM6,
      actualMeters: mi2m(10),
      elapsedFraction: 1 / 7,
      weekDays,
      pmHabitMeters: mi2m(5),
    };
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('add_double');
    if (primary?.kind === 'add_double') {
      // Thu (2026-06-18) is already doubled — it must NOT appear in adds.
      expect(primary.adds.map((a) => a.date)).not.toContain('2026-06-18');
      // The whole gap lands on Sun as one whole-mile PM.
      expect(primary.adds).toHaveLength(1);
      expect(primary.adds[0]!.date).toBe('2026-06-21');
      expectNear(primary.adds[0]!.meters, mi2m(4));
    }
  });
});

// ============================================================
// deriveContext
// ============================================================

describe('deriveContext', () => {
  test('gap = target - actual - remainingPlanned', () => {
    // Tiny: ran Mon 12 (not 14), today=Tue
    const input = buildInput(1, { 0: mi2m(12) });
    const ctx = deriveContext(input);
    const expectedGap = Math.round(2 * MI); // ~3219m
    expect(ctx.gap).toBeCloseTo(expectedGap, -1); // within 10m
    expect(ctx.severity).toBeCloseTo(expectedGap / TARGET, 4);
  });

  test('missed = past run days with !hasActivity', () => {
    // Miss one easy (Mon), today=Tue
    const input = buildInput(1, { 0: 0 });
    const ctx = deriveContext(input);
    expect(ctx.missed.map((d) => d.idx)).toEqual([0]);
  });

  test('missed excludes rest days', () => {
    // today=Sat (idx=5), Fri(idx=4) is rest — should not appear in missed
    const input = buildInput(5, {});
    const ctx = deriveContext(input);
    expect(ctx.missed.map((d) => d.idx)).not.toContain(4); // Fri rest not missed
  });

  test('restDays = future rest days', () => {
    // today=Tue (idx=1); Fri(idx=4) is future rest
    const input = buildInput(1, {});
    const ctx = deriveContext(input);
    expect(ctx.restDays.map((d) => d.idx)).toContain(4);
  });

  test('remainingEasy = future easy days', () => {
    // today=Tue (idx=1); Thu(idx=3) and Sun(idx=6) are future easy
    const input = buildInput(1, {});
    const ctx = deriveContext(input);
    expect(ctx.remainingEasy.map((d) => d.idx)).toEqual([3, 6]);
  });

  test('adjacentHard ignores missed neighbors (spec §4.3 refinement)', () => {
    // Miss Sat long (idx=5). Sun(idx=6) is adjacent to Sat, but Sat was missed.
    // So adjacentHard(6) should be false (Sat missed → ignored, Fri is rest → ignored).
    const input = buildInput(6, { 5: 0 }); // today=Sun, Sat missed
    const ctx = deriveContext(input);
    expect(ctx.adjacentHard(6)).toBe(false);
  });

  test('adjacentHard is true when non-missed long neighbor exists', () => {
    // today=Thu(idx=3); Sun(idx=6) neighbors are Sat(idx=5) which is a long day that will run
    const input = buildInput(3, {});
    const ctx = deriveContext(input);
    // Sun (idx=6) has Sat(idx=5) as neighbor which is long and not missed
    expect(ctx.adjacentHard(6)).toBe(true);
  });

  test('adjacentHard ignores rest neighbors', () => {
    // Fri(4): adj to Thu(easy, not hard) and Sat(long, will run)
    const input = buildInput(3, {});
    const ctx = deriveContext(input);
    expect(ctx.adjacentHard(4)).toBe(true); // Sat is adjacent and not missed/rest
  });
});

// ============================================================
// proposeAdaptations — R7 selection
// ============================================================

describe('proposeAdaptations — R7 selection', () => {
  // Selection rule (R7, v2.4 recovery palette):
  //   !hasMissedRunDay + a light fix covers ≥90% → light fix leads, max-reflow secondary.
  //   Otherwise reflowWeek runs twice: 'max' PRIMARY when recovered ≥
  //   max(25% of D, HYBRID_MIN_ABS) (inclusive), then 'keep_rest' when the
  //   rest lever fired, and the pure lower_target floor ALWAYS last (≤ 3
  //   cards); a cosmetic max recovery demotes reflow to secondary behind
  //   lower_target.

  // ── Short-run-only scenarios (no missed day) ─────────────────────────────

  test('Tiny gap (2mi) with a 5mi habit → redistribute (PM below the 0.5×habit junk floor)', () => {
    // Mon ran 12 of 14, today=Tue. Gap = 2mi. add_double: PM = floor(min(2, 5,
    // hostAM)) = 2mi < 2.5mi (0.5×habit) on every host → NO adds → null.
    // redistribute: Thu headroom = min(floor(12·1.25)=15, E=14, DTM=21) − 12 =
    // 2mi → one edit covers ~100% ≥ 90% → redistribute leads.
    const input = buildInput(1, { 0: mi2m(12) }, { pmHabitMeters: mi2m(5) });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('redistribute');
    if (primary?.kind === 'redistribute') {
      expect(primary.edits).toHaveLength(1);
      expect(primary.edits[0]!.date).toBe('2026-06-18'); // Thu
    }
  });

  test('Gap 3mi with a 5mi habit → add_double primary (PM 3 ≥ 0.5×habit floor)', () => {
    // Mon ran 11 of 14, today=Tue. Gap = 3mi. Host eligibility: Thu (12 ≤ M=13,
    // next day Fri is rest — not pre-long) hosts PM floor_mi(min(3, 5, 12)) =
    // 3mi ≥ 2.5mi floor → covers 100% → add_double leads.
    const input = buildInput(1, { 0: mi2m(11) }, { pmHabitMeters: mi2m(5) });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('add_double');
    if (primary?.kind === 'add_double') {
      expect(primary.adds).toHaveLength(1);
      expect(primary.adds[0]!.date).toBe('2026-06-18'); // Thu
      expectNear(primary.adds[0]!.meters, mi2m(3));
    }
  });

  test('Small gap (4mi) with a 5mi habit → add_double primary (NOT reflow)', () => {
    // Mon ran 10 of 14, today=Tue. Gap = 4mi → Thu hosts PM 4mi (≤ habit 5,
    // ≤ AM 12) → covers 100%.
    const input = buildInput(1, { 0: mi2m(10) }, { pmHabitMeters: mi2m(5) });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('add_double');
    expect(primary?.kind).not.toBe('reflow');
  });

  test('No doubling habit → add_double is NEVER proposed (R4 gate)', () => {
    // Same 4mi-gap scenario without pmHabitMeters: redistribute recovers only
    // Thu +2 + Sun +1 = 3 < 3.6 (90%) → no light fix covers → heavy path
    // (reflow/lower_target) — but never an add_double card.
    const input = buildInput(1, { 0: mi2m(10) });
    const result = proposeAdaptations(input);
    expect(result.map((a) => a.kind)).not.toContain('add_double');
  });

  test('Short-run-only gap, light fix covers → max-reflow offered as secondary', () => {
    // Mon ran 12 (short 2mi), today=Tue, no habit → redistribute covers (Thu +2).
    // Secondary: max reflow recovers 2mi via extensions ≥ ABS 1.68 → feasible.
    const input = buildInput(1, { 0: mi2m(12) });
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('redistribute');
    expect(result[1]?.kind).toBe('reflow');
    if (result[1]?.kind === 'reflow') expect(result[1].variant).toBe('max');
  });

  test('Huge short-run gap, one day left, no missed day → lower_target primary, escalated reflow secondary', () => {
    // today=Sun (idx=6), Mon-Sat all ran at 50% (no missed day), only Sun (6mi)
    // remains. Gap = 39mi. Light fixes can't cover. max reflow (v2.3): Sun ext
    // +1 → 7; no PM (no habit), no rest slot with a row → R2 last-lever
    // escalation: Sun is adjacent to the RAN Sat long → cap min(E 14, DTM 21,
    // 0.6·22 = 13.2) → Sun 13 (+6). Recovered 7 ≥ ABS 1.68 (feasible) but
    // 7 < 0.25·39 = 9.75 → still cosmetic vs the deficit → lower_target
    // PRIMARY with the honest escalated reflow as secondary (pre-v2.3 the
    // reflow recovered only 1 and vanished entirely).
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 6 && d.type !== 'rest',
      isToday: d.idx === 6,
    }));
    const actualMeters = Math.round(
      (mi2m(14) + mi2m(20) + mi2m(10) + mi2m(12) + 0 + mi2m(22)) * 0.5,
    );
    const input: ProposeInput = {
      weekTargetMeters: TARGET,
      actualMeters,
      elapsedFraction: 6 / 7,
      weekDays,
    };
    const result = proposeAdaptations(input);
    expect(result.map((a) => a.kind)).toEqual(['lower_target', 'reflow']);
    const card = result[1] as ReflowAdaptation;
    expectNear(card.recoveredMeters, mi2m(7));
    const sun = card.diff.find((d) => d.date === '2026-06-21');
    expectDiffDay(sun, { type: 'easy', fromAm: mi2m(6), toAm: mi2m(13), changed: true });
  });

  // ── Missed-day scenarios ─────────────────────────────────────────────────

  test('Miss easy Mon, today Tue (5mi habit) → max-reflow primary, lower_target secondary', () => {
    // D = 84 − 0 − 70 = 14. Extensions: Thu +2 (E=14 cap), Sun +1 = 3mi.
    // Double: lightest host Sun (6 ≤ M=13, not pre-long) → PM 5. Recovered 8
    // ≥ max(0.25·14 = 3.5, 1.68) → 'max' PRIMARY. Rest lever can't fire (Fri's
    // rest has no row) → variants identical → secondary is pure lower_target.
    // Conceded 6 → reflow newTarget = 84−6 = 78.
    const input = buildInput(1, { 0: 0 }, { pmHabitMeters: mi2m(5) });
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe('reflow');
    expect(result[1]?.kind).toBe('lower_target');
    if (result[0]?.kind === 'reflow') {
      expect(result[0].variant).toBe('max');
      expect(result[0].title).toBe('Realign');
      expectNear(result[0].recoveredMeters, mi2m(8));
      expectNear(result[0].newTargetMeters, mi2m(78));
    }
  });

  test('Miss easy Thu, today Fri → escalated reflow primary (v2.3 last lever)', () => {
    // actual = 14+20+10 = 44, D = 84−44−28 = 12. Ext: Sun 6→7 (+1). Fri's rest
    // slot has NO workout row → no rest lever exists, no PM habit → R2
    // last-lever escalation (v2.3): Sun is adjacent to the Sat long → cap
    // min(E 14, DTM 21, 0.6·22 = 13.2) → Sun 13 (+6 more). Recovered 7 ≥
    // max(0.25·12 = 3, 1.68) → reflow PRIMARY (pre-v2.3: 1mi → lower_target).
    // Conceded 5 → 84→79.
    const input = buildInput(4, { 3: 0 });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    expect(result[1]?.kind).toBe('lower_target');
    const card = result[0] as ReflowAdaptation;
    expectNear(card.recoveredMeters, mi2m(7));
    expectNear(card.newTargetMeters, mi2m(79));
    const sun = card.diff.find((d) => d.date === '2026-06-21');
    expectDiffDay(sun, { type: 'easy', fromAm: mi2m(6), toAm: mi2m(13), changed: true });
  });

  test('Miss quality Wed (no quality info), today Thu → reflow primary', () => {
    // Mileage-only (no qualityDayInfo passed). D = 84−34−40 = 10. Extensions:
    // Thu +2, Sun +1 = 3 ≥ max(0.25·10 = 2.5, 1.68) → 'max' PRIMARY even
    // without a doubling habit.
    const input = buildInput(3, { 2: 0 });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('reflow');
  });

  test('Miss quality Wed, today Sun (only Sun left) → escalated reflow primary (v2.3)', () => {
    // today=Sun(idx=6), remaining = only Sun (easy 6). D = 10 (Wed quality
    // missed; no qualityDayInfo passed → mileage-only). Ext +1 → 7; no rest
    // slot remains, no habit → escalation: Sun adjacent to the RAN Sat long →
    // cap 0.6·22 = 13.2 → Sun 13. Recovered 7 ≥ max(2.5, 1.68) → reflow
    // PRIMARY, conceding 3 → 84→81 (pre-v2.3: 1mi → lower_target).
    const input = buildInput(6, { 2: 0 });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    const card = result[0] as ReflowAdaptation;
    expectNear(card.recoveredMeters, mi2m(7));
    expectNear(card.newTargetMeters, mi2m(81));
  });

  test('Miss long Tue, today Wed (5mi habit) → reflow primary', () => {
    // No longDayInfo passed → mileage-only. D = 84−14−50 = 20. Extensions:
    // Wed 10→12 (+2), Thu +2, Sun +1 = 5. Double on lightest host Sun → PM 5.
    // Recovered 10 ≥ max(0.25·20 = 5, 1.68) → reflow PRIMARY.
    const input = buildInput(2, { 1: 0 }, { pmHabitMeters: mi2m(5) });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('reflow');
  });

  test('Miss TWO (Tue+Wed), today Thu (5mi habit) → reflow primary (8 ≥ 0.25·30)', () => {
    // D = 84 − 14 − 40 = 30. Extensions Thu +2, Sun +1 = 3; PM 5 on Sun → 8mi
    // recovered ≥ 7.5 (25% of 30, inclusive) → reflow PRIMARY.
    const input = buildInput(3, { 1: 0, 2: 0 }, { pmHabitMeters: mi2m(5) });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('reflow');
  });

  // ── R7 ratio rule: huge deficit → lower_target leads (finalized from Task 2) ──
  test('Miss Mon-Wed, today Thu → lower_target PRIMARY, conceding max-reflow secondary', () => {
    // D = 84 − 0 − 40 = 44. Recoverable (5mi habit): Thu +2, Sun +1, PM 5 on
    // Sun = 8mi. Ratio: 8 < 0.25·44 = 11 → the recovery is cosmetic against
    // the deficit → pure lower_target PRIMARY; the honest conceding reflow
    // stays as secondary (8 ≥ ABS 1.68). Reflow concedes 36 → 84−36 = 48.
    const input = buildInput(3, { 0: 0, 1: 0, 2: 0 }, { pmHabitMeters: mi2m(5) });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('lower_target');
    expect(result[1]?.kind).toBe('reflow');
    if (result[1]?.kind === 'reflow') {
      expect(result[1].variant).toBe('max');
      expectNear(result[1].recoveredMeters, mi2m(8));
      expectNear(result[1].newTargetMeters, mi2m(48));
    }
  });

  test('Half Mon-Wed, today Thu (5mi habit) → reflow primary (8 ≥ 0.25·22)', () => {
    // actual = 7+10+5 = 22mi, D = 84−22−40 = 22. Recovered 8 (ext 3 + PM 5)
    // ≥ 5.5 → reflow PRIMARY.
    const input = buildInput(3, {
      0: Math.round(mi2m(14) * 0.5),
      1: Math.round(mi2m(20) * 0.5),
      2: Math.round(mi2m(10) * 0.5),
    }, { pmHabitMeters: mi2m(5) });
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('reflow');
  });

  test('Miss long Sat, today Sun → escalated reflow primary (v2.3, mileage-only)', () => {
    // today=Sun(6), Sat(5,long,22mi) missed, no habit/longDayInfo → the miss
    // is mileage-only (no R6 without longDayInfo). D = 22. Ext +1 → 7; no
    // rest slot, no habit → escalation: the MISSED Sat long never blocks, so
    // cap = min(E 14, DTM 21) = 14 → Sun 14 (+7 more). Recovered 8 ≥
    // max(0.25·22 = 5.5, 1.68) → reflow PRIMARY, conceding 14 → 84→70.
    const input = buildInput(6, { 5: 0 });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    const card = result[0] as ReflowAdaptation;
    expectNear(card.recoveredMeters, mi2m(8));
    expectNear(card.newTargetMeters, mi2m(70));
    const sun = card.diff.find((d) => d.date === '2026-06-21');
    expectDiffDay(sun, { type: 'easy', fromAm: mi2m(6), toAm: mi2m(14), changed: true });
  });

  test('reflow card carries the v2.1 fields (variant, recoveredMeters, §6 diff)', () => {
    const input = buildInput(1, { 0: 0 }, { pmHabitMeters: mi2m(5) });
    const result = proposeAdaptations(input);
    const card = result[0]!;
    expect(card.kind).toBe('reflow');
    if (card.kind === 'reflow') {
      expect(card.title).toBe('Realign');
      expect(typeof card.detail).toBe('string');
      expect(Array.isArray(card.ops)).toBe(true);
      expect(card.deficitMeters).toBeGreaterThan(0);
      expect(card.variant).toBe('max');
      expect(typeof card.recoveredMeters).toBe('number');
      // §6 diff: one entry per remaining day (Tue..Sun = 6), AM/PM separate.
      expect(card.diff).toHaveLength(6);
      for (const d of card.diff) {
        expect(typeof d.fromAmMeters).toBe('number');
        expect(typeof d.toAmMeters).toBe('number');
        expect(typeof d.fromPmMeters).toBe('number');
        expect(typeof d.toPmMeters).toBe('number');
        expect(typeof d.changed).toBe('boolean');
      }
    }
  });

  // ── gap <= 0 → no adaptations ────────────────────────────────────────────
  test('gap <= 0 → returns []', () => {
    // today=Tue, ran Mon full (no shortfall)
    const input = buildInput(1, {});
    const result = proposeAdaptations(input);
    expect(result).toEqual([]);
  });

  // ── max 3 adaptations (§8b v2.4 palette invariant) ────────────────────────
  test('never returns more than 3 adaptations', () => {
    const input = buildInput(1, { 0: 0 }, { pmHabitMeters: mi2m(5) });
    const result = proposeAdaptations(input);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  // ── each adaptation has required fields ───────────────────────────────────
  test('adaptations have title, detail, and deficitMeters (except quality_only)', () => {
    const input = buildInput(1, { 0: 0 });
    const result = proposeAdaptations(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const a of result) {
      expect(typeof a.title).toBe('string');
      expect(a.title.length).toBeGreaterThan(0);
      expect(typeof a.detail).toBe('string');
      expect(a.detail.length).toBeGreaterThan(0);
      // quality_only is informational — no deficitMeters
      if (a.kind !== 'quality_only') {
        expect(typeof (a as {deficitMeters: number}).deficitMeters).toBe('number');
        expect((a as {deficitMeters: number}).deficitMeters).toBeGreaterThan(0);
      }
    }
  });

  // v2.6: mileage on pace, but the Tue quality (idx1) was run EASY (unsatisfied).
  // A clean week (Mon E14·Tue Q14·Wed E16·Thu E12·Fri E9·Sat L20·Sun rest) with
  // today=Wed: Thu is a safe easy slot (not adjacent to Sat long). The quality-
  // only card must be ACTIONABLE — offering to flip Thu into the quality session
  // even with no reflow deficit.
  test('quality run-easy while on mileage pace → actionable quality_only re-place', () => {
    const dates = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21'];
    const defs: [WeekDay['type'], number, string | null][] = [
      ['easy', 14, 'c0'], ['quality', 14, 'c1'], ['easy', 16, 'c2'], ['easy', 12, 'c3'],
      ['easy', 9, 'c4'], ['long', 20, 'c5'], ['rest', 0, null],
    ];
    const todayIdx = 2;
    const weekDays: WeekDay[] = defs.map(([type, m, id], i) => ({
      workoutId: id, date: dates[i]!, idx: i, type, plannedMeters: mi2m(m), plannedPmMeters: 0,
      hasActivity: i < todayIdx && type !== 'rest', isToday: i === todayIdx,
    }));
    const input: ProposeInput = {
      weekTargetMeters: defs.reduce((s, [, m]) => s + mi2m(m), 0),
      actualMeters: mi2m(14) + mi2m(14), // Mon + Tue done (Tue ran easy) → on pace
      elapsedFraction: todayIdx / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 1,
      qualityDayInfo: { idx: 1, plannedMeters: mi2m(14), workoutId: 'c1', date: dates[1]! },
      longDayInfo: { idx: 5, plannedMeters: mi2m(20), workoutId: 'c5', date: dates[5]! },
    };
    const primary = proposeAdaptations(input)[0]!;
    expect(primary.kind).toBe('quality_only');
    const replace = (primary as { replace?: { workoutId: string; toMeters: number } }).replace;
    expect(replace).toBeDefined();
    expect(replace!.workoutId).toBe('c3'); // Thu easy slot (safe) flips to quality
    expect(Math.abs(replace!.toMeters - mi2m(14))).toBeLessThanOrEqual(3);
  });
});

// ── Quality re-place when the runner ran EASY on their quality day (v2.3.1) ──
// Root cause #2: Dash flags "Missing quality session" purely on !qualitySatisfied,
// but the old engine refused to restore quality solely because a run happened on
// the quality day (wasMissed needs !hasActivity). The elapsed-and-unmet trigger
// makes the card's quality seal coherent with the diff.
describe('reflow — quality re-place on an elapsed unsatisfied quality day', () => {
  const MON = '2026-06-15';
  const TUE = '2026-06-16'; // quality day
  const WED = '2026-06-17';
  const THU = '2026-06-18';
  const FRI = '2026-06-19';
  const SAT = '2026-06-20'; // long
  const SUN = '2026-06-21'; // rest (has a row)

  // Mon E10 · Tue Q12 · Wed E10 · Thu E12 · Fri E10 · Sat L20 · Sun R0 = 74 mi.
  const DEFS: Omit<WeekDay, 'hasActivity' | 'isToday'>[] = [
    { workoutId: 'w0', date: MON, idx: 0, type: 'easy',    plannedMeters: mi2m(10), plannedPmMeters: 0 },
    { workoutId: 'w1', date: TUE, idx: 1, type: 'quality', plannedMeters: mi2m(12), plannedPmMeters: 0 },
    { workoutId: 'w2', date: WED, idx: 2, type: 'easy',    plannedMeters: mi2m(10), plannedPmMeters: 0 },
    { workoutId: 'w3', date: THU, idx: 3, type: 'easy',    plannedMeters: mi2m(12), plannedPmMeters: 0 },
    { workoutId: 'w4', date: FRI, idx: 4, type: 'easy',    plannedMeters: mi2m(10), plannedPmMeters: 0 },
    { workoutId: 'w5', date: SAT, idx: 5, type: 'long',    plannedMeters: mi2m(20), plannedPmMeters: 0 },
    { workoutId: 'w6', date: SUN, idx: 6, type: 'rest',    plannedMeters: 0,        plannedPmMeters: 0 },
  ];
  const WK_TARGET = DEFS.reduce((s, d) => s + d.plannedMeters, 0);
  const QUALITY_INFO = { idx: 1, plannedMeters: mi2m(12), workoutId: 'w1', date: TUE };

  /** acts: idx→actual meters for past days (undefined = full plan; rest = 0). */
  function build(todayIdx: number, acts: Record<number, number>): ProposeInput {
    const weekDays: WeekDay[] = DEFS.map((d) => {
      const isPast = d.idx < todayIdx;
      let actual = 0;
      if (isPast && d.type !== 'rest') actual = d.idx in acts ? acts[d.idx]! : d.plannedMeters;
      return { ...d, hasActivity: isPast && actual > 0, isToday: d.idx === todayIdx };
    });
    const actualMeters = weekDays.reduce(
      (s, d) => (d.idx < todayIdx && d.type !== 'rest' ? s + (d.idx in acts ? acts[d.idx]! : d.plannedMeters) : s),
      0,
    );
    return {
      weekTargetMeters: WK_TARGET,
      actualMeters,
      elapsedFraction: todayIdx / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 1,
      qualityDayInfo: QUALITY_INFO,
    };
  }

  test('ran EASY on Tue quality (unmet), today Thu, safe Thu host → card.qualityBanked true + quality in diff', () => {
    // Mon missed (real gap so reflow leads), Tue quality "ran" 8 mi easy
    // (hasActivity true, still unsatisfied), Wed ran 10. actual = 0+8+10 = 18.
    // Remaining Thu12·Fri10·Sat L20·Sun R. D = 74 − 18 − 42 = 14.
    // R5 (v2.3.1): Tue elapsed + unsatisfied → re-places DESPITE the easy run.
    //   Fri is long-adjacent → Thu(12) is the safe host → Q12 (no distance change).
    const input = build(3, { 0: 0, 1: mi2m(8), 2: mi2m(10) });
    const result = proposeAdaptations(input);
    const card = result.find((a) => a.kind === 'reflow') as ReflowAdaptation | undefined;
    expect(card).toBeDefined();
    expect(card!.variant).toBe('max');
    // The seal is KEPT because quality was restored (coherent with Dash's flag).
    expect(card!.qualityBanked).toBe(true);
    // The diff carries a type:'quality' day (Thu), proving the re-placement.
    const thu = card!.diff.find((d) => d.date === THU);
    expect(thu?.type).toBe('quality');
    expect(thu?.changed).toBe(true);
  });

  test('ran EASY on Tue quality (unmet), today Fri, only long-adjacent hosts → concedes (qualityBanked falsy)', () => {
    // Mon missed, Tue quality "ran" 8 mi easy (unsatisfied), Wed/Thu on plan.
    // actual = 0+8+10+12 = 30. Remaining Fri10·Sat L20·Sun R. D = 74 − 30 − 30 = 14.
    // R5 fires but Fri is long-adjacent, the Sun rest fallback is long-adjacent,
    // and the one slot-opening swap opens no eligible easy slot → quality
    // conceded (seal stays open) — the elapsed trigger did NOT over-force it.
    const input = build(4, { 0: 0, 1: mi2m(8) });
    const result = proposeAdaptations(input);
    const card = result.find((a) => a.kind === 'reflow') as ReflowAdaptation | undefined;
    expect(card).toBeDefined();
    expect(card!.qualityBanked).toBeFalsy();
    expect(card!.diff.some((d) => d.type === 'quality')).toBe(false);
  });
});

// ── Reschedule now superseded by reflow ────────────────────────────────────
describe('reflow replaces reschedule', () => {
  test('missed easy Thu, today Fri → reflow (never the old reschedule kind)', () => {
    // Same scenario as "Miss easy Thu" above: v2.3 escalation recovers 7 of 12
    // → reflow primary — but never the old reschedule kind.
    const input = buildInput(4, { 3: 0 });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    expect(result.map((a) => a.kind)).not.toContain('reschedule');
  });

  test('missed easy Mon, today Sat → escalated reflow primary (v2.3)', () => {
    // today=Sat(5), Mon missed. actual = 20+10+12 = 42, remaining = Sat 22 +
    // Sun 6 → D = 84−42−28 = 14. Sat long kept. Ext: Sun +1 → 7; no rest
    // slot, no habit → escalation: Sun adjacent to the WILL-RUN Sat long →
    // cap 0.6·22 = 13.2 → Sun 13 (+6 more). Recovered 7 ≥ max(3.5, 1.68) →
    // reflow PRIMARY, conceding 7 → 84→77 (pre-v2.3: 1mi → lower_target).
    const input = buildInput(5, { 0: 0 });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    const card = result[0] as ReflowAdaptation;
    expectNear(card.recoveredMeters, mi2m(7));
    expectNear(card.newTargetMeters, mi2m(77));
  });

  test('missed long Tue, today Fri → escalated reflow primary (v2.3, mileage-only)', () => {
    // actual = 14+0+10+12 = 36, D = 84−36−28 = 20. No longDayInfo → the miss
    // is mileage-only. Ext: Sun +1 → 7; Fri rest has no row, no habit →
    // escalation: Sun adjacent to Sat long → cap 13.2 → Sun 13 (+6 more).
    // Recovered 7 ≥ max(5, 1.68) → reflow PRIMARY, conceding 13 → 84→71.
    const input = buildInput(4, { 1: 0 });
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    const card = result[0] as ReflowAdaptation;
    expectNear(card.recoveredMeters, mi2m(7));
    expectNear(card.newTargetMeters, mi2m(71));
  });
});

// ============================================================
// Quality-aware selection (R5 + §8b override)
// ============================================================

describe('proposeAdaptations — quality-aware', () => {
  test('qualitySatisfied=true: behind, produces reflow without quality session placed', () => {
    // Missed Wed Q but quality already satisfied → mileage-only. D = 10;
    // extensions Thu +2, Sun +1 = 3 ≥ 2.5 → reflow primary, no quality placed.
    const input: ProposeInput = {
      ...buildInput(3, { 2: 0 }),
      qualitySatisfied: true,
      plannedQualityDayIdx: 2,
      qualityDayInfo: { idx: 2, plannedMeters: mi2m(10), workoutId: 'w2', date: '2026-06-17' },
    };
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('reflow');
    if (primary?.kind === 'reflow') {
      // No quality day appears anywhere in the proposal.
      expect(primary.diff.some((d) => d.type === 'quality')).toBe(false);
    }
  });

  test('R7 v2.3 session-value ranking: negative-credit quality re-place → reflow PRIMARY over equal-mileage lower_target', () => {
    // Carry-forward #2 (small quality day, bigger slot), re-ranked by v2.3:
    // D = 84 − 34 − 40 = 10. R5 re-places Q10 onto Thu (the only safe easy
    // slot, planned 12): the slot SHRINKS to the quality distance → credit =
    // 10−12 = −2 (spec-sanctioned R0 exception). Ext: Sun +1 → 7. Fri's rest
    // has no row, no habit → v2.3 escalation: Sun adjacent to the Sat long →
    // cap 0.6·22 = 13.2 → Sun 13 (+6 more). Recovered = −2+1+6 = 5, conceded
    // 5 → newTarget 79. Ranking (v2.3 exemption): value = the re-placed
    // session's distance 10 ≥ max(0.25·10 = 2.5, ABS) → the Q-saving reflow
    // OUTRANKS the equal-mileage lower_target and leads.
    const input: ProposeInput = {
      ...buildInput(3, { 2: 0 }),
      qualitySatisfied: false,
      plannedQualityDayIdx: 2,
      qualityDayInfo: { idx: 2, plannedMeters: mi2m(10), workoutId: 'w2', date: '2026-06-17' },
    };
    const result = proposeAdaptations(input);
    expect(result[0]?.kind).toBe('reflow');
    expect(result[1]?.kind).toBe('lower_target');
    const card = result[0] as ReflowAdaptation;
    expect(card.variant).toBe('max');
    expectNear(card.recoveredMeters, mi2m(5));
    expectNear(card.newTargetMeters, mi2m(79));
    // Thu hosts the re-placed quality at its planned 10 (from the slot's 12).
    const thu = card.diff.find((d) => d.date === '2026-06-18');
    expectDiffDay(thu, { type: 'quality', fromAm: mi2m(12), toAm: mi2m(10), changed: true });
    // The escalated Sun carries the remainder.
    const sun = card.diff.find((d) => d.date === '2026-06-21');
    expectDiffDay(sun, { type: 'easy', fromAm: mi2m(6), toAm: mi2m(13), changed: true });
    // The ops actually re-type Thu's workout row.
    expect(card.ops.some((o) => o.kind === 'setType' && o.workoutId === 'w3' && o.newType === 'quality')).toBe(true);
    // v2.3 chips: the secondary lower_target claims only what is true — the
    // (Tue+Sat) longs survive, quality is missed-and-unsatisfied → open.
    // Reachable = 34 + 40 = 74.
    if (result[1]?.kind === 'lower_target') {
      expect(result[1].detail).toBe('84.0 → 74.0 mi · Long kept · Quality open');
    }
  });

  test('qualitySatisfied=true: missed non-quality day → reflow primary', () => {
    const input: ProposeInput = {
      ...buildInput(1, { 0: 0 }, { pmHabitMeters: mi2m(5) }),
      qualitySatisfied: true,
      plannedQualityDayIdx: 2,
    };
    const [primary] = proposeAdaptations(input);
    expect(primary?.kind).toBe('reflow');
  });

  // Behind week, planned quality (Wed) missed and unsatisfied, today Thu; the
  // max-variant reflow RE-PLACES the missed quality onto a remaining easy slot
  // (R5). The card must both carry a `type:'quality'` day in its diff AND set
  // `qualityBanked` so the footer seal reads "kept" — the two must agree. Pre-
  // fix the diff carried the restored quality but the seal still read the
  // not-restored X because qualityBanked keyed only off a prior detected
  // session (`qualitySatisfied === true`), never off an R5 re-placement.
  test('missed quality Wed re-placed by max reflow → diff has quality day AND qualityBanked seal reads kept', () => {
    const input: ProposeInput = {
      ...buildInput(3, { 2: 0 }),
      qualitySatisfied: false,
      plannedQualityDayIdx: 2,
      qualityDayInfo: { idx: 2, plannedMeters: mi2m(10), workoutId: 'w2', date: '2026-06-17' },
    };
    const result = proposeAdaptations(input);
    const card = result[0] as ReflowAdaptation;
    expect(card.kind).toBe('reflow');
    expect(card.variant).toBe('max');
    // The restored quality lands on Thu (the only safe easy slot) — pink pip.
    const thu = card.diff.find((d) => d.date === '2026-06-18');
    expect(thu?.type).toBe('quality');
    expect(card.diff.some((d) => d.type === 'quality')).toBe(true);
    // …and the footer's quality seal reads kept, coherent with the diff.
    expect(card.qualityBanked).toBe(true);
  });
});

// ============================================================
// quality_only trigger (gap ≤ 0)
// ============================================================

describe('proposeAdaptations — quality_only trigger', () => {
  test('quality day already PAST, gap<0, safe slot ahead → quality_only card with slot', () => {
    // today=Thu(3). Mon+Tue ran, Wed quality MISSED (unsatisfied). target =
    // actual → gap = −remainingPlanned < 0. The quality day (Wed, idx 2 <
    // todayIdx 3) is in the past → the card fires.
    // Safe-slot search over remaining: Thu is safe (Wed neighbor was missed →
    // ignored; Fri is rest) → Thu. Copy is labels+numbers (v2.2.2): the slot
    // day + the planned quality distance (Wed's 10).
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 3 && d.type !== 'rest' && d.idx !== 2,
      isToday: d.idx === 3,
    }));
    const actualMeters = mi2m(14) + mi2m(20); // Mon+Tue as planned, Wed missed
    const input: ProposeInput = {
      weekTargetMeters: actualMeters, // gap = −(remaining planned) < 0
      actualMeters,
      elapsedFraction: 3 / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 2, // Wed — already behind us
    };
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('quality_only');
    const card = result[0] as QualityOnlyAdaptation;
    expect(card.safeSlotDate).toBe('2026-06-18'); // Thu
    expect(card.title).toBe('Quality open');
    expect(card.detail).toBe('Thu · 10.0 mi');
  });

  test('v2.2.2: hard days are never the slot — Sat long excluded → no-slot variant', () => {
    // today=Thu(3), Mon-Wed all ran (Wed's run was NOT quality → unsatisfied).
    // Remaining: Thu blocked (Wed quality ran → hard neighbor), Fri rest,
    // Sat is the LONG itself (pre-amendment the search recommended it — the
    // eval-grid I10 defect), Sun adjacent to the Sat long. → NO eligible slot.
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 3 && d.type !== 'rest',
      isToday: d.idx === 3,
    }));
    const actualMeters = mi2m(14) + mi2m(20) + mi2m(10); // Mon+Tue+Wed as planned
    const input: ProposeInput = {
      weekTargetMeters: actualMeters, // gap = −(remaining planned) < 0
      actualMeters,
      elapsedFraction: 3 / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 2,
    };
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(1);
    const card = result[0] as QualityOnlyAdaptation;
    expect(card.kind).toBe('quality_only');
    expect(card.safeSlotDate).toBeUndefined(); // NEVER '2026-06-20' (the long)
    expect(card.title).toBe('Quality · no slot');
    expect(card.detail).toBe('0 slots left');
  });

  test('quality day past, gap=0, no safe slot → quality_only "no slot" card', () => {
    // today=Sun (idx=6, last day): only remaining is Sun itself (easy).
    // Sun(6) adjacent to Sat(5,long) → adjacentHard(6)=true → no safe slot.
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 6, // everything before Sun ran
      isToday: d.idx === 6,
    }));
    const actualMeters = TARGET; // gap < 0
    const input: ProposeInput = {
      weekTargetMeters: actualMeters,
      actualMeters,
      elapsedFraction: 6 / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 2,
    };
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('quality_only');
    const card = result[0] as QualityOnlyAdaptation;
    expect(card.safeSlotDate).toBeUndefined();
    expect(card.title).toBe('Quality · no slot');
    expect(card.detail).toBe('0 slots left');
  });

  test('eval W*-qonly-t4 (v2.3): W35/W91 stay no-slot; W50/W70 open Fri via the Sat⇄Sun slot-opening swap', () => {
    // Each template: quality missed earlier in the week, mileage met (gap 0),
    // today Fri. Without a swap every remaining day is rest, the Sat long
    // itself, or long-adjacent. v2.3 attempts ONE slot-opening swap first:
    //  - W35: swapping Sat L10 ⇄ Sun e9 leaves Sat long-adjacent and Fri is a
    //    row-less rest — nothing opens → no-slot variant stands.
    //  - W50: Sat L14 ⇄ Sun e4 → Sun hosts the long (14 ≤ L), Sat e4; Fri e5
    //    (neighbors Thu ran-easy + Sat easy) OPENS → `Quality open · Fri`.
    //  - W70: Sat L18 ⇄ Sun e4 likewise opens Fri e7.
    //  - W91: Sun is REST (not a run day) so the long has no later partner;
    //    Fri⇄Sat only moves the long next to nothing new → no slot → no-slot.
    // The long day itself is still never the recommended slot (eval I10).
    const mk = (
      days: [WeekDay['type'], number, number?][], // [type, planned, pm?]
      qIdx: number,
      targetMi: number,
    ): ProposeInput => {
      const dates = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21'];
      const weekDays: WeekDay[] = days.map(([type, planned, pm], idx) => ({
        workoutId: `w${idx}`,
        date: dates[idx]!,
        idx,
        type,
        plannedMeters: mi2m(planned),
        plannedPmMeters: mi2m(pm ?? 0),
        // Past run days all ran EXCEPT the quality day (missed, unsatisfied).
        hasActivity: idx < 4 && type !== 'rest' && idx !== qIdx,
        isToday: idx === 4, // Fri
      }));
      // Mileage KPI met exactly: actual = target − remaining planned → gap = 0
      // (whole-meter rounding must not tip gap to +1 m and skip the trigger).
      const remainingPlanned = weekDays
        .filter((d) => d.idx >= 4)
        .reduce((s, d) => s + d.plannedMeters + d.plannedPmMeters, 0);
      const weekTargetMeters = mi2m(targetMi);
      return {
        weekTargetMeters,
        actualMeters: weekTargetMeters - remainingPlanned,
        elapsedFraction: 4 / 7,
        weekDays,
        qualitySatisfied: false,
        plannedQualityDayIdx: qIdx,
      };
    };
    const noSlot: ProposeInput[] = [
      // W35: Mon R · Tue e5 ✓ · Wed Q6 ✗ · Thu e5 ✓ · Fri R (today) · Sat L10 · Sun e9
      mk([['rest', 0], ['easy', 5], ['quality', 6], ['easy', 5], ['rest', 0], ['long', 10], ['easy', 9]], 2, 35),
      // W91: Mon e14+6 ✓ · Tue Q14 ✗ · Wed e16 ✓ · Thu e12 ✓ · Fri e9 (today) · Sat L20 · Sun R
      mk([['easy', 14, 6], ['quality', 14], ['easy', 16], ['easy', 12], ['easy', 9], ['long', 20], ['rest', 0]], 1, 91),
    ];
    for (const input of noSlot) {
      const result = proposeAdaptations(input);
      expect(result).toHaveLength(1);
      const card = result[0] as QualityOnlyAdaptation;
      expect(card.kind).toBe('quality_only');
      // The long day (Sat 2026-06-20) is never recommended; no slot exists.
      expect(card.safeSlotDate).toBeUndefined();
      expect(card.title).toBe('Quality · no slot');
      expect(card.detail).toBe('0 slots left');
    }

    const opens: [ProposeInput, string][] = [
      // W50: Mon e6 ✓ · Tue Q8 ✗ · Wed e7 ✓ · Thu e6 ✓ · Fri e5 (today) · Sat L14 · Sun e4
      [mk([['easy', 6], ['quality', 8], ['easy', 7], ['easy', 6], ['easy', 5], ['long', 14], ['easy', 4]], 1, 50), '8.0'],
      // W70: Mon e10 ✓ · Tue Q11 ✗ · Wed e12 ✓ · Thu e8 ✓ · Fri e7 (today) · Sat L18 · Sun e4
      [mk([['easy', 10], ['quality', 11], ['easy', 12], ['easy', 8], ['easy', 7], ['long', 18], ['easy', 4]], 1, 70), '11.0'],
    ];
    for (const [input, qMi] of opens) {
      const result = proposeAdaptations(input);
      expect(result).toHaveLength(1);
      const card = result[0] as QualityOnlyAdaptation;
      expect(card.kind).toBe('quality_only');
      expect(card.title).toBe('Quality open');
      // The slot is Fri (today) — never the Sat long itself.
      expect(card.safeSlotDate).toBe('2026-06-19');
      // The enabling swap is rendered: Sat long ⇄ Sun easy.
      expect(card.swap).toEqual({ date: '2026-06-20', withDate: '2026-06-21' });
      expect(card.detail).toBe(`Fri · ${qMi} mi · Sat⇄Sun`);
    }
  });

  test('REGRESSION (stress H): quality day still AHEAD, gap ≤ 0 → NO cards', () => {
    // today=Tue(1), planned quality day is Wed (idx 2 > todayIdx 1) — the
    // runner can simply run it as planned. The old engine nagged here.
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 1,
      isToday: d.idx === 1,
    }));
    const actualMeters = mi2m(14); // Mon as planned
    const input: ProposeInput = {
      weekTargetMeters: actualMeters, // gap < 0
      actualMeters,
      elapsedFraction: 1 / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 2, // Wed — tomorrow+1, still ahead
    };
    expect(proposeAdaptations(input)).toEqual([]);
  });

  test('quality day IS today, gap ≤ 0 → NO cards (still runnable)', () => {
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 2 && d.type !== 'rest',
      isToday: d.idx === 2,
    }));
    const actualMeters = mi2m(14) + mi2m(20);
    const input: ProposeInput = {
      weekTargetMeters: actualMeters,
      actualMeters,
      elapsedFraction: 2 / 7,
      weekDays,
      qualitySatisfied: false,
      plannedQualityDayIdx: 2, // today — not "already in the past"
    };
    expect(proposeAdaptations(input)).toEqual([]);
  });

  test('gap=0, qualitySatisfied=true → returns [] (no quality_only card)', () => {
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 3,
      isToday: d.idx === 3,
    }));
    const actualMeters = TARGET;
    const input: ProposeInput = {
      weekTargetMeters: actualMeters,
      actualMeters,
      elapsedFraction: 3 / 7,
      weekDays,
      qualitySatisfied: true,
      plannedQualityDayIdx: 2,
    };
    const result = proposeAdaptations(input);
    expect(result).toEqual([]);
  });

  test('gap=0, no qualitySatisfied set → returns [] (no quality KPI info)', () => {
    // When qualitySatisfied is undefined, quality trigger is skipped.
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 3,
      isToday: d.idx === 3,
    }));
    const actualMeters = TARGET;
    const input: ProposeInput = {
      weekTargetMeters: actualMeters,
      actualMeters,
      elapsedFraction: 3 / 7,
      weekDays,
      // no qualitySatisfied
    };
    const result = proposeAdaptations(input);
    expect(result).toEqual([]);
  });

  test('gap=0, qualitySatisfied=false but no plannedQualityDayIdx → returns []', () => {
    const weekDays: WeekDay[] = WEEK_TEMPLATE.map((d) => ({
      ...d,
      hasActivity: d.idx < 3,
      isToday: d.idx === 3,
    }));
    const actualMeters = TARGET;
    const input: ProposeInput = {
      weekTargetMeters: actualMeters,
      actualMeters,
      elapsedFraction: 3 / 7,
      weekDays,
      qualitySatisfied: false,
      // no plannedQualityDayIdx — no quality day was planned
    };
    const result = proposeAdaptations(input);
    expect(result).toEqual([]);
  });
});

// ============================================================
// W91 corpus (study §4/§5) at the proposeAdaptations level
// ============================================================

describe('W91 corpus — propose-level selection (§5, pmHabit 5mi explicit)', () => {
  // Mon e14+6PM · Tue Q14 · Wed e16 · Thu e12 · Fri e9 · Sat L20 · Sun R(row).
  // Target 91. Constants: L=20 · E=16 · M=median(14,14,16,12,9,20)=14 ·
  // DTM=19 · post-long rest cap min(16, 0.6·20)=12 · ABS=max(2%·91,1)=1.82.
  const W91_DATES = [
    '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
    '2026-07-10', '2026-07-11', '2026-07-12',
  ];
  const W91_TEMPLATE: Omit<WeekDay, 'hasActivity' | 'isToday'>[] = [
    { workoutId: 'w0', date: W91_DATES[0]!, idx: 0, type: 'easy',    plannedMeters: mi2m(14), plannedPmMeters: mi2m(6) },
    { workoutId: 'w1', date: W91_DATES[1]!, idx: 1, type: 'quality', plannedMeters: mi2m(14), plannedPmMeters: 0 },
    { workoutId: 'w2', date: W91_DATES[2]!, idx: 2, type: 'easy',    plannedMeters: mi2m(16), plannedPmMeters: 0 },
    { workoutId: 'w3', date: W91_DATES[3]!, idx: 3, type: 'easy',    plannedMeters: mi2m(12), plannedPmMeters: 0 },
    { workoutId: 'w4', date: W91_DATES[4]!, idx: 4, type: 'easy',    plannedMeters: mi2m(9),  plannedPmMeters: 0 },
    { workoutId: 'w5', date: W91_DATES[5]!, idx: 5, type: 'long',    plannedMeters: mi2m(20), plannedPmMeters: 0 },
    { workoutId: 'w6', date: W91_DATES[6]!, idx: 6, type: 'rest',    plannedMeters: 0,        plannedPmMeters: 0 },
  ];

  function w91Input(
    todayIdx: number,
    acts: Record<number, number>,
    opts: { qualitySatisfied?: boolean } = {},
  ): ProposeInput {
    let actualMeters = 0;
    const weekDays: WeekDay[] = W91_TEMPLATE.map((d) => {
      const isPast = d.idx < todayIdx;
      let hasActivity = false;
      if (isPast && d.type !== 'rest') {
        const act = d.idx in acts ? acts[d.idx]! : d.plannedMeters + d.plannedPmMeters;
        if (act > 0) {
          actualMeters += act;
          hasActivity = true;
        }
      }
      return { ...d, hasActivity, isToday: d.idx === todayIdx };
    });
    return {
      weekTargetMeters: mi2m(91),
      actualMeters,
      elapsedFraction: todayIdx / 7,
      weekDays,
      qualitySatisfied: opts.qualitySatisfied ?? false,
      plannedQualityDayIdx: 1,
      qualityDayInfo: { idx: 1, plannedMeters: mi2m(14), workoutId: 'w1', date: W91_DATES[1]! },
      longDayInfo: { idx: 5, plannedMeters: mi2m(20), workoutId: 'w5', date: W91_DATES[5]! },
      // §4 worked example uses the runner's 5mi PM habit (carry-forward #3;
      // real derivation is Task 4's).
      pmHabitMeters: mi2m(5),
    };
  }

  const diffAt = (card: ReflowAdaptation, date: string) => card.diff.find((d) => d.date === date);

  test('T1 (the incident): Realign `Recover 20 · 91` / Keep rest `91→80` / Adjust target `91→71` — exact §6 diffs', () => {
    // Mon (14+6) fully missed, today Tue. D = 91 − 0 − 71 = 20.
    // max: Wed +0 (at E) · Thu 12→14 + PM 5 (trimmed to DTM 19) · Fri 9→11 ·
    //      Sun rest→11 → fully recovered.
    // keep_rest: same minus Sun → recovered 9, conceded 11 → 91→80.
    // v2.4 palette: pure lower_target is the THIRD floor option —
    // reachable = 0 + remaining planned 71 → 91→71.
    const result = proposeAdaptations(w91Input(1, { 0: 0 }));
    expect(result).toHaveLength(3);

    const [primary, secondary] = result as [ReflowAdaptation, ReflowAdaptation];
    expect(primary.kind).toBe('reflow');
    expect(primary.variant).toBe('max');
    expect(primary.title).toBe('Realign');
    expect(primary.detail).toBe('Recover 20 · 91 mi');
    expectNear(primary.recoveredMeters, mi2m(20));
    expect(primary.newTargetMeters).toBeUndefined();

    // §6 diff, one entry per remaining day (Tue..Sun):
    // Tue Q 14→14 · Wed 16→16 · Thu am 12→14 pm 0→5 * · Fri 9→11 * ·
    // Sat L 20→20 · Sun rest 0→11 *
    expect(primary.diff).toHaveLength(6);
    expectDiffDay(diffAt(primary, W91_DATES[1]!), { type: 'quality', fromAm: mi2m(14), toAm: mi2m(14), changed: false });
    expectDiffDay(diffAt(primary, W91_DATES[2]!), { type: 'easy', fromAm: mi2m(16), toAm: mi2m(16), changed: false });
    expectDiffDay(diffAt(primary, W91_DATES[3]!), { type: 'easy', fromAm: mi2m(12), toAm: mi2m(14), toPm: mi2m(5), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[4]!), { type: 'easy', fromAm: mi2m(9), toAm: mi2m(11), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[5]!), { type: 'long', fromAm: mi2m(20), toAm: mi2m(20), changed: false });
    expectDiffDay(diffAt(primary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: mi2m(11), changed: true });

    expect(secondary.kind).toBe('reflow');
    expect(secondary.variant).toBe('keep_rest');
    expect(secondary.title).toBe('Keep rest');
    expect(secondary.detail).toBe('Recover 9 of 20 · 91→80 mi');
    expectNear(secondary.recoveredMeters, mi2m(9));
    expectNear(secondary.newTargetMeters, mi2m(80));
    // Same minus Sun: the rest day stays untouched (rest 0→0, unchanged).
    expectDiffDay(diffAt(secondary, W91_DATES[3]!), { type: 'easy', fromAm: mi2m(12), toAm: mi2m(14), toPm: mi2m(5), changed: true });
    expectDiffDay(diffAt(secondary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: 0, changed: false });

    // THIRD (v2.4): the pure lower_target floor. Sat long still ahead and the
    // quality day is TODAY (not missed) → both chips read kept.
    expect(result[2]?.kind).toBe('lower_target');
    if (result[2]?.kind === 'lower_target') {
      expect(result[2].title).toBe('Adjust this week to 71 mi');
      expect(result[2].detail).toBe('91.0 → 71.0 mi · Long kept · Quality kept');
      // round100(0 + 71 mi) = 114,300 m.
      expect(Math.abs(result[2].edits.newTargetMeters - mi2m(71))).toBeLessThanOrEqual(60);
    }
  });

  test('T2: small shortfall, no missed day → residual closer FULLY recovers `Recover 6 · 91`, lower_target secondary', () => {
    // Mon ran the AM 14 only (PM skipped), today Tue. D = 91 − 14 − 71 = 6.
    // hasMissedRunDay=false. Light fixes: add_double recovers 5 (Thu PM only,
    // Fri pre-long, Wed 16>M) = 83% < 90%; redistribute recovers 5 (Thu +3,
    // Fri +2) = 83% < 90% → heavy path. max: extensions leave D_rem 1 (PM below
    // 2.5 floor, rest below 3, escalation skipped by the Sun rest row); the v2.5
    // residual closer tops Thu 15→16 → FULLY recovered `Recover 6 · 91`
    // (was `Recover 5 of 6 · 91→90` pre-v2.5). Both variants recover the same
    // (no rest lever) → SECONDARY is pure lower_target: reachable = 14 + 71 = 85.
    const result = proposeAdaptations(w91Input(1, { 0: mi2m(14) }));
    expect(result).toHaveLength(2);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.variant).toBe('max');
    expect(primary.detail).toBe('Recover 6 · 91 mi');
    expectNear(primary.recoveredMeters, mi2m(6));
    expect(primary.newTargetMeters).toBeUndefined();
    expectDiffDay(diffAt(primary, W91_DATES[3]!), { type: 'easy', fromAm: mi2m(12), toAm: mi2m(16), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[4]!), { type: 'easy', fromAm: mi2m(9), toAm: mi2m(11), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: 0, changed: false });

    expect(result[1]?.kind).toBe('lower_target');
    if (result[1]?.kind === 'lower_target') {
      // reachable = actual 14 + remaining planned 71 = 85 (round100).
      expect(Math.abs(result[1].edits.newTargetMeters - mi2m(85))).toBeLessThanOrEqual(60);
    }
  });

  test('T3: huge deficit (Mon+Tue missed, Q unsatisfied) → `Q Thu 14 · Fri 11 · Sun rest→12 · 91→73`', () => {
    // Today Wed. D = 91 − 0 − 57 = 34. R5 re-places Q14 on Thu (tie Wed/Thu on
    // |Δ|=2 → smaller day; credit +2). Extensions: Wed +0 (at E), Fri +2. No
    // double (Wed 16>14, Fri pre-long, Thu is now quality). Rest lever: Sun is
    // post-long → cap min(16, 0.6·20=12) → 12. Recovered 2+2+12 = 16 ≥
    // 0.25·34 = 8.5 → max PRIMARY, conceding 18 → 91→73.
    const result = proposeAdaptations(w91Input(2, { 0: 0, 1: 0 }));
    expect(result).toHaveLength(3);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.variant).toBe('max');
    expect(primary.detail).toBe('Recover 16 of 34 · 91→73 mi');
    expectNear(primary.recoveredMeters, mi2m(16));
    expectNear(primary.newTargetMeters, mi2m(73));
    // Diff: Wed 16→16 · Thu Q 12→14 * · Fri 9→11 * · Sat L 20→20 · Sun rest 0→12 *
    expect(primary.diff).toHaveLength(5);
    expectDiffDay(diffAt(primary, W91_DATES[2]!), { type: 'easy', fromAm: mi2m(16), toAm: mi2m(16), changed: false });
    expectDiffDay(diffAt(primary, W91_DATES[3]!), { type: 'quality', fromAm: mi2m(12), toAm: mi2m(14), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[4]!), { type: 'easy', fromAm: mi2m(9), toAm: mi2m(11), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: mi2m(12), changed: true });
    // No PM anywhere (no eligible host).
    expect(primary.diff.every((d) => d.toPmMeters === 0)).toBe(true);

    // SECONDARY keep-rest recovers only 2+2 = 4 → conceded 30 → 91→61.
    const secondary = result[1] as ReflowAdaptation;
    expect(secondary.kind).toBe('reflow');
    expect(secondary.variant).toBe('keep_rest');
    expect(secondary.detail).toBe('Recover 4 of 34 · 91→61 mi');
    expectNear(secondary.recoveredMeters, mi2m(4));
    expectNear(secondary.newTargetMeters, mi2m(61));
    expectDiffDay(diffAt(secondary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: 0, changed: false });

    // THIRD (v2.4): the pure lower_target floor — reachable = 0 + 57 → 91→57.
    // Chips: Sat long ahead (kept), Tue quality missed + unsatisfied (open).
    expect(result[2]?.kind).toBe('lower_target');
    if (result[2]?.kind === 'lower_target') {
      expect(result[2].title).toBe('Adjust this week to 57 mi');
      expect(result[2].detail).toBe('91.0 → 57.0 mi · Long kept · Quality open');
    }
  });

  test('T4: missed quality (unsatisfied), Mon ran 20 → fully recovered `Recover 14 · 91`, Q survives', () => {
    // Today Wed, Mon ran its full 14+6, Tue Q missed. D = 91 − 20 − 57 = 14.
    // R5: Thu → Q14 (+2 credit) · Fri +2 · no double (Thu is quality now,
    // Wed 16>14, Fri pre-long) · Sun rest→min(12, 10) = 10 → FULLY recovered.
    const result = proposeAdaptations(w91Input(2, { 1: 0 }));
    expect(result).toHaveLength(3);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.variant).toBe('max');
    expect(primary.detail).toBe('Recover 14 · 91 mi');
    expectNear(primary.recoveredMeters, mi2m(14));
    expect(primary.newTargetMeters).toBeUndefined();
    expectDiffDay(diffAt(primary, W91_DATES[2]!), { type: 'easy', fromAm: mi2m(16), toAm: mi2m(16), changed: false });
    expectDiffDay(diffAt(primary, W91_DATES[3]!), { type: 'quality', fromAm: mi2m(12), toAm: mi2m(14), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[4]!), { type: 'easy', fromAm: mi2m(9), toAm: mi2m(11), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: mi2m(10), changed: true });

    // SECONDARY keep-rest: recovered 4, conceded 10 → 91→81. Quality survives
    // the week EITHER way (§8b).
    const secondary = result[1] as ReflowAdaptation;
    expect(secondary.variant).toBe('keep_rest');
    expect(secondary.detail).toBe('Recover 4 of 14 · 91→81 mi');
    expectNear(secondary.newTargetMeters, mi2m(81));
    expect(secondary.diff.some((d) => d.type === 'quality' && d.changed)).toBe(true);

    // THIRD (v2.4): lower_target floor — reachable = 20 + 57 → 91→77. The
    // quality is missed + unsatisfied under this card → open.
    expect(result[2]?.kind).toBe('lower_target');
    if (result[2]?.kind === 'lower_target') {
      expect(result[2].title).toBe('Adjust this week to 77 mi');
      expect(result[2].detail).toBe('91.0 → 77.0 mi · Long kept · Quality open');
    }
  });

  test('T5: missed quality but SATISFIED → mileage-only, Thu 14+5 double, no quality anywhere', () => {
    // Same as T4 with qualitySatisfied=true → R5 skipped. D = 14.
    // Extensions Thu +3, Fri +2 · double on Thu → trim to 14+5 (=19 ≤ DTM) ·
    // Sun rest→5 → FULLY recovered.
    const result = proposeAdaptations(w91Input(2, { 1: 0 }, { qualitySatisfied: true }));
    expect(result).toHaveLength(3);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.detail).toBe('Recover 14 · 91 mi');
    expectNear(primary.recoveredMeters, mi2m(14));
    expect(primary.newTargetMeters).toBeUndefined();
    // No quality label anywhere in the proposal.
    expect(primary.diff.some((d) => d.type === 'quality')).toBe(false);
    expectDiffDay(diffAt(primary, W91_DATES[3]!), { type: 'easy', fromAm: mi2m(12), toAm: mi2m(14), toPm: mi2m(5), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[4]!), { type: 'easy', fromAm: mi2m(9), toAm: mi2m(11), changed: true });
    expectDiffDay(diffAt(primary, W91_DATES[6]!), { type: 'rest', fromAm: 0, toAm: mi2m(5), changed: true });

    // SECONDARY keep-rest: recovered 9 (3−1 trim +2 +5), conceded 5 → 91→86.
    const secondary = result[1] as ReflowAdaptation;
    expect(secondary.variant).toBe('keep_rest');
    expect(secondary.detail).toBe('Recover 9 of 14 · 91→86 mi');
    expectNear(secondary.newTargetMeters, mi2m(86));

    // THIRD (v2.4): lower_target floor — same reachable 77 as T4, but the
    // missed quality day is SATISFIED elsewhere → chip reads kept.
    expect(result[2]?.kind).toBe('lower_target');
    if (result[2]?.kind === 'lower_target') {
      expect(result[2].title).toBe('Adjust this week to 77 mi');
      expect(result[2].detail).toBe('91.0 → 77.0 mi · Long kept · Quality kept');
    }
  });
});

// ============================================================
// v2.3 amendments (panel round 1) — propose-level selection
// ============================================================

describe('v2.3 amendments — propose level', () => {
  const DATES = [
    '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
    '2026-07-10', '2026-07-11', '2026-07-12',
  ];

  /** Generic template builder: [type, planned mi] per day, w0..w6 rows. */
  function mkInput(
    days: [WeekDay['type'], number][],
    todayIdx: number,
    acts: Record<number, number>,
    targetMi: number,
    extra: Partial<ProposeInput> = {},
  ): ProposeInput {
    let actualMeters = 0;
    const weekDays: WeekDay[] = days.map(([type, planned], idx) => {
      const isPast = idx < todayIdx;
      let hasActivity = false;
      if (isPast && type !== 'rest') {
        const act = idx in acts ? acts[idx]! : mi2m(planned);
        if (act > 0) {
          actualMeters += act;
          hasActivity = true;
        }
      }
      return {
        workoutId: `w${idx}`,
        date: DATES[idx]!,
        idx,
        type,
        plannedMeters: mi2m(planned),
        plannedPmMeters: 0,
        hasActivity,
        isToday: idx === todayIdx,
      };
    });
    return {
      weekTargetMeters: mi2m(targetMi),
      actualMeters,
      elapsedFraction: todayIdx / 7,
      weekDays,
      ...extra,
    };
  }

  test('W50-missLong-t6: reflow PRIMARY re-placing the long (flagged); lower_target chips are honest', () => {
    // W50: Mon e6 ✓ · Tue Q8 ✓ · Wed e7 ✓ · Thu e6 ✓ · Fri e5 ✓ · Sat L14
    // MISSED · Sun e4 (today). D = 50−32−4 = 14.
    // Pre-v2.3 (eval round 2): lower_target led and the reflow recovered 1 —
    // the long was conceded while an obvious host existed. v2.3: Sun hosts
    // the full L14 (flagged: 4 < 7); recovered 10 ≥ max(0.25·14, 1) → the
    // re-placing reflow LEADS with 50→46.
    const input = mkInput(
      [['easy', 6], ['quality', 8], ['easy', 7], ['easy', 6], ['easy', 5], ['long', 14], ['easy', 4]],
      6,
      { 5: 0 },
      50,
      {
        qualitySatisfied: true,
        plannedQualityDayIdx: 1,
        qualityDayInfo: { idx: 1, plannedMeters: mi2m(8), workoutId: 'w1', date: DATES[1]! },
        longDayInfo: { idx: 5, plannedMeters: mi2m(14), workoutId: 'w5', date: DATES[5]! },
      },
    );
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(2);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.variant).toBe('max');
    expect(primary.detail).toBe('Recover 10 of 14 · 50→46 mi');
    expect(primary.longReplaceFlagged).toBe(true);
    expectNear(primary.recoveredMeters, mi2m(10));
    expectNear(primary.newTargetMeters, mi2m(46));
    // Diff: only Sun remains — easy 4 → LONG 14.
    expect(primary.diff).toHaveLength(1);
    expectDiffDay(primary.diff[0], { type: 'long', fromAm: mi2m(4), toAm: mi2m(14), changed: true });

    // Secondary lower_target: reachable = 32+4 = 36. v2.3 chips — the long is
    // missed-and-open under this card (never "protect long + quality").
    expect(result[1]?.kind).toBe('lower_target');
    if (result[1]?.kind === 'lower_target') {
      expect(result[1].detail).toBe('50.0 → 36.0 mi · Long open · Quality kept');
    }
  });

  test('W70-race-missQ-t2: tune-up quality card leads via session-value ranking; post-race day frozen', () => {
    // W70 race variant: Sat = race 18. Tue Q11 missed (unsat), today Wed.
    // actual = 10. D = 70−10−49 = 11. Engine (see reflow test): Wed hosts the
    // tune-up Q7 (0.6·11), Thu +2, Fri pre-race + Sun post-race untouched →
    // recovered −3, newTarget 56, feasible FALSE. v2.3 ranking: the card
    // re-placed a key session → exempt from demotion, value = the re-placed
    // session's 7 ≥ max(0.25·11 = 2.75, ABS) → reflow PRIMARY.
    const input = mkInput(
      [['easy', 10], ['quality', 11], ['easy', 12], ['easy', 8], ['easy', 7], ['race', 18], ['easy', 4]],
      2,
      { 1: 0 },
      70,
      {
        qualitySatisfied: false,
        plannedQualityDayIdx: 1,
        qualityDayInfo: { idx: 1, plannedMeters: mi2m(11), workoutId: 'w1', date: DATES[1]! },
      },
    );
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(2);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.variant).toBe('max');
    expectNear(primary.recoveredMeters, mi2m(-3));
    expectNear(primary.newTargetMeters, mi2m(56));
    // Diff: Wed Q 12→7 * · Thu 8→10 * · Fri 7→7 (pre-race) · Sat race 18→18 ·
    // Sun 4→4 (post-race cap-frozen — pre-v2.3 it took +1).
    expect(primary.diff).toHaveLength(5);
    const at = (d: string) => primary.diff.find((x) => x.date === d);
    expectDiffDay(at(DATES[2]!), { type: 'quality', fromAm: mi2m(12), toAm: mi2m(7), changed: true });
    expectDiffDay(at(DATES[3]!), { type: 'easy', fromAm: mi2m(8), toAm: mi2m(10), changed: true });
    expectDiffDay(at(DATES[4]!), { type: 'easy', fromAm: mi2m(7), toAm: mi2m(7), changed: false });
    expectDiffDay(at(DATES[5]!), { type: 'race', fromAm: mi2m(18), toAm: mi2m(18), changed: false });
    expectDiffDay(at(DATES[6]!), { type: 'easy', fromAm: mi2m(4), toAm: mi2m(4), changed: false });
    // No swap machinery in a race week.
    expect(primary.diff.every((d) => d.swappedWith === undefined)).toBe(true);

    // Secondary lower_target: reachable = 10+49 = 59; no long-type day in a
    // race week → single honest chip.
    expect(result[1]?.kind).toBe('lower_target');
    if (result[1]?.kind === 'lower_target') {
      expect(result[1].detail).toBe('70.0 → 59.0 mi · Quality open');
    }
  });

  test('W70-miss-Fri-t5: last-lever escalation + residual closer carry the reflow to primary (Sun 4→11)', () => {
    // Mon-Thu ran (41), Fri e7 missed, today Sat. D = 7. Engine: Sun ext +1
    // then escalates to 10 under 0.6·18 (see reflow test), leaving a 1 mi
    // residual that the v2.5 closer tops onto Sun (10→11) → recovered 7,
    // FULLY recovered `Recover 7 · 70` (was `Recover 6 of 7 · 70→69` pre-v2.5).
    // No rest day ever fired → secondary is pure lower_target (reachable 63).
    const input = mkInput(
      [['easy', 10], ['quality', 11], ['easy', 12], ['easy', 8], ['easy', 7], ['long', 18], ['easy', 4]],
      5,
      { 4: 0 },
      70,
      {
        qualitySatisfied: true,
        plannedQualityDayIdx: 1,
        qualityDayInfo: { idx: 1, plannedMeters: mi2m(11), workoutId: 'w1', date: DATES[1]! },
        longDayInfo: { idx: 5, plannedMeters: mi2m(18), workoutId: 'w5', date: DATES[5]! },
      },
    );
    const result = proposeAdaptations(input);
    expect(result).toHaveLength(2);
    const primary = result[0] as ReflowAdaptation;
    expect(primary.kind).toBe('reflow');
    expect(primary.detail).toBe('Recover 7 · 70 mi');
    expect(primary.newTargetMeters).toBeUndefined();
    const sun = primary.diff.find((d) => d.date === DATES[6]);
    expectDiffDay(sun, { type: 'easy', fromAm: mi2m(4), toAm: mi2m(11), changed: true });
    expect(result[1]?.kind).toBe('lower_target');
    if (result[1]?.kind === 'lower_target') {
      expect(result[1].detail).toBe('70.0 → 63.0 mi · Long kept · Quality kept');
    }
  });
});

// ============================================================
// v2.3.1 M1 fix: session-value exemption keys off ENGINE re-place
// facts, never arrangement inference (a kept 2nd long must not rank
// a card whose missed long was actually conceded)
// ============================================================

describe('v2.3.1 M1 - kept second long never feeds the session-value exemption', () => {
  // Two-long week: Mon L10 (the plan's tracked longDayInfo) MISSED, Sat L22
  // still ahead and KEPT. Every easy day is hard-adjacent (Tue/Thu touch the
  // Wed quality, Fri/Sun touch the Sat long) and there is no rest row, so R6
  // has no host -> the missed long is CONCEDED. Quality is satisfied (no R5).
  // Target 90: D = 90 - 0 - 54 = 36mi. Recovery is tiny (E = 6mi easy days
  // cap all extensions at 0; escalation capped at E) -> ratio fails on real
  // mileage. Pre-fix, arrangement inference found the KEPT Sat 22 long and
  // ranked the reflow card off a session it never recovered -> reflow led.
  // Post-fix longReplaced is null -> lower_target must lead.
  const DATES = ['2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-21'];
  const DEFS = [
    { type: 'long' as const,    planned: mi2m(10), workoutId: 'y0' },
    { type: 'easy' as const,    planned: mi2m(6),  workoutId: 'y1' },
    { type: 'quality' as const, planned: mi2m(8),  workoutId: 'y2' },
    { type: 'easy' as const,    planned: mi2m(6),  workoutId: 'y3' },
    { type: 'easy' as const,    planned: mi2m(6),  workoutId: 'y4' },
    { type: 'long' as const,    planned: mi2m(22), workoutId: 'y5' },
    { type: 'easy' as const,    planned: mi2m(6),  workoutId: 'y6' },
  ];

  test('conceded missed long -> lower_target primary (no exemption from the kept Sat long)', () => {
    const weekDays: WeekDay[] = DEFS.map((d, i) => ({
      workoutId: d.workoutId,
      date: DATES[i]!,
      idx: i,
      type: d.type,
      plannedMeters: d.planned,
      plannedPmMeters: 0,
      hasActivity: false,
      isToday: i === 1,
    }));
    const input: ProposeInput = {
      weekTargetMeters: mi2m(90),
      actualMeters: 0,
      elapsedFraction: 1 / 7,
      weekDays,
      qualitySatisfied: true,
      longDayInfo: { idx: 0, plannedMeters: mi2m(10), workoutId: 'y0', date: DATES[0]! },
      pmHabitMeters: null,
    };
    const out = proposeAdaptations(input);
    expect(out.length).toBeGreaterThan(0);
    // The missed Mon long has no eligible host (all easies hard-adjacent, no
    // rest row) -> conceded -> NO session-value exemption -> the tiny mileage
    // recovery cannot lead: lower_target is primary.
    expect(out[0]!.kind).toBe('lower_target');
    // The kept Sat 22 long must never surface as a "recovered" session: any
    // reflow card present is secondary and unflagged for long re-place.
    const reflow = out.find((a) => a.kind === 'reflow');
    if (reflow && reflow.kind === 'reflow') {
      expect(reflow.diff.some((d) => d.type === 'long' && d.changed)).toBe(false);
    }
  });
});
