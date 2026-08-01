-- 0005_workout_type.sql — persist Strava's activity `workout_type` so the race
-- predictor can read a race tag (workout_type = 1 for runs) WITHOUT fetching the
-- heavy full `raw` jsonb payload app-side.
--
-- Strava run workout_type semantics: 0 = default/none, 1 = race, 2 = long run,
-- 3 = workout. We only special-case 1 (race) downstream, but persist the raw
-- value verbatim for completeness.
--
-- Idempotent / re-runnable: the column is added IF NOT EXISTS and the backfill is
-- a plain UPDATE keyed on rows that carry the raw key, safe to run repeatedly.

alter table public.activities
  add column if not exists workout_type smallint;

-- Backfill from the preserved raw Strava payload where the key is present.
update public.activities
  set workout_type = (raw->>'workout_type')::smallint
  where raw ? 'workout_type'
    and (raw->>'workout_type') is not null
    and workout_type is distinct from (raw->>'workout_type')::smallint;
