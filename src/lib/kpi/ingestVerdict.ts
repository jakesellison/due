/**
 * ingestVerdict.ts — the corpus-validated ingest-time quality verdict.
 *
 * Pure. No IO. Node-tested.
 * Spec: .git/sdd/detector-study.md §4 (proposed policy).
 *
 * A single decision tree that blends the athlete's marked LAPS, the pace/HR
 * STREAM detector, and a per-runner HR floor into one trustworthy verdict.
 * Replaces the bare `detectQuality(streamNoHr, floor)` call that concentrated
 * the corpus's three failure modes:
 *
 *  - FM-1: GAP-time on long runs balloons into false "quality" (127 rows).
 *  - FM-2: strides / pickups read as "N×0.1mi @ ~7:00 intervals" (~8–14 rows).
 *  - FM-3: real lap-marked sessions misread or missed (ingest never saw laps).
 *
 * The tree (evaluated in order):
 *   1. LAP-FIRST — when the athlete marked ≥2 spread work reps totalling ≥800 m,
 *      and they clear either the pace margin OR HR confirmation, the reps ARE the
 *      structure (exact count / per-rep distance / per-rep pace from laps).
 *   2. STREAM — else run `detectQuality` WITH the hrFloor. A stream 'intervals'
 *      verdict survives only past the strides guard (≥800 m hard AND median rep
 *      pace ≤ floor − 60 s/mi, OR HR-confirmed). 'tempo' passes through.
 *   3. NONE / time-path — a kind-'none' quality flag (the HR time-path) is kept
 *      only when HR actually measured the effort; GAP/pace time alone is dropped.
 *
 * Returns the same `QualityDetect` shape plus a `source: 'laps' | 'stream'` tag,
 * with an HONEST summary string (zone language only when HR confirmed it).
 */

import {
  detectQuality,
  isProgression,
  repGroupSummary,
  progressionSummary,
  formatPaceMi,
  COVERAGE_INTERVALS_MAX,
  type QualityDetect,
  type QualityKind,
  type HardBlock,
  type RunStream,
} from './qualityDetect';
import {
  repsFromLaps,
  type LapRep,
} from './lapIntervals';
import {
  reconcileLapsWithRegime,
} from './lapsRegime';
import type { StravaLap } from '../run/analysis';
import type { QualityFloor } from './qualityFloor';
import {
  METERS_PER_MILE,
} from '../units';

