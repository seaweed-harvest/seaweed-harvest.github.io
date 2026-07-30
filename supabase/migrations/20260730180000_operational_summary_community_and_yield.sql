begin;

alter function public.ag_sec_operational_summary(date, date, text, text)
  rename to ag_sec_operational_summary_extraction_legacy;

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
  v_names_by_period jsonb := '{}'::jsonb;
  v_total_names text := '';
  v_totals jsonb;
  v_rows jsonb;
begin
  v_result := public.ag_sec_operational_summary_extraction_legacy(
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id
  );
  v_aggregator_id := public.ag_require_active_aggregator();

  with raw_labels as (
    select
      public.ag_operational_period_start(
        (collection.collected_at at time zone 'Africa/Nairobi')::date,
        v_grouping
      ) as period_start,
      coalesce(
        nullif(trim(collection.community_id), ''),
        nullif(lower(trim(collection.community_name_snapshot)), '')
      ) as community_key,
      concat_ws(
        ' - ',
        nullif(trim(collection.community_id), ''),
        nullif(trim(collection.community_name_snapshot), '')
      ) as community_label
    from public.collections collection
    where collection.aggregator_id = v_aggregator_id
      and (collection.collected_at at time zone 'Africa/Nairobi')::date
        between v_start and v_end
      and (
        v_community_id is null
        or collection.community_id = v_community_id
      )
  ),
  community_labels as (
    select
      period_start,
      community_key,
      max(community_label) as community_label
    from raw_labels
    where community_key is not null
      and nullif(community_label, '') is not null
    group by period_start, community_key
  ),
  period_names as (
    select
      period_start,
      string_agg(community_label, ', ' order by community_label)
        as community_names
    from community_labels
    group by period_start
  ),
  total_names as (
    select
      community_key,
      max(community_label) as community_label
    from community_labels
    group by community_key
  )
  select
    coalesce(
      (select jsonb_object_agg(period_start::text, community_names)
       from period_names),
      '{}'::jsonb
    ),
    coalesce(
      (select string_agg(community_label, ', ' order by community_label)
       from total_names),
      ''
    )
  into v_names_by_period, v_total_names;

  v_totals := coalesce(v_result -> 'totals', '{}'::jsonb);
  v_totals := jsonb_set(
    v_totals,
    '{intake_community_names}',
    to_jsonb(v_total_names),
    true
  );
  v_totals := jsonb_set(
    v_totals,
    '{stock_l_per_intake_kg}',
    case
      when coalesce((v_totals ->> 'intake_weight_kg')::numeric, 0) > 0
        then to_jsonb(round(
          coalesce((v_totals ->> 'stock_volume_l')::numeric, 0)
            / (v_totals ->> 'intake_weight_kg')::numeric,
          3
        ))
      else 'null'::jsonb
    end,
    true
  );
  v_result := jsonb_set(v_result, '{totals}', v_totals, true);

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        row_value,
        '{intake_community_names}',
        to_jsonb(coalesce(
          v_names_by_period ->> (row_value ->> 'period_start'),
          ''
        )),
        true
      ),
      '{stock_l_per_intake_kg}',
      case
        when coalesce((row_value ->> 'intake_weight_kg')::numeric, 0) > 0
          then to_jsonb(round(
            coalesce((row_value ->> 'stock_volume_l')::numeric, 0)
              / (row_value ->> 'intake_weight_kg')::numeric,
            3
          ))
        else 'null'::jsonb
      end,
      true
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
  'Returns tenant-scoped operational summaries with intake community names, number of presses, and stock litres per intake kilogram.';

revoke all on function public.ag_sec_operational_summary_extraction_legacy(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary(date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.ag_sec_operational_summary(date, date, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
