/**
 * normalizeStructure.ts — Convert the import "fat" wire format for a workout
 * structure into the clean `Segment` union the rest of the app reads.
 *
 * The import schema (see workoutStructureSchema.ts) expresses one flat segment
 * object per item — `kind` plus nullable `target`/`sets`/`children` — avoiding
 * `$ref`/`anyOf`/recursion. This module folds that wire shape back into the
 * discriminated `LeafSegment | RepeatSegment` union: it drops null target
 * fields, validates enums/kinds, strips `sets`/`children` from leaves and
 * `target` from repeats, and discards structurally empty segments.
 *
 * Pure. No IO. Node-tested. Defensive against malformed AI output.
 */

import type {
  LeafSegment,
  PaceBand,
  PaceLabel,
  PacePrescription,
  RepeatSegment,
  Segment,
  Target,
  TargetBy,
  WorkoutStructure,
} from '../workout/types';

const LEAF_KINDS = new Set<LeafSegment['kind']>([
  'warmup', 'cooldown', 'steady', 'interval', 'work', 'recovery', 'strides',
]);
const TARGET_BY = new Set<TargetBy>(['pace', 'time', 'distance', 'hr', 'effort']);
const PACE_LABELS = new Set<PaceLabel>([
  'MP', 'HMP', '10K', '5K', '3K', 'mile', 'threshold', 'tempo', 'easy', 'steady', 'rep', 'recovery',
]);
const HR_ZONES = new Set<NonNullable<Target['hr_zone']>>([
  'easy', 'steady', 'threshold', 'interval', 'rep',
]);

/** Convert raw (possibly fat/nullable) structure JSON into a clean Segment[]. */
export function normalizeStructure(raw: unknown): WorkoutStructure {
  if (!Array.isArray(raw)) return [];
  const out: Segment[] = [];
  for (const item of raw) {
    const seg = normalizeSegment(item);
    if (seg) out.push(seg);
  }
  return out;
}

function normalizeSegment(item: unknown): Segment | null {
  if (!isRecord(item)) return null;
  const kind = item.kind;
  if (typeof kind !== 'string') return null;

  if (kind === 'repeat') {
    const children = normalizeLeaves(item.children);
    if (children.length === 0) return null;
    const sets = positiveInt(item.sets) ?? 1;
    const note = cleanText(item.note);
    const repeat: RepeatSegment = { kind: 'repeat', sets, children };
    if (note) repeat.note = note;
    return repeat;
  }

  return normalizeLeaf(item);
}

/** Normalize an array of children into clean leaf segments (no nested repeats). */
function normalizeLeaves(raw: unknown): LeafSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: LeafSegment[] = [];
  for (const item of raw) {
    const leaf = normalizeLeaf(item);
    if (leaf) out.push(leaf);
  }
  return out;
}

function normalizeLeaf(item: unknown): LeafSegment | null {
  if (!isRecord(item)) return null;
  const kind = item.kind;
  if (typeof kind !== 'string' || !LEAF_KINDS.has(kind as LeafSegment['kind'])) return null;
  const target = cleanTarget(item.target);
  if (!target) return null;
  const leaf: LeafSegment = { kind: kind as LeafSegment['kind'], target };
  const note = cleanText(item.note);
  if (note) leaf.note = note;
  return leaf;
}

/**
 * Clean a wire Target: drop null/invalid fields, keep real measurements, and
 * ensure `by` is present (inferred from which axes exist when omitted).
 * Returns null when nothing usable remains.
 */
function cleanTarget(raw: unknown): Target | null {
  if (!isRecord(raw)) return null;
  const target: Target = { by: [] };

  const distance_m = positiveNum(raw.distance_m);
  if (distance_m != null) target.distance_m = distance_m;
  const duration_s = positiveNum(raw.duration_s);
  if (duration_s != null) target.duration_s = duration_s;
  const pace = cleanPace(raw.pace);
  if (pace) target.pace = pace;
  if (typeof raw.hr_zone === 'string' && HR_ZONES.has(raw.hr_zone as NonNullable<Target['hr_zone']>)) {
    target.hr_zone = raw.hr_zone as Target['hr_zone'];
  }
  const effort = cleanText(raw.effort);
  if (effort) target.effort = effort;
  const note = cleanText(raw.note);
  if (note) target.note = note;

  const by = cleanBy(raw.by);
  target.by = by.length > 0 ? by : inferBy(target);

  // A target with no axis at all carries no information — discard it.
  if (target.by.length === 0) return null;
  return target;
}

function cleanBy(raw: unknown): TargetBy[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out: TargetBy[] = [];
  for (const v of values) {
    if (typeof v === 'string' && TARGET_BY.has(v as TargetBy) && !out.includes(v as TargetBy)) {
      out.push(v as TargetBy);
    }
  }
  return out;
}

function inferBy(target: Target): TargetBy[] {
  const by: TargetBy[] = [];
  if (target.distance_m != null) by.push('distance');
  if (target.duration_s != null) by.push('time');
  if (
    target.pace != null
  ) {
    by.push('pace');
  }
  if (target.hr_zone != null) by.push('hr');
  if (target.effort != null) by.push('effort');
  return by;
}

function cleanPace(raw: unknown): PacePrescription | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null;
  if (raw.kind === 'relative') {
    if (typeof raw.reference !== 'string' || !PACE_LABELS.has(raw.reference as PaceLabel)) return null;
    const speedFraction = positiveNum(raw.speed_fraction);
    if (speedFraction == null || speedFraction < 0.5 || speedFraction > 1.5) return null;
    const resolved = cleanPaceBand(raw.resolved);
    return {
      kind: 'relative',
      reference: raw.reference as PaceLabel,
      speed_fraction: speedFraction,
      ...(resolved ? { resolved } : {}),
    };
  }
  if (raw.kind === 'absolute') {
    const band = cleanPaceBand(raw.band);
    if (!band) return null;
    const intent =
      typeof raw.intent === 'string' && PACE_LABELS.has(raw.intent as PaceLabel)
        ? raw.intent as PaceLabel
        : null;
    return {
      kind: 'absolute',
      band,
      ...(intent ? { intent } : {}),
    };
  }
  return null;
}

function cleanPaceBand(raw: unknown): PaceBand | null {
  if (!isRecord(raw)) return null;
  const fast = positiveNum(raw.fast_s_per_km);
  const slow = positiveNum(raw.slow_s_per_km);
  if (fast == null || slow == null) return null;
  return {
    fast_s_per_km: Math.min(fast, slow),
    slow_s_per_km: Math.max(fast, slow),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveInt(value: unknown): number | null {
  const n = positiveNum(value);
  return n == null ? null : Math.round(n);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