/**
 * Version stamp for the WHOLE computed `stream_summary` (pace_curve + early_miles
 * + quality verdict + actualBar — all recomputed together by computeStreamSummary),
 * stored on `stream_summary.quality.v` (the JSON field name stays `v` for
 * back-compat; renaming it would need a data migration). Bumped whenever any part
 * of that computation changes, so the backfill re-enrich predicate
 * (ENRICH_SELECT_FILTER, src/server/backfill.ts) re-picks rows written by older
 * code, and so clients (SessionView) know a stored summary is current-policy
 * authoritative. The version list below is quality-detector-centric for history,
 * but the stamp governs the entire summary.
 *   1 (or absent) = pre-overhaul distance-based detector.
 *   2 = the laps+stream+HR ingest verdict tree (detector-study.md §4).
 *   3 = block-level recovery merge for full-res 1 Hz streams (≤15 s gaps
 *       between ≥40 s hard blocks) — the 2026-06-18 rep-fragmentation fix
 *       (week6-quality-investigation.md §3).
 *   4 = hysteresis REGIME detection replaces the raw-pace threshold+glue
 *       segmenter (smoothed pace + floor-relative ENTER/EXIT band) — truer rep
 *       boundaries, no warm-up/recovery fragments, no mid-rep clipping
 *       (interval-detection-diagnosis.md, LOCKED v4 design).
 *   5 = precomputed ACTUAL-shape bar (`quality.actualBar`): the run's real
 *       shape positioned by distance from its stream, for the Dash today card's
 *       completed state (actual-bar-report.md). Also re-propagates v4 detection
 *       to any rows still carrying stale v3 blocks.
 *   6 = LAP↔REGIME reconciliation replaces strict lap-first: regime blocks group
 *       over-granular laps into their true reps (a 4×2mi session lapped every
 *       mile now reads 4×2mi, not 8×1mi), while laps outside every block are
 *       kept (a short rep regime missed). See lapsRegime.ts (laps-regime-report.md).
 *   7 = the lap-first verdict CLASSIFIES its reps (intervals / tempo /
 *       progression) via the shared classifyBlocks instead of assuming
 *       intervals — a coverage test stops a mile-auto-lapped continuous run
 *       reading as "N×1mi intervals", a ≥150 m rep floor drops auto-lap
 *       fragments (0–50 m), continuous lap efforts (tempo/progression) are
 *       HR-gated, and 'progression' is a first-class kind. Fixes the corpus-
 *       sweep false positives (detector-tempo-progression).
 *   8 = the lap-first/stream tree above is replaced at ingest by the
 *       plan-conditioned CHANGE-POINT interpreter (interpretWorkout):
 *       Optimal-Partitioning DP over a composite z(GAP-speed)+z(HR) per-lap
 *       signal, raw∧GAP∧HR classify gates, adjacent-hard merge, and a CROPS
 *       coarse→fine candidate ladder. `stream_summary.quality` gains nested
 *       `honest`/`matched`/`candidates`/`defaultIdx`; the flat QualityDetect
 *       fields become the resolved credit (`matched ?? honest`). This
 *       `computeIngestVerdict` tree remains exported as the documented
 *       client-side fallback (SessionView, when a stored summary is stale or
 *       absent) until the UI cutover (Task E2).
 *   9 = honest-read precision floor (interpretWorkout MIN_HONEST_QUALITY_MI):
 *       an UNPRESCRIBED run must bank ≥ ~1 mi of grade-adjusted-fast work for
 *       the honest read to credit quality, else `none` — kills the surge/GPS-
 *       blip false positives on easy runs (the "easy run that just felt hard"
 *       reading as 2×0.4mi intervals) while a genuine short PRESCRIBED workout
 *       still credits via `matched` (chosen from the ungated candidate ladder).
 *  10 = plan-aligned interval readings: the corpus-validated lap/regime verdict
 *       becomes an additional prescribed candidate, reps are aligned in order
 *       (per-rep shape before total distance), incidental tail fragments cannot
 *       inflate the rep count, and grouped watch laps retain their declared
 *       distance/pace instead of the stream regime's trimmed boundary metrics.
 */
export const STREAM_SUMMARY_VERSION = 10;

// ── Panel-validated constants (detector-study.md §4) ──────────────────────────

/** Minimum total work distance (m) for a LAP-marked session to count. */
const LAP_MIN_WORK_M = 800;
/** Minimum total hard distance (m) for a STREAM 'intervals' verdict to survive. */
const STREAM_MIN_WORK_M = 800;
/**
 * Pace margin (s/mi) below the floor that a rep set's MEDIAN pace must clear to
 * be "genuinely faster than the floor" without HR. Floor 456 − 60 = 396 s/mi
 * (6:36/mi): the runner's real reps (≤6:12) pass, near-floor strides (6:49–7:20)
 * fail — the guard that saves the two no-HR stride runs HR can't reach.
 */
const THRESH_MARGIN_SEC_PER_MI = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IngestVerdictInput {
  /** The activity stream. `hr` present + populated enables HR confirmation. */
  streams: RunStream;
  /** The activity's Strava laps (ground truth for marked reps). */
  laps?: StravaLap[] | null;
  /** The per-runner moderate-effort floor (paceFloor + optional hrFloor). */
  floor: QualityFloor;
}

