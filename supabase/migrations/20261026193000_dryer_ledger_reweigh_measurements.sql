-- Keep the existing authenticated ledger contract and add measured reweigh events.
-- Calling the original function first preserves its COSME owner/capability checks.
create or replace function public.list_authenticated_seaweed_drying_ledger_with_reweighs(
  p_account_access_token text,
  p_limit integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ledger jsonb;
  v_events jsonb;
begin
  v_ledger := public.list_authenticated_seaweed_drying_ledger(
    p_account_access_token,
    p_limit
  );

  select coalesce(jsonb_agg(to_jsonb(event_row) order by event_row.reweigh_at, event_row.id), '[]'::jsonb)
    into v_events
  from (
    select
      event.id,
      event.submission_id,
      event.reweigh_at,
      event.weather,
      event.notes,
      (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'bay_number', bay.bay_number,
            'weight_kg', bay.weight_g / 1000.0,
            'photo_count', coalesce(cardinality(bay.photo_paths), 0)
          ) order by bay.bay_number
        ), '[]'::jsonb)
        from public.seaweed_drying_reweigh_bay_records bay
        where bay.reweigh_id = event.id
          and bay.submission_id = event.submission_id
      ) as bays
    from public.seaweed_drying_reweigh_events event
    where event.submission_id in (
      select distinct (row_data->>'submission_id')::uuid
      from jsonb_array_elements(v_ledger->'bay_rows') as ledger_bay(row_data)
    )
  ) event_row;

  return v_ledger || jsonb_build_object(
    'reweigh_events', v_events,
    'reweigh_event_count', jsonb_array_length(v_events)
  );
end;
$function$;

revoke all on function public.list_authenticated_seaweed_drying_ledger_with_reweighs(text, integer) from public;
grant execute on function public.list_authenticated_seaweed_drying_ledger_with_reweighs(text, integer) to anon, authenticated;

comment on function public.list_authenticated_seaweed_drying_ledger_with_reweighs(text, integer) is
  'COSME owner-authorized dryer ledger with intermediate bay weights, measurement times and weather.';
