export type RoutePlanningBlock = 'completed' | 'past' | 'rest' | 'no-distance' | null;

export interface RoutePlanningWorkout {
  type: string | null;
  date: string | null;
  plannedDistanceMeters: number | null;
}

/** One UI lifecycle gate shared by workout detail, picker, and builder. */
export function routePlanningBlock(
  workout: RoutePlanningWorkout,
  today: string,
  completed: boolean,
): RoutePlanningBlock {
  if (completed) return 'completed';
  if (workout.type === 'rest') return 'rest';
  if (!workout.plannedDistanceMeters || workout.plannedDistanceMeters <= 0) return 'no-distance';
  if (workout.date && workout.date < today) return 'past';
  return null;
}

export type RouteDistanceFit = 'short' | 'on-target' | 'over';

/**
 * Classify a built route against the prescribed distance. The 400 m tolerance
 * is intentionally stable across every surface (about a quarter mile).
 */
export function routeDistanceFit(
  distanceMeters: number,
  targetMeters: number,
  toleranceMeters = 400,
): { fit: RouteDistanceFit; deltaMeters: number } {
  const deltaMeters = distanceMeters - targetMeters;
  if (Math.abs(deltaMeters) <= toleranceMeters) return { fit: 'on-target', deltaMeters };
  return { fit: deltaMeters < 0 ? 'short' : 'over', deltaMeters };
}
