/**
 * structureBar.ts — turn a plan WorkoutStructure into a glanceable shape, and
 * estimate how long it takes.
 *
 * Pure. No IO. Node-tested. The Dash "Today" cell draws the structure instead
 * of describing it: width = distance, colour = effort. The same primitive
 * (a flat list of {kind, meters}) renders any session — easy, long, threshold,
 * repeats, fartlek — so there is no per-type copy to write or break.
 */
import type { LeafSegment, PaceLabel, Segment, WorkoutStructure } from './types';
import {
  actionablePaceBand,
  paceIntent,
  relativePaceLabel,
} from './pace';
import {
  resolveTargetPace,
  type RacePaces,
} from '../kpi/targetPace';
import {
  formatPace,
  METERS_PER_MILE,
  type Units,
} from '../units';

/** Coarse role a bar segment paints as. */
export type BarKind = 'wu' | 'cd' | 'rest' | 'work' | 'steady';

export interface BarSeg {
  kind: BarKind;
  /** Relative weight for the bar; metres (real, or estimated from a duration). */
  meters: number;
}

/** Visual/colour family for a whole session — drives the secondary-colour system. */
export type WorkoutTone = 'easy' | 'long' | 'quality' | 'speed';

const KIND_TO_BAR: Record<Exclude<Segment['kind'], 'repeat'>, BarKind> = {
  warmup: 'wu',
  cooldown: 'cd',
  recovery: 'rest',
  steady: 'steady',
  work: 'work',
  interval: 'work',
  strides: 'work',
};

const QUALITY_BAR_LABELS = new Set<PaceLabel>([
  'MP', 'HMP', 'threshold', 'tempo', '10K', '5K', '3K', 'mile', 'rep',
]);

/** A continuous MP/tempo block is still hard work even when its schema kind is
 * `steady`. An explicit easy zone remains authoritative (some imported easy
 * legs carry MP as a reference pace rather than a target). */
function barKind(seg: LeafSegment): BarKind {
  const intent = paceIntent(seg.target.pace);
  if (
    seg.kind === 'steady'
    && seg.target.hr_zone !== 'easy'
    && intent != null
    && QUALITY_BAR_LABELS.has(intent)
  ) return 'work';
  return KIND_TO_BAR[seg.kind];
}

/** Nominal speed (m/s) to size a duration-only segment in the bar. */
function nominalSpeed(kind: LeafSegment['kind']): number {
  return kind === 'work' || kind === 'interval' || kind === 'strides' ? 4.3 : 2.8;
}

function leafMeters(seg: LeafSegment): number {
  if (seg.target.distance_m != null) return seg.target.distance_m;
  if (seg.target.duration_s != null) return seg.target.duration_s * nominalSpeed(seg.kind);
  return 0;
}

/** Walk every leaf in document order, expanding repeats sets×children. */
function eachLeaf(structure: WorkoutStructure, visit: (seg: LeafSegment) => void): void {
  const walk = (segs: Segment[], reps: number): void => {
    for (let r = 0; r < reps; r++) {
      for (const s of segs) {
        if (s.kind === 'repeat') walk(s.children, s.sets);
        else visit(s);
      }
    }
  };
  walk(structure, 1);
}

/** Flatten a structure to an ordered list of paintable bar segments. */
export function structureBarSegments(structure: WorkoutStructure): BarSeg[] {
  const out: BarSeg[] = [];
  eachLeaf(structure, (s) => {
    const meters = leafMeters(s);
    if (meters > 0) out.push({ kind: barKind(s), meters });
  });
  return out;
}

/** sec/mi a leaf runs at, relative to the runner's easy baseline, when no
 *  concrete pace is on the target. Faster work pulls below easy; jogs sit at it. */
const LABEL_OFFSET: Record<PaceLabel, number> = {
  MP: 40, HMP: 65, threshold: 70, tempo: 65,
  ['10K']: 90, ['5K']: 110, ['3K']: 125, mile: 140, rep: 120,
  easy: 0, steady: 0, recovery: 0,
};

function fallbackPaceSecPerMi(seg: LeafSegment, easyBaselineSecPerMi: number): number {
  let offset = 0;
  const intent = paceIntent(seg.target.pace);
  if (intent) offset = LABEL_OFFSET[intent] ?? 0;
  else if (seg.kind === 'work' || seg.kind === 'interval' || seg.kind === 'strides') offset = 90;
  // Don't let an estimate dip below a hard physiological floor (~4:30/mi).
  return Math.max(270, easyBaselineSecPerMi - offset);
}

