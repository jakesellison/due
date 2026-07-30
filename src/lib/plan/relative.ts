/**
 * relative.ts — Normalizer for the `.due` v3 "relative" plan format: a dateless
 * training block expressed as (week, day) offsets instead of calendar dates.
 *
 * `normalizeRelativePlan` is the GATE + lenient field normalizer for v3 files.
 * It throws a user-facing `PlanImportError` on anything that isn't a real v3
 * plan (wrong object, wrong formatVersion, bad week range, no workouts) and
 * otherwise fills defaults so the result is a fully populated `RelativePlan`
 * that a later anchoring step can convert into a dated `RawPlanDraft`.
 *
 * Pure. No IO. Node-tested. Defensive against malformed AI output. Private
 * helpers (`isRecord`/`positiveInt`/`cleanText`/`cleanStrings`) are copied from
 * `draft.ts` rather than imported — they are not part of that module's API.
 */

import {
  METERS_PER_MILE,
} from '../units';
import {
  normalizeStructure,
} from './normalizeStructure';
import {
  PlanImportError,
} from './parseImport';
import {
  VALID_TYPES,
  VALID_PHASES,
  VALID_DISTANCE_KINDS,
  type DraftPlanDistanceKind,
  type DraftPlanPhase,
  type DraftPlanSource,
  type DraftWorkoutType,
} from './draft';
import type { WorkoutStructure } from '../workout/types';

export interface RelativeWorkout {
  week: number;              // 1-based
  day: number;               // 0=Mon … 6=Sun
  type: DraftWorkoutType;
  title: string;
  plannedDistanceMeters: number | null;
  plannedDurationSeconds: number | null;
  structure: WorkoutStructure;
  notes: string | null;
}
export interface RelativeWeek {
  week: number;
  phase: DraftPlanPhase;
  targetMeters: number | null;
  qualityTargetMeters: number | null;
  longTargetMeters: number | null;
  isRecovery: boolean;
}
export interface RelativePlanMeta {
  name: string;
  distanceKind: DraftPlanDistanceKind;
  goalTimeSeconds: number | null;
  numWeeks: number;
  minWeeks: number;          // defaulted: max(4, ceil(numWeeks * 2/3))
}
export interface RelativePlan {
  formatVersion: 3;
  source: DraftPlanSource;   // now includes 'starter'
  plan: RelativePlanMeta;
  weeks: RelativeWeek[];     // always filled 1..numWeeks (missing weeks synthesized)
  workouts: RelativeWorkout[];
  questions: string[];
}

const VALID_SOURCES = new Set<DraftPlanSource>(['import', 'generated', 'conversation', 'starter']);
const MAX_PLAN_WEEKS = 53;
const MAX_PLAN_WORKOUTS = 1200; // defensive cap: 53 weeks × ~22 slots
const MAX_NOTE_CHARS = 280; // defensive cap; the import prompt asks for ~200

export function normalizeRelativePlan(raw: unknown): RelativePlan {
  if (!isRecord(raw)) throw new PlanImportError('This is not a Due plan file.');
  if (raw.formatVersion !== 3) {
    throw new PlanImportError(
      'This plan file uses an older Due pace format. Re-export it with the current Due prompt and try again.',
    );
  }
  const planRaw = isRecord(raw.plan) ? raw.plan : {};
  const numWeeks = positiveInt(planRaw.numWeeks);
  if (!numWeeks || numWeeks > MAX_PLAN_WEEKS) {
    throw new PlanImportError(`Plan needs a numWeeks between 1 and ${MAX_PLAN_WEEKS}.`);
  }
  const workouts = normalizeWorkouts(raw.workouts, numWeeks);
  if (workouts.length === 0) throw new PlanImportError('This plan file has no workouts.');
  if (workouts.length > MAX_PLAN_WORKOUTS) throw new PlanImportError('This plan file has too many workouts.');
  const minWeeks = positiveInt(planRaw.minWeeks) ?? Math.max(4, Math.ceil((numWeeks * 2) / 3));
  return {
    formatVersion: 3,
    source: normalizeSource(raw.source),
    plan: {
      name: cleanText(planRaw.name) ?? 'Training block',
      distanceKind: normalizeEnum(planRaw.distanceKind, VALID_DISTANCE_KINDS, 'custom'),
      goalTimeSeconds: positiveInt(planRaw.goalTimeSeconds),
      numWeeks,
      minWeeks: Math.min(minWeeks, numWeeks),
    },
    weeks: fillWeeks(raw.weeks, numWeeks),
    workouts,
    questions: cleanStrings(raw.questions),
  };
}

