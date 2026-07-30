import type { SupabaseClient } from '@supabase/supabase-js';
import { revokeStravaConnection } from './ingest';
import { captureError } from './report';

/**
 * In-app account deletion (audit-ops H2, Apple Guideline 5.1.1(v)). Deletes
 * EVERY row scoped to one user across all 16 tables in `supabase/migrations`,
 * their storage objects, and finally the `auth.users` row itself.
 *
 * Table coverage — verified against `supabase/migrations/0001_init.sql`,
 * `0006_prediction_snapshots.sql`, `0007_routes.sql`, `0009_shoes.sql`,
 * `0011_activity_photos.sql`, `0022_workout_route_planning.sql` (the migrations
 * that `create table`):
 *
 *  Deleted EXPLICITLY below (each has a direct `user_id`/`id` column, or — for
 *  `plans` — is resolved via `plan_members.role = 'owner'` since `plans` has
 *  no `user_id` column of its own):
 *    workout_matches, activity_photos, activities, plans (owned only),
 *    plan_members, prediction_snapshots, workout_route_selections, routes, shoes,
 *    integration_connections, generation_log, users.
 *
 *  Covered by a verified `ON DELETE CASCADE` from one of the explicit deletes
 *  above, not deleted directly (no direct `user_id` column of their own):
 *    plan_weeks, workouts, plan_chats, plan_changes — all key off
 *    `plans.id`/`plan_weeks.id`/`workouts.id`, and cascade when the owned
 *    `plans` row is deleted (0001_init.sql lines 50-150).
 *
 *  That's all 16 tables: users, plans, plan_members, plan_weeks, workouts,
 *  integration_connections, activities, workout_matches, plan_chats,
 *  plan_changes, generation_log, prediction_snapshots,
 *  workout_route_selections, routes, shoes,
 *  activity_photos.
 *
 * Not relied upon: the implicit cascade from deleting `auth.users` itself
 * (most of these tables also carry a direct `user_id -> auth.users(id) on
 * delete cascade` FK, which WOULD clean them up when
 * `admin.auth.admin.deleteUser` runs) — we delete explicitly first so a
 * verifiable, order-controlled DB state exists before the irreversible
 * auth-user delete, and so a future FK/cascade regression doesn't silently
 * leave user data behind.
 */
export const EXPLICIT_USER_SCOPED_TABLES = [
  'workout_matches',
  'activity_photos',
  'activities',
  'plans',
  'plan_members',
  'prediction_snapshots',
  'workout_route_selections',
  'routes',
  'shoes',
  'integration_connections',
  'generation_log',
  'users',
] as const;

/** Deleted implicitly via `ON DELETE CASCADE` from an explicit delete above. */
export const CASCADE_COVERED_TABLES = ['plan_weeks', 'workouts', 'plan_chats', 'plan_changes'] as const;

/** Storage buckets holding per-user objects, keyed by a `<user_id>/...` path prefix. */
const USER_STORAGE_BUCKETS = ['activity-photos', 'shoe-photos'] as const;

/**
 * Reports a Supabase Storage error (`list`/`remove`) to Sentry + console, then
 * throws so the caller aborts. A transient Storage failure must NEVER be
 * swallowed here: silently continuing would let the deletion report success
 * while photo bytes for this user still exist. The whole `deleteAccount` flow
 * is re-runnable (each step is idempotent-ish: `list`/`remove`/`delete` on
 * already-gone objects/rows are no-ops), so failing loudly and aborting before
 * the irreversible `deleteUser` step beats a silent partial erasure.
 */
async function throwStorageError(bucket: string, op: 'list' | 'remove', error: unknown): Promise<never> {
  const detail = (error as { message?: string } | null)?.message ?? String(error);
  const message = `deleteAccount: storage ${op} failed for bucket "${bucket}": ${detail}`;
  console.error(message, error);
  await captureError(error, { route: 'accountDeletion', bucket, op });
  throw new Error(message);
}

/**
 * Recursively deletes every storage object under `<userId>/` in `bucket`.
 * Supabase Storage's `list` is not recursive, and `activity-photos` nests one
 * folder level deep (`<user_id>/<activity_id>/<file>`), so folder entries
 * (`id === null`) are listed one level further; `shoe-photos` is flat
 * (`<user_id>/<shoe_id>.jpg`) and resolves in one `list` call. A missing/empty
 * prefix (no error, just no entries) is a silent no-op. Any actual `list` or
 * `remove` ERROR is not tolerated — see {@link throwStorageError}.
 */
