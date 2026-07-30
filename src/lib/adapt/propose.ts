/**
 * Pure, in-memory adaptation proposal engine — v2.4 (adapt-study §3 R7 + §8b
 * recovery palette).
 *
 * Given the full week's days (with hasActivity flags), proposes 0–3 concrete
 * fixes to close the projected week-end mileage gap:
 *
 *  `reflow`        – bounded-recovery rearrangement of the remaining week; two
 *                    variants: 'max' (all levers incl. R3 rest activation) and
 *                    'keep_rest' (levers minus the rest day)
 *  `add_double`    – add an easy PM run (gated on the runner's doubling habit)
 *  `reschedule`    – move a fully-missed day onto a future rest/easy slot
 *  `redistribute`  – extend remaining easy days within R2 headroom
 *  `lower_target`  – drop the week target to what's reachable
 *
 * Selection (R7 v2.3): light fixes lead when nothing was missed and one of
 * them covers ≥90% of the gap. Otherwise reflowWeek runs twice (with/without
 * the R3 rest lever): 'max' leads when it recovers ≥ 25% of the deficit
 * (inclusive) and clears the engine's absolute floor; 'keep_rest' follows
 * when the rest lever actually fired; and (v2.4 recovery palette, owner
 * request) the pure lower_target floor is ALWAYS the final option — up to
 * THREE cards when meaningfully distinct, never two equivalent ones.
 * A cosmetic max recovery demotes the reflow to secondary behind lower_target.
 * R7 addendum (v2.3): a card that re-places a missed key session (R5 quality
 * or R6 long) is EXEMPT from that demotion — its ranking value is at least
 * the re-placed session's distance, so a recovered key session always
 * outranks a lower_target card of equal mileage; quality is never dropped
 * while a slot exists. lower_target details carry computed state chips only
 * (`Long kept` / `Quality open` …) — never a static protection claim. The
 * quality_only no-slot variant first attempts ONE slot-opening swap (v2.3).
 *
 * Deterministic, no Supabase, no React — tested under the `node` jest project.
 */

import {
  reflowWeek,
  planConstants,
  extensionHeadroom,
  floorMi,
  type ReflowResult,
  type ReflowArrangementDay,
} from './reflow';
import {
  METERS_PER_MILE,
} from '../units';

export type RemainingDayType = 'easy' | 'long' | 'quality' | 'rest' | 'cross' | 'race' | null;

// ── Input types ──────────────────────────────────────────────────────────────

export interface WeekDay {
  /** Workout row id, or null when no workout exists. */
  workoutId: string | null;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0 = Mon … 6 = Sun (position in plan week). */
  idx: number;
  type: RemainingDayType;
  /** Currently-planned AM distance for that day (meters; 0 for rest). */
  plannedMeters: number;
  /**
   * Planned PM-double distance for that day (meters; 0 when no PM double).
   * Aggregated from any extra workout rows on the same date (D7).
   */
  plannedPmMeters: number;
  /**
   * Planned mileage that is still genuinely open on this date. Runtime
   * derivation resolves this per workout leg, so a completed AM run does not
   * erase an unmatched PM leg. Optional for legacy/test callers.
   */
  remainingMeters?: number;
  /** True if any run was logged that day. */
  hasActivity: boolean;
  /** True if this is today. */
  isToday: boolean;
}

export interface ProposeInput {
  weekTargetMeters: number;
  actualMeters: number;
  /**
   * Fraction 0..1 of the week elapsed through end of yesterday
   * (completedDays / 7). Today is deliberately not counted.
   */
  elapsedFraction: number;
  /** All 7 days of the week, ordered by idx. */
  weekDays: WeekDay[];
  /**
   * True when quality has already been satisfied somewhere this week
   * (detected by detectWeekQuality + sufficiency gate).  When true, a
   * missed planned-quality day is treated as a mileage-only miss — the
   * engine will NOT try to re-place it as a quality session and will NOT
   * frame it as "quality at risk".
   *
   * Defaults to false (undefined = not satisfied).
   */
  qualitySatisfied?: boolean;
  /**
   * The `idx` (0-6) of the planned quality day for this week, if any.
   * Used together with `qualitySatisfied` to identify which missed day
   * should be downgraded to a mileage-only miss.
   */
  plannedQualityDayIdx?: number;
  /**
   * Planned quality day info — passed through to `reflowWeek` when proposing
   * a reflow adaptation so the quality session can be placed correctly.
   */
  qualityDayInfo?: {
    idx: number;
    plannedMeters: number;
    workoutId: string | null;
    date: string;
  };
  /**
   * Planned long day info — passed through to `reflowWeek` so the long run
   * can be placed correctly in the reflow.
   */
  longDayInfo?: {
    idx: number;
    plannedMeters: number;
    workoutId: string | null;
    date: string;
  };
  /**
   * R4 doubles gate: the runner's habitual PM distance in meters (median of
   * the plan's own PM rows, else recent logged doubles), or null/undefined
   * when the runner does not double. Without a habit no add_double card is
   * ever proposed and reflow never adds a PM (study §3 v2.2).
   */
  pmHabitMeters?: number | null;
}

// ── Adaptation types ─────────────────────────────────────────────────────────

export interface RedistributeEdit {
  workoutId: string | null;
  date: string;
  fromMeters: number;
  toMeters: number;
}

