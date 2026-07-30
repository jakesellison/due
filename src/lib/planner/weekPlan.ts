/**
 * weekPlan.ts — the pure model for the week planner (drag-and-drop reshape).
 *
 * The week is a set of PLAN TILES (each a prescribed workout) placed onto days,
 * plus fixed ACTUALS (what was already run, anchored to their day). Rearranging
 * tiles never mutates actuals; it changes which tiles sit on which day and how
 * many. This file owns the totals + live deltas the header ledger reads, so the
 * math stays testable without any UI or gestures.
 *
 * Pure. No IO. Node-tested.
 */

export type TileType = 'easy' | 'quality' | 'long' | 'cross';

export interface PlanTile {
  /** Stable id (drag identity). */
  id: string;
  type: TileType;
  /** Planned distance for this tile (meters). */
  meters: number;
  /** User-facing workout title. Kept separate from `structureLabel`, which is
   *  the compact prescription subtitle rendered under the type. */
  title?: string;
  /** Planned duration for time-based, non-distance workouts. */
  durationSeconds?: number | null;
  /** Prescribed HARD-miles for a quality tile (the quality-KPI numerator); for
   *  non-quality tiles this is 0/absent. Keeps quality on the gauge's scale. */
  qualityMeters?: number;
  /** Source workout row id, when this tile came from the plan (for save). */
  workoutId?: string | null;
  /** e.g. "Threshold", "MP" — shown on the tile/pill. */
  structureLabel?: string;
  /** Full segment structure for every editable workout (for save + quality math). */
  structure?: import('../workout/types').WorkoutStructure;
  /** Set only by the planner's local editor. Prevents untouched legacy
   *  prescriptions from being normalized and rewritten merely by saving a move. */
  edited?: boolean;
  /** The day (0=Mon..6=Sun) this tile was originally planned on. */
  originDay?: number;
  /** True when the tile's original day is in the PAST — an unfinished session
   *  freed to the pool for rescheduling ("missed"), vs a future tile moved. */
  originPast?: boolean;
}

/** tile id → day index (0=Mon..6=Sun) it's placed on, or null when in the tray. */
export type Placement = Record<string, number | null>;

export interface DimTotals {
  miles: number;
  /** Prescribed quality hard-miles. */
  quality: number;
  /** Long-run distance (the week's longest single long tile that's placed). */
  long: number;
}

export interface DeltaLine {
  /** Current (new) value, meters. */
  current: number;
  /** Original-plan value, meters. */
  original: number;
  /** current − original, meters (positive = more than the original plan). */
  delta: number;
}

export interface WeekDeltas {
  miles: DeltaLine;
  quality: DeltaLine;
  long: DeltaLine;
}

const isPlaced = (p: Placement, id: string): boolean => p[id] != null;

/** Totals for the tiles currently PLACED on a day (the working arrangement). The
 *  long dimension is the max placed long tile (a week has one long run, not a
 *  sum of longs). */
export function weekTotals(tiles: PlanTile[], placement: Placement): DimTotals {
  let miles = 0;
  let quality = 0;
  let long = 0;
  for (const t of tiles) {
    if (!isPlaced(placement, t.id)) continue;
    miles += t.meters;
    if (t.type === 'quality') quality += t.qualityMeters ?? t.meters;
    if (t.type === 'long') long = Math.max(long, t.meters);
  }
  return { miles, quality, long };
}


/** The tray = tiles not currently placed on any day (freed by a deviation, or
 *  removed while reshaping). Preserves input order. */
export function trayTiles(tiles: PlanTile[], placement: Placement): PlanTile[] {
  return tiles.filter((t) => !isPlaced(placement, t.id));
}

/** Tiles placed on a given day, in input order (a day may hold a double/triple). */
export function tilesOnDay(tiles: PlanTile[], placement: Placement, dayIdx: number): PlanTile[] {
  return tiles.filter((t) => placement[t.id] === dayIdx);
}
