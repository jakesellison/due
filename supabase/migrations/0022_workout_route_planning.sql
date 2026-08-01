-- 0022_workout_route_planning.sql — private, workout-aware route planning.
--
-- A route is a reusable Due-created object. A workout selection is private to
-- one user and one workout; replacing the selection does not mutate the route.
-- Referenced geometry is immutable so a saved workout never silently changes.

alter table public.routes
  add column if not exists archived_at timestamptz,
  add column if not exists provenance text not null default 'due_builder';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'routes_provenance_check'
      and conrelid = 'public.routes'::regclass
  ) then
    alter table public.routes
      add constraint routes_provenance_check
      check (provenance = 'due_builder');
  end if;
end $$;

create index if not exists idx_routes_user_active
  on public.routes (user_id, updated_at desc)
  where archived_at is null;

-- Validate every write path, including library-only creation. NOT VALID avoids
-- blocking this migration on legacy rows while still enforcing new writes.
create or replace function public.valid_route_coordinates(
  p_coordinates jsonb,
  p_max_points integer
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_point jsonb;
  v_lat double precision;
  v_lng double precision;
begin
  if jsonb_typeof(p_coordinates) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_coordinates) < 2
    or jsonb_array_length(p_coordinates) > p_max_points then
    return false;
  end if;
  for v_point in select value from jsonb_array_elements(p_coordinates)
  loop
    if jsonb_typeof(v_point) <> 'array' then
      return false;
    end if;
    if jsonb_array_length(v_point) <> 2
      or jsonb_typeof(v_point -> 0) <> 'number'
      or jsonb_typeof(v_point -> 1) <> 'number' then
      return false;
    end if;
    v_lat := (v_point ->> 0)::double precision;
    v_lng := (v_point ->> 1)::double precision;
    if v_lat < -90 or v_lat > 90
      or v_lng < -180 or v_lng > 180 then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'routes_name_length_check' and conrelid = 'public.routes'::regclass) then
    alter table public.routes add constraint routes_name_length_check
      check (length(trim(name)) between 1 and 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routes_points_shape_check' and conrelid = 'public.routes'::regclass) then
    alter table public.routes add constraint routes_points_shape_check
      check (public.valid_route_coordinates(points, 200)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routes_path_shape_check' and conrelid = 'public.routes'::regclass) then
    alter table public.routes add constraint routes_path_shape_check
      check (path is null or public.valid_route_coordinates(path, 300)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routes_distance_bounds_check' and conrelid = 'public.routes'::regclass) then
    alter table public.routes add constraint routes_distance_bounds_check
      check (distance_meters between 1 and 250000) not valid;
  end if;
end $$;

create table if not exists public.workout_route_selections (
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, workout_id)
);

create index if not exists idx_workout_route_selections_workout
  on public.workout_route_selections (workout_id);
create index if not exists idx_workout_route_selections_route
  on public.workout_route_selections (route_id);

alter table public.workout_route_selections enable row level security;

drop policy if exists workout_route_selections_select on public.workout_route_selections;
create policy workout_route_selections_select on public.workout_route_selections
  for select using (
    public.auth_can_read_user(user_id)
    and exists (
      select 1 from public.routes r
      where r.id = route_id
        and r.user_id = workout_route_selections.user_id
    )
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id and public.auth_can_read_plan(w.plan_id)
    )
  );

drop policy if exists workout_route_selections_insert on public.workout_route_selections;
create policy workout_route_selections_insert on public.workout_route_selections
  for insert with check (
    public.auth_can_read_user(user_id)
    and exists (
      select 1 from public.routes r
      where r.id = route_id
        and r.user_id = workout_route_selections.user_id
        and r.archived_at is null
        and r.provenance = 'due_builder'
    )
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and w.type <> 'rest'
        and coalesce(w.planned_distance_meters, 0) > 0
        and public.auth_can_read_plan(w.plan_id)
        and exists (
          select 1 from public.plans p where p.id = w.plan_id and p.status = 'active'
        )
    )
  );