export interface RedistributeAdaptation {
  kind: 'redistribute';
  title: string;
  detail: string;
  deficitMeters: number;
  edits: RedistributeEdit[];
}

export interface LowerTargetAdaptation {
  kind: 'lower_target';
  title: string;
  detail: string;
  deficitMeters: number;
  edits: { newTargetMeters: number };
}

export interface RescheduleEdit {
  from: { workoutId: string | null; date: string; type: RemainingDayType };
  to: { workoutId: string | null; date: string; meters: number; type: RemainingDayType };
}

export interface RescheduleAdaptation {
  kind: 'reschedule';
  title: string;
  detail: string;
  deficitMeters: number;
  move: RescheduleEdit;
  /** Present when the destination is adjacent to another long/quality day. */
  flag?: 'back_to_back';
}

export interface AddDoubleAdaptation {
  kind: 'add_double';
  title: string;
  detail: string;
  deficitMeters: number;
  adds: { date: string; meters: number }[];
}

/**
 * Informational card emitted when mileage KPI is met but the week's quality
 * session is still unmet.  This card has no Apply action — it is dismissed via
 * the standard Dismiss button (or a "Got it" affordance).
 */
export interface QualityOnlyAdaptation {
  kind: 'quality_only';
  title: string;
  detail: string;
  /**
   * Present when a safe slot was found.  The tray may show the day name in the
   * CTA, or the caller can use it for navigation.
   */
  safeSlotDate?: string;
  /**
   * R5/R7 addendum (v2.3): exchanging these two remaining days' sessions opens
   * `safeSlotDate` as the quality slot (rendered as a swap, both sides named).
   * Absent when the slot exists without a swap.
   */
  swap?: { date: string; withDate: string };
  /**
   * ACTIONABLE re-placement (v2.6): the safe-slot workout to convert into the
   * missed quality session — present whenever `safeSlotDate` is. Apply flips this
   * day's row to a quality workout at `toMeters`, so a run-easy/skipped quality
   * can be re-placed even when mileage is on pace (no reflow deficit needed).
   */
  replace?: { workoutId: string; date: string; fromMeters: number; toMeters: number };
}

/**
 * Per-day before→after diff (study §6). One entry per REMAINING day —
 * including unchanged days and rest days — AM and PM carried separately so a
 * PM value can only ever diff against a PM value (fixes D6).
 */
export interface ReflowDiffDay {
  date: string;
  /**
   * The day's role in the proposal (what the slot becomes) — except an
   * activated rest day stays `type:'rest'` and reads as `rest 0→N`.
   */
  type: 'easy' | 'long' | 'quality' | 'rest' | 'race';
  /** The day's ORIGINAL planned role (before the proposal) — lets a before/after
   *  view show a type FLIP (e.g. easy→quality) as green→pink, not one colour.
   *  Always set by `buildReflowDiff`; optional so older literals default to `type`. */
  fromType?: 'easy' | 'long' | 'quality' | 'rest' | 'race';
  /** Planned AM for the day (0 for rest). */
  fromAmMeters: number;
  toAmMeters: number;
  /** Planned PM double, 0 if none — an added double diffs FROM 0. */
  fromPmMeters: number;
  /** Proposed PM double, 0 if none. */
  toPmMeters: number;
  changed: boolean;
  /** R9: the date this day exchanged loads with (both sides set). */
  swappedWith?: string;
}

/**
 * Reflow adaptation — carries a pre-computed `EditOp[]` that rearranges the
 * remaining week. The "Apply" action navigates to the week editor with these
 * ops pre-loaded as pending edits; it does NOT write the DB directly. When
 * `newTargetMeters` is present the proposal also concedes part of the deficit
 * (applied through the existing lower_target write path).
 */
export interface ReflowAdaptation {
  kind: 'reflow';
  title: string;
  detail: string;
  deficitMeters: number;
  /** R7 v2.1: 'max' = all levers incl. rest activation; 'keep_rest' = minus R3. */
  variant: 'max' | 'keep_rest';
  /** Meters recovered on top of the remaining plan (may be negative, R5). */
  recoveredMeters: number;
  /**
   * Whole-mile adjusted target when the proposal concedes part of the deficit;
   * ABSENT when fully recovered. Card copy keys off this — never off the
   * rounding residue in the engine's concededMeters.
   */
  newTargetMeters?: number;
  /** Concrete edit operations applied when this reflow is approved. */
  ops: import('./reflow').ReflowResult['ops'];
  /** Per-day before→after diff for the tray to render without extra data. */
  diff: ReflowDiffDay[];
  /**
   * R6 (v2.3): the re-placed long landed on a slot planned under 0.5xL — the
   * card renders the opt-in "Long today · <L> mi" read.
   */
  longReplaceFlagged?: boolean;
  /** The week's original target — the "from" side of the footer's TARGET read. */
  weekTargetMeters?: number;
  /**
   * The footer's quality seal reads "kept": either quality was already
   * satisfied earlier this week (banked by a detected session, so the seal is
   * kept even when no quality day appears in the remaining diff), OR this
   * reflow re-places the missed quality via R5 (`qualityReplaced`), which
   * surfaces a `type:'quality'` day in the diff. Kept coherent with the diff.
   */
  qualityBanked?: boolean;
}

export type Adaptation =
  | RedistributeAdaptation
  | LowerTargetAdaptation
  | RescheduleAdaptation
  | AddDoubleAdaptation
  | QualityOnlyAdaptation
  | ReflowAdaptation;

