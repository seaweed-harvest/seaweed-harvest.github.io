begin;

-- Existing records are preserved. One physical ID is assigned per historical
-- aggregator + exact serial history; alias variants remain distinct instances
-- but resolve to the same numeric label for matching and warnings.
alter table public.ag_stabilization_packing_records
  add column if not exists carton_instance_id uuid;

with identities as (
  select id, first_value(id) over (
    partition by aggregator_id, carton_serial
    order by case when record_type = 'initial' then 0 else 1 end,
             created_at asc, id
  ) as initial_id
  from public.ag_stabilization_packing_records
)
update public.ag_stabilization_packing_records record
set carton_instance_id = identities.initial_id
from identities where identities.id = record.id
  and record.carton_instance_id is null;

alter table public.ag_stabilization_packing_records
  alter column carton_instance_id set default gen_random_uuid(),
  alter column carton_instance_id set not null;
drop index if exists public.ag_stabilization_packing_initial_carton_unique;
create index if not exists ag_stabilization_packing_instance_history_idx
  on public.ag_stabilization_packing_records
  (aggregator_id, carton_instance_id, packed_on desc);
create index if not exists ag_stabilization_packing_numeric_label_idx
  on public.ag_stabilization_packing_records
  (aggregator_id, (coalesce(nullif(ltrim(carton_serial, '0'), ''), '0')));

alter table public.ag_stabilization_packing_records
  add column if not exists brix_value numeric(6,2),
  add column if not exists hydrometer_value numeric(12,4),
  add column if not exists hydrometer_scale text;

alter table public.ag_stabilization_packing_records
  drop constraint if exists ag_stabilization_packing_brix_check,
  drop constraint if exists ag_stabilization_packing_hydrometer_check,
  drop constraint if exists ag_stabilization_packing_hydrometer_scale_check,
  add constraint ag_stabilization_packing_brix_check
    check (brix_value is null or brix_value between 0 and 100),
  add constraint ag_stabilization_packing_hydrometer_check
    check (hydrometer_value is null or hydrometer_value between -1000 and 1000),
  add constraint ag_stabilization_packing_hydrometer_scale_check
    check (hydrometer_scale is null or hydrometer_scale in ('SG', 'Baume', 'g/mL', 'unconfirmed'));

comment on column public.ag_stabilization_packing_records.carton_instance_id is
  'Identity of a physical carton; duplicates of a printed serial have different IDs.';
comment on column public.ag_stabilization_packing_records.brix_value is
  'Refractometer reading in degrees Brix. Current quoted instrument range: 0 to 55.';
comment on column public.ag_stabilization_packing_records.hydrometer_value is
  'Direct reading from the heavy-liquid hydrometer, with its scale stored separately.';
comment on column public.ag_stabilization_packing_records.hydrometer_scale is
  'Scale printed on the hydrometer. Not specified in the purchase quotation.';

-- Preflight for a manual entry and an unambiguous target for a retest.
create or replace function public.ag_stabilization_carton_matches(p_serial text)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_key text;
  v_rows jsonb;
  v_count integer;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability('form_stock_record');
  if p_serial is null or trim(p_serial) !~ '^[0-9]{1,30}$' then
    raise exception 'Carton number must contain 1-30 digits.' using errcode='22023';
  end if;
  v_key := coalesce(nullif(ltrim(trim(p_serial), '0'), ''), '0');

  with instances as (
    select distinct on (record.carton_instance_id)
      record.carton_instance_id, record.carton_serial, record.packed_on,
      record.weight_value, record.weight_unit, record.recorded_by_name,
      record.created_at
    from public.ag_stabilization_packing_records record
    where record.aggregator_id = v_aggregator_id
      and coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') = v_key
    order by record.carton_instance_id,
      case when record.record_type = 'initial' then 0 else 1 end,
      record.created_at asc
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'carton_instance_id', carton_instance_id,
      'carton_serial', carton_serial,
      'packed_on', packed_on,
      'volume_value', weight_value,
      'volume_unit', weight_unit,
      'recorded_by_name', recorded_by_name
    ) order by packed_on desc, carton_instance_id), '[]'::jsonb)
  into v_count, v_rows
  from instances;

  return jsonb_build_object('canonical_number', v_key,
    'physical_count', v_count, 'cartons', v_rows);
