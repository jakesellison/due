/**
 * reflowSim.ts — a scenario harness for the plan-realignment engine.
 *
 * Builds realistic "behind" weeks (varying deficit size, where today falls, and
 * the state of the quality + long sessions), runs each through the REAL
 * `proposeAdaptations`, and grades the primary "Recover fully" proposal on four
 * axes: MILEAGE recovery, QUALITY handling, LONG-run handling, and SAFETY. The
 * goal is coverage — surface where realignment is well-considered and where it
 * isn't — not a pass/fail gate. Pure; the jest runner renders these to HTML.
 */
import {
  proposeAdaptations,
  type Adaptation,
  type ReflowAdaptation,
  type WeekDay,
} from '../propose';

const MI = 1609.344;
const mi = (n: number) => Math.round(n * MI);
const toMi = (m: number) => Math.round(m / MI);

export type DayType = 'easy' | 'quality' | 'long' | 'rest';

/** One day of a scenario week (Mon-first). `pm` = a planned PM double. */
export interface SimDay {
  type: DayType;
  mi: number;
  pm?: number;
}

export interface Scenario {
  name: string;
  group: 'Mileage' | 'Quality' | 'Long' | 'Combined';
  note: string;
  days: SimDay[]; // exactly 7, Mon..Sun
  todayIdx: number; // 0=Mon..6=Sun
  /** Logged activity miles per PAST-day idx. A past non-rest day absent here = MISSED (0). */
  logged: Record<number, number>;
  /** Did the week's quality session actually count (detected)? Default false. */
  qualitySatisfied?: boolean;
}

const DATES = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Scenario → ProposeInput ──────────────────────────────────────────────────

export interface BuiltScenario {
  scenario: Scenario;
  targetMeters: number;
  actualMeters: number;
  deficitMeters: number;
  proposals: Adaptation[];
}

