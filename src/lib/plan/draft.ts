import {
  METERS_PER_MILE,
} from '../units';
import {
  weekStartOf,
} from '../time/week';
import {
  parseWorkoutDescription,
} from '../workout/parse';
import {
  normalizeStructure,
} from './normalizeStructure';
import {
  deriveSupportingContractTargets,
} from './supportingContracts';
import type { WorkoutStructure } from '../workout/types';

export type DraftPlanSource = 'import' | 'generated' | 'conversation' | 'starter';
export type DraftPlanDistanceKind = 'marathon' | 'half' | '10k' | '5k' | 'custom';
export type DraftPlanPhase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';
export type DraftWorkoutType = 'easy' | 'long' | 'quality' | 'rest' | 'cross' | 'race';

export interface DraftPlanMeta {
  raceName: string;
  raceDate: string | null;
  distanceKind: DraftPlanDistanceKind;
  raceDistanceMeters: number | null;
  goalTimeSeconds: number | null;
  startDate: string;
  numWeeks: number;
  createdVia: DraftPlanSource;
}

export interface DraftWeek {
  weekIndex: number;
  weekStart: string;
  phase: DraftPlanPhase;
  targetMeters: number | null;
  targetLowMeters?: number | null;
  targetHighMeters?: number | null;
  originalTargetMeters: number | null;
  /** Immutable prescribed hard-work distance for this weekly contract. */
  qualityTargetMeters: number | null;
  /** Immutable prescribed distance of the week's continuous long run/race. */
  longTargetMeters: number | null;
  isRecovery: boolean;
}

export interface DraftWorkout {
  weekIndex: number;
  date: string;
  type: DraftWorkoutType;
  title: string;
  plannedDistanceMeters: number | null;
  plannedDurationSeconds: number | null;
  structure: WorkoutStructure;
  notes: string | null;
  isQuality: boolean;
  sourceText?: string | null;
}

export interface ImportedPlanDraft {
  source: DraftPlanSource;
  plan: DraftPlanMeta;
  weeks: DraftWeek[];
  workouts: DraftWorkout[];
  warnings: string[];
  questions: string[];
}

export interface RawPlanDraft {
  source?: DraftPlanSource;
  plan?: Partial<DraftPlanMeta> & {
    goalTime?: string | number | null;
    raceDistanceMiles?: number | null;
  };
  weeks?: Array<Partial<DraftWeek>>;
  workouts?: Array<Partial<DraftWorkout> & {
    distanceMiles?: number | null;
    durationMinutes?: number | null;
    originalText?: string | null;
  }>;
  warnings?: string[];
  questions?: string[];
}

export const VALID_TYPES = new Set<DraftWorkoutType>(['easy', 'long', 'quality', 'rest', 'cross', 'race']);
export const VALID_PHASES = new Set<DraftPlanPhase>(['base', 'build', 'peak', 'taper', 'recovery']);
export const VALID_DISTANCE_KINDS = new Set<DraftPlanDistanceKind>(['marathon', 'half', '10k', '5k', 'custom']);
const VALID_SOURCES = new Set<DraftPlanSource>(['import', 'generated', 'conversation', 'starter']);
const MAX_PLAN_WEEKS = 53;

