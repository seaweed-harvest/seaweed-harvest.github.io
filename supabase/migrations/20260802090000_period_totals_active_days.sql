begin;

alter function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) rename to ag_sec_record_period_totals_without_active_days_legacy;

create function public.ag_sec_record_period_totals(
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
  v_result jsonb;
  v_daily_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_active_day_total integer := 0;
begin
  v_result := public.ag_sec_record_period_totals_without_active_days_legacy(
    p_record_type,
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id,
    p_grade
  );
  v_daily_result := public.ag_sec_record_period_totals_without_active_days_legacy(
    p_record_type,
    p_start_date,
    p_end_date,
    'day',
    p_community_id,
    p_grade
  );

  v_active_day_total := jsonb_array_length(
    coalesce(v_daily_result -> 'rows', '[]'::jsonb)
  );

  select coalesce(
    jsonb_agg(
      row_value || jsonb_build_object(
        'active_day_count',
        (
          select count(*)
          from jsonb_array_elements(
            coalesce(v_daily_result -> 'rows', '[]'::jsonb)
          ) as daily(day_value)
          where (day_value ->> 'period_start')::date between
            (row_value ->> 'period_start')::date
            and (row_value ->> 'period_end')::date
        )
      )
      order by ordinal
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
    with ordinality as source(row_value, ordinal);

  return jsonb_set(
    jsonb_set(v_result, '{rows}', v_rows, true),
    '{totals}',
    coalesce(v_result -> 'totals', '{}'::jsonb)
      || jsonb_build_object('active_day_count', v_active_day_total),
    true
  );
end;
$$;

comment on function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) is
  'Returns tenant-scoped period totals with the number of active record days.';

comment on function public.ag_sec_record_period_totals_without_active_days_legacy(
  text, date, date, text, text, text
) is
  'Legacy period totals implementation wrapped by ag_sec_record_period_totals.';

revoke all on function public.ag_sec_record_period_totals_without_active_days_legacy(
  text, date, date, text, text, text
) from public, anon, authenticated;
revoke all on function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.ag_sec_record_period_totals(
  text, date, date, text, text, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
