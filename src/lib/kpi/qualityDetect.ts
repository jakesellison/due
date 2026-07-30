/**
 * qualityDetect.ts — Minutes-based quality/interval detector.
 *
 * No IO. Node-tested.
 * Spec: docs/superpowers/specs/2026-06-18-quality-aware-adaptation-design.md §1
 *
 * v2 Algorithm (replaces the distance-based v1):
 *
 * QUALITY-TIME = Σ sample-duration where:
 *   • When stream.hr is present AND floor.hrFloor != null:
 *       HR ≥ hrFloor  (effort beats pace — a bad day at MP pace still reads
 *                       as threshold effort via HR)
 *   • Else when stream.altitude is present:
 *       GAP (grade-adjusted pace) ≤ paceFloor
 *   • Else (no HR, no elevation):
 *       raw pace (1609.344 / v) ≤ paceFloor
 *
 * A run IS quality when: qualityTimeMin ≥ MIN_QUALITY_MIN (15) OR the regime
 * segmenter detects interval/tempo structure (≥2 sustained work regimes).
 *
 * v4 replaces the raw-pace threshold+glue block segmenter with HYSTERESIS
 * REGIME DETECTION: smooth pace over ~40 s, then a two-state machine enters a
 * WORK regime when smoothed pace drops below a floor-relative ENTER band and
 * leaves it only when smoothed pace climbs above a higher EXIT band. The
 * hysteresis dead-band bridges intra-rep sag (hills/turns/GPS jitter) and
 * rejects brief warm-up dips that never sustain — the two failure modes of the
 * old per-sample threshold (ragged clipped boundaries + warm-up/recovery
 * fragments). Work regimes ≥ MIN_REP_S are measured as HardBlocks and feed the
 * unchanged post-classification gates. See
 * .git/sdd/interval-detection-diagnosis.md (LOCKED v4 design).
 *
 * Summary format: "<qualityTimeMin> min @ threshold" for tempo-style,
 * "<qualityTimeMin> min @ threshold + 4×2mi" when interval structure present.
 *
 * Grade-adjusted pace (GAP) formula (Strava-style simplified):
 *   GAP = raw_pace × (1 − GRADE_FACTOR × grade_pct)
 * where grade_pct = (alt[i] − alt[i-1]) / dist_delta × 100
 *       GRADE_FACTOR = 0.033 (3.3% pace reduction per 1% grade ≈ Strava's model)
 * GAP ≤ paceFloor → quality sample.
 *
 * Skips samples where v ≤ V_MIN (0.3 m/s) — stops / GPS dropouts.
 */

import type { Segment, RepeatSegment } from '../workout/types';
import {
  renderStructure,
} from '../workout/render';
import type { QualityFloor } from './qualityFloor';
import {
  METERS_PER_MILE,
} from '../units';
import {
  estimatedQualityLeafMeters,
  prescribedQualityMeters,
  type QualityPaceContext,
} from './prescribedQuality';

// ── Public types ─────────────────────────────────────────────────────────────

/** Activity stream — downsampled to ~11 s/sample as stored. */
export interface RunStream {
  /** Cumulative distance (m). */
  d: number[];
  /** Velocity (m/s). */
  v: number[];
  /** Elapsed time (s). */
  t: number[];
  /** Heart rate samples (bpm), optional. When present, length matches d/v/t. */
  hr?: number[];
  /** Altitude (m), optional. When present, length matches d/v/t. */
  altitude?: number[];
}

export interface HardBlock {
  distanceMeters: number;
  paceSecPerMi: number;
  durationS: number;
  /** Inclusive sample indices of this block in the source stream. */
  startIdx: number;
  endIdx: number;
}

export type QualityKind = 'intervals' | 'tempo' | 'progression' | 'none';

