-- 0027_workout_matches_ownership.sql — close the workout_matches ownership hole
-- (overnight security audit, low: real but currently unreachable from the app).
--
-- THE HOLE. `workout_matches_insert` (0001_init.sql:372) checks only
-- `auth_can_read_user(user_id)` — i.e. that the row's user_id column equals
-- auth.uid(). It never checks that `activity_id` belongs to that user, nor that
-- `workout_id` sits in a plan they can read. Postgres runs foreign-key
-- validation as the table owner, which BYPASSES RLS, so a foreign UUID in
-- either column satisfies its FK happily.
--
-- The consequences, in order of nastiness:
--   1. `unique (activity_id)` (0001_init.sql:129) means a row squatting another
--      user's activity id permanently blocks that user from matching their own
--      activity — a denial of service on someone else's data.
--   2. Insert success vs failure is an existence oracle for activity UUIDs.
--   3. A match row can reference a workout from a plan the caller cannot read.
--
-- The identical class of hole on `activity_photos` was closed with the
-- `ensure_activity_photo_owner` trigger (0011_activity_photos.sql:28-50);
-- workout_matches simply never got the same treatment. This is that treatment.
--
-- SCOPE NOTE: the per-activity matching model was designed and then REJECTED in
-- favour of the prescribed-vs-bucket model, so this table is dormant and the
-- app writes no rows to it. That is why this is low and not high — but a
-- dormant table with a live policy is exactly the kind of thing that gets
-- switched on later by someone who assumes the policy was right.
create or replace function public.ensure_workout_match_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.activities a
    where a.id = new.activity_id and a.user_id = new.user_id
  ) then
    raise exception 'workout match must reference an activity owned by the same user';
  end if;

  if not exists (
    select 1 from public.workouts w
    where w.id = new.workout_id and public.auth_can_read_plan(w.plan_id)
  ) then
    raise exception 'workout match must reference a workout in a readable plan';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_workout_match_owner on public.workout_matches;
create trigger trg_workout_match_owner
  before insert or update on public.workout_matches
  for each row execute function public.ensure_workout_match_owner();
