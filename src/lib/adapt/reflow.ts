/**
 * Pure week-reflow suggester — bounded-recovery policy (adapt-study §3, v2.3).
 *
 * Core reframe vs v1: the base arrangement IS the plan. Every remaining day
 * starts at its planned value; recovery is a bounded, purely ADDITIVE delta and
 * whatever doesn't fit is conceded honestly via `newTargetMeters`.
 *
 * Rules (see .git/sdd/adapt-study.md):
 *  R0  Monotonicity — no remaining day ever loses miles, except (a) trimming an
 *      R2 extension back toward plan for the double day-cap, (b) an explicit R9
 *      swap (net-zero pairwise exchange), (c) a typed R5/R6 re-placement.
 *  R1  Deficit D = weekEndGap (target − actual − remaining-planned). Levers in
 *      strict order: R5/R6 re-place → R9 swap → R2 extensions → R4 one PM
 *      double → R3 rest lever → R2 last-lever escalation. Concede the rest.
 *  R2  Extension headroom = min(round_mi(planned × 1.25), EASY_DAY_MAX) − planned
 *      (v2.2.2: nearest whole mile, exact halves down), proportional
 *      allocation, whole-mile floors, remainder to largest headroom.
 *      v2.3 addendum: when a deficit remains and no further lever exists (no
 *      PM fired, no rest-day slot to activate), the LATEST remaining easy day
 *      escalates past the 1.25 shape cap up to min(E, DTM, 0.6xL when
 *      adjacent to the long) — the bound R3 already trusts for a from-zero
 *      rest day. Never in race weeks.
 *  R3  Rest day is a LAST-RESORT lever (only with `useRestDay`): one rest day
 *      becomes easy floor_mi(min(EASY_DAY_MAX, DAY_TOTAL_MAX, D_rem)) —
 *      tightened to 0.6×L when it directly follows OR precedes (v2.2.2) the
 *      long/race day — skipped below 3 mi, never in race weeks. Needs an
 *      existing workout row (there is no AM insert op).
 *  R4  One PM double, gated on `pmHabitMeters` (runners who already double).
 *      Host = lightest planned easy AM ≤ M, never pre-long/pre-race, never an
 *      existing double; host AM extension is trimmed so AM+PM ≤ L − 1 mi.
 *  R5  Missed unsatisfied quality re-places onto the safe easy slot minimizing
 *      |slotPlanned − qualityPlanned| (tie → smaller day); rest-day fallback;
 *      v2.3: before conceding for lack of a safe slot, ONE slot-opening swap
 *      (long or easy day exchanged with a later remaining day) is attempted.
 *      Race weeks (v2.3): slots need >= 3 days before the race, the search
 *      maximizes days-to-race, the session trims to round_mi(0.6xQ); no slot
 *      that far out -> quality conceded (the race supplies the stimulus).
 *  R6  Missed long (v2.3): re-places onto the LATEST remaining easy day that
 *      is not adjacent to a remaining hard day and whose day total stays
 *      <= L. Slot size is NOT an eligibility filter any more — a planned slot
 *      under 0.5xL only FLAGS the card (`longReplaceFlagged`). Distance:
 *      full L after <= 2 consecutive zero-run days, round_mi(0.8xL) after
 *      >= 3. The remaining day right after the re-placed long caps at 0.6xL.
 *      Rest-day fallback unchanged; only with no host anywhere is it conceded.
 *  R8  Race weeks (v2.3): no doubles, no rest activation, no pre-race
 *      extension, no R9 swaps, and the day immediately after the race is
 *      cap-frozen at plan (no lever raises it).
 *  R9  At most one net-zero swap easing the day after a re-placed hard
 *      session; never in race weeks; shares the one-swap budget with the R5
 *      slot-opening swap.
 *
 * Plan-relative constants (v2.2 — no hardcoded mile caps):
 *  L = planned long distance (fallback largest planned day), E = largest
 *  planned easy AM (fallback 0.8×L), M = median planned run-day AM.
 */

import type { EditOp } from '@/lib/plan/weekEdit';
import {
  dayTotal,
  type WeekDay,
} from './propose';
import {
  METERS_PER_MILE,
} from '../units';

const MI = METERS_PER_MILE;

/** Rounding-level noise gate: no card below a 0.3 mi projected gap. */
const TRIGGER_MIN = 0.3 * MI;
/** R2: +25% extension ceiling (matches the redistribute light fix). */
const EXT_PCT = 1.25;
/** R3: no junk rest-day runs below 3 mi. */
const REST_MIN_METERS = 3 * MI;
/** Float / whole-meter rounding tolerance for threshold comparisons. */
const EPS = 2; // meters

/** Floor meters to a whole mile (exported for the add_double light fix). */
export function floorMi(meters: number): number {
  // 0.005 mi (~8 m) tolerance: whole-meter-rounded inputs drift a few meters
  // below exact whole miles and must not lose a full mile to the floor.
  return Math.floor(meters / MI + 0.005) * MI;
}

