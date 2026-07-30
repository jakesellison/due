import { useQuery, type QueryClient } from '@tanstack/react-query';

import {
  simplifyPath,
  type LatLng,
} from '@/lib';
import { supabase } from './supabase';

/**
 * Route builder data layer. Saved routes are owned, RLS-guarded rows; these
 * helpers are thin CRUD over the `routes` table (authz is the table's policy —
 * we never filter by user_id client-side, the policy does it).
 *
 * A row stores the editable `points` (clicked waypoints) and the rendered `path`
 * (snapped/full polyline). The viewer/list draws `path` when present, else
 * `points`; the builder reloads `points` to edit.
 */

const ROUTES_KEY = 'routes';

/** A row as we read it from Supabase. */
export interface RouteRow {
  id: string;
  name: string;
  points: LatLng[];
  path: LatLng[] | null;
  distance_meters: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  provenance: 'due_builder';
}

/** The list/viewer shape (camelCase, with the polyline to draw resolved). */
export interface SavedRoute {
  id: string;
  name: string;
  points: LatLng[];
  /** The polyline to render: the snapped path when present, else the waypoints. */
  drawPath: LatLng[];
  distanceMeters: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  provenance: 'due_builder';
}

function toSaved(row: RouteRow): SavedRoute {
  const points = Array.isArray(row.points) ? (row.points as LatLng[]) : [];
  const path = Array.isArray(row.path) ? (row.path as LatLng[]) : null;
  return {
    id: row.id,
    name: row.name,
    points,
    drawPath: path && path.length >= 2 ? path : points,
    distanceMeters: row.distance_meters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    provenance: row.provenance ?? 'due_builder',
  };
}

/** All of the signed-in user's routes, most-recently-updated first. */
export function useRoutes(userId: string | null) {
  return useQuery<SavedRoute[]>({
    queryKey: [ROUTES_KEY, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, name, points, path, distance_meters, created_at, updated_at, archived_at, provenance')
        .is('archived_at', null)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as RouteRow[]).map(toSaved);
    },
  });
}

/** A single owned route by id (for the viewer / edit reload). */
export function useRoute(userId: string | null, routeId: string | null) {
  return useQuery<SavedRoute | null>({
    // Scope the cache to the authenticated owner. Otherwise a route fetched by
    // one account can remain visible briefly after an auth transition.
    queryKey: [ROUTES_KEY, userId, 'one', routeId],
    enabled: !!userId && !!routeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, name, points, path, distance_meters, created_at, updated_at, archived_at, provenance')
        .eq('id', routeId!)
        .maybeSingle();
      if (error) throw error;
      return data ? toSaved(data as RouteRow) : null;
    },
  });
}

export interface CreateRouteInput {
  userId: string;
  name: string;
  points: LatLng[];
  /** The rendered polyline (snapped). Pass null when only straight segments. */
  path: LatLng[] | null;
  distanceMeters: number;
  /** When present, route creation and workout attachment are one transaction. */
  workoutId?: string;
}

/**
 * Insert a new route. The stored `path` is simplified to ≤300 points so a long
 * snapped route stays compact. Invalidates the list on success.
 */
export async function createRoute(input: CreateRouteInput, qc?: QueryClient): Promise<SavedRoute> {
  const path = input.path && input.path.length >= 2 ? simplifyPath(input.path, 300) : null;
  if (input.workoutId) {
    const { data, error } = await supabase.rpc('create_route_and_attach', {
      p_workout_id: input.workoutId,
      p_name: input.name,
      p_points: input.points,
      p_path: path,
      p_distance_meters: Math.round(input.distanceMeters),
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as RouteRow | null;
    if (!row) throw new Error('Route was saved without a response.');
    if (qc) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [ROUTES_KEY] }),
        qc.invalidateQueries({ queryKey: ['workoutRoute', input.userId, input.workoutId] }),
        qc.invalidateQueries({ queryKey: ['workoutRouteIds', input.userId] }),
      ]);
    }
    return toSaved(row);
  }
  const { data, error } = await supabase
    .from('routes')
    .insert({
      user_id: input.userId,
      name: input.name,
      points: input.points,
      path,
      distance_meters: Math.round(input.distanceMeters),
    })
    .select('id, name, points, path, distance_meters, created_at, updated_at, archived_at, provenance')
    .single();
  if (error) throw error;
  if (qc) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [ROUTES_KEY] }),
      qc.invalidateQueries({ queryKey: ['workoutRoute'] }),
    ]);
  }
  return toSaved(data as RouteRow);
}

/** Rename a route (also bumps updated_at). Invalidates list + the single route. */
export async function renameRoute(routeId: string, name: string, qc?: QueryClient): Promise<void> {
  const { error } = await supabase
    .from('routes')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', routeId);
  if (error) throw error;
  if (qc) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [ROUTES_KEY] }),
      qc.invalidateQueries({ queryKey: ['workoutRoute'] }),
    ]);
  }
}

/** Archive a route. Existing workout attachments keep resolving it. */
export async function deleteRoute(routeId: string, qc?: QueryClient): Promise<void> {
  const { error } = await supabase
    .from('routes')
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', routeId);
  if (error) throw error;
  if (qc) await qc.invalidateQueries({ queryKey: [ROUTES_KEY] });
}

export interface WorkoutRouteSelection {
  workoutId: string;
  route: SavedRoute;
  createdAt: string;
  updatedAt: string;
}

/** The signed-in user's private route selection for one planned workout. */
export function useWorkoutRoute(userId: string | null, workoutId: string | null) {
  return useQuery<WorkoutRouteSelection | null>({
    queryKey: ['workoutRoute', userId, workoutId],
    enabled: !!userId && !!workoutId,
    queryFn: async () => {
      const { data: selection, error: selectionError } = await supabase
        .from('workout_route_selections')
        .select('route_id, created_at, updated_at')
        .eq('user_id', userId!)
        .eq('workout_id', workoutId!)
        .maybeSingle();
      if (selectionError) throw selectionError;
      if (!selection) return null;
      const { data: route, error: routeError } = await supabase
        .from('routes')
        .select('id, name, points, path, distance_meters, created_at, updated_at, archived_at, provenance')
        .eq('id', selection.route_id)
        .single();
      if (routeError) throw routeError;
      return {
        workoutId: workoutId!,
        route: toSaved(route as RouteRow),
        createdAt: selection.created_at,
        updatedAt: selection.updated_at,
      };
    },
  });
}


/** Select or replace a saved route for a planned workout. */
export async function attachRouteToWorkout(
  userId: string,
  workoutId: string,
  routeId: string,
  qc?: QueryClient,
): Promise<void> {
  const { error } = await supabase.from('workout_route_selections').upsert(
    {
      user_id: userId,
      workout_id: workoutId,
      route_id: routeId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,workout_id' },
  );
  if (error) throw error;
  if (qc) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['workoutRoute', userId, workoutId] }),
      qc.invalidateQueries({ queryKey: ['workoutRouteIds', userId] }),
    ]);
  }
}

/** Remove a workout's route selection without deleting the reusable route. */
export async function detachRouteFromWorkout(
  userId: string,
  workoutId: string,
  qc?: QueryClient,
): Promise<void> {
  const { error } = await supabase
    .from('workout_route_selections')
    .delete()
    .eq('user_id', userId)
    .eq('workout_id', workoutId);
  if (error) throw error;
  if (qc) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['workoutRoute', userId, workoutId] }),
      qc.invalidateQueries({ queryKey: ['workoutRouteIds', userId] }),
    ]);
  }
}
