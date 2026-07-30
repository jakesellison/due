/**
 * Change-point workout interpreter — segments a run's per-lap effort into
 * workout blocks and classifies the kind (tempo/intervals/progression/none).
 *
 * Port of docs/superpowers/specs/interpreter-prototype/engine.mjs — validated
 * on real data. Algorithm is verbatim (`lapFeatures`, `zscore`, `optPartition`,
 * `segStats`, `classify`); only the thresholds `easyPaceSecPerMi`/`hrFloor`/
 * `qualityFloorSecPerMi` are lifted out of module constants into the `refs`
 * parameter so production can derive them per-athlete instead of hardcoding
 * (see plan §Global Constraints: QUALITY_FLOOR is derived, never hardcoded).
 */
import type { Gap } from './gap';
import {
  lapGap,
} from './gap';
import type { StravaLap } from '../run/analysis';
import {
  repGroupSummary,
  type HardBlock,
  type RunStream,
} from './qualityDetect';
import {
  computeIngestVerdict,
  type IngestVerdict,
} from './ingestVerdict';
import {
  alignIntervalsToPlan,
} from './planIntervalAlignment';
import {
  normalizeMovingTime,
} from './movingTime';
import {
  movingSeconds,
  spanMeters,
  avgHrOver,
} from './intervalSnap';
import {
  METERS_PER_MILE,
} from '../units';

const MI = 1609.34;

// Stream-feature binning: the interpreter segments over moving-time-corrected
// ~BIN_M distance bins (not per-lap), so a run with <2 laps (auto-lap off) is
// still segmented from its stream. Laps + watch-pauses feed in as low-penalty
// boundary SIGNALS (the `manual` discount), never as the only split points.
const BIN_M = 100;
const MIN_TAIL_M = 50; // fold a shorter trailing partial bin into its predecessor
const BOUNDARY_TOL_M = 60; // a declared boundary marks the bin whose onset is within this

const fmt = (s: number): string =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—';

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

// Constants ported verbatim from engine.mjs (not derived per-athlete).
const HARD_MARGIN = 25;
const PACE_CLAMP: [number, number] = [180, 720];
const K_DEFAULT = 2.5;
const MANUAL_DISCOUNT = 0.05;

export interface QualityFloorRefs {
  easyPaceSecPerMi: number;
  /** Moderate pace floor used by the lap/regime evidence path. */
  paceFloorSecPerMi: number;
  hrFloor: number;
  qualityFloorSecPerMi: number;
}

export interface Block {
  /** Inclusive stream sample index of the block's first bin. */
  startIdx: number;
  /** Inclusive stream sample index of the block's last bin. */
  endIdx: number;
  mi: number;
  gapPaceSecPerMi: number;
  hr: number | null;
}

export interface Reading {
  kind: 'none' | 'tempo' | 'intervals' | 'progression';
  qualityMi: number;
  blocks: Block[];
  summary: string;
  /** True when reps were aligned one-for-one to a prescribed interval sequence. */
  planAligned?: boolean;
  /** Rep-shape fit for a plan-aligned reading (0..1). */
  alignmentConfidence?: number;
  /** Genuine additional reps beyond the prescribed core; incidental fragments are omitted. */
  extras?: Block[];
  /** Evidence that produced a plan-aligned interval reading. */
  source?: 'laps' | 'stream';
}

interface LapFeature {
  i: number;
  dist: number;
  moving: number;
  raw: number;
  gapPace: number;
  hr: number | null;
  manual: boolean;
  /** Inclusive stream sample indices this bin spans. */
  aIdx: number;
  bIdx: number;
}

function zscore(vals: Array<number | null>): number[] {
  const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
  const m = median(ok);
  const s = 1.4826 * (median(ok.map((v) => Math.abs(v - m))) || 1);
  return vals.map((v) => (v != null && Number.isFinite(v) ? (v - m) / s : 0));
}

function idxAtValue(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m]! < target) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Bin the stream into ~BIN_M moving-time-corrected distance bins and turn each
 * bin into a feature the change-point engine consumes — the stream analogue of
 * the old per-lap features. Laps + watch-pauses are folded in as `manual`
 * (declared-boundary) SIGNALS the DP discounts, so the segmentation is anchored
 * by the stream itself and merely nudged by declared boundaries. Each feature
 * carries its inclusive stream index range so blocks emit native stream indices.
 */
