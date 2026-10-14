-- Public, read-only COSME Reef Nursery records and photo catalogue.
-- Existing authenticated RPCs, write permissions, storage bucket privacy, and
-- unrelated organisations remain unchanged.
begin;

create or replace function public.ag_public_cosme_reef_seaweed_records_page(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
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
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_search text := nullif(trim(p_search), '');
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false)
     or coalesce(v_scope ->> 'access_mode', '') not in ('public', 'authenticated') then
    raise exception 'COSME public nursery records are unavailable.' using errcode = '42501';
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
  ), sample_register_rows as (
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
    group by cycle.site_code, site.location, site.site_name
  ), legacy_seaweed_rows as (
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
        (select count(*)::text || case when count(*) = 1 then ' unit' else ' units' end
         from public.ag_reef_seaweed_record_units unit where unit.record_id = record.id),
        initcap(coalesce(record.record_status, 'submitted'))
      ) as summary
    from public.ag_reef_seaweed_records record
    where record.aggregator_id = v_aggregator_id
      and record.deleted_at is null
  ), combined as (
    select * from site_capture_rows
    union all
    select * from sample_register_rows
    union all
    select * from legacy_seaweed_rows
  ), filtered as (
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
$$;

revoke all on function public.ag_public_cosme_reef_seaweed_records_page(text, integer, integer) from public;
grant execute on function public.ag_public_cosme_reef_seaweed_records_page(text, integer, integer) to anon, authenticated;

-- Expose only the fields displayed by the read-only site capture report. Do not
-- return storage paths, actor UUIDs, deletion state, or unrestricted table rows.
create or replace function public.ag_public_cosme_reef_site_capture_detail(p_capture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_result jsonb;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false)
     or coalesce(v_scope ->> 'access_mode', '') not in ('public', 'authenticated') then
    raise exception 'COSME public nursery records are unavailable.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'record_number', capture.record_number,
    'observed_at', capture.observed_at,
    'location', capture.location,
    'site_code', capture.site_code,
    'site_name', site.site_name,
    'recorded_by_name', capture.recorded_by_name,
    'monitoring_team', capture.monitoring_team,
    'monitoring_team_other', capture.monitoring_team_other,
    'species', capture.species,
    'line_count', capture.line_count,
    'seed_weight_value', capture.seed_weight_value,
    'seed_weight_unit', capture.seed_weight_unit,
    'harvest_weight_value', capture.harvest_weight_value,
    'harvest_weight_unit', capture.harvest_weight_unit,
    'health_environment', capture.health_environment,
    'general_notes', capture.general_notes
  ) into v_result
  from public.ag_reef_site_captures capture
  left join public.ag_reef_sites site on site.site_code = capture.site_code
  where capture.id = p_capture_id
    and capture.aggregator_id = v_aggregator_id
    and capture.deleted_at is null;

  return v_result;
end;
$$;

revoke all on function public.ag_public_cosme_reef_site_capture_detail(uuid) from public;
grant execute on function public.ag_public_cosme_reef_site_capture_detail(uuid) to anon, authenticated;

