/**
 * Pure helpers for the per-activity STREAMS data layer: downsampling raw Strava
 * stream payloads into our compact columnar shape, and decoding + simplifying
 * Strava's encoded route polyline.
 *
 * Everything here is PURE (no IO, no globals) so it runs under the `node` jest
 * project. The IO wiring (fetch + persist) lives in `strava.ts` / `ingest.ts`.
 */

import { activityPaceCurve, activityPaceDurationCurve } from '../lib/run/paceCurve';
import { earlyMiles } from '../lib/kpi/insights/comparableMile';
import type { RunStreams, StravaLap } from '../lib/run/analysis';
import type { StreamSummary } from '../lib/run/streamSummary';
import { STREAM_SUMMARY_VERSION } from '../lib/kpi/ingestVerdict';
import { actualBarSegments } from '../lib/kpi/actualBar';
import type { HardBlock, RunStream } from '../lib/kpi/qualityDetect';
import { deriveQualityFloor, type QualityFloor } from '../lib/kpi/qualityFloor';
import { buildGap } from '../lib/kpi/gap';
import { interpretWorkout, type QualityFloorRefs, type PlanQuality } from '../lib/kpi/interpretWorkout';
import { METERS_PER_MILE } from '../lib/units';

// The verdict version stamp lives with the verdict tree (shared with client
// code, e.g. SessionView's stored-verdict gate); re-exported here for existing
// server imports.
export { STREAM_SUMMARY_VERSION };

// StreamSummary type lives in lib (shared with client); re-exported from here
// for backward-compat so existing server imports don't break.
export type { StreamSummary };

/** Inputs required to compute the quality verdict alongside a stream summary. */
export interface QualityFloorInputs { floor: QualityFloor; easyBaselineSecPerMi: number }

/** The full Strava stream, no sampling cap (detail-view fidelity). */
export function fullResStreams(raw: RawStreams | null | undefined): ActivityStreams | null {
  const time = raw?.time?.data;
  if (!raw || !Array.isArray(time) || time.length === 0) return null;
  return downsampleStreams(raw, time.length); // cap = full length -> keeps every sample
}

/** Small per-activity summary: pace-distance curve + early-mile samples + quality verdict. */
export function computeStreamSummary(
  raw: RawStreams | null | undefined,
  qf: QualityFloorInputs,
  laps?: StravaLap[] | null,
  plan?: PlanQuality | null,
): StreamSummary | null {
  const full = fullResStreams(raw);
  if (!full) return null;
  const streams: RunStreams = { t: full.t, d: full.d, v: full.v, hr: full.hr, alt: full.alt };

  // Plan-conditioned change-point interpreter: segments the run's STREAM
  // (moving-time-corrected ~100 m distance bins) into workout blocks via a
  // composite z(GAP-speed)+z(HR) signal (GAP from the altitude stream, HR from
  // the per-bin average). Laps + watch-pauses are boundary SIGNALS only, so a
  // run with <2 laps is still segmented. Classifies the kind and returns a
  // coarse→fine candidate ladder. No plan is threaded through yet, so `matched`
  // is always null this task; the flat credit fields below resolve to
  // `matched ?? honest` = honest.
  const refs: QualityFloorRefs = {
    easyPaceSecPerMi: qf.easyBaselineSecPerMi,
    paceFloorSecPerMi: qf.floor.paceFloorSecPerMi,
    // hrFloor 999 (effectively unreachable) turns OFF the HR gate when the
    // runner has no derived HR floor, mirroring the old detector's
    // HR-optional fallback to pace/GAP alone.
    hrFloor: qf.floor.hrFloor ?? 999,
    qualityFloorSecPerMi:
      qf.floor.qualityFloorSecPerMi ??
      deriveQualityFloor(qf.easyBaselineSecPerMi),
  };
  const gap = buildGap({ d: full.d, alt: full.alt ?? [] });
  const runStream: RunStream = {
    d: full.d,
    v: full.v,
    t: full.t,
    // avgHrOver tolerates the nulls at runtime (it filters h == null / h <= 0);
    // the stored HR column carries nulls where the source lacked HR.
    hr: full.hr as unknown as number[],
    altitude: full.alt ?? undefined,
  };
  const result = interpretWorkout(runStream, laps ?? [], gap, refs, plan ?? null);
  // Credit resolves to matched ?? honest: a planned quality day credits the
  // PRESCRIBED read (when the data supports it); an unplanned run credits the
  // broad-net honest read. Both retained nested for the run-detail overlay + the
  // (future) user override, which wins over both.
  const resolved = result.matched ?? result.honest;
  // Blocks are now native stream-index — map straight to HardBlock (no lap→stream
  // re-projection). METERS_PER_MILE (1609.344) is the single source of truth,
  // dropping the old 1609.34-vs-1609.344 drift.
  const toHardBlock = (b: (typeof resolved.blocks)[number]): HardBlock => ({
    distanceMeters: b.mi * METERS_PER_MILE,
    paceSecPerMi: b.gapPaceSecPerMi,
    durationS: b.mi * b.gapPaceSecPerMi,
    startIdx: b.startIdx,
    endIdx: b.endIdx,
  });
  const blocks: HardBlock[] = resolved.blocks.map(toHardBlock);
  const extraBlocks: HardBlock[] = resolved.extras?.map(toHardBlock) ?? [];
  const qualityTimeMin = resolved.blocks.reduce((s, b) => s + (b.mi * b.gapPaceSecPerMi) / 60, 0);

  // The ACTUAL-shape bar for the Dash today card's completed state: the run's
  // real structure positioned by distance from THIS stream (blocks carry only
  // sample indices, and lean Dash rows have no streams — so it can't be
  // positioned client-side). An interval run → work reps on an easy base; an
  // easy run (kind 'none') → one flat steady bar.
  const totalMeters = full.d.length > 0 ? full.d[full.d.length - 1]! - full.d[0]! : 0;
  const actualBar = actualBarSegments(blocks, full.d, totalMeters, resolved.kind);
  return {
    pace_curve: activityPaceCurve(streams),
    pace_duration_curve: activityPaceDurationCurve(streams),
    early_miles: earlyMiles(streams),
    quality: {
      // Resolved credit fields = matched ?? honest — the flat QualityDetect shape
      // existing readers use.
      kind: resolved.kind,
      isQuality: resolved.kind !== 'none',
      qualityDistanceMeters: resolved.qualityMi * METERS_PER_MILE,
      summary: resolved.summary,
      blocks,
      ...(extraBlocks.length ? { extraBlocks } : {}),
      qualityTimeMin,
      actualBar,
      floor: { ...qf.floor, easyBaselineSecPerMi: qf.easyBaselineSecPerMi },
      ...(resolved.source ? { source: resolved.source } : {}),
      // Nested plan-conditioned interpreter output (Task C1 §Storage).
      honest: result.honest,
      matched: result.matched,
      candidates: result.candidates,
      defaultIdx: result.defaultIdx,
      // v = STREAM_SUMMARY_VERSION: the whole summary (curves + early_miles +
      // quality + actualBar) is recomputed together, versioned by this one stamp.
      v: STREAM_SUMMARY_VERSION,
    },
  };
}

