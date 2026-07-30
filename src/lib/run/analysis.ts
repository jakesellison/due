/**
 * Pure, node-tested derivations for the per-run Activity analysis (pace & HR
 * charts, mile splits, best sustained pace). Every function here is a
 * deterministic transform over the compact columnar `streams` shape persisted on
 * each activity (migration 0003) — no Supabase, no React, no globals.
 *
 * Stream conventions (all arrays index-aligned to `t`):
 *   t  — seconds from activity start
 *   d  — cumulative distance, meters
 *   v  — velocity, m/s
 *   hr — heart rate, bpm (null where the source lacked HR at that sample)
 *   alt — altitude, meters (null entirely when absent)
 *
 * Pace is carried as seconds-per-kilometre (s/km) throughout — the same unit
 * `formatPace` consumes — so the UI can render mi or km off one number.
 */

import {
  METERS_PER_MILE,
} from '../units';

/** The columnar activity streams this module reads (structural, matches DB). */
export interface RunStreams {
  t: number[];
  d: number[];
  v: number[];
  hr: (number | null)[];
  alt?: number[] | null;
}

/** A single charted pace sample: elapsed seconds + smoothed pace (s/km). */
export interface PacePoint {
  /** Elapsed seconds from activity start. */
  t: number;
  /**
   * Pace at this sample, seconds per kilometre (smaller = faster), or null when
   * the runner was stopped/paused (velocity at or below the moving floor) so the
   * chart breaks the line across the gap instead of drawing a fake slow pace.
   */
  paceSecPerKm: number | null;
}

/**
 * A run's summary totals, as persisted on the activity row. When present these
 * are the source of truth for average pace: `movingTimeS` excludes auto-paused
 * stops, so it yields the TRUE moving pace the runner held — unlike the stream's
 * elapsed span (`t[last]-t[0]`), which includes every pause and inflates pace.
 */
export interface RunSummary {
  /** Moving time, seconds (pauses excluded). */
  movingTimeS: number | null;
  /** Total distance, meters. */
  distanceMeters: number | null;
}

/** A single charted HR sample: elapsed seconds + bpm (null = gap, don't draw). */
export interface HrPoint {
  t: number;
  /** Heart rate (bpm), or null where the source lacked HR — break the line. */
  hr: number | null;
}

/**
 * A Strava-style lap object (the subset the splits ledger reads from `laps`).
 * Strava does not expose whether a lap came from an automatic device interval
 * or a manual lap-button press, so the UI renders the backend ledger verbatim.
 */
export interface StravaLap {
  name?: string | null;
  /** Lap distance, meters. */
  distance?: number | null;
  /** Lap moving time, seconds. */
  moving_time?: number | null;
  average_heartrate?: number | null;
  /** Strava lap average grade, percent, when present. */
  average_grade?: number | null;
  /** Lap average temperature, °C, when present. Most activities only have run-level temp. */
  average_temp?: number | null;
  lap_index?: number | null;
  split?: number | null;
  start_index?: number | null;
  end_index?: number | null;
}

/** A per-mile split row for the ledger. */
export interface MileSplit {
  /** 1-based mile number. */
  mile: number;
  /** Average pace over this mile, seconds per kilometre. */
  paceSecPerKm: number;
  /** Average HR over this mile (bpm), or null when HR was absent. */
  avgHr: number | null;
  /** Meters covered in this split (a partial final split is < a mile). */
  distanceMeters: number;
  /** Net altitude change / distance, percent, or null when altitude is absent. */
  avgGradePct: number | null;
  /** True when this is the final partial split (< 1 mile). */
  partial: boolean;
}

const MS_TO_SEC_PER_KM = (v: number): number => (v > 0 ? 1000 / v : Infinity);

/** Round to 2dp for compact SVG path strings. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Build an SVG path `d` string of a polyline through `pts`. Optionally close it
 * back down to `baselineY` (an area fill) rather than leaving an open line.
 * Pure + string-only so it builds an `SkPath` lazily on the native side and
 * needs no CanvasKit instance (so it runs under jest with the Skia JS mock).
 */
export function polylinePath(
  pts: { x: number; y: number }[],
  closeToBaselineY?: number,
): string {
  if (pts.length === 0) return '';
  const parts: string[] = [];
  if (closeToBaselineY != null) {
    parts.push(`M${r2(pts[0]!.x)} ${r2(closeToBaselineY)}`);
    for (const p of pts) parts.push(`L${r2(p.x)} ${r2(p.y)}`);
    parts.push(`L${r2(pts[pts.length - 1]!.x)} ${r2(closeToBaselineY)}`);
    parts.push('Z');
  } else {
    parts.push(`M${r2(pts[0]!.x)} ${r2(pts[0]!.y)}`);
    for (let i = 1; i < pts.length; i++) parts.push(`L${r2(pts[i]!.x)} ${r2(pts[i]!.y)}`);
  }
  return parts.join(' ');
}


