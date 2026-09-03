begin;

create or replace function public.ag_reef_seaweed_workspace_save(
  p_record_id uuid,
  p_submission_id uuid,
  p_record jsonb,
  p_units jsonb
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
  v_record jsonb;
  v_units jsonb;
  v_saved public.ag_reef_seaweed_records%rowtype;
  v_created boolean := false;
  v_unit_count integer;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;
  v_payload := public.ag_reef_seaweed_workspace_validate_draft(p_record, p_units);
  v_record := v_payload -> 'record';
  v_units := v_payload -> 'units';

  if p_record_id is not null then
    select * into v_saved
    from public.ag_reef_seaweed_records record
    where record.id = p_record_id
      and record.aggregator_id = v_aggregator_id
      and record.deleted_at is null
    for update;
  else
    if p_submission_id is null then
      raise exception 'Submission ID is required for a new Seaweed Record draft.' using errcode = '22023';
    end if;
    select * into v_saved
    from public.ag_reef_seaweed_records record
    where record.aggregator_id = v_aggregator_id
      and record.submission_id = p_submission_id
      and record.deleted_at is null
    for update;
  end if;

  if found then
    if v_access_mode <> 'authenticated'
       and v_saved.created_at + interval '168 hours' <= now() then
      raise exception 'This Seaweed Record is older than 7 days. Sign in with an authorised COSME Reef account to edit it.'
        using errcode = '42501';
    end if;
  else
    if p_record_id is not null then
      raise exception 'Seaweed Record was not found.' using errcode = 'P0002';
    end if;
    insert into public.ag_reef_seaweed_records (
      submission_id, aggregator_id, record_date, location, recorded_by_name,
      recorded_by_user_id, record_status, submitted_at
    ) values (
      p_submission_id, v_aggregator_id,
      nullif(v_record ->> 'record_date', '')::date,
      nullif(v_record ->> 'location', ''),
      nullif(v_record ->> 'recorded_by_name', ''),
      v_actor_id, 'draft', null
    ) returning * into v_saved;
    v_created := true;
  end if;

  if not v_created then
    update public.ag_reef_seaweed_records
    set record_date = nullif(v_record ->> 'record_date', '')::date,
        location = nullif(v_record ->> 'location', ''),
        recorded_by_name = nullif(v_record ->> 'recorded_by_name', ''),
        record_status = 'draft',
        submitted_at = null,
        updated_at = clock_timestamp()
    where id = v_saved.id
    returning * into v_saved;
  end if;

  v_unit_count := public.ag_reef_seaweed_workspace_replace_units(v_saved.id, v_units);
  if v_actor_id is not null then
    select profile.email into v_actor_email
    from public.ag_user_profiles profile where profile.id = v_actor_id;
  end if;
  insert into public.ag_audit_log (
    actor_user_id, actor_email, action, target_type, target_id, details
  ) values (
    v_actor_id, v_actor_email,
    case when v_created then 'reef_seaweed_draft_created' else 'reef_seaweed_draft_saved' end,
    'reef_seaweed_record', v_saved.id::text,
    jsonb_build_object(
      'record_number', v_saved.record_number,
      'access_mode', v_access_mode,
      'unit_count', v_unit_count,
      'public_edit_until', v_saved.created_at + interval '168 hours'
    )
  );

  return jsonb_build_object(
    'record_id', v_saved.id,
    'record_number', v_saved.record_number,
    'record_status', v_saved.record_status,
    'unit_count', v_unit_count,
    'public_edit_until', v_saved.created_at + interval '168 hours'
  );
end;
$$;

create or replace function public.ag_reef_inspection_workspace_save(
  p_record_id uuid,
  p_submission_id uuid,
  p_record jsonb,
  p_rafts jsonb
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
  v_record jsonb;
  v_rafts jsonb;
  v_saved public.ag_reef_inspection_records%rowtype;
  v_created boolean := false;
  v_raft_count integer;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;
  v_payload := public.ag_reef_inspection_workspace_validate_draft(p_record, p_rafts);
  v_record := v_payload -> 'record';
  v_rafts := v_payload -> 'rafts';

  if p_record_id is not null then
    select * into v_saved
    from public.ag_reef_inspection_records record
    where record.id = p_record_id
      and record.aggregator_id = v_aggregator_id
      and record.deleted_at is null
    for update;
  else
    if p_submission_id is null then
      raise exception 'Submission ID is required for a new Inspection draft.' using errcode = '22023';
    end if;
    select * into v_saved
    from public.ag_reef_inspection_records record
    where record.aggregator_id = v_aggregator_id
      and record.submission_id = p_submission_id
      and record.deleted_at is null
    for update;
  end if;

  if found then
    if v_access_mode <> 'authenticated'
       and v_saved.created_at + interval '168 hours' <= now() then
      raise exception 'This Raft and Mooring Inspection is older than 7 days. Sign in with an authorised COSME Reef account to edit it.'
        using errcode = '42501';
    end if;
  else
    if p_record_id is not null then
      raise exception 'Raft and Mooring Inspection was not found.' using errcode = 'P0002';
    end if;
    insert into public.ag_reef_inspection_records (
      submission_id, aggregator_id, inspection_date, location, recorded_by_name,
      recorded_by_user_id, general_notes, record_status, submitted_at
    ) values (
      p_submission_id, v_aggregator_id,
      nullif(v_record ->> 'inspection_date', '')::date,
      nullif(v_record ->> 'location', ''),
      nullif(v_record ->> 'recorded_by_name', ''),
      v_actor_id, nullif(v_record ->> 'general_notes', ''), 'draft', null
    ) returning * into v_saved;
    v_created := true;
  end if;

  if not v_created then
    update public.ag_reef_inspection_records
    set inspection_date = nullif(v_record ->> 'inspection_date', '')::date,
        location = nullif(v_record ->> 'location', ''),
        recorded_by_name = nullif(v_record ->> 'recorded_by_name', ''),
        general_notes = nullif(v_record ->> 'general_notes', ''),
        record_status = 'draft',
        submitted_at = null,
        updated_at = clock_timestamp()
    where id = v_saved.id
    returning * into v_saved;
  end if;

  v_raft_count := public.ag_reef_inspection_workspace_replace_rafts(v_saved.id, v_rafts);
  if v_actor_id is not null then
    select profile.email into v_actor_email
    from public.ag_user_profiles profile where profile.id = v_actor_id;
  end if;
  insert into public.ag_audit_log (
    actor_user_id, actor_email, action, target_type, target_id, details
  ) values (
    v_actor_id, v_actor_email,
    case when v_created then 'reef_inspection_draft_created' else 'reef_inspection_draft_saved' end,
    'reef_inspection_record', v_saved.id::text,
    jsonb_build_object(
      'record_number', v_saved.record_number,
      'access_mode', v_access_mode,
      'raft_count', v_raft_count,
      'public_edit_until', v_saved.created_at + interval '168 hours'
    )
  );

  return jsonb_build_object(
    'record_id', v_saved.id,
    'record_number', v_saved.record_number,
    'record_status', v_saved.record_status,
    'raft_count', v_raft_count,
    'public_edit_until', v_saved.created_at + interval '168 hours'
  );
end;
$$;

commit;