create or replace function public.ag_public_cosme_reef_photo_library(
  p_start_date date default null,
  p_end_date date default null,
  p_location text default null,
  p_recorder text default null,
  p_sort_key text default 'taken_at',
  p_sort_direction text default 'desc',
  p_page_limit integer default 20,
  p_page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_start date := coalesce(
    p_start_date,
    (now() at time zone 'Africa/Nairobi')::date - 29
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_recorder text := nullif(btrim(coalesce(p_recorder, '')), '');
  v_sort text := case
    when p_sort_key in ('taken_at', 'location', 'recorder_name')
      then p_sort_key
    else 'taken_at'
  end;
  v_direction text := case
    when lower(coalesce(p_sort_direction, '')) = 'asc' then 'asc'
    else 'desc'
  end;
  v_limit integer := least(greatest(coalesce(p_page_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_page_offset, 0), 0);
  v_result jsonb;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false)
     or coalesce(v_scope ->> 'access_mode', '') not in ('public', 'authenticated') then
    raise exception 'COSME public photo records are unavailable.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ag_aggregators aggregator
    where aggregator.id = v_aggregator_id
      and upper(aggregator.aggregator_code) = 'COSME'
  ) then
    raise exception 'COSME photo access is required.' using errcode = '42501';
  end if;

  if v_end < v_start or v_end - v_start > 366 then
    raise exception 'Photo date range must be between 1 and 367 days.';
  end if;

  with photo_rows as (
    select
      session.id as record_id,
      session.record_number as record_reference,
      'reef_nursery'::text as source_type,
      'Reef Nursery'::text as source_label,
      (
        session.training_date
        + coalesce(session.start_time, time '00:00')
      ) at time zone 'Africa/Nairobi' as taken_at,
      session.training_date as activity_date,
      session.location,
      coalesce(
        nullif(btrim(session.trainer_name), ''),
        nullif(btrim(session.recorded_by_name), ''),
        'Unknown'
      ) as recorder_name,
      'reef-nursery-photos'::text as bucket_id,
      photo.storage_path,
      photo.photo_order,
      coalesce(
        nullif(array_to_string(session.session_types, ', '), ''),
        'Nursery session'
      ) as photo_context
    from public.ag_reef_nursery_photos photo
    join public.ag_reef_nursery_sessions session
      on session.id = photo.session_id
    where session.aggregator_id = v_aggregator_id
      and session.deleted_at is null
  ),
  filtered as (
    select *
    from photo_rows photo
    where photo.activity_date between v_start and v_end
      and (v_location is null or photo.location = v_location)
      and (
        v_recorder is null
        or photo.recorder_name ilike '%' || v_recorder || '%'
      )
  ),
  ordered as (
    select
      filtered.*,
      row_number() over (
        order by
          case
            when v_sort = 'taken_at' and v_direction = 'asc'
              then filtered.taken_at
          end asc,
          case
            when v_sort = 'taken_at' and v_direction = 'desc'
              then filtered.taken_at
          end desc,
          case
            when v_sort = 'location' and v_direction = 'asc'
              then filtered.location
          end asc nulls last,
          case
            when v_sort = 'location' and v_direction = 'desc'
              then filtered.location
          end desc nulls last,
          case
            when v_sort = 'recorder_name' and v_direction = 'asc'
              then filtered.recorder_name
          end asc nulls last,
          case
            when v_sort = 'recorder_name' and v_direction = 'desc'
              then filtered.recorder_name
          end desc nulls last,
          filtered.taken_at desc,
          filtered.record_reference,
          filtered.photo_order
      ) as row_index
    from filtered
  ),
  paged as (
    select *
    from ordered
    order by row_index
    limit v_limit offset v_offset
  ),
  available_locations as (
    select distinct session.location
    from public.ag_reef_nursery_photos photo
    join public.ag_reef_nursery_sessions session
      on session.id = photo.session_id
    where session.aggregator_id = v_aggregator_id
      and session.deleted_at is null
      and nullif(btrim(session.location), '') is not null
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'locations', coalesce((
      select jsonb_agg(location order by location)
      from available_locations
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(paged) - 'row_index' order by paged.row_index)
      from paged
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.ag_public_cosme_reef_photo_library(
  date,
  date,
  text,
  text,
  text,
  text,
  integer,
  integer
) from public;

grant execute on function public.ag_public_cosme_reef_photo_library(
  date,
  date,
  text,
  text,
  text,
  text,
  integer,
  integer
) to anon, authenticated;

comment on function public.ag_public_cosme_reef_photo_library(
  date,
  date,
  text,
  text,
  text,
  text,
  integer,
  integer
) is
  'Read-only public COSME Reef Nursery training photo catalogue, restricted to the COSME aggregator.';

commit;
