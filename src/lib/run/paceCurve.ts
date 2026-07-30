/**
 * The RUNNING POWER CURVE (a pace-duration / mean-maximal-pace curve, the
 * GoldenCheetah-MMP analogue for runners): for each of a fixed ladder of
 * durations, the BEST sustained pace the runner has ever held over a contiguous
 * MOVING window of at least that long, across every stream-bearing run.
 *
 * This generalises `bestSustainedPace` (analysis.ts) — same pause-aware window
 * discipline (gap samples excluded via v ≤ the moving floor or an auto-paused
 * dt jump > 3× the median; window time = MOVING dt sum) — from one window length
 * to the whole ladder, and tracks WHICH run earned each point so the chart can
 * name it.
 *
 * Honesty about resolution: persisted streams are capped at ≤500 samples, so a
 * long run is sampled at ≈14 s spacing (a 2 h run). For a duration below ~2× the
 * median sample spacing we cannot resolve a true sustained window, so we fall
 * back to the fastest single moving sample and FLAG the point `coarse` so the UI
 * can de-emphasise it — with a 60 s floor and 500-sample streams this rarely
 * fires. Everything here is pure + node-tested — no React, no Supabase.
 */

import {
  METERS_PER_MILE,
} from '../units';
import type { RunStreams } from './analysis';

/**
 * The duration ladder (seconds) the curve is sampled at, ascending: 1 min → 2 h.
 *
 * A DENSE log-spaced grid (~7% multiplicative steps) so the curve reads as a
 * smooth continuous line on a log-x axis rather than a coarse polyline. Built
 * once at module load: start 60 s, step ×1.07 up to 7200 s, snap each to an
 * integer second and dedupe — ≈75 distinct durations. The 1 min floor matches
 * the smallest sustained window we report; finer durations were quantization
 * noise dominated by a single sample.
 *
 * The LABELLED tick set the axis draws (1m/5m/20m/1h/2h) is separate
 * (`LABELLED_DURATIONS`); it is NOT what the curve is sampled at.
 */
export const DURATIONS: readonly number[] = buildDurationGrid();

/** The labelled axis ticks (seconds) — for the x-axis only, not the sampling grid. */
export const LABELLED_DURATIONS = [60, 300, 1200, 3600, 7200] as const;

function buildDurationGrid(): number[] {
  const MIN = 60;
  const MAX = 7200;
  const STEP = 1.07;
  const set = new Set<number>();
  for (let d = MIN; d <= MAX + 0.5; d *= STEP) set.add(Math.round(d));
  set.add(MAX); // guarantee the exact endpoint (rounding can drift off MAX)
  // Fold the labelled axis ticks IN so each axis tick lands on a real curve
  // point (the chart projects ticks onto the line; tests anchor on these too).
  for (const d of [60, 300, 600, 1200, 1800, 3600, 7200]) set.add(d);
  return [...set].sort((a, b) => a - b);
}

/** The moving-velocity floor (m/s) — mirrors analysis.ts. ≈ 33:20/km. */
const MOVING_FLOOR = 0.5;

const MS_TO_SEC_PER_KM = (v: number): number => (v > 0 ? 1000 / v : Infinity);

/** Median of a numeric array (non-mutating), or 0 when empty. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** The achieving run's identity, carried on each curve point. */
export interface CurveRunRef {
  id: string;
  /** Display name (e.g. "Boston Marathon"), or null when unnamed. */
  name: string | null;
  /** Run date — civil 'YYYY-MM-DD' or an ISO instant, whatever the caller has. */
  date: string | null;
}

/** A single charted point of the pace-duration curve. */
export interface PaceCurvePoint {
  /** Window length, seconds (one of DURATIONS). */
  durationS: number;
  /** Best sustained pace over that window, seconds per kilometre. */
  paceSecPerKm: number;
  /** Best mean speed (m/s) — the raw quantity the pace is derived from. */
  speed: number;
  /**
   * True when the duration is finer than the run's sampling can resolve
   * (duration < 2× median sample spacing): the value is a single-sample
   * fallback, not a genuine sustained window. The UI de-emphasises these.
   */
  coarse: boolean;
  /** The run that earned this point. */
  run: CurveRunRef;
}