function streamFeatures(stream: RunStream, gap: Gap | null, laps?: StravaLap[] | null): LapFeature[] {
  const d = stream.d;
  const n = Math.min(d.length, stream.v.length, stream.t.length);
  if (n < 2) return [];
  const startD = d[0] ?? 0;

  // 1. Bin by cumulative distance into ~BIN_M bins with contiguous index ranges.
  const bins: Array<{ aIdx: number; bIdx: number }> = [];
  let binStart = 0;
  let nextEdge = startD + BIN_M;
  for (let i = 1; i < n; i++) {
    if (d[i]! >= nextEdge) {
      bins.push({ aIdx: binStart, bIdx: i });
      binStart = i + 1;
      while (nextEdge <= d[i]!) nextEdge += BIN_M; // skip edges a sparse sample jumped past
    }
  }
  if (binStart <= n - 1) bins.push({ aIdx: binStart, bIdx: n - 1 });
  if (!bins.length) return [];
  // Fold a short trailing partial bin into its predecessor.
  if (bins.length >= 2) {
    const last = bins[bins.length - 1]!;
    if (spanMeters(stream, last.aIdx, last.bIdx) < MIN_TAIL_M) {
      bins[bins.length - 2]!.bIdx = last.bIdx;
      bins.pop();
    }
  }

  // 2. Declared-boundary cumulative distances: non-auto interior lap edges +
  //    watch-pause span edges (from the SAME moving-time normalizer the rest of
  //    the pipeline uses — no re-derivation of stops/moving time here).
  const boundaryDists: number[] = [];
  if (laps && laps.length > 1) {
    const isAuto = (dist: number): boolean =>
      Math.abs(dist - 1609) < 40 || Math.abs(dist - 1000) < 30;
    let cum = startD;
    for (let i = 0; i < laps.length - 1; i++) {
      const di = laps[i]!.distance ?? 0;
      cum += di;
      const dj = laps[i + 1]!.distance ?? 0;
      // Interior boundary is "declared" unless BOTH adjacent laps look auto-lapped
      // (an every-mile auto lap must NOT hand out free splits — see the
      // mile-auto-lapped-continuous false-positive fix).
      if (!isAuto(di) || !isAuto(dj)) boundaryDists.push(cum);
    }
  }
  const mv = normalizeMovingTime({ t: stream.t, d: stream.d, v: stream.v });
  for (const s of mv.stopIntervals) {
    boundaryDists.push(d[idxAtValue(stream.t, s.startS)] ?? startD);
    boundaryDists.push(d[idxAtValue(stream.t, s.endS)] ?? startD);
  }

  // 3. Each declared boundary marks the single bin whose onset is nearest it.
  const onset = bins.map((b) => (b.aIdx > 0 ? d[b.aIdx - 1]! : startD));
  const manual = bins.map(() => false);
  for (const B of boundaryDists) {
    if (B - startD < MIN_TAIL_M) continue; // start of run, not an interior change point
    let best = -1;
    let bestErr = Infinity;
    for (let k = 0; k < bins.length; k++) {
      const e = Math.abs(onset[k]! - B);
      if (e < bestErr) {
        bestErr = e;
        best = k;
      }
    }
    if (best > 0 && bestErr <= BOUNDARY_TOL_M) manual[best] = true;
  }

  // 4. Per-bin feature: exact moving-time pace over the bin, GAP-adjusted, + HR.
  return bins.map((b, i) => {
    const dist = spanMeters(stream, b.aIdx, b.bIdx);
    const moving = movingSeconds(stream, b.aIdx, b.bIdx);
    const raw = moving > 0 && dist > 0 ? moving / (dist / MI) : Infinity;
    const startDist = b.aIdx > 0 ? d[b.aIdx - 1]! : startD;
    const endDist = d[b.bIdx]!;
    const gapPace = gap ? lapGap(gap, startDist, endDist, raw).gapPace : raw;
    const hr = avgHrOver(stream, b.aIdx, b.bIdx);
    return { i, dist, moving, raw, gapPace, hr, manual: manual[i]!, aIdx: b.aIdx, bIdx: b.bIdx };
  });
}

function optPartition(
  z: number[],
  w: number[],
  feats: LapFeature[],
  beta: number
): Array<[number, number]> {
  const n = z.length;
  const pw = [0];
  const pwx = [0];
  const pwx2 = [0];
  for (let i = 0; i < n; i++) {
    pw.push(pw[i]! + w[i]!);
    pwx.push(pwx[i]! + w[i]! * z[i]!);
    pwx2.push(pwx2[i]! + w[i]! * z[i]! * z[i]!);
  }
  const sse = (a: number, b: number): number => {
    const W = pw[b + 1]! - pw[a]!;
    const SX = pwx[b + 1]! - pwx[a]!;
    const SX2 = pwx2[b + 1]! - pwx2[a]!;
    return W > 0 ? SX2 - (SX * SX) / W : 0;
  };
  const F: number[] = new Array(n + 1).fill(Infinity);
  F[0] = 0;
  const prev: number[] = new Array(n + 1).fill(0);
  for (let t = 1; t <= n; t++) {
    for (let s = 0; s < t; s++) {
      const declared = feats[s]!.manual || (s > 0 && feats[s - 1]!.manual);
      const b = s === 0 ? 0 : beta * (declared ? MANUAL_DISCOUNT : 1);
      const c = F[s]! + sse(s, t - 1) + b;
      if (c < F[t]!) {
        F[t] = c;
        prev[t] = s;
      }
    }
  }
  const bnds: Array<[number, number]> = [];
  let t = n;
  while (t > 0) {
    bnds.unshift([prev[t]!, t - 1]);
    t = prev[t]!;
  }
  return bnds;
}