/**
 * Recompute the summary from ALREADY-STORED columnar streams — NO Strava fetch.
 * The re-enrich backfill uses this to bring rows to the current summary version
 * without re-hitting the Strava streams API (which rate-limits and, on failure,
 * stranded rows). Wraps the stored columns back into the raw shape
 * `computeStreamSummary` expects (its internal `fullResStreams` is an identity
 * for already-full-res columns). Returns null when the stored streams are empty.
 */
export function computeStreamSummaryFromStored(
  stored: ActivityStreams | null | undefined,
  qf: QualityFloorInputs,
  laps?: Parameters<typeof computeStreamSummary>[2],
  plan?: PlanQuality | null,
): ReturnType<typeof computeStreamSummary> {
  if (!stored || !Array.isArray(stored.t) || stored.t.length === 0) return null;
  const raw: RawStreams = {
    time: { data: stored.t },
    distance: { data: stored.d },
    velocity_smooth: { data: stored.v },
    ...(stored.hr ? { heartrate: { data: stored.hr as number[] } } : {}),
    ...(stored.alt ? { altitude: { data: stored.alt } } : {}),
  };
  return computeStreamSummary(raw, qf, laps, plan);
}

/**
 * Our compact, columnar, downsampled activity streams. All numeric arrays share
 * the same length and index alignment as `t`. `hr` carries nulls where the
 * heartrate stream was absent; `alt` is null entirely when altitude was absent.
 */
export interface ActivityStreams {
  /** Seconds from activity start. */
  t: number[];
  /** Cumulative distance, meters. */
  d: number[];
  /** Velocity, meters/second. */
  v: number[];
  /** Heart rate, bpm — null entries where the source lacked HR at that sample. */
  hr: (number | null)[];
  /** Altitude, meters — null entirely when the source lacked an altitude stream. */
  alt: number[] | null;
}

/** A single Strava stream channel (key_by_type=true shape). */
interface RawStream {
  data?: unknown[];
}

/**
 * Raw Strava streams payload (key_by_type=true). Each key is optional — many
 * activities lack heartrate and/or altitude. We read `data` arrays only.
 */
export interface RawStreams {
  time?: RawStream;
  distance?: RawStream;
  velocity_smooth?: RawStream;
  heartrate?: RawStream;
  altitude?: RawStream;
  /** Full-resolution GPS path: `data` is `[[lat, lng], ...]` at every sample. */
  latlng?: RawStream;
  [key: string]: RawStream | undefined;
}

/** Coerce a value to a finite number, or null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Coerce to a finite number, preserving null/absent as null (for HR). */
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Pick the sample indices to keep when downsampling `length` samples to at most
 * `maxSamples`. Uniform stride sampling that ALWAYS includes the first and last
 * index. Returns ascending, de-duplicated indices.
 */