/** An activity carrying (maybe) streams, the minimal shape the curve reads. */
export interface CurveActivity {
  id: string;
  name?: string | null;
  /** Run date — civil date or ISO instant; passed straight onto the point. */
  date?: string | null;
  streams: RunStreams | null;
}

/** Per-interval moving time + distance for a stream, gaps zeroed out. */
interface MovingSegments {
  /** segTime[i] = moving seconds for interval (i-1 → i), 0 when a gap. */
  segTime: number[];
  /** segDist[i] = moving meters for interval (i-1 → i), 0 when a gap. */
  segDist: number[];
  /**
   * Prefix sum of segTime: prefT[i] = Σ segTime[0..i-1] (length n+1, prefT[0]=0).
   * Lets a window's moving time be read as prefT[j]-prefT[i] in O(1).
   */
  prefT: number[];
  /** Prefix sum of segDist (length n+1, prefD[0]=0). */
  prefD: number[];
  /** Median sample spacing (s) over the non-gap intervals. */
  medDt: number;
  /** Median per-sample distance (m) over the non-gap intervals (distance curve). */
  medDist: number;
  /** Total moving time across the stream (s). */
  totalMovingS: number;
  /** Total moving distance across the stream (m). */
  totalMovingM: number;
  /** Number of usable samples (min of t,v lengths). */
  n: number;
  /** Fastest single moving sample's speed (m/s), for sub-resolution fallback. */
  maxSampleSpeed: number;
}

/**
 * Decompose a stream into per-interval moving time + distance (gaps zeroed),
 * matching `bestSustainedPace`'s gap rule exactly, plus the running totals the
 * curve needs. Returns null when the stream is too short to use.
 */
function movingSegments(streams: RunStreams): MovingSegments | null {
  const { t, v } = streams;
  const n = Math.min(t.length, v.length);
  if (n < 2) return null;

  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(t[i]! - t[i - 1]!);
  const medDt = median(dts.filter((x) => x > 0));
  const gapDt = medDt > 0 ? medDt * 3 : Infinity;

  const segTime: number[] = new Array(n).fill(0);
  const segDist: number[] = new Array(n).fill(0);
  let totalMovingS = 0;
  let totalMovingM = 0;
  let maxSampleSpeed = 0;
  const movingDists: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = t[i]! - t[i - 1]!;
    const vel = v[i]!;
    const moving = dt > 0 && dt <= gapDt && Number.isFinite(vel) && vel > MOVING_FLOOR;
    if (!moving) continue;
    segTime[i] = dt;
    segDist[i] = vel * dt;
    totalMovingS += dt;
    totalMovingM += vel * dt;
    movingDists.push(vel * dt);
    if (vel > maxSampleSpeed) maxSampleSpeed = vel;
  }
  const medDist = median(movingDists);

  // Prefix sums over the moving segments — built once so each duration's best
  // window is an O(n) two-pointer over the prefix arrays (no per-duration rescan
  // of the raw segments).
  const prefT: number[] = new Array(n + 1);
  const prefD: number[] = new Array(n + 1);
  prefT[0] = 0;
  prefD[0] = 0;
  for (let i = 0; i < n; i++) {
    prefT[i + 1] = prefT[i]! + segTime[i]!;
    prefD[i + 1] = prefD[i]! + segDist[i]!;
  }

  return { segTime, segDist, prefT, prefD, medDt, medDist, totalMovingS, totalMovingM, n, maxSampleSpeed };
}


function bestWindowSpeedFromSegments(seg: MovingSegments, durationS: number): number | null {
  const { prefT, prefD, n, totalMovingS } = seg;
  if (totalMovingS < durationS) return null;

  // Two-pointer over prefix sums: for each window end `j` (exclusive),
  // advance the start `i` to the smallest window whose moving time ≥ durationS,
  // then read the window's mean speed in O(1). Each pointer only moves forward,
  // so the whole scan is O(n) per duration.
  let best = 0;
  let i = 0;
  for (let j = 1; j <= n; j++) {
    // Shrink from the left while we can still keep ≥ durationS of moving time.
    while (prefT[j]! - prefT[i + 1]! >= durationS) i++;
    const winT = prefT[j]! - prefT[i]!;
    if (winT >= durationS) {
      const winD = prefD[j]! - prefD[i]!;
      if (winD > 0) {
        const speed = winD / winT;
        if (speed > best) best = speed;
      }
    }
  }
  return best > 0 ? best : null;
}

