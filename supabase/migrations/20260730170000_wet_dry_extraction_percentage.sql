begin;

alter table public.ag_process_records
  drop column if exists wet_dry_ratio_percent;

alter table public.ag_process_records
  add column wet_dry_ratio_percent numeric(10,3) generated always as (
    case
      when dry_pulp_kg is not null and wet_pulp_kg > 0
      then round(
        ((wet_pulp_kg - dry_pulp_kg) / wet_pulp_kg) * 100,
        1
      )
    end
  ) stored;

comment on column public.ag_process_records.wet_dry_ratio_percent is
  'Percentage of wet pulp weight removed during drying: (wet pulp - dry pulp) / wet pulp x 100.';

alter function public.ag_sec_operational_summary(date, date, text, text)
  rename to ag_sec_operational_summary_dry_yield_legacy;

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
  v_rows jsonb;
begin
  v_result := public.ag_sec_operational_summary_dry_yield_legacy(
    p_start_date,
    p_end_date,
    p_grouping,
    p_community_id
  );

  v_totals := coalesce(v_result -> 'totals', '{}'::jsonb);
  if jsonb_typeof(v_totals -> 'process_wet_dry_percent') = 'number' then
    v_totals := jsonb_set(
      v_totals,
      '{process_wet_dry_percent}',
      to_jsonb(round(
        100 - (v_totals ->> 'process_wet_dry_percent')::numeric,
        1
      )),
      false
    );
  end if;
  v_result := jsonb_set(v_result, '{totals}', v_totals, true);

  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(row_value -> 'process_wet_dry_percent') = 'number'
        then jsonb_set(
          row_value,
          '{process_wet_dry_percent}',
          to_jsonb(round(
            100 - (row_value ->> 'process_wet_dry_percent')::numeric,
            1
          )),
          false
        )
      else row_value
    end
    order by ordinal
  ), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
    with ordinality as rows(row_value, ordinal);

  return jsonb_set(v_result, '{rows}', v_rows, true);
end;
$$;

comment on function public.ag_sec_operational_summary(date, date, text, text) is
  'Returns tenant-scoped operational summaries with wet/dry extraction expressed as wet-weight removed during drying.';

revoke all on function public.ag_sec_operational_summary_dry_yield_legacy(date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_sec_operational_summary(date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.ag_sec_operational_summary(date, date, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
