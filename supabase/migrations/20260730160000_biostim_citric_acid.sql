begin;

alter table public.ag_stabilization_packing_records
  add column if not exists citric_acid_added boolean not null default false,
  add column if not exists citric_acid_name text not null default 'Citric acid',
  add column if not exists citric_acid_dose_value numeric(12,3),
  add column if not exists citric_acid_dose_unit text not null default 'g/container';

alter table public.ag_stabilization_packing_records
  drop constraint if exists ag_stabilization_packing_citric_dose_check,
  drop constraint if exists ag_stabilization_packing_citric_dose_unit_check,
  add constraint ag_stabilization_packing_citric_dose_check
    check (citric_acid_dose_value is null or citric_acid_dose_value between 0 and 100000),
  add constraint ag_stabilization_packing_citric_dose_unit_check
    check (citric_acid_dose_unit = 'g/container');

comment on column public.ag_stabilization_packing_records.citric_acid_added is
  'Whether citric acid was added to this BioStim container.';
comment on column public.ag_stabilization_packing_records.citric_acid_name is
  'Fixed display name for the citric acid treatment.';
comment on column public.ag_stabilization_packing_records.citric_acid_dose_value is
  'Citric acid dose in grams per finished container.';
comment on column public.ag_stabilization_packing_records.citric_acid_dose_unit is
  'Fixed unit for citric acid dose: grams per container.';

create or replace function public.ag_submit_stabilization_packing_record_v3_without_organisation_access(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_record_id uuid;
  v_core_record jsonb;
  v_citric_added boolean;
  v_citric_dose numeric;
  v_citric_unit text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'BioStim stock record must be an object.' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_record ->> 'chemical_dose_unit'), ''), 'g/container') <> 'g/container' then
    raise exception 'Sodium benzoate dose must be recorded in grams per container.' using errcode = '22023';
  end if;

  begin
    v_citric_added := coalesce(nullif(p_record ->> 'citric_acid_added', '')::boolean, false);
    v_citric_dose := nullif(p_record ->> 'citric_acid_dose_value', '')::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Citric acid values must be valid.' using errcode = '22023';
  end;
  v_citric_unit := coalesce(
    nullif(trim(p_record ->> 'citric_acid_dose_unit'), ''),
    'g/container'
  );
  if v_citric_unit <> 'g/container' then
    raise exception 'Citric acid dose must be recorded in grams per container.' using errcode = '22023';
  end if;
  if v_citric_dose is not null and (v_citric_dose < 0 or v_citric_dose > 100000) then
    raise exception 'Citric acid dose is outside the allowed range.' using errcode = '22023';
  end if;
  if not v_citric_added then
    v_citric_dose := null;
  end if;

  -- The established core submission function validates its legacy unit list.
  -- Remove the new fields before calling it, then save both modern dose units.
  v_core_record := (p_record - array[
    'citric_acid_added',
    'citric_acid_dose_value',
    'citric_acid_dose_unit'
  ]::text[]);
  v_core_record := jsonb_set(
    v_core_record,
    '{chemical_dose_unit}',
    to_jsonb('g/L'::text),
    true
  );

  v_result := public.ag_submit_stabilization_packing_record_v2(
    p_submission_id,
    v_core_record
  );
  v_record_id := nullif(v_result ->> 'record_id', '')::uuid;

  update public.ag_stabilization_packing_records
  set
    chemical_dose_unit = 'g/container',
    citric_acid_added = v_citric_added,
    citric_acid_name = 'Citric acid',
    citric_acid_dose_value = v_citric_dose,
    citric_acid_dose_unit = 'g/container'
  where id = v_record_id
    and recorded_by_user_id = (select auth.uid());

  update public.ag_audit_log
  set details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
    'chemical_dose_unit', 'g/container',
    'citric_acid_added', v_citric_added,
    'citric_acid_dose_value', v_citric_dose,
    'citric_acid_dose_unit', 'g/container'
  )
  where target_type = 'stabilization_packing_record'
    and target_id = v_record_id::text
    and actor_user_id = (select auth.uid());

  return v_result || jsonb_build_object(
    'chemical_dose_unit', 'g/container',
    'citric_acid_added', v_citric_added,
    'citric_acid_dose_value', v_citric_dose,
    'citric_acid_dose_unit', 'g/container'
  );
