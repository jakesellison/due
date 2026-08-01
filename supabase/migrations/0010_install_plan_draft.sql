-- 0010_install_plan_draft.sql — transactional install for imported/generated plans.

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
