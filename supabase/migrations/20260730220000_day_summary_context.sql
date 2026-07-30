begin;

alter function public.ag_sec_operational_summary(date, date, text, text)
  rename to ag_sec_operational_summary_stock_ranges_legacy;

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
  v_community_id text := nullif(trim(coalesce(p_community_id, '')), '');
  v_breakdowns_by_period jsonb := '{}'::jsonb;
  v_total_breakdown jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_rows jsonb;
begin
  v_result := public.ag_sec_operational_summary_stock_ranges_legacy(
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id
  );
  v_aggregator_id := public.ag_require_active_aggregator();

  with
  collection_rows as (
    select
      public.ag_operational_period_start(
        (collection.collected_at at time zone 'Africa/Nairobi')::date,
        v_grouping
      ) as period_start,
      coalesce(
        nullif(trim(collection.community_id), ''),
        nullif(lower(trim(collection.community_name_snapshot)), ''),
        'community-not-recorded'
      ) as community_key,
      coalesce(
        nullif(trim(collection.community_name_snapshot), ''),
        nullif(trim(collection.community_id), ''),
        'Community not recorded'
      ) as community_name,
      coalesce(collection.sack_weight_kg, 0) as weight_kg
    from public.collections collection
    where collection.aggregator_id = v_aggregator_id
      and (collection.collected_at at time zone 'Africa/Nairobi')::date
        between v_start and v_end
      and (
        v_community_id is null
        or collection.community_id = v_community_id
      )
  ),
  community_weights as (
    select
      period_start,
      community_key,
      max(community_name) as community_name,
      round(sum(weight_kg), 2) as weight_kg
    from collection_rows
    group by period_start, community_key
  ),
  period_breakdowns as (
    select
      period_start,
      jsonb_agg(
        jsonb_build_object(
          'community_name', community_name,
          'weight_kg', weight_kg
        )
        order by community_name
      ) as breakdown
    from community_weights
    group by period_start
  ),
  total_weights as (
    select
      community_key,
      max(community_name) as community_name,
      round(sum(weight_kg), 2) as weight_kg
    from collection_rows
    group by community_key
  )
  select
    coalesce(
      (select jsonb_object_agg(period_start::text, breakdown)
       from period_breakdowns),
      '{}'::jsonb
    ),
    coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'community_name', community_name,
          'weight_kg', weight_kg
        )
        order by community_name
      )
      from total_weights),
      '[]'::jsonb
    )
  into v_breakdowns_by_period, v_total_breakdown;

  v_totals := coalesce(v_result -> 'totals', '{}'::jsonb);
  if coalesce((v_totals ->> 'stock_volume_l')::numeric, 0) <= 0 then
    v_totals := v_totals
      - 'stock_sodium_benzoate_range'
      - 'stock_citric_acid_range'
      - 'stock_salinity_range'
      - 'stock_ph_range'
      - 'stock_ec_range';
  end if;
  v_totals := jsonb_set(
    v_totals,
    '{intake_community_breakdown}',
    v_total_breakdown,
    true
  );
  v_result := jsonb_set(v_result, '{totals}', v_totals, true);

  select coalesce(jsonb_agg(
    (
      case
        when coalesce((row_value ->> 'stock_volume_l')::numeric, 0) > 0
          then row_value
        else row_value
          - 'stock_sodium_benzoate_range'
          - 'stock_citric_acid_range'
          - 'stock_salinity_range'
          - 'stock_ph_range'
          - 'stock_ec_range'
      end
    )
    || jsonb_build_object(
      'intake_community_breakdown',
      coalesce(
        v_breakdowns_by_period -> (row_value ->> 'period_start'),
        '[]'::jsonb
      )
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
  'Returns tenant-scoped operational summaries with per-community intake weights and stock ranges only when liquid volume was recorded in the period.';

revoke all on function public.ag_sec_operational_summary_stock_ranges_legacy(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary(date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.ag_sec_operational_summary(date, date, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