end;
$$;

comment on function public.ag_submit_stabilization_packing_record_v3_without_organisation_access(uuid, jsonb) is
  'Submits sodium benzoate and citric acid doses in grams per BioStim container.';

create or replace function public.ag_submit_stabilization_packing_batch_v2_without_organisation_access(
  p_batch_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_core_record jsonb;
  v_citric_added boolean;
  v_citric_dose numeric;
  v_citric_unit text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Batch record must be an object.' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_record ->> 'chemical_dose_unit'), ''), 'g/container') <> 'g/container' then
    raise exception 'Sodium benzoate dose must be recorded in grams per container.' using errcode = '22023';
  end if;

  begin
    v_citric_added := coalesce(nullif(p_record ->> 'citric_acid_added', '')::boolean, false);
    v_citric_dose := nullif(p_record ->> 'citric_acid_dose_value', '')::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Citric acid values must be valid.' using errcode = '22023';
  end;
  v_citric_unit := coalesce(
    nullif(trim(p_record ->> 'citric_acid_dose_unit'), ''),
    'g/container'
  );
  if v_citric_unit <> 'g/container' then
    raise exception 'Citric acid dose must be recorded in grams per container.' using errcode = '22023';
  end if;
  if v_citric_dose is not null and (v_citric_dose < 0 or v_citric_dose > 100000) then
    raise exception 'Citric acid dose is outside the allowed range.' using errcode = '22023';
  end if;
  if not v_citric_added then
    v_citric_dose := null;
  end if;

  v_core_record := (p_record - array[
    'citric_acid_added',
    'citric_acid_dose_value',
    'citric_acid_dose_unit'
  ]::text[]);
  v_core_record := jsonb_set(
    v_core_record,
    '{chemical_dose_unit}',
    to_jsonb('g/L'::text),
    true
  );

  v_result := public.ag_submit_stabilization_packing_batch(
    p_batch_submission_id,
    v_core_record
  );

  update public.ag_stabilization_packing_records
  set
    chemical_dose_unit = 'g/container',
    citric_acid_added = v_citric_added,
    citric_acid_name = 'Citric acid',
    citric_acid_dose_value = v_citric_dose,
    citric_acid_dose_unit = 'g/container'
  where batch_submission_id = p_batch_submission_id
    and recorded_by_user_id = (select auth.uid());

  update public.ag_audit_log
  set details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
    'chemical_dose_unit', 'g/container',
    'citric_acid_added', v_citric_added,
    'citric_acid_dose_value', v_citric_dose,
    'citric_acid_dose_unit', 'g/container'
  )
  where target_type = 'stabilization_packing_record'
    and actor_user_id = (select auth.uid())
    and details ->> 'batch_submission_id' = p_batch_submission_id::text;

  return v_result || jsonb_build_object(
    'chemical_dose_unit', 'g/container',
    'citric_acid_added', v_citric_added,
    'citric_acid_dose_value', v_citric_dose,
    'citric_acid_dose_unit', 'g/container'
  );
end;
$$;

comment on function public.ag_submit_stabilization_packing_batch_v2_without_organisation_access(uuid, jsonb) is
  'Submits sequential BioStim containers with sodium benzoate and citric acid doses per container.';

alter function public.ag_update_daily_form_records(text, jsonb)
  rename to ag_update_daily_form_records_without_citric_acid;