end;
$$;

create or replace function public.ag_submit_stabilization_packing_record(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_profile public.ag_user_profiles%rowtype;
  v_aggregator_id uuid;
  v_existing public.ag_stabilization_packing_records%rowtype;
  v_saved public.ag_stabilization_packing_records%rowtype;
  v_unknown_keys text[];
  v_record_type text;
  v_auto_serial boolean;
  v_carton_serial text;
  v_test_sequence integer;
  v_packed_on date;
  v_species text;
  v_weight_value numeric;
  v_weight_unit text;
  v_temperature numeric;
  v_salinity numeric;
  v_salinity_unit text;
  v_ph numeric;
  v_ec numeric;
  v_dose numeric;
  v_dose_unit text;
  v_notes text;
  v_allow_duplicate boolean := false;
  v_instance_id uuid;
  v_match_count integer := 0;
  v_serial_key text;
  v_display_serial text;
begin
  perform public.ag_require_permission('can_submit_collection');
  if p_submission_id is null then raise exception 'Submission ID is required.' using errcode = '22023'; end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Packing record must be an object.' using errcode = '22023';
  end if;

  select array_agg(key order by key) into v_unknown_keys
  from jsonb_object_keys(p_record) key
  where key <> all(array[
    'record_type', 'auto_carton_serial', 'carton_serial', 'packed_on', 'species',
    'weight_value', 'weight_unit', 'room_temperature_c', 'salinity_value',
    'salinity_unit', 'ph_value', 'electrical_conductivity_ms_cm',
    'chemical_dose_value', 'chemical_dose_unit', 'notes',
    'allow_duplicate_carton', 'carton_instance_id'
  ]::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported packing fields: %', array_to_string(v_unknown_keys, ', ') using errcode = '22023';
  end if;

  v_aggregator_id := public.ag_require_active_aggregator();
  select * into v_profile
  from public.ag_user_profiles
  where id = v_actor_id and account_status = 'active';
  if not found then raise exception 'Active user profile is required.' using errcode = '42501'; end if;

  select * into v_existing
  from public.ag_stabilization_packing_records
  where aggregator_id = v_aggregator_id and submission_id = p_submission_id;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'record_id', v_existing.id,
      'record_type', v_existing.record_type,
      'test_sequence', v_existing.test_sequence,
      'carton_serial', v_existing.carton_serial,
      'carton_instance_id', v_existing.carton_instance_id,
      'packed_on', v_existing.packed_on,
      'next_carton_serial', public.ag_next_stabilization_carton_serial(v_aggregator_id)
    );
  end if;

  v_record_type := lower(coalesce(nullif(trim(p_record ->> 'record_type'), ''), 'initial'));
  v_auto_serial := coalesce(nullif(p_record ->> 'auto_carton_serial', '')::boolean, false);
  v_carton_serial := nullif(trim(p_record ->> 'carton_serial'), '');
  v_allow_duplicate := coalesce(nullif(p_record ->> 'allow_duplicate_carton', '')::boolean, false);
  v_instance_id := nullif(p_record ->> 'carton_instance_id', '')::uuid;
  v_packed_on := nullif(p_record ->> 'packed_on', '')::date;
  v_species := lower(nullif(trim(p_record ->> 'species'), ''));
  v_weight_value := nullif(p_record ->> 'weight_value', '')::numeric;
  v_weight_unit := coalesce(nullif(trim(p_record ->> 'weight_unit'), ''), 'kg');
  v_temperature := nullif(p_record ->> 'room_temperature_c', '')::numeric;
  v_salinity := nullif(p_record ->> 'salinity_value', '')::numeric;
  v_salinity_unit := coalesce(nullif(trim(p_record ->> 'salinity_unit'), ''), 'PSU');
  v_ph := nullif(p_record ->> 'ph_value', '')::numeric;
  v_ec := nullif(p_record ->> 'electrical_conductivity_ms_cm', '')::numeric;
  v_dose := nullif(p_record ->> 'chemical_dose_value', '')::numeric;
  v_dose_unit := coalesce(nullif(trim(p_record ->> 'chemical_dose_unit'), ''), 'g/L');
  v_notes := nullif(trim(p_record ->> 'notes'), '');

  if v_record_type not in ('initial', 'retest') then
    raise exception 'Select New carton or Retest existing.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ag_stabilization_carton:' || v_aggregator_id::text, 0));
  if v_record_type = 'initial' and v_auto_serial then
    v_carton_serial := public.ag_next_stabilization_carton_serial(v_aggregator_id);
  end if;

  if v_carton_serial is null or v_carton_serial !~ '^[0-9]{1,30}$' then
    raise exception 'Carton serial must contain 1-30 digits.' using errcode = '22023';
  end if;
  -- Zero padding is display-only: 2, 02 and 0002 are the same printed label.
  v_serial_key := coalesce(nullif(ltrim(v_carton_serial, '0'), ''), '0');
  select record.carton_serial into v_display_serial
  from public.ag_stabilization_packing_records record
  where record.aggregator_id = v_aggregator_id
    and coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') = v_serial_key
  order by length(record.carton_serial) desc, record.created_at asc
  limit 1;
  if v_display_serial is not null then
    v_carton_serial := v_display_serial;
  end if;

  select count(distinct record.carton_instance_id)::integer
  into v_match_count
  from public.ag_stabilization_packing_records record
  where record.aggregator_id = v_aggregator_id
    and coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') = v_serial_key;

  if v_record_type = 'initial' then
    if v_match_count > 0 and not v_allow_duplicate then
      raise exception 'Carton % already exists. Confirm Save another carton to create a separate physical carton.',
        v_carton_serial using errcode = '22023';
    end if;
    -- A second initial is a physically separate carton, not a retest.
    v_instance_id := gen_random_uuid();
  else
    if v_match_count = 0 then
      raise exception 'Carton % has not been recorded. Choose New carton first.',
        v_carton_serial using errcode = '22023';
    end if;
    if v_instance_id is null and v_match_count > 1 then
      raise exception 'More than one carton uses serial %. Select the physical carton to retest.',
        v_carton_serial using errcode = '22023';
    end if;
    if v_instance_id is null then
      select record.carton_instance_id into v_instance_id
      from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') = v_serial_key
      order by record.created_at desc limit 1;
    end if;
    if not exists (
      select 1 from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and record.carton_instance_id = v_instance_id
        and coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') = v_serial_key
    ) then
      raise exception 'Selected carton does not match this serial.' using errcode = '22023';
    end if;
  end if;

  -- Keep the legacy serial-wide test sequence unique, including across aliases.
  select coalesce(max(record.test_sequence), 0) + 1
  into v_test_sequence
  from public.ag_stabilization_packing_records record
  where record.aggregator_id = v_aggregator_id
    and coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') = v_serial_key;

  if v_packed_on is null then raise exception 'Packing or test date is required.' using errcode = '22023'; end if;
  if v_packed_on > (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Packing or test date cannot be in the future.' using errcode = '22023';
  end if;
  if v_species is null or not exists (
    select 1 from public.ag_seaweed_type_settings where type_key = v_species and active
  ) then
    raise exception 'Select an active seaweed species.' using errcode = '22023';
  end if;
  if v_weight_value is null or v_weight_value <= 0 or v_weight_value > 100000 then
    raise exception 'Weight must be greater than zero and no more than 100000.' using errcode = '22023';
  end if;
  if v_weight_unit not in ('kg', 'g') then raise exception 'Select a valid weight unit.' using errcode = '22023'; end if;
  if v_temperature is not null and (v_temperature < -10 or v_temperature > 100) then raise exception 'Room temperature is outside the allowed range.' using errcode = '22023'; end if;
  if v_salinity is not null and (v_salinity < 0 or v_salinity > 100) then raise exception 'Salinity is outside the allowed range.' using errcode = '22023'; end if;
  if v_salinity_unit not in ('PSU', 'ppt') then raise exception 'Select a valid salinity unit.' using errcode = '22023'; end if;
  if v_ph is not null and (v_ph < 0 or v_ph > 14) then raise exception 'pH must be between 0 and 14.' using errcode = '22023'; end if;
  if v_ec is not null and (v_ec < 0 or v_ec > 500) then raise exception 'Electrical conductivity is outside the allowed range.' using errcode = '22023'; end if;
  if v_dose is not null and (v_dose < 0 or v_dose > 100000) then raise exception 'Chemical dose is outside the allowed range.' using errcode = '22023'; end if;
  if v_dose_unit not in ('g/L', 'mg/L', '%') then raise exception 'Select a valid chemical dose unit.' using errcode = '22023'; end if;
  if v_notes is not null and length(v_notes) > 1000 then raise exception 'Notes must be 1000 characters or fewer.' using errcode = '22023'; end if;

  insert into public.ag_stabilization_packing_records (
    submission_id, aggregator_id, record_type, test_sequence, carton_serial, carton_instance_id, packed_on, species,
    weight_value, weight_unit, room_temperature_c, salinity_value, salinity_unit,
    ph_value, electrical_conductivity_ms_cm, chemical_name, chemical_dose_value,
    chemical_dose_unit, notes, recorded_by_user_id, recorded_by_name
  ) values (
    p_submission_id, v_aggregator_id, v_record_type, v_test_sequence, v_carton_serial, v_instance_id, v_packed_on, v_species,
    v_weight_value, v_weight_unit, v_temperature, v_salinity, v_salinity_unit,
    v_ph, v_ec, 'Sodium benzoate', v_dose, v_dose_unit, v_notes,
    v_actor_id, coalesce(nullif(trim(v_profile.display_name), ''), v_profile.email)
  )
  returning * into v_saved;

  insert into public.ag_audit_log (actor_user_id, actor_email, action, target_type, target_id, details)
  values (
    v_actor_id,
    v_profile.email,
    case when v_record_type = 'retest'
      then 'stabilization_packing_retest_created'
      else 'stabilization_packing_record_created'
    end,
    'stabilization_packing_record',
    v_saved.id::text,
    jsonb_build_object(
      'aggregator_id', v_aggregator_id,
      'record_type', v_saved.record_type,
      'test_sequence', v_saved.test_sequence,
      'carton_serial', v_saved.carton_serial,
      'carton_instance_id', v_saved.carton_instance_id,
      'packed_on', v_saved.packed_on,
      'species', v_saved.species,
      'weight_value', v_saved.weight_value,
      'weight_unit', v_saved.weight_unit
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'record_id', v_saved.id,
    'record_type', v_saved.record_type,
    'test_sequence', v_saved.test_sequence,
    'carton_serial', v_saved.carton_serial,
    'carton_instance_id', v_saved.carton_instance_id,
    'packed_on', v_saved.packed_on,
    'next_carton_serial', public.ag_next_stabilization_carton_serial(v_aggregator_id)
  );
exception
  when unique_violation then
    raise exception 'That carton serial or test sequence has already been recorded.' using errcode = '23505';
end;
$$;

create or replace function public.ag_stabilization_packing_form_context()
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare v_aggregator_id uuid; v_recent_cartons jsonb;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability('form_stock_record');
  with grouped as (
    select coalesce(nullif(ltrim(record.carton_serial, '0'), ''), '0') as serial_key,
      max(record.packed_on) as last_tested_on,
      count(*)::integer as test_count,
      count(distinct record.carton_instance_id)::integer as physical_count,
      (array_agg(record.carton_serial order by length(record.carton_serial) desc,
          record.created_at asc))[1] as carton_serial
    from public.ag_stabilization_packing_records record
    where record.aggregator_id = v_aggregator_id
      and coalesce((
        select action.action_type
        from public.ag_stabilization_stock_actions action
        where action.aggregator_id = v_aggregator_id
          and action.carton_instance_id = record.carton_instance_id
        order by action.action_sequence desc limit 1
      ), 'active') <> 'removal'
    group by serial_key
    order by max(record.packed_on) desc limit 100
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'carton_serial', carton_serial,
    'last_tested_on', last_tested_on,
    'test_count', test_count,
    'physical_count', physical_count
  ) order by last_tested_on desc), '[]'::jsonb)
  into v_recent_cartons from grouped;
  return jsonb_build_object(
    'next_carton_serial', public.ag_next_stabilization_carton_serial(v_aggregator_id),
    'recent_cartons', v_recent_cartons
  );
