begin;

alter table public.seaweed_drying_submissions
  drop constraint if exists seaweed_drying_submissions_drying_configuration_check;

alter table public.seaweed_drying_submissions
  add constraint seaweed_drying_submissions_drying_configuration_check
  check (drying_configuration = any (array[
    'cover_open_back_open'::text,
    'cover_down_back_closed'::text,
    'cover_down_back_open'::text,
    'no_configuration'::text
  ]));

create or replace function public.submit_seaweed_drying_observation(
  p_payload jsonb,
  p_upload_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_submission_id            uuid;
  v_receipt_number           text;
  v_station_uid              text;
  v_location_code            text;
  v_table_location           text;
  v_enumerator_name          text;
  v_recorded_at              timestamptz;
  v_latitude                 numeric;
  v_longitude                numeric;
  v_accuracy                 numeric;
  v_bays                     jsonb;
  v_bay                      jsonb;
  v_bay_number               integer;
  v_loading_at               timestamptz;
  v_unloading_at             timestamptz;
  v_loading_weight_kg        numeric;
  v_unloading_weight_kg      numeric;
  v_existing_token_hash      bytea;
  v_finalize                 boolean := false;
  v_confirmed                boolean := false;
  v_is_existing              boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid drying form payload';
  end if;
  if nullif(btrim(coalesce(p_payload->>'website', '')), '') is not null then
    raise exception 'Invalid drying form submission';
  end if;
  if p_upload_token is null or length(p_upload_token) < 32 or length(p_upload_token) > 256 then
    raise exception 'Invalid drying record token';
  end if;

  v_submission_id := coalesce(nullif(p_payload->>'submission_id', '')::uuid, gen_random_uuid());
  select s.receipt_number, s.upload_token_hash
    into v_receipt_number, v_existing_token_hash
  from public.seaweed_drying_submissions s
  where s.id = v_submission_id;
  v_is_existing := found;
  if v_is_existing and v_existing_token_hash <> digest(p_upload_token, 'sha256') then
    raise exception 'Drying record token does not match';
  end if;

  v_location_code := btrim(coalesce(p_payload->>'dryer_location_code', ''));
  select location.station_uid, location.table_location
    into v_station_uid, v_table_location
  from (
    values
      ('bati-table-1', 'ST-0102', 'Bati (Table 1)'),
      ('bati-table-2', 'ST-0102', 'Bati (Table 2)'),
      ('bati-table-3', 'ST-0102', 'Bati (Table 3)'),
      ('bati-table-4', 'ST-0102', 'Bati (Table 4)'),
      ('bati-dryer-shed', 'ST-0102', 'Dryer Shed'),
      ('shangani-table-1', 'ST-0003', 'Shangani (Table 1)')
  ) as location(location_code, station_uid, table_location)
  where location.location_code = v_location_code;
  if not found then
    raise exception 'Dryer location is invalid';
  end if;
  if not exists (
    select 1 from public.station_registry sr
    where sr.station_uid = v_station_uid and sr.active = true
  ) then
    raise exception 'Selected station is not active';
  end if;

  v_enumerator_name := btrim(coalesce(p_payload->>'enumerator_name', ''));
  if length(v_enumerator_name) < 2 or length(v_enumerator_name) > 120 then
    raise exception 'Enumerator name is required';
  end if;
  if length(coalesce(p_payload->>'enumerator_id', '')) > 80 then
    raise exception 'Enumerator ID is too long';
  end if;

  v_recorded_at := nullif(p_payload->>'recorded_at', '')::timestamptz;
  if v_recorded_at is null
     or v_recorded_at < timestamptz '2020-01-01 00:00:00+00'
     or v_recorded_at > now() + interval '1 day' then
    raise exception 'Record date/time is invalid';
  end if;

  v_latitude := nullif(p_payload->>'gps_latitude', '')::numeric;
  v_longitude := nullif(p_payload->>'gps_longitude', '')::numeric;
  v_accuracy := nullif(p_payload->>'gps_accuracy_m', '')::numeric;
  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'GPS latitude and longitude must be supplied together';
  end if;
  if v_latitude is not null and (v_latitude < -90 or v_latitude > 90) then
    raise exception 'GPS latitude is out of range';
  end if;
  if v_longitude is not null and (v_longitude < -180 or v_longitude > 180) then
    raise exception 'GPS longitude is out of range';
  end if;
  if v_accuracy is not null and (v_accuracy < 0 or v_accuracy > 100000) then
    raise exception 'GPS accuracy is out of range';
  end if;

  if v_location_code = 'bati-dryer-shed' then
    if coalesce(p_payload->>'drying_configuration', '') <> 'no_configuration' then
      raise exception 'Dryer Shed must use no configuration';
    end if;
  elsif coalesce(p_payload->>'drying_configuration', '') not in (
    'cover_open_back_open',
    'cover_down_back_closed',
    'cover_down_back_open'
  ) then
    raise exception 'Drying configuration is invalid';
  end if;

  v_finalize := lower(coalesce(p_payload->>'finalize', 'false')) = 'true';
  v_confirmed := lower(coalesce(p_payload->>'confirmed_accurate', 'false')) = 'true';
  if v_finalize and not v_confirmed then
    raise exception 'Enumerator confirmation is required';
  end if;
  if length(coalesce(p_payload->>'general_observations', '')) > 3000
     or length(coalesce(p_payload->>'working_well', '')) > 3000
     or length(coalesce(p_payload->>'not_working', '')) > 3000 then
    raise exception 'Observation text is too long';
  end if;

  v_bays := p_payload->'bays';
  if v_bays is null or jsonb_typeof(v_bays) <> 'array'
     or jsonb_array_length(v_bays) < 1 or jsonb_array_length(v_bays) > 8 then
    raise exception 'Enter between 1 and 8 bay records';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_bays) item
    group by item->>'bay_number' having count(*) > 1
  ) then
    raise exception 'Duplicate bay number';
  end if;

  if not v_is_existing then
    v_receipt_number :=
      'DRY-' || to_char(v_recorded_at at time zone 'Africa/Nairobi', 'YYYYMMDD') || '-'
      || upper(substring(replace(v_submission_id::text, '-', '') from 1 for 8));
  end if;

  insert into public.seaweed_drying_submissions (
    id, receipt_number, station_uid, dryer_location_code, table_location,
    enumerator_name, enumerator_id, recorded_at, gps_latitude, gps_longitude,
    gps_accuracy_m, drying_configuration, record_status, bay_count,
    general_observations, working_well, not_working, confirmed_accurate,
    source, client_version, upload_token_hash
  ) values (
    v_submission_id, v_receipt_number, v_station_uid, v_location_code, v_table_location,
    v_enumerator_name, nullif(btrim(coalesce(p_payload->>'enumerator_id', '')), ''),
    v_recorded_at, v_latitude, v_longitude, v_accuracy,
    p_payload->>'drying_configuration',
    case when v_finalize then 'complete' else 'in_progress' end,
    jsonb_array_length(v_bays),
    nullif(btrim(coalesce(p_payload->>'general_observations', '')), ''),
    nullif(btrim(coalesce(p_payload->>'working_well', '')), ''),
    nullif(btrim(coalesce(p_payload->>'not_working', '')), ''),
    v_confirmed,
    left(coalesce(nullif(p_payload->>'source', ''), 'public_web_form'), 80),
    left(coalesce(p_payload->>'client_version', ''), 80),
    digest(p_upload_token, 'sha256')
  )
  on conflict (id) do update set
    station_uid = excluded.station_uid,
    dryer_location_code = excluded.dryer_location_code,
    table_location = excluded.table_location,
    enumerator_name = excluded.enumerator_name,
    enumerator_id = excluded.enumerator_id,
    recorded_at = excluded.recorded_at,
    gps_latitude = excluded.gps_latitude,
    gps_longitude = excluded.gps_longitude,
    gps_accuracy_m = excluded.gps_accuracy_m,
    drying_configuration = excluded.drying_configuration,
    record_status = excluded.record_status,
    bay_count = excluded.bay_count,
    general_observations = excluded.general_observations,
    working_well = excluded.working_well,
    not_working = excluded.not_working,
    confirmed_accurate = excluded.confirmed_accurate,
    source = excluded.source,
    client_version = excluded.client_version;

  for v_bay in select value from jsonb_array_elements(v_bays)
  loop
    if jsonb_typeof(v_bay) <> 'object' then
      raise exception 'Invalid bay record';
    end if;
    v_bay_number := nullif(v_bay->>'bay_number', '')::integer;
    if v_bay_number is null or v_bay_number < 1 or v_bay_number > 8 then
      raise exception 'Bay number is out of range';
    end if;

    v_loading_at := nullif(v_bay->>'loading_at', '')::timestamptz;
    v_unloading_at := nullif(v_bay->>'unloading_at', '')::timestamptz;
    v_loading_weight_kg := nullif(v_bay->>'loading_weight_kg', '')::numeric;
    v_unloading_weight_kg := nullif(v_bay->>'unloading_weight_kg', '')::numeric;

    if (v_loading_at is null) <> (v_loading_weight_kg is null)
       or (v_unloading_at is null) <> (v_unloading_weight_kg is null) then
      raise exception 'Bay % phase time and weight must be entered together', v_bay_number;
    end if;
    if v_loading_at is null and v_unloading_at is null then
      raise exception 'Bay % has no loading or unloading data', v_bay_number;
    end if;
    if v_loading_weight_kg is not null
       and (v_loading_weight_kg < 0 or v_loading_weight_kg > 1000) then
      raise exception 'Bay % wet weight is invalid', v_bay_number;
    end if;
    if v_unloading_weight_kg is not null
       and (v_unloading_weight_kg < 0 or v_unloading_weight_kg > 1000) then
      raise exception 'Bay % dry weight is invalid', v_bay_number;
    end if;
    if v_loading_at is not null
       and (v_loading_at < timestamptz '2020-01-01 00:00:00+00'
            or v_loading_at > now() + interval '30 days') then
      raise exception 'Bay % loading timestamp is outside the accepted range', v_bay_number;
    end if;
    if v_unloading_at is not null
       and (v_unloading_at < timestamptz '2020-01-01 00:00:00+00'
            or v_unloading_at > now() + interval '30 days') then
      raise exception 'Bay % unloading timestamp is outside the accepted range', v_bay_number;
    end if;
    if v_loading_at is not null and v_unloading_at is not null
       and v_unloading_at < v_loading_at then
      raise exception 'Bay % unloading cannot be earlier than loading', v_bay_number;
    end if;
    if v_finalize and (
      v_loading_at is null or v_loading_weight_kg is null
      or v_unloading_at is null or v_unloading_weight_kg is null
    ) then
      raise exception 'Bay % is incomplete', v_bay_number;
    end if;
    if nullif(v_bay->>'loading_weather', '') is not null
       and (v_loading_at is null or v_bay->>'loading_weather' not in ('sunny', 'cloudy', 'rainy', 'mixed')) then
      raise exception 'Bay % loading weather is invalid', v_bay_number;
    end if;
    if nullif(v_bay->>'unloading_weather', '') is not null
       and (v_unloading_at is null or v_bay->>'unloading_weather' not in ('sunny', 'cloudy', 'rainy', 'mixed')) then
      raise exception 'Bay % unloading weather is invalid', v_bay_number;
    end if;
    if length(coalesce(v_bay->>'notes', '')) > 1000 then
      raise exception 'Bay % notes are too long', v_bay_number;
    end if;

    insert into public.seaweed_drying_bay_records (
      submission_id, bay_number, loading_at, loading_weight_g, loading_weather,
      unloading_at, unloading_weight_g, unloading_weather, notes
    ) values (
      v_submission_id, v_bay_number, v_loading_at,
      case when v_loading_weight_kg is null then null else v_loading_weight_kg * 1000 end,
      nullif(v_bay->>'loading_weather', ''),
      v_unloading_at,
      case when v_unloading_weight_kg is null then null else v_unloading_weight_kg * 1000 end,
      nullif(v_bay->>'unloading_weather', ''),
      nullif(btrim(coalesce(v_bay->>'notes', '')), '')
    )
    on conflict (submission_id, bay_number) do update set
      loading_at = excluded.loading_at,
      loading_weight_g = excluded.loading_weight_g,
      loading_weather = excluded.loading_weather,
      unloading_at = excluded.unloading_at,
      unloading_weight_g = excluded.unloading_weight_g,
      unloading_weather = excluded.unloading_weather,
      notes = excluded.notes;
  end loop;

  return jsonb_build_object(
    'id', v_submission_id,
    'receipt_number', v_receipt_number,
    'bay_count', jsonb_array_length(v_bays),
    'record_status', case when v_finalize then 'complete' else 'in_progress' end,
    'already_saved', v_is_existing
  );
end;
$function$;

commit;
