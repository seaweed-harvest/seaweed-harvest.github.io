begin;

-- Reef Nursery current-state saving and shared location alignment.
-- Existing legacy Training location and gender values remain readable and writable
-- so historical records are not rewritten by this migration.

alter table public.ag_reef_nursery_sessions
  drop constraint if exists ag_reef_nursery_location_check;
alter table public.ag_reef_nursery_sessions
  add constraint ag_reef_nursery_location_check check (
    location is null
    or location in (
      'tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore',
      'mkwiro', 'offshore_nursery', 'shoreline_preparation'
    )
  );

alter table public.ag_reef_seaweed_records
  add column if not exists record_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz default clock_timestamp();

update public.ag_reef_seaweed_records
set submitted_at = coalesce(submitted_at, created_at)
where record_status = 'submitted'
  and submitted_at is null;

alter table public.ag_reef_seaweed_records
  alter column record_date drop not null,
  alter column location drop not null,
  alter column recorded_by_name drop not null,
  drop constraint if exists ag_reef_seaweed_records_location_check,
  drop constraint if exists ag_reef_seaweed_records_recorder_check,
  drop constraint if exists ag_reef_seaweed_records_status_check,
  drop constraint if exists ag_reef_seaweed_records_complete_check,
  drop constraint if exists ag_reef_seaweed_records_submitted_at_check;

alter table public.ag_reef_seaweed_records
  add constraint ag_reef_seaweed_records_status_check check (
    record_status in ('draft', 'submitted')
  ),
  add constraint ag_reef_seaweed_records_location_check check (
    location is null
    or location in ('tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore')
  ),
  add constraint ag_reef_seaweed_records_recorder_check check (
    recorded_by_name is null
    or length(trim(recorded_by_name)) between 1 and 160
  ),
  add constraint ag_reef_seaweed_records_complete_check check (
    record_status = 'draft'
    or (
      record_date is not null
      and location is not null
      and recorded_by_name is not null
    )
  ),
  add constraint ag_reef_seaweed_records_submitted_at_check check (
    (record_status = 'draft' and submitted_at is null)
    or (record_status = 'submitted' and submitted_at is not null)
  );

alter table public.ag_reef_seaweed_record_units
  alter column species drop not null,
  alter column line_count drop not null,
  alter column seed_weight_unit drop not null,
  alter column harvest_weight_unit drop not null,
  drop constraint if exists ag_reef_seaweed_record_units_species_check,
  drop constraint if exists ag_reef_seaweed_record_units_line_count_check,
  drop constraint if exists ag_reef_seaweed_record_units_seed_weight_check,
  drop constraint if exists ag_reef_seaweed_record_units_harvest_weight_check,
  drop constraint if exists ag_reef_seaweed_record_units_weight_presence_check,
  drop constraint if exists ag_reef_seaweed_record_units_seed_unit_check,
  drop constraint if exists ag_reef_seaweed_record_units_harvest_unit_check;

alter table public.ag_reef_seaweed_record_units
  add constraint ag_reef_seaweed_record_units_species_check check (
    species is null or species in ('spinosum', 'cottonii')
  ),
  add constraint ag_reef_seaweed_record_units_line_count_check check (
    line_count is null or line_count between 0 and 10000
  ),
  add constraint ag_reef_seaweed_record_units_seed_weight_check check (
    seed_weight_value is null or seed_weight_value between 0 and 100000
  ),
  add constraint ag_reef_seaweed_record_units_harvest_weight_check check (
    harvest_weight_value is null or harvest_weight_value between 0 and 100000
  ),
  add constraint ag_reef_seaweed_record_units_seed_unit_check check (
    seed_weight_unit is null or seed_weight_unit in ('kg', 'g')
  ),
  add constraint ag_reef_seaweed_record_units_harvest_unit_check check (
    harvest_weight_unit is null or harvest_weight_unit in ('kg', 'g')
  );

alter table public.ag_reef_inspection_records
  add column if not exists record_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz default clock_timestamp();

update public.ag_reef_inspection_records
set submitted_at = coalesce(submitted_at, created_at)
where record_status = 'submitted'
  and submitted_at is null;

