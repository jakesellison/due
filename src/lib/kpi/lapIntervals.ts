// src/lib/kpi/lapIntervals.ts
/**
 * lapIntervals.ts — derive interval work-reps from a run's Strava LAPS.
 *
 * When the athlete marks intervals on their watch (the lap button), Strava
 * returns exact per-lap distance / moving-time / HR. That is ground truth —
 * far better than re-detecting reps from a downsampled stream, which blurs
 * short (200–400 m) efforts and reports paces ~20–40 s/mi too slow. This module
 * classifies the work reps straight from those laps.
 *
 * Pure. No IO. Node-tested. A lap is a WORK rep when it is a rep-sized effort
 * (default ≤ ~2 mi, so a tempo mile is never mistaken for an interval) AND it
 * clears the effort floor by EITHER pace (≤ paceFloor) OR — for SHORT (sub-mile)
 * laps only — heart rate (avg HR ≥ hrFloor when an hrFloor is known). The HR leg
 * catches a slow-but-hard rep — an uphill/altitude interval whose pace barely
 * beats easy but whose HR is unmistakably in the work zone (effort beats pace,
 * mirroring the stream detector's quality-time rule). It is restricted to
 * sub-mile laps so a hard CONTINUOUS run recorded with mile auto-laps isn't
 * chopped into fake "N×1mi intervals" (see HR_WORK_MAX_METERS). Returns [] when
 * the laps show no interval structure (fewer than two work laps), so the caller
 * falls back to stream detection.
 */
import type { StravaLap } from '../run/analysis';
import {
  REP_MILE_MIN_M,
  type RunStream,
} from './qualityDetect';
import {
  METERS_PER_MILE,
} from '../units';

/**
 * Largest lap (m) the HR leg will promote to a work rep. Deliberately sub-mile
 * (REP_MILE_MIN_M ≈ 1400 m): a genuine interval rep is short and marked, whereas
 * a full-mile-and-up lap on a hard CONTINUOUS run (a tempo, progression, or race
 * recorded with mile auto-laps) also sits above the HR floor — and HR-classifying
 * those chops one sustained effort into fake "N×1mi intervals" (8 such false
 * positives in the corpus sweep). Mile-and-up laps must therefore still earn
 * "work" on PACE (threshold mile-repeats already clear it); only short laps get
 * the slow-but-hard HR rescue.
 */
const HR_WORK_MAX_METERS = REP_MILE_MIN_M;

/**
 * Smallest lap (m) that can be a work rep. Below this a "lap" is an auto-lap
 * leftover — the 0–50 m tail a watch emits when the run distance doesn't divide
 * evenly, or a GPS hiccup — never a real interval. Without this floor those
 * fragments clear the pace test and read as extra reps ("+ 1×50m", "+ 1×0m" in
 * the corpus sweep).
 */
const MIN_REP_METERS = 150;

export interface LapRep {
  distanceMeters: number;
  paceSecPerMi: number;
  avgHr: number | null;
  /** Stream sample indices bracketing the lap (for chart highlight); -1 when unmapped. */
  startIdx: number;
  endIdx: number;
}

export interface LapRepsOpts {
  /** A lap at or under this pace (sec/mi) is a "work" effort. */
  paceFloorSecPerMi: number;
  /**
   * Steady/threshold HR floor (bpm). A lap whose average HR is at or above this
   * counts as work even when its pace doesn't clear the pace floor — the
   * slow-but-hard (uphill / altitude) rep. Null/absent → pace is the only test.
   */
  hrFloor?: number | null;
  /** The stream, to map lap boundaries onto sample indices. Optional. */
  stream?: RunStream | null;
  /** Largest work-lap distance (m) still treated as a rep. Default ≈ 2 mi. */
  maxRepMeters?: number;
}

/** Pace (sec/mi) of a lap from its distance + moving time; null when unusable. */
export function lapPaceSecPerMi(lap: StravaLap): number | null {
  const d = lap.distance ?? 0;
  const mt = lap.moving_time ?? 0;
  if (d <= 0 || mt <= 0) return null;
  return mt / (d / METERS_PER_MILE);
}

/** First stream index whose cumulative distance ≥ target (binary search). */
function idxAtDistance(d: number[], target: number): number {
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((d[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Work reps from a run's laps. Empty when the laps carry no interval structure
 * (< 2 work laps) — the signal for the caller to fall back to stream detection.
 */
export function repsFromLaps(laps: StravaLap[] | null | undefined, opts: LapRepsOpts): LapRep[] {
  if (!Array.isArray(laps) || laps.length < 3) return [];
  const maxRep = opts.maxRepMeters ?? METERS_PER_MILE * 2.05;

  // Cumulative distance at the end of each lap, to bracket it onto the stream.
  const cumEnd: number[] = [];
  let cum = 0;
  for (const l of laps) {
    cum += l.distance ?? 0;
    cumEnd.push(cum);
  }

  const reps: LapRep[] = [];
  laps.forEach((lap, i) => {
    const pace = lapPaceSecPerMi(lap);
    const dist = lap.distance ?? 0;
    if (pace == null || dist > maxRep || dist < MIN_REP_METERS) return;
    // Work when the lap clears the floor by pace OR by heart rate. The HR leg
    // keeps a slow-but-hard rep (uphill / altitude) that pace alone would drop.
    const avgHr = lap.average_heartrate != null ? Math.round(lap.average_heartrate) : null;
    const paceWork = pace <= opts.paceFloorSecPerMi;
    // HR rescues only SHORT (sub-mile) reps — a mile-and-up lap must clear on
    // pace, so a hard continuous run's mile auto-laps aren't chopped into reps.
    const hrWork =
      opts.hrFloor != null && avgHr != null && avgHr >= opts.hrFloor && dist < HR_WORK_MAX_METERS;
    if (!paceWork && !hrWork) return;

    let startIdx = -1;
    let endIdx = -1;
    if (opts.stream && opts.stream.d.length > 1) {
      const startD = i > 0 ? cumEnd[i - 1]! : 0;
      startIdx = idxAtDistance(opts.stream.d, startD);
      endIdx = Math.max(startIdx, idxAtDistance(opts.stream.d, cumEnd[i]!));
    }

    reps.push({
      distanceMeters: dist,
      paceSecPerMi: pace,
      avgHr,
      startIdx,
      endIdx,
    });
  });

  if (reps.length < 2) return [];
  // NOTE: contiguous fast laps (a continuous run recorded with mile auto-laps)
  // are deliberately KEPT here, not dropped. The caller (computeIngestVerdict)
  // now CLASSIFIES the reconciled reps by coverage — contiguous work covering the
  // bulk of the run becomes 'tempo'/'progression' (HR-gated), while spread reps
  // with recovery become 'intervals'. Discarding them here would throw away the
  // athlete's ground-truth laps and force a weaker stream re-detection.
  return reps;
}
