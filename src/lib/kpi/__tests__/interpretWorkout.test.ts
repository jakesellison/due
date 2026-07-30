/**
 * interpretWorkout.test.ts — the six pinned fixtures over the STREAM-features
 * engine (moving-time-corrected ~100 m distance bins; laps + watch-pauses as
 * boundary SIGNALS, so a run with <2 laps is still segmented).
 *
 * Design contract under test (see the design doc): DETECT BROADLY, PREFER
 * PRESCRIBED.
 *  - `honest` (no plan): plan-agnostic broad net — it DETECTS quality on every
 *    workout (kind ≠ 'none') and stays 'none' on a genuine easy run. It may
 *    mis-SHAPE a near-floor continuous effort at fine granularity (that's what
 *    the plan + slider resolve), so honest asserts detection, not exact kind.
 *  - `matched` (with the day's prescription): the plan reshapes/selects the
 *    candidate so the credited read matches what was prescribed — a continuous
 *    "Q mi" block, or N reps — but only when the data supports it (never
 *    fabricated).
 */
import fs from 'fs';
import path from 'path';
import {
  buildGap,
} from '../gap';
import {
  interpretOne,
  interpretWorkout,
  type QualityFloorRefs,
  type Reading,
  type PlanQuality,
} from '../interpretWorkout';
import type { RunStream } from '../qualityDetect';

const streams = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/streams.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fixtures.json'), 'utf8'));

const REFS: QualityFloorRefs = {
  easyPaceSecPerMi: 500,
  paceFloorSecPerMi: 455,
  hrFloor: 148,
  qualityFloorSecPerMi: 435,
};

function toStream(s: { d: number[]; v: number[]; t: number[]; hr?: number[]; alt?: number[] }): RunStream {
  return { d: s.d, v: s.v, t: s.t, hr: s.hr, altitude: s.alt };
}
function build(activityId: string) {
  const s = streams[activityId];
  return { s, laps: fixtures[activityId].laps, gap: buildGap(s) };
}

const C = {
  mp0712: 'c4629fff-4d92-4ebd-ab04-1c45e3b17a28', // 07-12 MP long run, 10mi block
  mp0620: '9c6b867d-a41d-458d-9224-71951fea714c', // 06-20 MP long run, 8mi block
  reps0623: 'bd167a15-a5f4-4b90-8bc6-fa87fe7f44f2', // 06-23 4×2mi
  track0630: '473a29f3-8b47-45f2-bfb6-4368b75a65db', // 06-30 4×200+2×300
  hill0710: '8c2255ec-12ad-498b-aa00-29127289c174', // 07-10 6×600 hill
  easy0707: 'd4e07d6d-22a7-459e-b99c-86d81b21ef9e', // 07-07 easy-that-felt-hard (negative)
};

// The day's prescription for each workout fixture (kind + prescribed quality mi).
const PLANS: Record<string, PlanQuality & { tol: number | null }> = {
  [C.mp0712]: { kind: 'tempo', qualityMi: 10, workoutId: 'w', tol: 1.5 },
  [C.mp0620]: { kind: 'tempo', qualityMi: 8, workoutId: 'w', tol: 1.5 },
  [C.reps0623]: { kind: 'intervals', qualityMi: 8, reps: 4, repDistancesMi: [2, 2, 2, 2], workoutId: 'w', tol: null },
  [C.track0630]: {
    kind: 'intervals', qualityMi: 1.3, reps: 6,
    repDistancesMi: [200, 200, 200, 200, 300, 300].map((m) => m / 1609.344),
    workoutId: 'w', tol: null,
  },
  [C.hill0710]: {
    kind: 'intervals', qualityMi: 2.2, reps: 6,
    repDistancesMi: Array(6).fill(600 / 1609.344), workoutId: 'w', tol: null,
  },
};

describe('honest read (no plan) — detect broadly', () => {
  test.each(Object.values(C).filter((id) => id !== C.easy0707))('%s detects quality (kind ≠ none)', (id) => {
    const { s, laps, gap } = build(id);
    expect(interpretOne(toStream(s), laps, gap, REFS).kind).not.toBe('none');
  });

  test('07-07 easy-that-felt-hard stays none', () => {
    const { s, laps, gap } = build(C.easy0707);
    expect(interpretOne(toStream(s), laps, gap, REFS).kind).toBe('none');
  });
});