// ── Internal constants ───────────────────────────────────────────────────────

/** R7: 'max' recovery leads only when it recovers ≥ 25% of the deficit. */
const HYBRID_MIN_RATIO = 0.25;
/** Float / whole-meter rounding tolerance for threshold comparisons (meters). */
const EPS = 2;
/** A day counts as "changed" only beyond rounding noise (meters). */
const CHANGE_EPS = 50;

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Round meters to nearest 100 m. */
function round100(meters: number): number {
  return Math.round(meters / 100) * 100;
}

/** Compact miles for copy, e.g. 9700 → "6.0". */
function mi(meters: number): string {
  return (meters / METERS_PER_MILE).toFixed(1);
}

/** Whole miles, e.g. 135175 → "84". */
function miRound(meters: number): string {
  return String(Math.round(meters / METERS_PER_MILE));
}

/** 3-letter day abbreviation from a YYYY-MM-DD date. */
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function shortDay(date: string): string {
  return DOW_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? date.slice(5);
}

function isHardType(type: RemainingDayType): boolean {
  return type === 'long' || type === 'quality';
}

/**
 * Total planned meters for a day — AM run + PM double (D7).
 * Use wherever the semantic is "how much is planned that day"
 * (remaining-planned, missed-day size, capacity); AM-only reads
 * (extension headroom, per-row DB writes) keep `d.plannedMeters`.
 */
export function dayTotal(d: WeekDay): number {
  return d.plannedMeters + d.plannedPmMeters;
}

/** Planned mileage still open on a live/future day. */
function dayRemaining(d: WeekDay): number {
  return d.remainingMeters ?? (d.hasActivity ? 0 : dayTotal(d));
}

// ── Derived context ──────────────────────────────────────────────────────────

export interface DerivedContext {
  gap: number;
  severity: number;
  /** Past run-type days with !hasActivity (fully missed). */
  missed: WeekDay[];
  /** Future rest days. */
  restDays: WeekDay[];
  /** Future easy days (not yet run). */
  remainingEasy: WeekDay[];
  /** Future days that are either rest OR easy and have no activity. */
  openDays: WeekDay[];
  /** All future/today days (no activity yet or isToday with no activity). */
  remaining: WeekDay[];
  /**
   * Returns true when the destination at `idx` is adjacent (±1) to a
   * long/quality day that WILL actually be run (ignores rest neighbors and
   * missed neighbors).
   */
  adjacentHard: (idx: number) => boolean;
}

/**
 * Derive all planning context from the raw ProposeInput.
 * Exported for unit-testing the derivation logic.
 */
export function deriveContext(input: ProposeInput): DerivedContext {
  const { weekDays, weekTargetMeters, actualMeters } = input;

  const todayIdx = weekDays.find((d) => d.isToday)?.idx ?? 7;
  // Remaining work is resolved per leg. A run earlier today does not erase an
  // unmatched second leg from the projection.
  const remaining = weekDays.filter(
    (d) => d.idx > todayIdx || (d.isToday && dayRemaining(d) > 0),
  );

  // Day-total (AM+PM): a future planned double must count fully toward
  // remaining-planned or the gap is inflated by the PM's distance (D7/T9).
  const remainingPlanned = remaining.reduce((s, d) => s + dayRemaining(d), 0);
  const gap = weekTargetMeters - actualMeters - remainingPlanned;
  const severity = weekTargetMeters > 0 ? gap / weekTargetMeters : 0;

  // missed = past run-type days (not rest) with no activity.
  // Day-total: a day that only had a PM double planned still counts as missed.
  const missed = weekDays.filter(
    (d) => d.idx < todayIdx && d.type !== 'rest' && dayTotal(d) > 0 && !d.hasActivity,
  );

  // restDays = future days with type=rest
  const restDays = remaining.filter((d) => d.type === 'rest');

  // remainingEasy = future easy days
  const remainingEasy = remaining.filter((d) => d.type === 'easy');

  // openDays = future rest OR easy days with no activity
  const openDays = remaining.filter((d) => d.type === 'rest' || d.type === 'easy');

  /**
   * adjacentHard(idx): true iff the slot at `idx` is ±1 to a long/quality day
   * that WILL actually run (i.e. not rest, not missed).
   */
  function adjacentHard(idx: number): boolean {
    for (const neighborIdx of [idx - 1, idx + 1]) {
      const neighbor = weekDays.find((d) => d.idx === neighborIdx);
      if (!neighbor) continue;
      if (!isHardType(neighbor.type)) continue;
      // Ignore rest type
      if (neighbor.type === 'rest') continue;
      // Ignore neighbors that were missed (past, no activity)
      const wasMissed =
        neighbor.idx < todayIdx && !neighbor.hasActivity && dayTotal(neighbor) > 0;
      if (wasMissed) continue;
      // This neighbor IS a hard type that will actually run
      return true;
    }
    return false;
  }

  return { gap, severity, missed, restDays, remainingEasy, openDays, remaining, adjacentHard };
}

// ── Fix builders ─────────────────────────────────────────────────────────────

interface AddDoubleCandidate {
  recovers: number;
  adds: { date: string; meters: number }[];
}

/**
 * add_double light fix (R4-aligned): only for runners with a doubling habit,
 * PM = min(habit, gap, day AM) floored to whole miles, ≥ 0.5×habit (no junk
 * PMs), hosts must be typical-size easy days (AM ≤ M) that are not the day
 * before a long/race and not already doubles. Never in race weeks.
 */
