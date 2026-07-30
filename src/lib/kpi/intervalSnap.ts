// src/lib/kpi/intervalSnap.ts
/**
 * intervalSnap.ts — Snap raw hard-blocks to the intended interval structure.
 *
 * No IO. Node-tested. Sits on top of detectQuality's blocks.
 * Spec: docs/superpowers/specs/2026-06-21-interval-snapping-and-credit-design.md
 */

import {
  METERS_PER_MILE,
} from '../units';

export interface Canonical {
  meters: number;
  label: string;
}

/** Track distances are metric everywhere; road distances use the runner's unit. */
export function canonicalGrid(unit: 'mi' | 'km'): Canonical[] {
  const track: Canonical[] = [
    { meters: 200, label: '200 m' }, { meters: 300, label: '300 m' },
    { meters: 400, label: '400 m' }, { meters: 600, label: '600 m' },
    { meters: 800, label: '800 m' }, { meters: 1000, label: '1000 m' },
    { meters: 1200, label: '1200 m' },
  ];
  const road: Canonical[] =
    unit === 'mi'
      ? [
          { meters: METERS_PER_MILE, label: '1 mi' }, { meters: 2414, label: '1.5 mi' },
          { meters: 3218.7, label: '2 mi' }, { meters: 4828, label: '3 mi' },
          { meters: 5000, label: '5K' }, { meters: 8047, label: '5 mi' },
          { meters: 10000, label: '10K' },
        ]
      : [
          { meters: 1000, label: '1 km' }, { meters: 2000, label: '2 km' },
          { meters: 3000, label: '3 km' }, { meters: 5000, label: '5K' },
          { meters: 8000, label: '8 km' }, { meters: 10000, label: '10K' },
        ];
  return [...track, ...road].sort((a, b) => a.meters - b.meters);
}