/** A workout's optional coaching note, trimmed and length-capped for display. */
function clampNote(s: string | null): string | null {
  if (!s) return null;
  return s.length <= MAX_NOTE_CHARS ? s : `${s.slice(0, MAX_NOTE_CHARS - 1).trimEnd()}…`;
}

function normalizeWorkouts(raw: unknown, numWeeks: number): RelativeWorkout[] {
  if (!Array.isArray(raw)) return [];
  const out: RelativeWorkout[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = cleanText(item.title) ?? 'Workout';
    const week = positiveInt(item.week);
    if (!week || week > numWeeks) {
      throw new PlanImportError(`Workout "${title}" has a week outside 1–${numWeeks}.`);
    }
    const day = wholeInt(item.day);
    if (day == null || day < 0 || day > 6) {
      throw new PlanImportError(`Workout "${title}" has a day outside 0–6 (Mon–Sun).`);
    }
    const plannedDistanceMeters =
      positiveInt(item.plannedDistanceMeters) ??
      (typeof item.distanceMiles === 'number' ? Math.round(item.distanceMiles * METERS_PER_MILE) : null);
    const plannedDurationSeconds =
      positiveInt(item.plannedDurationSeconds) ??
      (typeof item.durationMinutes === 'number' ? Math.round(item.durationMinutes * 60) : null);
    out.push({
      week,
      day,
      type: normalizeEnum(item.type, VALID_TYPES, 'easy'),
      title,
      plannedDistanceMeters,
      plannedDurationSeconds,
      structure: normalizeStructure(item.structure),
      notes: clampNote(cleanText(item.notes) ?? null),
    });
  }
  out.sort((a, b) => (a.week - b.week) || (a.day - b.day));
  return out;
}

function fillWeeks(raw: unknown, numWeeks: number): RelativeWeek[] {
  const byWeek = new Map<number, RelativeWeek>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const week = positiveInt(item.week);
      if (!week || week > numWeeks) continue;
      const phase = normalizeEnum(item.phase, VALID_PHASES, 'build');
      byWeek.set(week, {
        week,
        phase,
        targetMeters: positiveInt(item.targetMeters),
        qualityTargetMeters: nonNegativeInt(item.qualityTargetMeters),
        longTargetMeters: nonNegativeInt(item.longTargetMeters),
        isRecovery: Boolean(item.isRecovery) || phase === 'recovery',
      });
    }
  }
  for (let week = 1; week <= numWeeks; week += 1) {
    if (byWeek.has(week)) continue;
    byWeek.set(week, {
      week,
      phase: 'build',
      targetMeters: null,
      qualityTargetMeters: null,
      longTargetMeters: null,
      isRecovery: false,
    });
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

function normalizeSource(value: unknown): DraftPlanSource {
  return typeof value === 'string' && VALID_SOURCES.has(value as DraftPlanSource) ? value as DraftPlanSource : 'import';
}

function normalizeEnum<T extends string>(value: unknown, valid: Set<T>, fallback: T): T {
  return typeof value === 'string' && valid.has(value as T) ? value as T : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function wholeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function cleanStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map(cleanText).filter((v): v is string => !!v) : [];
}
