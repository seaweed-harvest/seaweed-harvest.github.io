begin;

alter table public.ag_reef_sample_rope_cycles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references auth.users(id) on delete set null;

drop index if exists public.ag_reef_sample_rope_one_active_cycle_idx;
create unique index ag_reef_sample_rope_one_active_cycle_idx
  on public.ag_reef_sample_rope_cycles (aggregator_id, site_code, rope_number)
  where status = 'active' and deleted_at is null;

create or replace function public.ag_reef_sample_rope_register_internal(
  p_aggregator_id uuid,
  p_site_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
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

create or replace function public.ag_reef_sample_rope_save_internal(
  p_aggregator_id uuid,
  p_site_code text,
  p_rows jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
      or coalesce(v_row ->> 'week_6_kg', '') <> '';

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
        p_actor_id,
        p_actor_id
      );
    end if;
  end loop;

  return public.ag_reef_sample_rope_register_internal(p_aggregator_id, v_site_code);
end;
$function$;

create or replace function public.ag_reef_sample_rope_start_new(
  p_site_code text,
  p_rope_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_actor_id uuid := case when v_scope ->> 'access_mode' = 'authenticated' then (select auth.uid()) else null end;
  v_site_code text := upper(trim(p_site_code));
  v_existing public.ag_reef_sample_rope_cycles%rowtype;
  v_next_cycle integer;
  v_new_id uuid;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.') using errcode = '42501';
  end if;

  if v_site_code is null or v_site_code = '' then
    raise exception 'Select a site.' using errcode = '22023';
  end if;

  if p_rope_number is null or p_rope_number not in (1,2,5,6,9,10) then
    raise exception 'Sample rope must be Rope 1, 2, 5, 6, 9 or 10.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.ag_reef_sites site
    where site.site_code = v_site_code
      and site.is_active
  ) then
    raise exception 'Selected Reef site was not found.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_aggregator_id::text || ':' || v_site_code, 0));

  select *
  into v_existing
  from public.ag_reef_sample_rope_cycles cycle
  where cycle.aggregator_id = v_aggregator_id
    and cycle.site_code = v_site_code
    and cycle.rope_number = p_rope_number
    and cycle.status = 'active'
    and cycle.deleted_at is null
  for update;

  if found then
    update public.ag_reef_sample_rope_cycles
    set status = 'closed',
        closed_at = clock_timestamp(),
        closed_by_user_id = v_actor_id,
        updated_by_user_id = v_actor_id,
        updated_at = clock_timestamp()
    where id = v_existing.id;
  end if;

  select coalesce(max(cycle.cycle_number), 0) + 1
  into v_next_cycle
  from public.ag_reef_sample_rope_cycles cycle
  where cycle.aggregator_id = v_aggregator_id
    and cycle.site_code = v_site_code
    and cycle.rope_number = p_rope_number;

  insert into public.ag_reef_sample_rope_cycles (
    aggregator_id,
    site_code,
    rope_number,
    cycle_number,
    created_by_user_id,
    updated_by_user_id
  ) values (
    v_aggregator_id,
    v_site_code,
    p_rope_number,
    v_next_cycle,
    v_actor_id,
    v_actor_id
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'site_code', v_site_code,
    'rope_number', p_rope_number,
    'closed_cycle_number', case when v_existing.id is null then null else v_existing.cycle_number end,
    'new_cycle_id', v_new_id,
    'new_cycle_number', v_next_cycle,
    'register', public.ag_reef_sample_rope_register_internal(v_aggregator_id, v_site_code)
  );
end;
$function$;

create or replace function public.ag_reef_seaweed_records_page(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  record_kind text,
  record_key text,
  record_number text,
  record_date date,
  updated_at timestamptz,
  location text,
  site_code text,
  site_name text,
  species text,
  recorded_by_name text,
  summary text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_search text := nullif(trim(p_search), '');
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false)
     or coalesce(v_scope ->> 'access_mode', '') <> 'authenticated' then
    raise exception 'An authorised COSME Reef account is required.' using errcode = '42501';
  end if;

  return query
  with site_capture_rows as (
    select
      'site_capture'::text as record_kind,
      capture.id::text as record_key,
      capture.record_number,
      (capture.observed_at at time zone 'Africa/Nairobi')::date as record_date,
      capture.updated_at,
      capture.location,
      capture.site_code,
      site.site_name,
      initcap(capture.species) as species,
      capture.recorded_by_name,
      concat_ws(
        ' · ',
        case when capture.line_count is not null then capture.line_count::text || ' lines' end,
        case when capture.seed_weight_value is not null then 'Seed ' || capture.seed_weight_value::text || ' ' || coalesce(capture.seed_weight_unit, 'kg') end,
        case when capture.harvest_weight_value is not null then 'Harvest ' || capture.harvest_weight_value::text || ' ' || coalesce(capture.harvest_weight_unit, 'kg') end,
        case
          when capture.monitoring_team = 'other' then nullif(trim(capture.monitoring_team_other), '')
          when capture.monitoring_team is not null then initcap(capture.monitoring_team)
        end
      ) as summary
    from public.ag_reef_site_captures capture
    left join public.ag_reef_sites site on site.site_code = capture.site_code
    where capture.aggregator_id = v_aggregator_id
      and capture.deleted_at is null
  ),
  sample_register_rows as (
    select
      'sample_rope_register'::text as record_kind,
      cycle.site_code as record_key,
      cycle.site_code || ' Sample Rope Register' as record_number,
      coalesce(
        min(cycle.date_seeded) filter (where cycle.status = 'active'),
        (max(cycle.updated_at) at time zone 'Africa/Nairobi')::date
      ) as record_date,
      max(cycle.updated_at) as updated_at,
      site.location,
      cycle.site_code,
      site.site_name,
      string_agg(distinct initcap(cycle.species), ', ' order by initcap(cycle.species))
        filter (where cycle.status = 'active' and cycle.species is not null) as species,
      null::text as recorded_by_name,
      concat_ws(
        ' · ',
        count(*) filter (
          where cycle.status = 'active'
            and (
              cycle.species is not null or cycle.date_seeded is not null
              or cycle.rope_weight_kg is not null or cycle.initial_weight_kg is not null
              or cycle.week_2_kg is not null or cycle.week_4_kg is not null or cycle.week_6_kg is not null
            )
        )::text || ' sample ropes populated',
        case when count(*) filter (where cycle.status = 'active' and cycle.week_2_kg is not null) > 0
          then 'Wk2 ' || count(*) filter (where cycle.status = 'active' and cycle.week_2_kg is not null)::text end,
        case when count(*) filter (where cycle.status = 'active' and cycle.week_4_kg is not null) > 0
          then 'Wk4 ' || count(*) filter (where cycle.status = 'active' and cycle.week_4_kg is not null)::text end,
        case when count(*) filter (where cycle.status = 'active' and cycle.week_6_kg is not null) > 0
          then 'Wk6 ' || count(*) filter (where cycle.status = 'active' and cycle.week_6_kg is not null)::text end,
        case when count(*) filter (where cycle.status = 'closed') > 0
          then count(*) filter (where cycle.status = 'closed')::text || ' previous cycles' end
      ) as summary
    from public.ag_reef_sample_rope_cycles cycle
    left join public.ag_reef_sites site on site.site_code = cycle.site_code
    where cycle.aggregator_id = v_aggregator_id
      and cycle.deleted_at is null
    group by cycle.site_code, site.location, site.site_name
  ),
  legacy_seaweed_rows as (
    select
      'legacy_seaweed'::text as record_kind,
      record.id::text as record_key,
      record.record_number,
      record.record_date,
      record.updated_at,
      record.location,
      null::text as site_code,
      null::text as site_name,
      (
        select string_agg(distinct initcap(unit.species), ', ' order by initcap(unit.species))
        from public.ag_reef_seaweed_record_units unit
        where unit.record_id = record.id
      ) as species,
      record.recorded_by_name,
      concat_ws(
        ' · ',
        (
          select count(*)::text || case when count(*) = 1 then ' unit' else ' units' end
          from public.ag_reef_seaweed_record_units unit
          where unit.record_id = record.id
        ),
        initcap(coalesce(record.record_status, 'submitted'))
      ) as summary
    from public.ag_reef_seaweed_records record
    where record.aggregator_id = v_aggregator_id
      and record.deleted_at is null
  ),
  combined as (
    select * from site_capture_rows
    union all
    select * from sample_register_rows
    union all
    select * from legacy_seaweed_rows
  ),
  filtered as (
    select *
    from combined record
    where v_search is null
       or record.record_number ilike '%' || v_search || '%'
       or coalesce(record.location, '') ilike '%' || v_search || '%'
       or coalesce(record.site_code, '') ilike '%' || v_search || '%'
       or coalesce(record.site_name, '') ilike '%' || v_search || '%'
       or coalesce(record.species, '') ilike '%' || v_search || '%'
       or coalesce(record.recorded_by_name, '') ilike '%' || v_search || '%'
       or coalesce(record.summary, '') ilike '%' || v_search || '%'
       or record.record_kind ilike '%' || v_search || '%'
  )
  select
    record.record_kind,
    record.record_key,
    record.record_number,
    record.record_date,
    record.updated_at,
    record.location,
    record.site_code,
    record.site_name,
    record.species,
    record.recorded_by_name,
    record.summary,
    count(*) over() as total_count
  from filtered record
  order by record.updated_at desc nulls last, record.record_date desc nulls last, record.record_number
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

create or replace function public.ag_reef_seaweed_records_page_delete(
  p_record_kind text,
  p_record_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_actor_id uuid := (select auth.uid());
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_kind text := lower(nullif(trim(p_record_kind), ''));
  v_key text := nullif(trim(p_record_key), '');
  v_uuid uuid;
  v_record_number text;
  v_target_type text;
  v_actor_email text;
  v_deleted_at timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false)
     or v_scope ->> 'access_mode' <> 'authenticated'
     or v_actor_id is null then
    raise exception 'Sign in with the protected owner account to delete Reef records.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ag_user_profiles profile
    where profile.id = v_actor_id
      and profile.account_status = 'active'
      and profile.is_protected_owner
  ) then
    raise exception 'Only the protected owner can delete Reef records.'
      using errcode = '42501';
  end if;

  if v_key is null
     or v_kind not in ('site_capture', 'sample_rope_register', 'legacy_seaweed') then
    raise exception 'Select a valid Nursery Seaweed record to delete.' using errcode = '22023';
  end if;

  case v_kind
    when 'site_capture' then
      begin
        v_uuid := v_key::uuid;
      exception when invalid_text_representation then
        raise exception 'Select a valid Site Capture record.' using errcode = '22023';
      end;

      update public.ag_reef_site_captures
      set deleted_at = v_deleted_at,
          deleted_by_user_id = v_actor_id,
          updated_at = v_deleted_at
      where id = v_uuid
        and aggregator_id = v_aggregator_id
        and deleted_at is null
      returning record_number into v_record_number;

      v_target_type := 'reef_site_capture';

    when 'legacy_seaweed' then
      begin
        v_uuid := v_key::uuid;
      exception when invalid_text_representation then
        raise exception 'Select a valid Seaweed record.' using errcode = '22023';
      end;

      update public.ag_reef_seaweed_records
      set deleted_at = v_deleted_at,
          deleted_by_user_id = v_actor_id,
          updated_at = v_deleted_at
      where id = v_uuid
        and aggregator_id = v_aggregator_id
        and deleted_at is null
      returning record_number into v_record_number;

      v_target_type := 'reef_seaweed_record';

    when 'sample_rope_register' then
      v_key := upper(v_key);

      update public.ag_reef_sample_rope_cycles
      set deleted_at = v_deleted_at,
          deleted_by_user_id = v_actor_id,
          updated_by_user_id = v_actor_id,
          updated_at = v_deleted_at
      where aggregator_id = v_aggregator_id
        and site_code = v_key
        and deleted_at is null;

      get diagnostics v_count = row_count;
      if v_count > 0 then
        v_record_number := v_key || ' Sample Rope Register';
      end if;

      v_target_type := 'reef_sample_rope_register';
  end case;

  if v_record_number is null then
    raise exception 'The Nursery Seaweed record was not found or has already been deleted.'
      using errcode = 'P0002';
  end if;

  select profile.email
  into v_actor_email
  from public.ag_user_profiles profile
  where profile.id = v_actor_id;

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_actor_id,
    v_actor_email,
    'reef_seaweed_record_soft_deleted',
    v_target_type,
    v_key,
    jsonb_build_object(
      'record_kind', v_kind,
      'record_number', v_record_number,
      'aggregator_id', v_aggregator_id,
      'deleted_at', v_deleted_at,
      'rows_affected', case when v_kind = 'sample_rope_register' then v_count else 1 end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'record_kind', v_kind,
    'record_key', v_key,
    'record_number', v_record_number,
    'deleted_at', v_deleted_at
  );
end;
$function$;

grant execute on function public.ag_reef_seaweed_records_page_delete(text, text) to authenticated;

commit;
