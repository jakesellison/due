-- 0001_init.sql — initial multi-tenant schema + RLS for the mileage app.
-- Idempotent / re-runnable: create ... if not exists, create or replace function,
-- drop policy/trigger if exists before create. Distances are integer meters,
-- durations integer seconds. No mi/km columns.

create extension if not exists pgcrypto;

-- ============================================================================
-- Tables
-- ============================================================================

-- 1. users
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  units text not null default 'mi' check (units in ('mi','km')),
  week_start text not null default 'mon' check (week_start in ('mon','sun')),
  tz text not null default 'America/Chicago',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 2. plans
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  race_name text,
  race_date date,
  distance_kind text check (distance_kind in ('marathon','half','10k','5k','custom')),
  race_distance_meters integer,
  goal_time interval,
  start_date date,
  num_weeks integer,
  created_via text check (created_via in ('import','generated','conversation')),
  source_template_id uuid references public.plans(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private','shared','public')),
  status text not null default 'active' check (status in ('active','archived','draft')),
  created_at timestamptz not null default now()
);

-- 3. plan_members
create table if not exists public.plan_members (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','coach','viewer')),
  created_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

-- 4. plan_weeks
create table if not exists public.plan_weeks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  week_index integer not null,
  phase text check (phase in ('base','build','peak','taper','recovery')),
  target_meters integer,
  target_low_meters integer,
  target_high_meters integer,
  original_target_meters integer,
  is_recovery boolean not null default false,
  created_at timestamptz not null default now(),
  unique (plan_id, week_index)
);

-- 5. workouts
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  week_id uuid references public.plan_weeks(id) on delete cascade,
  date date,
  type text check (type in ('easy','long','quality','rest','cross')),
  title text,
  planned_distance_meters integer,
  planned_duration_s integer,
  structure jsonb not null default '[]'::jsonb,
  notes text,
  is_quality boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6. integration_connections
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('strava','healthkit','garmin')),
  provider_athlete_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- 7. activities
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('strava','healthkit','garmin','manual')),
  source_id text not null,
  start_date timestamptz,
  local_date date,
  distance_meters integer,
  moving_time_s integer,
  elapsed_time_s integer,
  avg_hr integer,
  max_hr integer,
  suffer_score integer,
  name text,
  laps jsonb,
  user_note text,
  raw jsonb,
  sport_type text,
  dedup_group_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_id)
);

-- 8. workout_matches
create table if not exists public.workout_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  match_type text not null check (match_type in ('auto','manual')),
  quality_completed boolean not null default false,
  quality_source text check (quality_source in ('auto','confirmed','manual')),
  created_at timestamptz not null default now(),
  unique (activity_id)
);

-- 9. plan_chats
create table if not exists public.plan_chats (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 10. plan_changes
create table if not exists public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  actor_type text check (actor_type in ('user','coach','generate','adapt','import')),
  actor_user_id uuid references auth.users(id) on delete set null,
  source text check (source in ('manual','coach_chat','generate','import','adapt')),
  change jsonb,
  created_at timestamptz not null default now()
);

-- 11. generation_log
create table if not exists public.generation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  endpoint text,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,4),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Indexes
-- ============================================================================
create index if not exists activities_user_local_date_idx on public.activities (user_id, local_date);
create index if not exists workouts_plan_date_idx on public.workouts (plan_id, date);
create index if not exists plan_weeks_plan_week_idx on public.plan_weeks (plan_id, week_index);
create index if not exists workout_matches_workout_idx on public.workout_matches (workout_id);
create index if not exists plan_members_user_idx on public.plan_members (user_id);

-- ============================================================================
-- Access helper functions (the adaptive seam — centralize access logic).
-- SECURITY DEFINER + stable, owned by the migration runner which bypasses RLS,
-- so referencing them in policies does NOT cause RLS recursion.
-- ============================================================================
create or replace function public.auth_can_read_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.plan_members m
    where m.plan_id = p_plan_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.auth_can_write_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.plan_members m
    where m.plan_id = p_plan_id
      and m.user_id = auth.uid()
      and m.role in ('owner','coach')
  );
$$;

create or replace function public.auth_can_read_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id = auth.uid();
$$;

