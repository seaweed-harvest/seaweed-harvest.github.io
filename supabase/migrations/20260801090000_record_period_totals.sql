begin;

create or replace function public.ag_reporting_period_end(
  p_period_start date,
  p_grouping text
)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(trim(coalesce(p_grouping, 'day')))
    when 'day' then p_period_start
    when 'week' then p_period_start + 6
    when 'month' then (p_period_start + interval '1 month - 1 day')::date
    when 'year' then (p_period_start + interval '1 year - 1 day')::date
  end
$$;

create or replace function public.ag_sec_record_period_totals(
  p_record_type text,
  p_start_date date default null,
  p_end_date date default null,
  p_grouping text default 'day',
  p_community_id text default null,
  p_grade text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_type text := lower(trim(coalesce(p_record_type, '')));
  v_grouping text := lower(trim(coalesce(p_grouping, 'day')));
  v_start date := coalesce(
    p_start_date,
    date_trunc('year', now() at time zone 'Africa/Nairobi')::date
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_community_id text := nullif(trim(coalesce(p_community_id, '')), '');
  v_grade text := nullif(upper(trim(coalesce(p_grade, ''))), '');
  v_aggregator_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
  v_result jsonb;
  v_activity_by_period jsonb := '{}'::jsonb;
  v_activity_total bigint := 0;
begin
  perform public.ag_require_permission('can_view_data');
  if v_type not in ('summary', 'intake', 'site_sample', 'stock', 'process') then
    raise exception 'Unknown record type.' using errcode = '22023';
  end if;
  if v_grouping not in ('day', 'week', 'month', 'year') then
    raise exception 'Grouping must be day, week, month or year.'
      using errcode = '22023';
  end if;
  if v_end < v_start then
    raise exception 'End date must be on or after start date.'
      using errcode = '22023';
  end if;

  if v_type <> 'summary' then
    perform public.ag_require_organisation_capability(
      public.ag_record_type_capability(v_type)
    );
  end if;
  v_aggregator_id := public.ag_require_active_aggregator();

  if v_type = 'summary' then
    v_result := public.ag_sec_operational_summary(
      v_start,
      v_end,
      v_grouping,
      v_community_id
    );

    with activity as (
      select
        (collection.collected_at at time zone 'Africa/Nairobi')::date
          as record_date
      from public.collections collection
      where collection.aggregator_id = v_aggregator_id
        and (collection.collected_at at time zone 'Africa/Nairobi')::date
          between v_start and v_end
        and (
          v_community_id is null
          or collection.community_id = v_community_id
        )
      union all
      select
        (sample.sampled_at at time zone 'Africa/Nairobi')::date
      from public.ag_site_water_sample_records sample
      where sample.aggregator_id = v_aggregator_id
        and (sample.sampled_at at time zone 'Africa/Nairobi')::date
          between v_start and v_end
        and (
          v_community_id is null
          or sample.community_id_snapshot = v_community_id
        )
      union all
      select stock.packed_on
      from public.ag_stabilization_packing_records stock
      where stock.aggregator_id = v_aggregator_id
        and stock.packed_on between v_start and v_end
      union all
      select process.process_date
      from public.ag_process_records process
      where process.aggregator_id = v_aggregator_id
        and process.process_date between v_start and v_end
    ),
    grouped as (
      select
        date_trunc(v_grouping, record_date::timestamp)::date as period_start,
        count(*) as record_count
      from activity
      group by 1
    )
    select
      coalesce(
        jsonb_object_agg(period_start::text, record_count),
        '{}'::jsonb
      ),
      coalesce(sum(record_count), 0)
    into v_activity_by_period, v_activity_total
    from grouped;

    select coalesce(
      jsonb_agg(
        row_value || jsonb_build_object(
          'record_count',
          coalesce(
            (
              v_activity_by_period
                ->> (row_value ->> 'period_start')
            )::bigint,
            0
          )
        )
        order by ordinal
      ),
      '[]'::jsonb
    )
    into v_rows
    from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
      with ordinality as source(row_value, ordinal);

    v_totals := coalesce(v_result -> 'totals', '{}'::jsonb)
      || jsonb_build_object('record_count', v_activity_total);

    return jsonb_build_object(
      'record_type', v_type,
      'grouping', v_grouping,
      'start_date', v_start,
      'end_date', v_end,
      'rows', v_rows,
      'totals', v_totals
    );
  end if;

  if v_type = 'intake' then
    with filtered as (
      select
        (record.collected_at at time zone 'Africa/Nairobi')::date
          as record_date,
        record.collected_at,
        coalesce(record.sack_weight_kg, 0) as weight_kg,
        coalesce(record.total_price, 0) as value_ksh,
        upper(coalesce(
          nullif(trim(record.grade_code), ''),
          nullif(trim(record.seaweed_grade::text), '')
        )) as grade_code,
        coalesce(
          record.farmer_record_id::text,
          nullif(trim(record.farmer_id), '')
        ) as farmer_key,
        coalesce(
          record.community_record_id::text,
          nullif(trim(record.community_id), ''),
          nullif(lower(trim(record.community_name_snapshot)), '')
        ) as community_key
      from public.collections record
      where record.aggregator_id = v_aggregator_id
        and (record.collected_at at time zone 'Africa/Nairobi')::date
          between v_start and v_end
        and (
          v_community_id is null
          or record.community_id = v_community_id
        )
        and (
          v_grade is null
          or upper(coalesce(
            nullif(trim(record.grade_code), ''),
            nullif(trim(record.seaweed_grade::text), '')
          )) = v_grade
        )
    ),
    period_rows as (
      select
        date_trunc(v_grouping, record_date::timestamp)::date as period_start,
        count(*) as collection_count,
        count(distinct farmer_key) filter (where farmer_key is not null)
          as active_collecting_members,
        count(distinct community_key) filter (where community_key is not null)
          as communities_collected,
        round(coalesce(sum(weight_kg), 0), 2) as total_weight_kg,
        round(coalesce(sum(weight_kg) filter (where grade_code = 'A'), 0), 2)
          as grade_a_weight_kg,
        round(coalesce(sum(weight_kg) filter (where grade_code = 'B'), 0), 2)
          as grade_b_weight_kg,
        round(coalesce(sum(weight_kg) filter (where grade_code = 'C'), 0), 2)
          as grade_c_weight_kg,
        round(coalesce(sum(weight_kg) filter (
          where grade_code is null or grade_code not in ('A', 'B', 'C')
        ), 0), 2) as ungraded_weight_kg,
        round(coalesce(sum(value_ksh), 0), 2) as estimated_value_ksh,
        round(avg(weight_kg), 2) as average_collection_kg,
        min(collected_at) as first_collection_at,
        max(collected_at) as last_collection_at
      from filtered
      group by 1
    ),
    totals as (
      select
        count(*) as collection_count,
        count(distinct farmer_key) filter (where farmer_key is not null)
          as active_collecting_members,
        count(distinct community_key) filter (where community_key is not null)
          as communities_collected,
        round(coalesce(sum(weight_kg), 0), 2) as total_weight_kg,
        round(coalesce(sum(weight_kg) filter (where grade_code = 'A'), 0), 2)
          as grade_a_weight_kg,
        round(coalesce(sum(weight_kg) filter (where grade_code = 'B'), 0), 2)
          as grade_b_weight_kg,
        round(coalesce(sum(weight_kg) filter (where grade_code = 'C'), 0), 2)
          as grade_c_weight_kg,
        round(coalesce(sum(weight_kg) filter (
          where grade_code is null or grade_code not in ('A', 'B', 'C')
        ), 0), 2) as ungraded_weight_kg,
        round(coalesce(sum(value_ksh), 0), 2) as estimated_value_ksh,
        round(avg(weight_kg), 2) as average_collection_kg,
        min(collected_at) as first_collection_at,
        max(collected_at) as last_collection_at
      from filtered
    )
    select
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(period_rows) || jsonb_build_object(
              'period_end',
              public.ag_reporting_period_end(period_start, v_grouping)
            )
            order by period_start desc
          )
          from period_rows
        ),
        '[]'::jsonb
      ),
      coalesce((select to_jsonb(totals) from totals), '{}'::jsonb)
    into v_rows, v_totals;

  elsif v_type = 'site_sample' then
    with filtered as (
      select
        (record.sampled_at at time zone 'Africa/Nairobi')::date
          as record_date,
        record.community_id_snapshot,
        record.temperature_c,
        record.salinity_value,
        case
          when lower(record.tds_unit) = 'mg/l' then record.tds_value
          when lower(record.tds_unit) in ('g/l', 'ppt')
            then record.tds_value * 1000
        end as tds_mg_l,
        record.electrical_conductivity_ms_cm,
        record.e_coli_sample_taken
      from public.ag_site_water_sample_records record
      where record.aggregator_id = v_aggregator_id
        and (record.sampled_at at time zone 'Africa/Nairobi')::date
          between v_start and v_end
        and (
          v_community_id is null
          or record.community_id_snapshot = v_community_id
        )
    ),
    period_rows as (
      select
        date_trunc(v_grouping, record_date::timestamp)::date as period_start,
        count(*) as record_count,
        count(distinct community_id_snapshot) as community_count,
        round(avg(temperature_c), 2) as avg_temperature_c,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(tds_mg_l), 2) as avg_tds_mg_l,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        count(*) filter (where e_coli_sample_taken is true)
          as e_coli_sample_count,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
      group by 1
    ),
    totals as (
      select
        count(*) as record_count,
        count(distinct community_id_snapshot) as community_count,
        round(avg(temperature_c), 2) as avg_temperature_c,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(tds_mg_l), 2) as avg_tds_mg_l,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        count(*) filter (where e_coli_sample_taken is true)
          as e_coli_sample_count,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
    )
    select
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(period_rows) || jsonb_build_object(
              'period_end',
              public.ag_reporting_period_end(period_start, v_grouping)
            )
            order by period_start desc
          )
          from period_rows
        ),
        '[]'::jsonb
      ),
      coalesce((select to_jsonb(totals) from totals), '{}'::jsonb)
    into v_rows, v_totals;

  elsif v_type = 'stock' then
    with filtered as (
      select
        record.packed_on as record_date,
        nullif(trim(record.carton_serial), '') as container_key,
        lower(coalesce(record.record_type, 'initial')) as record_type,
        case
          when record.weight_unit = 'L' then record.weight_value
          when record.weight_unit = 'mL' then record.weight_value / 1000
        end as volume_l,
        record.stabilizer_added,
        record.salinity_value,
        record.ph_value,
        record.electrical_conductivity_ms_cm
      from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and record.packed_on between v_start and v_end
    ),
    period_rows as (
      select
        date_trunc(v_grouping, record_date::timestamp)::date as period_start,
        count(*) as record_count,
        count(distinct container_key) filter (where container_key is not null)
          as container_count,
        count(*) filter (where record_type <> 'retest') as new_count,
        count(*) filter (where record_type = 'retest') as retest_count,
        round(coalesce(sum(volume_l) filter (
          where record_type <> 'retest'
        ), 0), 2) as total_volume_l,
        count(*) filter (where stabilizer_added is true) as stabilised_count,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(ph_value), 2) as avg_ph,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
      group by 1
    ),
    totals as (
      select
        count(*) as record_count,
        count(distinct container_key) filter (where container_key is not null)
          as container_count,
        count(*) filter (where record_type <> 'retest') as new_count,
        count(*) filter (where record_type = 'retest') as retest_count,
        round(coalesce(sum(volume_l) filter (
          where record_type <> 'retest'
        ), 0), 2) as total_volume_l,
        count(*) filter (where stabilizer_added is true) as stabilised_count,
        round(avg(salinity_value), 2) as avg_salinity,
        round(avg(ph_value), 2) as avg_ph,
        round(avg(electrical_conductivity_ms_cm), 2) as avg_ec_ms_cm,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
    )
    select
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(period_rows) || jsonb_build_object(
              'period_end',
              public.ag_reporting_period_end(period_start, v_grouping)
            )
            order by period_start desc
          )
          from period_rows
        ),
        '[]'::jsonb
      ),
      coalesce((select to_jsonb(totals) from totals), '{}'::jsonb)
    into v_rows, v_totals;

  else
    with filtered as (
      select
        record.process_date as record_date,
        record.species,
        record.received_seaweed_kg,
        record.blended_seaweed_kg,
        record.wet_pulp_kg,
        record.pressed_liquid_l,
        record.dry_pulp_kg,
        record.lost_seaweed_kg,
        record.number_of_presses,
        record.wet_dry_ratio_percent,
        record.stock_product_ratio_percent
      from public.ag_process_records record
      where record.aggregator_id = v_aggregator_id
        and record.process_date between v_start and v_end
    ),
    period_rows as (
      select
        date_trunc(v_grouping, record_date::timestamp)::date as period_start,
        count(*) as record_count,
        count(distinct species) as species_count,
        round(coalesce(sum(received_seaweed_kg), 0), 2) as received_kg,
        round(coalesce(sum(blended_seaweed_kg), 0), 2) as blended_kg,
        round(coalesce(sum(wet_pulp_kg), 0), 2) as wet_pulp_kg,
        round(coalesce(sum(pressed_liquid_l), 0), 2) as liquid_l,
        round(coalesce(sum(dry_pulp_kg), 0), 2) as dry_pulp_kg,
        round(coalesce(sum(lost_seaweed_kg), 0), 2) as lost_kg,
        coalesce(sum(number_of_presses), 0) as press_count,
        round(avg(wet_dry_ratio_percent), 2) as avg_wet_dry_percent,
        round(avg(stock_product_ratio_percent), 2)
          as avg_stock_product_percent,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
      group by 1
    ),
    totals as (
      select
        count(*) as record_count,
        count(distinct species) as species_count,
        round(coalesce(sum(received_seaweed_kg), 0), 2) as received_kg,
        round(coalesce(sum(blended_seaweed_kg), 0), 2) as blended_kg,
        round(coalesce(sum(wet_pulp_kg), 0), 2) as wet_pulp_kg,
        round(coalesce(sum(pressed_liquid_l), 0), 2) as liquid_l,
        round(coalesce(sum(dry_pulp_kg), 0), 2) as dry_pulp_kg,
        round(coalesce(sum(lost_seaweed_kg), 0), 2) as lost_kg,
        coalesce(sum(number_of_presses), 0) as press_count,
        round(avg(wet_dry_ratio_percent), 2) as avg_wet_dry_percent,
        round(avg(stock_product_ratio_percent), 2)
          as avg_stock_product_percent,
        min(record_date) as first_record_date,
        max(record_date) as last_record_date
      from filtered
    )
    select
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(period_rows) || jsonb_build_object(
              'period_end',
              public.ag_reporting_period_end(period_start, v_grouping)
            )
            order by period_start desc
          )
          from period_rows
        ),
        '[]'::jsonb
      ),
      coalesce((select to_jsonb(totals) from totals), '{}'::jsonb)
    into v_rows, v_totals;
  end if;

  return jsonb_build_object(
    'record_type', v_type,
    'grouping', v_grouping,
    'start_date', v_start,
    'end_date', v_end,
    'rows', v_rows,
    'totals', v_totals
  );
end;
$$;

comment on function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) is
  'Returns tenant-scoped day, ISO-week, month or year totals for Record Ledgers.';

revoke all on function public.ag_reporting_period_end(date, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
