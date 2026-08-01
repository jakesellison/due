-- 0013_fk_indexes.sql — index FK columns used by ON DELETE CASCADE.
-- These columns had no covering index, forcing sequential scans on cascade
-- deletes and lookups. Idempotent: create index if not exists.

create index if not exists idx_workouts_week on public.workouts (week_id);
create index if not exists idx_plan_chats_plan on public.plan_chats (plan_id);
create index if not exists idx_plan_changes_plan on public.plan_changes (plan_id);
create index if not exists idx_generation_log_user on public.generation_log (user_id);
