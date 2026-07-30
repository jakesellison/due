/**
 * boardSave.ts — translate the week planner's BOARD (tiles + placement) into the
 * net edit state `saveWeekEdits` persists. Pure. Node-tested.
 *
 * The planner reshapes the week by dragging workout tiles between days (and in
 * from a pool of missed / newly-built workouts). A drag changes a workout's DAY,
 * never its type — so an existing workout keeps its original type / title /
 * distance / is_quality and only its DATE moves. This adapter walks the current
 * placement and emits:
 *
 *  - existing tile on a day        → EditableDay (id, new date, original fields)
 *                                     + a MoveOp when the day changed.
 *  - existing tile dragged to pool  → EditableDay rest (vacate) + SetRestOp, but
 *    (was placed)                    ONLY when it was scheduled; a MISSED workout
 *                                     left unplaced is untouched (no-op).
 *  - new tile (no workoutId) on a    → inserted EditableDay (+ its structure) and
 *    day                             an AddDoubleOp for the audit.
 *  - new tile still in the pool      → dropped (never added to the week).
 *
 * Satisfied past days carry no tile, so they never appear here and are never
 * rewritten. Plan-target lowering (the planner's "update the plan" mode) is
 * handled separately by the caller via saveWeekEdits' `reflow`.
 */
import type { EditOp, EditableDay, WorkoutType } from '../plan/weekEdit';
import {
  DEFAULT_TITLES,
} from '../plan/weekEdit';
import type { PlanTile, Placement, TileType } from './weekPlan';

/** The original plan row behind an existing tile (its pre-edit fields). */
export interface OriginalWorkout {
  workoutId: string;
  date: string;
  title: string;
  type: WorkoutType;
  isQuality: boolean;
  plannedMeters: number;
  plannedDurationSeconds?: number | null;
  prescribedQualityMeters?: number | null;
  structure?: import('../workout/types').WorkoutStructure;
}

export interface BoardSaveInput {
  /** All draggable tiles — the board's tiles PLUS any in-session new tiles. */
  tiles: PlanTile[];
  /** Current tile→day placement (the edited state). */
  placement: Placement;
  /** The board's original placement, to tell a move/vacate from a no-op. */
  originalPlacement: Placement;
  /** Civil dates for day indices 0..6 ('YYYY-MM-DD'). */
  dayDates: string[];
  /** The existing plan workouts, keyed for lookup by their tile's workoutId. */
  originals: OriginalWorkout[];
}

export interface BoardSaveResult {
  finalDays: EditableDay[];
  ops: EditOp[];
}

/** A coarse tile category maps 1:1 to a WorkoutType for a NEW tile. */
function tileTypeToWorkoutType(t: TileType): WorkoutType {
  return t; // every planner tile category is a valid WorkoutType
}

/**
 * Build the net {finalDays, ops} for a planner save. See the module header.
 * PURE — no IO, no mutation of inputs.
 */
export function boardToWeekEdits(input: BoardSaveInput): BoardSaveResult {
  const { tiles, placement, originalPlacement, dayDates, originals } = input;
  const origById = new Map(originals.map((o) => [o.workoutId, o]));
  const finalDays: EditableDay[] = [];
  const ops: EditOp[] = [];

  for (const tile of tiles) {
    const cur = placement[tile.id] ?? null;
    const wid = tile.workoutId ?? null;

    if (wid != null) {
      // Existing workout — a drag only changes its day; keep every other field.
      const orig = origById.get(wid);
      if (!orig) continue;
      const was = originalPlacement[tile.id] ?? null;

      if (cur == null) {
        // Only a genuinely SCHEDULED workout dragged off a day becomes rest; a
        // missed workout that was already in the pool stays as-is.
        if (was != null) {
          finalDays.push({
            id: wid,
            date: orig.date,
            type: 'rest',
            title: DEFAULT_TITLES.rest,
            plannedDistanceMeters: 0,
            isQuality: false,
          });
          ops.push({ kind: 'setRest', workoutId: wid });
        }
        continue;
      }

      const edited = tile.edited === true;
      // Unchanged (still on its original day, same prescription) → don't
      // rewrite it: an untouched Save is a true no-op, not a full-week rewrite.
      if (was === cur && !edited) continue;

      const date = dayDates[cur];
      if (date == null) continue;
      const type = edited ? tileTypeToWorkoutType(tile.type) : orig.type;
      const title = edited ? tile.title?.trim() || DEFAULT_TITLES[type] : orig.title;
      const structure = edited ? tile.structure ?? [] : orig.structure;
      const prescribedQuality = edited
        ? type === 'quality'
          ? tile.qualityMeters ?? tile.meters
          : null
        : orig.prescribedQualityMeters;
      finalDays.push({
        id: wid,
        date,
        type,
        title,
        plannedDistanceMeters: edited ? tile.meters : orig.plannedMeters,
        plannedDurationSeconds: edited ? tile.durationSeconds ?? null : orig.plannedDurationSeconds,
        isQuality: edited ? type === 'quality' : orig.isQuality,
        ...(structure !== undefined ? { structure } : {}),
        ...(prescribedQuality !== undefined ? { prescribedQualityMeters: prescribedQuality } : {}),
        isInserted: false,
      });
      if (orig.date !== date) ops.push({ kind: 'move', workoutId: wid, toDate: date });
      if (edited) {
        ops.push({
          kind: 'updateWorkout',
          workoutId: wid,
          type,
          title,
          plannedDistanceMeters: Math.round(tile.meters),
          plannedDurationSeconds: tile.durationSeconds ?? null,
          isQuality: type === 'quality',
          prescribedQualityMeters: prescribedQuality != null ? Math.round(prescribedQuality) : null,
          structure: tile.structure ?? [],
        });
      }
    } else {
      // New tile from the in-app builder — inserted only when placed on a day.
      if (cur == null) continue;
      const date = dayDates[cur];
      if (date == null) continue;
      const type = tileTypeToWorkoutType(tile.type);
      finalDays.push({
        id: null,
        date,
        type,
        title: tile.title?.trim() || tile.structureLabel?.trim() || DEFAULT_TITLES[type],
        plannedDistanceMeters: tile.meters,
        plannedDurationSeconds: tile.durationSeconds ?? null,
        isQuality: tile.type === 'quality',
        isInserted: true,
        ...(tile.structure && tile.structure.length ? { structure: tile.structure } : {}),
        ...(tile.qualityMeters != null ? { prescribedQualityMeters: Math.round(tile.qualityMeters) } : {}),
      });
      ops.push({ kind: 'addDouble', onDate: date, distanceMeters: Math.round(tile.meters) });
    }
  }

  return { finalDays, ops };
}