-- ============================================================================
-- Owner-bootstrap trigger: a freshly-inserted plan gets an owner membership row.
-- SECURITY DEFINER so it bypasses plan_members RLS.
-- ============================================================================
create or replace function public.add_plan_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.plan_members (plan_id, user_id, role)
  values (new.id, auth.uid(), 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists add_plan_owner_trigger on public.plans;
create trigger add_plan_owner_trigger
  after insert on public.plans
  for each row
  execute function public.add_plan_owner();

-- ============================================================================
-- Enable RLS on all tables
-- ============================================================================
alter table public.users enable row level security;
alter table public.plans enable row level security;
alter table public.plan_members enable row level security;
alter table public.plan_weeks enable row level security;
alter table public.workouts enable row level security;
alter table public.integration_connections enable row level security;
alter table public.activities enable row level security;
alter table public.workout_matches enable row level security;
alter table public.plan_chats enable row level security;
alter table public.plan_changes enable row level security;
alter table public.generation_log enable row level security;

-- ============================================================================
-- Policies
-- ============================================================================

-- users: own row only
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select using (id = auth.uid());
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert with check (id = auth.uid());
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- plans
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select using (public.auth_can_read_plan(id));
drop policy if exists plans_insert on public.plans;
create policy plans_insert on public.plans
  for insert with check (auth.uid() is not null);
drop policy if exists plans_update on public.plans;
create policy plans_update on public.plans
  for update using (public.auth_can_write_plan(id)) with check (public.auth_can_write_plan(id));
drop policy if exists plans_delete on public.plans;
create policy plans_delete on public.plans
  for delete using (public.auth_can_write_plan(id));

-- plan_members
drop policy if exists plan_members_select on public.plan_members;
create policy plan_members_select on public.plan_members
  for select using (user_id = auth.uid() or public.auth_can_read_plan(plan_id));
drop policy if exists plan_members_insert on public.plan_members;
create policy plan_members_insert on public.plan_members
  for insert with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_members_update on public.plan_members;
create policy plan_members_update on public.plan_members
  for update using (public.auth_can_write_plan(plan_id)) with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_members_delete on public.plan_members;
create policy plan_members_delete on public.plan_members
  for delete using (public.auth_can_write_plan(plan_id));

-- plan_weeks
drop policy if exists plan_weeks_select on public.plan_weeks;
create policy plan_weeks_select on public.plan_weeks
  for select using (public.auth_can_read_plan(plan_id));
drop policy if exists plan_weeks_insert on public.plan_weeks;
create policy plan_weeks_insert on public.plan_weeks
  for insert with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_weeks_update on public.plan_weeks;
create policy plan_weeks_update on public.plan_weeks
  for update using (public.auth_can_write_plan(plan_id)) with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_weeks_delete on public.plan_weeks;
create policy plan_weeks_delete on public.plan_weeks
  for delete using (public.auth_can_write_plan(plan_id));

-- workouts
drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts
  for select using (public.auth_can_read_plan(plan_id));
drop policy if exists workouts_insert on public.workouts;
create policy workouts_insert on public.workouts
  for insert with check (public.auth_can_write_plan(plan_id));
drop policy if exists workouts_update on public.workouts;
create policy workouts_update on public.workouts
  for update using (public.auth_can_write_plan(plan_id)) with check (public.auth_can_write_plan(plan_id));
drop policy if exists workouts_delete on public.workouts;
create policy workouts_delete on public.workouts
  for delete using (public.auth_can_write_plan(plan_id));

-- plan_chats
drop policy if exists plan_chats_select on public.plan_chats;
create policy plan_chats_select on public.plan_chats
  for select using (public.auth_can_read_plan(plan_id));
drop policy if exists plan_chats_insert on public.plan_chats;
create policy plan_chats_insert on public.plan_chats
  for insert with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_chats_update on public.plan_chats;
create policy plan_chats_update on public.plan_chats
  for update using (public.auth_can_write_plan(plan_id)) with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_chats_delete on public.plan_chats;
create policy plan_chats_delete on public.plan_chats
  for delete using (public.auth_can_write_plan(plan_id));

-- plan_changes
drop policy if exists plan_changes_select on public.plan_changes;
create policy plan_changes_select on public.plan_changes
  for select using (public.auth_can_read_plan(plan_id));
drop policy if exists plan_changes_insert on public.plan_changes;
create policy plan_changes_insert on public.plan_changes
  for insert with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_changes_update on public.plan_changes;
create policy plan_changes_update on public.plan_changes
  for update using (public.auth_can_write_plan(plan_id)) with check (public.auth_can_write_plan(plan_id));
drop policy if exists plan_changes_delete on public.plan_changes;
create policy plan_changes_delete on public.plan_changes
  for delete using (public.auth_can_write_plan(plan_id));

-- activities: personal, user_id = auth.uid()
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select using (public.auth_can_read_user(user_id));
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert with check (public.auth_can_read_user(user_id));
drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update using (public.auth_can_read_user(user_id)) with check (public.auth_can_read_user(user_id));
drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities
  for delete using (public.auth_can_read_user(user_id));

-- workout_matches: personal, user_id = auth.uid()
drop policy if exists workout_matches_select on public.workout_matches;
create policy workout_matches_select on public.workout_matches
  for select using (public.auth_can_read_user(user_id));
drop policy if exists workout_matches_insert on public.workout_matches;
create policy workout_matches_insert on public.workout_matches
  for insert with check (public.auth_can_read_user(user_id));
drop policy if exists workout_matches_update on public.workout_matches;
create policy workout_matches_update on public.workout_matches
  for update using (public.auth_can_read_user(user_id)) with check (public.auth_can_read_user(user_id));
drop policy if exists workout_matches_delete on public.workout_matches;
create policy workout_matches_delete on public.workout_matches
  for delete using (public.auth_can_read_user(user_id));

-- integration_connections: RLS enabled, NO policies. This makes the table
-- unreachable by the anon/authenticated client roles; only the service role
-- (which bypasses RLS) may read/write OAuth tokens here. Intentionally no policies.

-- generation_log: users may read their own rows; no client insert policy
-- (rows are written by the service role, which bypasses RLS).
drop policy if exists generation_log_select on public.generation_log;
create policy generation_log_select on public.generation_log
  for select using (user_id = auth.uid());