export interface QualityDetect {
  isQuality: boolean;
  kind: QualityKind;
  blocks: HardBlock[];
  /** Genuine additional work beyond a matched prescription. Incidental
   * fragments are discarded before reaching this field. */
  extraBlocks?: HardBlock[];
  summary: string;
  /** Total quality-time in minutes (sum of sample durations at/above floor). */
  qualityTimeMin: number;
  /**
   * Total hard-block distance (meters) — the detected quality DISTANCE. The
   * pace-invariant measure of how much hard work was done: running the
   * prescribed reps faster doesn't shrink it the way quality-time does.
   */
  qualityDistanceMeters: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const V_MIN = 0.3; // m/s — below this = stopped / GPS dropout

// ── Regime detection band (v4) ────────────────────────────────────────────────
// The hysteresis segmenter: smooth pace, then a two-state machine with an ENTER
// band (below the floor) and a higher EXIT band. The gap between them is the
// hysteresis dead-band that bridges intra-rep sag and rejects brief warm-up dips.

/**
 * Smoothing window (seconds, total) for the centered moving mean of raw pace
 * that feeds the regime machine (~40 s ⇒ ±20 s each side). Wide enough to erase
 * the second-scale wobble that fragmented reps under the old segmenter (a ±10 s
 * window left a residual warm-up fragment on the 05-26 session), narrow enough
 * not to smear a real rep boundary into its recovery.
 */
const SMOOTH_WINDOW_S = 40;

/**
 * ENTER band offset (s/mi BELOW the floor): the machine enters a WORK regime
 * when smoothed pace ≤ paceFloor − REGIME_ENTER_OFFSET_S. Floor-relative
 * (per-runner), mirroring THRESH_MARGIN's absolute-seconds style. A real rep
 * runs well under the moderate floor (~60 s/mi in the corpus); a warm-up stride
 * that only nicks the floor never sustains past this band.
 */
const REGIME_ENTER_OFFSET_S = 50;

/**
 * EXIT band offset (s/mi ABOVE the floor): the machine leaves WORK only when
 * smoothed pace ≥ paceFloor + REGIME_EXIT_OFFSET_S. The ENTER→EXIT gap
 * (80 s/mi wide) is the hysteresis dead-band — a mid-rep sag over a hill or
 * turnaround that pops above the floor stays inside the regime instead of
 * splitting it.
 */
const REGIME_EXIT_OFFSET_S = 30;

/**
 * Minimum WORK-regime duration (s) to keep as a rep. Kills single-sample noise
 * while keeping short reps: a 200 m rep ≈ 45 s survives (validated on the
 * 6×200 m corpus session). Deliberately small — a large per-rep minimum (e.g.
 * 120 s) kills short-rep workouts. Overridable via opts.minBlockS.
 */
const MIN_REP_S = 25;

/**
 * Average-pace clearance (s/mi BELOW the floor) a measured WORK block must beat:
 * keep a block only when its average pace ≤ paceFloor − REGIME_AVG_CLEAR_S. The
 * hysteresis dead-band can latch WORK on a brief dip and then coast through a
 * moderate stretch that averages ~floor pace — that isn't hard work. A real rep
 * or tempo averages well under the floor (threshold reps ~6:00–6:15, tempos
 * ~6:29–6:42, all clearing floor − 30); the dead-band-inflated easy-run blocks
 * average ~floor and get dropped. Floor-relative (per-runner), THRESH_MARGIN style.
 */
const REGIME_AVG_CLEAR_S = 30;

/** Minimum quality-time (minutes) for a run to be quality without structure. */
const MIN_QUALITY_MIN = 15;

/**
 * Minimum TOTAL hard-block time (seconds) for the interval/tempo *structure* to
 * count as a quality session. A few brief sub-floor surges on an easy run pass
 * the ≥2-blocks structure test but aren't a workout — e.g. 3×~45s pickups (~2
 * min total) on a 50-min easy run. 3 min is comfortably below any real session
 * (3×400m ≈ 4 min, 2×800m ≈ 5 min) and above incidental strides.
 */
const STRUCTURE_MIN_S = 180;

/**
 * When a single hard block accounts for at least this fraction of the total hard
 * time, the run reads as one sustained effort (tempo / progression), not N
 * intervals — even when warmup pickups split off extra short blocks. A McCarren
 * progression detected "7 reps" because its 30-min sustained block (64% of hard
 * time) sat alongside five short pickups. 0.55 keeps even 2× equal-rep workouts
 * (50% each) classified as intervals.
 */
const DOMINANT_BLOCK_FRAC = 0.55;

/**
 * A single sustained block of at least this duration (s) is a tempo effort on its
 * own, regardless of how much of the run it covers — catches a tempo embedded in
 * a longer run. 600 s = 10 min.
 */
const TEMPO_MIN_S = 600;

/**
 * Interval coherence — a real rep set is a SMALL number of SIMILAR-sized efforts.
 * Normal long-run pace variance produces many blocks of wildly varying size; the
 * corpus sweep mislabeled 38% of runs "N hard reps" without these gates.
 *  - MAX_INTERVAL_REPS: more "reps" than this is variance, not a workout.
 *  - REP_SIM_TOL: a rep counts as part of the set within ±35% of the median rep distance.
 *  - REP_CLUSTER_FRAC: the similar reps must be the bulk (≥60%) of the blocks.
 */
const MAX_INTERVAL_REPS = 16;
const REP_SIM_TOL = 0.35;
const REP_CLUSTER_FRAC = 0.6;

/**
 * Intervals REQUIRE recovery — the work reps are separated by easy jog, so they
 * cover only a MINORITY of the run. A set of similar-sized blocks that instead
 * covers most of the run's distance has no recovery between them: it's one
 * continuous effort recorded with mile auto-laps (a steady/tempo/progression
 * run), not intervals. Real interval sessions (even tight ones with a short
 * warm-up/cool-down) sit well under this; a mile-lapped continuous run reads
 * ~0.9–1.0. This is the guard that stops "15×1mi" continuous runs reading as
 * "15 intervals" (corpus sweep false positives).
 */
export const COVERAGE_INTERVALS_MAX = 0.8;

/**
 * Progression — ≥3 sustained blocks whose pace steps DOWN across the run (the
 * negative-split / progressive-tempo shape). Detected when the closing third is
 * faster than the opening third by at least PROGRESSION_MIN_DROP_S and the
 * step-to-step changes are mostly downward (≥ PROGRESSION_MONOTONE_FRAC). A
 * random scatter of varied-pace blocks is not a progression.
 */
const PROGRESSION_MIN_BLOCKS = 3;
const PROGRESSION_MIN_DROP_S = 25; // s/mi faster, opening third → closing third
const PROGRESSION_MONOTONE_FRAC = 0.6;

/**
 * Grade-adjustment factor: each 1% of grade reduces effective pace by this
 * fraction (3.3%). Mirrors Strava's simplified GAP model.
 */
const GRADE_FACTOR = 0.033;

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Format seconds as "m:ss". Carries the `%60`-rounds-to-60 case into the minute
 * (359.6 s → "6:00", not the old "5:60"): rounding the seconds can land on 60,
 * which must roll a minute rather than print an impossible ":60".
 */
export function formatPaceMi(secPerMi: number): string {
  let mins = Math.floor(secPerMi / 60);
  let secs = Math.round(secPerMi % 60);
  if (secs >= 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Round miles to one decimal, strip trailing ".0". */
export function formatMiles(meters: number): string {
  const mi = meters / METERS_PER_MILE;
  const s = mi.toFixed(1);
  return s.endsWith('.0') ? String(Math.round(mi)) : s;
}

/**
 * Format a rep distance the way a runner reads it: sub-mile reps in whole meters
 * ("221m", "815m"), mile-and-up reps in miles ("1mi", "2.1mi"). The threshold
 * (1400 m ≈ 0.87 mi) keeps GPS-measured "1 mile" laps — which land a little
 * short or long of 1609 m — reading as "1mi" rather than "1587m".
 */
export const REP_MILE_MIN_M = 1400;

/**
 * Snap a MEASURED sub-mile rep distance to its intended nominal, for DISPLAY
 * only. A "600 m rep" logged by GPS as 563 m should read "600m", and — because
 * the grouped pill and the per-rep rows both format through here — they agree
 * instead of the pill saying 563 while a row says 600. Standard track / interval
 * marks within 12% win (GPS drift on a rep runs ~10%); anything genuinely off
 * the ladder rounds to a clean 50 m so an oddball rep stays honest rather than
 * being forced onto the wrong mark. Reps a mile and up are returned unchanged —
 * they already read cleanly in measured miles (0.1-mi resolution).
 *
 * This NEVER touches the metres used to bank quality miles; those stay measured.
 */
const NOMINAL_REP_METERS = [200, 300, 400, 600, 800, 1000, 1200] as const;
const REP_SNAP_TOL = 0.12; // ≤12% from a standard mark snaps to it
export function snapRepDistMeters(meters: number): number {
  if (meters >= REP_MILE_MIN_M) return meters; // mile+ shows measured miles
  let best = NOMINAL_REP_METERS[0] as number;
  let bestErr = Infinity;
  for (const n of NOMINAL_REP_METERS) {
    const err = Math.abs(meters - n) / n;
    if (err < bestErr) { bestErr = err; best = n; }
  }
  if (bestErr <= REP_SNAP_TOL) return best;
  return Math.round(meters / 50) * 50; // off-ladder: clean to nearest 50 m
}

export function formatRepDist(meters: number): string {
  const m = snapRepDistMeters(meters);
  if (m < REP_MILE_MIN_M) return `${Math.round(m)}m`;
  return `${formatMiles(m)}mi`;
}

/**
 * Collapse a list of reps into a compact "N×D @ pace" summary, grouping reps by
 * DISTANCE (not pace) and joining groups with " + " (e.g. "6×221m @ 5:42",
 * "6×563m @ 7:20–8:14", "8×0.2mi @ 6:18 + 3×0.4mi @ 6:40"). Shared by the stream
 * detector's summary and the lap-first ingest verdict so both read identically.
 *
 * Grouping is by distance ALONE — a set of same-distance reps is ONE set even
 * when pace varies rep-to-rep (fatigue, hills, altitude). Grouping on pace too
 * fragmented an honest 6×hill-rep session into a fake "1× + 4× + 1×" workout.
 * Within a group the pace shows as a single value when the reps are consistent,
 * or a lo–hi RANGE when the spread is real (> PACE_RANGE_MIN_SPREAD), so the
 * variance is surfaced honestly instead of splitting the set.
 */
const PACE_RANGE_MIN_SPREAD = 20; // s/mi — show "lo–hi" only when the group spread exceeds this
export function repGroupSummary(reps: ReadonlyArray<{ distanceMeters: number; paceSecPerMi: number }>): string {
  const DIST_TOL = 0.15;
  const used = new Array(reps.length).fill(false);
  const groups: Array<{ count: number; distMeters: number; paceLo: number; paceHi: number; paceAvg: number }> = [];
  for (let i = 0; i < reps.length; i++) {
    if (used[i]) continue;
    const ref = reps[i]!;
    let count = 1;
    let totalDist = ref.distanceMeters;
    let paceSum = ref.paceSecPerMi;
    let paceLo = ref.paceSecPerMi;
    let paceHi = ref.paceSecPerMi;
    used[i] = true;
    for (let j = i + 1; j < reps.length; j++) {
      if (used[j]) continue;
      const b = reps[j]!;
      const distRatio = ref.distanceMeters > 0 ? Math.abs(b.distanceMeters - ref.distanceMeters) / ref.distanceMeters : 1;
      if (distRatio <= DIST_TOL) {
        count++;
        totalDist += b.distanceMeters;
        paceSum += b.paceSecPerMi;
        paceLo = Math.min(paceLo, b.paceSecPerMi);
        paceHi = Math.max(paceHi, b.paceSecPerMi);
        used[j] = true;
      }
    }
    groups.push({ count, distMeters: totalDist / count, paceLo, paceHi, paceAvg: paceSum / count });
  }
  return groups
    .map((g) => {
      const paceStr =
        g.paceHi - g.paceLo > PACE_RANGE_MIN_SPREAD
          ? `${formatPaceMi(g.paceLo)}–${formatPaceMi(g.paceHi)}`
          : formatPaceMi(g.paceAvg);
      return `${g.count}×${formatRepDist(g.distMeters)} @ ${paceStr}`;
    })
    .join(' + ');
}

// ── Core detector ─────────────────────────────────────────────────────────────

/**
 * Detect quality effort from a pace/HR stream.
 *
 * @param stream  Activity stream { d, v, t, hr?, altitude? }.
 * @param floor   The moderate-effort floor (from estimateQualityFloor).
 * @param opts    Optional overrides.
 */
export function detectQuality(
  stream: RunStream,
  floor: QualityFloor,
  opts?: { minBlockS?: number },
): QualityDetect {
  const minRep = opts?.minBlockS ?? MIN_REP_S;
  const { paceFloorSecPerMi, hrFloor } = floor;

  const { d, v, t, hr, altitude } = stream;
  const n = Math.min(d.length, v.length, t.length);

  // Determine which mode to use for quality classification:
  //  - 'hr'  : stream has HR samples AND floor has an hrFloor
  //  - 'gap' : stream has altitude but no usable HR → grade-adjusted pace
  //  - 'pace': raw pace (default)
  const useHr = hrFloor != null && Array.isArray(hr) && hr.length >= n;
  const useGap = !useHr && Array.isArray(altitude) && altitude.length >= n;

  // ── Step 1: per-sample quality flags and quality-time accumulation ──────────
  //
  // quality[i] = true when this sample counts toward quality-time.
  // qualityTimeS = Σ inter-sample duration for quality samples.
  //
  const quality: boolean[] = new Array(n).fill(false);
  let qualityTimeS = 0;

  for (let i = 0; i < n; i++) {
    const vi = v[i]!;
    if (vi <= V_MIN) continue;

    // Compute sample duration (inter-sample gap).
    const prevT = i > 0 ? t[i - 1]! : 0;
    const sampleDuration = t[i]! - prevT;

    let isQualitySample = false;

    if (useHr) {
      // HR-based: sample counts when HR ≥ hrFloor
      const hrI = hr![i]!;
      isQualitySample = hrI >= hrFloor!;
    } else if (useGap) {
      // GAP-based: grade-adjusted pace ≤ paceFloor
      const rawPace = METERS_PER_MILE / vi;
      const prevD = i > 0 ? d[i - 1]! : 0;
      const distDelta = d[i]! - prevD;

      let gap = rawPace;
      if (distDelta > 0) {
        const altDelta = altitude![i]! - (i > 0 ? altitude![i - 1]! : altitude![0]!);
        const gradePct = (altDelta / distDelta) * 100; // % grade
        // GAP = raw_pace × (1 − GRADE_FACTOR × grade_pct)
        // Positive grade (uphill) reduces effective pace; negative (downhill) increases
        gap = rawPace * (1 - GRADE_FACTOR * gradePct);
        // Clamp GAP to reasonable bounds (never negative or absurdly fast)
        gap = Math.max(gap, rawPace * 0.5);
      }
      isQualitySample = gap <= paceFloorSecPerMi;
    } else {
      // Raw pace
      const rawPace = METERS_PER_MILE / vi;
      isQualitySample = rawPace <= paceFloorSecPerMi;
    }

    if (isQualitySample) {
      quality[i] = true;
      qualityTimeS += sampleDuration;
    }
  }

  const qualityTimeMin = qualityTimeS / 60;

  // ── Step 2: Regime segmenter (hysteresis, v4) ──────────────────────────────
  //
  // The structural segmenter is always pace-based (its purpose is structure
  // detection, not effort measurement — HR/GAP drove the quality-time count in
  // Step 1). It finds the sustained pace REGIMES the eye sees as rectangles,
  // not every sample that dips below a line: (1) smooth raw pace over ~40 s,
  // then (2) a two-state machine with a floor-relative hysteresis band. The
  // dead-band between ENTER and EXIT bridges intra-rep sag (hills/turns/GPS
  // jitter) and rejects brief warm-up dips that never sustain — the two failure
  // modes (ragged clipped boundaries + fragments) of the old per-sample glue,
  // fixed at the source. See .git/sdd/interval-detection-diagnosis.md.

  // Smoothed pace: centered moving mean of raw pace over ±(SMOOTH_WINDOW_S / 2)
  // seconds. Stops (v ≤ V_MIN) are excluded from the mean; a sample with no
  // valid neighbours stays Infinity (never work).
  const half = SMOOTH_WINDOW_S / 2;
  const smoothed: number[] = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    let paceSum = 0;
    let paceCount = 0;
    for (let j = i; j >= 0 && t[i]! - t[j]! <= half; j--) {
      const vj = v[j]!;
      if (vj > V_MIN) { paceSum += METERS_PER_MILE / vj; paceCount++; }
    }
    for (let j = i + 1; j < n && t[j]! - t[i]! <= half; j++) {
      const vj = v[j]!;
      if (vj > V_MIN) { paceSum += METERS_PER_MILE / vj; paceCount++; }
    }
    if (paceCount > 0) smoothed[i] = paceSum / paceCount;
  }

  // Floor-relative hysteresis band (per-runner).
  const enterPace = paceFloorSecPerMi - REGIME_ENTER_OFFSET_S;
  const exitPace = paceFloorSecPerMi + REGIME_EXIT_OFFSET_S;

  // Measure a work regime spanning inclusive samples [startIdx, endIdx] as a
  // HardBlock — distance/duration off the sample BEFORE the start (so the span
  // credits the full inter-sample gap), average pace over its valid samples.
  const measureBlock = (startIdx: number, endIdx: number): HardBlock => {
    const prevT = startIdx > 0 ? t[startIdx - 1]! : 0;
    const durationS = t[endIdx]! - prevT;

    const prevD = startIdx > 0 ? d[startIdx - 1]! : 0;
    const distMeters = d[endIdx]! - prevD;

    let paceSum = 0;
    let paceCount = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      const vi = v[i]!;
      if (vi > V_MIN) {
        paceSum += METERS_PER_MILE / vi;
        paceCount++;
      }
    }
    const avgPace = paceCount > 0 ? paceSum / paceCount : 0;

    return { distanceMeters: distMeters, paceSecPerMi: avgPace, durationS, startIdx, endIdx };
  };

  // Two-state machine: enter WORK at the ENTER sample, leave at the sample
  // BEFORE the one that crosses EXIT, so a regime spans its sustained work only.
  // Keep a regime only when it is long enough (≥ minRep — kills single-sample
  // noise; short reps survive) AND its average pace genuinely clears the floor
  // (≤ avgClearPace — drops a dead-band block that latched a brief dip and
  // coasted through a moderate stretch averaging ~floor pace).
  const avgClearPace = paceFloorSecPerMi - REGIME_AVG_CLEAR_S;
  const keep = (b: HardBlock): boolean => b.durationS >= minRep && b.paceSecPerMi <= avgClearPace;
  let blocks: HardBlock[] = [];
  let inWork = false;
  let workStart = 0;
  for (let i = 0; i < n; i++) {
    if (!inWork && smoothed[i]! <= enterPace) {
      inWork = true;
      workStart = i;
    } else if (inWork && smoothed[i]! >= exitPace) {
      const b = measureBlock(workStart, i - 1);
      if (keep(b)) blocks.push(b);
      inWork = false;
    }
  }
  if (inWork) {
    const b = measureBlock(workStart, n - 1);
    if (keep(b)) blocks.push(b);
  }

  // ── Step 2b: HR confirmation ────────────────────────────────────────────────
  // Pace segments candidate blocks (responsive boundaries), but pace alone can't
  // tell a slow-but-hard interval from a moderate stretch of an easy run. When an
  // HR floor is set and the run carries HR, a block only counts as a real effort
  // if its average HR clears the floor — so a 7:00 rep at 88% max HR is kept while
  // a 7:00 stretch at 72% max HR is dropped. Blocks lacking HR data are left as-is
  // (pace already qualified them).
  const confirmedBlocks =
    hrFloor != null && Array.isArray(hr) && hr.length >= n
      ? blocks.filter((b) => {
          const avgHr = blockAvgHr(hr, b.startIdx, b.endIdx);
          return avgHr == null || avgHr >= hrFloor;
        })
      : blocks;

  // ── Step 3: Classify ────────────────────────────────────────────────────────
  const movingTime = computeMovingTime(stream, V_MIN);
  const runTotalMeters = n > 0 ? d[n - 1]! : 0; // coverage test: work vs whole run
  const structureKind = classifyBlocks(confirmedBlocks, movingTime, runTotalMeters);

  // Structure only counts as quality with enough TOTAL hard time — a handful of
  // brief surges on an easy run forms ≥2 blocks but isn't a session.
  const blockTimeS = confirmedBlocks.reduce((acc, b) => acc + b.durationS, 0);
  const hasStructure = structureKind !== 'none' && blockTimeS >= STRUCTURE_MIN_S;
  // Pure pace-mode AND grade-adjusted (GAP) mode: "total time below an absolute
  // pace" balloons with run length (a 3-hr easy run trivially clears 15 min from
  // downhills + variance alone — the corpus's biggest false-positive family), so
  // neither may bank quality on time alone; they require real STRUCTURE. Only HR
  // carries a genuine effort signal, so only HR keeps the time-based path.
  const effortTimePath = useHr && qualityTimeMin >= MIN_QUALITY_MIN;
  const isQuality = hasStructure || effortTimePath;

  // Use the structure kind when present; otherwise report 'none' even if
  // qualityTimeMin passed (the kind tracks block structure, not time)
  const kind: QualityKind = hasStructure ? structureKind : 'none';

  // ── Step 4: Summary ─────────────────────────────────────────────────────────
  const summary = buildSummary(confirmedBlocks, kind, qualityTimeMin, isQuality);

  // Detected quality DISTANCE — sum of the (HR-confirmed) hard blocks. Pace-
  // invariant: the same 4×2mi at any honest effort sums to ~8mi.
  const qualityDistanceMeters = confirmedBlocks.reduce((s, b) => s + b.distanceMeters, 0);

  return { isQuality, kind, blocks: confirmedBlocks, summary, qualityTimeMin, qualityDistanceMeters };
}

// ── Classification ─────────────────────────────────────────────────────────────

/** Average HR over [startIdx, endIdx], skipping missing/zero samples; null if none. */
function blockAvgHr(hr: number[], startIdx: number, endIdx: number): number | null {
  let sum = 0;
  let count = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const beat = hr[i];
    if (typeof beat === 'number' && beat > 0) {
      sum += beat;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

function computeMovingTime(stream: RunStream, vMin: number): number {
  const { v, t } = stream;
  const n = Math.min(v.length, t.length);
  if (n === 0) return 0;

  let total = 0;
  for (let i = 0; i < n; i++) {
    if (v[i]! > vMin) {
      const prevT = i > 0 ? t[i - 1]! : 0;
      total += t[i]! - prevT;
    }
  }
  return total;
}

/**
 * A coherent rep set: a small number of similar-sized efforts. Distinguishes a
 * real interval workout (4×2mi, 10×400m) from the scattered faster moments of a
 * continuous run, which vary wildly in size and run into the dozens.
 */
function coherentIntervals(blocks: HardBlock[]): boolean {
  if (blocks.length < 2 || blocks.length > MAX_INTERVAL_REPS) return false;
  const dists = blocks.map((b) => b.distanceMeters).sort((a, b) => a - b);
  const median = dists[Math.floor(dists.length / 2)]!;
  if (median <= 0) return false;
  const similar = blocks.filter((b) => Math.abs(b.distanceMeters - median) / median <= REP_SIM_TOL).length;
  return similar >= 2 && similar >= blocks.length * REP_CLUSTER_FRAC;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * A progression: ≥3 sustained blocks (in run order) whose pace steps DOWN — the
 * closing third faster than the opening third by ≥ PROGRESSION_MIN_DROP_S, with
 * the step-to-step changes mostly downward. Blocks arrive in stream / lap order,
 * so their natural order IS time order.
 */
export function isProgression(blocks: HardBlock[]): boolean {
  if (blocks.length < PROGRESSION_MIN_BLOCKS) return false;
  const paces = blocks.map((b) => b.paceSecPerMi);
  const third = Math.max(1, Math.floor(paces.length / 3));
  const openAvg = mean(paces.slice(0, third));
  const closeAvg = mean(paces.slice(-third));
  if (openAvg - closeAvg < PROGRESSION_MIN_DROP_S) return false; // not enough net speed-up
  let faster = 0;
  for (let i = 1; i < paces.length; i++) if (paces[i]! <= paces[i - 1]!) faster++;
  return faster / (paces.length - 1) >= PROGRESSION_MONOTONE_FRAC;
}

/**
 * Classify a set of hard blocks (from the stream regime segmenter OR reconciled
 * from marked laps) into a workout shape. `runTotalMeters` is the whole run's
 * distance — the coverage test needs it to tell recovery-separated intervals
 * from a continuous effort that merely got mile-auto-lapped. Exported so the
 * lap-first verdict classifies with the SAME logic instead of assuming intervals.
 */
export function classifyBlocks(blocks: HardBlock[], movingTime: number, runTotalMeters: number): QualityKind {
  if (blocks.length === 0) return 'none';
  const totalHardS = blocks.reduce((acc, b) => acc + b.durationS, 0);
  const longestS = blocks.reduce((m, b) => Math.max(m, b.durationS), 0);
  const workMeters = blocks.reduce((s, b) => s + b.distanceMeters, 0);
  const coverage = runTotalMeters > 0 ? workMeters / runTotalMeters : 0;

  if (blocks.length >= 2) {
    // Pace steps down across the run → a progression (checked first: a negative-
    // split effort can otherwise look like a dominant block or a coherent set).
    if (isProgression(blocks)) return 'progression';
    // A single block dominating the hard work = one sustained effort (a tempo),
    // not N intervals — brief warmup pickups split off extra blocks but shouldn't
    // turn a 30-min sustained effort into "7 reps".
    if (totalHardS > 0 && longestS / totalHardS >= DOMINANT_BLOCK_FRAC) return 'tempo';
    // A coherent set of similar reps that leaves recovery (work is a MINORITY of
    // the run) → intervals. High coverage means no recovery between the "reps" —
    // a continuous run mile-auto-lapped, which is a tempo, not intervals.
    if (coherentIntervals(blocks) && coverage <= COVERAGE_INTERVALS_MAX) return 'intervals';
    // Work spans the bulk of the run with no real recovery → one sustained effort.
    if (coverage > COVERAGE_INTERVALS_MAX) return 'tempo';
    // No rep coherence, but one long sustained block among the scatter → tempo.
    if (longestS >= TEMPO_MIN_S) return 'tempo';
    // Scattered, varied blocks = normal pace variance, not a workout.
    return 'none';
  }

  // 1 block: a ≥10-min sustained effort is a tempo regardless of run length;
  // otherwise it's a tempo only if it's ≥50% of the moving time.
  if (longestS >= TEMPO_MIN_S) return 'tempo';
  if (movingTime > 0 && longestS / movingTime >= 0.5) return 'tempo';
  return 'none';
}

// ── Summary reconstruction ─────────────────────────────────────────────────────

/**
 * Build a summary string that reports both quality-time minutes and block
 * structure (when present).
 *
 * Format:
 *   "<N> min @ threshold"                     — tempo (1 block)
 *   "<N> min @ threshold + 4×2mi @ m:ss"      — intervals
 *   ""                                          — not quality
 */
function buildSummary(
  blocks: HardBlock[],
  kind: QualityKind,
  qualityTimeMin: number,
  isQuality: boolean,
): string {
  if (!isQuality) return '';

  const minRounded = Math.round(qualityTimeMin);

  if (kind === 'none') {
    // Quality via time alone (no structure) — still surface the minutes
    return `${minRounded} min @ threshold`;
  }

  if (kind === 'tempo') {
    const b = blocks[0]!;
    const paceStr = formatPaceMi(b.paceSecPerMi);
    return `${minRounded} min @ threshold + tempo @ ${paceStr}`;
  }

  if (kind === 'progression') {
    return `${minRounded} min @ threshold + ${progressionSummary(blocks)}`;
  }

  // Interval summary: collapse near-equal blocks (shared with the lap-first path).
  return `${minRounded} min @ threshold + ${repGroupSummary(blocks)}`;
}

/**
 * Progression summary: total hard distance + the opening→closing pace step, e.g.
 * "4mi progression 7:40→6:50". Shared by the stream detector and the lap-first
 * verdict so a progression reads identically wherever it's classified.
 */
export function progressionSummary(blocks: HardBlock[]): string {
  if (blocks.length === 0) return '';
  const mi = (blocks.reduce((s, b) => s + b.distanceMeters, 0) / METERS_PER_MILE)
    .toFixed(1)
    .replace(/\.0$/, '');
  return `${mi}mi progression ${formatPaceMi(blocks[0]!.paceSecPerMi)}→${formatPaceMi(blocks[blocks.length - 1]!.paceSecPerMi)}`;
}

// ── Task 2: matchPlannedQuality ───────────────────────────────────────────────

/**
 * Compare detected quality blocks to a planned workout structure.
 *
 * Matched when:
 *  - both are intervals AND rep count + per-rep distance align within ~25%
 *  - or both are tempo (one hard block) AND roughly the same duration
 *
 * @param detect           Output of detectQuality.
 * @param plannedStructure The workout's structure (Segment[]).
 */
export function matchPlannedQuality(
  detect: QualityDetect,
  plannedStructure: Segment[],
  context: PlannedIntervalContext = {},
): { matched: boolean; note: string | null } {
  if (!detect.isQuality || detect.blocks.length === 0) {
    return { matched: false, note: null };
  }

  const plannedIntervals = extractPlannedIntervals(plannedStructure, context);

  // Case 1: detected intervals vs planned intervals
  if (detect.kind === 'intervals' && plannedIntervals !== null) {
    const detectedReps = detect.blocks.length;
    const { reps: plannedReps, groups } = plannedIntervals;
    let aligned = false;

    if (groups.length === 1) {
      // Preserve the original tolerance for a single uniform set.
      const detectedDistPerRep =
        detect.blocks.reduce((s, b) => s + b.distanceMeters, 0) / detectedReps;
      const target = groups[0]!.distPerRepMeters;
      const repRatio = Math.abs(detectedReps - plannedReps) / plannedReps;
      const distRatio = target > 0
        ? Math.abs(detectedDistPerRep - target) / target
        : 1;
      aligned = repRatio <= 0.25 && distRatio <= 0.25;
    } else if (detectedReps === plannedReps) {
      // Mixed sets are order-sensitive: compare each detected block with the
      // target of the set it belongs to (4×400 + 4×800 is eight planned reps,
      // never "8 versus the first 4").
      const targets = groups.flatMap((group) =>
        Array.from({ length: group.reps }, () => group.distPerRepMeters));
      aligned = detect.blocks.every((block, index) => {
        const target = targets[index] ?? 0;
        return target > 0 && Math.abs(block.distanceMeters - target) / target <= 0.25;
      });
    }

    if (aligned) {
      const noteStructure = renderStructure(plannedStructure, 'mi');
      return { matched: true, note: `matches your planned ${noteStructure}` };
    }
  }

  // Case 2: detected tempo vs planned steady/tempo
  if (detect.kind === 'tempo' && plannedIntervals === null) {
    const hasSteady = plannedStructure.some((s) => s.kind === 'steady');
    if (hasSteady) {
      const noteStructure = renderStructure(plannedStructure, 'mi');
      return { matched: true, note: `matches your planned ${noteStructure}` };
    }
  }

  return { matched: false, note: null };
}

// ── Helpers for matchPlannedQuality ──────────────────────────────────────────

export interface PlannedIntervalGroup {
  reps: number;
  distPerRepMeters: number;
}

export interface PlannedIntervals {
  /** Total reps across every repeat block. */
  reps: number;
  /** First set's target, retained for legacy single-set consumers. */
  distPerRepMeters: number;
  groups: PlannedIntervalGroup[];
}

export interface PlannedIntervalContext extends QualityPaceContext {
  /** Stable total hard distance captured when a duration workout was built. */
  prescribedTotalMeters?: number | null;
}

const isWorkLeaf = (seg: Exclude<Segment, { kind: 'repeat' }>) => {
  if (seg.kind === 'work' || seg.kind === 'interval') return true;
  return seg.kind === 'steady' && seg.target.hr_zone !== 'easy';
};

function explicitHardMeters(segments: Segment[], multiplier = 1): number {
  let total = 0;
  for (const segment of segments) {
    if (segment.kind === 'repeat') {
      total += explicitHardMeters(segment.children, multiplier * segment.sets);
    } else if (isWorkLeaf(segment) && segment.target.distance_m != null) {
      total += segment.target.distance_m * multiplier;
    }
  }
  return total;
}

export function extractPlannedIntervals(
  structure: Segment[],
  context: PlannedIntervalContext = {},
): PlannedIntervals | null {
  const currentTotal = prescribedQualityMeters(structure, undefined, context);
  const explicitMeters = explicitHardMeters(structure);
  const currentTimedMeters = Math.max(0, currentTotal - explicitMeters);
  const capturedTimedMeters = Math.max(
    0,
    (context.prescribedTotalMeters ?? currentTotal) - explicitMeters,
  );
  // Explicit 400m/800m targets are facts and never scale. Only duration-derived
  // distances absorb the snapshot correction.
  const timedScale = context.prescribedTotalMeters != null
    && context.prescribedTotalMeters > 0
    && currentTimedMeters > 0
    ? capturedTimedMeters / currentTimedMeters
    : 1;

  const groups: PlannedIntervalGroup[] = [];
  for (const seg of structure) {
    if (seg.kind === 'repeat') {
      const repeatSeg = seg as RepeatSegment;
      const workChild = repeatSeg.children.find((child) => (
        child.kind !== 'repeat' && isWorkLeaf(child)
      ))
        ?? repeatSeg.children[0];
      if (!workChild) continue;

      const estimated = workChild.kind !== 'repeat'
        ? estimatedQualityLeafMeters(workChild, context)
        : 0;
      const distPerRepMeters = workChild.kind !== 'repeat' && workChild.target.distance_m != null
        ? workChild.target.distance_m
        : estimated * timedScale;
      groups.push({ reps: repeatSeg.sets, distPerRepMeters });
    }
  }
  if (groups.length === 0) return null;
  return {
    reps: groups.reduce((total, group) => total + group.reps, 0),
    distPerRepMeters: groups[0]!.distPerRepMeters,
    groups,
  };
}
