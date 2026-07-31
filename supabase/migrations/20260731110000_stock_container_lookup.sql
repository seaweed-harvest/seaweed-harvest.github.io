begin;

create index if not exists ag_stabilization_packing_records_container_lookup_idx
  on public.ag_stabilization_packing_records (
    aggregator_id,
    packed_on,
    carton_serial,
    created_at
  );

create or replace function public.ag_stock_container_lookup(
  p_containers text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_result_limit integer default 2000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_start date := coalesce(p_start_date, p_end_date);
  v_end date := coalesce(p_end_date, p_start_date);
  v_limit integer := least(greatest(coalesce(p_result_limit, 2000), 1), 5000);
  v_result jsonb;
begin
  perform public.ag_require_permission('can_view_data');
  perform public.ag_require_organisation_capability('form_stock_record');
  v_aggregator_id := public.ag_require_active_aggregator();

  if v_start is not null and v_end < v_start then
    raise exception 'End date must be on or after start date.' using errcode = '22023';
  end if;

  with requested as (
    select distinct
      case
        when trim(token) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(trim(token), '0'), ''), '0')
        else upper(trim(token))
      end as container_key
    from regexp_split_to_table(coalesce(p_containers, ''), '[,\s]+') as token
    where trim(token) <> ''
  ),
  filtered as (
    select
      record.id,
      record.carton_serial,
      case
        when trim(record.carton_serial) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(trim(record.carton_serial), '0'), ''), '0')
        else upper(trim(record.carton_serial))
      end as container_key,
      trim(record.carton_serial) ~ '^[0-9]+$' as container_is_numeric,
      case
        when trim(record.carton_serial) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(trim(record.carton_serial), '0'), ''), '0')::numeric
        else null
      end as container_sort_number,
      record.packed_on as record_date,
      record.record_type,
      record.test_sequence,
      record.species,
      record.weight_value,
      record.weight_unit,
      record.stabilizer_added,
      record.chemical_name,
      record.chemical_dose_value,
      record.chemical_dose_unit,
      record.citric_acid_added,
      record.citric_acid_name,
      record.citric_acid_dose_value,
      record.citric_acid_dose_unit,
      record.salinity_value,
      record.salinity_unit,
      record.ph_value,
      record.electrical_conductivity_ms_cm,
      record.recorded_by_name,
      record.notes,
      record.created_at
    from public.ag_stabilization_packing_records record
    where record.aggregator_id = v_aggregator_id
      and (v_start is null or record.packed_on >= v_start)
      and (v_end is null or record.packed_on <= v_end)
      and (
        not exists (select 1 from requested)
        or (
          case
            when trim(record.carton_serial) ~ '^[0-9]+$'
              then coalesce(nullif(ltrim(trim(record.carton_serial), '0'), ''), '0')
            else upper(trim(record.carton_serial))
          end
        ) in (select requested.container_key from requested)
      )
  ),
  totals as (
    select
      count(*)::integer as total_count,
      count(distinct container_key)::integer as container_count
    from filtered
  ),
  limited as (
    select *
    from filtered
    order by
      container_is_numeric desc,
      container_sort_number asc nulls last,
      container_key asc,
      record_date asc,
      test_sequence asc nulls last,
      created_at asc
    limit v_limit
  )
  select jsonb_build_object(
    'rows',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(limited)
            - 'container_is_numeric'
            - 'container_sort_number'
          order by
            container_is_numeric desc,
            container_sort_number asc nulls last,
            container_key asc,
            record_date asc,
            test_sequence asc nulls last,
            created_at asc
        )
        from limited
      ),
      '[]'::jsonb
    ),
    'record_count', totals.total_count,
    'container_count', totals.container_count,
    'truncated', totals.total_count > v_limit
  )
  into v_result
  from totals;

  return coalesce(
    v_result,
    jsonb_build_object(
      'rows', '[]'::jsonb,
      'record_count', 0,
      'container_count', 0,
      'truncated', false
    )
  );
end;
$$;

revoke all on function public.ag_stock_container_lookup(text, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.ag_stock_container_lookup(text, date, date, integer)
  to authenticated;

comment on function public.ag_stock_container_lookup(text, date, date, integer) is
  'Returns organisation-scoped BioStim stock records grouped by normalized container serial for initial/retest comparison.';

notify pgrst, 'reload schema';

commit;