/**
 * Estimate total moving time (seconds) for a planned session. Uses an explicit
 * duration when given, else distance × pace — concrete pace when the target
 * carries one (or `paces` resolves a label), otherwise an easy-baseline offset.
 */
export function estimatePlannedDurationSec(
  structure: WorkoutStructure,
  easyBaselineSecPerMi: number,
  paces: RacePaces | null = null,
): number {
  let sec = 0;
  eachLeaf(structure, (s) => {
    if (s.target.duration_s != null) {
      sec += s.target.duration_s;
      return;
    }
    const meters = s.target.distance_m ?? 0;
    if (meters <= 0) return;
    const miles = meters / METERS_PER_MILE;
    const pace = resolveTargetPace(s.target, paces) ?? fallbackPaceSecPerMi(s, easyBaselineSecPerMi);
    sec += miles * pace;
  });
  return sec;
}

/**
 * Distance (meters) the structure explicitly accounts for. Distance leaves count
 * directly; duration leaves are converted to distance at their resolved pace, so
 * a "5×3min @ threshold" rep still consumes its share of the planned mileage.
 */
function structureDistanceMeters(
  structure: WorkoutStructure,
  easyBaselineSecPerMi: number,
  paces: RacePaces | null,
): number {
  let meters = 0;
  eachLeaf(structure, (s) => {
    if (s.target.distance_m != null) {
      meters += s.target.distance_m;
      return;
    }
    if (s.target.duration_s != null) {
      const pace = resolveTargetPace(s.target, paces) ?? fallbackPaceSecPerMi(s, easyBaselineSecPerMi);
      if (pace > 0) meters += (s.target.duration_s / pace) * METERS_PER_MILE;
    }
  });
  return meters;
}

/**
 * Planned distance represented by a structure, estimating time-only leaves at
 * their prescribed pace. Manual workout creation uses this for the week's
 * mileage contract: a strides session must not count only its warm-up because
 * its faster, time-based reps happen not to carry `distance_m`.
 */
export function estimatedStructureDistanceMeters(
  structure: WorkoutStructure,
  easyBaselineSecPerMi: number,
  paces: RacePaces | null = null,
): number {
  return structureDistanceMeters(structure, easyBaselineSecPerMi, paces);
}

/**
 * Estimate total moving time for a WHOLE planned workout (seconds): the
 * structured portion plus any planned distance the structure doesn't cover, run
 * at the easy baseline. A 9 mi quality day with a 5.5 mi warm-up/reps/cool-down
 * structure is ~9 mi of time, not ~5.5 mi — the ~3.5 mi of easy filler counts.
 * Falls back to a plain distance×easy estimate when there's no structure.
 */
export function estimateWorkoutDurationSec(
  structure: WorkoutStructure,
  plannedMeters: number,
  easyBaselineSecPerMi: number,
  paces: RacePaces | null = null,
): number {
  const structSec = estimatePlannedDurationSec(structure, easyBaselineSecPerMi, paces);
  const structMeters = structureDistanceMeters(structure, easyBaselineSecPerMi, paces);
  const fillerMeters = Math.max(0, (plannedMeters || 0) - structMeters);
  const fillerSec = (fillerMeters / METERS_PER_MILE) * easyBaselineSecPerMi;
  return structSec + fillerSec;
}