/**
 * The moving-velocity floor (m/s). At or below this the runner is stopped or
 * auto-paused (a red light, a stop, a GPS dropout) — NOT running — so the sample
 * is a gap: it never contributes a pace point, a best-window, or split time.
 * 0.5 m/s ≈ 33:20/km, far slower than any real running pace.
 */
const MOVING_FLOOR = 0.5;

/** Median of a numeric array (non-mutating), or 0 when empty. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * The fastest sustained average pace over any contiguous MOVING window of at
 * least `windowS` seconds, in seconds per kilometre. This is the honest "best
 * pace" for the header — a sliding window over the moving stream, NOT a single
 * noisy sample and NOT skewed by pauses.
 *
 * The window is built from the velocity stream `v`: gap samples (v ≤ the moving
 * floor, or a sample whose interval `dt` exceeds 3× the median — an auto-paused
 * jump in `t`) are excluded so a stop inside the window can't inflate its time.
 * For each start we accumulate moving time + moving distance forward until the
 * window covers ≥ `windowS` of MOVING seconds, then pace = time / km. Returns
 * null when the run carries less than `windowS` of moving time.
 */
export function bestSustainedPace(streams: RunStreams, windowS = 60): number | null {
  const { t, v } = streams;
  const n = Math.min(t.length, v.length);
  if (n < 2) return null;

  // Per-interval (i-1 → i) moving time + distance, with gaps zeroed out.
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(t[i]! - t[i - 1]!);
  const medDt = median(dts.filter((x) => x > 0));
  const gapDt = medDt > 0 ? medDt * 3 : Infinity;

  const segTime: number[] = new Array(n).fill(0);
  const segDist: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dt = t[i]! - t[i - 1]!;
    const vel = v[i]!;
    const moving = dt > 0 && dt <= gapDt && Number.isFinite(vel) && vel > MOVING_FLOOR;
    if (!moving) continue;
    segTime[i] = dt;
    segDist[i] = vel * dt; // distance from velocity over the interval
  }

  let best = Infinity;
  let j = 1;
  let winT = 0;
  let winD = 0;
  for (let i = 1; i < n; i++) {
    if (j < i) {
      j = i;
      winT = 0;
      winD = 0;
    }
    // Grow the window forward until it holds ≥ windowS of MOVING time.
    while (j < n && winT < windowS) {
      winT += segTime[j]!;
      winD += segDist[j]!;
      j++;
    }
    if (winT >= windowS && winD > 0) {
      const pace = MS_TO_SEC_PER_KM(winD / winT);
      if (pace < best) best = pace;
    }
    // Slide: drop the start interval's contribution for the next iteration.
    winT -= segTime[i]!;
    winD -= segDist[i]!;
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * The average pace of the whole run (s/km). When the run's `summary` totals are
 * available this is the TRUE moving pace — `movingTimeS / km` — which excludes
 * auto-paused stops. Without a summary it falls back to the stream's elapsed
 * span (total distance over `t[last]-t[0]`), which includes pauses and so reads
 * slower; callers that have the summary should always pass it.
 */
export function averagePace(streams: RunStreams, summary?: RunSummary): number | null {
  if (
    summary &&
    summary.movingTimeS != null &&
    summary.movingTimeS > 0 &&
    summary.distanceMeters != null &&
    summary.distanceMeters > 0
  ) {
    return summary.movingTimeS / (summary.distanceMeters / 1000);
  }
  const { t, d } = streams;
  const n = Math.min(t.length, d.length);
  if (n < 2) return null;
  const dt = t[n - 1]! - t[0]!;
  const dist = d[n - 1]! - d[0]!;
  if (dt <= 0 || dist <= 0) return null;
  return MS_TO_SEC_PER_KM(dist / dt);
}

/** Rolling median over a window of `w` samples (odd `w`), edge-clamped. */
function rollingMedian(values: number[], w: number): number[] {
  const n = values.length;
  if (n === 0 || w <= 1) return values.slice();
  const half = Math.floor(w / 2);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    const win: number[] = [];
    for (let k = lo; k <= hi; k++) win.push(values[k]!);
    win.sort((a, b) => a - b);
    out[i] = win[Math.floor(win.length / 2)]!;
  }
  return out;
}

/**
 * The pace-over-time series for the area chart: elapsed seconds against smoothed
 * pace (s/km). Pace per sample is `1000 / v` from the velocity stream `v`; a
 * rolling ~5-sample median tames GPS noise while preserving interval structure
 * (a median keeps the square-wave edges of work/recovery far better than a
 * mean). Samples where the runner was stopped/paused (v ≤ the moving floor) emit
 * a NULL point so the chart breaks the line across the pause instead of drawing
 * a fake slow-pace plateau that would also drag the average/best down.
 */
