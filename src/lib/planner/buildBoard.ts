/**
 * buildBoard.ts — derive the planner's board (tiles + placement + banked
 * actuals) from a week's days. Pure; the screen feeds it day inputs + the week
 * start.
 *
 * Model (banked actuals + scheduled plan):
 *  • A RESOLVED day (past, or already run) contributes its ACTUAL — banked,
 *    anchored to its day, never edited.
 *  • Its planned workout only becomes a TILE when it was NOT satisfied
 *    (missed, or ran-easy on a quality day) — freed to the pool for
 *    rescheduling, carrying `originPast: true` so the UI can tag it "missed".
 *  • A satisfied resolved day yields NO tile — its contribution is the banked
 *    actual (double-counting a placed tile would inflate the totals).
 *  • An UNRESOLVED future day places its planned tile on the day.
 *
 * Week totals are then BANKED (from the week goals) + SCHEDULED (the placed
 * tiles) — the screen owns that sum; this file just sorts tiles from actuals.
 */
import {
  prescribedQualityMeters,
} from '../kpi/prescribedQuality';
import {
  dominantWorkLabel,
} from '../workout/structureBar';
import type { WorkoutStructure } from '../workout/types';
import type { PlanTile, Placement, TileType } from './weekPlan';

/** Minimal shape the builder needs from a day (keeps it UI/query agnostic). */
export interface BoardDayInput {
  workoutId: string;
  date: string; // YYYY-MM-DD
  type: string; // raw workout type
  title?: string | null;
  isQuality: boolean;
  plannedMeters: number;
  plannedDurationSeconds?: number | null;
  structure: WorkoutStructure;
  /** Stored hard-work snapshot for duration-based quality prescriptions. */
  prescribedQualityMeters?: number | null;
  /** Logged distance for the day (meters), or null when nothing ran. */
  actualMeters: number | null;
  isPast: boolean;
  /** The planned session was met: for a quality day the quality was detected;
   *  for any other day, something ran. A missed day is not satisfied. */
  satisfied: boolean;
}

export interface ActualEntry {
  dayIdx: number;
  meters: number;
  /** true when the day did not meet its planned session (missed or ran-easy). */
  deviated: boolean;
}

export interface WeekBoard {
  tiles: PlanTile[];
  placement: Placement;
  actuals: ActualEntry[];
}

function tileType(rawType: string, isQuality: boolean): TileType {
  if (isQuality) return 'quality';
  const t = rawType.toLowerCase();
  if (t === 'cross') return 'cross';
  return t === 'long' || t === 'race' ? 'long' : 'easy';
}

/** Civil-day index 0..6 from the week's Monday. */
function dayIdx(date: string, weekStart: string): number {
  const a = new Date(`${weekStart}T12:00:00Z`).getTime();
  const b = new Date(`${date}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

export function buildBoard(days: BoardDayInput[], weekStart: string): WeekBoard {
  const tiles: PlanTile[] = [];
  const placement: Placement = {};
  const actuals: ActualEntry[] = [];

  for (const d of days) {
    const isRest = (d.type ?? '').toLowerCase() === 'rest' && d.plannedMeters <= 0;
    if (isRest && d.actualMeters == null) continue; // empty rest slot — nothing to show

    const idx = dayIdx(d.date, weekStart);
    const type = tileType(d.type, d.isQuality);
    const hasWorkout = d.plannedMeters > 0 || type === 'quality';

    // A day is RESOLVED once it's past or something ran — its actual is banked.
    const resolved = d.isPast || d.actualMeters != null;
    if (d.actualMeters != null) {
      actuals.push({ dayIdx: idx, meters: d.actualMeters, deviated: !d.satisfied });
    }

    const tile: PlanTile = {
      id: d.workoutId,
      type,
      meters: d.plannedMeters,
      title: d.title?.trim() || undefined,
      durationSeconds: d.plannedDurationSeconds ?? null,
      ...(type === 'quality'
        ? { qualityMeters: d.prescribedQualityMeters ?? prescribedQualityMeters(d.structure ?? [], d.plannedMeters) }
        : {}),
      structureLabel: d.structure?.length ? dominantWorkLabel(d.structure) ?? undefined : undefined,
      structure: d.structure ?? [],
      workoutId: d.workoutId,
      originDay: idx,
    };

    if (!resolved) {
      // Future, not yet run → the planned tile sits on its day.
      if (hasWorkout) {
        tile.originPast = false;
        tiles.push(tile);
        placement[tile.id] = idx;
      }
    } else if (!d.satisfied && hasWorkout) {
      // Resolved but the session wasn't met → free it to the pool to reschedule.
      tile.originPast = true;
      tiles.push(tile);
      placement[tile.id] = null;
    }
    // Resolved & satisfied → no tile; the banked actual is its contribution.
  }

  return { tiles, placement, actuals };
}