function buildAddDouble(
  gap: number,
  remainingEasy: WeekDay[],
  weekDays: WeekDay[],
  pmHabitMeters: number | null,
): AddDoubleCandidate | null {
  if (pmHabitMeters == null || pmHabitMeters <= 0) return null; // R4 gate
  if (weekDays.some((d) => d.type === 'race')) return null; // R8: race week
  const { M } = planConstants(weekDays);
  const pmFloor = 0.5 * pmHabitMeters;
  const isPreHard = (idx: number): boolean =>
    weekDays.some((d) => d.idx === idx + 1 && (d.type === 'long' || d.type === 'race'));

  let g = gap;
  const adds: { date: string; meters: number }[] = [];
  for (const d of remainingEasy) {
    if (g <= 50) break;
    // A day that already has a planned PM double can't host another one.
    if (d.plannedPmMeters > 0) continue;
    // R4 host eligibility: don't double on a bigger-than-typical day, never
    // the day before the long/race.
    if (d.plannedMeters > M + EPS) continue;
    if (isPreHard(d.idx)) continue;
    // PM size: the runner's own habit, bounded by the gap and the day's AM.
    const pm = floorMi(Math.min(g, pmHabitMeters, d.plannedMeters));
    if (pm + EPS < pmFloor) continue; // junk-PM floor (0.5 × habit)
    adds.push({ date: d.date, meters: Math.round(pm) });
    g -= pm;
  }
  if (adds.length === 0) return null;
  const recovers = adds.reduce((s, a) => s + a.meters, 0);
  return { recovers, adds };
}

interface RescheduleCandidate {
  recovers: number;
  move: RescheduleEdit;
  missedDay: WeekDay;
  destDay: WeekDay;
  /** Set when the destination is adjacent to a will-run long/quality. */
  flag?: 'back_to_back';
}

function buildReschedule(
  missed: WeekDay[],
  weekDays: WeekDay[],
  restDays: WeekDay[],
  remainingEasy: WeekDay[],
  adjacentHard: (idx: number) => boolean,
  /**
   * When true, the planned quality day (identified by idx) has already been
   * satisfied elsewhere.  If the largest missed day IS that quality day, treat
   * it as a mileage-only miss (destination = rest day only, no quality framing).
   */
  qualitySatisfied?: boolean,
  plannedQualityDayIdx?: number,
): RescheduleCandidate | null {
  if (missed.length === 0) return null;

  // Pick the largest missed day (by AM+PM day total — a 14+6 double is a 20mi miss)
  const missedDay = [...missed].sort((a, b) => dayTotal(b) - dayTotal(a))[0]!;

  // If the missed day is the planned quality day AND quality is already satisfied
  // this week, treat it as a mileage-only miss (not a quality-recovery target).
  const isSatisfiedQualityDay =
    qualitySatisfied === true &&
    plannedQualityDayIdx !== undefined &&
    missedDay.idx === plannedQualityDayIdx &&
    isHardType(missedDay.type);

  const moveHard = isHardType(missedDay.type) && !isSatisfiedQualityDay;

  let safeDest: WeekDay | null = null;
  let flagBackToBack = false;

  if (!moveHard) {
    // Missed easy/medium: destination is future REST day only
    const candidates = restDays.slice().sort((a, b) => a.idx - b.idx);
    safeDest = candidates[0] ?? null;
  } else {
    // Missed long/quality: rest day OR smallest remaining easy day
    // Merge rest and easy, prefer candidates that pass adjacency check
    const candidates = [...restDays, ...remainingEasy].sort((a, b) => a.idx - b.idx);

    // First pass: find a truly safe destination (not adjacent to will-run hard day)
    for (const c of candidates) {
      if (!adjacentHard(c.idx)) {
        safeDest = c;
        break;
      }
    }

    // Second pass (§6 softening): no safe slot → still offer the best adjacent
    // slot with a back_to_back warning instead of blocking entirely
    if (!safeDest && candidates.length > 0) {
      safeDest = candidates[0]!;
      flagBackToBack = true;
    }
  }

  if (!safeDest) return null;

  const move: RescheduleEdit = {
    from: {
      workoutId: missedDay.workoutId,
      date: missedDay.date,
      type: missedDay.type,
    },
    to: {
      workoutId: safeDest.workoutId,
      date: safeDest.date,
      // Day-total: the move recovers everything the missed day had planned.
      meters: dayTotal(missedDay),
      type: missedDay.type,
    },
  };

  return {
    recovers: dayTotal(missedDay),
    move,
    missedDay,
    destDay: safeDest,
    flag: flagBackToBack ? 'back_to_back' : undefined,
  };
}

interface RedistributeCandidate {
  recovers: number;
  edits: RedistributeEdit[];
}

/**
 * redistribute light fix, R2-aligned: per-day headroom mirrors reflowWeek's
 * extension formula — min(floor_mi(dayTotal × 1.25), E, DTM) − dayTotal —
 * so a light fix can never grow an easy day past the plan's own biggest one.
 */