alter table public.ag_reef_inspection_records
  alter column inspection_date drop not null,
  alter column location drop not null,
  alter column recorded_by_name drop not null,
  drop constraint if exists ag_reef_inspection_records_location_check,
  drop constraint if exists ag_reef_inspection_records_recorder_check,
  drop constraint if exists ag_reef_inspection_records_status_check,
  drop constraint if exists ag_reef_inspection_records_complete_check,
  drop constraint if exists ag_reef_inspection_records_submitted_at_check;

alter table public.ag_reef_inspection_records
  add constraint ag_reef_inspection_records_status_check check (
    record_status in ('draft', 'submitted')
  ),
  add constraint ag_reef_inspection_records_location_check check (
    location is null
    or location in ('tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore')
  ),
  add constraint ag_reef_inspection_records_recorder_check check (
    recorded_by_name is null
    or length(trim(recorded_by_name)) between 1 and 160
  ),
  add constraint ag_reef_inspection_records_complete_check check (
    record_status = 'draft'
    or (
      inspection_date is not null
      and location is not null
      and recorded_by_name is not null
    )
  ),
  add constraint ag_reef_inspection_records_submitted_at_check check (
    (record_status = 'draft' and submitted_at is null)
    or (record_status = 'submitted' and submitted_at is not null)
  );

alter table public.ag_reef_inspection_record_rafts
  drop constraint if exists ag_reef_inspection_record_rafts_observation_check;

