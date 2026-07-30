/**
 * Stream-derived in-run best efforts for prediction v3 phase 2.
 *
 * Given one activity's compact streams, extract the fastest sustained 1mi, 5k,
 * 10k, and 30-minute efforts. These are not treated as races; the personal
 * curve consumes them as lower-weight, HR-quality-tagged points.
 */

import {
  METERS_PER_MILE,
} from '../units';
import type { RunStreams } from '../run/analysis';

const MOVING_FLOOR = 0.5;
const DISTANCE_TARGETS = [
  { label: '1mi', meters: METERS_PER_MILE },
  { label: '5k', meters: 5000 },
  { label: '10k', meters: 10000 },
] as const;
const DURATION_TARGETS = [{ label: '30min', seconds: 30 * 60 }] as const;

export type StreamEffortLabel = '1mi' | '5k' | '10k' | '30min';

export interface StreamEffort {
  label: StreamEffortLabel;
  /** Distance covered by the extracted effort, metres. */
  distanceMeters: number;
  /** Moving seconds for the extracted effort. */
  seconds: number;
  /** Average HR over the effort, time-weighted, or null when unavailable. */
  avgHr: number | null;
  /** Average HR divided by the best max-HR proxy, or null when unavailable. */
  hrFraction: number | null;
  /**
   * Lower-weight curve-fit multiplier [0.05, 0.5]. Easy/unknown-HR efforts stay
   * small; near-max HR efforts can materially densify the curve.
   */
  qualityWeight: number;
}

export interface StreamEffortActivity {
  localDate?: string | null;
  distanceMeters?: number | null;
  movingTimeS?: number | null;
  workoutType?: number | null;
  streams?: RunStreams | null;
  maxHr?: number | null;
  /** DB row spelling for max HR; used when `maxHr` is absent. */
  max_hr?: number | null;
}

interface Segment {
  dt: number;
  dd: number;
  hrTime: number;
}

interface Prepared {
  prefT: number[];
  prefD: number[];
  prefHrTime: number[];
  maxHr: number | null;
  totalMovingS: number;
  totalMovingD: number;
}

/**
 * Per-activity memo of the (asOf-independent) sliding-window extraction.
 *
 * The Trends trendline predicts at ~100 weekly as-of points over the SAME
 * activity set; the only thing that changes per point is the date filter in
 * `extractStreamEffortsFromActivities`. The O(n·m) prefix-sum + sliding-window
 * extraction itself depends only on an activity's streams + max HR, so we
 * compute it once per activity object and reuse it across every point. Keyed by
 * object identity (WeakMap) so callers MUST pass the same activity instances
 * across calls — which `predictionSeries` does (it shapes the array once).
 */
const effortMemo = new WeakMap<StreamEffortActivity, StreamEffort[]>();

/**
 * Extract prediction-grade efforts from one stream-bearing activity, memoized on
 * the activity object (the extraction is asOf-independent). `maxHr` falls back to
 * the DB `max_hr` spelling when absent.
 */
export function extractStreamEfforts(activity: StreamEffortActivity): StreamEffort[] {
  const hit = effortMemo.get(activity);
  if (hit !== undefined) return hit;
  const out = computeStreamEfforts(activity);
  effortMemo.set(activity, out);
  return out;
}

function computeStreamEfforts(activity: StreamEffortActivity): StreamEffort[] {
  const maxHr = activity.maxHr ?? activity.max_hr ?? null;
  const prepared = prepare(activity.streams, maxHr);
  if (prepared == null) return [];

  const out: StreamEffort[] = [];
  for (const target of DISTANCE_TARGETS) {
    if (prepared.totalMovingD + 1e-6 < target.meters) continue;
    const effort = fastestDistance(prepared, target.meters);
    if (effort) out.push({ label: target.label, ...effort });
  }
  for (const target of DURATION_TARGETS) {
    if (prepared.totalMovingS + 1e-6 < target.seconds) continue;
    const effort = fastestDuration(prepared, target.seconds);
    if (effort) out.push({ label: target.label, ...effort });
  }
  return out;
}

/** Extract efforts across activities, preserving activity dates for callers. */
export function extractStreamEffortsFromActivities<T extends StreamEffortActivity>(
  activities: T[],
  asOfDate: string,
): (StreamEffort & { localDate: string })[] {
  const out: (StreamEffort & { localDate: string })[] = [];
  for (const a of activities) {
    if (!a.localDate || a.localDate > asOfDate) continue;
    if (a.workoutType === 1) continue; // tagged races already enter as race points
    for (const e of extractStreamEfforts(a)) out.push({ ...e, localDate: a.localDate });
  }
  return out;
}