function buildRedistribute(
  gap: number,
  remainingEasy: WeekDay[],
  weekDays: WeekDay[],
  longDayInfo?: { plannedMeters: number },
): RedistributeCandidate | null {
  const { easyDayMax, dayTotalMax } = planConstants(weekDays, longDayInfo);
  let remainingGap = gap;
  const edits: RedistributeEdit[] = [];

  for (const d of remainingEasy) {
    if (remainingGap <= 50) break;
    // Headroom is computed on the day TOTAL (a planned PM counts toward the
    // caps); the extension itself is written onto the AM row.
    const headroom = extensionHeadroom(dayTotal(d), easyDayMax, dayTotalMax);
    const add = Math.min(headroom, round100(remainingGap));
    if (add >= 100) {
      edits.push({
        workoutId: d.workoutId,
        date: d.date,
        fromMeters: d.plannedMeters,
        toMeters: Math.round(d.plannedMeters + add),
      });
      remainingGap -= add;
    }
  }

  if (edits.length === 0) return null;
  const recovers = edits.reduce((s, e) => s + (e.toMeters - e.fromMeters), 0);
  return { recovers, edits };
}

/**
 * R5/R7 addendum (v2.3): when the missed quality has no safe slot, look for
 * ONE swap — the long (or an easy day) exchanged with a LATER remaining day —
 * whose post-swap week passes the adjacency + day-cap checks and opens at
 * least one eligible quality slot. Non-race weeks only. Returns the exchanged
 * pair and the slot it opens, or null when no such swap exists.
 */
function findSlotOpeningSwap(
  weekDays: WeekDay[],
  remaining: WeekDay[],
  todayIdx: number,
): { swapDate: string; withDate: string; slotDate: string } | null {
  if (weekDays.some((d) => d.type === 'race')) return null;
  const { L, dayTotalMax } = planConstants(weekDays);

  // Day type at idx on the simulated (post-swap) week.
  const typeAt = (idx: number, over: Map<number, RemainingDayType>): RemainingDayType | null =>
    over.has(idx) ? over.get(idx)! : weekDays.find((d) => d.idx === idx)?.type ?? null;
  // Mirrors deriveContext.adjacentHard on the simulated week: hard neighbors
  // that WILL actually run block; missed neighbors never do.
  const adjHard = (idx: number, over: Map<number, RemainingDayType>): boolean => {
    for (const n of [idx - 1, idx + 1]) {
      const d = weekDays.find((x) => x.idx === n);
      if (!d) continue;
      const t = typeAt(n, over);
      if (t !== 'long' && t !== 'quality') continue;
      if (d.idx < todayIdx && !d.hasActivity && dayTotal(d) > 0) continue; // missed
      return true;
    }
    return false;
  };

  const runDays = remaining.filter((d) => d.type === 'easy' || d.type === 'long');
  // The long moving later is the canonical slot-opener — try it first.
  const firsts = [
    ...runDays.filter((d) => d.type === 'long'),
    ...runDays.filter((d) => d.type === 'easy'),
  ];
  for (const a of firsts) {
    const laters = runDays.filter((x) => x.idx > a.idx).sort((x, y) => x.idx - y.idx);
    for (const b of laters) {
      const over = new Map<number, RemainingDayType>([
        [a.idx, b.type],
        [b.idx, a.type],
      ]);
      // The AM load moves with the session; planned PMs stay on their day.
      const capOk = (t: RemainingDayType, am: number, pm: number): boolean =>
        am + pm <= (t === 'long' ? L : dayTotalMax) + EPS;
      const hardOk = (idx: number, t: RemainingDayType): boolean =>
        t !== 'long' || !adjHard(idx, over);
      // Day a now hosts b's session (b.type at b's AM) and keeps its own PM;
      // day b hosts a's session likewise.
      if (!capOk(b.type, b.plannedMeters, a.plannedPmMeters)) continue;
      if (!capOk(a.type, a.plannedMeters, b.plannedPmMeters)) continue;
      if (!hardOk(a.idx, b.type) || !hardOk(b.idx, a.type)) continue;
      const slot = remaining.find((d) => {
        const t = typeAt(d.idx, over);
        return (
          t !== 'rest' &&
          t !== 'long' &&
          t !== 'quality' &&
          t !== 'race' &&
          !d.hasActivity &&
          !adjHard(d.idx, over)
        );
      });
      if (slot) return { swapDate: a.date, withDate: b.date, slotDate: slot.date };
    }
  }
  return null;
}

// ── Reflow card builder ──────────────────────────────────────────────────────

/**
 * Build the §6 per-day diff from a reflow arrangement: one entry per remaining
 * day (unchanged and rest days included), AM vs AM and PM vs PM only.
 */