export function runScenario(s: Scenario): BuiltScenario {
  const target = s.days.reduce((a, d) => a + mi(d.mi) + mi(d.pm ?? 0), 0);
  let actual = 0;
  const weekDays: WeekDay[] = s.days.map((d, i) => {
    const past = i < s.todayIdx;
    const logged = past && d.type !== 'rest' ? mi(s.logged[i] ?? 0) : 0;
    if (logged > 0) actual += logged;
    return {
      workoutId: `w${i}`,
      date: DATES[i]!,
      idx: i,
      type: d.type,
      plannedMeters: mi(d.mi),
      plannedPmMeters: mi(d.pm ?? 0),
      hasActivity: logged > 0,
      isToday: i === s.todayIdx,
    };
  });

  const qIdx = s.days.findIndex((d) => d.type === 'quality');
  const lIdx = s.days.findIndex((d) => d.type === 'long');
  const pmHabit = s.days.find((d) => (d.pm ?? 0) > 0);

  const input = {
    weekTargetMeters: target,
    actualMeters: actual,
    elapsedFraction: s.todayIdx / 7,
    weekDays,
    pmHabitMeters: pmHabit ? mi(pmHabit.pm!) : null,
    ...(qIdx >= 0
      ? {
          qualitySatisfied: s.qualitySatisfied ?? false,
          plannedQualityDayIdx: qIdx,
          qualityDayInfo: { idx: qIdx, plannedMeters: mi(s.days[qIdx]!.mi), workoutId: `w${qIdx}`, date: DATES[qIdx]! },
        }
      : {}),
    ...(lIdx >= 0
      ? { longDayInfo: { idx: lIdx, plannedMeters: mi(s.days[lIdx]!.mi), workoutId: `w${lIdx}`, date: DATES[lIdx]! } }
      : {}),
  };

  return {
    scenario: s,
    targetMeters: target,
    actualMeters: actual,
    deficitMeters: Math.max(0, target - actual - s.days.slice(s.todayIdx).reduce((a, d) => a + mi(d.mi) + mi(d.pm ?? 0), 0) + 0),
    proposals: proposeAdaptations(input),
  };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export type Level = 'ok' | 'warn' | 'bad' | 'na';
export interface Verdict {
  level: Level;
  text: string;
}
export interface Grade {
  reflow: ReflowAdaptation | null;
  variantLabels: string[];
  mileage: Verdict;
  quality: Verdict;
  long: Verdict;
  safety: Verdict;
}

const EPS = 0.4 * MI;

function reflowOf(props: Adaptation[], variant: 'max' | 'keep_rest'): ReflowAdaptation | null {
  return (props.find((p) => p.kind === 'reflow' && p.variant === variant) as ReflowAdaptation) ?? null;
}

/** Whether a remaining easy day exists that R5 could safely host quality on
 *  (not adjacent to the long day). Mirrors the engine's own eligibility so the
 *  evaluator can tell "correctly conceded" from "should have restored". */
function safeQualitySlotExists(s: Scenario): boolean {
  const lIdx = s.days.findIndex((d) => d.type === 'long');
  return s.days.some((d, i) => i >= s.todayIdx && d.type === 'easy' && Math.abs(i - lIdx) !== 1);
}

export function grade(b: BuiltScenario): Grade {
  const s = b.scenario;
  const max = reflowOf(b.proposals, 'max');
  const keep = reflowOf(b.proposals, 'keep_rest');
  const lower = b.proposals.find((p) => p.kind === 'lower_target');
  const variantLabels = [
    max ? 'Recover fully' : null,
    keep ? 'Keep rest day' : null,
    lower ? 'Adjust target' : null,
    b.proposals.find((p) => p.kind === 'quality_only') ? 'Quality-only' : null,
    b.proposals.find((p) => p.kind === 'redistribute') ? 'Redistribute' : null,
  ].filter((x): x is string => x != null);

  // ── Mileage ──
  let mileage: Verdict;
  if (!max) {
    const lt = lower as { edits: { newTargetMeters: number } } | undefined;
    const qOnlyActionable = b.proposals.some((p) => p.kind === 'quality_only' && 'replace' in p && p.replace != null);
    if (qOnlyActionable) mileage = { level: 'ok', text: 'On pace — no mileage recovery needed' };
    else
      mileage = b.proposals.length
        ? { level: 'warn', text: `No reflow — ${variantLabels.join(', ') || 'other'}${lt ? ` (target ${toMi(lt.edits.newTargetMeters)})` : ''}` }
        : { level: 'na', text: 'No proposal (not behind enough)' };
  } else if (max.newTargetMeters == null) {
    mileage = { level: 'ok', text: `Full recovery · +${toMi(max.recoveredMeters)} mi → ${toMi(b.targetMeters)}` };
  } else {
    const conceded = toMi(max.deficitMeters - max.recoveredMeters);
    mileage = { level: 'warn', text: `Concedes ${conceded} mi → ${toMi(max.newTargetMeters)} (capacity-limited)` };
  }

  // ── Quality ──
  const qIdx = s.days.findIndex((d) => d.type === 'quality');
  let quality: Verdict;
  if (qIdx < 0) {
    quality = { level: 'na', text: 'No quality this week' };
  } else if (qIdx >= s.todayIdx) {
    quality = { level: 'ok', text: `Still ahead (${DOW[qIdx]}) — left alone` };
  } else if (s.qualitySatisfied) {
    quality = { level: 'ok', text: 'Already banked' };
  } else {
    // Missing (past & unsatisfied).
    const restored = max?.qualityBanked === true || max?.diff.some((d) => d.type === 'quality' && d.toAmMeters > EPS);
    const qOnly = b.proposals.find((p) => p.kind === 'quality_only') as
      | { replace?: { date: string; toMeters: number } }
      | undefined;
    if (restored) quality = { level: 'ok', text: 'Re-placed onto a safe day (reflow)' };
    else if (!max && qOnly?.replace)
      // Mileage on pace, no reflow — but the quality-only card is now ACTIONABLE:
      // it offers to re-place the missed quality onto the safe slot.
      quality = { level: 'ok', text: `Re-place offered (${qOnly.replace.date.slice(5)}, ${toMi(qOnly.replace.toMeters)} mi)` };
    else if (!max)
      quality = { level: 'warn', text: qOnly ? 'Informational only — no safe slot to offer' : 'Missing; no card' };
    else if (safeQualitySlotExists(s)) quality = { level: 'bad', text: 'MISSED — a safe slot existed but reflow left it out' };
    else quality = { level: 'ok', text: 'Conceded — no safe (non-long-adjacent) slot' };
  }

  // ── Long ──
  const lIdx = s.days.findIndex((d) => d.type === 'long');
  let long: Verdict;
  if (lIdx < 0) {
    long = { level: 'na', text: 'No long this week' };
  } else if (lIdx >= s.todayIdx) {
    // Upcoming — must be preserved at ~planned distance.
    const ld = max?.diff.find((d) => d.date === DATES[lIdx]);
    if (!max) long = { level: 'na', text: 'No reflow' };
    else if (ld && ld.toAmMeters + EPS < mi(s.days[lIdx]!.mi)) long = { level: 'bad', text: `Long shrunk ${toMi(ld.toAmMeters)}/${s.days[lIdx]!.mi} mi` };
    else long = { level: 'ok', text: `Preserved (${s.days[lIdx]!.mi} mi ${DOW[lIdx]})` };
  } else if (!s.logged[lIdx]) {
    // Past & missed — did it re-place or concede?
    const replaced = max?.diff.some((d) => d.type === 'long' && d.toAmMeters > EPS);
    long = replaced ? { level: 'ok', text: 'Missed long re-placed' } : { level: 'warn', text: 'Missed long — conceded' };
  } else {
    long = { level: 'ok', text: 'Long already done' };
  }

  // ── Safety: no runaway day, no back-to-back hard in the proposal ──
  let safety: Verdict = { level: 'ok', text: 'Within caps; no back-to-back hard' };
  if (max) {
    const runaway = max.diff.find((d) => {
      const orig = s.days[DATES.indexOf(d.date)];
      return orig && orig.type !== 'rest' && d.toAmMeters > 1.4 * mi(orig.mi) + EPS;
    });
    const hardIdx = max.diff
      .filter((d) => d.type === 'quality' || d.type === 'long' || d.type === 'race')
      .map((d) => DATES.indexOf(d.date))
      .sort((a, z) => a - z);
    const backToBack = hardIdx.some((v, i) => i > 0 && v - hardIdx[i - 1]! === 1);
    if (runaway) safety = { level: 'bad', text: `Runaway day ${DOW[DATES.indexOf(runaway.date)]} ${toMi(runaway.toAmMeters)} mi` };
    else if (backToBack) safety = { level: 'bad', text: 'Back-to-back hard days' };
  } else {
    safety = { level: 'na', text: '—' };
  }

  return { reflow: max, variantLabels, mileage, quality, long, safety };
}

// ── The scenario grid ────────────────────────────────────────────────────────
// A typical marathon week shape: Mon easy · Tue quality · Wed easy · Thu easy ·
// Fri easy · Sat long · Sun rest. Scenarios vary deficit, today, and the
// quality/long state. `logged` omits missed days (they read as 0).

const Q = (n: number): SimDay => ({ type: 'quality', mi: n });
const E = (n: number, pm?: number): SimDay => ({ type: 'easy', mi: n, pm });
const L = (n: number): SimDay => ({ type: 'long', mi: n });
const R: SimDay = { type: 'rest', mi: 0 };

/** Base week: 14/Q14/16/12/9/L20/rest = 85 mi. */
const base = (): SimDay[] => [E(14), Q(14), E(16), E(12), E(9), L(20), R];

export const SCENARIOS: Scenario[] = [
  // ── MILEAGE ──
  {
    name: 'Small deficit, midweek', group: 'Mileage',
    note: 'Behind ~6 mi on Wed; quality Tue ran fine, plenty of room to recover.',
    days: base(), todayIdx: 2, logged: { 0: 14, 1: 14 }, qualitySatisfied: true,
  },
  {
    name: 'Mid deficit, honest concede', group: 'Mileage',
    note: 'Behind ~7 mi on Thu; only Thu/Fri easy days have headroom (~5 mi) → recovers what fits, concedes the rest honestly.',
    days: base(), todayIdx: 3, logged: { 0: 10, 1: 14, 2: 13 }, qualitySatisfied: true,
  },
  {
    name: 'Large deficit, late week', group: 'Mileage',
    note: 'Behind ~30 mi by Fri — only Fri/Sat/Sun left, can’t safely recover it all.',
    days: base(), todayIdx: 4, logged: { 0: 4, 1: 0, 2: 5, 3: 0 }, qualitySatisfied: false,
  },
  {
    name: 'Doubles habit', group: 'Mileage',
    note: 'Runner habitually doubles (Mon PM); behind midweek — recovery may add a PM.',
    days: [E(14, 6), Q(14), E(16), E(12), E(9), L(20), R], todayIdx: 2, logged: { 0: 10, 1: 14 }, qualitySatisfied: true,
  },

  // ── QUALITY ──
  {
    name: 'Quality ran EASY, safe slot', group: 'Quality',
    note: 'Behind, and Tue quality was run easy (unsatisfied); today Wed, Thu/Fri easy & not next to Sat long → should re-place quality.',
    days: base(), todayIdx: 2, logged: { 0: 8, 1: 8 }, qualitySatisfied: false,
  },
  {
    name: 'Quality SKIPPED, safe slot', group: 'Quality',
    note: 'Tue quality skipped entirely; today Wed → should re-place quality.',
    days: base(), todayIdx: 2, logged: { 0: 14 }, qualitySatisfied: false,
  },
  {
    name: 'Quality missed, NO safe slot', group: 'Quality',
    note: 'Quality missed; today Fri — only Fri (next to Sat long) & Sun left → quality should concede.',
    days: base(), todayIdx: 4, logged: { 0: 14, 1: 0, 2: 16, 3: 12 }, qualitySatisfied: false,
  },
  {
    name: 'Quality easy, mileage ON pace', group: 'Quality',
    note: 'Ran the Tue quality EASY but stayed on mileage pace → no reflow fires; today the app only shows an informational "missing quality" card and never offers to re-place it. A real gap.',
    days: base(), todayIdx: 2, logged: { 0: 14, 1: 14 }, qualitySatisfied: false,
  },
  {
    name: 'Quality still ahead', group: 'Quality',
    note: 'Quality is Thu; today Wed → not due yet, engine should leave it and just recover mileage.',
    days: [E(14), E(16), E(12), Q(14), E(9), L(20), R], todayIdx: 2, logged: { 0: 10, 1: 12 },
  },
  {
    name: 'Quality already banked', group: 'Quality',
    note: 'Tue quality completed (satisfied); behind on mileage only → recover mileage, no quality action.',
    days: base(), todayIdx: 3, logged: { 0: 8, 1: 14, 2: 10 }, qualitySatisfied: true,
  },

  // ── LONG ──
  {
    name: 'Long upcoming, preserved', group: 'Long',
    note: 'Behind midweek; Sat long still ahead → recovery must NOT shrink the long.',
    days: base(), todayIdx: 3, logged: { 0: 8, 1: 14, 2: 10 }, qualitySatisfied: true,
  },
  {
    name: 'Long missed', group: 'Long',
    note: 'Sat long was missed; today Sun → can it re-place the long or does it concede?',
    days: base(), todayIdx: 6, logged: { 0: 14, 1: 14, 2: 16, 3: 12, 4: 9, 5: 0 }, qualitySatisfied: true,
  },

  // ── COMBINED ──
  {
    name: 'Ideal: behind + quality-easy + long ahead', group: 'Combined',
    note: 'The full test — recover mileage, re-place the run-easy quality on a safe day, keep Sat long.',
    days: base(), todayIdx: 2, logged: { 0: 12, 1: 14 }, qualitySatisfied: false,
  },
  {
    name: 'Behind + quality-easy + long tomorrow', group: 'Combined',
    note: 'Today Fri; quality missed, Sat long tomorrow → recover mileage, quality concedes (no safe slot), long kept.',
    days: base(), todayIdx: 4, logged: { 0: 14, 1: 8, 2: 16, 3: 12 }, qualitySatisfied: false,
  },
  {
    name: 'Novice small week', group: 'Combined',
    note: 'A 35-mi week behind midweek — recovery on smaller volumes.',
    days: [E(6), Q(5), E(5), E(5), E(4), L(10), R], todayIdx: 3, logged: { 0: 4, 1: 5, 2: 3 }, qualitySatisfied: false,
  },
];

export function runAll(): { built: BuiltScenario; grade: Grade }[] {
  return SCENARIOS.map((s) => {
    const built = runScenario(s);
    return { built, grade: grade(built) };
  });
}

// Re-exported for the report renderer.
export { DATES, DOW, toMi, MI };