function prepare(streams: RunStreams | null | undefined, activityMaxHr?: number | null): Prepared | null {
  if (!streams || streams.t.length < 2 || streams.d.length < 2 || streams.v.length < 2) {
    return null;
  }
  const n = Math.min(streams.t.length, streams.d.length, streams.v.length, streams.hr.length);
  if (n < 2) return null;

  const dts: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = streams.t[i]! - streams.t[i - 1]!;
    if (dt > 0 && streams.v[i]! > MOVING_FLOOR) dts.push(dt);
  }
  const medDt = median(dts);
  const gapDt = medDt > 0 ? medDt * 3 : Infinity;

  const segs: Segment[] = [];
  let maxObservedHr = activityMaxHr && activityMaxHr > 0 ? activityMaxHr : null;
  for (let i = 1; i < n; i++) {
    const dt = streams.t[i]! - streams.t[i - 1]!;
    const rawDd = streams.d[i]! - streams.d[i - 1]!;
    const moving = dt > 0 && dt <= gapDt && streams.v[i]! > MOVING_FLOOR && rawDd > 0;
    const hr = streams.hr[i];
    if (hr != null && hr > 0) maxObservedHr = Math.max(maxObservedHr ?? 0, hr);
    segs.push({
      dt: moving ? dt : 0,
      dd: moving ? rawDd : 0,
      hrTime: moving && hr != null && hr > 0 ? hr * dt : 0,
    });
  }

  const prefT = [0];
  const prefD = [0];
  const prefHrTime = [0];
  for (const s of segs) {
    prefT.push(prefT[prefT.length - 1]! + s.dt);
    prefD.push(prefD[prefD.length - 1]! + s.dd);
    prefHrTime.push(prefHrTime[prefHrTime.length - 1]! + s.hrTime);
  }
  const totalMovingS = prefT[prefT.length - 1]!;
  const totalMovingD = prefD[prefD.length - 1]!;
  if (totalMovingS <= 0 || totalMovingD <= 0) return null;
  return { prefT, prefD, prefHrTime, maxHr: maxObservedHr, totalMovingS, totalMovingD };
}

function fastestDistance(prepared: Prepared, meters: number): Omit<StreamEffort, 'label'> | null {
  const { prefD } = prepared;
  let best: Omit<StreamEffort, 'label'> | null = null;
  let j = 1;
  for (let i = 0; i < prefD.length - 1; i++) {
    if (j <= i) j = i + 1;
    while (j < prefD.length && prefD[j]! - prefD[i]! < meters) j++;
    if (j >= prefD.length) break;
    const candidate = windowAtDistance(prepared, i, j, meters);
    if (candidate && (!best || candidate.seconds < best.seconds)) best = candidate;
  }
  return best;
}

function fastestDuration(prepared: Prepared, seconds: number): Omit<StreamEffort, 'label'> | null {
  const { prefT } = prepared;
  let best: Omit<StreamEffort, 'label'> | null = null;
  let j = 1;
  for (let i = 0; i < prefT.length - 1; i++) {
    if (j <= i) j = i + 1;
    while (j < prefT.length && prefT[j]! - prefT[i]! < seconds) j++;
    if (j >= prefT.length) break;
    const candidate = windowAtDuration(prepared, i, j, seconds);
    if (candidate && (!best || candidate.distanceMeters > best.distanceMeters)) best = candidate;
  }
  return best;
}

function windowAtDistance(
  prepared: Prepared,
  start: number,
  end: number,
  meters: number,
): Omit<StreamEffort, 'label'> | null {
  const prevD = prepared.prefD[end - 1]! - prepared.prefD[start]!;
  const segD = prepared.prefD[end]! - prepared.prefD[end - 1]!;
  if (segD <= 0) return null;
  const frac = Math.min(1, Math.max(0, (meters - prevD) / segD));
  const seconds =
    prepared.prefT[end - 1]! - prepared.prefT[start]! +
    frac * (prepared.prefT[end]! - prepared.prefT[end - 1]!);
  const hrTime =
    prepared.prefHrTime[end - 1]! - prepared.prefHrTime[start]! +
    frac * (prepared.prefHrTime[end]! - prepared.prefHrTime[end - 1]!);
  return finishEffort(prepared, meters, seconds, hrTime);
}

function windowAtDuration(
  prepared: Prepared,
  start: number,
  end: number,
  seconds: number,
): Omit<StreamEffort, 'label'> | null {
  const prevT = prepared.prefT[end - 1]! - prepared.prefT[start]!;
  const segT = prepared.prefT[end]! - prepared.prefT[end - 1]!;
  if (segT <= 0) return null;
  const frac = Math.min(1, Math.max(0, (seconds - prevT) / segT));
  const meters =
    prepared.prefD[end - 1]! - prepared.prefD[start]! +
    frac * (prepared.prefD[end]! - prepared.prefD[end - 1]!);
  const hrTime =
    prepared.prefHrTime[end - 1]! - prepared.prefHrTime[start]! +
    frac * (prepared.prefHrTime[end]! - prepared.prefHrTime[end - 1]!);
  return finishEffort(prepared, meters, seconds, hrTime);
}

function finishEffort(
  prepared: Prepared,
  distanceMeters: number,
  seconds: number,
  hrTime: number,
): Omit<StreamEffort, 'label'> | null {
  if (!(seconds > 0) || !(distanceMeters > 0)) return null;
  const avgHr = hrTime > 0 ? hrTime / seconds : null;
  const hrFraction = avgHr != null && prepared.maxHr != null && prepared.maxHr > 0
    ? Math.min(1, avgHr / prepared.maxHr)
    : null;
  return {
    distanceMeters,
    seconds,
    avgHr,
    hrFraction,
    qualityWeight: effortQualityWeight(hrFraction),
  };
}

export function effortQualityWeight(hrFraction: number | null): number {
  if (hrFraction == null) return 0.08;
  if (hrFraction < 0.75) return 0.05;
  if (hrFraction >= 0.92) return 0.5;
  return 0.05 + ((hrFraction - 0.75) / (0.92 - 0.75)) * 0.3;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