drop policy if exists workout_route_selections_update on public.workout_route_selections;
create policy workout_route_selections_update on public.workout_route_selections
  for update using (
    public.auth_can_read_user(user_id)
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id and public.auth_can_read_plan(w.plan_id)
    )
  ) with check (
    public.auth_can_read_user(user_id)
    and exists (
      select 1 from public.routes r
      where r.id = route_id
        and r.user_id = workout_route_selections.user_id
        and r.archived_at is null
        and r.provenance = 'due_builder'
    )
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and w.type <> 'rest'
        and coalesce(w.planned_distance_meters, 0) > 0
        and public.auth_can_read_plan(w.plan_id)
        and exists (
          select 1 from public.plans p where p.id = w.plan_id and p.status = 'active'
        )
    )
  );

drop policy if exists workout_route_selections_delete on public.workout_route_selections;
create policy workout_route_selections_delete on public.workout_route_selections
  for delete using (
    public.auth_can_read_user(user_id)
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and public.auth_can_read_plan(w.plan_id)
        and exists (
          select 1 from public.plans p where p.id = w.plan_id and p.status = 'active'
        )
    )
  );

create or replace function public.guard_attached_route_geometry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.points is distinct from old.points
    or new.path is distinct from old.path
    or new.distance_meters is distinct from old.distance_meters
  ) and exists (
    select 1 from public.workout_route_selections s where s.route_id = old.id
  ) then
    raise exception 'Attached route geometry is immutable; create a copy instead.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists routes_guard_attached_geometry on public.routes;
create trigger routes_guard_attached_geometry
  before update of points, path, distance_meters on public.routes
  for each row execute function public.guard_attached_route_geometry();

-- A workout can keep its stable id while being edited into a rest or
-- duration-only session. Detach every private selection when that happens.
create or replace function public.detach_routes_from_unplannable_workout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'rest' or coalesce(new.planned_distance_meters, 0) <= 0 then
    delete from public.workout_route_selections where workout_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.detach_routes_from_unplannable_workout() from public;

drop trigger if exists workouts_detach_unplannable_routes on public.workouts;
create trigger workouts_detach_unplannable_routes
  after update of type, planned_distance_meters on public.workouts
  for each row execute function public.detach_routes_from_unplannable_workout();

-- Creating a new route from a workout must not leave a saved-but-unattached
-- route if the second write fails. This function makes both writes atomic and
-- re-derives permission/lifecycle from the workout row in the database.
create or replace function public.create_route_and_attach(
  p_workout_id uuid,
  p_name text,
  p_points jsonb,
  p_path jsonb,
  p_distance_meters integer
)
returns public.routes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_type text;
  v_target integer;
  v_plan_status text;
  v_route public.routes;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'Route name is required.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) < 2 then
    raise exception 'A route needs at least two waypoints.' using errcode = '23514';
  end if;
  if p_distance_meters is null or p_distance_meters <= 0 then
    raise exception 'Route distance must be positive.' using errcode = '23514';
  end if;

  select w.plan_id, w.type, w.planned_distance_meters, p.status
    into v_plan_id, v_type, v_target, v_plan_status
    from public.workouts w
    join public.plans p on p.id = w.plan_id
    where w.id = p_workout_id
    for share of w, p;

  if v_plan_id is null or not public.auth_can_read_plan(v_plan_id) then
    raise exception 'Workout is unavailable.' using errcode = '42501';
  end if;
  if v_plan_status <> 'active' or v_type = 'rest' or coalesce(v_target, 0) <= 0 then
    raise exception 'This workout does not support route planning.' using errcode = '23514';
  end if;

  insert into public.routes (
    user_id, name, points, path, distance_meters, provenance
  ) values (
    v_user_id, trim(p_name), p_points, p_path, p_distance_meters, 'due_builder'
  )
  returning * into v_route;

  insert into public.workout_route_selections (
    user_id, workout_id, route_id
  ) values (
    v_user_id, p_workout_id, v_route.id
  )
  on conflict (user_id, workout_id) do update
    set route_id = excluded.route_id, updated_at = now();

  return v_route;
end;
$$;

grant execute on function public.create_route_and_attach(uuid, text, jsonb, jsonb, integer)
  to authenticated;