interface SegStat {
  a: number;
  b: number;
  /** Inclusive stream sample indices this segment spans (from its first/last bin). */
  startIdx: number;
  endIdx: number;
  dist: number;
  mi: number;
  moving: number;
  raw: number;
  gapPace: number;
  hr: number | null;
  hard: boolean;
  /** Raw (non-grade-adjusted) pace clears the easy-deviation gate — i.e. the
   *  athlete was still running fast here. Used to tell an intra-effort GAP blip
   *  (fast raw, e.g. a downhill that inflates GAP) from a real recovery jog
   *  (slow raw). A non-hard seg only SEVERS a block when raw actually slowed. */
  rawFast: boolean;
}

function segStats(feats: LapFeature[], a: number, b: number, refs: QualityFloorRefs): SegStat {
  const laps = feats.slice(a, b + 1);
  const dist = laps.reduce((s, l) => s + l.dist, 0);
  const moving = laps.reduce((s, l) => s + l.moving, 0);
  const raw = laps.reduce((s, l) => s + l.raw * l.dist, 0) / dist;
  const gapPace = laps.reduce((s, l) => s + l.gapPace * l.dist, 0) / dist;
  const hrs = laps.map((l) => l.hr).filter((x): x is number => x != null);
  const hr = hrs.length ? Math.round(hrs.reduce((s, c) => s + c, 0) / hrs.length) : null;
  const subMile = laps.every((l) => l.dist < 1400);
  // Quality is decided by PACE, cast as a broad net (the UI slider is the safety
  // net — a conservative default the runner can expand beats "no workout, no
  // options"). Two gates, both PACE-based, no HR veto:
  //   • EFFORT: GAP pace clears the quality floor (grade-adjusted → kills downhill
  //     freebies where raw is fast but effort is easy).
  //   • INTENTION: raw pace faster than easy (you actually ran faster → kills
  //     cardiac drift / uphill slowdowns where pace never changed).
  // Sub-mile reps skip the raw-intention gate (a hard hill rep is slow in raw pace
  // but its fast GAP already proves the effort). HR is NOT a gate here — it only
  // sharpens block boundaries in the segmentation signal, never vetoes a block
  // (a strict HR floor was rejecting genuine tempo/track efforts).
  const rawFast = raw <= refs.easyPaceSecPerMi - HARD_MARGIN;
  const gapFast = gapPace <= refs.qualityFloorSecPerMi;
  const hard = gapFast && (rawFast || subMile);
  const startIdx = feats[a]!.aIdx;
  const endIdx = feats[b]!.bIdx;
  return { a, b, startIdx, endIdx, dist, mi: dist / MI, moving, raw, gapPace, hr, hard, rawFast };
}

interface RawBlock {
  startIdx: number;
  endIdx: number;
  dist: number;
  moving: number;
  gapNum: number;
  rawNum: number;
  hrNum: number;
  hrW: number;
  mi: number;
}

// A SUSTAINED non-hard stretch (≥ this far) ends the effort — whether it's a
// recovery jog OR a downhill/coast the athlete cruised (fast raw, but slow
// grade-adjusted pace = easy effort, so NOT part of the hard block). Only a
// SHORTER blip (a mid-effort sag over a hill/turn) is bridged — the old
// hysteresis dead-band, kept narrower than a true interval recovery (≥ ~0.2 mi).
// (Length alone: an earlier "only sever a raw slowdown" rule let a long downhill
// where raw stayed fast get swallowed into a spurious block at ~easy GAP pace.)
const MIN_RECOVERY_M = 180;