/** Nearest canonical by relative error, within `tol` (default 12%); else null. */
export function nearestCanonical(meters: number, grid: Canonical[], tol = 0.12): Canonical | null {
  let best: Canonical | null = null;
  let bestErr = Infinity;
  for (const c of grid) {
    const err = Math.abs(meters - c.meters) / c.meters;
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return best && bestErr <= tol ? best : null;
}

import type { RunStream, HardBlock } from './qualityDetect';

const V_MIN = 0.3;

export interface Effort {
  startIdx: number;
  endIdx: number;
  distMeters: number;
}

/** Smoothed pace at sample i (centered window), or null when stopped. */
function paceAt(stream: RunStream, i: number, win = 2): number | null {
  const { v } = stream;
  let sum = 0, cnt = 0;
  for (let k = -win; k <= win; k++) {
    const vi = v[i + k];
    if (vi != null && vi > V_MIN) { sum += METERS_PER_MILE / vi; cnt++; }
  }
  return cnt > 0 ? sum / cnt : null;
}

/** Distance between inclusive indices a..b using cumulative d (onset = d[a-1]). */
export function spanMeters(stream: RunStream, a: number, b: number): number {
  const start = a > 0 ? stream.d[a - 1]! : 0;
  return stream.d[b]! - start;
}

/** Walk outward from a hard core while smoothed pace stays at/under the still-working threshold. */
export function extendBlock(stream: RunStream, block: HardBlock, easyThresholdSecPerMi: number): Effort {
  const n = stream.d.length;
  let a = block.startIdx;
  let b = block.endIdx;
  while (a > 0) {
    const p = paceAt(stream, a - 1);
    if (p == null || p > easyThresholdSecPerMi) break;
    a--;
  }
  while (b < n - 1) {
    const p = paceAt(stream, b + 1);
    if (p == null || p > easyThresholdSecPerMi) break;
    b++;
  }
  return { startIdx: a, endIdx: b, distMeters: spanMeters(stream, a, b) };
}

export interface Credit {
  creditedMeters: number;
  achievedPaceSecPerMi: number;
  avgHr: number | null;
  faded: boolean;
}

const FADE_PACE_FLOOR = 600; // 10:00/mi — fill slower than this (and ≫ hard pace) = a fade

/** Moving seconds between inclusive indices a..b (stopped samples excluded). */
export function movingSeconds(stream: RunStream, a: number, b: number): number {
  const { v, t } = stream;
  let sec = 0;
  for (let i = a; i <= b; i++) {
    if (v[i]! > V_MIN) sec += t[i]! - (i > 0 ? t[i - 1]! : 0);
  }
  return sec;
}

export function avgHrOver(stream: RunStream, a: number, b: number): number | null {
  const hr = stream.hr;
  if (!hr) return null;
  let sum = 0, cnt = 0;
  for (let i = a; i <= b; i++) { const h = hr[i]; if (h != null && h > 0) { sum += h; cnt++; } }
  return cnt > 0 ? Math.round(sum / cnt) : null;
}

/**
 * Credit the intended `targetMeters` from the effort onset, walking forward no
 * further than `limitIdx`. Pace is over the credited distance on moving time;
 * `faded` flags a slow fill (blow-up) or a target not reached before the limit.
 */
export function creditRep(
  stream: RunStream,
  effort: Effort,
  targetMeters: number,
  limitIdx: number,
  hardPaceSecPerMi: number,
): Credit {
  const onsetD = effort.startIdx > 0 ? stream.d[effort.startIdx - 1]! : 0;
  // Walk forward until cumulative distance reaches the target, or we hit the limit.
  let endIdx = effort.endIdx;
  while (endIdx < limitIdx && stream.d[endIdx]! - onsetD < targetMeters) endIdx++;
  const coveredMeters = stream.d[endIdx]! - onsetD; // ground actually traversed in the window
  const reached = coveredMeters >= targetMeters - 1;
  const creditedMeters = reached ? targetMeters : coveredMeters;

  const sec = movingSeconds(stream, effort.startIdx, endIdx);
  // Pace is over the ground ACTUALLY covered, never the nominal target. An effort
  // that overshoots its target — a 264 m GPS trace credited to a 200 m rep — would
  // otherwise divide the real 264 m moving time by 200 m and report a pace ~30 %
  // too slow (the "8:27 for a 5:26 rep" artefact). `creditedMeters` still carries
  // the canonical target for the label + fade check below.
  const achievedPaceSecPerMi = coveredMeters > 0 ? sec / (coveredMeters / METERS_PER_MILE) : 0;

  // Fill = the stretch between the effort boundary and the credited end.
  const fillMeters = Math.max(0, creditedMeters - effort.distMeters);
  let faded = !reached;
  if (fillMeters > 0.04 * METERS_PER_MILE) {
    const fillSec = movingSeconds(stream, effort.endIdx, endIdx);
    const fillPace = fillSec / (fillMeters / METERS_PER_MILE);
    if (fillPace > FADE_PACE_FLOOR && fillPace > hardPaceSecPerMi * 1.5) faded = true;
  }

  return { creditedMeters, achievedPaceSecPerMi, avgHr: avgHrOver(stream, effort.startIdx, endIdx), faded };
}

import type { Segment } from '../workout/types';
import {
  extractPlannedIntervals,
  type PlannedIntervalContext,
} from './qualityDetect';

const UNIFORM_RATIO = 1.25;       // max/min rep distance ≤ this → same distance
const DEFAULT_EASY_THRESHOLD = 480; // 8:00/mi still-working boundary

export interface SnappedRep {
  targetDistMeters: number;
  measuredDistMeters: number;
  achievedPaceSecPerMi: number;
  avgHr: number | null;
  faded: boolean;
  /** Inclusive sample indices of this rep's effort window in the source stream. */
  startIdx: number;
  endIdx: number;
}
export interface IntervalSnap {
  reps: SnappedRep[];
  label: string;
  uniform: boolean;
  snapped: boolean;
  source: 'prescription' | 'inference';
}
export interface SnapOpts {
  unit?: 'mi' | 'km';
  prescribed?: Segment[] | null;
  prescribedContext?: PlannedIntervalContext;
  easyThresholdSecPerMi?: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function fmtMeasured(meters: number): string {
  return meters >= 1500 ? `${(meters / METERS_PER_MILE).toFixed(2)} mi` : `${Math.round(meters)} m`;
}

export function snapIntervals(stream: RunStream, blocks: HardBlock[], opts: SnapOpts = {}): IntervalSnap {
  const unit = opts.unit ?? 'mi';
  const easy = opts.easyThresholdSecPerMi ?? DEFAULT_EASY_THRESHOLD;

  // 1. Extend every block to its effort boundary.
  const efforts = blocks.map((b) => extendBlock(stream, b, easy));
  const dists = efforts.map((e) => e.distMeters);
  const uniform = dists.length >= 2 && Math.max(...dists) / Math.min(...dists) <= UNIFORM_RATIO;

  // 2. Choose the target distance per rep (prescription → inference).
  const grid = canonicalGrid(unit);
  const planned = opts.prescribed
    ? extractPlannedIntervals(opts.prescribed, opts.prescribedContext)
    : null;
  let source: 'prescription' | 'inference' = 'inference';
  let snapped = false;
  let targets: number[];

  const prescribedTargets = planned?.groups.flatMap((group) =>
    Array.from({ length: group.reps }, () => group.distPerRepMeters)) ?? [];
  if (
    planned
    && blocks.length === planned.reps
    && prescribedTargets.length === blocks.length
    && prescribedTargets.every((target) => target > 0)
  ) {
    source = 'prescription';
    snapped = true;
    targets = prescribedTargets;
  } else if (uniform) {
    const canon = nearestCanonical(median(dists), grid);
    if (canon) { snapped = true; targets = efforts.map(() => canon.meters); }
    else targets = dists.slice();
  } else {
    targets = efforts.map((e) => nearestCanonical(e.distMeters, grid)?.meters ?? e.distMeters);
  }

  // 3. Forgiving credit per rep (limit = next rep's effort start, or last sample).
  const reps: SnappedRep[] = efforts.map((eff, i) => {
    const limit = i + 1 < efforts.length ? efforts[i + 1]!.startIdx : stream.d.length - 1;
    const c = creditRep(stream, eff, targets[i]!, limit, blocks[i]!.paceSecPerMi);
    return {
      targetDistMeters: c.creditedMeters,
      measuredDistMeters: eff.distMeters,
      achievedPaceSecPerMi: c.achievedPaceSecPerMi,
      avgHr: c.avgHr,
      faded: c.faded,
      startIdx: eff.startIdx,
      endIdx: eff.endIdx,
    };
  });

  // 4. Label.
  let label: string;
  if (source === 'prescription' && planned && planned.groups.length > 1) {
    label = planned.groups.map((group) => {
      const distance = nearestCanonical(group.distPerRepMeters, grid)?.label
        ?? fmtMeasured(group.distPerRepMeters);
      return `${group.reps} × ${distance}`;
    }).join(' + ');
  } else if (snapped && uniform) {
    const canonLabel = source === 'prescription'
      ? (nearestCanonical(targets[0]!, grid)?.label ?? fmtMeasured(targets[0]!))
      : nearestCanonical(median(dists), grid)!.label;
    label = `${reps.length} × ${canonLabel}`;
  } else if (uniform) {
    label = `${reps.length} × ~${fmtMeasured(median(dists))}`;
  } else {
    label = `${reps.length} hard reps`;
  }

  return { reps, label, uniform, snapped, source };
}
