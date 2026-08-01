-- 0020_week_supporting_contracts.sql — make Quality + Long true week contracts.
--
-- Mileage already lives on plan_weeks. Quality and Long were being re-derived
-- from the CURRENT workout allocation, so removing/retyping a workout silently
-- rewrote its goal. Store both supporting targets alongside mileage instead.

alter table public.plan_weeks
  add column if not exists quality_target_meters integer,
  add column if not exists long_target_meters integer;

-- Temporary recursive helper used only to backfill the hard-distance target in
-- existing plans. It mirrors prescribedQualityMeters in TypeScript: repeat sets
-- multiply hard leaves; explicit easy HR wins; a tagged, unstructured quality
-- workout falls back to 60% of its planned distance.
create or replace function public._due_quality_hard_meters(
  p_segments jsonb,
  p_multiplier numeric default 1
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_segment jsonb;
  v_target jsonb;
  v_kind text;
  v_hr_zone text;
  v_pace_label text;
  v_sets numeric;
  v_distance numeric;
  v_total numeric := 0;
  v_hard boolean;
begin
  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    return 0;
  end if;

  for v_segment in select value from jsonb_array_elements(p_segments)
  loop
    v_kind := v_segment ->> 'kind';

    if v_kind = 'repeat' then
      v_sets := case
        when coalesce(v_segment ->> 'sets', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (v_segment ->> 'sets')::numeric
        else 0
      end;
      if v_sets > 0 then
        v_total := v_total + public._due_quality_hard_meters(
          v_segment -> 'children',
          p_multiplier * v_sets
        );
      end if;
      continue;
    end if;

    v_target := coalesce(v_segment -> 'target', '{}'::jsonb);
    v_hr_zone := v_target ->> 'hr_zone';
    v_pace_label := v_target ->> 'pace_label';
    v_hard := false;

    if v_kind in ('interval', 'work') then
      v_hard := true;
    elsif v_hr_zone = 'easy' then
      v_hard := false;
    elsif v_pace_label in ('threshold', 'tempo', '5K', '10K', '3K', 'mile', 'rep', 'HMP', 'MP') then
      v_hard := true;
    elsif v_kind = 'steady' then
      v_hard := true;
    end if;

    if v_hard and coalesce(v_target ->> 'distance_m', '') ~ '^[0-9]+([.][0-9]+)?$' then
      v_distance := (v_target ->> 'distance_m')::numeric;
      if v_distance > 0 then
        v_total := v_total + v_distance * p_multiplier;
      end if;
    end if;
  end loop;

  return v_total;
end;
$$;

with workout_contracts as (
  select
    pw.id as week_id,
    coalesce(round(sum(
      case
        when public._due_quality_hard_meters(w.structure) > 0
          then public._due_quality_hard_meters(w.structure)
        when coalesce(w.is_quality, false) and coalesce(w.planned_distance_meters, 0) > 0
          then w.planned_distance_meters * 0.6
        else 0
      end
    )), 0)::integer as quality_target_meters,
    coalesce(max(
      case
        when lower(coalesce(w.type, '')) in ('long', 'race')
          then coalesce(w.planned_distance_meters, 0)
        else 0
      end
    ), 0)::integer as long_target_meters
  from public.plan_weeks pw
  left join public.workouts w on w.week_id = pw.id and coalesce(w.type, '') <> 'rest'
  group by pw.id
)
update public.plan_weeks pw
set
  quality_target_meters = coalesce(pw.quality_target_meters, wc.quality_target_meters),
  long_target_meters = coalesce(pw.long_target_meters, wc.long_target_meters)
from workout_contracts wc
where wc.week_id = pw.id
  and (pw.quality_target_meters is null or pw.long_target_meters is null);

drop function public._due_quality_hard_meters(jsonb, numeric);

alter table public.plan_weeks
  alter column quality_target_meters set default 0,
  alter column quality_target_meters set not null,
  alter column long_target_meters set default 0,
  alter column long_target_meters set not null;

-- Redefine the plan installer so new drafts persist the two captured supporting
-- contracts. The rest-day behavior remains the same as migration 0012.
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
    id, race_name, race_date, distance_kind, race_distance_meters, goal_time,
    start_date, num_weeks, created_via, visibility, status
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
      plan_id, week_index, phase, target_meters, target_low_meters,
      target_high_meters, original_target_meters, quality_target_meters,
      long_target_meters, is_recovery
    )
    values (
      v_plan_id,
      (v_week ->> 'weekIndex')::integer,
      v_week ->> 'phase',
      nullif(v_week ->> 'targetMeters', '')::integer,
      nullif(v_week ->> 'targetLowMeters', '')::integer,
      nullif(v_week ->> 'targetHighMeters', '')::integer,
      nullif(v_week ->> 'originalTargetMeters', '')::integer,
      coalesce(nullif(v_week ->> 'qualityTargetMeters', '')::integer, 0),
      coalesce(nullif(v_week ->> 'longTargetMeters', '')::integer, 0),
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
      plan_id, week_id, date, type, title, planned_distance_meters,
      planned_duration_s, structure, notes, is_quality
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
