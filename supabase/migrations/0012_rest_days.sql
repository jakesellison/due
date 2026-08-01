-- 0012_rest_days.sql — every day of a training week is a real workouts row.
--
-- Rest days were previously the ABSENCE of a row, which forced every "show the
-- week" surface (editor, reflow, lists) to synthesise the missing days and
-- special-case "no row". This makes rest days first-class: a `type='rest'`,
-- 0-mile row for every dateless day. Week boundaries follow the plan exactly
-- (start_date + N*7, Monday-aligned), matching planView's `weekStarts`.

-- Fill any day with no workout row in each of a plan's weeks with a rest row.
-- Idempotent: skips dates that already have a row, so re-running is a no-op.
create or replace function public.fill_rest_days(p_plan_id uuid)
returns void
language plpgsql
as $$
declare
  v_start date;
  v_week  record;
  v_date  date;
begin
  select start_date into v_start from public.plans where id = p_plan_id;
  if v_start is null then
    return;
  end if;

  for v_week in
    select id, (row_number() over (order by week_index) - 1) as ord
    from public.plan_weeks
    where plan_id = p_plan_id
  loop
    for v_date in
      select (v_start + (v_week.ord * 7 + gs)::integer)
      from generate_series(0, 6) as gs
    loop
      if not exists (
        select 1 from public.workouts
        where week_id = v_week.id and date = v_date
      ) then
        insert into public.workouts (
          plan_id, week_id, date, type, title, planned_distance_meters, structure, is_quality
        )
        values (p_plan_id, v_week.id, v_date, 'rest', 'Rest', 0, '[]'::jsonb, false);
      end if;
    end loop;
  end loop;
end;
$$;

-- Redefine install_plan_draft to fill rest days after inserting the draft's
-- workouts (body unchanged except the `perform fill_rest_days(...)` near the end).
create or replace function public.install_plan_draft(p_draft jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid := gen_random_uuid();
  v_archived uuid[];
  v_week jsonb;
  v_workout jsonb;
  v_week_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous_not_allowed';
  end if;

  select coalesce(array_agg(p.id), '{}')
  into v_archived
  from public.plans p
  join public.plan_members m on m.plan_id = p.id
  where p.status = 'active'
    and m.user_id = v_user_id
    and m.role in ('owner', 'coach');

  update public.plans
  set status = 'archived'
  where id = any(v_archived);

  insert into public.plans (
    id,
    race_name,
    race_date,
    distance_kind,
    race_distance_meters,
    goal_time,
    start_date,
    num_weeks,
    created_via,
    visibility,
    status
  )
  values (
    v_plan_id,
    p_draft #>> '{plan,raceName}',
    nullif(p_draft #>> '{plan,raceDate}', '')::date,
    p_draft #>> '{plan,distanceKind}',
    nullif(p_draft #>> '{plan,raceDistanceMeters}', '')::integer,
    nullif(p_draft #>> '{plan,goalTimeInterval}', '')::interval,
    (p_draft #>> '{plan,startDate}')::date,
    (p_draft #>> '{plan,numWeeks}')::integer,
    p_draft #>> '{plan,createdVia}',
    'private',
    'active'
  );

  insert into public.plan_members (plan_id, user_id, role)
  values (v_plan_id, v_user_id, 'owner')
  on conflict do nothing;

  for v_week in select value from jsonb_array_elements(coalesce(p_draft -> 'weeks', '[]'::jsonb))
  loop
    insert into public.plan_weeks (
      plan_id,
      week_index,
      phase,
      target_meters,
      target_low_meters,
      target_high_meters,
      original_target_meters,
      is_recovery
    )
    values (
      v_plan_id,
      (v_week ->> 'weekIndex')::integer,
      v_week ->> 'phase',
      nullif(v_week ->> 'targetMeters', '')::integer,
      nullif(v_week ->> 'targetLowMeters', '')::integer,
      nullif(v_week ->> 'targetHighMeters', '')::integer,
      nullif(v_week ->> 'originalTargetMeters', '')::integer,
      coalesce((v_week ->> 'isRecovery')::boolean, false)
    );
  end loop;

  for v_workout in select value from jsonb_array_elements(coalesce(p_draft -> 'workouts', '[]'::jsonb))
  loop
    select id
    into v_week_id
    from public.plan_weeks
    where plan_id = v_plan_id
      and week_index = (v_workout ->> 'weekIndex')::integer
    limit 1;

    insert into public.workouts (
      plan_id,
      week_id,
      date,
      type,
      title,
      planned_distance_meters,
      planned_duration_s,
      structure,
      notes,
      is_quality
    )
    values (
      v_plan_id,
      v_week_id,
      (v_workout ->> 'date')::date,
      v_workout ->> 'type',
      v_workout ->> 'title',
      nullif(v_workout ->> 'plannedDistanceMeters', '')::integer,
      nullif(v_workout ->> 'plannedDurationSeconds', '')::integer,
      coalesce(v_workout -> 'structure', '[]'::jsonb),
      v_workout ->> 'notes',
      coalesce((v_workout ->> 'isQuality')::boolean, false)
    );
  end loop;

  -- Fill every dateless day in each week with a rest row.
  perform public.fill_rest_days(v_plan_id);

  insert into public.plan_changes (plan_id, actor_type, actor_user_id, source, change)
  values (
    v_plan_id,
    'user',
    v_user_id,
    'import',
    jsonb_build_object(
      'kind', 'install_plan',
      'archived', coalesce(to_jsonb(v_archived), '[]'::jsonb),
      'source', p_draft ->> 'source'
    )
  );

  return v_plan_id;
end;
$$;

grant execute on function public.install_plan_draft(jsonb) to authenticated;

-- NOTE: existing plans are NOT mass-backfilled here. Most already store rest
-- days explicitly; to fill any that don't, run `fill_rest_days(<plan_id>)`
-- per plan (it is idempotent). A blanket backfill is intentionally avoided
-- because it assumes clean week structure (unique weeks aligned to start_date),
-- which dev/seed data can violate.