async function deleteUserStorage(admin: SupabaseClient, bucket: string, userId: string): Promise<void> {
  const { data: entries, error: listError } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
  if (listError) await throwStorageError(bucket, 'list', listError);
  if (!entries || entries.length === 0) return;

  const paths: string[] = [];
  for (const entry of entries as Array<{ id: string | null; name: string }>) {
    if (entry.id === null) {
      // A folder (e.g. an activity id) — one more level down holds the files.
      const subPrefix = `${userId}/${entry.name}`;
      const { data: subEntries, error: subListError } = await admin.storage
        .from(bucket)
        .list(subPrefix, { limit: 1000 });
      if (subListError) await throwStorageError(bucket, 'list', subListError);
      for (const file of (subEntries ?? []) as Array<{ name: string }>) {
        paths.push(`${subPrefix}/${file.name}`);
      }
    } else {
      paths.push(`${userId}/${entry.name}`);
    }
  }
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) await throwStorageError(bucket, 'remove', removeError);
  }
}

/** Throws with a table-scoped message if a delete returned a Supabase error. */
async function del(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<void> {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (error) throw new Error(`deleteAccount: ${table} delete failed: ${error.message}`);
}

/**
 * Deletes everything for one authenticated user, in order:
 *
 *  1. Revoke + delete their Strava data (reuses `revokeStravaConnection`, the
 *     same logic behind the user-facing "Disconnect Strava").
 *  2. Delete their storage objects (activity + shoe photos).
 *  3. Delete every DB row scoped to them, in FK-safe order (see
 *     {@link EXPLICIT_USER_SCOPED_TABLES} / {@link CASCADE_COVERED_TABLES}).
 *  4. Delete the underlying `auth.users` row — always LAST, since it's the
 *     irreversible step and everything above should have already succeeded.
 *
 * IO, order-sensitive. Throws on the first failure — the caller (the
 * `/api/account/delete` route) must treat any throw as "account NOT deleted"
 * and respond accordingly rather than assume partial cleanup is good enough.
 */
export async function deleteAccount(admin: SupabaseClient, userId: string): Promise<void> {
  // 1. Strava: revoke the OAuth grant + remove Strava-sourced activities.
  // Idempotent — a no-op when there's no active connection.
  await revokeStravaConnection(admin, userId);

  // 2. Storage objects — private buckets, never covered by a DB FK cascade.
  for (const bucket of USER_STORAGE_BUCKETS) {
    await deleteUserStorage(admin, bucket, userId);
  }

  // 3a. `workout_matches` and `activity_photos` first (also cascade from
  // `activities`/`workouts` below, but deleted explicitly for certainty).
  await del(admin, 'workout_matches', 'user_id', userId);
  await del(admin, 'activity_photos', 'user_id', userId);
  await del(admin, 'activities', 'user_id', userId);

  // 3b. `plans` has no `user_id` column — ownership is via `plan_members`.
  // Deleting owned plans cascades plan_weeks/workouts/plan_chats/plan_changes
  // (see the module doc comment). Plans this user merely belongs to (coach/
  // viewer on someone else's plan) are left alone — only their membership row
  // is removed.
  const { data: owned, error: ownedErr } = await admin
    .from('plan_members')
    .select('plan_id')
    .eq('user_id', userId)
    .eq('role', 'owner');
  if (ownedErr) throw new Error(`deleteAccount: plan_members lookup failed: ${ownedErr.message}`);
  const ownedPlanIds = ((owned ?? []) as Array<{ plan_id: string }>).map((r) => r.plan_id);
  if (ownedPlanIds.length > 0) {
    const { error } = await admin.from('plans').delete().in('id', ownedPlanIds);
    if (error) throw new Error(`deleteAccount: plans delete failed: ${error.message}`);
  }
  await del(admin, 'plan_members', 'user_id', userId);

  // 3c. Remaining directly-user-scoped tables.
  await del(admin, 'prediction_snapshots', 'user_id', userId);
  await del(admin, 'workout_route_selections', 'user_id', userId);
  await del(admin, 'routes', 'user_id', userId);
  await del(admin, 'shoes', 'user_id', userId);
  await del(admin, 'integration_connections', 'user_id', userId);
  await del(admin, 'generation_log', 'user_id', userId);
  await del(admin, 'users', 'id', userId);

  // 4. Finally, the auth user itself — irreversible, so it runs last.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteAccount: deleteUser failed: ${error.message}`);
}
