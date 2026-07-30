// src/lib/plan/weekEdit.ts
import type { WorkoutStructure } from '../workout/types';

export type WorkoutType = 'easy' | 'long' | 'quality' | 'rest' | 'cross';

/**
 * The default title shown for a day of each workout type — the single source of
 * truth used when synthesizing rows (rest placeholders, inserted doubles) and
 * when re-titling a day whose type changes. Keep these in sync with the labels
 * the rest of the app renders for generic, unnamed days.
 */
export const DEFAULT_TITLES: Record<WorkoutType, string> = {
  easy: 'Easy Run',
  long: 'Long Run',
  quality: 'Quality Run',
  rest: 'Rest Day',
  cross: 'Cross-Training',
};

/**
 * Generic, non-custom day labels. If a day's current title is one of these we
 * treat it as an auto-generated type label (not something the user authored) and
 * are free to replace it when the type changes. Anything else is a custom title
 * and is preserved. Includes the canonical defaults plus the historical/variant
 * spellings produced elsewhere in the codebase (plan parser, sample blocks).
 */
const GENERIC_TITLES: ReadonlySet<string> = new Set(
  [
    ...Object.values(DEFAULT_TITLES),
    'Easy', 'Easy run', 'Easy / recovery', 'Recovery', 'Recovery Run', 'Recovery run',
    'Long', 'Long run',
    'Quality', 'Workout', 'Quality run', 'Quality Workout',
    'Run', // null-title rows surface as the 'Run' placeholder; a persisted placeholder must stay retypeable

    'Rest', 'Rest Day', 'Rest day',
    'Cross', 'Cross Training', 'Cross-training', 'Cross train', 'Cross Train',
  ].map((t) => t.toLowerCase()),
);

/**
 * Return the title a day should carry after its type changes to `newType`.
 * Conservative: if the existing title is a recognized generic/default type label
 * it's replaced with the new type's default; a custom, user-authored title is
 * left untouched so we never clobber a name the runner chose.
 */
function titleForRetype(currentTitle: string, newType: WorkoutType): string {
  return GENERIC_TITLES.has(currentTitle.trim().toLowerCase())
    ? DEFAULT_TITLES[newType]
    : currentTitle;
}

/**
 * A single day within the week as seen by the editor. The `id` is the
 * workouts row PK (null for synthetic rest days that have no DB row yet —
 * not used in v1 but kept for type safety). `isInserted` marks PM-run rows
 * that were added by `addDouble` and have no existing DB id.
 */
export interface EditableDay {
  /** workouts.id — null for a new (inserted) PM run before save. */
  id: string | null;
  /** Civil date 'YYYY-MM-DD' within the week. */
  date: string;
  type: WorkoutType;
  title: string;
  plannedDistanceMeters: number;
  /** Planned duration for time-based workouts. `undefined` means preserve the
   *  stored value; `null` explicitly clears it. */
  plannedDurationSeconds?: number | null;
  isQuality: boolean;
  /** True for rows injected by addDouble (no DB id yet). */
  isInserted?: boolean;
  /**
   * Segment structure for an INSERTED workout built in-app (a new quality
   * session from the planner's WorkoutBuilder). Persisted on insert so the reps
   * survive; absent/empty for plain runs. Ignored for existing-row updates.
   */
  structure?: WorkoutStructure;
  /**
   * Stable hard-work distance captured when a structured quality workout is
   * created. Duration-based reps need this snapshot so reopening the week or
   * matching the eventual run does not recalculate their contract at a generic
   * fallback pace. Absent for legacy and non-quality rows.
   */
  /** `null` explicitly clears quality credit when a workout is retyped. */
  prescribedQualityMeters?: number | null;
  /**
   * Actual distance run on this day (meters). Present for settled days so the
   * live total reflects what was ACTUALLY run, not the stale plan. Absent on
   * remaining/future days.
   */
  actualDistanceMeters?: number;
  /**
   * True when the day is settled — it's in the past, or already has an
   * activity logged. Settled days contribute their `actualDistanceMeters` to
   * the total (a missed day = 0); remaining days contribute `plannedDistanceMeters`.
   */
  isCompleted?: boolean;
  /**
   * True if the date is before today. Used by drag-to-reorder: a past planned
   * day that never ran is "missed" (draggable forward), but the past is never a
   * valid drop target.
   */
  isPast?: boolean;
}

