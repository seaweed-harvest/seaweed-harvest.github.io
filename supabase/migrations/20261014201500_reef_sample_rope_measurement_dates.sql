-- Sample Rope register: per-measurement date saved on each active rope cycle.
-- Older clients that do not submit week_date keys retain previously stored dates.
-- Existing cycles, weights, history, and access policies stay unchanged.
begin;

alter table public.ag_reef_sample_rope_cycles
  add column if not exists week_2_date date,
  add column if not exists week_4_date date,
  add column if not exists week_6_date date;

comment on column public.ag_reef_sample_rope_cycles.week_2_date is 'Date Week 2 measurement was taken, independent of seeding date.';
comment on column public.ag_reef_sample_rope_cycles.week_4_date is 'Date Week 4 measurement was taken.';
comment on column public.ag_reef_sample_rope_cycles.week_6_date is 'Date Week 6 measurement was taken.';

CREATE OR REPLACE FUNCTION public.ag_reef_sample_rope_rows_validate(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row jsonb;
  v_unknown_keys text[];
  v_rope_number integer;
  v_species text;
  v_date_seeded date;
  v_week_2_date date;
  v_week_4_date date;
  v_week_6_date date;
  v_rope_weight numeric;
  v_initial_weight numeric;
  v_week_2 numeric;
  v_week_4 numeric;
  v_week_6 numeric;
  v_seen integer[] := '{}'::integer[];
  v_normalized jsonb := '[]'::jsonb;
begin
  if p_rows is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 6 then
    raise exception 'Sample Rope Register rows must be an array of no more than 6 rows.' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Each Sample Rope Register row must be an object.' using errcode = '22023';
    end if;
    select array_agg(key order by key) into v_unknown_keys
    from jsonb_object_keys(v_row) key
    where key <> all(array['rope_number','species','date_seeded','rope_weight_kg','initial_weight_kg','week_2_kg','week_4_kg','week_6_kg','week_2_date','week_4_date','week_6_date']::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported Sample Rope fields: %', array_to_string(v_unknown_keys, ', ') using errcode = '22023';
    end if;
    begin
      v_rope_number := nullif(v_row ->> 'rope_number', '')::integer;
      v_date_seeded := nullif(v_row ->> 'date_seeded', '')::date;
      v_week_2_date := nullif(v_row ->> 'week_2_date', '')::date;
      v_week_4_date := nullif(v_row ->> 'week_4_date', '')::date;
      v_week_6_date := nullif(v_row ->> 'week_6_date', '')::date;
      v_rope_weight := nullif(v_row ->> 'rope_weight_kg', '')::numeric;
      v_initial_weight := nullif(v_row ->> 'initial_weight_kg', '')::numeric;
      v_week_2 := nullif(v_row ->> 'week_2_kg', '')::numeric;
      v_week_4 := nullif(v_row ->> 'week_4_kg', '')::numeric;
      v_week_6 := nullif(v_row ->> 'week_6_kg', '')::numeric;
    exception when others then
      raise exception 'Enter valid Sample Rope dates and weights.' using errcode = '22023';
    end;
    v_species := lower(nullif(trim(v_row ->> 'species'), ''));
    if v_rope_number is null or v_rope_number not in (1,2,5,6,9,10) then
      raise exception 'Sample rope must be Rope 1, 2, 5, 6, 9 or 10.' using errcode = '22023';
    end if;
    if v_rope_number = any(v_seen) then
      raise exception 'Each sample rope can appear only once in a save.' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_rope_number);
    if v_species is not null and v_species not in ('spinosum','cottonii') then
      raise exception 'Sample Rope species must be Spinosum or Cottonii.' using errcode = '22023';
    end if;
    if v_rope_weight is not null and (v_rope_weight <= 0 or v_rope_weight > 100000) then raise exception 'Sample Rope rope weight is outside the allowed range.' using errcode='22023'; end if;
    if v_initial_weight is not null and (v_initial_weight <= 0 or v_initial_weight > 100000) then raise exception 'Sample Rope initial weight is outside the allowed range.' using errcode='22023'; end if;
    if v_week_2 is not null and (v_week_2 <= 0 or v_week_2 > 100000) then raise exception 'Sample Rope Week 2 weight is outside the allowed range.' using errcode='22023'; end if;
    if v_week_4 is not null and (v_week_4 <= 0 or v_week_4 > 100000) then raise exception 'Sample Rope Week 4 weight is outside the allowed range.' using errcode='22023'; end if;
    if v_week_6 is not null and (v_week_6 <= 0 or v_week_6 > 100000) then raise exception 'Sample Rope Week 6 weight is outside the allowed range.' using errcode='22023'; end if;
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'rope_number',v_rope_number,'species',v_species,'date_seeded',v_date_seeded,'rope_weight_kg',v_rope_weight,'initial_weight_kg',v_initial_weight,'week_2_kg',v_week_2,'week_4_kg',v_week_4,'week_6_kg',v_week_6)
      || (case when v_row ? 'week_2_date' then jsonb_build_object('week_2_date',v_week_2_date) else '{}'::jsonb end)
      || (case when v_row ? 'week_4_date' then jsonb_build_object('week_4_date',v_week_4_date) else '{}'::jsonb end)
      || (case when v_row ? 'week_6_date' then jsonb_build_object('week_6_date',v_week_6_date) else '{}'::jsonb end));
  end loop;
  return v_normalized;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ag_reef_sample_rope_register_internal(p_aggregator_id uuid, p_site_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_site public.ag_reef_sites%rowtype;
  v_rows jsonb;
begin
  select *
  into v_site
  from public.ag_reef_sites
  where site_code = upper(trim(p_site_code))
    and is_active;

  if not found then
    raise exception 'Selected Reef site was not found.' using errcode = 'P0002';
  end if;

  with rope_list as (
    select *
    from unnest(array[1,2,5,6,9,10]::integer[]) with ordinality as ropes(rope_number, sort_order)
  ),
  active_cycles as (
    select cycle.*
    from public.ag_reef_sample_rope_cycles cycle
    where cycle.aggregator_id = p_aggregator_id
      and cycle.site_code = v_site.site_code
      and cycle.status = 'active'
      and cycle.deleted_at is null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rope_number', ropes.rope_number,
        'cycle_id', active.id,
        'cycle_number', active.cycle_number,
        'species', active.species,
        'date_seeded', active.date_seeded,
        'rope_weight_kg', active.rope_weight_kg,
        'initial_weight_kg', active.initial_weight_kg,
        'week_2_kg', active.week_2_kg,
        'week_4_kg', active.week_4_kg,
        'week_6_kg', active.week_6_kg,
        'week_2_date', active.week_2_date,
        'week_4_date', active.week_4_date,
        'week_6_date', active.week_6_date,
        'started_at', active.started_at,
        'updated_at', active.updated_at,
        'history_count', (
          select count(*)
          from public.ag_reef_sample_rope_cycles history
          where history.aggregator_id = p_aggregator_id
            and history.site_code = v_site.site_code
            and history.rope_number = ropes.rope_number
            and history.status = 'closed'
            and history.deleted_at is null
        )
      )
      order by ropes.sort_order
    ),
    '[]'::jsonb
  )
  into v_rows
  from rope_list ropes
  left join active_cycles active on active.rope_number = ropes.rope_number;

  return jsonb_build_object(
    'site_code', v_site.site_code,
    'location', v_site.location,
    'site_name', v_site.site_name,
    'structure_type', v_site.structure_type,
    'rows', v_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ag_reef_sample_rope_save_internal(p_aggregator_id uuid, p_site_code text, p_rows jsonb, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_site_code text := upper(trim(p_site_code));
  v_rows jsonb := public.ag_reef_sample_rope_rows_validate(p_rows);
  v_row jsonb;
  v_rope_number integer;
  v_existing public.ag_reef_sample_rope_cycles%rowtype;
  v_cycle_number integer;
  v_has_data boolean;
begin
  if p_aggregator_id is null then
    raise exception 'Reef organisation context is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ag_reef_sites site
    where site.site_code = v_site_code
      and site.is_active
  ) then
    raise exception 'Selected Reef site was not found.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_aggregator_id::text || ':' || v_site_code, 0));

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_rope_number := (v_row ->> 'rope_number')::integer;
    v_has_data :=
      coalesce(v_row ->> 'species', '') <> ''
      or coalesce(v_row ->> 'date_seeded', '') <> ''
      or coalesce(v_row ->> 'rope_weight_kg', '') <> ''
      or coalesce(v_row ->> 'initial_weight_kg', '') <> ''
      or coalesce(v_row ->> 'week_2_kg', '') <> ''
      or coalesce(v_row ->> 'week_4_kg', '') <> ''
      or coalesce(v_row ->> 'week_6_kg', '') <> ''
      or coalesce(v_row ->> 'week_2_date', '') <> ''
      or coalesce(v_row ->> 'week_4_date', '') <> ''
      or coalesce(v_row ->> 'week_6_date', '') <> '';

    select *
    into v_existing
    from public.ag_reef_sample_rope_cycles cycle
    where cycle.aggregator_id = p_aggregator_id
      and cycle.site_code = v_site_code
      and cycle.rope_number = v_rope_number
      and cycle.status = 'active'
      and cycle.deleted_at is null
    for update;

    if found then
      update public.ag_reef_sample_rope_cycles
      set species = nullif(v_row ->> 'species', ''),
          date_seeded = nullif(v_row ->> 'date_seeded', '')::date,
          rope_weight_kg = nullif(v_row ->> 'rope_weight_kg', '')::numeric,
          initial_weight_kg = nullif(v_row ->> 'initial_weight_kg', '')::numeric,
          week_2_kg = nullif(v_row ->> 'week_2_kg', '')::numeric,
          week_4_kg = nullif(v_row ->> 'week_4_kg', '')::numeric,
          week_6_kg = nullif(v_row ->> 'week_6_kg', '')::numeric,
          week_2_date = case when v_row ? 'week_2_date' then nullif(v_row ->> 'week_2_date', '')::date else week_2_date end,
          week_4_date = case when v_row ? 'week_4_date' then nullif(v_row ->> 'week_4_date', '')::date else week_4_date end,
          week_6_date = case when v_row ? 'week_6_date' then nullif(v_row ->> 'week_6_date', '')::date else week_6_date end,
          updated_by_user_id = p_actor_id,
          updated_at = clock_timestamp()
      where id = v_existing.id;
    elsif v_has_data then
      select coalesce(max(cycle.cycle_number), 0) + 1
      into v_cycle_number
      from public.ag_reef_sample_rope_cycles cycle
      where cycle.aggregator_id = p_aggregator_id
        and cycle.site_code = v_site_code
        and cycle.rope_number = v_rope_number;

      insert into public.ag_reef_sample_rope_cycles (
        aggregator_id,
        site_code,
        rope_number,
        cycle_number,
        species,
        date_seeded,
        rope_weight_kg,
        initial_weight_kg,
        week_2_kg,
        week_4_kg,
        week_6_kg,
        week_2_date,
        week_4_date,
        week_6_date,
        created_by_user_id,
        updated_by_user_id
      ) values (
        p_aggregator_id,
        v_site_code,
        v_rope_number,
        v_cycle_number,
        nullif(v_row ->> 'species', ''),
        nullif(v_row ->> 'date_seeded', '')::date,
        nullif(v_row ->> 'rope_weight_kg', '')::numeric,
        nullif(v_row ->> 'initial_weight_kg', '')::numeric,
        nullif(v_row ->> 'week_2_kg', '')::numeric,
        nullif(v_row ->> 'week_4_kg', '')::numeric,
        nullif(v_row ->> 'week_6_kg', '')::numeric,
        nullif(v_row ->> 'week_2_date', '')::date,
        nullif(v_row ->> 'week_4_date', '')::date,
        nullif(v_row ->> 'week_6_date', '')::date,
        p_actor_id,
        p_actor_id
      );
    end if;
  end loop;

  return public.ag_reef_sample_rope_register_internal(p_aggregator_id, v_site_code);
end;
$function$;

commit;
