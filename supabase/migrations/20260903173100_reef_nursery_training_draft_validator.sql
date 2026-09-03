begin;

create or replace function public.ag_reef_training_workspace_validate_draft(
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
  v_session_types text[] := '{}'::text[];
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

  if v_location is not null and not (v_location = any(v_allowed_locations)) then
    raise exception 'Select a valid Reef Nursery location.' using errcode = '22023';
  end if;
  if v_trainer_name is not null and length(v_trainer_name) > 160 then
    raise exception 'Trainer name must be 160 characters or fewer.' using errcode = '22023';
  end if;
  if v_supporting_staff is not null and length(v_supporting_staff) > 500 then
    raise exception 'Supporting staff must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if v_other_session_type is not null and length(v_other_session_type) > 200 then
    raise exception 'Other session type must be 200 characters or fewer.' using errcode = '22023';
  end if;
  if v_conditions is not null and length(v_conditions) > 1000 then
    raise exception 'Weather and sea conditions must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  if v_nursery_reference is not null and length(v_nursery_reference) > 200 then
    raise exception 'Nursery reference must be 200 characters or fewer.' using errcode = '22023';
  end if;

  if p_session ? 'session_types' then
    if jsonb_typeof(p_session -> 'session_types') <> 'array' then
      raise exception 'Session types must be an array.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct lower(trim(value)) order by lower(trim(value))), '{}'::text[])
    into v_session_types
    from jsonb_array_elements_text(p_session -> 'session_types')
    where nullif(trim(value), '') is not null;
  end if;
  if cardinality(v_session_types) > 7 or not (v_session_types <@ v_allowed_types) then
    raise exception 'Select valid Reef Nursery session types.' using errcode = '22023';
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
    if v_participant_name is not null and length(v_participant_name) > 160 then
      raise exception 'Participant name must be 160 characters or fewer.' using errcode = '22023';
    end if;
    if v_participant_reference is not null and length(v_participant_reference) > 100 then
      raise exception 'Farmer ID or phone must be 100 characters or fewer.' using errcode = '22023';
    end if;
    if v_gender is not null
       and v_gender not in ('female', 'male', 'other', 'prefer_not_to_say') then
      raise exception 'Select a valid participant gender.' using errcode = '22023';
    end if;

    if v_participant_name is not null
       or v_participant_reference is not null
       or v_gender is not null then
      v_normalized_participants := v_normalized_participants || jsonb_build_array(
        jsonb_build_object(
          'participant_name', v_participant_name,
          'farmer_reference_phone', v_participant_reference,
          'gender', v_gender
        )
      );
    end if;
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