function buildReflowDiff(result: ReflowResult, remainingDays: WeekDay[]): ReflowDiffDay[] {
  const amByDate = new Map<string, ReflowArrangementDay>();
  const pmByDate = new Map<string, ReflowArrangementDay>();
  for (const a of result.arrangement) (a.isDouble ? pmByDate : amByDate).set(a.date, a);

  return [...remainingDays]
    .sort((a, b) => a.idx - b.idx)
    .map((d) => {
      const am = amByDate.get(d.date);
      const pm = pmByDate.get(d.date);
      const fromAmMeters = d.plannedMeters;
      const fromPmMeters = d.plannedPmMeters;
      // Absent from the arrangement = untouched by the reflow (an unactivated
      // rest day, or a non-run row) — the planned values carry through.
      const toAmMeters = am ? am.meters : fromAmMeters;
      const toPmMeters = pm ? pm.meters : fromPmMeters;

      // An R3-activated rest day stays type:'rest' (reads as `rest 0→N`); a
      // rest day HOSTING a re-placed hard session (R5/R6 fallback) shows the
      // session type. Non-run rows (cross) render as rest.
      const restActivation = d.type === 'rest' && am?.type === 'easy';
      const type: ReflowDiffDay['type'] = restActivation
        ? 'rest'
        : am
          ? am.type
          : d.type === 'easy' || d.type === 'long' || d.type === 'quality' ||
              d.type === 'race' || d.type === 'rest'
            ? d.type
            : 'rest';

      const fromType: ReflowDiffDay['type'] =
        d.type === 'easy' || d.type === 'long' || d.type === 'quality' ||
        d.type === 'race' || d.type === 'rest'
          ? d.type
          : 'rest';

      const typeChanged = am != null && !restActivation && am.type !== d.type;
      const changed =
        Math.abs(toAmMeters - fromAmMeters) > CHANGE_EPS ||
        Math.abs(toPmMeters - fromPmMeters) > CHANGE_EPS ||
        typeChanged ||
        am?.swappedWith != null;

      return {
        date: d.date,
        type,
        fromType,
        fromAmMeters,
        toAmMeters,
        fromPmMeters,
        toPmMeters,
        changed,
        ...(am?.swappedWith ? { swappedWith: am.swappedWith } : {}),
      };
    });
}