function classify(segs: SegStat[]): { kind: Reading['kind']; blocks: Block[] } {
  const rawBlocks: RawBlock[] = [];
  let cur: RawBlock | null = null;
  // Non-hard segs held between hard efforts: bridged into the block once another
  // hard seg follows, or dropped when a real recovery severs.
  let pend: SegStat[] = [];
  let pendDist = 0;
  const acc = (blk: RawBlock, s: SegStat): void => {
    blk.endIdx = s.endIdx;
    blk.dist += s.dist;
    blk.moving += s.moving;
    blk.gapNum += s.gapPace * s.dist;
    blk.rawNum += s.raw * s.dist;
    if (s.hr != null) {
      blk.hrNum += s.hr * s.dist;
      blk.hrW += s.dist;
    }
    blk.mi += s.mi;
  };
  const resetPend = (): void => {
    pend = [];
    pendDist = 0;
  };
  for (const s of segs) {
    const isHard = s.hard && s.dist >= 150;
    if (isHard) {
      if (!cur) cur = { startIdx: s.startIdx, endIdx: s.endIdx, dist: 0, moving: 0, gapNum: 0, rawNum: 0, hrNum: 0, hrW: 0, mi: 0 };
      else for (const p of pend) acc(cur, p); // bridge the held blip into the effort
      resetPend();
      acc(cur, s);
    } else if (cur) {
      pend.push(s);
      pendDist += s.dist;
      if (pendDist >= MIN_RECOVERY_M) {
        rawBlocks.push(cur); // sustained non-hard stretch — the effort ended
        cur = null;
        resetPend();
      }
    }
  }
  if (cur) rawBlocks.push(cur); // trailing held gap is not part of the block

  const B = rawBlocks.map((b) => ({
    startIdx: b.startIdx,
    endIdx: b.endIdx,
    mi: b.mi,
    moving: b.moving,
    gapPaceSecPerMi: b.gapNum / b.dist,
    raw: b.rawNum / b.dist,
    hr: b.hrW ? Math.round(b.hrNum / b.hrW) : null,
  }));

  if (!B.length) return { kind: 'none', blocks: [] };

  const toBlock = (b: (typeof B)[number]): Block => ({
    startIdx: b.startIdx,
    endIdx: b.endIdx,
    mi: b.mi,
    gapPaceSecPerMi: b.gapPaceSecPerMi,
    hr: b.hr,
  });

  if (B.length === 1) {
    if (B[0]!.mi < 1.0 && B[0]!.moving < 300) return { kind: 'none', blocks: [] };
    return { kind: 'tempo', blocks: [toBlock(B[0]!)] };
  }

  const p = B.map((b) => b.raw);
  const mono = p.every((v, i) => i === 0 || v <= p[i - 1]! + 5);
  if (mono && p[0]! - p[p.length - 1]! >= 25 && B.length >= 3) {
    return { kind: 'progression', blocks: B.map(toBlock) };
  }
  return { kind: 'intervals', blocks: B.map(toBlock) };
}

function buildSummary(kind: Reading['kind'], blocks: Block[], qualityMi: number): string {
  if (kind === 'none' || !blocks.length) return '';
  const distWeightedGap =
    blocks.reduce((s, b) => s + b.gapPaceSecPerMi * b.mi, 0) / (qualityMi || 1);
  if (kind === 'tempo') {
    return `${qualityMi.toFixed(1)}mi tempo @ ${fmt(distWeightedGap)}`;
  }
  if (kind === 'progression') {
    return `progression ${qualityMi.toFixed(1)}mi ${fmt(blocks[0]!.gapPaceSecPerMi)}→${fmt(
      blocks[blocks.length - 1]!.gapPaceSecPerMi
    )}`;
  }
  // intervals
  const mis = blocks.map((b) => b.mi);
  const sameSize = mis.every((m) => Math.abs(m - mis[0]!) <= 0.15);
  if (sameSize) {
    return `${blocks.length}×${mis[0]!.toFixed(mis[0]! < 1 ? 1 : 0)}mi @ ${fmt(distWeightedGap)}`;
  }
  // Ragged reps have no single rep distance to name, but dropping distance
  // altogether made this form LOSSY: two readings that banked 6.3mi and 5.3mi
  // both rendered "2× reps @ 6:5x", so the interpretation list offered them as
  // separate options a runner had no way to tell apart. Carry the banked total —
  // it is the number the choice actually decides.
  return `${blocks.length}× reps · ${qualityMi.toFixed(1)}mi @ ${fmt(distWeightedGap)}`;
}

/**
 * Segment a run's STREAM (moving-time-corrected ~100 m distance bins) into
 * workout blocks via Optimal-Partitioning change-point detection over a
 * composite `z(GAP-speed)+z(HR)` signal, then classify. Laps + watch-pauses are
 * boundary SIGNALS only, so a run with <2 laps is still segmented.
 */