/** Change the workout type (and is_quality) of a specific workout. */
export interface SetTypeOp {
  kind: 'setType';
  workoutId: string;
  newType: WorkoutType;
}

/** Change the planned distance (meters) of a specific workout. */
export interface SetDistanceOp {
  kind: 'setDistance';
  workoutId: string;
  newDistanceMeters: number;
}

/** Replace an upcoming workout's editable prescription as one atomic audit
 * event. Moving and editing may occur in the same week save; a separate move
 * op records the calendar change while this captures the workout itself. */
export interface UpdateWorkoutOp {
  kind: 'updateWorkout';
  workoutId: string;
  type: WorkoutType;
  title: string;
  plannedDistanceMeters: number;
  plannedDurationSeconds: number | null;
  isQuality: boolean;
  prescribedQualityMeters: number | null;
  structure: WorkoutStructure;
}

/**
 * Relocate a workout to another date within the week. The vacated date's
 * remaining rows are inspected: if zero non-rest rows remain it becomes rest.
 * Cross-week moves are disallowed (enforced by the UI — the model just moves).
 */
export interface MoveOp {
  kind: 'move';
  workoutId: string;
  toDate: string;
}

/**
 * Insert a second easy run on a given date (a two-a-day). Creates a new
 * EditableDay with isInserted=true, id=null.
 */
export interface AddDoubleOp {
  kind: 'addDouble';
  onDate: string;
  distanceMeters: number;
}

/**
 * Zero out a day: set type=rest, plannedDistanceMeters=0, isQuality=false.
 * For isInserted rows this is equivalent to removal (handled by saveWeekEdits).
 */
export interface SetRestOp {
  kind: 'setRest';
  workoutId: string;
}

/**
 * Exchange the workouts on two dates within the week (a drag-to-reorder swap).
 * Every non-rest row on `dateA` moves to `dateB` and vice versa, so a two-a-day
 * swaps as a group. Moved rows are un-settled (they're rescheduled).
 */
export interface SwapOp {
  kind: 'swap';
  dateA: string;
  dateB: string;
}

export type EditOp = SetTypeOp | SetDistanceOp | UpdateWorkoutOp | MoveOp | AddDoubleOp | SetRestOp | SwapOp;

/**
 * Apply a sequence of edits to a week's days, returning a new array.
 * Pure — no IO, no mutation of the input array.
 *
 * Semantics:
 *  - setType: updates `type`, derives `isQuality` (quality→true, else false), and
 *    re-titles the day to the new type's default IFF the current title is a
 *    recognized generic label (a custom user title is preserved).
 *  - setDistance: updates `plannedDistanceMeters` only — never the title.
 *  - move: changes `date` on the matching row; if the vacated date now has zero
 *    non-rest rows a synthetic rest placeholder is appended.
 *  - addDouble: appends a new `EditableDay` with `isInserted=true, id=null`.
 *  - setRest: sets `type='rest', plannedDistanceMeters=0, isQuality=false` and
 *    re-titles generic labels to the rest default (same rule as setType).
 *
 * Ops are applied left-to-right in order.
 */
