begin;

with backfilled as (
  update public.ag_stabilization_packing_records
  set
    citric_acid_added = true,
    citric_acid_name = 'Citric acid',
    citric_acid_dose_value = 8,
    citric_acid_dose_unit = 'g/container',
    updated_at = now()
  where id in (
    '9ffddb77-b257-4831-9c57-ec4b2695cee5'::uuid,
    'ef54ed6c-e5f0-481a-8d36-47b4ab2e91cd'::uuid,
    'd60b845e-837e-4a31-b98a-4b6d2913b7a8'::uuid,
    '33987f52-0e2a-4441-9d32-23d3ab29e5ee'::uuid,
    '6f3b71de-7563-4e72-b86b-b512c3fbaee9'::uuid
  )
    and aggregator_id = '3db3220a-5c62-4e72-8872-6ea8b939ddb1'::uuid
    and packed_on = date '2026-07-29'
    and citric_acid_added is false
    and citric_acid_dose_value is null
    and lower(notes) ~ '8\s*grams?\s+of\s+c[ei]tric acid'
  returning id, aggregator_id, notes
)
insert into public.ag_audit_log (
  actor_email,
  action,
  target_type,
  target_id,
  details
)
select
  'system-migration@seaweed-harvest.local',
  'stock_citric_acid_backfilled',
  'stabilization_packing_record',
  id::text,
  jsonb_build_object(
    'aggregator_id', aggregator_id,
    'packed_on', '2026-07-29',
    'citric_acid_added', true,
    'citric_acid_dose_value', 8,
    'citric_acid_dose_unit', 'g/container',
    'source', 'explicit historical note',
    'original_note', notes
  )
from backfilled;