export interface IngestVerdict extends QualityDetect {
  /** Which evidence produced the verdict — 'laps' (marked reps) or 'stream'. */
  source: 'laps' | 'stream';
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Whether the stream carries a real, aligned HR channel (not an all-null column). */
function streamHasHr(stream: RunStream): boolean {
  const { d, v, t, hr } = stream;
  const n = Math.min(d.length, v.length, t.length);
  if (!Array.isArray(hr) || hr.length < n) return false;
  for (let i = 0; i < n; i++) {
    const beat = hr[i];
    if (typeof beat === 'number' && beat > 0) return true;
  }
  return false;
}

const notQuality = (source: 'laps' | 'stream'): IngestVerdict => ({
  isQuality: false,
  kind: 'none',
  blocks: [],
  summary: '',
  qualityTimeMin: 0,
  qualityDistanceMeters: 0,
  source,
});

/** Lap reps → HardBlock shape (duration from distance × pace). */
function blocksFromReps(reps: LapRep[]): HardBlock[] {
  return reps.map((r) => ({
    distanceMeters: r.distanceMeters,
    paceSecPerMi: r.paceSecPerMi,
    durationS: (r.distanceMeters / METERS_PER_MILE) * r.paceSecPerMi,
    startIdx: r.startIdx,
    endIdx: r.endIdx,
  }));
}

/** Lap-sourced tempo summary: total hard minutes + distance-weighted pace. */
function lapTempoSummary(blocks: HardBlock[]): string {
  const totalS = blocks.reduce((s, b) => s + b.durationS, 0);
  const totalM = blocks.reduce((s, b) => s + b.distanceMeters, 0);
  const avgPace = totalM > 0 ? totalS / (totalM / METERS_PER_MILE) : 0;
  return `${Math.round(totalS / 60)} min tempo @ ${formatPaceMi(avgPace)}`;
}

/**
 * Build a QualityDetect-shaped verdict from the marked lap reps, classified into
 * its true shape. Lap-sourced summaries name the reps + real pace, never an
 * unearned "@ threshold" zone claim.
 */
function lapVerdict(reps: LapRep[], workMeters: number, kind: QualityKind): IngestVerdict {
  const blocks = blocksFromReps(reps);
  const qualityTimeMin = blocks.reduce((s, b) => s + b.durationS, 0) / 60;
  const summary =
    kind === 'progression'
      ? progressionSummary(blocks)
      : kind === 'tempo'
        ? lapTempoSummary(blocks)
        : repGroupSummary(reps);
  return {
    isQuality: true,
    kind,
    blocks,
    summary,
    qualityTimeMin,
    qualityDistanceMeters: workMeters,
    source: 'laps',
  };
}

/**
 * Honest summary for a KEPT stream verdict. Intervals/tempo name their measured
 * pace (never an unearned "@ threshold"); the kind-'none' HR time-path is the
 * only case that says "@ threshold" — because HR genuinely measured the zone.
 */
function honestStreamSummary(det: QualityDetect, kind: QualityKind): string {
  if (kind === 'intervals') return repGroupSummary(det.blocks);
  if (kind === 'progression') return progressionSummary(det.blocks);
  if (kind === 'tempo') {
    const b = det.blocks.reduce((a, x) => (x.durationS > a.durationS ? x : a), det.blocks[0]!);
    return `${Math.round(b.durationS / 60)} min tempo @ ${formatPaceMi(b.paceSecPerMi)}`;
  }
  // kind 'none' kept via the HR time-path — HR measured the threshold zone.
  return `${Math.round(det.qualityTimeMin)} min @ threshold`;
}

// ── The verdict ─────────────────────────────────────────────────────────────────

/**
 * Compute the ingest-time quality verdict. See the module header for the tree.
 */
export function computeIngestVerdict(input: IngestVerdictInput): IngestVerdict {
  const { streams, laps, floor } = input;
  const hasHr = streamHasHr(streams);

  // Stream regime detection, computed UP FRONT: it both reconciles the marked
  // laps (grouping over-granular laps into their true reps) and drives the
  // no-usable-laps fallback path below.
  const det = detectQuality(streams, floor);

  // ── 1. LAP-FIRST (reconciled with regime) ─────────────────────────────────────
  const lapReps = repsFromLaps(laps, {
    paceFloorSecPerMi: floor.paceFloorSecPerMi,
    hrFloor: floor.hrFloor,
    stream: streams,
  });
  if (lapReps.length >= 2) {
    // Regime blocks group over-lapped reps into their real shape; laps outside
    // every block are kept. Jun 23's 8 mile-laps → 4×2mi; a clean N-lap session
    // is unchanged. Gates below evaluate on the RECONCILED reps.
    const reps = reconcileLapsWithRegime(lapReps, det.blocks);
    const workM = reps.reduce((s, r) => s + r.distanceMeters, 0);
    if (reps.length >= 2 && workM >= LAP_MIN_WORK_M) {
      // Classify the MARKED reps by COVERAGE — not size-coherence. The laps ARE
      // the athlete's structure, so a mixed set (4×400 + 2×800, a ladder) is a
      // real interval session even though the reps aren't uniform. What tells a
      // workout from a continuous run mile-auto-lapped is whether recovery
      // separates the work (coverage < the ceiling) or the "reps" run back-to-
      // back over the whole run (coverage ≈ 1). Progression (pace stepping down)
      // is recognised in either case.
      const runTotalMeters = streams.d.length ? streams.d[streams.d.length - 1]! : 0;
      const coverage = runTotalMeters > 0 ? workM / runTotalMeters : 0;
      const stepDown = isProgression(blocksFromReps(reps));

      const medPace = median(reps.map((r) => r.paceSecPerMi));
      const paceOk = medPace <= floor.paceFloorSecPerMi - THRESH_MARGIN_SEC_PER_MI;
      const closeCount = Math.max(1, Math.floor(reps.length / 3));
      const closingPace = median(reps.slice(-closeCount).map((r) => r.paceSecPerMi));
      const closingFast = closingPace <= floor.paceFloorSecPerMi - THRESH_MARGIN_SEC_PER_MI;

      const repsWithHr = reps.filter((r) => r.avgHr != null);
      const allRepsLackHr = repsWithHr.length === 0;
      const hrConfirmedReps =
        floor.hrFloor != null ? repsWithHr.filter((r) => r.avgHr! >= floor.hrFloor!).length : 0;
      const hrMajority = hrConfirmedReps >= Math.ceil(reps.length / 2);

      if (coverage <= COVERAGE_INTERVALS_MAX) {
        // Recovery-separated marked reps = a genuine workout. Intervals, or a
        // progression when the reps step down. Clears on the pace margin OR HR.
        const kind: QualityKind = stepDown ? 'progression' : 'intervals';
        const hrOk = !hasHr || floor.hrFloor == null || allRepsLackHr || hrMajority;
        if (paceOk || hrOk) return lapVerdict(reps, workM, kind);
      } else {
        // Back-to-back reps over the whole run = a continuous effort (mile-auto-
        // lapped). It banks quality ONLY when genuinely hard: a tempo needs HR
        // confirmation (a fit runner's easy long run has all-fast mile laps but
        // no elevated HR); a progression needs a real fast finish (closing reps
        // clear the pace margin) or HR. Otherwise falls through to stream.
        const kind: QualityKind = stepDown ? 'progression' : 'tempo';
        const confirmed =
          kind === 'progression'
            ? closingFast || hrMajority
            : hasHr && floor.hrFloor != null
              ? hrMajority
              : paceOk;
        if (confirmed) return lapVerdict(reps, workM, kind);
      }
      // Nothing confirmed → fall through to stream detection.
    }
  }

  // ── 2. STREAM DETECTION (HR-confirmed when hrFloor + HR are present) ──────────
  if (det.kind === 'intervals') {
    const medRepPace = median(det.blocks.map((b) => b.paceSecPerMi));
    const paceOk = medRepPace <= floor.paceFloorSecPerMi - THRESH_MARGIN_SEC_PER_MI;
    const hrConfirmed = hasHr && floor.hrFloor != null;
    // Strides guard: near-floor bursts (FM-2) fail both legs → not a workout.
    if (det.qualityDistanceMeters >= STREAM_MIN_WORK_M && (paceOk || hrConfirmed)) {
      return { ...det, summary: honestStreamSummary(det, 'intervals'), source: 'stream' };
    }
    return notQuality('stream');
  }

  if (det.kind === 'tempo' || det.kind === 'progression') {
    // Stream tempo/progression is structure-validated (a sustained regime that
    // clears the floor, HR-confirmed when HR is present) — pass through.
    return { ...det, summary: honestStreamSummary(det, det.kind), source: 'stream' };
  }

  // ── 3. kind === 'none': GAP/pace time-path balloon guard ──────────────────────
  if (det.isQuality) {
    // Reached only via the HR time-path (effortTimePath now requires HR), but
    // re-assert the gate: HR-time is real effort; GAP/pace-time alone is not.
    if (hasHr && floor.hrFloor != null) {
      return { ...det, summary: honestStreamSummary(det, 'none'), source: 'stream' };
    }
    return notQuality('stream');
  }

  return notQuality('stream');
}
