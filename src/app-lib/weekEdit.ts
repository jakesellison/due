// src/app-lib/weekEdit.ts
/**
 * IO layer for the manual week editor. The pure model (src/lib/plan/weekEdit.ts)
 * determines what to write; this function translates the final EditableDay[]
 * snapshot into Supabase writes.
 *
 * Follows applyAdaptation's pattern:
 *   1. For each op, write the workout row(s).
 *   2. Insert ONE plan_changes audit row.
 *   3. Invalidate plan/activity caches.
 *
 * We translate from the FINAL `EditableDay[]` (post-applyEdits), not from the
 * raw ops, so we write the net state rather than re-replaying each op.
 *
 * plan_weeks: `original_target_meters` (the immutable plan-of-record baseline)
 * is NEVER touched. `target_meters` is touched ONLY by a HYBRID reflow apply
 * (`reflow.newTargetMeters != null`) — the same concession write the
 * lower_target branch of `applyAdaptation` performs.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { EditOp, EditableDay } from '@/lib';
import { supabase } from './supabase';
import { invalidatePlanActivityCaches } from './queries';

export interface SaveWeekEditsArgs {
  planId: string;
  weekId: string;
  /** The final EditableDay[] from applyEdits — net state to persist. */
  finalDays: EditableDay[];
  /** The original ops list — stored verbatim in the audit row. */
  ops: EditOp[];
  /** The react-query client for cache invalidation after save. */
  queryClient: QueryClient;
  /**
   * Present when this save applies a reflow Adaptation card (Approve on Dash)
   * rather than a manual editor session. `newTargetMeters != null` marks a
   * HYBRID card that concedes part of the deficit: after the workout writes,
   * `plan_weeks.target_meters` is lowered to it and `newTarget` is recorded in
   * the audit change object. The audit row is attributed adapt/adapt with
   * `kind: 'reflow'` (matching applyAdaptation's rows) instead of user/manual.
   */
  reflow?: { newTargetMeters: number | null };
}

export interface DeletePlannedWorkoutArgs {
  planId: string;
  workoutId: string;
  date: string;
  title: string;
  queryClient: QueryClient;
}

/**
 * Permanently remove one planned workout without changing the weekly contract.
 * Workout route selections and matches are removed by the database's foreign
 * key cascades. The deleted mileage therefore becomes visibly unallocated
 * rather than silently lowering the runner's contract.
 */
export async function deletePlannedWorkout({
  planId,
  workoutId,
  date,
  title,
  queryClient,
}: DeletePlannedWorkoutArgs): Promise<void> {
  const { error } = await supabase.from('workouts').delete().eq('id', workoutId);
  if (error) throw error;

  const { error: auditError } = await supabase.from('plan_changes').insert({
    plan_id: planId,
    actor_type: 'user',
    source: 'manual',
    change: {
      edits: [{ kind: 'deleteWorkout', workoutId, date, title }],
    },
  });
  if (auditError) throw auditError;

  await invalidatePlanActivityCaches(queryClient);
}

/**
 * Batch-write the net edit state:
 *   - isInserted + type !== 'rest' → INSERT a new workouts row.
 *   - isInserted + type === 'rest' → skip (vacated placeholder, no DB write needed).
 *   - existing (id != null) + type === 'rest' → UPDATE to rest shape.
 *   - existing (id != null) + type !== 'rest' → UPDATE type/distance/date/isQuality.
 * Then inserts the audit row and invalidates caches.
 */
export async function saveWeekEdits({
  planId,
  weekId,
  finalDays,
  ops,
  queryClient,
  reflow,
}: SaveWeekEditsArgs): Promise<void> {
  for (const day of finalDays) {
    if (day.isInserted) {
      // New PM run — INSERT if it's a real run (not a synthetic rest placeholder).
      if (day.type === 'rest') continue;
      const { error } = await supabase.from('workouts').insert({
        plan_id: planId,
        week_id: weekId,
        date: day.date,
        type: day.type,
        title: day.title,
        planned_distance_meters: Math.round(day.plannedDistanceMeters),
        planned_duration_s: day.plannedDurationSeconds ?? null,
        is_quality: day.isQuality,
        prescribed_quality_meters: day.prescribedQualityMeters != null
          ? Math.round(day.prescribedQualityMeters)
          : null,
        // A new quality session built in-app carries its rep structure; plain
        // runs insert an empty structure as before.
        structure: day.structure ?? [],
      });
      if (error) throw error;
    } else if (day.id != null) {
      // Existing row — UPDATE net state.
      if (day.type === 'rest') {
        const { error } = await supabase
          .from('workouts')
          .update({
            type: 'rest',
            planned_distance_meters: 0,
            planned_duration_s: null,
            is_quality: false,
            prescribed_quality_meters: null,
            structure: [],
            // Persist the (possibly re-derived) title so the DB row agrees
            // with the applyEdits preview.
            title: day.title,
          })
          .eq('id', day.id);
        if (error) throw error;
      } else {
        const update: Record<string, unknown> = {
          type: day.type,
          planned_distance_meters: Math.round(day.plannedDistanceMeters),
          date: day.date,
          is_quality: day.isQuality,
          title: day.title,
        };
        // `undefined` means this caller is moving/retyping an older workout and
        // did not edit its prescription. Explicit null/[] comes only from the
        // workout editor and intentionally clears those fields.
        if (day.plannedDurationSeconds !== undefined) {
          update.planned_duration_s = day.plannedDurationSeconds;
        }
        if (day.structure !== undefined) {
          update.structure = day.structure;
        }
        if (day.prescribedQualityMeters !== undefined) {
          update.prescribed_quality_meters = day.prescribedQualityMeters != null
            ? Math.round(day.prescribedQualityMeters)
            : null;
        }
        const { error } = await supabase
          .from('workouts')
          .update(update)
          .eq('id', day.id);
        if (error) throw error;
      }
    }
  }

  // HYBRID reflow apply: the card concedes part of the deficit, so lower the
  // week's target to the recovered total. Same write as applyAdaptation's
  // lower_target branch — original_target_meters is NEVER touched.
  const newTargetMeters = reflow?.newTargetMeters ?? null;
  if (newTargetMeters != null) {
    const { error: targetErr } = await supabase
      .from('plan_weeks')
      .update({ target_meters: Math.round(newTargetMeters) })
      .eq('id', weekId);
    if (targetErr) throw targetErr;
  }

  // ONE audit row per save. A reflow apply is attributed to the adapt engine
  // (matching applyAdaptation) and records the target concession, so the
  // change-log stays consistent across apply paths.
  const { error: auditErr } = await supabase.from('plan_changes').insert({
    plan_id: planId,
    actor_type: reflow ? 'adapt' : 'user',
    source: reflow ? 'adapt' : 'manual',
    change: {
      ...(reflow ? { kind: 'reflow' } : {}),
      edits: ops,
      ...(newTargetMeters != null ? { newTarget: Math.round(newTargetMeters) } : {}),
    },
  });
  if (auditErr) throw auditErr;

  await invalidatePlanActivityCaches(queryClient);
}