export function sampleIndices(length: number, maxSamples: number): number[] {
  if (length <= 0) return [];
  if (length <= maxSamples) return Array.from({ length }, (_, i) => i);
  // We want `maxSamples` points spanning [0, length-1] inclusive of both ends.
  const last = length - 1;
  const out: number[] = [];
  for (let i = 0; i < maxSamples; i++) {
    // Even spacing across the full range, endpoints pinned.
    const idx = Math.round((i * last) / (maxSamples - 1));
    if (out.length === 0 || idx !== out[out.length - 1]) out.push(idx);
  }
  // Guarantee first + last are present (rounding can only ever land on them, but
  // be explicit).
  if (out[0] !== 0) out.unshift(0);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Downsample a raw Strava streams payload into our compact columnar shape,
 * keeping at most `maxSamples` aligned samples (first + last always retained).
 *
 * - Uniform index sampling preserves cross-key alignment.
 * - Missing heartrate stream -> `hr` filled with nulls (length matches).
 * - Missing altitude stream -> `alt` is null.
 *
 * The default cap is 500: ≈14 s spacing on a 2 h run, fine enough that the pace
 * curve's 60 s floor resolves a genuine sustained window rather than a single
 * coarse sample. The columnar payload stays small — ≤500×4 finite numbers plus
 * an HR column is a few KB of jsonb.
 *
 * Returns null when there is no usable time stream (nothing to chart).
 */
export function downsampleStreams(
  raw: RawStreams | null | undefined,
  maxSamples = 500,
): ActivityStreams | null {
  if (!raw) return null;
  const time = raw.time?.data;
  if (!Array.isArray(time) || time.length === 0) return null;

  const distance = raw.distance?.data;
  const velocity = raw.velocity_smooth?.data;
  const heartrate = raw.heartrate?.data;
  const altitude = raw.altitude?.data;

  const hasHr = Array.isArray(heartrate);
  const hasAlt = Array.isArray(altitude);

  const idxs = sampleIndices(time.length, maxSamples);

  const t: number[] = [];
  const d: number[] = [];
  const v: number[] = [];
  const hr: (number | null)[] = [];
  const alt: number[] = [];

  for (const i of idxs) {
    t.push(num(time[i]) ?? 0);
    d.push(num(Array.isArray(distance) ? distance[i] : 0) ?? 0);
    v.push(num(Array.isArray(velocity) ? velocity[i] : 0) ?? 0);
    hr.push(hasHr ? numOrNull(heartrate![i]) : null);
    if (hasAlt) alt.push(num(altitude![i]) ?? 0);
  }

  return { t, d, v, hr, alt: hasAlt ? alt : null };
}

/**
 * Decode a Google/Strava encoded polyline string into `[[lat, lng], ...]`.
 * Precision 1e-5 (Google's standard). Well-known algorithm. PURE.
 *
 * Reference example (from Google's docs):
 *   `_p~iF~ps|U_ulLnnqC_mqNvxq`@`
 *   -> [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
 */
export function decodePolyline(encoded: string | null | undefined): [number, number][] {
  if (!encoded) return [];
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Downsample a route point list to at most `max` points, always retaining the
 * first and last point (so a loop still visually closes). Uniform stride. PURE.
 */
export function downsampleRoute(
  points: [number, number][] | null | undefined,
  max = 120,
): [number, number][] {
  if (!points || points.length === 0) return [];
  if (points.length <= max) return points.slice();
  const idxs = sampleIndices(points.length, max);
  return idxs.map((i) => points[i]!);
}

/**
 * Convenience: decode an encoded polyline and downsample it to <=max points.
 * Returns null when there's nothing to decode (so callers can leave `route` null).
 */
export function routeFromPolyline(
  encoded: string | null | undefined,
  max = 120,
): [number, number][] | null {
  const decoded = decodePolyline(encoded);
  if (decoded.length === 0) return null;
  return downsampleRoute(decoded, max);
}

/**
 * Build a display route from the full-resolution Strava `latlng` STREAM (the
 * real recorded GPS path — NOT the Douglas-Peucker–simplified `summary_polyline`
 * Strava ships for thumbnails). Downsampled to <=max points. Because this is the
 * actual path (uniformly sampled), multi-lap track runs keep their lap shape
 * instead of collapsing into a blocky, spiky polygon. Returns null when the
 * stream is absent or empty so callers can fall back to the polyline. PURE.
 *
 * The default cap is 600: ≈18 points per lap on a 32-lap track, smooth enough to
 * read, while staying a few KB of jsonb in the `route` column.
 */
export function routeFromLatLng(
  raw: RawStreams | null | undefined,
  max = 600,
): [number, number][] | null {
  const data = raw?.latlng?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const points: [number, number][] = [];
  for (const p of data) {
    if (
      Array.isArray(p) && p.length === 2 &&
      typeof p[0] === 'number' && typeof p[1] === 'number' &&
      Number.isFinite(p[0]) && Number.isFinite(p[1])
    ) {
      points.push([p[0], p[1]]);
    }
  }
  if (points.length === 0) return null;
  return downsampleRoute(points, max);
}