/** A candidate best-speed reading for a duration, with its source run + coarse flag. */
interface SpeedReading {
  speed: number;
  coarse: boolean;
  run: CurveRunRef;
}

/**
 * The best window speed for `durationS` from one run's pre-computed segments,
 * with the coarse-fallback rule. When the duration is finer than ~2× the median
 * sample spacing AND the run has at least one moving sample, we return the
 * fastest single-sample speed flagged `coarse` (the genuine window is below the
 * data's resolution). Otherwise we return the true window speed (not coarse), or
 * null when the run is shorter than the duration.
 */
function readingForDuration(
  seg: MovingSegments,
  durationS: number,
  run: CurveRunRef,
): SpeedReading | null {
  const coarse = seg.medDt > 0 && durationS < 2 * seg.medDt;
  if (coarse) {
    // Sub-resolution: the best single moving sample is the most we can claim.
    // Still gate on total moving time so a 5 s run can't seed a 10 s point.
    if (seg.totalMovingS < durationS || seg.maxSampleSpeed <= 0) return null;
    return { speed: seg.maxSampleSpeed, coarse: true, run };
  }
  const speed = bestWindowSpeedFromSegments(seg, durationS);
  if (speed == null) return null;
  return { speed, coarse: false, run };
}

/**
 * Best-window readings for one run across the WHOLE duration grid in a single
 * efficient pass, returned aligned with `DURATIONS` (null where the run is
 * shorter than that duration). For each duration we run the prefix-sum
 * two-pointer; because the grid is ascending and the run's segments are fixed,
 * this is O(n) per duration with tiny constants (no raw-segment rescans), so a
 * ~100-duration grid over a ≤200-sample run is a few tens of thousands of ops.
 *
 * A per-run cummax on speed is applied along the grid from the LONGEST duration
 * downward, so a shorter window is always at least as fast as any longer one —
 * i.e. speed is non-increasing as duration grows (a longer window can never read
 * faster than a shorter one WITHIN this run). This is the structural fix for the
 * coarse-boundary kinks and lifts a slow coarse single-sample reading up to the
 * genuine longer-window speed rather than letting it dip. The coarse flag
 * (duration < 2× the run's median dt) is preserved for UI opacity styling.
 */
function gridReadings(seg: MovingSegments, run: CurveRunRef): (SpeedReading | null)[] {
  const out: (SpeedReading | null)[] = new Array(DURATIONS.length).fill(null);
  for (let k = 0; k < DURATIONS.length; k++) {
    out[k] = readingForDuration(seg, DURATIONS[k]!, run);
  }
  // Enforce non-increasing speed by sweeping long→short and taking a cummax:
  // each shorter window must be at least as fast as the longest window it spans.
  let runningMax = 0;
  for (let k = DURATIONS.length - 1; k >= 0; k--) {
    const r = out[k];
    if (!r) continue;
    if (r.speed >= runningMax) {
      runningMax = r.speed;
    } else {
      out[k] = { speed: runningMax, coarse: r.coarse, run };
    }
  }
  return out;
}