create or replace function public.ag_reef_training_workspace_validate(
  p_session jsonb,
  p_participants jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_unknown_keys text[];
  v_training_date date;
  v_location text;
  v_start_time time;
  v_finish_time time;
  v_trainer_name text;
  v_supporting_staff text;
  v_session_types text[];
  v_other_session_type text;
  v_conditions text;
  v_nursery_reference text;
  v_participant jsonb;
  v_participant_name text;
  v_participant_reference text;
  v_gender text;
  v_normalized_participants jsonb := '[]'::jsonb;
  v_allowed_types text[] := array[
    'general_in_water_training', 'seeding', 'harvesting',
    'line_inspection_maintenance', 'mooring_inspection_maintenance',
    'nursery_deployment_recovery', 'other'
  ];
  v_allowed_locations text[] := array[
    'tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore',
    'mkwiro', 'offshore_nursery', 'shoreline_preparation'
  ];
begin
  if p_session is null or jsonb_typeof(p_session) <> 'object' then
    raise exception 'Session details must be an object.' using errcode = '22023';
  end if;
  if p_participants is null
     or jsonb_typeof(p_participants) <> 'array'
     or jsonb_array_length(p_participants) > 200 then
    raise exception 'Participants must be an array of no more than 200 rows.'
      using errcode = '22023';
  end if;

  select array_agg(key order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_session) key
  where key <> all(array[
    'training_date', 'location', 'start_time', 'finish_time', 'trainer_name',
    'supporting_staff', 'session_types', 'other_session_type',
    'weather_sea_conditions', 'nursery_reference'
  ]::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported Training record fields: %', array_to_string(v_unknown_keys, ', ')
      using errcode = '22023';
  end if;

  begin
    v_training_date := nullif(p_session ->> 'training_date', '')::date;
    v_start_time := nullif(p_session ->> 'start_time', '')::time;
    v_finish_time := nullif(p_session ->> 'finish_time', '')::time;
  exception when others then
    raise exception 'Enter a valid Training date and time.' using errcode = '22023';
  end;
  v_location := lower(nullif(trim(p_session ->> 'location'), ''));
  v_trainer_name := nullif(trim(p_session ->> 'trainer_name'), '');
  v_supporting_staff := nullif(trim(p_session ->> 'supporting_staff'), '');
  v_other_session_type := nullif(trim(p_session ->> 'other_session_type'), '');
  v_conditions := nullif(trim(p_session ->> 'weather_sea_conditions'), '');
  v_nursery_reference := nullif(trim(p_session ->> 'nursery_reference'), '');

  if v_training_date is null then
    raise exception 'Training date is required before submission.' using errcode = '22023';
  end if;
  if v_start_time is null then
    raise exception 'Start time is required before submission.' using errcode = '22023';
  end if;
  if v_finish_time is null or v_finish_time <= v_start_time then
    raise exception 'Finish time must be after start time.' using errcode = '22023';
  end if;
  if v_location is not null and not (v_location = any(v_allowed_locations)) then
    raise exception 'Select a valid Reef Nursery location.' using errcode = '22023';
  end if;
  if v_trainer_name is not null and length(v_trainer_name) > 160 then
    raise exception 'Trainer name must be 160 characters or fewer.' using errcode = '22023';
  end if;
  if v_supporting_staff is not null and length(v_supporting_staff) > 500 then
    raise exception 'Supporting staff must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if v_conditions is not null and length(v_conditions) > 1000 then
    raise exception 'Weather and sea conditions must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  if v_nursery_reference is not null and length(v_nursery_reference) > 200 then
    raise exception 'Nursery reference must be 200 characters or fewer.' using errcode = '22023';
  end if;

  if not (p_session ? 'session_types')
     or jsonb_typeof(p_session -> 'session_types') <> 'array' then
    raise exception 'Select at least one type of session before submission.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(trim(value)) order by lower(trim(value))), '{}'::text[])
  into v_session_types
  from jsonb_array_elements_text(p_session -> 'session_types')
  where nullif(trim(value), '') is not null;
  if cardinality(v_session_types) < 1
     or cardinality(v_session_types) > 7
     or not (v_session_types <@ v_allowed_types) then
    raise exception 'Select valid Reef Nursery session types.' using errcode = '22023';
  end if;
  if 'other' = any(v_session_types) then
    if v_other_session_type is null then
      raise exception 'Enter the other session type before submission.' using errcode = '22023';
    end if;
    if length(v_other_session_type) > 200 then
      raise exception 'Other session type must be 200 characters or fewer.' using errcode = '22023';
    end if;
  else
    v_other_session_type := null;
  end if;

  for v_participant in select value from jsonb_array_elements(p_participants)
  loop
    if jsonb_typeof(v_participant) <> 'object' then
      raise exception 'Each participant must be an object.' using errcode = '22023';
    end if;
    select array_agg(key order by key)
    into v_unknown_keys
    from jsonb_object_keys(v_participant) key
    where key <> all(array[
      'participant_name', 'farmer_reference_phone', 'gender'
    ]::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported participant fields: %', array_to_string(v_unknown_keys, ', ')
        using errcode = '22023';
    end if;

    v_participant_name := nullif(trim(v_participant ->> 'participant_name'), '');
    v_participant_reference := nullif(trim(v_participant ->> 'farmer_reference_phone'), '');
    v_gender := lower(nullif(trim(v_participant ->> 'gender'), ''));
    if v_participant_name is null or length(v_participant_name) > 160 then
      raise exception 'Every entered participant needs a name of 160 characters or fewer.'
        using errcode = '22023';
    end if;
    if v_participant_reference is not null and length(v_participant_reference) > 100 then
      raise exception 'Farmer ID or phone must be 100 characters or fewer.' using errcode = '22023';
    end if;
    if v_gender is not null
       and v_gender not in ('female', 'male', 'other', 'prefer_not_to_say') then
      raise exception 'Select a valid participant gender.' using errcode = '22023';
    end if;

    v_normalized_participants := v_normalized_participants || jsonb_build_array(
      jsonb_build_object(
        'participant_name', v_participant_name,
        'farmer_reference_phone', v_participant_reference,
        'gender', v_gender
      )
    );
  end loop;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'training_date', v_training_date,
      'location', v_location,
      'start_time', v_start_time,
      'finish_time', v_finish_time,
      'trainer_name', v_trainer_name,
      'supporting_staff', v_supporting_staff,
      'session_types', to_jsonb(v_session_types),
      'other_session_type', v_other_session_type,
      'weather_sea_conditions', v_conditions,
      'nursery_reference', v_nursery_reference
    ),
    'participants', v_normalized_participants
  );
end;
$$;

commit;