end;
$$;

create or replace function public.ag_submit_stabilization_packing_record_v3(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_carton_serial text;
  v_latest_action_type text;
  v_instance_id uuid;
  v_brix numeric;
  v_hydrometer numeric;
  v_scale text;
  v_result jsonb;
  v_record_id uuid;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability('form_stock_record');
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Stock record must be an object.' using errcode='22023';
  end if;
  begin
    v_brix := nullif(p_record ->> 'brix_value', '')::numeric;
    v_hydrometer := nullif(p_record ->> 'hydrometer_value', '')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Brix and hydrometer readings must be numeric.' using errcode='22023';
  end;
  v_scale := nullif(trim(p_record ->> 'hydrometer_scale'), '');
  if v_brix is not null and (v_brix < 0 or v_brix > 100) then
    raise exception 'Brix must be between 0 and 100 °Bx.' using errcode='22023';
  end if;
  if v_hydrometer is not null and (v_hydrometer < -1000 or v_hydrometer > 1000) then
    raise exception 'Hydrometer reading is outside the allowed range.' using errcode='22023';
  end if;
  if v_scale is not null and v_scale not in ('SG','Baume','g/mL','unconfirmed') then
    raise exception 'Select the hydrometer scale shown on the instrument.' using errcode='22023';
  end if;
  if v_hydrometer is not null and v_scale is null then
    v_scale := 'unconfirmed';
  end if;
  if v_hydrometer is null then v_scale := null; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ag_stabilization_stock_actions:' || v_aggregator_id::text, 0
  ));
  if lower(coalesce(nullif(trim(p_record ->> 'record_type'), ''), 'initial')) = 'retest' then
    v_carton_serial := nullif(trim(p_record ->> 'carton_serial'), '');
    v_instance_id := nullif(p_record ->> 'carton_instance_id', '')::uuid;
    if v_instance_id is null then
      select (array_agg(record.carton_instance_id order by record.created_at, record.id))[1] into v_instance_id
      from public.ag_stabilization_packing_records record
      where record.aggregator_id = v_aggregator_id
        and coalesce(nullif(ltrim(record.carton_serial,'0'),''),'0')
          = coalesce(nullif(ltrim(v_carton_serial,'0'),''),'0')
      having count(distinct record.carton_instance_id) = 1;
    end if;
    select action.action_type into v_latest_action_type
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
      and action.carton_instance_id = v_instance_id
    order by action.action_sequence desc limit 1;
    if v_latest_action_type = 'removal' then
      raise exception 'Carton % is inactive. Restore it before recording a retest.',
        v_carton_serial using errcode='23514';
    end if;
  end if;

  v_result := public.ag_submit_stabilization_packing_record_v3_without_organisation_access(
    p_submission_id, p_record - array['brix_value','hydrometer_value','hydrometer_scale']::text[]
  );
  v_record_id := (v_result ->> 'record_id')::uuid;
  if not coalesce((v_result ->> 'duplicate')::boolean, false) then
    update public.ag_stabilization_packing_records record
    set brix_value = v_brix, hydrometer_value = v_hydrometer,
        hydrometer_scale = v_scale
    where record.id = v_record_id
      and record.aggregator_id = v_aggregator_id
      and record.recorded_by_user_id = (select auth.uid());
    if not found then
      raise exception 'Saved record could not be linked to your account.' using errcode='42501';
    end if;
    update public.ag_audit_log
    set details = coalesce(details, '{}'::jsonb)
      || jsonb_build_object('brix_value',v_brix,
       'hydrometer_value',v_hydrometer,'hydrometer_scale',v_scale)
    where target_type='stabilization_packing_record'
      and target_id=v_record_id::text
      and actor_user_id=(select auth.uid());
  end if;
  return v_result || (select jsonb_build_object(
    'brix_value',record.brix_value,
    'hydrometer_value',record.hydrometer_value,
    'hydrometer_scale',record.hydrometer_scale)
    from public.ag_stabilization_packing_records record where record.id=v_record_id);