create or replace function public.ag_operational_range_label(
  p_min numeric,
  p_max numeric,
  p_unit text default null
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_min is null then null
    when p_max is null or p_min = p_max
      then to_char(p_min, 'FM999999999999990.###')
    else
      to_char(p_min, 'FM999999999999990.###')
      || ' - '
      || to_char(p_max, 'FM999999999999990.###')
  end
  || case
    when nullif(trim(coalesce(p_unit, '')), '') is null then ''
    else ' ' || trim(p_unit)
  end;
$$;

alter function public.ag_sec_operational_summary(date, date, text, text)
  rename to ag_sec_operational_summary_community_legacy;

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
  v_aggregator_id uuid;
  v_start date := coalesce(
    p_start_date,
    date_trunc('year', now() at time zone 'Africa/Nairobi')::date
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_grouping text := lower(trim(coalesce(p_grouping, 'day')));
  v_stock_ranges_by_period jsonb := '{}'::jsonb;
  v_total_stock_ranges jsonb := '{}'::jsonb;
  v_totals jsonb;
  v_rows jsonb;
begin
  v_result := public.ag_sec_operational_summary_community_legacy(
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id
  );
  v_aggregator_id := public.ag_require_active_aggregator();

  with
  stock_filtered as (
    select
      public.ag_operational_period_start(stock.packed_on, v_grouping)
        as period_start,
      case
        when stock.stabilizer_added is true
          then stock.chemical_dose_value
      end as sodium_benzoate_dose,
      coalesce(
        nullif(trim(stock.chemical_dose_unit), ''),
        'g/container'
      ) as sodium_benzoate_unit,
      case
        when stock.citric_acid_added is true
          then stock.citric_acid_dose_value
      end as citric_acid_dose,
      coalesce(
        nullif(trim(stock.citric_acid_dose_unit), ''),
        'g/container'
      ) as citric_acid_unit,
      stock.salinity_value,
      coalesce(nullif(trim(stock.salinity_unit), ''), 'PSU')
        as salinity_unit,
      stock.ph_value,
      stock.electrical_conductivity_ms_cm as ec_value
    from public.ag_stabilization_packing_records stock
    where stock.aggregator_id = v_aggregator_id
      and stock.packed_on between v_start and v_end
  ),
  stock_periods as (
    select period_start
    from stock_filtered
    group by grouping sets ((period_start), ())
  ),
  sodium_unit_ranges as (
    select
      period_start,
      sodium_benzoate_unit as unit,
      min(sodium_benzoate_dose) as minimum_value,
      max(sodium_benzoate_dose) as maximum_value
    from stock_filtered
    where sodium_benzoate_dose is not null
    group by grouping sets (
      (period_start, sodium_benzoate_unit),
      (sodium_benzoate_unit)
    )
  ),
  sodium_ranges as (
    select
      period_start,
      string_agg(
        public.ag_operational_range_label(
          minimum_value,
          maximum_value,
          unit
        ),
        '; ' order by unit
      ) as range_label
    from sodium_unit_ranges
    group by period_start
  ),
  citric_unit_ranges as (
    select
      period_start,
      citric_acid_unit as unit,
      min(citric_acid_dose) as minimum_value,
      max(citric_acid_dose) as maximum_value
    from stock_filtered
    where citric_acid_dose is not null
    group by grouping sets (
      (period_start, citric_acid_unit),
      (citric_acid_unit)
    )
  ),
  citric_ranges as (
    select
      period_start,
      string_agg(
        public.ag_operational_range_label(
          minimum_value,
          maximum_value,
          unit
        ),
        '; ' order by unit
      ) as range_label
    from citric_unit_ranges
    group by period_start
  ),
  salinity_unit_ranges as (
    select
      period_start,
      salinity_unit as unit,
      min(salinity_value) as minimum_value,
      max(salinity_value) as maximum_value
    from stock_filtered
    where salinity_value is not null
    group by grouping sets (
      (period_start, salinity_unit),
      (salinity_unit)
    )
  ),
  salinity_ranges as (
    select
      period_start,
      string_agg(
        public.ag_operational_range_label(
          minimum_value,
          maximum_value,
          unit
        ),
        '; ' order by unit
      ) as range_label
    from salinity_unit_ranges
    group by period_start
  ),
  qc_ranges as (
    select
      period_start,
      min(ph_value) as ph_min,
      max(ph_value) as ph_max,
      min(ec_value) as ec_min,
      max(ec_value) as ec_max
    from stock_filtered
    group by grouping sets ((period_start), ())
  ),
  stock_range_rows as (
    select
      period.period_start,
      sodium.range_label as stock_sodium_benzoate_range,
      citric.range_label as stock_citric_acid_range,
      salinity.range_label as stock_salinity_range,
      public.ag_operational_range_label(qc.ph_min, qc.ph_max)
        as stock_ph_range,
      public.ag_operational_range_label(qc.ec_min, qc.ec_max, 'mS/cm')
        as stock_ec_range
    from stock_periods period
    left join sodium_ranges sodium
      on sodium.period_start is not distinct from period.period_start
    left join citric_ranges citric
      on citric.period_start is not distinct from period.period_start
    left join salinity_ranges salinity
      on salinity.period_start is not distinct from period.period_start
    left join qc_ranges qc
      on qc.period_start is not distinct from period.period_start
  )
  select
    coalesce(
      jsonb_object_agg(
        period_start::text,
        jsonb_strip_nulls(jsonb_build_object(
          'stock_sodium_benzoate_range', stock_sodium_benzoate_range,
          'stock_citric_acid_range', stock_citric_acid_range,
          'stock_salinity_range', stock_salinity_range,
          'stock_ph_range', stock_ph_range,
          'stock_ec_range', stock_ec_range
        ))
      ) filter (where period_start is not null),
      '{}'::jsonb
    ),
    coalesce(
      (
        jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'stock_sodium_benzoate_range', stock_sodium_benzoate_range,
          'stock_citric_acid_range', stock_citric_acid_range,
          'stock_salinity_range', stock_salinity_range,
          'stock_ph_range', stock_ph_range,
          'stock_ec_range', stock_ec_range
        ))) filter (where period_start is null)
      ) -> 0,
      '{}'::jsonb
    )
  into v_stock_ranges_by_period, v_total_stock_ranges
  from stock_range_rows;

  v_totals := coalesce(v_result -> 'totals', '{}'::jsonb)
    || v_total_stock_ranges;
  v_result := jsonb_set(v_result, '{totals}', v_totals, true);

  select coalesce(jsonb_agg(
    row_value
      || coalesce(
        v_stock_ranges_by_period -> (row_value ->> 'period_start'),
        '{}'::jsonb
      )
    order by ordinal
  ), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
    with ordinality as rows(row_value, ordinal);

  return jsonb_set(v_result, '{rows}', v_rows, true);
end;
$$;

comment on function public.ag_sec_operational_summary(date, date, text, text) is
  'Returns tenant-scoped operational summaries with stock stabiliser-dose and QC measurement ranges.';

revoke all on function public.ag_operational_range_label(numeric, numeric, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary_community_legacy(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary(date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.ag_sec_operational_summary(date, date, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
