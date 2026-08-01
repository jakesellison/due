-- 0004_race_type.sql — add 'race' to the workouts.type check constraint and
-- re-type the Chicago Marathon race-day workout.
--
-- Idempotent / re-runnable: the constraint is dropped (if present) and recreated
-- with the extended type set; the race-day re-type is a plain UPDATE that is
-- safe to run repeatedly. 'race' is a SCHEDULED run day (a non-rest type), so it
-- flows through the existing schedule/match layers as a run.

alter table public.workouts
  drop constraint if exists workouts_type_check;

alter table public.workouts
  add constraint workouts_type_check
  check (type in ('easy','long','quality','rest','cross','race'));

-- Re-type the race-day workout for the imported Chicago 2026 plan.
update public.workouts
  set type = 'race'
  where plan_id = '11111111-2222-3333-4444-555555555555'
    and title = 'Chicago Marathon';
