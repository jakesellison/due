-- Preserve the hard-work distance resolved when a structured workout is built.
-- A duration prescription such as 6 × 3 min at 5K has no intrinsic distance;
-- without this snapshot later readers would silently recalculate it at a
-- generic fallback pace and change the runner's contract after save.

alter table public.workouts
  add column if not exists prescribed_quality_meters integer;

alter table public.workouts
  drop constraint if exists workouts_prescribed_quality_meters_nonnegative;

alter table public.workouts
  add constraint workouts_prescribed_quality_meters_nonnegative
  check (prescribed_quality_meters is null or prescribed_quality_meters >= 0);

comment on column public.workouts.prescribed_quality_meters is
  'Stable hard-work distance snapshot for structured quality prescriptions, especially duration-based reps.';