export function paceSeries(streams: RunStreams, windowSamples = 5): PacePoint[] {
  const { t, v } = streams;
  const n = Math.min(t.length, v.length);
  if (n === 0) return [];
  // Per-sample pace, with gap samples marked null (not floored to a slow pace).
  const raw: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const vel = v[i]!;
    raw[i] = Number.isFinite(vel) && vel > MOVING_FLOOR ? MS_TO_SEC_PER_KM(vel) : null;
  }
  // Smooth only the moving (non-null) samples; nulls stay as line breaks.
  const moving = raw.filter((p): p is number => p != null);
  if (moving.length === 0) return [];
  const smoothedMoving = rollingMedian(moving, windowSamples);
  let k = 0;
  return raw.map((p, i) => ({
    t: t[i]!,
    paceSecPerKm: p == null ? null : smoothedMoving[k++]!,
  }));
}

/**
 * The HR-over-time series for the area chart: elapsed seconds against bpm, with
 * nulls preserved EXACTLY where the source lacked HR so the chart can break the
 * line across gaps rather than drawing a line down to zero.
 */
export function hrSeries(streams: RunStreams): HrPoint[] {
  const { t, hr } = streams;
  const n = Math.min(t.length, hr.length);
  const out: HrPoint[] = [];
  for (let i = 0; i < n; i++) {
    const beat = hr[i];
    out.push({ t: t[i]!, hr: typeof beat === 'number' && Number.isFinite(beat) ? beat : null });
  }
  return out;
}

/** Max HR observed across the stream (bpm), or null when HR is entirely absent. */
export function maxHr(streams: RunStreams): number | null {
  let m = -Infinity;
  for (const beat of streams.hr) {
    if (typeof beat === 'number' && Number.isFinite(beat) && beat > m) m = beat;
  }
  return Number.isFinite(m) ? m : null;
}


/**
 * Derive per-mile splits from the streams when the activity carries no Strava
 * `laps`. Walks the cumulative-distance stream, emitting one split each time a
 * mile boundary is crossed (linearly interpolating the crossing so split paces
 * aren't quantised to sample spacing), and includes the final partial split.
 *
 * Split TIME is MOVING time only: we carry a cumulative moving-time clock that
 * advances by each interval's `dt` ONLY when the runner was moving (v > the
 * floor and the interval isn't an auto-paused jump, dt ≤ 3× median). A red-light
 * stop mid-mile therefore doesn't slow that mile's reported pace. Each split's
 * avg HR is the mean of its in-window HR samples (null when none). Returns []
 * with no usable distance.
 */
export function mileSplits(streams: RunStreams): MileSplit[] {
  const { t, d, v, hr, alt } = streams;
  const n = Math.min(t.length, d.length);
  if (n < 2) return [];
  const totalD = d[n - 1]! - d[0]!;
  if (totalD <= 0) return [];

  // Cumulative MOVING time at each sample: sum of non-gap interval durations.
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(t[i]! - t[i - 1]!);
  const medDt = median(dts.filter((x) => x > 0));
  const gapDt = medDt > 0 ? medDt * 3 : Infinity;
  const movingT: number[] = new Array(n);
  movingT[0] = 0;
  for (let i = 1; i < n; i++) {
    const dt = t[i]! - t[i - 1]!;
    const vel = v[i]!;
    const moving = dt > 0 && dt <= gapDt && Number.isFinite(vel) && vel > MOVING_FLOOR;
    movingT[i] = movingT[i - 1]! + (moving ? dt : 0);
  }

  const splits: MileSplit[] = [];
  let mile = 1;
  let boundaryDist = METERS_PER_MILE;
  let segStartMT = movingT[0]!; // moving-time clock at the split start
  let segStartD = d[0]!;
  let segStartAlt = altitudeAt(alt, 0);
  // HR accumulation for the current split.
  let hrSum = 0;
  let hrCount = 0;

  const pushHrAt = (i: number) => {
    const beat = hr[i];
    if (typeof beat === 'number' && Number.isFinite(beat)) {
      hrSum += beat;
      hrCount += 1;
    }
  };
  pushHrAt(0);

  for (let i = 1; i < n; i++) {
    pushHrAt(i);
    // A single sample interval may span more than one mile boundary; emit each.
    while (d[i]! >= boundaryDist && segStartD < boundaryDist) {
      // Interpolate the boundary crossing within [i-1, i] by distance fraction,
      // and read the MOVING-time clock at that fraction of the interval.
      const d0 = d[i - 1]!;
      const d1 = d[i]!;
      const frac = d1 > d0 ? (boundaryDist - d0) / (d1 - d0) : 1;
      const crossMT = movingT[i - 1]! + (movingT[i]! - movingT[i - 1]!) * frac;
      const crossAlt = interpolatedAltitude(alt, i - 1, i, frac);
      const segTime = crossMT - segStartMT; // moving seconds for this mile
      const segDist = boundaryDist - segStartD; // exactly one mile
      splits.push({
        mile,
        paceSecPerKm: segTime > 0 && segDist > 0 ? MS_TO_SEC_PER_KM(segDist / segTime) : Infinity,
        avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
        distanceMeters: segDist,
        avgGradePct: gradePct(segStartAlt, crossAlt, segDist),
        partial: false,
      });
      mile += 1;
      segStartMT = crossMT;
      segStartD = boundaryDist;
      segStartAlt = crossAlt;
      boundaryDist += METERS_PER_MILE;
      hrSum = 0;
      hrCount = 0;
      // The crossing sample's HR belongs to the NEW split too.
      pushHrAt(i);
    }
  }

  // Final partial split (anything beyond the last whole mile).
  const finalDist = d[n - 1]! - segStartD;
  if (finalDist > METERS_PER_MILE * 0.02) {
    const segTime = movingT[n - 1]! - segStartMT;
    const finalAlt = altitudeAt(alt, n - 1);
    splits.push({
      mile,
      paceSecPerKm: segTime > 0 && finalDist > 0 ? MS_TO_SEC_PER_KM(finalDist / segTime) : Infinity,
      avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
      distanceMeters: finalDist,
      avgGradePct: gradePct(segStartAlt, finalAlt, finalDist),
      partial: true,
    });
  }

  return splits.filter((s) => Number.isFinite(s.paceSecPerKm));
}