describe('matched read (with prescription) — prefer prescribed', () => {
  test.each(Object.keys(PLANS))('%s matches its prescription', (id) => {
    const { s, laps, gap } = build(id);
    const plan = PLANS[id]!;
    const matched = interpretWorkout(toStream(s), laps, gap, REFS, plan).matched;
    expect(matched?.matchesPlan).toBe(true);
    expect(matched!.kind).toBe(plan.kind);
    if (plan.tol != null) {
      expect(Math.abs(matched!.qualityMi - plan.qualityMi)).toBeLessThanOrEqual(plan.tol);
    }
  });

  test.each([
    [C.reps0623, 4, /^4×2mi/],
    [C.track0630, 6, /^4×200m .* \+ 2×300m/],
    [C.hill0710, 6, /^6×600m/],
  ] as const)('%s keeps its lap-proven rep structure', (id, count, summary) => {
    const { s, laps, gap } = build(id);
    const matched = interpretWorkout(toStream(s), laps, gap, REFS, PLANS[id]!).matched;
    expect(matched?.planAligned).toBe(true);
    expect(matched?.source).toBe('laps');
    expect(matched?.blocks).toHaveLength(count);
    expect(matched?.summary).toMatch(summary);
    expect(matched?.alignmentConfidence).toBeGreaterThan(0.8);
  });
});

describe('interpretWorkout — CROPS ladder + no-laps + no-plan', () => {
  test('06-23 yields a distinct candidate ladder including intervals', () => {
    const { s, laps, gap } = build(C.reps0623);
    const result = interpretWorkout(toStream(s), laps, gap, REFS);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result.candidates.some((c: Reading) => c.kind === 'intervals')).toBe(true);
    expect(result.honest).toBe(result.candidates[result.defaultIdx]);
  });

  test('06-23 STILL reads intervals with NO laps (stream-unit fix)', () => {
    const { s, gap } = build(C.reps0623);
    // The OLD per-lap interpreter returned `none` with <2 laps; the stream engine must not.
    expect(interpretWorkout(toStream(s), [], gap, REFS).honest.kind).toBe('intervals');
  });

  test('no plan → matched === null', () => {
    const { s, laps, gap } = build(C.mp0712);
    expect(interpretWorkout(toStream(s), laps, gap, REFS, null).matched).toBeNull();
  });

  test('a plan cannot fabricate quality on an easy run (07-07)', () => {
    const { s, laps, gap } = build(C.easy0707);
    const result = interpretWorkout(toStream(s), laps, gap, REFS, { kind: 'tempo', qualityMi: 6, workoutId: 'w' });
    expect(result.matched).toBeNull();
  });
});

/**
 * The candidate ladder is the runner's correction affordance: if the engine
 * mis-shapes a run, these are the alternatives offered. That only works when the
 * options are things a person can tell apart.
 *
 * Regression: `automaticReading` and the plan-aligned interval candidate are
 * pushed without the boundary-signature dedup the K-sweep applies, so a matched
 * interval session listed near-twins — four rows reading "5×2mi @ 6:00 / 5×2mi
 * @ 6:00 / 5×2mi @ 6:01 / 5×2mi @ 6:01". Candidates are now collapsed on their
 * structural claim, so every row states a genuinely different reading.
 */