function roundMi(meters: number): number {
  return Math.round(meters / MI) * MI;
}

/**
 * R2 rounding (v2.2.2): nearest whole mile, but an exact half rounds DOWN.
 * The +25% basis only produces .0/.25/.5/.75 fractions: .25 stays down
 * (9 mi × 1.25 = 11.25 → 11, the owner's week is untouched), .75 rounds up
 * (3 mi × 1.25 = 3.75 → 4, a beginner day finally gets its half-mile of
 * grace), and the .5 tie stays down (10 mi × 1.25 = 12.5 → 12) so the change
 * reaches exactly the small days the eval grid flagged and nothing else.
 * Same 0.005 mi drift tolerance as floorMi.
 */
function roundMiHalfDown(meters: number): number {
  return Math.ceil(meters / MI - 0.505) * MI;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAsc[mid]! : (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

const isRunType = (t: WeekDay['type']): boolean =>
  t === 'easy' || t === 'long' || t === 'quality' || t === 'race';

/** Plan-relative constants (study §3 table, v2.2 — no hardcoded mile caps). */
export interface PlanConstants {
  /** Planned long distance (fallback: largest planned day total). */
  L: number;
  /** EASY_DAY_MAX — largest planned easy-AM day (fallback 0.8×L). */
  easyDayMax: number;
  /** Median planned run-day AM. */
  M: number;
  /** DAY_TOTAL_MAX = L − 1 mi — the long run stays the biggest day of the week. */
  dayTotalMax: number;
}

/**
 * Derive the week's caps from its own plan (shared with the light fixes in
 * propose.ts so add_double / redistribute obey the same R2/R4 bounds).
 */
export function planConstants(
  weekDays: WeekDay[],
  longDay?: { plannedMeters: number },
): PlanConstants {
  const runDays = weekDays.filter((d) => isRunType(d.type) && d.plannedMeters > 0);

  const longAms = weekDays.filter((d) => d.type === 'long').map((d) => d.plannedMeters);
  if (longDay && longDay.plannedMeters > 0) longAms.push(longDay.plannedMeters);
  const L =
    longAms.length > 0
      ? Math.max(...longAms)
      : runDays.length > 0
        ? Math.max(...runDays.map((d) => dayTotal(d)))
        : 0;

  const easyAms = weekDays.filter((d) => d.type === 'easy').map((d) => d.plannedMeters);
  const easyDayMax = easyAms.length > 0 ? Math.max(...easyAms) : 0.8 * L;
  const M = median(runDays.map((d) => d.plannedMeters).sort((a, b) => a - b));
  return { L, easyDayMax, M, dayTotalMax: L - MI };
}

/**
 * R2 extension headroom for one day: `min(round_mi(basis × 1.25), E, DTM) − basis`,
 * never negative. `basis` is the day TOTAL (AM + planned PM). v2.2.2 rounds to
 * the NEAREST whole mile (ties down) instead of flooring, so small days keep
 * their +25% (3 → 3.75 → 4). Shared by reflowWeek and the redistribute light
 * fix (R7).
 */
export function extensionHeadroom(
  basisMeters: number,
  easyDayMax: number,
  dayTotalMax: number,
): number {
  return Math.max(
    0,
    Math.min(roundMiHalfDown(basisMeters * EXT_PCT), easyDayMax, dayTotalMax) - basisMeters,
  );
}

export interface ReflowArrangementDay {
  date: string;
  meters: number;
  type: 'easy' | 'long' | 'quality' | 'race';
  isDouble: boolean;
  /** R9: the date this day exchanged planned loads with (both sides set). */
  swappedWith?: string;
}

export interface ReflowResult {
  /**
   * Whether the recovery is worth a reflow card: recovered ≥ HYBRID_MIN_ABS
   * (= max(2% of target, 1 mi), inclusive). Below that the recovery is
   * cosmetic and the caller should lead with lower_target.
   */
  feasible: boolean;
  /** EditOps to apply — only for days whose value actually changes. */
  ops: EditOp[];
  /** Every remaining day that runs, for the card detail (PMs as isDouble). */
  arrangement: ReflowArrangementDay[];
  /** Meters recovered on top of the remaining plan (levers + re-place credits). */
  recoveredMeters: number;
  /** Meters of the deficit NOT recovered (0 when fully recovered). */
  concededMeters: number;
  /** Whole-mile adjusted target when conceding, null when fully recovered. */
  newTargetMeters: number | null;
  /**
   * R6 (v2.3): the missed long was re-placed onto a slot whose planned size is
   * under 0.5xL — the card renders the opt-in "Long today" read; time is the
   * runner's call, never the engine's reason to concede.
   */
  longReplaceFlagged: boolean;
  /**
   * R5/R6 re-place facts, straight from the engine (v2.3.1): the missed
   * session that was re-placed, or null when it wasn't (kept sessions never
   * appear here). Callers must key ranking/exemptions off these — inferring
   * them from the arrangement false-positives on a week with a second, KEPT
   * long/quality when the missed one was actually conceded.
   */
  longReplaced: { date: string; meters: number } | null;
  qualityReplaced: { date: string; meters: number } | null;
}

export interface ReflowInput {
  /** All 7 week days with planned/actual metadata. */
  weekDays: WeekDay[];
  /** Weekly target in meters. */
  weekTargetMeters: number;
  /** Actual meters already logged (from past days). */
  actualMeters: number;
  /** True when quality has already been satisfied somewhere this week. */
  qualitySatisfied: boolean;
  /**
   * R3 rest lever toggle: max-recovery variant passes true, keep-rest false.
   */
  useRestDay: boolean;
  /**
   * R4 doubles gate: the runner's habitual PM distance (median of planned or
   * recent logged doubles), or null when the runner does not double — in which
   * case no PM double is ever proposed.
   */
  pmHabitMeters?: number | null;
  /**
   * The planned quality day for this week (if any). Needed to know the planned
   * distance when re-placing the quality session (R5).
   */
  qualityDay?: {
    idx: number;
    plannedMeters: number;
    workoutId: string | null;
    date: string;
  };
  /**
   * The planned long day for this week (if any). Needed to know the planned
   * distance when re-placing the long run (R6).
   */
  longDay?: {
    idx: number;
    plannedMeters: number;
    workoutId: string | null;
    date: string;
  };
}

interface Slot {
  day: WeekDay;
  role: 'easy' | 'long' | 'quality' | 'race' | 'rest' | 'other';
  /** Working AM base (post re-place / post swap), meters. */
  base: number;
  /** R2 extension on top of base (post double-cap trim). */
  ext: number;
  /** Planned PM double carried from the plan (untouched). */
  pmPlanned: number;
  /** R4 added PM double. */
  pmAdded: number;
  swappedWith?: string;
}

/**
 * Compute a bounded-recovery reflow for the current week.
 * Returns null when there is no gap to close (weekEndGap ≤ TRIGGER_MIN).
 */
export function reflowWeek(input: ReflowInput): ReflowResult | null {
  const {
    weekDays,
    weekTargetMeters,
    actualMeters,
    qualitySatisfied,
    qualityDay,
    longDay,
    useRestDay,
  } = input;
  const pmHabit = input.pmHabitMeters ?? null;

  // Remaining = days ahead of today + today if not yet run.
  const todayIdx = weekDays.find((d) => d.isToday)?.idx ?? 7;
  const remaining = weekDays.filter(
    (d) => d.idx > todayIdx || (d.isToday && !d.hasActivity),
  );

  // D = weekEndGap = target − actual − remaining-planned (day totals incl. PMs).
  const remPlanned = remaining.reduce((s, d) => s + dayTotal(d), 0);
  const deficit = weekTargetMeters - actualMeters - remPlanned;
  if (deficit <= TRIGGER_MIN) return null;

  // ── Plan-relative constants (study §3 table, v2.2) ─────────────────────────
  const { L, easyDayMax: EASY_DAY_MAX, M, dayTotalMax: DAY_TOTAL_MAX } = planConstants(
    weekDays,
    longDay,
  );
  const HYBRID_MIN_ABS = Math.max(0.02 * weekTargetMeters, MI);
  const raceWeek = weekDays.some((d) => d.type === 'race');

  // ── Base arrangement = the plan (R0) ───────────────────────────────────────
  const slots: Slot[] = [...remaining]
    .sort((a, b) => a.idx - b.idx)
    .map((d) => ({
      day: d,
      role: isRunType(d.type) ? (d.type as Slot['role']) : d.type === 'rest' ? 'rest' : 'other',
      base: d.plannedMeters,
      ext: 0,
      pmPlanned: d.plannedPmMeters,
      pmAdded: 0,
    }));

  const slotAt = (idx: number): Slot | undefined => slots.find((s) => s.day.idx === idx);

  /**
   * A neighbor is a hard blocker when it is a remaining hard-role slot
   * (reflects re-placements) or a past/today hard day that actually ran.
   * Missed hard days never block.
   */
  const isHardAt = (idx: number): boolean => {
    const s = slotAt(idx);
    if (s) return s.role === 'long' || s.role === 'quality' || s.role === 'race';
    const d = weekDays.find((x) => x.idx === idx);
    if (!d) return false;
    return (d.type === 'long' || d.type === 'quality' || d.type === 'race') && d.hasActivity;
  };
  const adjacentHard = (idx: number): boolean => isHardAt(idx - 1) || isHardAt(idx + 1);
  const preRace = (idx: number): boolean =>
    weekDays.some((d) => d.idx === idx + 1 && d.type === 'race');
  // R8 (v2.3): the day immediately after a race is cap-frozen at plan.
  const postRace = (idx: number): boolean =>
    weekDays.some((d) => d.idx === idx - 1 && d.type === 'race');

  const wasMissed = (info: { idx: number } | undefined): WeekDay | null => {
    if (!info) return null;
    const d = weekDays.find((x) => x.idx === info.idx);
    if (!d) return null;
    return d.idx < todayIdx && !d.hasActivity && dayTotal(d) > 0 ? d : null;
  };

  /**
   * Quality-specific R5 trigger (v2.3.1) — DISTINCT from `wasMissed`.
   *
   * `wasMissed` demands the day be activity-free (`!hasActivity`), which is right
   * for the LONG re-place (R6): a long that was actually run needs no salvage.
   * Quality is different — the WEEK-level `qualitySatisfied` flag already encodes
   * whether the hard stimulus landed anywhere, so an ELAPSED planned quality day
   * with a planned load is "unmet" purely on the calendar, EVEN when the runner
   * logged a non-quality (easy) run on it. This closes the incoherence where Dash
   * flagged "Missing quality session" (keyed on `!qualitySatisfied`) yet the engine
   * refused to restore it solely because a run happened on the quality day.
   *
   * The `!qualitySatisfied` half of the credit test stays at the call site, so
   * this predicate only answers "has the quality day elapsed with a load?" — it
   * never loosens the long-run `wasMissed`.
   */
  const qualityElapsedUnmet = (info: { idx: number } | undefined): WeekDay | null => {
    if (!info) return null;
    const d = weekDays.find((x) => x.idx === info.idx);
    if (!d) return null;
    return d.idx < todayIdx && dayTotal(d) > 0 ? d : null;
  };

  // ── R6 — re-place a missed long (v2.3) ─────────────────────────────────────
  let placedLongSlot: Slot | null = null;
  let longReplaceFlagged = false;
  if (longDay && wasMissed(longDay)) {
    const L6 = longDay.plannedMeters;
    // Consecutive zero-run days immediately before the host date (v2.3.1):
    // past days with no activity (the missed days themselves count) AND
    // today/future days that cannot produce a run before the host — planned
    // rest or nothing planned. A planned future run breaks the streak.
    const zeroRunStreakBefore = (hostIdx: number): number => {
      let n = 0;
      for (let j = hostIdx - 1; j >= 0; j--) {
        const d = weekDays.find((x) => x.idx === j);
        if (!d) break;
        const cannotRun =
          d.idx < todayIdx
            ? !d.hasActivity
            : d.type === 'rest' || !d.workoutId || dayTotal(d) <= 0;
        if (cannotRun) n++;
        else break;
      }
      return n;
    };
    // Full L after <= 2 zero-run days; round_mi(0.8xL) medium-long salvage
    // after >= 3 (the runner is coming back from a real break). Race weeks
    // (v2.3.1) always trim to 0.8xL — a full long has no place days before a
    // race.
    const placedFor = (hostIdx: number): number =>
      raceWeek || zeroRunStreakBefore(hostIdx) >= 3 ? roundMi(0.8 * L6) : L6;
    // Eligibility (v2.3): latest remaining easy day, not adjacent to a
    // remaining hard day, day total (placed + planned PM) <= L. Slot size is
    // no longer a filter — 0.5xL is only the flag threshold below. Race weeks
    // (v2.3.1, quality analog): the host must sit >= 3 days before the race,
    // else the long is conceded.
    const raceIdx6 = raceWeek ? weekDays.find((d) => d.type === 'race')?.idx ?? null : null;
    const easyCands = slots.filter(
      (s) =>
        s.role === 'easy' &&
        s.day.workoutId &&
        !adjacentHard(s.day.idx) &&
        (raceIdx6 == null || raceIdx6 - s.day.idx >= 3) &&
        placedFor(s.day.idx) + s.pmPlanned <= L6 + EPS,
    );
    let host: Slot | null =
      easyCands.length > 0
        ? easyCands.reduce((a, b) => (b.day.idx > a.day.idx ? b : a))
        : null;
    if (!host && !raceWeek) {
      // Rest-hosts-long fallback WINS over conceding (adjacency still applies).
      const restCands = slots.filter(
        (s) => s.role === 'rest' && s.day.workoutId && !adjacentHard(s.day.idx),
      );
      host =
        restCands.length > 0
          ? restCands.reduce((a, b) => (b.day.idx > a.day.idx ? b : a))
          : null;
    }
    if (host) {
      host.role = 'long';
      host.base = placedFor(host.day.idx); // credit = placed − slotPlanned
      placedLongSlot = host;
      // A small planned slot is an opt-in read for the runner (time is the
      // runner's call), never the engine's reason to concede the long.
      longReplaceFlagged = host.day.plannedMeters + EPS < 0.5 * L6;
    }
  }

  // Day-total cap (meters) for the remaining day immediately after the
  // re-placed long: 0.6xL (generalizes the R3 post-long cap). Infinity
  // elsewhere. R3 itself already sees the re-placed long via slot roles.
  const postPlacedLongCap = (idx: number): number =>
    placedLongSlot && idx === placedLongSlot.day.idx + 1
      ? 0.6 * L
      : Number.POSITIVE_INFINITY;

  // ── R5/R7 addendum (v2.3) — one slot-opening swap ──────────────────────────
  // Exchange the long (or an easy day) with a LATER remaining run day iff the
  // post-swap week passes the adjacency + day-cap checks and yields at least
  // one eligible quality slot. Non-race weeks only; consumes the one-swap
  // budget shared with R9.
  let slotOpeningSwapUsed = false;
  const trySlotOpeningSwap = (eligible: (s: Slot) => boolean): boolean => {
    if (raceWeek) return false;
    const runSlots = slots.filter(
      (s) => (s.role === 'easy' || s.role === 'long') && s.day.workoutId,
    );
    // The long moving later is the canonical slot-opener — try it first
    // (slots are already in idx order within each group).
    const firsts = [
      ...runSlots.filter((s) => s.role === 'long'),
      ...runSlots.filter((s) => s.role === 'easy'),
    ];
    for (const a of firsts) {
      const laters = runSlots
        .filter((b) => b.day.idx > a.day.idx)
        .sort((x, y) => x.day.idx - y.day.idx);
      for (const b of laters) {
        // Simulate the exchange (role and load move together).
        const exchange = (): void => {
          const r = a.role;
          a.role = b.role;
          b.role = r;
          const v = a.base;
          a.base = b.base;
          b.base = v;
        };
        exchange();
        const capOk = (s: Slot): boolean =>
          s.base + s.pmPlanned <= (s.role === 'long' ? L : DAY_TOTAL_MAX) + EPS;
        const hardOk = (s: Slot): boolean =>
          s.role !== 'long' || !adjacentHard(s.day.idx);
        if (capOk(a) && capOk(b) && hardOk(a) && hardOk(b) && slots.some(eligible)) {
          a.swappedWith = b.day.date;
          b.swappedWith = a.day.date;
          slotOpeningSwapUsed = true;
          return true;
        }
        exchange(); // revert
      }
    }
    return false;
  };

  // ── R5 — re-place a missed, unsatisfied quality session ───────────────────
  let placedQualitySlot: Slot | null = null;
  if (qualityDay && !qualitySatisfied && qualityElapsedUnmet(qualityDay)) {
    const qualityEligible = (s: Slot): boolean =>
      s.role === 'easy' && s.day.workoutId != null && !adjacentHard(s.day.idx);
    if (raceWeek) {
      // R8 override (v2.3): slots need >= 3 days before the race; the search
      // MAXIMIZES days-to-race; the session trims to round_mi(0.6xQ) (tune-up
      // size). No slot that far out -> conceded (the race is the stimulus).
      const raceIdx = weekDays.find((d) => d.type === 'race')!.idx;
      const cands = slots.filter((s) => qualityEligible(s) && raceIdx - s.day.idx >= 3);
      const best =
        cands.length > 0 ? cands.reduce((a, b) => (b.day.idx < a.day.idx ? b : a)) : null;
      if (best) {
        best.role = 'quality';
        best.base = roundMi(0.6 * qualityDay.plannedMeters);
        placedQualitySlot = best;
      }
    } else {
      // Smallest |slotPlanned − qualityPlanned|; tie -> the smaller day.
      const pickMinDelta = (cands: Slot[]): Slot | null => {
        let best: Slot | null = null;
        for (const c of cands) {
          if (!best) {
            best = c;
            continue;
          }
          const dc = Math.abs(c.base - qualityDay.plannedMeters);
          const db = Math.abs(best.base - qualityDay.plannedMeters);
          if (dc < db - EPS || (Math.abs(dc - db) <= EPS && c.base < best.base)) best = c;
        }
        return best;
      };
      let best = pickMinDelta(slots.filter(qualityEligible));
      if (!best) {
        // Rest day qualifies when no easy slot does (adjacency still applies).
        best =
          slots.find((s) => s.role === 'rest' && s.day.workoutId && !adjacentHard(s.day.idx)) ??
          null;
      }
      if (!best && trySlotOpeningSwap(qualityEligible)) {
        // v2.3: the swap opened a slot — search again on the post-swap week.
        best = pickMinDelta(slots.filter(qualityEligible));
      }
      if (best) {
        best.role = 'quality';
        best.base = qualityDay.plannedMeters; // credit may be negative (R5)
        placedQualitySlot = best;
      }
    }
  }

  // ── R9 — one net-zero sequencing swap after a re-placed hard session ──────
  // v2.3: never in race weeks; skipped when the R5 slot-opening swap already
  // consumed the one-swap budget.
  const placedHard = placedQualitySlot ?? placedLongSlot;
  if (placedHard && !raceWeek && !slotOpeningSwapUsed) {
    const after = slotAt(placedHard.day.idx + 1);
    if (after && after.role === 'easy' && after.day.workoutId) {
      const others = slots.filter((s) => s.role === 'easy' && s !== after && s.day.workoutId);
      if (others.length > 0) {
        const lightest = others.reduce((a, b) => (b.base < a.base ? b : a));
        if (after.base > lightest.base + EPS) {
          const t = after.base;
          after.base = lightest.base;
          lightest.base = t;
          after.swappedWith = lightest.day.date;
          lightest.swappedWith = after.day.date;
        }
      }
    }
  }

  // Deficit remaining after re-place credits (swaps are net-zero).
  const replaceCredit = slots.reduce((s, x) => s + (x.base - x.day.plannedMeters), 0);
  let dRem = deficit - replaceCredit;

  // ── R2 — extensions, proportional to headroom (post-swap values) ──────────
  interface ExtCand {
    slot: Slot;
    headroom: number;
  }
  const extCands: ExtCand[] = slots
    .filter(
      (s) =>
        s.role === 'easy' &&
        s.day.workoutId &&
        !preRace(s.day.idx) &&
        // R8 (v2.3): the day after a race is cap-frozen at plan.
        !postRace(s.day.idx),
    )
    .map((s) => {
      // Basis is the day TOTAL: a planned-double day extends against AM+PM (T9).
      const basis = s.base + s.pmPlanned;
      const capMeters = postPlacedLongCap(s.day.idx);
      // R6 (v2.3): the day after the re-placed long stays a light day —
      // whole-mile allowance under 0.6xL.
      const capped = Number.isFinite(capMeters)
        ? Math.max(0, floorMi(capMeters - basis))
        : Number.POSITIVE_INFINITY;
      return {
        slot: s,
        headroom: Math.min(extensionHeadroom(basis, EASY_DAY_MAX, DAY_TOTAL_MAX), capped),
      };
    })
    .filter((c) => c.headroom > EPS);

  const totalHeadroom = extCands.reduce((s, c) => s + c.headroom, 0);
  if (dRem > EPS && totalHeadroom > 0) {
    if (dRem + EPS >= totalHeadroom) {
      // Deficit swallows all headroom → take everything.
      for (const c of extCands) c.slot.ext = c.headroom;
    } else {
      // Proportional to headroom, whole-mile floors.
      for (const c of extCands) {
        c.slot.ext = Math.min(c.headroom, floorMi((dRem * c.headroom) / totalHeadroom));
      }
      // Whole-mile remainder to the largest-headroom day(s).
      let leftover = dRem - extCands.reduce((s, c) => s + c.slot.ext, 0);
      for (const c of [...extCands].sort((a, b) => b.headroom - a.headroom)) {
        if (leftover < MI - EPS) break;
        const room = floorMi(c.headroom - c.slot.ext + EPS);
        const add = Math.min(floorMi(leftover), room);
        if (add > EPS) {
          c.slot.ext += add;
          leftover -= add;
        }
      }
    }
    dRem -= slots.reduce((s, x) => s + x.ext, 0);
  }

  // ── R4 — one PM double (gated on the runner's own doubling habit) ─────────
  if (pmHabit != null && pmHabit > 0 && !raceWeek && dRem > EPS) {
    const pmWanted = floorMi(Math.min(pmHabit, dRem));
    const hosts = slots.filter(
      (s) =>
        s.role === 'easy' &&
        s.pmPlanned <= 0 &&
        s.base <= M + EPS && // don't double on a bigger-than-typical day
        !preRace(s.day.idx) &&
        !slots.some((o) => o.role === 'long' && o.day.idx === s.day.idx + 1), // not pre-long
    );
    if (hosts.length > 0 && pmWanted > EPS) {
      const host = hosts.reduce((a, b) => (b.base < a.base - EPS ? b : a));
      // Day-total cap: L − 1 mi, tightened to 0.6xL right after a re-placed
      // long (R6 v2.3).
      const hostCap = Math.min(DAY_TOTAL_MAX, postPlacedLongCap(host.day.idx));
      // Bound the PM by the day-total cap with the extension fully trimmed away.
      const pm = Math.min(pmWanted, floorMi(hostCap - host.base + EPS));
      if (pm > EPS && pm + EPS >= 0.5 * pmHabit) {
        // Trim the host's extension back toward plan (never below) so that
        // AM + PM stays under the day cap; trimmed miles return to the deficit.
        const trim = Math.min(host.ext, Math.max(0, host.base + host.ext + pm - hostCap));
        host.ext -= trim;
        host.pmAdded = pm;
        dRem += trim - pm;
      }
    }
  }

  // ── R3 — rest-day activation, the LAST lever ──────────────────────────────
  // Captured BEFORE activation mutates roles: the last-lever escalation below
  // only fires when no rest-day slot exists at all (a rest lever that fired —
  // or was deliberately kept — means the shape caps stay authoritative).
  const restSlotExists = slots.some((s) => s.role === 'rest' && s.day.workoutId);
  if (useRestDay && !raceWeek && dRem > EPS) {
    const restCands = slots.filter((s) => s.role === 'rest' && s.day.workoutId);
    let best: { slot: Slot; val: number } | null = null;
    for (const s of restCands) {
      // Post-long cap: a rest day right after the long run stays a light easy
      // day (0.6×L) — a 20-mi long never chains into a 16-mi next morning.
      const prevIdx = s.day.idx - 1;
      const prevSlot = slotAt(prevIdx);
      const followsLong = prevSlot
        ? prevSlot.role === 'long'
        : weekDays.some((d) => d.idx === prevIdx && d.type === 'long' && d.hasActivity);
      // Pre-long cap (v2.2.2): the same 0.6×L tightening applies when the rest
      // day immediately PRECEDES the long (or race) — a novice must not run 9
      // the day before a 10-mi long. The next day is strictly in the future,
      // so it is always a remaining slot when it exists.
      const nextSlot = slotAt(s.day.idx + 1);
      const precedesLong = nextSlot
        ? nextSlot.role === 'long' || nextSlot.role === 'race'
        : false;
      // Base cap min(E, DTM): a low-volume plan with E ≥ L must never activate
      // a rest day above L − 1 mi (the long stays the biggest day of the week).
      const cap =
        followsLong || precedesLong
          ? Math.min(EASY_DAY_MAX, DAY_TOTAL_MAX, 0.6 * L)
          : Math.min(EASY_DAY_MAX, DAY_TOTAL_MAX);
      // Rounding (I5 fix, v2.2.2): FLOOR against the remaining deficit — the
      // whole-mile value never rounds up past D_rem (recovered ≤ D).
      const val = floorMi(Math.min(cap, dRem));
      if (val + EPS < REST_MIN_METERS) continue; // no junk runs
      if (!best || val > best.val + EPS) best = { slot: s, val };
    }
    if (best) {
      best.slot.role = 'easy';
      best.slot.base = best.val;
      dRem -= best.val;
    }
  }

  // ── R2 addendum (v2.3) — last-lever escalation ─────────────────────────────
  // After proportional allocation, when a deficit remains and no further lever
  // exists (no PM double fired, no rest-day slot to activate), the LATEST
  // remaining easy day may extend past the 1.25 shape cap up to
  // min(E, DTM, 0.6xL when adjacent to the long) — exactly the bound R3
  // already trusts for a from-zero rest day. Never in race weeks.
  if (dRem > EPS && !raceWeek && !restSlotExists && !slots.some((s) => s.pmAdded > EPS)) {
    const easySlots = slots.filter((s) => s.role === 'easy' && s.day.workoutId);
    const latest =
      easySlots.length > 0
        ? easySlots.reduce((a, b) => (b.day.idx > a.day.idx ? b : a))
        : null;
    if (latest) {
      const isLongAt = (idx: number): boolean => {
        const s = slotAt(idx);
        if (s) return s.role === 'long';
        const d = weekDays.find((x) => x.idx === idx);
        return d != null && d.type === 'long' && d.hasActivity;
      };
      const adjacentLong = isLongAt(latest.day.idx - 1) || isLongAt(latest.day.idx + 1);
      const cap = Math.min(
        EASY_DAY_MAX,
        DAY_TOTAL_MAX,
        adjacentLong ? 0.6 * L : Number.POSITIVE_INFINITY,
      );
      const total = latest.base + latest.ext + latest.pmPlanned + latest.pmAdded;
      const add = floorMi(Math.min(Math.max(0, cap - total), dRem));
      if (add > EPS) {
        latest.ext += add;
        dRem -= add;
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────────
  let recovered = slots.reduce(
    (s, x) => s + (x.base + x.ext + x.pmPlanned + x.pmAdded - dayTotal(x.day)),
    0,
  );
  let conceded = Math.max(0, deficit - recovered);

  // ── Close a SMALL residual (v2.5, owner request) ───────────────────────────
  // When every lever has fired and only a tiny gap is left, top up the
  // remaining extendable easy day(s) so the week reaches its FULL target rather
  // than conceding ~1 mi — the whole-mile-flooring artifact that lands a 91-mi
  // week at 90. CLOSE_THRESHOLD's 1 mi floor catches that artifact; the 2%
  // catches proportionally-small gaps on bigger weeks. A residue already inside
  // the ≤0.5 mi rounding tolerance is left alone (it never surfaced as a
  // conceded target). Never in race weeks (R8 freezes the schedule).
  //
  // The top-up spends EXACTLY `conceded` meters, so `recovered` lands on the
  // deficit and can never exceed it. Pass 1 fills genuine slack up to each
  // day's ABSOLUTE cap (E, DTM, the post-long / adjacent-long tightening) —
  // which already permits a MODEST overage past the +25% shape cap without
  // out-sizing the plan's biggest day; pass 2 spills any last remainder onto
  // the largest day past even that cap. Either way the meters that exceed a cap
  // are bounded by CLOSE_THRESHOLD. `role === 'easy'` excludes rest days that
  // stay rest and every long/quality/race day, so no protected day is touched.
  const CLOSE_THRESHOLD = Math.max(MI, 0.02 * weekTargetMeters);
  const alreadyRounding = conceded <= 0.5 * MI + EPS;
  if (!raceWeek && !alreadyRounding && conceded <= CLOSE_THRESHOLD + EPS) {
    const closeCands = slots.filter(
      (s) => s.role === 'easy' && s.day.workoutId && !preRace(s.day.idx) && !postRace(s.day.idx),
    );
    if (closeCands.length > 0) {
      const isLongAtClose = (idx: number): boolean => {
        const o = slotAt(idx);
        if (o) return o.role === 'long';
        const dd = weekDays.find((x) => x.idx === idx);
        return dd != null && dd.type === 'long' && dd.hasActivity;
      };
      const dayCap = (s: Slot): number => {
        const adj = isLongAtClose(s.day.idx - 1) || isLongAtClose(s.day.idx + 1);
        return Math.min(
          EASY_DAY_MAX,
          DAY_TOTAL_MAX,
          postPlacedLongCap(s.day.idx),
          adj ? 0.6 * L : Number.POSITIVE_INFINITY,
        );
      };
      const totalOf = (s: Slot): number => s.base + s.ext + s.pmPlanned + s.pmAdded;
      let need = conceded;
      // Pass 1 — most remaining slack first (larger day breaks ties), never
      // exceeding a day's absolute cap.
      const ranked = [...closeCands].sort((a, b) => {
        const slackA = dayCap(a) - totalOf(a);
        const slackB = dayCap(b) - totalOf(b);
        if (Math.abs(slackB - slackA) > EPS) return slackB - slackA;
        return totalOf(b) - totalOf(a);
      });
      for (const s of ranked) {
        if (need <= EPS) break;
        const slack = dayCap(s) - totalOf(s);
        if (slack <= EPS) continue;
        const add = Math.min(slack, need);
        s.ext += add;
        need -= add;
      }
      // Pass 2 — every candidate already at its cap: put the last remainder on
      // the largest day past the cap (the only cap-exceeding placement, bounded
      // by need ≤ conceded ≤ CLOSE_THRESHOLD).
      if (need > EPS) {
        const largest = closeCands.reduce((a, b) => (totalOf(b) > totalOf(a) ? b : a));
        largest.ext += need;
        need = 0;
      }
      // Recompute after the top-up: recovered now sits on the deficit exactly.
      recovered = slots.reduce(
        (s, x) => s + (x.base + x.ext + x.pmPlanned + x.pmAdded - dayTotal(x.day)),
        0,
      );
      conceded = Math.max(0, deficit - recovered);
    }
  }

  // A residue ≤ 0.5 mi is rounding, not a real concession (v2.2.2: inclusive —
  // the rest lever's whole-mile floor can leave exactly half a mile behind).
  const fullyRecovered = conceded <= 0.5 * MI + EPS;
  const newTargetMeters = fullyRecovered
    ? null
    : Math.round(roundMi(weekTargetMeters - conceded));
  const feasible = recovered + EPS >= HYBRID_MIN_ABS;

  // ── EditOps + arrangement (ops only for days whose value changes) ─────────
  const ops: EditOp[] = [];
  const arrangement: ReflowArrangementDay[] = [];

  for (const slot of slots) {
    const { day } = slot;
    const finalAm = Math.round(slot.base + slot.ext);

    if (day.workoutId) {
      if (
        slot.role !== day.type &&
        (slot.role === 'easy' || slot.role === 'long' || slot.role === 'quality')
      ) {
        ops.push({ kind: 'setType', workoutId: day.workoutId, newType: slot.role });
      }
      if (Math.abs(finalAm - day.plannedMeters) > EPS) {
        ops.push({ kind: 'setDistance', workoutId: day.workoutId, newDistanceMeters: finalAm });
      }
    }
    if (slot.pmAdded > EPS) {
      ops.push({ kind: 'addDouble', onDate: day.date, distanceMeters: Math.round(slot.pmAdded) });
    }

    if (slot.role === 'easy' || slot.role === 'long' || slot.role === 'quality' || slot.role === 'race') {
      if (finalAm > EPS) {
        arrangement.push({
          date: day.date,
          meters: finalAm,
          type: slot.role,
          isDouble: false,
          ...(slot.swappedWith ? { swappedWith: slot.swappedWith } : {}),
        });
      }
      const pmTotal = Math.round(slot.pmPlanned + slot.pmAdded);
      if (pmTotal > EPS) {
        arrangement.push({ date: day.date, meters: pmTotal, type: 'easy', isDouble: true });
      }
    }
  }

  return {
    feasible,
    ops,
    arrangement,
    recoveredMeters: Math.round(recovered),
    concededMeters: Math.round(conceded),
    newTargetMeters,
    longReplaceFlagged,
    longReplaced: placedLongSlot
      ? { date: placedLongSlot.day.date, meters: placedLongSlot.base }
      : null,
    qualityReplaced: placedQualitySlot
      ? { date: placedQualitySlot.day.date, meters: placedQualitySlot.base }
      : null,
  };
}