export function normalizePlanDraft(raw: RawPlanDraft): ImportedPlanDraft {
  const warnings = [...cleanStrings(raw.warnings)];
  const source = normalizeSource(raw.source ?? raw.plan?.createdVia);
  const providedStartDate = normalizeDate(raw.plan?.startDate);
  const workouts = normalizeWorkouts(raw.workouts ?? [], warnings, providedStartDate);
  const startDate = providedStartDate ?? inferStartDate(workouts) ?? todayIso();
  const weeks = normalizeWeeks(raw.weeks ?? [], workouts, startDate, warnings);
  const requestedNumWeeks = positiveInt(raw.plan?.numWeeks) ?? (weeks.length || maxWorkoutWeek(workouts) || 1);
  const numWeeks = Math.min(requestedNumWeeks, MAX_PLAN_WEEKS);
  if (requestedNumWeeks > MAX_PLAN_WEEKS) {
    warnings.push(`Capped plan length at ${MAX_PLAN_WEEKS} weeks (requested ${requestedNumWeeks}).`);
  }
  const raceName = cleanText(raw.plan?.raceName) ?? defaultRaceName(raw.plan?.distanceKind);
  const distanceKind = normalizeDistanceKind(raw.plan?.distanceKind);
  const raceDistanceMeters =
    positiveInt(raw.plan?.raceDistanceMeters) ??
    (typeof raw.plan?.raceDistanceMiles === 'number' ? Math.round(raw.plan.raceDistanceMiles * METERS_PER_MILE) : null) ??
    defaultRaceDistance(distanceKind);
  const goalTimeSeconds =
    positiveInt(raw.plan?.goalTimeSeconds) ??
    (typeof raw.plan?.goalTime === 'number' ? positiveInt(raw.plan.goalTime) : parseGoalTime(raw.plan?.goalTime));

  if (workouts.length === 0) warnings.push('No dated workouts were found in the plan text.');

  return {
    source,
    plan: {
      raceName,
      raceDate: normalizeDate(raw.plan?.raceDate) ?? null,
      distanceKind,
      raceDistanceMeters,
      goalTimeSeconds,
      startDate,
      numWeeks,
      createdVia: source,
    },
    weeks: captureSupportingContracts(
      fillMissingWeeks(weeks, numWeeks, startDate),
      workouts,
    ),
    workouts,
    warnings: [...new Set(warnings)],
    questions: cleanStrings(raw.questions),
  };
}


const MAX_NOTE_CHARS = 280; // defensive cap; the import prompt asks for ~200

/** A workout's optional coaching note, trimmed and length-capped for display. */
function clampNote(s: string | null): string | null {
  if (!s) return null;
  return s.length <= MAX_NOTE_CHARS ? s : `${s.slice(0, MAX_NOTE_CHARS - 1).trimEnd()}…`;
}