export function interpretOne(
  stream: RunStream,
  laps: StravaLap[] | null,
  gap: Gap | null,
  refs: QualityFloorRefs,
  K: number = K_DEFAULT
): Reading {
  const feats = streamFeatures(stream, gap, laps);
  if (!feats.length) return { kind: 'none', qualityMi: 0, blocks: [], summary: '' };

  const clamp = (v: number) => Math.max(PACE_CLAMP[0], Math.min(PACE_CLAMP[1], v));
  const zSpeed = zscore(feats.map((f) => 1 / clamp(f.gapPace)));
  const zHR = zscore(feats.map((f) => f.hr));
  const z = feats.map((_, i) => zSpeed[i]! + zHR[i]!);
  const meanDist = feats.reduce((s, f) => s + f.dist, 0) / feats.length;
  const w = feats.map((f) => f.dist / meanDist);
  const beta = K * Math.log(feats.length);
  const segs = optPartition(z, w, feats, beta).map(([a, b]) => segStats(feats, a, b, refs));

  const { kind, blocks } = classify(segs);
  const qualityMi = blocks.reduce((s, b) => s + b.mi, 0);
  const summary = buildSummary(kind, blocks, qualityMi);

  return { kind, qualityMi, blocks, summary };
}

// CROPS sweep range — coarse (large K → fewer, larger segments) to fine (small
// K → more, smaller segments). Distinct segmentations across this range are
// deduped by their block-boundary signature into the candidate ladder.
const CROPS_K_MIN = 1.0;
const CROPS_K_MAX = 8.0;
const CROPS_K_STEP = 0.5;
const PLAN_MATCH_T = 0.6;

// Honest-read precision floor (banked grade-adjusted-fast miles). The plan-
// AGNOSTIC honest read must bank at least this much quality to CREDIT a run as a
// workout. Below it, a couple of surges / GPS blips on an easy run read as
// "intervals" — the runner's own "easy run that just felt hard" is the canonical
// false positive (2×0.4mi @ ~7:09 must be `none`, while a real 6×400m ≈ 1.68mi
// hill session stays). This mirrors the single-block tempo gate in classify():
// quality is BANKED DISTANCE, and under ~1 mile there isn't enough to call the
// run a quality session. Only the honest read is gated — a PLAN match is chosen
// from the ungated candidate ladder, so a genuine SHORT prescribed workout
// (6×200m ≈ 0.7mi) still credits via `matched`.
const MIN_HONEST_QUALITY_MI = 1.0;

function boundarySignature(reading: Reading): string {
  return JSON.stringify(reading.blocks.map((b) => [b.startIdx, b.endIdx]));
}

export interface InterpretResult {
  honest: Reading;
  matched: (Reading & { matchesPlan: boolean; confidence: number; planWorkoutId?: string }) | null;
  candidates: Reading[]; // coarse→fine, distinct segmentations
  defaultIdx: number; // index into candidates (the K=2.5 reading)
}

export interface PlanQuality {
  kind: string;
  qualityMi: number;
  workoutId: string;
  boundariesMi?: number[];
  /** Prescribed rep count (intervals only). A matched intervals candidate must
   *  have roughly this many blocks — so an easy run's 2 scattered barely-fast
   *  bins can't pose as a prescribed 6×600m. */
  reps?: number;
  /** Prescribed distance for every rep, in order. Supports mixed sets. */
  repDistancesMi?: number[];
}

function planFit(cand: Reading, plan: PlanQuality): number {
  // Kind must match (a tempo candidate never fulfills an intervals prescription,
  // and vice-versa) AND the credited distance must be a real fraction of the
  // prescribed — a 0.8mi scrap can't match a 2.2mi prescription. Returns the
  // symmetric distance ratio ∈ [0,1] (1 = exact), gated by PLAN_MATCH_T.
  if (cand.kind !== plan.kind) return 0;
  if (cand.planAligned && cand.alignmentConfidence != null) return cand.alignmentConfidence;
  const distanceFit = Math.min(cand.qualityMi, plan.qualityMi) / Math.max(cand.qualityMi, plan.qualityMi, 0.1);
  if (cand.kind === 'intervals' && plan.reps && plan.reps > 0) {
    // Total distance alone let five trimmed 2mi reps + a 0.3mi cooldown tail
    // outscore the honest five-rep structure. Unaligned candidates pay for a
    // count mismatch; the plan-aligned evidence path below can instead select
    // the prescribed core and retain only genuine additional reps as extras.
    const countFit = Math.min(cand.blocks.length, plan.reps) / Math.max(cand.blocks.length, plan.reps);
    return distanceFit * countFit;
  }
  return distanceFit;
}

