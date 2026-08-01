-- 0024_due_v3_pace_prescriptions.sql
--
-- Cut workout structures over to the Due v3 pace union:
--
--   relative: { kind, reference, speed_fraction, resolved? }
--   absolute: { kind, band: { fast_s_per_km, slow_s_per_km }, intent? }
--
-- This is deliberately a one-way migration. Runtime code does not read the
-- v2 pace_* fields after this migration.

create or replace function public._due_v3_target(
  p_target jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_target jsonb := coalesce(p_target, '{}'::jsonb);
  v_label text;
  v_exact numeric;
  v_first numeric;
  v_second numeric;
  v_fast integer;
  v_slow integer;
  v_fraction_match text[];
  v_fraction numeric;
  v_pace jsonb;
begin
  if jsonb_typeof(v_target) <> 'object' then
    return v_target;
  end if;

  -- Already-v3 targets win. Still remove any stale v2 keys so there is only
  -- one source of truth after the cutover.
  if v_target ? 'pace' then
    return v_target
      - 'pace_s_per_km'
      - 'pace_min_s_per_km'
      - 'pace_max_s_per_km'
      - 'pace_label';
  end if;

  v_label := nullif(v_target ->> 'pace_label', '');

  if coalesce(v_target ->> 'pace_s_per_km', '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_exact := (v_target ->> 'pace_s_per_km')::numeric;
    if v_exact > 0 then
      v_fast := round(v_exact)::integer;
      v_slow := v_fast;
    end if;
  elsif coalesce(v_target ->> 'pace_min_s_per_km', '') ~ '^[0-9]+([.][0-9]+)?$'
    and coalesce(v_target ->> 'pace_max_s_per_km', '') ~ '^[0-9]+([.][0-9]+)?$'
  then
    v_first := (v_target ->> 'pace_min_s_per_km')::numeric;
    v_second := (v_target ->> 'pace_max_s_per_km')::numeric;
    if v_first > 0 and v_second > 0 then
      v_fast := round(least(v_first, v_second))::integer;
      v_slow := round(greatest(v_first, v_second))::integer;
    end if;
  end if;

  -- A source that explicitly states a fraction owns relative intent. A clock
  -- pace alongside it is the resolved realization, not a competing target.
  if v_label is not null then
    v_fraction_match := regexp_match(
      coalesce(p_note, ''),
      '([0-9]+([.][0-9]+)?)[[:space:]]*%[[:space:]]*(of[[:space:]]*)?(MP|HMP|marathon pace|half marathon pace)',
      'i'
    );
    if v_fraction_match is not null then
      v_fraction := (v_fraction_match[1])::numeric / 100;
    end if;
  end if;

  if v_label is not null and v_fraction is not null and v_fraction > 0 then
    v_pace := jsonb_build_object(
      'kind', 'relative',
      'reference', v_label,
      'speed_fraction', v_fraction
    );
    if v_fast is not null and v_slow is not null then
      v_pace := v_pace || jsonb_build_object(
        'resolved',
        jsonb_build_object(
          'fast_s_per_km', v_fast,
          'slow_s_per_km', v_slow
        )
      );
    end if;
  elsif v_fast is not null and v_slow is not null then
    v_pace := jsonb_build_object(
      'kind', 'absolute',
      'band', jsonb_build_object(
        'fast_s_per_km', v_fast,
        'slow_s_per_km', v_slow
      )
    );
    if v_label is not null then
      v_pace := v_pace || jsonb_build_object('intent', v_label);
    end if;
  elsif v_label is not null then
    v_pace := jsonb_build_object(
      'kind', 'relative',
      'reference', v_label,
      'speed_fraction', 1
    );
  end if;

  v_target := v_target
    - 'pace_s_per_km'
    - 'pace_min_s_per_km'
    - 'pace_max_s_per_km'
    - 'pace_label';

  if v_pace is not null then
    v_target := v_target || jsonb_build_object('pace', v_pace);
  end if;

  return v_target;
end;
$$;

create or replace function public._due_v3_segments(p_segments jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_segment jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_segment in select value from jsonb_array_elements(p_segments)
  loop
    if v_segment ->> 'kind' = 'repeat' then
      v_segment := jsonb_set(
        v_segment,
        '{children}',
        public._due_v3_segments(v_segment -> 'children'),
        true
      );
    elsif v_segment ? 'target' then
      v_segment := jsonb_set(
        v_segment,
        '{target}',
        public._due_v3_target(v_segment -> 'target', v_segment ->> 'note'),
        true
      );
    end if;
    v_result := v_result || jsonb_build_array(v_segment);
  end loop;

  return v_result;
end;
$$;

update public.workouts
set structure = public._due_v3_segments(structure)
where structure::text ~ '"pace_(s_per_km|min_s_per_km|max_s_per_km|label)"[[:space:]]*:';

alter table public.workouts
  drop constraint if exists workouts_structure_due_v3;

alter table public.workouts
  add constraint workouts_structure_due_v3
  check (
    structure::text !~
      '"pace_(s_per_km|min_s_per_km|max_s_per_km|label)"[[:space:]]*:'
  );

drop function public._due_v3_segments(jsonb);
drop function public._due_v3_target(jsonb, text);