export function applyEdits(days: EditableDay[], ops: EditOp[]): EditableDay[] {
  let result: EditableDay[] = days.map((d) => ({ ...d }));

  for (const op of ops) {
    switch (op.kind) {
      case 'setType': {
        result = result.map((d) =>
          d.id === op.workoutId
            ? {
                ...d,
                type: op.newType,
                isQuality: op.newType === 'quality',
                title: titleForRetype(d.title, op.newType),
              }
            : d,
        );
        break;
      }
      case 'setDistance': {
        result = result.map((d) =>
          d.id === op.workoutId
            ? { ...d, plannedDistanceMeters: op.newDistanceMeters }
            : d,
        );
        break;
      }
      case 'updateWorkout': {
        result = result.map((d) =>
          d.id === op.workoutId
            ? {
                ...d,
                type: op.type,
                title: op.title,
                plannedDistanceMeters: op.plannedDistanceMeters,
                plannedDurationSeconds: op.plannedDurationSeconds,
                isQuality: op.isQuality,
                prescribedQualityMeters: op.prescribedQualityMeters,
                structure: op.structure,
              }
            : d,
        );
        break;
      }
      case 'move': {
        // Capture original date before the move.
        const originalDate = days.find((d) => d.id === op.workoutId)?.date
          ?? result.find((d) => d.id === op.workoutId)?.date;

        result = result.map((d) => {
          if (d.id !== op.workoutId) return d;
          // Rescheduling un-settles the row: it's now planned for a new date,
          // not a settled actual at the old one (so its miles re-count).
          return { ...d, date: op.toDate, isCompleted: false, actualDistanceMeters: 0 };
        });

        // Check if the vacated date still has at least one non-rest row.
        if (originalDate) {
          const remaining = result.filter(
            (d) => d.date === originalDate && d.type !== 'rest',
          );
          if (remaining.length === 0) {
            // Append a rest placeholder for the vacated date.
            result = [
              ...result,
              {
                id: null,
                date: originalDate,
                type: 'rest',
                title: DEFAULT_TITLES.rest,
                plannedDistanceMeters: 0,
                isQuality: false,
                isInserted: true,
              },
            ];
          }
        }
        break;
      }
      case 'addDouble': {
        result = [
          ...result,
          {
            id: null,
            date: op.onDate,
            type: 'easy',
            title: DEFAULT_TITLES.easy,
            plannedDistanceMeters: op.distanceMeters,
            isQuality: false,
            isInserted: true,
          },
        ];
        break;
      }
      case 'setRest': {
        // setRest changes the type too, so the same retitle rule applies: a
        // generic label becomes the rest default, a custom title is preserved.
        result = result.map((d) =>
          d.id === op.workoutId
            ? {
                ...d,
                type: 'rest',
                plannedDistanceMeters: 0,
                isQuality: false,
                title: titleForRetype(d.title, 'rest'),
              }
            : d,
        );
        break;
      }
      case 'swap': {
        // Exchange every row between the two dates (a two-a-day swaps as a
        // group). Swapped rows are un-settled — they've been rescheduled.
        result = result.map((d) => {
          if (d.date === op.dateA) return { ...d, date: op.dateB, isCompleted: false, actualDistanceMeters: 0 };
          if (d.date === op.dateB) return { ...d, date: op.dateA, isCompleted: false, actualDistanceMeters: 0 };
          return d;
        });
        break;
      }
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/** Live KPI summary computed from the current edit state. */
export interface EditSummary {
  /**
   * The week's projected total: settled days count their actual miles (a missed
   * day = 0), remaining days count their planned miles. This converges to the
   * target as the plan is balanced — it does NOT double-count stale plan miles
   * for days already run.
   */
  totalMeters: number;
  /**
   * True iff at least one day has type 'quality' OR type 'long' (the two
   * "hard" workout types the KPI header tracks as "quality week").
   */
  qualityKept: boolean;
  /**
   * True iff any two adjacent calendar days (sorted by date) are both hard
   * (type === 'quality' OR type === 'long'). Back-to-back hard days = warning.
   */
  backToBack: boolean;
}


/** A drop target's drag-relevant state (one calendar day in the week). */
export interface DragDay {
  date: string;
  /** True if a non-rest workout sits on this date. */
  hasWorkout: boolean;
  /** True if the day already ran — it's pinned, never a drop target. */
  isLocked: boolean;
  /** True if the date is before today — the past is never a drop target. */
  isPast: boolean;
}