create function public.ag_update_daily_form_records(
  p_record_type text,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_clean_updates jsonb;
  v_aggregator_id uuid;
  v_profile public.ag_user_profiles%rowtype;
  v_item jsonb;
  v_id uuid;
  v_citric_added boolean;
  v_citric_dose numeric;
begin
  select coalesce(
    jsonb_agg(
      value - array[
        'citric_acid_added',
        'citric_acid_dose_value',
        'citric_acid_dose_unit'
      ]::text[]
    ),
    '[]'::jsonb
  )
  into v_clean_updates
  from jsonb_array_elements(p_updates);

  v_result := public.ag_update_daily_form_records_without_citric_acid(
    p_record_type,
    v_clean_updates
  );

  if p_record_type <> 'stock' then
    return v_result;
  end if;

  v_aggregator_id := public.ag_require_active_aggregator();
  select * into v_profile
  from public.ag_user_profiles
  where id = (select auth.uid());

  for v_item in select value from jsonb_array_elements(p_updates)
  loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    select
      case
        when v_item ? 'citric_acid_added'
          then coalesce(nullif(v_item ->> 'citric_acid_added', '')::boolean, false)
        else record.citric_acid_added
      end,
      case
        when v_item ? 'citric_acid_dose_value'
          then nullif(v_item ->> 'citric_acid_dose_value', '')::numeric
        else record.citric_acid_dose_value
      end
    into v_citric_added, v_citric_dose
    from public.ag_stabilization_packing_records record
    where record.id = v_id
      and record.aggregator_id = v_aggregator_id;

    if not found then
      raise exception 'Stock record was not found.' using errcode = 'P0002';
    end if;
    if coalesce(nullif(trim(v_item ->> 'citric_acid_dose_unit'), ''), 'g/container') <> 'g/container' then
      raise exception 'Citric acid dose must be recorded in grams per container.' using errcode = '22023';
    end if;
    if v_citric_dose is not null and (v_citric_dose < 0 or v_citric_dose > 100000) then
      raise exception 'Citric acid dose is outside the allowed range.' using errcode = '22023';
    end if;
    if not v_citric_added then
      v_citric_dose := null;
    end if;

    update public.ag_stabilization_packing_records
    set
      citric_acid_added = v_citric_added,
      citric_acid_name = 'Citric acid',
      citric_acid_dose_value = v_citric_dose,
      citric_acid_dose_unit = 'g/container',
      updated_at = now()
    where id = v_id
      and aggregator_id = v_aggregator_id;

    insert into public.ag_audit_log (
      actor_user_id,
      actor_email,
      action,
      target_type,
      target_id,
      details
    ) values (
      (select auth.uid()),
      v_profile.email,
      'stock_record_citric_acid_updated',
      'stock_record',
      v_id::text,
      jsonb_build_object(
        'aggregator_id', v_aggregator_id,
        'citric_acid_added', v_citric_added,
        'citric_acid_dose_value', v_citric_dose,
        'citric_acid_dose_unit', 'g/container'
      )
    );
  end loop;

  return v_result;
end;
$$;

alter function public.ag_form_record_ledger_without_organisation_access(
  text, date, date, text, text, integer, integer
)
  rename to ag_form_record_ledger_without_organisation_access_before_citric_acid;

create function public.ag_form_record_ledger_without_organisation_access(
  p_record_type text,
  p_start_date date default null,
  p_end_date date default null,
  p_community_id text default null,
  p_search text default null,
  p_page_limit integer default 50,
  p_page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_rows jsonb;
begin
  v_result := public.ag_form_record_ledger_without_organisation_access_before_citric_acid(
    p_record_type,
    p_start_date,
    p_end_date,
    p_community_id,
    p_search,
    p_page_limit,
    p_page_offset
  );

  if p_record_type <> 'stock' then
    return v_result;
  end if;

  select coalesce(
    jsonb_agg(
      row_item.value || jsonb_build_object(
        'chemical_name', record.chemical_name,
        'citric_acid_added', record.citric_acid_added,
        'citric_acid_name', record.citric_acid_name,
        'citric_acid_dose_value', record.citric_acid_dose_value,
        'citric_acid_dose_unit', record.citric_acid_dose_unit
      )
      order by row_item.ordinality
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
    with ordinality as row_item(value, ordinality)
  join public.ag_stabilization_packing_records record
    on record.id = nullif(row_item.value ->> 'id', '')::uuid;

  return jsonb_set(v_result, '{rows}', v_rows, true);
end;
$$;

revoke all on function public.ag_submit_stabilization_packing_record_v3_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_stabilization_packing_batch_v2_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_update_daily_form_records_without_citric_acid(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_update_daily_form_records(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_form_record_ledger_without_organisation_access_before_citric_acid(
  text, date, date, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.ag_form_record_ledger_without_organisation_access(
  text, date, date, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.ag_update_daily_form_records(text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

commit;