end;
$$;

-- Where multiple physical cartons share one serial, stock removal remains
-- blocked as ambiguous until a separate carton-aware removal flow exists.
create or replace function public.ag_preview_stabilization_stock_removal_validated_core_v1(
  p_first_carton_serial text,
  p_last_carton_serial text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_first_text text := nullif(trim(p_first_carton_serial), '');
  v_last_text text := coalesce(nullif(trim(p_last_carton_serial), ''), v_first_text);
  v_first bigint;
  v_last bigint;
  v_width integer;
  v_count integer;
  v_result jsonb;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability(
    'form_stock_record'
  );

  if v_first_text is null or v_first_text !~ '^[0-9]{1,18}$'
     or v_last_text is null or v_last_text !~ '^[0-9]{1,18}$' then
    raise exception 'First and last carton numbers must contain 1-18 digits.'
      using errcode = '22023';
  end if;

  v_first := v_first_text::bigint;
  v_last := v_last_text::bigint;
  if v_last < v_first then
    raise exception 'Last carton number must be on or after the first.'
      using errcode = '22023';
  end if;

  if (v_last - v_first + 1) < 1 or (v_last - v_first + 1) > 100 then
    raise exception 'Select an inclusive range of 1 to 100 cartons.'
      using errcode = '22023';
  end if;
  v_count := (v_last - v_first + 1)::integer;
  v_width := greatest(length(v_first_text), length(v_last_text));

  with requested as (
    select
      serial_number,
      lpad(serial_number::text, v_width, '0') as requested_serial
    from generate_series(v_first, v_last) as requested_numbers(serial_number)
  ),
  serial_matches as (
    select
      requested.serial_number,
      requested.requested_serial,
      count(distinct record.carton_instance_id)::integer as serial_count,
      min(record.carton_serial) as carton_serial
    from requested
    left join public.ag_stabilization_packing_records record
      on record.aggregator_id = v_aggregator_id
      and record.carton_serial::numeric = requested.serial_number::numeric
    group by requested.serial_number, requested.requested_serial
  ),
  detailed as (
    select
      serial_matches.serial_number,
      serial_matches.requested_serial,
      serial_matches.serial_count,
      serial_matches.carton_serial,
      latest_record.id as source_record_id,
      latest_record.species,
      latest_record.weight_value,
      latest_record.weight_unit,
      latest_record.packed_on as latest_test_date,
      coalesce(test_history.test_count, 0) as test_count,
      latest_action.action_type as latest_action_type,
      latest_action.action_date as latest_action_date,
      latest_action.reason_code as latest_reason_code
    from serial_matches
    left join lateral (
      select record.*
      from public.ag_stabilization_packing_records record
      where serial_matches.serial_count = 1
        and record.aggregator_id = v_aggregator_id
        and record.carton_serial = serial_matches.carton_serial
      order by record.test_sequence desc, record.created_at desc
      limit 1
    ) latest_record on true
    left join lateral (
      select count(*)::integer as test_count
      from public.ag_stabilization_packing_records record
      where serial_matches.serial_count = 1
        and record.aggregator_id = v_aggregator_id
        and record.carton_serial = serial_matches.carton_serial
    ) test_history on true
    left join lateral (
      select action.action_type, action.action_date, action.reason_code
      from public.ag_stabilization_stock_actions action
      where serial_matches.serial_count = 1
        and action.aggregator_id = v_aggregator_id
        and action.carton_serial = serial_matches.carton_serial
      order by action.action_sequence desc
      limit 1
    ) latest_action on true
  ),
  measured as (
    select
      detailed.*,
      case
        when detailed.weight_unit = 'L' then detailed.weight_value
        when detailed.weight_unit = 'mL' then detailed.weight_value / 1000.0
        else null
      end as volume_l
    from detailed
  ),
  classified as (
    select
      measured.*,
      case
        when measured.serial_count = 0 then 'missing'
        when measured.serial_count > 1 then 'ambiguous'
        when measured.volume_l is null then 'unsupported_volume'
        when measured.latest_action_type = 'removal' then 'inactive'
        else 'ready'
      end as status
    from measured
  )
  select jsonb_build_object(
    'first_carton_serial', v_first_text,
    'last_carton_serial', v_last_text,
    'requested_count', v_count,
    'valid', coalesce(bool_and(classified.status = 'ready'), false),
    'total_litres', round(coalesce(
      sum(classified.volume_l) filter (where classified.status = 'ready'),
      0
    ), 3),
    'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'requested_serial', classified.requested_serial,
        'carton_serial', classified.carton_serial,
        'status', classified.status,
        'source_record_id', classified.source_record_id,
        'species', classified.species,
        'volume_l', round(classified.volume_l, 3),
        'test_count', classified.test_count,
        'latest_test_date', classified.latest_test_date,
        'latest_action_type', classified.latest_action_type,
        'latest_action_date', classified.latest_action_date,
        'latest_action_reason',
          public.ag_stabilization_removal_reason_label(
            classified.latest_reason_code
          )
      ) order by classified.serial_number
    ), '[]'::jsonb)
  )
  into v_result
  from classified;

  return v_result;