/** "~52m" under an hour, "~1h05m" over. A glance, hence the tilde + rounding. */
export function formatDurationApprox(sec: number): string {
  const mins = Math.round(sec / 60);
  if (mins < 60) return `~${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `~${h}h${String(m).padStart(2, '0')}m`;
}

const FAST_LABELS = new Set<PaceLabel>(['5K', '3K', 'mile', 'rep', '10K']);

/**
 * Classify a session into a colour family for the secondary-colour system.
 * Non-quality: a "long" type reads long (blue), everything else easy (neutral).
 * Quality: a session with short fast reps reads speed (pink); threshold/tempo
 * and the rest read quality (amber).
 */
export function workoutTone(w: {
  type: string | null;
  is_quality: boolean;
  structure: WorkoutStructure;
}): WorkoutTone {
  if (!w.is_quality) {
    return (w.type ?? '').toLowerCase().includes('long') ? 'long' : 'easy';
  }
  if (/interval|speed|vo2|track|rep/.test((w.type ?? '').toLowerCase())) return 'speed';
  let speed = false;
  eachLeaf(w.structure, (s) => {
    const intent = paceIntent(s.target.pace);
    if (intent && FAST_LABELS.has(intent)) speed = true;
  });
  return speed ? 'speed' : 'quality';
}

/** The dominant work pace label, lowercased, for the type sub-label (or null). */
export function dominantWorkLabel(structure: WorkoutStructure): string | null {
  let label: PaceLabel | null = null;
  eachLeaf(structure, (s) => {
    if (label) return;
    const intent = paceIntent(s.target.pace);
    if ((s.kind === 'work' || s.kind === 'interval' || s.kind === 'strides') && intent) {
      label = intent;
    }
  });
  return label ? String(label).toLowerCase() : null;
}

/**
 * A workout's headline intensity for a quick glance (chip on a plan/review row):
 * the hardest prescribed pace / effort / HR across the structure — work, interval,
 * strides or steady segments preferred, else any segment. Returns e.g. "MP",
 * "5K", "threshold", "easy", or null when nothing is prescribed.
 */
export function workoutIntensityLabel(structure: WorkoutStructure | null | undefined): string | null {
  if (!structure || structure.length === 0) return null;
  let primary: string | null = null;
  let fallback: string | null = null;
  eachLeaf(structure, (s) => {
    const word = paceWord(s.target, 'mi');
    if (!word) return;
    if (s.kind === 'work' || s.kind === 'interval' || s.kind === 'strides' || s.kind === 'steady') {
      if (!primary) primary = word;
    } else if (!fallback) {
      fallback = word;
    }
  });
  const label = primary ?? fallback;
  if (!label) return null;
  // "easy"/"recovery" just restate the baseline (and the type dot already says
  // it) — only surface a notable prescription (MP, 5K, threshold, tempo, …).
  const text = String(label);
  return text.toLowerCase() === 'easy' || text.toLowerCase() === 'recovery' ? null : text;
}

// ── Readable prescription lines (the Runna-style step list, condensed) ─────────

/** One step of a workout's prescription, for the Today card's expanded view. */
export interface StructureLine {
  /** e.g. "Warm-up — 2 mi easy", "6 × 800 m @ 5K, 400 m jog", "Cool-down — 1 mi". */
  text: string;
  /** The hard work (emphasised); warm-up / cool-down / recovery are not. */
  strong: boolean;
}

const ROLE_WORD: Partial<Record<LeafSegment['kind'], string>> = {
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
};

/** Distance ("800 m" / "2 mi") or duration ("90s" / "5 min" / "1:30") from a target. */
function amountText(t: LeafSegment['target'], units: Units): string | null {
  if (t.distance_m != null) {
    if (t.distance_m < 1600) return `${Math.round(t.distance_m)} m`;
    if (units === 'km') {
      const km = Math.round((t.distance_m / 1000) * 10) / 10;
      return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
    }
    const mi = Math.round((t.distance_m / METERS_PER_MILE) * 10) / 10;
    return `${Number.isInteger(mi) ? mi.toFixed(0) : mi.toFixed(1)} mi`;
  }
  if (t.duration_s != null) {
    const s = t.duration_s;
    if (s < 60) return `${s}s`;
    if (s % 60 === 0) return `${s / 60} min`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return null;
}

/** Named pace / effort / HR zone for a target (e.g. "5K", "threshold", "easy"). */
/**
 * The primary work leaf's pace band alone, compactly — "7:02–7:18 /mi" — or
 * null when the prescription has no numeric band.
 *
 * Split out of `workoutIntensityLabel` because that label concatenates band
 * and intent into one string ("7:02/MI–7:18/MI · THRESHOLD"), and every row
 * that rendered it in a chip lost the space contest against it — the plan
 * preview compressed the workout NAME to "T…" so this chip could win. Rows
 * want the intent as a short word (`workoutIntentLabel`) and the band as a
 * quiet second line, not one long chip.
 */
export function workoutPaceBandLabel(structure: WorkoutStructure | null | undefined, units: Units): string | null {
  if (!structure || structure.length === 0) return null;
  let band: { fast_s_per_km: number; slow_s_per_km: number } | null = null;
  eachLeaf(structure, (s) => {
    if (band) return;
    if (s.kind === 'work' || s.kind === 'interval' || s.kind === 'strides' || s.kind === 'steady') {
      band = actionablePaceBand(s.target.pace);
    }
  });
  if (!band) return null;
  const b: { fast_s_per_km: number; slow_s_per_km: number } = band;
  const fast = formatPace(b.fast_s_per_km, units);
  if (b.fast_s_per_km === b.slow_s_per_km) return fast;
  // One unit suffix for the pair — "7:02–7:18 /mi", not "7:02/mi–7:18/mi".
  const strip = (v: string) => v.slice(0, v.lastIndexOf('/'));
  return `${strip(fast)}–${strip(formatPace(b.slow_s_per_km, units))} /${units}`;
}

/**
 * The intent WORD alone ("threshold", "MP", "5K") — what the intensity chip
 * should carry. Same easy/recovery suppression as `workoutIntensityLabel`.
 */
export function workoutIntentLabel(structure: WorkoutStructure | null | undefined): string | null {
  if (!structure || structure.length === 0) return null;
  let intent: string | null = null;
  eachLeaf(structure, (s) => {
    if (intent) return;
    if (s.kind === 'work' || s.kind === 'interval' || s.kind === 'strides' || s.kind === 'steady') {
      const word = paceIntent(s.target.pace) ?? s.target.effort ?? null;
      if (word) intent = String(word);
    }
  });
  if (!intent) return null;
  const t = String(intent);
  return t.toLowerCase() === 'easy' || t.toLowerCase() === 'recovery' ? null : t;
}

function paceWord(t: LeafSegment['target'], units: Units): string | null {
  const band = actionablePaceBand(t.pace);
  const bandText = band
    ? band.fast_s_per_km === band.slow_s_per_km
      ? formatPace(band.fast_s_per_km, units)
      : `${formatPace(band.fast_s_per_km, units)}–${formatPace(band.slow_s_per_km, units)}`
    : null;
  if (t.hr_zone === 'easy') return [bandText, 'easy'].filter(Boolean).join(' ');
  if (t.pace?.kind === 'relative') {
    return [bandText, relativePaceLabel(t.pace)].filter(Boolean).join(' · ');
  }
  const intent = paceIntent(t.pace);
  if (bandText) return [bandText, intent].filter(Boolean).join(' · ');
  if (intent) return String(intent);
  if (t.effort) return t.effort;
  if (t.hr_zone) return t.hr_zone;
  return null;
}

function isWork(kind: LeafSegment['kind']): boolean {
  return kind === 'work' || kind === 'steady' || kind === 'interval' || kind === 'strides';
}

/** A leaf inside a repeat: "800 m @ 5K" or "400 m jog". */
function childText(seg: Segment, units: Units): string {
  if (seg.kind === 'repeat') return ''; // nested repeats are rare; skip
  const a = amountText(seg.target, units);
  const p = paceWord(seg.target, units);
  if (seg.kind === 'recovery') {
    const recoveryWord = p === 'recovery' || p === 'easy' || p == null ? 'jog' : p;
    return [a, recoveryWord].filter(Boolean).join(' ');
  }
  return [a, p ? `@ ${p}` : null].filter(Boolean).join(' ');
}

/**
 * Condense a WorkoutStructure into readable prescription lines — the targets a
 * runner needs to execute the session without opening the full workout. Repeats
 * collapse to "N × …"; warm-up / cool-down get a role word.
 */
export function structureLines(structure: WorkoutStructure, units: Units = 'mi'): StructureLine[] {
  const out: StructureLine[] = [];
  for (const seg of structure) {
    if (seg.kind === 'repeat') {
      const inner = seg.children.map((child) => childText(child, units)).filter(Boolean).join(', ');
      if (inner) out.push({ text: `${seg.sets} × ${inner}`, strong: true });
      continue;
    }
    const a = amountText(seg.target, units);
    const p = paceWord(seg.target, units);
    const role = ROLE_WORD[seg.kind];
    let text: string;
    if (role) text = `${role} — ${[a, p].filter(Boolean).join(' ') || 'easy'}`;
    else text = [a, p ? `@ ${p}` : null].filter(Boolean).join(' ');
    if (text) out.push({ text, strong: isWork(seg.kind) });
  }
  return out;
}
