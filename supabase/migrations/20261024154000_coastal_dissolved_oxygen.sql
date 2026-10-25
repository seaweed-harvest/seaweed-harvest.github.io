-- Optional dissolved oxygen for coastal samples; preserve historic data.
begin;
alter table public.ag_site_water_sample_records
  add column if not exists dissolved_oxygen_mg_l numeric(7,3);
alter table public.ag_site_water_sample_records
  add constraint ag_site_water_sample_dissolved_oxygen_check
  check (dissolved_oxygen_mg_l is null or dissolved_oxygen_mg_l between 0 and 50);
comment on column public.ag_site_water_sample_records.dissolved_oxygen_mg_l is
  'Hanna multiparameter probe dissolved oxygen concentration in mg/L; optional for historical records.';

create or replace function public.ag_submit_site_water_sample_record_v5(
  p_submission_id uuid, p_record jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_value numeric;
  v_result jsonb;
  v_record_id uuid;
  v_aggregator_id uuid;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Site water sample must be an object.' using errcode = '22023';
  end if;
  if p_record ? 'dissolved_oxygen_mg_l' and
     jsonb_typeof(p_record -> 'dissolved_oxygen_mg_l') not in ('number', 'null') then
    raise exception 'Dissolved oxygen must be a numeric measurement (mg/L).'
      using errcode = '22023';
  end if;
  v_value := nullif(p_record ->> 'dissolved_oxygen_mg_l', '')::numeric;
  if v_value is not null and (v_value < 0 or v_value > 50) then
    raise exception 'Dissolved oxygen must be 0 to 50 mg/L.'
      using errcode = '22023';
  end if;
  -- Keep the established v4 submission, permission, GPS and audit contract.
  v_result := public.ag_submit_site_water_sample_record_v4(
    p_submission_id, p_record - 'dissolved_oxygen_mg_l'
  );
  -- Preserve v4 retry idempotence: never overwrite an existing record on retry.
  if coalesce((v_result ->> 'duplicate')::boolean, false) then
    return v_result;
  end if;
  v_record_id := nullif(v_result ->> 'record_id', '')::uuid;
  v_aggregator_id := public.ag_require_organisation_capability('form_site_water_samples');
  update public.ag_site_water_sample_records
  set dissolved_oxygen_mg_l = v_value,
      updated_at = now()
  where id = v_record_id
    and aggregator_id = v_aggregator_id
    and recorded_by_user_id = (select auth.uid());
  if not found then
    raise exception 'The saved coastal sample could not be linked to this account.'
      using errcode = '42501';
  end if;
  update public.ag_audit_log
  set details = coalesce(details, '{}'::jsonb)
    || jsonb_build_object('dissolved_oxygen_mg_l', v_value)
  where target_type = 'site_water_sample'
    and target_id = v_record_id::text
    and actor_user_id = (select auth.uid());
  return v_result || jsonb_build_object('dissolved_oxygen_mg_l', v_value);
end;
$$;
revoke all on function public.ag_submit_site_water_sample_record_v5(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.ag_submit_site_water_sample_record_v5(uuid,jsonb)
  to authenticated;

-- Keep pH, DO, and QC photo counts visible without replacing existing ledger logic.
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
    select coalesce(jsonb_agg(e.item || jsonb_build_object('ph_value', s.ph_value, 'dissolved_oxygen_mg_l', s.dissolved_oxygen_mg_l) order by e.pos), '[]'::jsonb)
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
-- Add a dedicated coastal editing RPC that delegates to the current production
-- editor. Never redefine ag_update_daily_form_records: the live wrapper
-- manages other important stock controls (including citric acid).
create or replace function public.ag_update_daily_form_records_with_site_measurements(
  p_record_type text, p_updates jsonb
) returns jsonb
language plpgsql security definer set search_path = public,auth,pg_temp
as $site_edit$
declare
  v_clean jsonb;
  v_result jsonb;
  v_item jsonb;
  v_id uuid;
  v_actor uuid := (select auth.uid());
  v_organisation uuid;
begin
  if p_record_type <> 'site_sample' then
    return public.ag_update_daily_form_records(p_record_type,p_updates);
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'Expected an array of site sample updates.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(value - array['ph_value','dissolved_oxygen_mg_l']::text[]), '[]'::jsonb)
  into v_clean from jsonb_array_elements(p_updates);
  -- Preserve original editor's owner permissions, optimistic locking,
  -- community validation, audit log and existing field behaviour.
  v_result := public.ag_update_daily_form_records(p_record_type,v_clean);
  v_organisation := public.ag_require_organisation_capability('form_site_water_samples');
  for v_item in select value from jsonb_array_elements(p_updates) loop
    if v_item ? 'ph_value' or v_item ? 'dissolved_oxygen_mg_l' then
      v_id := nullif(v_item ->> 'id','')::uuid;
      update public.ag_site_water_sample_records s
      set ph_value = case when v_item ? 'ph_value'
          then nullif(v_item ->> 'ph_value','')::numeric else ph_value end,
          dissolved_oxygen_mg_l = case when v_item ? 'dissolved_oxygen_mg_l'
          then nullif(v_item ->> 'dissolved_oxygen_mg_l','')::numeric else dissolved_oxygen_mg_l end,
          updated_at=now()
      where s.id=v_id and s.aggregator_id=v_organisation
        and (s.recorded_by_user_id=v_actor or public.ag_has_permission('can_edit_collections'));
      if not found then
        raise exception 'You cannot edit this coastal sample.' using errcode='42501';
      end if;
      insert into public.ag_audit_log(actor_user_id,actor_email,action,target_type,target_id,details)
      select v_actor,profile.email,'site_sample_measurements_updated',
        'site_sample_record',v_id::text,
        jsonb_build_object('aggregator_id',v_organisation,'ph_value',v_item->'ph_value',
          'dissolved_oxygen_mg_l',v_item->'dissolved_oxygen_mg_l')
      from public.ag_user_profiles profile where profile.id=v_actor;
    end if;
  end loop;
  return v_result;
end;
$site_edit$;
revoke all on function public.ag_update_daily_form_records_with_site_measurements(text,jsonb)
  from public,anon,authenticated;
grant execute on function public.ag_update_daily_form_records_with_site_measurements(text,jsonb)
  to authenticated;

notify pgrst,'reload schema';
commit;
