begin;

alter function public.ag_sec_operational_summary(date, date, text, text)
  rename to ag_sec_operational_summary_day_context_legacy;

create function public.ag_sec_operational_summary(
  p_start_date date default null,
  p_end_date date default null,
  p_grouping text default 'day',
  p_community_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_totals jsonb;
  v_aggregator_id uuid;
  v_start date := coalesce(
    p_start_date,
    date_trunc('year', now() at time zone 'Africa/Nairobi')::date
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_retested_containers bigint := 0;
begin
  v_result := public.ag_sec_operational_summary_day_context_legacy(
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id
  );
  v_aggregator_id := public.ag_require_active_aggregator();

  select count(distinct nullif(trim(stock.carton_serial), ''))
  into v_retested_containers
  from public.ag_stabilization_packing_records stock
  where stock.aggregator_id = v_aggregator_id
    and stock.packed_on between v_start and v_end
    and lower(coalesce(stock.record_type, 'initial')) = 'retest';

  v_totals := coalesce(v_result -> 'totals', '{}'::jsonb)
    || jsonb_build_object(
      'stock_retested_container_count',
      coalesce(v_retested_containers, 0)
    );

  return jsonb_set(v_result, '{totals}', v_totals, true);
end;
$$;

create function public.ag_sec_monthly_operational_summary(
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_start date := coalesce(
    p_start_date,
    date_trunc('year', now() at time zone 'Africa/Nairobi')::date
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
begin
  perform public.ag_require_permission('can_view_data');
  if v_end < v_start then
    raise exception 'End date must be on or after start date.'
      using errcode = '22023';
  end if;
  v_aggregator_id := public.ag_require_active_aggregator();

  with
  collection_source as (
    select
      date_trunc(
        'month',
        (collection.collected_at at time zone 'Africa/Nairobi')::date
      )::date as month_start,
      coalesce(collection.sack_weight_kg, 0) as weight_kg,
      coalesce(collection.total_price, 0) as value_ksh,
      upper(coalesce(
        nullif(trim(collection.grade_code), ''),
        nullif(trim(collection.seaweed_grade), '')
      )) as grade_code,
      coalesce(
        collection.farmer_record_id::text,
        nullif(trim(collection.farmer_id), '')
      ) as farmer_key,
      coalesce(
        collection.community_record_id::text,
        nullif(trim(collection.community_id), ''),
        nullif(lower(trim(collection.community_name_snapshot)), '')
      ) as community_key
    from public.collections collection
    where collection.aggregator_id = v_aggregator_id
      and (collection.collected_at at time zone 'Africa/Nairobi')::date
        between v_start and v_end
  ),
  collection_groups as (
    select
      month_start,
      round(coalesce(sum(weight_kg), 0), 2) as intake_weight_kg,
      round(coalesce(sum(value_ksh), 0), 2) as intake_value_ksh,
      round(coalesce(sum(weight_kg) filter (where grade_code = 'A'), 0), 2)
        as grade_a_kg,
      round(coalesce(sum(weight_kg) filter (where grade_code = 'B'), 0), 2)
        as grade_b_kg,
      round(coalesce(sum(weight_kg) filter (where grade_code = 'C'), 0), 2)
        as grade_c_kg,
      count(*) as collection_count,
      count(distinct farmer_key) filter (where farmer_key is not null)
        as farmer_count,
      count(distinct community_key) filter (where community_key is not null)
        as community_count
    from collection_source
    group by grouping sets ((month_start), ())
  ),
  stock_source as (
    select
      date_trunc('month', stock.packed_on)::date as month_start,
      nullif(trim(stock.carton_serial), '') as container_key,
      lower(coalesce(stock.record_type, 'initial')) as record_type,
      case
        when stock.weight_unit = 'L' then stock.weight_value
        when stock.weight_unit = 'mL' then stock.weight_value / 1000
      end as volume_l
    from public.ag_stabilization_packing_records stock
    where stock.aggregator_id = v_aggregator_id
      and stock.packed_on between v_start and v_end
  ),
  stock_groups as (
    select
      month_start,
      round(coalesce(
        sum(volume_l) filter (where record_type <> 'retest'),
        0
      ), 2) as stock_volume_l,
      count(distinct container_key)
        filter (where record_type <> 'retest' and container_key is not null)
        as stock_container_count,
      count(distinct container_key)
        filter (where record_type = 'retest' and container_key is not null)
        as stock_retested_container_count
    from stock_source
    group by grouping sets ((month_start), ())
  ),
  process_source as (
    select
      date_trunc('month', process.process_date)::date as month_start,
      coalesce(process.received_seaweed_kg, 0) as received_kg,
      coalesce(process.wet_pulp_kg, 0) as wet_pulp_kg,
      coalesce(process.lost_seaweed_kg, 0) as lost_kg,
      coalesce(process.number_of_presses, 0) as presses,
      case
        when process.start_time is null or process.end_time is null then 0
        else extract(epoch from (
          (
            process.process_date
            + process.end_time
            + case
                when process.end_time < process.start_time
                  then interval '1 day'
                else interval '0'
              end
          )
          - (process.process_date + process.start_time)
        )) / 60
      end as process_minutes
    from public.ag_process_records process
    where process.aggregator_id = v_aggregator_id
      and process.process_date between v_start and v_end
  ),
  process_groups as (
    select
      month_start,
      round(coalesce(sum(received_kg), 0), 2) as process_received_kg,
      round(coalesce(sum(lost_kg), 0), 2) as process_lost_kg,
      round(coalesce(sum(process_minutes), 0), 2) as process_minutes,
      coalesce(sum(presses), 0) as process_press_count,
      round(
        coalesce(sum(wet_pulp_kg), 0)
          / nullif(coalesce(sum(presses), 0), 0),
        2
      ) as process_avg_wet_pulp_per_press
    from process_source
    group by grouping sets ((month_start), ())
  ),
  site_source as (
    select
      date_trunc(
        'month',
        (sample.sampled_at at time zone 'Africa/Nairobi')::date
      )::date as month_start
    from public.ag_site_water_sample_records sample
    where sample.aggregator_id = v_aggregator_id
      and (sample.sampled_at at time zone 'Africa/Nairobi')::date
        between v_start and v_end
  ),
  site_groups as (
    select month_start, count(*) as site_sample_count
    from site_source
    group by grouping sets ((month_start), ())
  ),
  periods as (
    select month_start from collection_groups
    union
    select month_start from stock_groups
    union
    select month_start from process_groups
    union
    select month_start from site_groups
  ),
  summary_rows as (
    select
      period.month_start,
      period.month_start as period_start,
      case
        when period.month_start is null then null
        else (
          period.month_start + interval '1 month' - interval '1 day'
        )::date
      end as period_end,
      coalesce(collection.intake_weight_kg, 0) as intake_weight_kg,
      coalesce(collection.intake_value_ksh, 0) as intake_value_ksh,
      coalesce(collection.grade_a_kg, 0) as grade_a_kg,
      coalesce(collection.grade_b_kg, 0) as grade_b_kg,
      coalesce(collection.grade_c_kg, 0) as grade_c_kg,
      coalesce(collection.collection_count, 0) as collection_count,
      coalesce(collection.farmer_count, 0) as farmer_count,
      coalesce(collection.community_count, 0) as community_count,
      coalesce(site.site_sample_count, 0) as site_sample_count,
      coalesce(stock.stock_volume_l, 0) as stock_volume_l,
      coalesce(stock.stock_container_count, 0) as stock_container_count,
      coalesce(stock.stock_retested_container_count, 0)
        as stock_retested_container_count,
      coalesce(process.process_received_kg, 0) as process_received_kg,
      coalesce(process.process_lost_kg, 0) as process_lost_kg,
      coalesce(process.process_minutes, 0) as process_minutes,
      coalesce(process.process_press_count, 0) as process_press_count,
      process.process_avg_wet_pulp_per_press,
      round(
        coalesce(stock.stock_volume_l, 0)
          / nullif(coalesce(collection.intake_weight_kg, 0), 0),
        3
      ) as stock_l_per_intake_kg
    from periods period
    left join collection_groups collection
      on collection.month_start is not distinct from period.month_start
    left join stock_groups stock
      on stock.month_start is not distinct from period.month_start
    left join process_groups process
      on process.month_start is not distinct from period.month_start
    left join site_groups site
      on site.month_start is not distinct from period.month_start
  )
  select
    coalesce(
      jsonb_agg(
        to_jsonb(summary_rows) - 'month_start'
        order by month_start desc
      ) filter (where month_start is not null),
      '[]'::jsonb
    ),
    coalesce(
      (
        jsonb_agg(to_jsonb(summary_rows) - 'month_start')
          filter (where month_start is null)
      ) -> 0,
      '{}'::jsonb
    )
  into v_rows, v_totals
  from summary_rows;

  return jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'rows', v_rows,
    'totals', v_totals
  );
end;
$$;

create function public.ag_sec_community_operational_summary(
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_start date := coalesce(
    p_start_date,
    date_trunc('year', now() at time zone 'Africa/Nairobi')::date
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
begin
  perform public.ag_require_permission('can_view_data');
  if v_end < v_start then
    raise exception 'End date must be on or after start date.'
      using errcode = '22023';
  end if;
  v_aggregator_id := public.ag_require_active_aggregator();

  with
  active_communities as (
    select
      community.id as community_record_id,
      community.community_id,
      community.community_name
    from public.communities community
    join public.ag_aggregator_communities link
      on link.community_id = community.id
      and link.aggregator_id = v_aggregator_id
      and link.is_active
    where community.active
  ),
  collection_groups as (
    select
      community.community_record_id,
      round(coalesce(sum(collection.sack_weight_kg), 0), 2)
        as intake_weight_kg,
      round(coalesce(sum(collection.total_price), 0), 2)
        as intake_value_ksh,
      round(coalesce(sum(collection.sack_weight_kg) filter (
        where upper(coalesce(
          nullif(trim(collection.grade_code), ''),
          nullif(trim(collection.seaweed_grade), '')
        )) = 'A'
      ), 0), 2) as grade_a_kg,
      round(coalesce(sum(collection.sack_weight_kg) filter (
        where upper(coalesce(
          nullif(trim(collection.grade_code), ''),
          nullif(trim(collection.seaweed_grade), '')
        )) = 'B'
      ), 0), 2) as grade_b_kg,
      round(coalesce(sum(collection.sack_weight_kg) filter (
        where upper(coalesce(
          nullif(trim(collection.grade_code), ''),
          nullif(trim(collection.seaweed_grade), '')
        )) = 'C'
      ), 0), 2) as grade_c_kg,
      count(collection.id) as collection_count,
      count(distinct coalesce(
        collection.farmer_record_id::text,
        nullif(trim(collection.farmer_id), '')
      )) filter (where collection.id is not null) as farmer_count
    from active_communities community
    left join public.collections collection
      on collection.aggregator_id = v_aggregator_id
      and (collection.collected_at at time zone 'Africa/Nairobi')::date
        between v_start and v_end
      and (
        collection.community_record_id = community.community_record_id
        or (
          collection.community_record_id is null
          and collection.community_id = community.community_id
        )
      )
    group by community.community_record_id
  ),
  site_source as (
    select
      community.community_record_id,
      sample.id,
      sample.temperature_c,
      sample.salinity_value,
      case
        when lower(sample.tds_unit) = 'mg/l' then sample.tds_value
        when lower(sample.tds_unit) in ('g/l', 'ppt')
          then sample.tds_value * 1000
      end as tds_mg_l,
      sample.electrical_conductivity_ms_cm as ec_ms_cm
    from active_communities community
    left join public.ag_site_water_sample_records sample
      on sample.aggregator_id = v_aggregator_id
      and (sample.sampled_at at time zone 'Africa/Nairobi')::date
        between v_start and v_end
      and (
        sample.community_record_id = community.community_record_id
        or (
          sample.community_record_id is null
          and sample.community_id_snapshot = community.community_id
        )
      )
  ),
  site_groups as (
    select
      community_record_id,
      count(id) as site_sample_count,
      min(temperature_c) as temperature_min,
      max(temperature_c) as temperature_max,
      min(salinity_value) as salinity_min,
      max(salinity_value) as salinity_max,
      min(tds_mg_l) as tds_min_mg_l,
      max(tds_mg_l) as tds_max_mg_l,
      min(ec_ms_cm) as ec_min_ms_cm,
      max(ec_ms_cm) as ec_max_ms_cm
    from site_source
    group by community_record_id
  ),
  summary_rows as (
    select
      community.community_id,
      community.community_name,
      coalesce(collection.intake_weight_kg, 0) as intake_weight_kg,
      coalesce(collection.intake_value_ksh, 0) as intake_value_ksh,
      coalesce(collection.grade_a_kg, 0) as grade_a_kg,
      coalesce(collection.grade_b_kg, 0) as grade_b_kg,
      coalesce(collection.grade_c_kg, 0) as grade_c_kg,
      coalesce(collection.collection_count, 0) as collection_count,
      coalesce(collection.farmer_count, 0) as farmer_count,
      coalesce(site.site_sample_count, 0) as site_sample_count,
      site.temperature_min,
      site.temperature_max,
      site.salinity_min,
      site.salinity_max,
      site.tds_min_mg_l,
      site.tds_max_mg_l,
      site.ec_min_ms_cm,
      site.ec_max_ms_cm
    from active_communities community
    left join collection_groups collection
      on collection.community_record_id = community.community_record_id
    left join site_groups site
      on site.community_record_id = community.community_record_id
  )
  select
    coalesce(
      jsonb_agg(to_jsonb(summary_rows) order by community_name),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_build_object(
          'community_count', count(*),
          'intake_weight_kg', round(coalesce(sum(intake_weight_kg), 0), 2),
          'intake_value_ksh', round(coalesce(sum(intake_value_ksh), 0), 2),
          'grade_a_kg', round(coalesce(sum(grade_a_kg), 0), 2),
          'grade_b_kg', round(coalesce(sum(grade_b_kg), 0), 2),
          'grade_c_kg', round(coalesce(sum(grade_c_kg), 0), 2),
          'collection_count', coalesce(sum(collection_count), 0),
          'farmer_count', coalesce(sum(farmer_count), 0),
          'site_sample_count', coalesce(sum(site_sample_count), 0),
          'temperature_min', min(temperature_min),
          'temperature_max', max(temperature_max),
          'salinity_min', min(salinity_min),
          'salinity_max', max(salinity_max),
          'tds_min_mg_l', min(tds_min_mg_l),
          'tds_max_mg_l', max(tds_max_mg_l),
          'ec_min_ms_cm', min(ec_min_ms_cm),
          'ec_max_ms_cm', max(ec_max_ms_cm)
        )
        from summary_rows
      ),
      '{}'::jsonb
    )
  into v_rows, v_totals
  from summary_rows;

  return jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'rows', v_rows,
    'totals', v_totals
  );
end;
$$;

comment on function public.ag_sec_operational_summary(date, date, text, text) is
  'Returns the existing operational summary plus a distinct count of stock containers retested in the selected period.';
comment on function public.ag_sec_monthly_operational_summary(date, date) is
  'Returns month-level organisation totals with initial stock volume and weighted process ratios.';
comment on function public.ag_sec_community_operational_summary(date, date) is
  'Returns one row per active linked community with collection totals and site-water sample ranges only.';

revoke all on function public.ag_sec_operational_summary_day_context_legacy(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_monthly_operational_summary(date, date)
  from public, anon, authenticated;
revoke all on function public.ag_sec_community_operational_summary(date, date)
  from public, anon, authenticated;

grant execute on function public.ag_sec_operational_summary(date, date, text, text)
  to authenticated;
grant execute on function public.ag_sec_monthly_operational_summary(date, date)
  to authenticated;
grant execute on function public.ag_sec_community_operational_summary(date, date)
  to authenticated;

notify pgrst, 'reload schema';

commit;
