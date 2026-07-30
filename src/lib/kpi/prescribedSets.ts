import type { WorkoutStructure } from '../workout/types';
import {
  paceIntent,
} from '../workout/pace';
import type { DrillSet } from './drillVerdict';
import {
  extractPlannedSets,
} from './drillVerdict';
import {
  resolveTargetPace,
  type RacePaces,
} from './targetPace';

/**
 * Returns the planned sets for a workout structure, using the SAME extractor
 * as the drill verdict so the planned table and drill always agree by
 * construction. Only `repeat` blocks produce sets (top-level leaves yield
 * nothing, matching the drill).
 *
 * The zoneLabel derivation mirrors buildDrillVerdict lines ~126-127:
 *   zoneLabel = the semantic pace intent, when present
 */
export function prescribedSets(structure: WorkoutStructure, paces: RacePaces | null): DrillSet[] {
  return extractPlannedSets(structure, paces).map((def) => ({
    plannedReps: def.reps,
    distPerRepMeters: def.distPerRepMeters,
    targetSecPerMi: def.target ? resolveTargetPace(def.target, paces) : null,
    zoneLabel: paceIntent(def.target?.pace),
    reps: [],
  }));
}
