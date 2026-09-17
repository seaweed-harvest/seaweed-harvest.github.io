begin;

create or replace function public.ag_reef_seaweed_records_page(
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

revoke all on function public.ag_reef_seaweed_records_page(text, integer, integer) from public;
grant execute on function public.ag_reef_seaweed_records_page(text, integer, integer) to authenticated;

commit;
