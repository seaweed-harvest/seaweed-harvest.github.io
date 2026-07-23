begin;

create or replace function public.ag_form_record_summary(
  p_record_type text,
  p_start_date date default null,
  p_end_date date default null,
  p_community_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_start date := coalesce(p_start_date, date_trunc('year', now() at time zone 'Africa/Nairobi')::date);
  v_end date := coalesce(p_end_date, (now() at time zone 'Africa/Nairobi')::date);
  v_totals jsonb := '{}'::jsonb;
  v_monthly_rows jsonb := '[]'::jsonb;
  v_daily_rows jsonb := '[]'::jsonb;
  v_community_rows jsonb := '[]'::jsonb;
begin
  perform public.ag_require_permission('can_view_data');
  if p_record_type not in ('process', 'site_sample', 'stock') then
    raise exception 'Unknown record type.' using errcode = '22023';
  end if;
  if v_end < v_start then
    raise exception 'End date must be on or after start date.' using errcode = '22023';
  end if;
  v_aggregator_id := public.ag_require_active_aggregator();

  if p_record_type = 'process' then
    with filtered as (
      select record.*
      from public.ag_process_records record
      where record.aggregator_id = v_aggregator_id
        and record.process_date between v_start and v_end
    )
    select jsonb_build_object(
      'record_count', count(*),
      'species_count', count(distinct species),
      'received_kg', round(coalesce(sum(received_seaweed_kg), 0), 2),
      'blended_kg', round(coalesce(sum(blended_seaweed_kg), 0), 2),
      'wet_pulp_kg', round(coalesce(sum(wet_pulp_kg), 0), 2),
      'liquid_l', round(coalesce(sum(pressed_liquid_l), 0), 2),
      'dry_pulp_kg', round(coalesce(sum(dry_pulp_kg), 0), 2),
      'lost_kg', round(coalesce(sum(lost_seaweed_kg), 0), 2),
      'press_count', coalesce(sum(number_of_presses), 0),
      'avg_wet_dry_percent', round(avg(wet_dry_ratio_percent), 2),
      'avg_stock_product_percent', round(avg(stock_product_ratio_percent), 2),
      'first_record_date', min(process_date),
      'last_record_date', max(process_date)
    )
    into v_totals
    from filtered;

    with monthly as (
      select
        date_trunc('month', record.process_date)::date as month_start,
        count(*) as record_count,
        count(distinct record.species) as species_count,
        round(coalesce(sum(record.received_seaweed_kg), 0), 2) as received_kg,
        round(coalesce(sum(record.blended_seaweed_kg), 0), 2) as blended_kg,
        round(coalesce(sum(record.wet_pulp_kg), 0), 2) as wet_pulp_kg,
        round(coalesce(sum(record.pressed_liquid_l), 0), 2) as liquid_l,
        round(coalesce(sum(record.dry_pulp_kg), 0), 2) as dry_pulp_kg,
        round(coalesce(sum(record.lost_seaweed_kg), 0), 2) as lost_kg,
        coalesce(sum(record.number_of_presses), 0) as press_count,
        round(avg(record.wet_dry_ratio_percent), 2) as avg_wet_dry_percent,
        round(avg(record.stock_product_ratio_percent), 2) as avg_stock_product_percent,
        min(record.process_date) as first_record_date,
        max(record.process_date) as last_record_date
      from public.ag_process_records record
      where record.aggregator_id = v_aggregator_id
        and record.process_date between v_start and v_end
      group by 1
    )
    select coalesce(jsonb_agg(
      to_jsonb(monthly) || jsonb_build_object('month_label', to_char(month_start, 'Mon YYYY'))
      order by month_start desc
    ), '[]'::jsonb)
    into v_monthly_rows
    from monthly;

    with daily as (
      select record.process_date as record_date, count(*) as record_count
      from public.ag_process_records record
      where record.aggregator_id = v_aggregator_id
        and record.process_date between v_start and v_end
      group by record.process_date
    )
    select coalesce(jsonb_agg(to_jsonb(daily) order by record_date), '[]'::jsonb)
    into v_daily_rows
    from daily;

  elsif p_record_type = 'site_sample' then
    with filtered as (
      select
        record.*,
        (record.sampled_at at time zone 'Africa/Nairobi')::date as record_date,
        case
          when lower(record.tds_unit) = 'mg/l' then record.tds_value
          when lower(record.tds_unit) in ('g/l', 'ppt') then record.tds_value * 1000
        end as tds_mg_l
      from public.ag_site_water_sample_records record
      where record.aggregator_id = v_aggregator_id
        and (record.sampled_at at time zone 'Africa/Nairobi')::date between v_start and v_end
        and (p_community_id is null or record.community_id_snapshot = p_community_id)
    )
    select jsonb_build_object(
      'record_count', count(*),
      'community_count', count(distinct community_id_snapshot),
      'avg_temperature_c', round(avg(temperature_c), 2),
      'avg_salinity', round(avg(salinity_value), 2),
      'avg_tds_mg_l', round(avg(tds_mg_l), 2),
      'avg_ec_ms_cm', round(avg(electrical_conductivity_ms_cm), 2),
      'e_coli_sample_count', count(*) filter (where e_coli_sample_taken is true),
      'first_record_date', min(record_date),
      'last_record_date', max(record_date)
    )
    into v_totals
    from filtered;

    with filtered as (
      select
        record.*,
        (record.sampled_at at time zone 'Africa/Nairobi')::date as record_date,
        case
          when lower(record.tds_unit) = 'mg/l' then record.tds_value
          when lower(record.tds_unit) in ('g/l', 'ppt') then record.tds_value * 1000
        end as tds_mg_l
      from public.ag_site_water_sample_records record
      where record.aggregator_id = v_aggregator_id
        and (record.sampled_at at time zone 'Africa/Nairobi')::date between v_start and v_end
        and (p_community_id is null or record.community_id_snapshot = p_community_id)
    ),
    monthly as (
      select
        date_trunc('month', record_date)::date as month_start,
        count(*) as record_count,
        count(distinct community_id_snapshot) as community_count,
        round(avg(temperature_c), 2) as avg_temperature_c,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(tds_mg_l), 2) as avg_tds_mg_l,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        count(*) filter (where e_coli_sample_taken is true) as e_coli_sample_count,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
      group by 1
    )
    select coalesce(jsonb_agg(
      to_jsonb(monthly) || jsonb_build_object('month_label', to_char(month_start, 'Mon YYYY'))
      order by month_start desc
    ), '[]'::jsonb)
    into v_monthly_rows
    from monthly;

    with daily as (
      select
        (record.sampled_at at time zone 'Africa/Nairobi')::date as record_date,
        count(*) as record_count
      from public.ag_site_water_sample_records record
      where record.aggregator_id = v_aggregator_id
        and (record.sampled_at at time zone 'Africa/Nairobi')::date between v_start and v_end
        and (p_community_id is null or record.community_id_snapshot = p_community_id)
      group by 1
    )
    select coalesce(jsonb_agg(to_jsonb(daily) order by record_date), '[]'::jsonb)
    into v_daily_rows
    from daily;

    with filtered as (
      select
        record.*,
        (record.sampled_at at time zone 'Africa/Nairobi')::date as record_date,
        case
          when lower(record.tds_unit) = 'mg/l' then record.tds_value
          when lower(record.tds_unit) in ('g/l', 'ppt') then record.tds_value * 1000
        end as tds_mg_l
      from public.ag_site_water_sample_records record
      where record.aggregator_id = v_aggregator_id
        and (record.sampled_at at time zone 'Africa/Nairobi')::date between v_start and v_end
    ),
    communities as (
      select
        community_id_snapshot as community_id,
        max(community_name_snapshot) as community_name,
        count(*) as record_count,
        round(avg(temperature_c), 2) as avg_temperature_c,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(tds_mg_l), 2) as avg_tds_mg_l,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        count(*) filter (where e_coli_sample_taken is true) as e_coli_sample_count,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
      group by community_id_snapshot
    )
    select coalesce(jsonb_agg(to_jsonb(communities) order by record_count desc, community_name), '[]'::jsonb)
    into v_community_rows
    from communities;

  else
    with filtered as (
      select
        record.*,
        case
          when record.weight_unit = 'L' then record.weight_value
          when record.weight_unit = 'mL' then record.weight_value / 1000
        end as volume_l
      from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and record.packed_on between v_start and v_end
    )
    select jsonb_build_object(
      'record_count', count(*),
      'container_count', count(distinct carton_serial),
      'new_count', count(*) filter (where record_type = 'initial'),
      'retest_count', count(*) filter (where record_type = 'retest'),
      'total_volume_l', round(coalesce(sum(volume_l), 0), 2),
      'stabilised_count', count(*) filter (where stabilizer_added is true),
      'avg_salinity', round(avg(salinity_value), 2),
      'avg_ph', round(avg(ph_value), 2),
      'avg_ec_ms_cm', round(avg(electrical_conductivity_ms_cm), 2),
      'first_record_date', min(packed_on),
      'last_record_date', max(packed_on)
    )
    into v_totals
    from filtered;

    with filtered as (
      select
        record.*,
        case
          when record.weight_unit = 'L' then record.weight_value
          when record.weight_unit = 'mL' then record.weight_value / 1000
        end as volume_l
      from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and record.packed_on between v_start and v_end
    ),
    monthly as (
      select
        date_trunc('month', packed_on)::date as month_start,
        count(*) as record_count,
        count(distinct carton_serial) as container_count,
        count(*) filter (where record_type = 'initial') as new_count,
        count(*) filter (where record_type = 'retest') as retest_count,
        round(coalesce(sum(volume_l), 0), 2) as total_volume_l,
        count(*) filter (where stabilizer_added is true) as stabilised_count,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(ph_value), 2) as avg_ph,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        min(packed_on) as first_record_date,
        max(packed_on) as last_record_date
      from filtered
      group by 1
    )
    select coalesce(jsonb_agg(
      to_jsonb(monthly) || jsonb_build_object('month_label', to_char(month_start, 'Mon YYYY'))
      order by month_start desc
    ), '[]'::jsonb)
    into v_monthly_rows
    from monthly;

    with daily as (
      select record.packed_on as record_date, count(*) as record_count
      from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and record.packed_on between v_start and v_end
      group by record.packed_on
    )
    select coalesce(jsonb_agg(to_jsonb(daily) order by record_date), '[]'::jsonb)
    into v_daily_rows
    from daily;
  end if;

  return jsonb_build_object(
    'record_type', p_record_type,
    'start_date', v_start,
    'end_date', v_end,
    'totals', coalesce(v_totals, '{}'::jsonb),
    'monthly_rows', coalesce(v_monthly_rows, '[]'::jsonb),
    'daily_rows', coalesce(v_daily_rows, '[]'::jsonb),
    'community_rows', coalesce(v_community_rows, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ag_form_record_summary(text, date, date, text)
  from public, anon, authenticated;
grant execute on function public.ag_form_record_summary(text, date, date, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