function makeReflowAdaptation(args: {
  result: ReflowResult;
  variant: 'max' | 'keep_rest';
  deficitMeters: number;
  weekTargetMeters: number;
  remainingDays: WeekDay[];
  qualityBanked: boolean;
}): ReflowAdaptation {
  const { result, variant, deficitMeters, weekTargetMeters } = args;
  // Copy keys off newTargetMeters (null = fully recovered) — NEVER off
  // concededMeters, which can carry a sub-half-mile rounding residue.
  const recoveredMi = miRound(Math.max(0, result.recoveredMeters));
  const detail =
    result.newTargetMeters == null
      ? `Recover ${recoveredMi} · ${miRound(weekTargetMeters)} mi`
      : `Recover ${recoveredMi} of ${miRound(deficitMeters)} · ${miRound(weekTargetMeters)}→${miRound(result.newTargetMeters)} mi`;
  return {
    kind: 'reflow',
    title: variant === 'max' ? 'Realign' : 'Keep rest',
    detail,
    deficitMeters,
    variant,
    recoveredMeters: result.recoveredMeters,
    ...(result.newTargetMeters != null ? { newTargetMeters: result.newTargetMeters } : {}),
    ops: result.ops,
    diff: buildReflowDiff(result, args.remainingDays),
    ...(result.longReplaceFlagged ? { longReplaceFlagged: true } : {}),
    weekTargetMeters,
    ...(args.qualityBanked ? { qualityBanked: true } : {}),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Propose 0–3 adaptations for the current week.
 * Returns [primary, ...rest] in R7 rank order (never two equivalent cards);
 * on the heavy path the pure lower_target floor is always the last option
 * (v2.4 recovery palette).
 */
export function proposeAdaptations(input: ProposeInput): Adaptation[] {
  const {
    weekTargetMeters,
    actualMeters,
    weekDays,
    qualitySatisfied,
    plannedQualityDayIdx,
    qualityDayInfo,
    longDayInfo,
  } = input;
  const pmHabitMeters = input.pmHabitMeters ?? null;
  const ctx = deriveContext(input);
  const { gap, missed, remainingEasy, adjacentHard, remaining } = ctx;
  const todayIdx = weekDays.find((d) => d.isToday)?.idx ?? 7;

  // ── Quality-only trigger (gap ≤ 0) ────────────────────────────────────────
  // When the mileage KPI is met but quality is unmet, emit a quality_only
  // informational card — ONLY once the planned quality day is already in the
  // past (stress scenario H: never nag while the quality day is still ahead;
  // the runner can simply run it as planned).
  if (gap <= 0) {
    const qualityDayInPast =
      plannedQualityDayIdx !== undefined && plannedQualityDayIdx < todayIdx;
    if (qualitySatisfied === false && qualityDayInPast) {
      // Safe slot = a remaining day that is not rest, not a hard day itself
      // (v2.2.2: long/quality/race can never be the recommended quality slot —
      // the grid had this pointing at the 10-20 mi long on every template),
      // and not adjacent to a long/quality day that will actually run.
      const safeSlot =
        remaining.find(
          (d) =>
            d.type !== 'rest' &&
            d.type !== 'long' &&
            d.type !== 'quality' &&
            d.type !== 'race' &&
            !adjacentHard(d.idx) &&
            !d.hasActivity,
        ) ?? null;

      const qualityPlannedMeters =
        qualityDayInfo?.plannedMeters ??
        weekDays.find((d) => d.idx === plannedQualityDayIdx)?.plannedMeters ??
        0;
      if (safeSlot) {
        // Labels + numbers only: the slot day and the planned quality distance.
        // Actionable when the slot has a workout row to convert (it always does
        // here — safeSlot excludes rest/no-row days via the remaining filter).
        return [
          {
            kind: 'quality_only',
            title: 'Quality open',
            detail: `${shortDay(safeSlot.date)} · ${mi(qualityPlannedMeters)} mi`,
            safeSlotDate: safeSlot.date,
            ...(safeSlot.workoutId
              ? {
                  replace: {
                    workoutId: safeSlot.workoutId,
                    date: safeSlot.date,
                    fromMeters: safeSlot.plannedMeters,
                    toMeters: Math.round(qualityPlannedMeters),
                  },
                }
              : {}),
          } satisfies QualityOnlyAdaptation,
        ];
      }
      // R5/R7 addendum (v2.3): before the no-slot variant, attempt ONE
      // slot-opening swap (long or easy day exchanged with a later remaining
      // day). Only when no such swap exists does the no-slot variant fire.
      const swap = findSlotOpeningSwap(weekDays, remaining, todayIdx);
      if (swap) {
        return [
          {
            kind: 'quality_only',
            title: 'Quality open',
            detail: `${shortDay(swap.slotDate)} · ${mi(qualityPlannedMeters)} mi · ${shortDay(swap.swapDate)}⇄${shortDay(swap.withDate)}`,
            safeSlotDate: swap.slotDate,
            swap: { date: swap.swapDate, withDate: swap.withDate },
          } satisfies QualityOnlyAdaptation,
        ];
      }
      return [
        {
          kind: 'quality_only',
          title: 'Quality · no slot',
          detail: '0 slots left',
        } satisfies QualityOnlyAdaptation,
      ];
    }
    return [];
  }

  const deficitMeters = Math.round(gap);

  // lower_target builder (always available). Day-total: what's reachable
  // includes planned PM doubles on remaining days.
  // R7 addendum (v2.3): computed state chips only — `kept` when the session
  // genuinely survives in the proposed week (still ahead, or already run /
  // satisfied), `open` when missed and, for quality, still unsatisfied. Never
  // a static protection claim over a conceded session.
  const chips: string[] = [];
  const longDays = weekDays.filter((d) => d.type === 'long' && dayTotal(d) > 0);
  if (longDays.length > 0) {
    const longMissed = longDays.some((d) => d.idx < todayIdx && !d.hasActivity);
    chips.push(longMissed ? 'Long open' : 'Long kept');
  }
  const qualityDays = weekDays.filter((d) => d.type === 'quality' && dayTotal(d) > 0);
  if (qualityDays.length > 0) {
    const qualityMissed = qualityDays.some((d) => d.idx < todayIdx && !d.hasActivity);
    chips.push(qualityMissed && qualitySatisfied !== true ? 'Quality open' : 'Quality kept');
  }
  const newTargetMeters = round100(actualMeters + remaining.reduce((s, d) => s + dayRemaining(d), 0));
  const lowerTargetAdaptation: LowerTargetAdaptation = {
    kind: 'lower_target',
    title: `Adjust this week to ${miRound(newTargetMeters)} mi`,
    detail: [`${mi(weekTargetMeters)} → ${mi(newTargetMeters)} mi`, ...chips].join(' · '),
    deficitMeters,
    edits: { newTargetMeters },
  };

  // ── Reflow variants (R7 v2.1): build both, select below ──────────────────
  const runReflow = (useRestDay: boolean): ReflowResult | null =>
    reflowWeek({
      weekDays,
      weekTargetMeters,
      actualMeters,
      qualitySatisfied: qualitySatisfied ?? false,
      qualityDay: qualityDayInfo,
      longDay: longDayInfo,
      useRestDay,
      pmHabitMeters,
    });
  const maxResult = runReflow(true);
  const keepRestResult = runReflow(false);

  const toCard = (result: ReflowResult, variant: 'max' | 'keep_rest'): ReflowAdaptation =>
    makeReflowAdaptation({
      result,
      variant,
      deficitMeters,
      weekTargetMeters,
      remainingDays: remaining,
      // The footer seal reads "kept" when quality survives the proposed week —
      // either it was already banked by a detected session earlier this week
      // (`qualitySatisfied`), OR this reflow RE-PLACES the missed quality via R5
      // (`qualityReplaced`), which surfaces a `type:'quality'` day in the diff.
      // Keying off the re-placement fact keeps the seal coherent with the diff:
      // a proposal that restores quality must not still show the not-restored X.
      qualityBanked: qualitySatisfied === true || result.qualityReplaced != null,
    });

  // ── hasMissedRunDay ───────────────────────────────────────────────────────
  // A fully-missed past run-type day: planned run day, in the past, no activity.
  const hasMissedRunDay = missed.length > 0;

  // ── Light-fix candidates ──────────────────────────────────────────────────
  const doubleCandidate = buildAddDouble(gap, remainingEasy, weekDays, pmHabitMeters);
  const redistCandidate = buildRedistribute(gap, remainingEasy, weekDays, longDayInfo);

  // "covers" = recovers >= 90% of gap
  const lightCovers = (c: { recovers: number } | null): boolean =>
    c !== null && c.recovers >= gap * 0.9;

  // ── Selection (R7 v2.1) ───────────────────────────────────────────────────
  //
  // If !hasMissedRunDay (gap comes from short runs only, nothing to reorder):
  //   - lead with the one-tap light fix: add_double or redistribute (whichever
  //     covers ≥90%; prefer add_double).
  //   - If a light fix covers → PRIMARY light fix, secondary = max reflow.
  //   - If no light fix covers → fall through to the heavy path below.
  //
  // Heavy path (v2.4 recovery palette): 'max' PRIMARY when recovered ≥
  // max(25% of D, abs floor) — inclusive — then 'keep_rest' when the rest
  // lever fired, and the pure lower_target floor ALWAYS last (up to 3 cards);
  // else lower_target PRIMARY with 'max' secondary when it clears the abs
  // floor. §8b quality override keeps a quality re-placing card alive
  // regardless of recovered mileage.

  if (!hasMissedRunDay) {
    // Prefer add_double; fall back to redistribute.
    const lightFix: Adaptation | null =
      doubleCandidate && lightCovers(doubleCandidate)
        ? makeAddDoubleAdaptation(doubleCandidate, deficitMeters)
        : redistCandidate && lightCovers(redistCandidate)
        ? makeRedistributeAdaptation(redistCandidate, deficitMeters)
        : null;

    if (lightFix !== null) {
      // Light fix covers the gap — it leads.  Offer reflow as "rearrange instead" secondary.
      const out: Adaptation[] = [lightFix];
      if (maxResult !== null && maxResult.feasible) out.push(toCard(maxResult, 'max'));
      return out;
    }
    // No light fix covers → fall through to the heavy path.
  }

  // Missed run-day present, OR no light fix covered the gap.
  if (maxResult === null) {
    // weekEndGap within the engine's noise gate — no card needed.
    return [];
  }

  // R7 addendum (v2.3) — session-value ranking: a card that re-places a missed
  // key session (R5 quality or R6 long) is EXEMPT from the HYBRID demotion.
  // Its ranking value is at least the re-placed session's distance, not just
  // the net mileage credit — a recovered key session always outranks a
  // lower_target card of equal mileage, and quality is never conceded while a
  // slot exists (§8b).
  // v2.3.1 (M1 fix): re-place facts come straight from the engine — inferring
  // them from the arrangement false-positives on a week with a second, KEPT
  // long/quality when the missed one was actually conceded, letting the
  // session-value exemption rank a card off a session it never recovered.
  const placedQuality = maxResult.qualityReplaced;
  const placedLong = maxResult.longReplaced;
  const replaceFired = placedQuality != null || placedLong != null;
  const sessionValue = Math.max(placedQuality?.meters ?? 0, placedLong?.meters ?? 0);
  const rankValue = replaceFired
    ? Math.max(maxResult.recoveredMeters, sessionValue)
    : maxResult.recoveredMeters;

  const maxEligible = maxResult.feasible || replaceFired;
  // Inclusive ratio comparison (stress-review boundary pin).
  const maxMeetsRatio = rankValue + EPS >= HYBRID_MIN_RATIO * gap;

  if (maxEligible && maxMeetsRatio) {
    // v2.4 recovery palette: up to THREE meaningfully-distinct cards —
    // Realign (max) primary, Keep rest when the rest lever fired, and the
    // pure lower_target floor ALWAYS last. The feasibility gate keeps
    // equivalents out: a keep_rest that recovers nothing (and would concede
    // to the same target as lower_target) never clears the engine's floor.
    const out: Adaptation[] = [toCard(maxResult, 'max')];
    // The rest lever fired ⇔ the variants differ (R3 is the only lever gated
    // on useRestDay; its minimum value of 3 mi is far beyond rounding noise).
    const restLeverFired =
      keepRestResult !== null &&
      maxResult.recoveredMeters - keepRestResult.recoveredMeters > CHANGE_EPS;
    if (restLeverFired && keepRestResult.feasible) out.push(toCard(keepRestResult, 'keep_rest'));
    out.push(lowerTargetAdaptation);
    return out;
  }

  // Max recovery is cosmetic (< 25% of the deficit and/or below the absolute
  // floor) → concede honestly: lower_target leads, the hybrid is secondary.
  const out: Adaptation[] = [lowerTargetAdaptation];
  if (maxEligible) out.push(toCard(maxResult, 'max'));
  return out;
}

// ── Adaptation factories ──────────────────────────────────────────────────────

function makeAddDoubleAdaptation(c: AddDoubleCandidate, deficitMeters: number): AddDoubleAdaptation {
  const detail = c.adds.map((a) => `${shortDay(a.date)} +${mi(a.meters)} (2nd)`).join(', ');
  return {
    kind: 'add_double',
    title: 'Add additional runs',
    detail,
    deficitMeters,
    adds: c.adds,
  };
}

function makeRescheduleAdaptation(c: RescheduleCandidate, deficitMeters: number): RescheduleAdaptation {
  const { missedDay, destDay, move } = c;
  const fromDow = shortDay(missedDay.date);
  const toDow = shortDay(destDay.date);
  const baseDetail = `Move ${fromDow} ${missedDay.type ?? 'run'} ${mi(dayTotal(missedDay))} → ${toDow}; rest ${fromDow}`;
  const detail = c.flag === 'back_to_back'
    ? `${baseDetail} — note: back-to-back hard days`
    : baseDetail;
  return {
    kind: 'reschedule',
    title: `Move ${fromDow} run to ${toDow}`,
    detail,
    deficitMeters,
    move,
    ...(c.flag ? { flag: c.flag } : {}),
  };
}

function makeRedistributeAdaptation(c: RedistributeCandidate, deficitMeters: number): RedistributeAdaptation {
  const edits = c.edits;
  const detail = edits.map((e) => `${shortDay(e.date)}→${mi(e.toMeters)}`).join(', ');
  return {
    kind: 'redistribute',
    title: 'Extend easy runs',
    detail,
    deficitMeters,
    edits,
  };
}

// Kept for the dormant `reschedule` card kind (type still in the Adaptation
// union and rendered by the tray); not part of R7 selection.
void buildReschedule;
void makeRescheduleAdaptation;