/** Civil-date / ISO instant → comparable epoch ms (Infinity-safe), or null. */
function dateMs(date: string | null | undefined): number | null {
  if (!date) return null;
  const iso = date.length <= 10 ? `${date}T12:00:00Z` : date;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Whether `date` falls within the last `sinceDays` of `nowMs` (inclusive). */
function withinDays(date: string | null | undefined, sinceDays: number, nowMs: number): boolean {
  const ms = dateMs(date);
  if (ms == null) return false;
  return ms >= nowMs - sinceDays * 24 * 3600 * 1000;
}

export interface PaceCurveOptions {
  /** Only include runs whose date is within the last `sinceDays` days. */
  sinceDays?: number;
  /** "Now" epoch ms for the `sinceDays` window (defaults to Date.now()). */
  nowMs?: number;
}

/**
 * Build the pace-duration curve over `activities`: for every duration in
 * DURATIONS, the single best (fastest) sustained pace across all runs that carry
 * streams, with the achieving run and a coarse flag. Durations no run can cover
 * are omitted (the curve simply stops at the longest sustainable window).
 *
 * Activities without streams are skipped and counted (`nSkipped`). When
 * `sinceDays` is set, only runs whose date is within that window contribute.
 */
export function paceCurve(
  activities: CurveActivity[],
  opts: PaceCurveOptions = {},
): { points: PaceCurvePoint[]; nWithStreams: number; nSkipped: number } {
  const nowMs = opts.nowMs ?? Date.now();
  const sinceDays = opts.sinceDays;

  // Best reading per grid duration across the qualifying runs (index-aligned
  // with DURATIONS so we never key a Map on float-prone duration values).
  const best: (SpeedReading | null)[] = new Array(DURATIONS.length).fill(null);
  let nWithStreams = 0;
  let nSkipped = 0;

  for (const a of activities) {
    if (!a.streams) {
      nSkipped++;
      continue;
    }
    if (sinceDays != null && !withinDays(a.date, sinceDays, nowMs)) continue;
    const seg = movingSegments(a.streams);
    if (!seg) {
      nSkipped++;
      continue;
    }
    nWithStreams++;
    const run: CurveRunRef = { id: a.id, name: a.name ?? null, date: a.date ?? null };
    const readings = gridReadings(seg, run);
    for (let k = 0; k < DURATIONS.length; k++) {
      const reading = readings[k];
      if (!reading) continue;
      const prev = best[k];
      // The FASTEST reading per duration wins, carrying its own coarse flag.
      if (!prev || reading.speed > prev.speed) best[k] = reading;
    }
  }

  // Cross-run monotonicity: the envelope of per-run monotone curves is the max
  // over non-increasing curves, so it is already non-increasing in speed across
  // the grid. We sweep long→short with a cummax for total robustness (different
  // runs winning adjacent durations can never introduce a kink). This mutates
  // each winning reading's speed in place before the points are assembled.
  let envMax = 0;
  for (let k = DURATIONS.length - 1; k >= 0; k--) {
    const r = best[k];
    if (!r) continue;
    if (r.speed >= envMax) {
      envMax = r.speed;
    } else {
      best[k] = { speed: envMax, coarse: r.coarse, run: r.run };
    }
  }

  const points: PaceCurvePoint[] = [];
  for (let k = 0; k < DURATIONS.length; k++) {
    const r = best[k];
    if (!r) continue;
    points.push({
      durationS: DURATIONS[k]!,
      speed: r.speed,
      paceSecPerKm: MS_TO_SEC_PER_KM(r.speed),
      coarse: r.coarse,
      run: r.run,
    });
  }
  return { points, nWithStreams, nSkipped };
}

export interface PaceCurves {
  /** The all-time best curve. */
  allTime: PaceCurvePoint[];
  /** The best curve over the last 84 days (12 weeks). */
  recent: PaceCurvePoint[];
  /** Runs with usable streams that fed the all-time curve. */
  nWithStreams: number;
  /** Total activities considered (with and without streams). */
  nTotal: number;
}

/** The 12-week recent window, in days. */
export const RECENT_DAYS = 84;



// ===========================================================================
// Distance-windowed curve — best sustained pace per DISTANCE (the Trends pace
// curve plots mileage on x). Mirrors the duration engine above but cursors the
// moving-DISTANCE prefix sum (prefD) instead of moving-time; reuses the same
// pause-aware segments + cross-run monotonic envelope.
// ===========================================================================

/**
 * The distance ladder (metres) the distance curve is sampled at, ascending:
 * ~0.5 mi → marathon. A dense log-spaced grid (×1.07) so the curve reads smooth
 * on a log-x axis, with the labelled mile/race ticks folded in so each lands on
 * a real curve point.
 */
const DISTANCES_M: readonly number[] = buildDistanceGrid();


function buildDistanceGrid(): number[] {
  const MIN = 805; // ~0.5 mi
  const MAX = 48280; // ~30 mi (ultra headroom; the curve still stops at the longest run)
  const STEP = 1.07;
  const set = new Set<number>();
  for (let d = MIN; d <= MAX + 0.5; d *= STEP) set.add(Math.round(d));
  set.add(MAX);
  // Fold the round mile marks in so each axis tick lands on a real curve point.
  for (const d of [1609, 8047, 16093, 32187, 48280]) set.add(d);
  return [...set].sort((a, b) => a - b);
}

/** A single charted point of the pace-DISTANCE curve. */
export interface PaceDistancePoint {
  /** Window length, metres (one of DISTANCES_M). */
  distanceMeters: number;
  /** Best sustained pace over that distance, seconds per kilometre. */
  paceSecPerKm: number;
  /** Best mean speed (m/s) the pace derives from. */
  speed: number;
  /** True when the distance is finer than the run's sampling can resolve. */
  coarse: boolean;
  /** The run that earned this point. */
  run: CurveRunRef;
}

/**
 * Best MEAN SPEED (m/s) over any contiguous MOVING window of at least
 * `distanceM` metres in this run's segments, or null when the run's total moving
 * distance is below it. Two-pointer over the moving-distance prefix sum.
 */
function bestWindowSpeedByDistanceFromSegments(seg: MovingSegments, distanceM: number): number | null {
  const { prefT, prefD, n, totalMovingM } = seg;
  if (totalMovingM < distanceM) return null;
  let best = 0;
  let i = 0;
  for (let j = 1; j <= n; j++) {
    while (prefD[j]! - prefD[i + 1]! >= distanceM) i++;
    const winD = prefD[j]! - prefD[i]!;
    if (winD >= distanceM) {
      const winT = prefT[j]! - prefT[i]!;
      if (winT > 0) {
        const speed = winD / winT;
        if (speed > best) best = speed;
      }
    }
  }
  return best > 0 ? best : null;
}

/** Coarse-aware best-speed reading for one distance from a run's segments. */
function readingForDistance(seg: MovingSegments, distanceM: number, run: CurveRunRef): SpeedReading | null {
  const coarse = seg.medDist > 0 && distanceM < 2 * seg.medDist;
  if (coarse) {
    if (seg.totalMovingM < distanceM || seg.maxSampleSpeed <= 0) return null;
    return { speed: seg.maxSampleSpeed, coarse: true, run };
  }
  const speed = bestWindowSpeedByDistanceFromSegments(seg, distanceM);
  if (speed == null) return null;
  return { speed, coarse: false, run };
}

/** Best readings for one run across the DISTANCES_M grid, monotonic (long→short cummax). */
function gridReadingsByDistance(seg: MovingSegments, run: CurveRunRef): (SpeedReading | null)[] {
  const out: (SpeedReading | null)[] = new Array(DISTANCES_M.length).fill(null);
  for (let k = 0; k < DISTANCES_M.length; k++) out[k] = readingForDistance(seg, DISTANCES_M[k]!, run);
  let runningMax = 0;
  for (let k = DISTANCES_M.length - 1; k >= 0; k--) {
    const r = out[k];
    if (!r) continue;
    if (r.speed >= runningMax) runningMax = r.speed;
    else out[k] = { speed: runningMax, coarse: r.coarse, run };
  }
  return out;
}

/**
 * Shared post-loop assembly: turns the per-distance best readings into a
 * monotonic `PaceDistancePoint[]` array. Called by both `paceCurveByDistance`
 * and `envelopeFromPrecomputed` so the envelope logic stays DRY.
 */
function assemblePoints(best: (SpeedReading | null)[]): PaceDistancePoint[] {
  // Cross-run monotonic envelope (long→short cummax) — same as the time curve.
  let envMax = 0;
  for (let k = DISTANCES_M.length - 1; k >= 0; k--) {
    const r = best[k];
    if (!r) continue;
    if (r.speed >= envMax) envMax = r.speed;
    else best[k] = { speed: envMax, coarse: r.coarse, run: r.run };
  }

  const points: PaceDistancePoint[] = [];
  for (let k = 0; k < DISTANCES_M.length; k++) {
    const r = best[k];
    if (!r) continue;
    points.push({
      distanceMeters: DISTANCES_M[k]!,
      speed: r.speed,
      paceSecPerKm: MS_TO_SEC_PER_KM(r.speed),
      coarse: r.coarse,
      run: r.run,
    });
  }
  return points;
}

/** Build the pace-distance curve over `activities` (cf. `paceCurve` for time). */
function paceCurveByDistance(
  activities: CurveActivity[],
  opts: PaceCurveOptions = {},
): { points: PaceDistancePoint[]; nWithStreams: number; nSkipped: number } {
  const nowMs = opts.nowMs ?? Date.now();
  const sinceDays = opts.sinceDays;
  const best: (SpeedReading | null)[] = new Array(DISTANCES_M.length).fill(null);
  let nWithStreams = 0;
  let nSkipped = 0;

  for (const a of activities) {
    if (!a.streams) {
      nSkipped++;
      continue;
    }
    if (sinceDays != null && !withinDays(a.date, sinceDays, nowMs)) continue;
    const seg = movingSegments(a.streams);
    if (!seg) {
      nSkipped++;
      continue;
    }
    nWithStreams++;
    const run: CurveRunRef = { id: a.id, name: a.name ?? null, date: a.date ?? null };
    const readings = gridReadingsByDistance(seg, run);
    for (let k = 0; k < DISTANCES_M.length; k++) {
      const reading = readings[k];
      if (!reading) continue;
      const prev = best[k];
      if (!prev || reading.speed > prev.speed) best[k] = reading;
    }
  }

  return { points: assemblePoints(best), nWithStreams, nSkipped };
}

export interface PaceDistanceCurves {
  /** All-time best pace-distance curve. */
  allTime: PaceDistancePoint[];
  /** Best pace-distance curve over the last 84 days (12 weeks). */
  recent: PaceDistancePoint[];
  nWithStreams: number;
  nTotal: number;
}

export interface ActivityCurvePoint {
  distanceMeters: number;
  paceSecPerKm: number;
  speed: number;
  coarse: boolean;
}

/**
 * One run's OWN best pace at each distance window (no cross-run envelope) — the
 * precomputable per-activity curve stored in stream_summary.pace_curve. The
 * corpus envelope (paceCurvesFromPrecomputed) is the per-distance max of these.
 */
export function activityPaceCurve(streams: RunStreams | null): ActivityCurvePoint[] {
  if (!streams) return [];
  const seg = movingSegments(streams);
  if (!seg) return [];
  // gridReadingsByDistance needs a run ref for its point objects; the summary
  // discards it, so pass a throwaway.
  const readings = gridReadingsByDistance(seg, { id: '', name: null, date: null });
  const out: ActivityCurvePoint[] = [];
  for (let k = 0; k < DISTANCES_M.length; k++) {
    const r = readings[k];
    if (!r) continue;
    out.push({
      distanceMeters: DISTANCES_M[k]!,
      paceSecPerKm: 1000 / r.speed,
      speed: r.speed,
      coarse: r.coarse ?? false,
    });
  }
  return out;
}


export interface PrecomputedCurveActivity {
  id: string;
  name?: string | null;
  date?: string | null;
  curve: ActivityCurvePoint[] | null;
}

function envelopeFromPrecomputed(
  activities: PrecomputedCurveActivity[],
  opts: { sinceDays?: number; nowMs: number },
): { points: PaceDistancePoint[]; nWithStreams: number } {
  const best: (SpeedReading | null)[] = new Array(DISTANCES_M.length).fill(null);
  let nWithStreams = 0;
  const distIndex = new Map(DISTANCES_M.map((d, i) => [d, i]));
  for (const a of activities) {
    if (!a.curve || a.curve.length === 0) continue;
    if (opts.sinceDays != null && !withinDays(a.date, opts.sinceDays, opts.nowMs)) continue;
    nWithStreams++;
    const run: CurveRunRef = { id: a.id, name: a.name ?? null, date: a.date ?? null };
    for (const p of a.curve) {
      const k = distIndex.get(p.distanceMeters);
      if (k == null) continue;
      const reading: SpeedReading = { speed: p.speed, coarse: p.coarse, run };
      const prev = best[k];
      if (!prev || reading.speed > prev.speed) best[k] = reading;
    }
  }
  return { points: assemblePoints(best), nWithStreams };
}

export function paceCurvesFromPrecomputed(
  activities: PrecomputedCurveActivity[],
  nowMs?: number,
): PaceDistanceCurves {
  const now = nowMs ?? Date.now();
  const allTime = envelopeFromPrecomputed(activities, { nowMs: now });
  const recent = envelopeFromPrecomputed(activities, { sinceDays: RECENT_DAYS, nowMs: now });
  return {
    allTime: allTime.points,
    recent: recent.points,
    nWithStreams: allTime.nWithStreams,
    nTotal: activities.length,
  };
}

// ===========================================================================
// DURATION precomputed curve — per-activity best pace at each DURATIONS grid
// point, stored in stream_summary.pace_duration_curve. Mirrors activityPaceCurve
// (distance) but uses the duration-window internals (gridReadings / DURATIONS).
// ===========================================================================

/**
 * A single point of a per-activity DURATION pace curve stored in stream_summary.
 * Mirrors `ActivityCurvePoint` but keys on `durationS` instead of `distanceMeters`.
 */
export interface ActivityDurationCurvePoint {
  durationS: number;
  paceSecPerKm: number;
  speed: number;
  coarse: boolean;
}

/**
 * One run's own best pace at each DURATIONS window it covers — the precomputable
 * duration counterpart of `activityPaceCurve`. The corpus duration envelope
 * (`paceDurationCurveFromPrecomputed`) is the per-duration max of these.
 */
export function activityPaceDurationCurve(streams: RunStreams | null): ActivityDurationCurvePoint[] {
  if (!streams) return [];
  const seg = movingSegments(streams);
  if (!seg) return [];
  // gridReadings needs a run ref; the summary discards it, so pass a throwaway.
  const readings = gridReadings(seg, { id: '', name: null, date: null });
  const out: ActivityDurationCurvePoint[] = [];
  for (let k = 0; k < DURATIONS.length; k++) {
    const r = readings[k];
    if (!r) continue;
    out.push({
      durationS: DURATIONS[k]!,
      paceSecPerKm: 1000 / r.speed,
      speed: r.speed,
      coarse: r.coarse ?? false,
    });
  }
  return out;
}

/** An activity with a precomputed DURATION curve (for `paceDurationCurveFromPrecomputed`). */
export interface PrecomputedDurationCurveActivity {
  id: string;
  name?: string | null;
  date?: string | null;
  curve: ActivityDurationCurvePoint[] | null;
}

/**
 * Best-per-duration envelope from precomputed per-activity duration curves.
 * Mirrors `envelopeFromPrecomputed` (distance) — best speed per DURATIONS index
 * across qualifying runs, then a cross-run monotonic sweep, then assembled into
 * `{ durationS, paceSecPerKm }[]` points. When `sinceDays` is set, only runs
 * whose date is within that window contribute.
 */
export function paceDurationCurveFromPrecomputed(
  activities: PrecomputedDurationCurveActivity[],
  opts: { sinceDays?: number; nowMs?: number } = {},
): { points: { durationS: number; paceSecPerKm: number }[] } {
  const nowMs = opts.nowMs ?? Date.now();
  const best: (SpeedReading | null)[] = new Array(DURATIONS.length).fill(null);
  const durIndex = new Map(DURATIONS.map((d, i) => [d, i]));

  for (const a of activities) {
    if (!a.curve || a.curve.length === 0) continue;
    if (opts.sinceDays != null && !withinDays(a.date, opts.sinceDays, nowMs)) continue;
    const run: CurveRunRef = { id: a.id, name: a.name ?? null, date: a.date ?? null };
    for (const p of a.curve) {
      const k = durIndex.get(p.durationS);
      if (k == null) continue;
      const reading: SpeedReading = { speed: p.speed, coarse: p.coarse, run };
      const prev = best[k];
      if (!prev || reading.speed > prev.speed) best[k] = reading;
    }
  }

  // Cross-run monotonic envelope (long→short cummax) — mirrors paceCurve.
  let envMax = 0;
  for (let k = DURATIONS.length - 1; k >= 0; k--) {
    const r = best[k];
    if (!r) continue;
    if (r.speed >= envMax) {
      envMax = r.speed;
    } else {
      best[k] = { speed: envMax, coarse: r.coarse, run: r.run };
    }
  }

  const points: { durationS: number; paceSecPerKm: number }[] = [];
  for (let k = 0; k < DURATIONS.length; k++) {
    const r = best[k];
    if (!r) continue;
    points.push({ durationS: DURATIONS[k]!, paceSecPerKm: 1000 / r.speed });
  }
  return { points };
}

