-- 0006_prediction_snapshots.sql — the self-measurement layer.
--
-- Freeze each day's race prediction so future race RESULTS can grade the model.
-- One row per (user, civil snapshot_date, target distance): the predicted finish
-- + its band + confidence, the model_version that drove it, and the raw component
-- estimates + the full feature vector that produced it. When a real race later
-- lands we can score predicted_seconds against the actual finish.
--
-- Idempotent / re-runnable: table + policy + index are all create-if-not-exists
-- (policy is drop-then-create). Owner-only RLS, same shape as `activities` (this
-- is execution data): `auth_can_read_user(user_id)` for both USING and CHECK.
--
-- The client upserts on the (user_id, snapshot_date, target_meters) unique key
-- once per day per target, so re-opening Trends never duplicates a day's row.

create table if not exists public.prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  snapshot_date date not null,
  as_of timestamptz not null default now(),
  target_meters integer not null,
  race_date date,
  predicted_seconds integer not null,
  low_seconds integer,
  high_seconds integer,
  confidence text check (confidence in ('low','medium','high')),
  model_version text not null,
  components jsonb,
  features jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date, target_meters)
);

alter table public.prediction_snapshots enable row level security;

-- Owner-only (execution data), same pattern as activities:
drop policy if exists prediction_snapshots_all on public.prediction_snapshots;
create policy prediction_snapshots_all on public.prediction_snapshots
  for all using (public.auth_can_read_user(user_id))
  with check (public.auth_can_read_user(user_id));

create index if not exists idx_pred_snap_user_date
  on public.prediction_snapshots (user_id, snapshot_date desc);