function altitudeAt(alt: number[] | null | undefined, i: number): number | null {
  const value = alt?.[i];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function interpolatedAltitude(
  alt: number[] | null | undefined,
  i0: number,
  i1: number,
  frac: number,
): number | null {
  const a0 = altitudeAt(alt, i0);
  const a1 = altitudeAt(alt, i1);
  if (a0 == null || a1 == null) return null;
  return a0 + (a1 - a0) * frac;
}

function gradePct(startAlt: number | null, endAlt: number | null, distanceMeters: number): number | null {
  if (startAlt == null || endAlt == null || distanceMeters <= 0) return null;
  return ((endAlt - startAlt) / distanceMeters) * 100;
}

/**
 * Pace + HR for one specific EARLY MILE of a run (apples-to-apples across
 * long and short runs — whole-run averages conflate distance with effort).
 * Returns null when the run never completes that mile (or pace is degenerate).
 * Mile indices are 1-based; partial trailing splits never qualify.
 */
export interface EarlyMileStats {
  paceSecPerKm: number;
  avgHr: number | null;
}


/**
 * Same lookup against PRE-COMPUTED splits — callers sampling several miles of
 * the same run (the comparable-mile trends) walk the streams once and reuse.
 */
export function earlyMileFromSplits(splits: MileSplit[], mile: number): EarlyMileStats | null {
  const split = splits.find((s) => s.mile === mile && !s.partial);
  if (!split || !Number.isFinite(split.paceSecPerKm) || split.paceSecPerKm <= 0) return null;
  return { paceSecPerKm: split.paceSecPerKm, avgHr: split.avgHr };
}


/**
 * 2–3 "nice" pace gridline values (s/km) spanning a pace range, snapped so they
 * land on whole-minute mile/km marks (e.g. 7:00, 8:00, 9:00). Input range is in
 * s/km; `step` defaults to 60 s/km (~1:00) but widens to 30 s if the range is
 * tight. Returns ascending s/km values strictly inside (min, max).
 */
export function paceGridlines(minSecPerKm: number, maxSecPerKm: number, perMile = true): number[] {
  if (!Number.isFinite(minSecPerKm) || !Number.isFinite(maxSecPerKm) || maxSecPerKm <= minSecPerKm) {
    return [];
  }
  // Work in the display unit (s/mi or s/km) so ticks land on whole minutes.
  const toDisplay = (sk: number) => (perMile ? sk * (METERS_PER_MILE / 1000) : sk);
  const fromDisplay = (dv: number) => (perMile ? dv / (METERS_PER_MILE / 1000) : dv);
  const lo = toDisplay(minSecPerKm);
  const hi = toDisplay(maxSecPerKm);
  const span = hi - lo;
  const step = span > 180 ? 60 : 30; // 1:00 marks, or 0:30 when the range is tight.
  const first = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = first; v < hi; v += step) out.push(fromDisplay(v));
  // Keep it sparse: at most 3 gridlines.
  while (out.length > 3) out.splice(1, 1);
  return out;
}