describe('candidate ladder — every option is distinguishable', () => {
  const planned = Object.entries(PLANS) as Array<[string, PlanQuality]>;

  // With a plan, ONE duplicate pair is legitimate and load-bearing: the
  // automatic evidence read and the plan-aligned read can describe the same
  // session while only the latter carries `source: 'laps'` + alignment
  // confidence. The engine keeps both because dropping either changes what the
  // run credits; the run-detail list collapses them for display, since the
  // runner is choosing a reading, not a provenance.
  test.each(planned)('%s repeats a summary only as the aligned/automatic pair', (id, plan) => {
    const { s, laps, gap } = build(id);
    const real = interpretWorkout(toStream(s), laps, gap, REFS, plan)
      .candidates.filter((c: Reading) => c.kind !== 'none');
    const groups = new Map<string, Reading[]>();
    for (const c of real) groups.set(c.summary, [...(groups.get(c.summary) ?? []), c]);
    for (const [summary, group] of groups) {
      if (group.length === 1) continue;
      expect({ summary, count: group.length }).toEqual({ summary, count: 2 });
      expect(group.filter((c) => c.planAligned === true)).toHaveLength(1);
    }
  });

  test.each(Object.values(C))('%s offers no duplicate summaries (no plan)', (id) => {
    const { s, laps, gap } = build(id);
    const summaries = interpretWorkout(toStream(s), laps, gap, REFS)
      .candidates.filter((c: Reading) => c.kind !== 'none')
      .map((c: Reading) => c.summary);
    expect(summaries).toEqual([...new Set(summaries)]);
  });

  test('collapsing near-twins does not empty the ladder or break the default', () => {
    // Dedup must not cost the invariants the rest of the engine relies on:
    // `honest` is still the object at `defaultIdx`, and a real workout still
    // offers at least one readable interpretation.
    for (const [id, plan] of planned) {
      const { s, laps, gap } = build(id);
      const r = interpretWorkout(toStream(s), laps, gap, REFS, plan);
      expect(r.candidates.length).toBeGreaterThan(0);
      expect(r.honest).toBe(r.candidates[r.defaultIdx]);
      expect(r.candidates.some((c: Reading) => c.kind !== 'none')).toBe(true);
    }
  });

  test('genuinely different readings are still offered separately (07-12)', () => {
    // The affordance has to survive the fix: collapsing near-twins must not
    // collapse real alternatives, or there is nothing left to correct WITH.
    // 07-12 is a 10mi block inside a long run — legitimately readable as one
    // sustained effort OR as a broken-up set, and the runner should get to say.
    const { s, laps, gap } = build(C.mp0712);
    const real = interpretWorkout(toStream(s), laps, gap, REFS)
      .candidates.filter((c: Reading) => c.kind !== 'none');
    expect(real.length).toBeGreaterThanOrEqual(2);
    expect(new Set(real.map((c: Reading) => c.kind)).size).toBeGreaterThanOrEqual(2);
  });

  test('the plan-aligned reading is never collapsed away (it carries lap metrics)', () => {
    // Regression guard for the fix itself: an earlier version of the dedup
    // ranked the automatic read above the plan-aligned one, dropped the aligned
    // candidate as a structural twin, and silently cost `matched` its
    // `source: 'laps'` and alignment confidence.
    for (const id of [C.reps0623, C.track0630, C.hill0710]) {
      const { s, laps, gap } = build(id);
      const r = interpretWorkout(toStream(s), laps, gap, REFS, PLANS[id]!);
      expect(r.candidates.some((c: Reading) => c.planAligned === true)).toBe(true);
      expect(r.matched?.planAligned).toBe(true);
    }
  });
});

describe('honest-read precision floor (v9) — credit gate, not a segmentation gate', () => {
  // 06-30 is a real but SHORT session (4×200 + 2×300 ≈ 0.87 mi banked). The raw
  // segmentation detects it, but as an UNPRESCRIBED honest read it banks < 1 mi,
  // so the credited honest default is `none` — the guard that stops a couple of
  // surges on an easy run from crediting as intervals.
  test('interpretOne still DETECTS the short effort (segmentation unchanged)', () => {
    const { s, laps, gap } = build(C.track0630);
    const raw = interpretOne(toStream(s), laps, gap, REFS);
    expect(raw.kind).not.toBe('none');
    expect(raw.qualityMi).toBeLessThan(1.0); // the reason the honest credit is gated
  });

  test('unprescribed honest read of the sub-1mi effort credits none', () => {
    const { s, laps, gap } = build(C.track0630);
    const result = interpretWorkout(toStream(s), laps, gap, REFS); // no plan
    expect(result.honest.kind).toBe('none');
    expect(result.honest).toBe(result.candidates[result.defaultIdx]); // invariant holds
  });

  test('but the ungated candidate ladder retains the rich reading', () => {
    const { s, laps, gap } = build(C.track0630);
    const result = interpretWorkout(toStream(s), laps, gap, REFS);
    expect(result.candidates.some((c: Reading) => c.kind !== 'none')).toBe(true);
  });

  test('and a matching short PRESCRIPTION still credits it via matched', () => {
    const { s, laps, gap } = build(C.track0630);
    const plan = PLANS[C.track0630]!;
    const result = interpretWorkout(toStream(s), laps, gap, REFS, plan);
    expect(result.honest.kind).toBe('none'); // honest stays gated…
    expect(result.matched?.matchesPlan).toBe(true); // …but the plan rescues the credit
    expect(result.matched!.kind).toBe('intervals');
  });
});
