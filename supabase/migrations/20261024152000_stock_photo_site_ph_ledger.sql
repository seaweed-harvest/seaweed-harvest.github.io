-- Preserve the original ledger RPC while enriching site pH and stock photos for display.
begin;
create or replace function public.ag_form_record_ledger_v2(
  p_record_type text,
  p_start_date date default null, p_end_date date default null,
  p_community_id text default null, p_search text default null,
  p_page_limit integer default 50, p_page_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public,auth,pg_temp
as $$
declare
  v_response jsonb;
  v_organisation uuid;
  v_rows jsonb;
begin
  v_response := public.ag_form_record_ledger(
    p_record_type,p_start_date,p_end_date,p_community_id,p_search,p_page_limit,p_page_offset
  );
  if p_record_type not in ('site_sample','stock') then return v_response; end if;
  v_organisation := public.ag_require_active_aggregator();
  if p_record_type = 'site_sample' then
    select coalesce(jsonb_agg(e.item || jsonb_build_object('ph_value', s.ph_value) order by e.pos), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_response -> 'rows') with ordinality as e(item,pos)
    join public.ag_site_water_sample_records s
      on s.id=(e.item ->> 'id')::uuid and s.aggregator_id=v_organisation;
  else
    select coalesce(jsonb_agg(e.item || jsonb_build_object('photo_count',
      jsonb_array_length(s.photo_attachments)) order by e.pos), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_response -> 'rows') with ordinality as e(item,pos)
    join public.ag_stabilization_packing_records s
      on s.id=(e.item ->> 'id')::uuid and s.aggregator_id=v_organisation;
  end if;
  return jsonb_set(v_response,'{rows}',v_rows,true);
end;
$$;
revoke all on function public.ag_form_record_ledger_v2(text,date,date,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.ag_form_record_ledger_v2(text,date,date,text,text,integer,integer)
  to authenticated;
notify pgrst,'reload schema';
commit;