function planRepDistancesMeters(plan: PlanQuality): number[] {
  if (plan.kind !== 'intervals' || !plan.reps || plan.reps <= 0) return [];
  if (plan.repDistancesMi?.length === plan.reps && plan.repDistancesMi.every((mi) => mi > 0)) {
    return plan.repDistancesMi.map((mi) => mi * METERS_PER_MILE);
  }
  const perRepMi = plan.qualityMi / plan.reps;
  return perRepMi > 0 ? Array.from({ length: plan.reps }, () => perRepMi * METERS_PER_MILE) : [];
}

function hardBlockToReading(block: HardBlock, stream: RunStream): Block {
  return {
    startIdx: block.startIdx,
    endIdx: block.endIdx,
    mi: block.distanceMeters / METERS_PER_MILE,
    // Lap/regime evidence carries the runner-facing achieved pace. Keep it in
    // this field for the Reading contract; readingToDetect remeasures moving
    // pace from the same indices when it builds chart geometry.
    gapPaceSecPerMi: block.paceSecPerMi,
    hr: avgHrOver(stream, block.startIdx, block.endIdx),
  };
}

function evidenceReading(verdict: IngestVerdict, stream: RunStream): Reading {
  return {
    kind: verdict.kind,
    qualityMi: verdict.qualityDistanceMeters / METERS_PER_MILE,
    blocks: verdict.blocks.map((block) => hardBlockToReading(block, stream)),
    summary: verdict.summary,
    source: verdict.source,
  };
}

/**
 * Offer the corpus-validated lap/regime verdict as a plan candidate, then align
 * it one-for-one to the prescribed reps. The change-point ladder remains the
 * honest/unplanned read; this path gives a plan exact watch-lap structure and
 * prevents incidental tails from changing the matched summary.
 */
function planAlignedIntervalCandidate(
  stream: RunStream,
  verdict: IngestVerdict,
  plan: PlanQuality,
): Reading | null {
  const targets = planRepDistancesMeters(plan);
  if (targets.length === 0) return null;
  if (!verdict.isQuality || verdict.kind !== 'intervals') return null;
  const aligned = alignIntervalsToPlan(verdict.blocks, targets);
  if (!aligned) return null;
  const blocks = aligned.reps.map((block) => hardBlockToReading(block, stream));
  const extras = aligned.extras.map((block) => hardBlockToReading(block, stream));
  return {
    kind: 'intervals',
    qualityMi: blocks.reduce((sum, block) => sum + block.mi, 0),
    blocks,
    // The matched headline describes the prescription's set grammar (including
    // mixed 200m/300m sets); achieved pace still comes from the aligned watch
    // reps, and credited distance remains measured rather than fabricated.
    summary: repGroupSummary(aligned.reps.map((rep, index) => ({
      ...rep,
      distanceMeters: targets[index]!,
    }))),
    planAligned: true,
    alignmentConfidence: aligned.confidence,
    ...(extras.length ? { extras } : {}),
    source: verdict.source,
  };
}

/**
 * Plan-tilt for a CONTINUOUS prescription ("Q mi @ MP/tempo"): find the hardest
 * contiguous ~Q-mile window in the run and, IF its grade-adjusted pace clears the
 * quality floor, offer it as a candidate. This lets the plan RESHAPE the ladder —
 * a near-floor MP block that the fine-grained honest read fragments (each 100 m
 * bin straddles the floor) reads correctly as ONE block once we measure the whole
 * prescribed span (its average clears the floor, like mile-granularity did). The
 * data floor is the never-fabricate gate: an easy run yields no qualifying window,
 * so a prescription can't manufacture quality. Returns null when nothing qualifies.
 */
function planWindowCandidate(feats: LapFeature[], plan: PlanQuality, refs: QualityFloorRefs): Reading | null {
  const n = feats.length;
  if (!n) return null;
  const Qm = plan.qualityMi * MI;
  // For each start, take the SHORTEST window that reaches the prescribed length
  // (≈ Q, not a fast sub-core), then keep the HARDEST such window (lowest GAP) —
  // i.e. the prescribed-length span located where the effort actually was.
  let best: { i: number; j: number; dist: number; gap: number; hr: number | null } | null = null;
  for (let i = 0; i < n; i++) {
    let dist = 0;
    let gapNum = 0;
    let hrNum = 0;
    let hrW = 0;
    for (let j = i; j < n; j++) {
      const f = feats[j]!;
      dist += f.dist;
      gapNum += f.gapPace * f.dist;
      if (f.hr != null) {
        hrNum += f.hr * f.dist;
        hrW += f.dist;
      }
      if (dist < Qm) continue; // not yet the prescribed length
      if (dist <= 1.4 * Qm) {
        const gap = gapNum / dist;
        if (!best || gap < best.gap) {
          best = { i, j, dist, gap, hr: hrW ? Math.round(hrNum / hrW) : null };
        }
      }
      break; // this start's ~Q window is decided (first reach of Q)
    }
  }
  if (!best || best.gap > refs.qualityFloorSecPerMi) return null; // never fabricate
  const block: Block = {
    startIdx: feats[best.i]!.aIdx,
    endIdx: feats[best.j]!.bIdx,
    mi: best.dist / MI,
    gapPaceSecPerMi: best.gap,
    hr: best.hr,
  };
  return { kind: 'tempo', qualityMi: block.mi, blocks: [block], summary: buildSummary('tempo', [block], block.mi) };
}

