create or replace function public.ag_cosme_reef_photo_library(
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
  v_aggregator_id uuid;
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
  perform public.ag_require_permission('can_view_data');
  v_aggregator_id := public.ag_require_active_aggregator();

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

revoke all on function public.ag_cosme_reef_photo_library(
  date,
  date,
  text,
  text,
  text,
  text,
  integer,
  integer
) from public, anon;

grant execute on function public.ag_cosme_reef_photo_library(
  date,
  date,
  text,
  text,
  text,
  text,
  integer,
  integer
) to authenticated;

comment on function public.ag_cosme_reef_photo_library(
  date,
  date,
  text,
  text,
  text,
  text,
  integer,
  integer
) is
  'Authenticated COSME Reef Nursery photo library with location filtering for the simplified COSME Photos interface.';