end;
$$;



-- Include new measurements in stock lookup and stock record ledger responses.
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
  v_limit integer := least(greatest(coalesce(p_result_limit, 2000), 1), 2000);
  v_request_count integer;
  v_result jsonb;
begin
  perform public.ag_require_permission('can_view_data');
  v_aggregator_id := public.ag_require_organisation_capability(
    'form_stock_record'
  );

  if v_start is not null and v_end < v_start then
    raise exception 'End date must be on or after start date.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_containers, '')), '') is null then
    raise exception 'Enter at least one carton number.' using errcode = '22023';
  end if;
  if length(p_containers) > 5000 then
    raise exception 'Carton lookup input is too long.' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_request_count
  from regexp_split_to_table(p_containers, '[[:space:],]+') as token
  where trim(token) <> '';

  if v_request_count < 1 or v_request_count > 100 then
    raise exception 'Look up between 1 and 100 cartons at a time.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from regexp_split_to_table(p_containers, '[[:space:],]+') as token
    where trim(token) <> ''
      and trim(token) !~ '^[0-9]{1,30}$'
  ) then
    raise exception 'Carton numbers must contain 1-30 digits.'
      using errcode = '22023';
  end if;

  with requested as (
    select distinct
      case
        when trim(token) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(trim(token), '0'), ''), '0')
        else upper(trim(token))
      end as container_key
    from regexp_split_to_table(p_containers, '[[:space:],]+') as token
    where trim(token) <> ''
  ),
  filtered as (
    select
      record.id,
      record.carton_serial,
      record.carton_instance_id,
      record.brix_value,
      record.hydrometer_value,
      record.hydrometer_scale,
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
      record.created_at,
      latest_action.action_group_id as stock_action_group_id,
      latest_action.action_type as stock_action_type,
      latest_action.action_date as stock_action_date,
      latest_action.reason_code as stock_action_reason_code,
      case
        when latest_action.action_type = 'removal'
          then public.ag_stabilization_removal_reason_label(latest_action.reason_code)
        when latest_action.action_type = 'restoration'
          then latest_action.note
        else null
      end as stock_action_reason,
      case
        when latest_action.action_type = 'removal' then latest_action.note
        else null
      end as stock_action_note,
      latest_action.actor_name as stock_action_recorded_by,
      case
        when latest_action.action_type = 'removal' then false
        else true
      end as stock_active,
      case
        when latest_action.action_type = 'removal' then 'removed'
        else 'active'
      end as stock_status
    from public.ag_stabilization_packing_records record
    left join lateral (
      select action.*
      from public.ag_stabilization_stock_actions action
      where action.aggregator_id = v_aggregator_id
        and action.carton_instance_id = record.carton_instance_id
      order by action.action_sequence desc
      limit 1
    ) latest_action on true
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
      count(distinct carton_instance_id)::integer as container_count
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


create or replace function public.ag_form_record_ledger_without_organisation_access(
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
        'citric_acid_dose_unit', record.citric_acid_dose_unit,
        'carton_instance_id', record.carton_instance_id,
        'brix_value', record.brix_value,
        'hydrometer_value', record.hydrometer_value,
        'hydrometer_scale', record.hydrometer_scale
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

revoke all on function public.ag_stabilization_carton_matches(text)
  from public, anon, authenticated;
grant execute on function public.ag_stabilization_carton_matches(text)
  to authenticated;
revoke all on function public.ag_submit_stabilization_packing_record_v3(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.ag_submit_stabilization_packing_record_v3(uuid,jsonb)
  to authenticated;
notify pgrst,'reload schema';
commit;