function normalizeWorkouts(
  rows: NonNullable<RawPlanDraft['workouts']>,
  warnings: string[],
  planStartDate: string | null,
): DraftWorkout[] {
  const out: DraftWorkout[] = [];
  for (const row of rows) {
    const date = normalizeDate(row.date);
    if (!date) {
      if (row.title || row.originalText) warnings.push(`Skipped workout without a date: ${row.title ?? row.originalText}`);
      continue;
    }
    const plannedDistanceMeters =
      positiveInt(row.plannedDistanceMeters) ??
      (typeof row.distanceMiles === 'number' ? Math.round(row.distanceMiles * METERS_PER_MILE) : null);
    const plannedDurationSeconds =
      positiveInt(row.plannedDurationSeconds) ??
      (typeof row.durationMinutes === 'number' ? Math.round(row.durationMinutes * 60) : null);
    const sourceText = cleanText(row.sourceText) ?? cleanText(row.originalText) ?? null;
    const title = cleanText(row.title) ?? sourceText ?? 'Workout';
    const type = normalizeWorkoutType(row.type, title);
    const aiStructure = normalizeStructure(row.structure);
    const structure = aiStructure.length > 0
      ? aiStructure
      : parseWorkoutDescription(sourceText ?? title, plannedDistanceMeters ?? undefined);
    out.push({
      weekIndex: positiveInt(row.weekIndex) ?? 0,
      date,
      type,
      title,
      plannedDistanceMeters,
      plannedDurationSeconds,
      structure,
      notes: clampNote(cleanText(row.notes) ?? null),
      isQuality: Boolean(row.isQuality) || type === 'quality' || type === 'race' || structureLooksQuality(structure),
      sourceText,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  const firstWeek = planStartDate
    ? weekStartOf(planStartDate, 'mon')
    : out.length > 0
      ? weekStartOf(out[0]!.date, 'mon')
      : null;
  for (const workout of out) {
    if (firstWeek) {
      workout.weekIndex = weeksBetween(firstWeek, weekStartOf(workout.date, 'mon')) + 1;
    }
  }
  return out;
}

function normalizeWeeks(
  rows: NonNullable<RawPlanDraft['weeks']>,
  workouts: DraftWorkout[],
  startDate: string,
  warnings: string[],
): DraftWeek[] {
  const byIndex = new Map<number, DraftWeek>();
  for (const row of rows) {
    const weekIndex = positiveInt(row.weekIndex);
    if (!weekIndex) continue;
    const expectedWeekStart = dateAddDays(startDate, (weekIndex - 1) * 7);
    const parsedWeekStart = normalizeDate(row.weekStart);
    if (parsedWeekStart && parsedWeekStart !== expectedWeekStart) {
      warnings.push(`Adjusted week ${weekIndex} start from ${parsedWeekStart} to ${expectedWeekStart}.`);
    }
    const phase = normalizePhase(row.phase);
    byIndex.set(weekIndex, {
      weekIndex,
      weekStart: expectedWeekStart,
      phase,
      targetMeters: positiveInt(row.targetMeters),
      targetLowMeters: positiveInt(row.targetLowMeters),
      targetHighMeters: positiveInt(row.targetHighMeters),
      originalTargetMeters: positiveInt(row.originalTargetMeters) ?? positiveInt(row.targetMeters),
      qualityTargetMeters: nonNegativeInt(row.qualityTargetMeters),
      longTargetMeters: nonNegativeInt(row.longTargetMeters),
      isRecovery: Boolean(row.isRecovery) || phase === 'recovery',
    });
  }
  for (const workout of workouts) {
    const weekIndex = workout.weekIndex;
    const existing = byIndex.get(weekIndex);
    if (existing) continue;
    byIndex.set(weekIndex, {
      weekIndex,
      weekStart: dateAddDays(startDate, (weekIndex - 1) * 7),
      phase: 'build',
      targetMeters: null,
      originalTargetMeters: null,
      qualityTargetMeters: null,
      longTargetMeters: null,
      isRecovery: false,
    });
  }
  const out = [...byIndex.values()].sort((a, b) => a.weekIndex - b.weekIndex);
  for (const week of out) {
    const total = workouts
      .filter((w) => w.weekIndex === week.weekIndex)
      .reduce((sum, w) => sum + (w.plannedDistanceMeters ?? 0), 0);
    if (week.targetMeters == null) {
      // No stated target — the weekly number is just the sum of the days.
      if (total > 0) week.targetMeters = total;
    } else if (total > week.targetMeters * 1.1) {
      // A stated target is the week's headline and CAN exceed the listed days
      // (the rest is easy fill — a week is judged on total weekly mileage, not on
      // running exactly the listed sessions). The only contradiction worth a flag
      // is named workouts that ADD UP TO MORE than the stated weekly total.
      const tMi = Math.round(week.targetMeters / METERS_PER_MILE);
      const sMi = Math.round(total / METERS_PER_MILE);
      warnings.push(`Week ${week.weekIndex}: the listed workouts add up to ${sMi} mi but the weekly target is only ${tMi} mi.`);
    }
    if (week.originalTargetMeters == null) week.originalTargetMeters = week.targetMeters;
  }
  if (out.length === 0) warnings.push('No plan weeks were found; Due will create week rows from the dated workouts.');
  return out;
}

function fillMissingWeeks(weeks: DraftWeek[], numWeeks: number, startDate: string): DraftWeek[] {
  const byIndex = new Map(weeks.map((w) => [w.weekIndex, w]));
  for (let weekIndex = 1; weekIndex <= numWeeks; weekIndex += 1) {
    if (byIndex.has(weekIndex)) continue;
    byIndex.set(weekIndex, {
      weekIndex,
      weekStart: dateAddDays(startDate, (weekIndex - 1) * 7),
      phase: 'build',
      targetMeters: null,
      originalTargetMeters: null,
      qualityTargetMeters: null,
      longTargetMeters: null,
      isRecovery: false,
    });
  }
  return [...byIndex.values()].sort((a, b) => a.weekIndex - b.weekIndex);
}

/**
 * Freeze supporting goals at import/generation time. Explicit values win so a
 * `.due` export round-trips the original contract even after its allocation was
 * reshaped; older files derive them once from their original workouts.
 */
function captureSupportingContracts(
  weeks: DraftWeek[],
  workouts: DraftWorkout[],
): DraftWeek[] {
  return weeks.map((week) => {
    const targets = deriveSupportingContractTargets(
      workouts
        .filter((workout) => workout.weekIndex === week.weekIndex)
        .map((workout) => ({
          type: workout.type,
          isQuality: workout.isQuality,
          plannedDistanceMeters: workout.plannedDistanceMeters,
          structure: workout.structure,
        })),
    );
    return {
      ...week,
      qualityTargetMeters: week.qualityTargetMeters ?? targets.qualityTargetMeters,
      longTargetMeters: week.longTargetMeters ?? targets.longTargetMeters,
    };
  });
}

function structureLooksQuality(structure: WorkoutStructure): boolean {
  return structure.some((segment) => {
    if (segment.kind === 'repeat') return true;
    return segment.kind === 'interval' || segment.target.hr_zone === 'threshold' || segment.target.hr_zone === 'interval';
  });
}

function normalizeWorkoutType(value: unknown, title: string): DraftWorkoutType {
  if (typeof value === 'string' && VALID_TYPES.has(value as DraftWorkoutType)) return value as DraftWorkoutType;
  const lower = title.toLowerCase();
  if (lower.includes('race')) return 'race';
  if (lower.includes('rest')) return 'rest';
  if (lower.includes('cross') || lower.includes('bike') || lower.includes('swim')) return 'cross';
  if (lower.includes('long')) return 'long';
  if (lower.includes('interval') || lower.includes('threshold') || lower.includes('tempo') || lower.includes('workout')) {
    return 'quality';
  }
  return 'easy';
}

function normalizePhase(value: unknown): DraftPlanPhase {
  return typeof value === 'string' && VALID_PHASES.has(value as DraftPlanPhase) ? value as DraftPlanPhase : 'build';
}

function normalizeDistanceKind(value: unknown): DraftPlanDistanceKind {
  return typeof value === 'string' && VALID_DISTANCE_KINDS.has(value as DraftPlanDistanceKind)
    ? value as DraftPlanDistanceKind
    : 'custom';
}

function normalizeSource(value: unknown): DraftPlanSource {
  return typeof value === 'string' && VALID_SOURCES.has(value as DraftPlanSource) ? value as DraftPlanSource : 'import';
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return validIsoDate(trimmed) ? trimmed : null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString().slice(0, 10);
  return validIsoDate(iso) ? iso : null;
}

function parseGoalTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 3600 + parts[1]! * 60;
  return null;
}

function inferStartDate(workouts: DraftWorkout[]): string | null {
  if (workouts.length === 0) return null;
  return weekStartOf(workouts[0]!.date, 'mon');
}

function maxWorkoutWeek(workouts: DraftWorkout[]): number {
  return workouts.reduce((max, w) => Math.max(max, w.weekIndex), 0);
}

function defaultRaceName(kind: unknown): string {
  if (kind === 'marathon') return 'Marathon';
  if (kind === 'half') return 'Half marathon';
  if (kind === '10k') return '10K';
  if (kind === '5k') return '5K';
  return 'Training block';
}

function defaultRaceDistance(kind: DraftPlanDistanceKind): number | null {
  if (kind === 'marathon') return 42195;
  if (kind === 'half') return 21097;
  if (kind === '10k') return 10000;
  if (kind === '5k') return 5000;
  return null;
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function validIsoDate(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function cleanStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map(cleanText).filter((v): v is string => !!v) : [];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  return Math.round((b - a) / (7 * 86400 * 1000));
}
