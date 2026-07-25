begin;

alter table public.ag_reef_nursery_sessions
  add column if not exists record_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz default now();

update public.ag_reef_nursery_sessions
set record_status = 'submitted',
    submitted_at = coalesce(submitted_at, created_at)
where record_status is distinct from 'submitted'
   or submitted_at is null;

alter table public.ag_reef_nursery_sessions
  alter column training_date drop not null,
  alter column start_time drop not null,
  alter column finish_time drop not null;

alter table public.ag_reef_nursery_participants
  alter column participant_name drop not null;

alter table public.ag_reef_nursery_sessions
  drop constraint if exists ag_reef_nursery_time_check,
  drop constraint if exists ag_reef_nursery_session_types_count_check,
  drop constraint if exists ag_reef_nursery_other_session_type_check,
  drop constraint if exists ag_reef_nursery_record_status_check,
  drop constraint if exists ag_reef_nursery_submission_complete_check,
  drop constraint if exists ag_reef_nursery_submitted_at_check;

alter table public.ag_reef_nursery_sessions
  add constraint ag_reef_nursery_record_status_check
    check (record_status in ('draft', 'submitted')),
  add constraint ag_reef_nursery_time_check check (
    record_status = 'draft'
    or (
      start_time is not null
      and finish_time is not null
      and finish_time > start_time
    )
  ),
  add constraint ag_reef_nursery_session_types_count_check check (
    cardinality(session_types) between 0 and 7
    and (record_status = 'draft' or cardinality(session_types) >= 1)
  ),
  add constraint ag_reef_nursery_other_session_type_check check (
    record_status = 'draft'
    or case
      when 'other' = any(session_types) then
        other_session_type is not null
        and length(trim(other_session_type)) between 1 and 200
      else other_session_type is null
    end
  ),
  add constraint ag_reef_nursery_submission_complete_check check (
    record_status = 'draft'
    or (
      training_date is not null
      and start_time is not null
      and finish_time is not null
      and cardinality(session_types) >= 1
    )
  ),
  add constraint ag_reef_nursery_submitted_at_check check (
    (record_status = 'draft' and submitted_at is null)
    or (record_status = 'submitted' and submitted_at is not null)
  );

alter table public.ag_reef_nursery_participants
  drop constraint if exists ag_reef_nursery_participant_name_check;
alter table public.ag_reef_nursery_participants
  add constraint ag_reef_nursery_participant_name_check check (
    participant_name is null
    or length(trim(participant_name)) between 1 and 160
  );

comment on column public.ag_reef_nursery_sessions.record_status is
  'Draft records may be incomplete; submitted records satisfy the completed-session checks.';
comment on column public.ag_reef_nursery_sessions.submitted_at is
  'Time the trainer submitted the completed session. Null while the record is a draft.';