/**
 * Top-level interpreter: sweeps the change-point penalty `K` to build a
 * coarse→fine CROPS candidate ladder, then (optionally) scores each candidate
 * against a plan-prescribed workout to pick a `matched` reading. The plan may
 * only pick among data-derived candidates — it never fabricates a block set
 * (see design doc §5: "the data likelihood still gates every split").
 */
export function interpretWorkout(
  stream: RunStream,
  laps: StravaLap[] | null,
  gap: Gap | null,
  refs: QualityFloorRefs,
  plan?: PlanQuality | null
): InterpretResult {
  const seen = new Map<string, Reading>();
  let defaultReading: Reading | null = null;
  for (let k = CROPS_K_MIN; k <= CROPS_K_MAX + 1e-9; k += CROPS_K_STEP) {
    const reading = interpretOne(stream, laps, gap, refs, k);
    const sig = boundarySignature(reading);
    if (!seen.has(sig)) seen.set(sig, reading);
    if (Math.abs(k - K_DEFAULT) < 1e-9) defaultReading = seen.get(sig)!;
  }
  if (!defaultReading) defaultReading = interpretOne(stream, laps, gap, refs, K_DEFAULT);
  const defaultSig = boundarySignature(defaultReading);
  if (!seen.has(defaultSig)) seen.set(defaultSig, defaultReading);

  let candidates = Array.from(seen.values());

  // Canonical honest evidence: the lap/regime tree was corpus-validated against
  // marked intervals, strides, hills, and sustained efforts. It owns the
  // automatic read; the change-point ladder stays available for plan tilt and
  // user interpretation instead of silently becoming a second headline.
  const evidence = computeIngestVerdict({
    streams: stream,
    laps,
    floor: {
      paceFloorSecPerMi: refs.paceFloorSecPerMi,
      hrFloor: Number.isFinite(refs.hrFloor) && refs.hrFloor < 300 ? refs.hrFloor : null,
      qualityFloorSecPerMi: refs.qualityFloorSecPerMi,
    },
  });
  const automaticReading = evidenceReading(evidence, stream);
  candidates.push(automaticReading);

  // Plan-tilt: when the plan prescribes a CONTINUOUS block, add the best
  // prescribed-length window so plan-fit can prefer the prescribed shape even
  // when the fine-grained ladder fragmented it. Only added if it clears the data
  // floor (never fabricated). Deduped by boundary signature.
  if (plan && plan.kind !== 'intervals') {
    const win = planWindowCandidate(streamFeatures(stream, gap, laps), plan, refs);
    if (win && !candidates.some((c) => boundarySignature(c) === boundarySignature(win))) {
      candidates.push(win);
    }
  }

  // Interval plans get a candidate from the existing lap/regime evidence path,
  // aligned exactly to the prescribed sequence. This is deliberately additive:
  // the change-point candidates remain available for the honest read + slider.
  if (plan?.kind === 'intervals') {
    const aligned = planAlignedIntervalCandidate(stream, evidence, plan);
    if (aligned) candidates.push(aligned);
  }

  candidates.sort((a, b) => {
    if (a.blocks.length !== b.blocks.length) return a.blocks.length - b.blocks.length;
    return b.qualityMi - a.qualityMi;
  });

  if (candidates.every((c) => c.kind === 'none')) {
    candidates = [candidates.find((c) => boundarySignature(c) === defaultSig) ?? candidates[0]!];
  }

  // Collapse readings the RUNNER cannot tell apart.
  //
  // Internally a candidate is identified by `boundarySignature` — its exact
  // start/end sample indices — which is the right identity for the solver but
  // the wrong one for a choice. Two readings whose boundaries differ by a sample
  // or two are separate entries there while describing the same run in the same
  // words. Worse, `automaticReading` and `planAlignedIntervalCandidate` are
  // pushed WITHOUT the signature dedup the K-sweep applies, so a plan-matched
  // interval session reliably produced near-twins.
  //
  // The effect on screen was a correction affordance that could not be used:
  // "5×2mi @ 6:00 / 5×2mi @ 6:00 / 5×2mi @ 6:01 / 5×2mi @ 6:01" asks the runner
  // to choose between four spellings of one answer. Offering a choice implies
  // the options differ; when they don't, the control teaches the runner that the
  // engine is confused rather than that the run was ambiguous.
  //
  // So identity here is the STRUCTURAL CLAIM — what kind of session, how many
  // reps, how long each — because that is what the runner is actually picking
  // between ("this was 5×2mi" vs "this was a 12mi tempo"). Pace and total
  // mileage are consequences of the segmentation, not separate options; a
  // one-second pace difference is not a decision.
  //
  // Two readings are the same choice when they claim the same shape and bank
  // materially the same distance. This is a tolerance, not a rounded key: the
  // near-twins differ by hundredths of a mile, which any fixed rounding will
  // sometimes split across a boundary (5.34 and 5.28 round to 2.7 and 2.6 per
  // rep and survive as "distinct").
  const sameChoice = (a: Reading, b: Reading): boolean =>
    a.kind === b.kind &&
    a.blocks.length === b.blocks.length &&
    Math.abs(a.qualityMi - b.qualityMi) <= Math.max(0.3, 0.05 * Math.max(a.qualityMi, b.qualityMi));

  // Some readings are load-bearing and are never collapsed away, whatever they
  // resemble:
  //  - `automaticReading` IS the credited default — `defaultIdx` resolves to it
  //    by object identity just below, and `honest` is whatever sits there.
  //  - a plan-aligned candidate carries lap-derived metrics, `source: 'laps'`
  //    and an alignment confidence that a structurally identical change-point
  //    reading does not, and `matched` is expected to prefer it.
  //  - `none` is the "not a workout" endpoint the runner can always pick.
  // Dropping either of the first two silently changes what a run CREDITS, which
  // is far worse than showing one row too many.
  const loadBearing = (r: Reading): boolean =>
    r === automaticReading || r.planAligned === true || r.kind === 'none';
  const kept: Reading[] = [];
  for (const c of candidates) {
    if (loadBearing(c) || !kept.some((k) => sameChoice(k, c))) kept.push(c);
  }
  candidates = kept;

  // Use object identity first: a plan-aligned candidate may deliberately share
  // boundaries with the honest reading while carrying lap-derived metrics.
  defaultReading = automaticReading;
  let defaultIdx = candidates.indexOf(defaultReading);
  if (defaultIdx < 0) defaultIdx = candidates.findIndex((c) => boundarySignature(c) === defaultSig);
  if (defaultIdx < 0) defaultIdx = 0;
  let honest = candidates[defaultIdx]!;

  // Honest-read precision floor: an unprescribed run needs ≥ MIN_HONEST_QUALITY_MI
  // of banked quality to credit as a workout. Below it, the honest (credit)
  // default is `none` — but the rich reading stays in the ladder, so a plan match
  // can still pick it and the run-detail slider can still reach it. Represent the
  // gated default as a real `none` point so `honest === candidates[defaultIdx]`.
  if (honest.kind !== 'none' && honest.qualityMi < MIN_HONEST_QUALITY_MI) {
    let noneIdx = candidates.findIndex((c) => c.kind === 'none');
    if (noneIdx < 0) {
      candidates = [{ kind: 'none', qualityMi: 0, blocks: [], summary: '' }, ...candidates];
      noneIdx = 0;
    }
    defaultIdx = noneIdx;
    honest = candidates[noneIdx]!;
  }

  let matched: InterpretResult['matched'] = null;
  if (plan) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    candidates.forEach((c, i) => {
      if (c.kind === 'none') return;
      // Structure gate: a matched intervals candidate must have roughly the
      // prescribed number of reps (±2 or 40%). Kills easy-run over-matches where
      // a couple of scattered barely-fast bins pose as a many-rep prescription.
      if (plan.kind === 'intervals' && plan.reps && plan.reps > 0) {
        const tol = Math.max(2, Math.round(plan.reps * 0.4));
        if (Math.abs(c.blocks.length - plan.reps) > tol) return;
      }
      const score = planFit(c, plan);
      const tiedButMoreExplicit =
        Math.abs(score - bestScore) <= 1e-9 &&
        c.planAligned === true &&
        (bestIdx < 0 || candidates[bestIdx]?.planAligned !== true);
      if (score >= PLAN_MATCH_T && (score > bestScore || tiedButMoreExplicit)) {
        bestScore = score;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      matched = {
        ...candidates[bestIdx]!,
        matchesPlan: true,
        confidence: bestScore,
        planWorkoutId: plan.workoutId,
      };
    }
  }

  return { honest, matched, candidates, defaultIdx };
}
