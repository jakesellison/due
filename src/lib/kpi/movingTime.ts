/**
 * movingTime.ts — stop-aware moving time & pace from an activity stream.
 *
 * No IO. Node-tested. The stream's `t` is ELAPSED seconds (includes stops);
 * `d` is cumulative meters. A stop is any interval whose implied speed
 * (Δd/Δt) is at/below `stopSpeedMps`; consecutive stopped intervals coalesce
 * into a span, kept only when it lasts ≥ `minStopS`. This single rule catches
 * both explicit watch-pause gaps (large Δt, flat Δd) and forgot-to-pause
 * stationary spans (normal Δt, v≈0, flat Δd).
 */

import {
  METERS_PER_MILE,
} from '../units';

export interface StopInterval {
  /** Elapsed seconds at the start of the stopped span. */
  startS: number;
  /** Elapsed seconds at the end of the stopped span. */
  endS: number;
  /** endS − startS. */
  durationS: number;
}

export interface MovingStats {
  /** Total clock time: t[last] − t[0]. */
  elapsedTimeS: number;
  /** Elapsed minus all qualifying stop spans. */
  movingTimeS: number;
  /** distance ÷ movingTimeS as sec/mi (null when movingTimeS ≤ 0 or no distance). */
  movingPaceSecPerMi: number | null;
  /** distance ÷ elapsedTimeS as sec/mi (null when elapsedTimeS ≤ 0 or no distance). */
  elapsedPaceSecPerMi: number | null;
  /** Maximal stopped spans (≥ minStopS), for display + downstream segmenter exclusion. */
  stopIntervals: StopInterval[];
}

export function normalizeMovingTime(
  stream: { t: number[]; d: number[]; v?: number[] },
  opts?: { stopSpeedMps?: number; minStopS?: number },
): MovingStats {
  const stopSpeed = opts?.stopSpeedMps ?? 0.5;
  const minStop = opts?.minStopS ?? 10;
  const t = stream.t ?? [];
  const d = stream.d ?? [];
  const n = Math.min(t.length, d.length);

  if (n < 2) {
    return {
      elapsedTimeS: 0,
      movingTimeS: 0,
      movingPaceSecPerMi: null,
      elapsedPaceSecPerMi: null,
      stopIntervals: [],
    };
  }

  const elapsedTimeS = Math.max(0, t[n - 1]! - t[0]!);
  const totalDistance = Math.max(0, d[n - 1]! - d[0]!);

  // Mark each interval (i-1 → i) stopped by implied speed.
  const stopped: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const dt = t[i]! - t[i - 1]!;
    const dd = d[i]! - d[i - 1]!;
    const implied = dt > 0 ? dd / dt : 0;
    stopped[i] = implied <= stopSpeed;
  }

  // Coalesce consecutive stopped intervals into spans; keep when ≥ minStop.
  const stopIntervals: StopInterval[] = [];
  let i = 1;
  while (i < n) {
    if (!stopped[i]) {
      i++;
      continue;
    }
    const spanStart = t[i - 1]!;
    let j = i;
    while (j < n && stopped[j]) j++;
    const spanEnd = t[j - 1]!;
    const durationS = spanEnd - spanStart;
    if (durationS >= minStop) stopIntervals.push({ startS: spanStart, endS: spanEnd, durationS });
    i = j;
  }

  const stoppedTotal = stopIntervals.reduce((s, x) => s + x.durationS, 0);
  const movingTimeS = Math.max(0, elapsedTimeS - stoppedTotal);

  const miles = totalDistance / METERS_PER_MILE;
  const movingPaceSecPerMi = movingTimeS > 0 && miles > 0 ? movingTimeS / miles : null;
  const elapsedPaceSecPerMi = elapsedTimeS > 0 && miles > 0 ? elapsedTimeS / miles : null;

  return { elapsedTimeS, movingTimeS, movingPaceSecPerMi, elapsedPaceSecPerMi, stopIntervals };
}