create or replace function public.ag_save_reef_nursery_draft(
  p_session_id uuid,
  p_submission_id uuid,
  p_session jsonb,
  p_participants jsonb,
  p_seaweed_record jsonb,
  p_photos jsonb,
  p_training_delivered jsonb,
  p_practical_competencies jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_aggregator_id uuid;
  v_profile public.ag_user_profiles%rowtype;
  v_saved public.ag_reef_nursery_sessions%rowtype;
  v_existing public.ag_reef_nursery_sessions%rowtype;
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
  v_health text;
  v_seed_weight numeric;
  v_seed_unit text;
  v_harvest_weight numeric;
  v_harvest_unit text;
  v_equipment text;
  v_normalized_seaweed jsonb;
  v_participant_count integer := 0;
  v_training_activity_count integer := 0;
  v_competency_count integer := 0;
  v_existing_photo_count integer := 0;
  v_photo_count integer := 0;
  v_photo jsonb;
  v_photo_order bigint;
  v_storage_path text;
  v_original_name text;
  v_byte_size integer;
  v_content_type text;
  v_expected_prefix text;
  v_stored_size bigint;
  v_created boolean := false;
  v_allowed_types text[] := array[
    'general_in_water_training', 'seeding', 'harvesting',
    'line_inspection_maintenance', 'mooring_inspection_maintenance',
    'nursery_deployment_recovery', 'other'
  ];
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_active_aggregator();
  select * into v_profile
  from public.ag_user_profiles
  where id = v_actor_id and account_status = 'active';
  if not found then
    raise exception 'An active user profile is required.' using errcode = '42501';
  end if;
  if p_submission_id is null then
    raise exception 'Submission ID is required.' using errcode = '22023';
  end if;
  if p_session is null or jsonb_typeof(p_session) <> 'object' then
    raise exception 'Session details must be an object.' using errcode = '22023';
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array'
     or jsonb_array_length(p_participants) > 200 then
    raise exception 'Participants must be an array of no more than 200 rows.'
      using errcode = '22023';
  end if;
  if p_seaweed_record is null or jsonb_typeof(p_seaweed_record) <> 'object' then
    raise exception 'Seaweed record must be an object.' using errcode = '22023';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'Photos must be an array.' using errcode = '22023';
  end if;
  if p_training_delivered is null or jsonb_typeof(p_training_delivered) <> 'array' then
    raise exception 'Training delivered must be an array.' using errcode = '22023';
  end if;
  if p_practical_competencies is null
     or jsonb_typeof(p_practical_competencies) <> 'array' then
    raise exception 'Practical competencies must be an array.' using errcode = '22023';
  end if;

  select array_agg(key order by key) into v_unknown_keys
  from jsonb_object_keys(p_session) key
  where key <> all(array[
    'training_date', 'location', 'start_time', 'finish_time', 'trainer_name',
    'supporting_staff', 'session_types', 'other_session_type',
    'weather_sea_conditions', 'nursery_reference'
  ]::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported session fields: %',
      array_to_string(v_unknown_keys, ', ') using errcode = '22023';
  end if;

  v_training_date := nullif(p_session ->> 'training_date', '')::date;
  v_location := lower(nullif(trim(p_session ->> 'location'), ''));
  v_start_time := nullif(p_session ->> 'start_time', '')::time;
  v_finish_time := nullif(p_session ->> 'finish_time', '')::time;
  v_trainer_name := nullif(trim(p_session ->> 'trainer_name'), '');
  v_supporting_staff := nullif(trim(p_session ->> 'supporting_staff'), '');
  v_other_session_type := nullif(trim(p_session ->> 'other_session_type'), '');
  v_conditions := nullif(trim(p_session ->> 'weather_sea_conditions'), '');
  v_nursery_reference := nullif(trim(p_session ->> 'nursery_reference'), '');

  if p_session ? 'session_types'
     and jsonb_typeof(p_session -> 'session_types') <> 'array' then
    raise exception 'Session types must be an array.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[])
  into v_session_types
  from jsonb_array_elements_text(
    coalesce(p_session -> 'session_types', '[]'::jsonb)
  );
  if cardinality(v_session_types) > 7
     or not (v_session_types <@ v_allowed_types) then
    raise exception 'Select valid Reef Nursery session types.' using errcode = '22023';
  end if;
  if v_location is not null
     and v_location not in ('mkwiro', 'offshore_nursery', 'shoreline_preparation') then
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
  if not ('other' = any(v_session_types)) then
    v_other_session_type := null;
  end if;
  if v_conditions is not null and length(v_conditions) > 1000 then
    raise exception 'Weather and sea conditions must be 1000 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_nursery_reference is not null and length(v_nursery_reference) > 200 then
    raise exception 'Nursery reference must be 200 characters or fewer.' using errcode = '22023';
  end if;

  for v_participant in select value from jsonb_array_elements(p_participants)
  loop
    if jsonb_typeof(v_participant) <> 'object' then
      raise exception 'Each participant must be an object.' using errcode = '22023';
    end if;
    select array_agg(key order by key) into v_unknown_keys
    from jsonb_object_keys(v_participant) key
    where key <> all(array[
      'participant_name', 'farmer_reference_phone', 'gender'
    ]::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported participant fields: %',
        array_to_string(v_unknown_keys, ', ') using errcode = '22023';
    end if;
    v_participant_name := nullif(trim(v_participant ->> 'participant_name'), '');
    v_participant_reference :=
      nullif(trim(v_participant ->> 'farmer_reference_phone'), '');
    v_gender := lower(nullif(trim(v_participant ->> 'gender'), ''));
    if v_participant_name is not null and length(v_participant_name) > 160 then
      raise exception 'Participant name must be 160 characters or fewer.'
        using errcode = '22023';
    end if;
    if v_participant_reference is not null
       and length(v_participant_reference) > 100 then
      raise exception 'Farmer ID or phone must be 100 characters or fewer.'
        using errcode = '22023';
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

  select array_agg(key order by key) into v_unknown_keys
  from jsonb_object_keys(p_seaweed_record) key
  where key <> all(array[
    'seaweed_health', 'seed_weight_value', 'seed_weight_unit',
    'harvest_weight_value', 'harvest_weight_unit', 'equipment_replaced'
  ]::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported seaweed fields: %',
      array_to_string(v_unknown_keys, ', ') using errcode = '22023';
  end if;
  v_health := nullif(trim(p_seaweed_record ->> 'seaweed_health'), '');
  v_seed_weight := nullif(p_seaweed_record ->> 'seed_weight_value', '')::numeric;
  v_seed_unit :=
    coalesce(nullif(trim(p_seaweed_record ->> 'seed_weight_unit'), ''), 'kg');
  v_harvest_weight :=
    nullif(p_seaweed_record ->> 'harvest_weight_value', '')::numeric;
  v_harvest_unit :=
    coalesce(nullif(trim(p_seaweed_record ->> 'harvest_weight_unit'), ''), 'kg');
  v_equipment := nullif(trim(p_seaweed_record ->> 'equipment_replaced'), '');
  if v_health is not null and length(v_health) > 500 then
    raise exception 'Seaweed health must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if v_seed_weight is not null
     and (v_seed_weight < 0 or v_seed_weight > 100000) then
    raise exception 'Seed weight is outside the allowed range.' using errcode = '22023';
  end if;
  if v_harvest_weight is not null
     and (v_harvest_weight < 0 or v_harvest_weight > 100000) then
    raise exception 'Harvest weight is outside the allowed range.' using errcode = '22023';
  end if;
  if v_seed_unit not in ('kg', 'g') or v_harvest_unit not in ('kg', 'g') then
    raise exception 'Select valid weight units.' using errcode = '22023';
  end if;
  if v_equipment is not null and length(v_equipment) > 1000 then
    raise exception 'Equipment replaced must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  v_normalized_seaweed := jsonb_build_object(
    'seaweed_health', v_health,
    'seed_weight_value', v_seed_weight,
    'seed_weight_unit', v_seed_unit,
    'harvest_weight_value', v_harvest_weight,
    'harvest_weight_unit', v_harvest_unit,
    'equipment_replaced', v_equipment
  );

  if p_session_id is not null then
    select * into v_saved
    from public.ag_reef_nursery_sessions
    where id = p_session_id
      and aggregator_id = v_aggregator_id
      and deleted_at is null
    for update;
    if not found then
      raise exception 'Reef Nursery record was not found.' using errcode = 'P0002';
    end if;
    if v_saved.record_status <> 'draft' then
      raise exception 'A submitted Reef Nursery record must be saved as changes, not as a draft.'
        using errcode = '22023';
    end if;
  else
    select * into v_saved
    from public.ag_reef_nursery_sessions
    where aggregator_id = v_aggregator_id
      and submission_id = p_submission_id
      and deleted_at is null
    for update;
    if not found then
      insert into public.ag_reef_nursery_sessions (
        submission_id, aggregator_id, training_date, location,
        start_time, finish_time, trainer_name, trainer_organisation,
        supporting_staff, session_types, other_session_type,
        weather_sea_conditions, nursery_reference,
        recorded_by_user_id, recorded_by_name,
        record_status, submitted_at
      ) values (
        p_submission_id, v_aggregator_id, v_training_date, v_location,
        v_start_time, v_finish_time, v_trainer_name, null,
        v_supporting_staff, v_session_types, v_other_session_type,
        v_conditions, v_nursery_reference,
        v_actor_id,
        left(coalesce(
          nullif(trim(v_profile.display_name), ''),
          nullif(trim(v_profile.email), ''),
          'Signed-in user'
        ), 160),
        'draft', null
      ) returning * into v_saved;
      v_created := true;
    elsif v_saved.record_status <> 'draft' then
      raise exception 'The submission ID already belongs to a submitted record.'
        using errcode = '22023';
    end if;
  end if;

  if not v_created then
    update public.ag_reef_nursery_sessions
    set training_date = v_training_date,
        location = v_location,
        start_time = v_start_time,
        finish_time = v_finish_time,
        trainer_name = v_trainer_name,
        trainer_organisation = null,
        supporting_staff = v_supporting_staff,
        session_types = v_session_types,
        other_session_type = v_other_session_type,
        weather_sea_conditions = v_conditions,
        nursery_reference = v_nursery_reference,
        updated_at = now()
    where id = v_saved.id
    returning * into v_saved;
  end if;

  v_participant_count := public.ag_replace_reef_nursery_details(
    v_saved.id, v_normalized_participants, v_normalized_seaweed
  );
  v_training_activity_count := public.ag_replace_reef_nursery_training(
    v_saved.id, v_session_types, p_training_delivered
  );
  v_competency_count := public.ag_replace_reef_nursery_competencies(
    v_saved.id, p_practical_competencies
  );

  select count(*)::integer into v_existing_photo_count
  from public.ag_reef_nursery_photos
  where session_id = v_saved.id;
  if v_existing_photo_count + jsonb_array_length(p_photos) > 8 then
    raise exception 'No more than 8 Reef Nursery photos can be attached.'
      using errcode = '22023';
  end if;
  v_expected_prefix := v_actor_id::text || '/' || v_saved.submission_id::text || '/';
  for v_photo, v_photo_order in
    select value, ordinality from jsonb_array_elements(p_photos) with ordinality
  loop
    if jsonb_typeof(v_photo) <> 'object' then
      raise exception 'Each photo must be an object.' using errcode = '22023';
    end if;
    select array_agg(key order by key) into v_unknown_keys
    from jsonb_object_keys(v_photo) key
    where key <> all(array[
      'storage_path', 'original_name', 'byte_size', 'content_type'
    ]::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported photo fields: %',
        array_to_string(v_unknown_keys, ', ') using errcode = '22023';
    end if;
    v_storage_path := nullif(trim(v_photo ->> 'storage_path'), '');
    v_original_name := nullif(trim(v_photo ->> 'original_name'), '');
    v_byte_size := nullif(v_photo ->> 'byte_size', '')::integer;
    v_content_type := lower(nullif(trim(v_photo ->> 'content_type'), ''));
    if v_storage_path is null
       or left(v_storage_path, length(v_expected_prefix)) <> v_expected_prefix
       or v_storage_path !~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9]{2}-[0-9a-f-]+[.]jpg$'
       or length(v_storage_path) > 700 then
      raise exception 'A Reef Nursery photo path is invalid.' using errcode = '22023';
    end if;
    if v_original_name is null or length(v_original_name) > 255 then
      raise exception 'A Reef Nursery photo name is invalid.' using errcode = '22023';
    end if;
    if v_byte_size is null or v_byte_size < 1 or v_byte_size > 1048576 then
      raise exception 'A Reef Nursery photo must be no larger than 1 MB.'
        using errcode = '22023';
    end if;
    if v_content_type <> 'image/jpeg' then
      raise exception 'Reef Nursery photos must be compressed JPEG images.'
        using errcode = '22023';
    end if;
    select nullif(metadata ->> 'size', '')::bigint into v_stored_size
    from storage.objects
    where bucket_id = 'reef-nursery-photos' and name = v_storage_path;
    if not found then
      raise exception 'An uploaded Reef Nursery photo was not found.' using errcode = '22023';
    end if;
    if v_stored_size is not null and v_stored_size <> v_byte_size then
      raise exception 'An uploaded Reef Nursery photo size does not match.'
        using errcode = '22023';
    end if;
    insert into public.ag_reef_nursery_photos (
      session_id, photo_order, storage_path, original_name,
      byte_size, content_type, uploaded_by_user_id
    ) values (
      v_saved.id,
      v_existing_photo_count + v_photo_order::integer,
      v_storage_path,
      v_original_name,
      v_byte_size,
      v_content_type,
      v_actor_id
    );
  end loop;
  select count(*)::integer into v_photo_count
  from public.ag_reef_nursery_photos
  where session_id = v_saved.id;

  insert into public.ag_audit_log (
    actor_user_id, actor_email, action, target_type, target_id, details
  ) values (
    v_actor_id,
    v_profile.email,
    case when v_created
      then 'reef_nursery_draft_created'
      else 'reef_nursery_draft_updated'
    end,
    'reef_nursery_session',
    v_saved.id::text,
    jsonb_build_object(
      'record_number', v_saved.record_number,
      'participant_count', v_participant_count,
      'training_activity_count', v_training_activity_count,
      'competency_count', v_competency_count,
      'photo_count', v_photo_count
    )
  );

  return jsonb_build_object(
    'session_id', v_saved.id,
    'record_number', v_saved.record_number,
    'record_status', 'draft',
    'participant_count', v_participant_count,
    'training_activity_count', v_training_activity_count,
    'competency_count', v_competency_count,
    'photo_count', v_photo_count
  );
end;
$$;

create or replace function public.ag_mark_reef_nursery_submitted(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_aggregator_id uuid;
  v_profile public.ag_user_profiles%rowtype;
  v_saved public.ag_reef_nursery_sessions%rowtype;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_active_aggregator();
  select * into v_profile
  from public.ag_user_profiles
  where id = v_actor_id and account_status = 'active';
  if not found then
    raise exception 'An active user profile is required.' using errcode = '42501';
  end if;
  select * into v_saved
  from public.ag_reef_nursery_sessions
  where id = p_session_id
    and aggregator_id = v_aggregator_id
    and deleted_at is null
  for update;
  if not found then
    raise exception 'Reef Nursery record was not found.' using errcode = 'P0002';
  end if;
  if v_saved.training_date is null then
    raise exception 'Training date is required before submission.' using errcode = '22023';
  end if;
  if v_saved.start_time is null then
    raise exception 'Start time is required before submission.' using errcode = '22023';
  end if;
  if v_saved.finish_time is null or v_saved.finish_time <= v_saved.start_time then
    raise exception 'Finish time must be after start time before submission.'
      using errcode = '22023';
  end if;
  if cardinality(v_saved.session_types) < 1 then
    raise exception 'Select at least one type of session before submission.'
      using errcode = '22023';
  end if;
  if 'other' = any(v_saved.session_types)
     and nullif(trim(v_saved.other_session_type), '') is null then
    raise exception 'Enter the other session type before submission.'
      using errcode = '22023';
  end if;

  update public.ag_reef_nursery_sessions
  set record_status = 'submitted',
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
  where id = v_saved.id
  returning * into v_saved;

  insert into public.ag_audit_log (
    actor_user_id, actor_email, action, target_type, target_id, details
  ) values (
    v_actor_id,
    v_profile.email,
    'reef_nursery_session_submitted',
    'reef_nursery_session',
    v_saved.id::text,
    jsonb_build_object(
      'record_number', v_saved.record_number,
      'training_date', v_saved.training_date,
      'session_types', to_jsonb(v_saved.session_types)
    )
  );
  return jsonb_build_object(
    'session_id', v_saved.id,
    'record_number', v_saved.record_number,
    'record_status', v_saved.record_status,
    'submitted_at', v_saved.submitted_at
  );
end;
$$;

create or replace function public.ag_reef_nursery_session_detail_v2(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_session public.ag_reef_nursery_sessions%rowtype;
begin
  v_result := public.ag_reef_nursery_session_detail(p_session_id);
  select * into v_session
  from public.ag_reef_nursery_sessions
  where id = p_session_id;
  return v_result || jsonb_build_object(
    'record_status', v_session.record_status,
    'submitted_at', v_session.submitted_at
  );
end;
$$;

create or replace function public.ag_reef_nursery_records_v2(
  p_search text default null,
  p_sort text default 'training_date',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  session_id uuid,
  record_number text,
  record_status text,
  training_date date,
  trainer_name text,
  location text,
  session_types text[],
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_search text := nullif(trim(p_search), '');
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'training_date'));
  v_direction text := lower(coalesce(nullif(trim(p_direction), ''), 'desc'));
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_active_aggregator();
  if v_sort not in (
    'record_number', 'training_date', 'trainer_name', 'location', 'session_types'
  ) then
    raise exception 'Unsupported sort column.' using errcode = '22023';
  end if;
  if v_direction not in ('asc', 'desc') then
    raise exception 'Unsupported sort direction.' using errcode = '22023';
  end if;

  return query
  select
    session.id,
    session.record_number,
    session.record_status,
    session.training_date,
    session.trainer_name,
    session.location,
    array(
      select case
        when session_type = 'other'
          then 'other:' || coalesce(session.other_session_type, '')
        else session_type
      end
      from unnest(session.session_types) session_type
    ),
    session.updated_at,
    count(*) over()
  from public.ag_reef_nursery_sessions session
  where session.aggregator_id = v_aggregator_id
    and session.deleted_at is null
    and (
      v_search is null
      or session.record_number ilike '%' || v_search || '%'
      or coalesce(session.trainer_name, '') ilike '%' || v_search || '%'
      or coalesce(session.location, '') ilike '%' || v_search || '%'
      or array_to_string(session.session_types, ', ') ilike '%' || v_search || '%'
      or session.record_status ilike '%' || v_search || '%'
    )
  order by
    case when v_sort = 'record_number' and v_direction = 'asc'
      then substring(session.record_number from 4)::bigint end asc,
    case when v_sort = 'record_number' and v_direction = 'desc'
      then substring(session.record_number from 4)::bigint end desc,
    case when v_sort = 'training_date' and v_direction = 'asc'
      then session.training_date end asc nulls last,
    case when v_sort = 'training_date' and v_direction = 'desc'
      then session.training_date end desc nulls last,
    case when v_sort = 'trainer_name' and v_direction = 'asc'
      then lower(session.trainer_name) end asc nulls last,
    case when v_sort = 'trainer_name' and v_direction = 'desc'
      then lower(session.trainer_name) end desc nulls last,
    case when v_sort = 'location' and v_direction = 'asc'
      then session.location end asc nulls last,
    case when v_sort = 'location' and v_direction = 'desc'
      then session.location end desc nulls last,
    case when v_sort = 'session_types' and v_direction = 'asc'
      then array_to_string(session.session_types, ', ') end asc,
    case when v_sort = 'session_types' and v_direction = 'desc'
      then array_to_string(session.session_types, ', ') end desc,
    session.updated_at desc,
    session.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.ag_save_reef_nursery_draft(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_mark_reef_nursery_submitted(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_reef_nursery_session_detail_v2(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_reef_nursery_records_v2(
  text, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.ag_save_reef_nursery_draft(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.ag_mark_reef_nursery_submitted(uuid)
  to authenticated;
grant execute on function public.ag_reef_nursery_session_detail_v2(uuid)
  to authenticated;
grant execute on function public.ag_reef_nursery_records_v2(
  text, text, text, integer, integer
) to authenticated;

notify pgrst, 'reload schema';

commit;
