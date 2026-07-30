begin;

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
      then rtrim(to_char(p_min, 'FM999999999999990.999'), '.')
    else
      rtrim(to_char(p_min, 'FM999999999999990.999'), '.')
      || ' - '
      || rtrim(to_char(p_max, 'FM999999999999990.999'), '.')
  end
  || case
    when nullif(trim(coalesce(p_unit, '')), '') is null then ''
    else ' ' || trim(p_unit)
  end;
$$;

comment on function public.ag_operational_range_label(numeric, numeric, text) is
  'Formats a single operational value or min-max range with up to three decimals and no trailing decimal point.';

revoke all on function public.ag_operational_range_label(numeric, numeric, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
