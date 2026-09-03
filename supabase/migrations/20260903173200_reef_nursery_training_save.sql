begin;

create or replace function public.ag_reef_training_workspace_save(
  p_session_id uuid,
  p_submission_id uuid,
  p_session jsonb,
  p_participants jsonb,
  p_training_delivered jsonb,
  p_practical_competencies jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_access_mode text := v_scope ->> 'access_mode';
  v_actor_id uuid := case when v_access_mode = 'authenticated' then (select auth.uid()) else null end;
  v_actor_email text;
  v_payload jsonb;
  v_session jsonb;
  v_participants jsonb;
  v_saved public.ag_reef_nursery_sessions%rowtype;
  v_created boolean := false;
  v_recorded_by_name text;
  v_participant_count integer;
  v_training_count integer;
  v_competency_count integer;
  v_training jsonb := coalesce(p_training_delivered, '[]'::jsonb);
  v_competencies jsonb := coalesce(p_practical_competencies, '[]'::jsonb);
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;
  if jsonb_typeof(v_training) <> 'array' then
    raise exception 'Training delivered must be an array.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_competencies) <> 'array' then
    raise exception 'Practical competencies must be an array.' using errcode = '22023';
  end if;

  v_payload := public.ag_reef_training_workspace_validate_draft(p_session, p_participants);
  v_session := v_payload -> 'session';
  v_participants := v_payload -> 'participants';

  if p_session_id is not null then
    select * into v_saved
    from public.ag_reef_nursery_sessions session
    where session.id = p_session_id
      and session.aggregator_id = v_aggregator_id
      and session.deleted_at is null
    for update;
  else
    if p_submission_id is null then
      raise exception 'Submission ID is required for a new Training draft.' using errcode = '22023';
    end if;
    select * into v_saved
    from public.ag_reef_nursery_sessions session
    where session.aggregator_id = v_aggregator_id
      and session.submission_id = p_submission_id
      and session.deleted_at is null
    for update;
  end if;

  if found then
    if v_access_mode <> 'authenticated'
       and v_saved.created_at + interval '168 hours' <= now() then
      raise exception 'This Training record is older than 7 days. Sign in with an authorised COSME Reef account to edit it.'
        using errcode = '42501';
    end if;
  else
    if p_session_id is not null then
      raise exception 'Training record was not found.' using errcode = 'P0002';
    end if;
    if v_actor_id is not null then
      select profile.email into v_actor_email
      from public.ag_user_profiles profile
      where profile.id = v_actor_id;
    end if;
    v_recorded_by_name := case
      when v_access_mode = 'authenticated' then coalesce(
        nullif(v_scope ->> 'profile_name', ''), nullif(v_actor_email, ''), 'COSME Reef user'
      )
      else coalesce(nullif(v_session ->> 'trainer_name', ''), 'Public Reef draft')
    end;

    insert into public.ag_reef_nursery_sessions (
      submission_id, aggregator_id, training_date, location, start_time, finish_time,
      trainer_name, trainer_organisation, supporting_staff, session_types,
      other_session_type, weather_sea_conditions, nursery_reference,
      recorded_by_user_id, recorded_by_name, record_status, submitted_at
    ) values (
      p_submission_id, v_aggregator_id,
      nullif(v_session ->> 'training_date', '')::date,
      nullif(v_session ->> 'location', ''),
      nullif(v_session ->> 'start_time', '')::time,
      nullif(v_session ->> 'finish_time', '')::time,
      nullif(v_session ->> 'trainer_name', ''), null,
      nullif(v_session ->> 'supporting_staff', ''),
      array(select jsonb_array_elements_text(v_session -> 'session_types')),
      nullif(v_session ->> 'other_session_type', ''),
      nullif(v_session ->> 'weather_sea_conditions', ''),
      nullif(v_session ->> 'nursery_reference', ''),
      v_actor_id, left(v_recorded_by_name, 160), 'draft', null
    ) returning * into v_saved;
    v_created := true;
  end if;

  if not v_created then
    update public.ag_reef_nursery_sessions
    set training_date = nullif(v_session ->> 'training_date', '')::date,
        location = nullif(v_session ->> 'location', ''),
        start_time = nullif(v_session ->> 'start_time', '')::time,
        finish_time = nullif(v_session ->> 'finish_time', '')::time,
        trainer_name = nullif(v_session ->> 'trainer_name', ''),
        supporting_staff = nullif(v_session ->> 'supporting_staff', ''),
        session_types = array(select jsonb_array_elements_text(v_session -> 'session_types')),
        other_session_type = nullif(v_session ->> 'other_session_type', ''),
        weather_sea_conditions = nullif(v_session ->> 'weather_sea_conditions', ''),
        nursery_reference = nullif(v_session ->> 'nursery_reference', ''),
        record_status = 'draft',
        submitted_at = null,
        updated_at = clock_timestamp()
    where id = v_saved.id
    returning * into v_saved;
  end if;

  v_participant_count := public.ag_reef_training_workspace_replace_participants(
    v_saved.id, v_participants
  );
  v_training_count := public.ag_replace_reef_nursery_training(
    v_saved.id, v_saved.session_types, v_training
  );
  v_competency_count := public.ag_replace_reef_nursery_competencies(
    v_saved.id, v_competencies
  );

  if v_actor_id is not null and v_actor_email is null then
    select profile.email into v_actor_email
    from public.ag_user_profiles profile
    where profile.id = v_actor_id;
  end if;
  insert into public.ag_audit_log (
    actor_user_id, actor_email, action, target_type, target_id, details
  ) values (
    v_actor_id, v_actor_email,
    case when v_created then 'reef_nursery_training_draft_created'
      else 'reef_nursery_training_draft_saved' end,
    'reef_nursery_session', v_saved.id::text,
    jsonb_build_object(
      'record_number', v_saved.record_number,
      'access_mode', v_access_mode,
      'participant_count', v_participant_count,
      'training_activity_count', v_training_count,
      'competency_count', v_competency_count,
      'public_edit_until', v_saved.created_at + interval '168 hours'
    )
  );

  return jsonb_build_object(
    'session_id', v_saved.id,
    'record_number', v_saved.record_number,
    'record_status', v_saved.record_status,
    'participant_count', v_participant_count,
    'training_activity_count', v_training_count,
    'competency_count', v_competency_count,
    'public_edit_until', v_saved.created_at + interval '168 hours'
  );
end;
$$;

commit;
