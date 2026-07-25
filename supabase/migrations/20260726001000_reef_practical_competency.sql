begin;

create table if not exists public.ag_reef_nursery_competency_assessments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ag_reef_nursery_sessions(id) on delete cascade,
  section_key text not null,
  matrix_activity_id uuid not null references public.ag_reef_training_matrix_activities(id) on delete restrict,
  activity_label_snapshot text not null,
  activity_order integer not null,
  group_level text not null,
  created_at timestamptz not null default now(),
  constraint ag_reef_nursery_competency_activity_unique unique (session_id, matrix_activity_id),
  constraint ag_reef_nursery_competency_label_check check (
    length(trim(activity_label_snapshot)) between 1 and 300
  ),
  constraint ag_reef_nursery_competency_level_check check (
    group_level in ('needs_support', 'with_supervision', 'independent')
  )
);

create table if not exists public.ag_reef_nursery_competency_overrides (
  assessment_id uuid not null references public.ag_reef_nursery_competency_assessments(id) on delete cascade,
  participant_order integer not null,
  participant_name_snapshot text not null,
  farmer_reference_phone_snapshot text,
  competency_level text not null,
  created_at timestamptz not null default now(),
  primary key (assessment_id, participant_order),
  constraint ag_reef_nursery_competency_override_order_check check (
    participant_order between 1 and 200
  ),
  constraint ag_reef_nursery_competency_override_name_check check (
    length(trim(participant_name_snapshot)) between 1 and 160
  ),
  constraint ag_reef_nursery_competency_override_reference_check check (
    farmer_reference_phone_snapshot is null
    or length(farmer_reference_phone_snapshot) <= 100
  ),
  constraint ag_reef_nursery_competency_override_level_check check (
    competency_level in ('needs_support', 'with_supervision', 'independent')
  )
);

create index if not exists ag_reef_nursery_competency_session_idx
  on public.ag_reef_nursery_competency_assessments (
    session_id, section_key, activity_order, id
  );

comment on table public.ag_reef_nursery_competency_assessments is
  'Optional key practical-task assessments for Reef Nursery training. The group result applies to every participant unless overridden.';
comment on table public.ag_reef_nursery_competency_overrides is
  'Named participant results that override the all-participants practical competency result.';

alter table public.ag_reef_nursery_competency_assessments enable row level security;
alter table public.ag_reef_nursery_competency_overrides enable row level security;

revoke all on table public.ag_reef_nursery_competency_assessments
  from public, anon, authenticated;
revoke all on table public.ag_reef_nursery_competency_overrides
  from public, anon, authenticated;

create or replace function public.ag_replace_reef_nursery_competencies(
  p_session_id uuid,
  p_practical_competencies jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_competency jsonb;
  v_override jsonb;
  v_unknown_keys text[];
  v_activity_id uuid;
  v_section_key text;
  v_activity_section text;
  v_activity_label text;
  v_activity_order integer;
  v_group_level text;
  v_overrides jsonb;
  v_assessment_id uuid;
  v_participant_order integer;
  v_participant_name text;
  v_participant_reference text;
  v_override_level text;
  v_count integer := 0;
  v_allowed_levels text[] := array[
    'needs_support', 'with_supervision', 'independent'
  ];
begin
  if p_practical_competencies is null
     or jsonb_typeof(p_practical_competencies) <> 'array'
     or jsonb_array_length(p_practical_competencies) > 50 then
    raise exception 'Practical competencies must be an array of up to 50 tasks.'
      using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct value ->> 'activity_id')
    from jsonb_array_elements(p_practical_competencies)
  ) then
    raise exception 'A practical task was assessed more than once.'
      using errcode = '22023';
  end if;

  delete from public.ag_reef_nursery_competency_assessments
  where session_id = p_session_id;

  for v_competency in
    select value from jsonb_array_elements(p_practical_competencies)
  loop
    if jsonb_typeof(v_competency) <> 'object' then
      raise exception 'Each practical competency must be an object.'
        using errcode = '22023';
    end if;
    select array_agg(key order by key) into v_unknown_keys
    from jsonb_object_keys(v_competency) key
    where key <> all(array[
      'section_key', 'activity_id', 'group_level', 'participant_overrides'
    ]::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported practical competency fields: %',
        array_to_string(v_unknown_keys, ', ')
        using errcode = '22023';
    end if;

    v_section_key := nullif(trim(v_competency ->> 'section_key'), '');
    begin
      v_activity_id := nullif(v_competency ->> 'activity_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'A practical task ID is invalid.' using errcode = '22023';
    end;
    v_group_level := nullif(trim(v_competency ->> 'group_level'), '');
    v_overrides := coalesce(v_competency -> 'participant_overrides', '[]'::jsonb);

    if v_section_key is null or v_activity_id is null then
      raise exception 'Every practical competency needs a training task.'
        using errcode = '22023';
    end if;
    if v_group_level is null or not (v_group_level = any(v_allowed_levels)) then
      raise exception 'Choose Needs support, With supervision or Independent for every assessed task.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_overrides) <> 'array'
       or jsonb_array_length(v_overrides) > 200 then
      raise exception 'Individual competency results must be an array of up to 200 participants.'
        using errcode = '22023';
    end if;
    if (
      select count(*) <> count(distinct value ->> 'participant_order')
      from jsonb_array_elements(v_overrides)
    ) then
      raise exception 'A participant has more than one result for the same practical task.'
        using errcode = '22023';
    end if;

    select
      delivered.section_key,
      delivered.activity_label_snapshot,
      delivered.activity_order
    into
      v_activity_section,
      v_activity_label,
      v_activity_order
    from public.ag_reef_nursery_training_activities delivered
    where delivered.session_id = p_session_id
      and delivered.matrix_activity_id = v_activity_id;
    if not found or v_activity_section <> v_section_key then
      raise exception 'A practical task must be selected under Training delivered first.'
        using errcode = '22023';
    end if;

    insert into public.ag_reef_nursery_competency_assessments (
      session_id,
      section_key,
      matrix_activity_id,
      activity_label_snapshot,
      activity_order,
      group_level
    ) values (
      p_session_id,
      v_section_key,
      v_activity_id,
      v_activity_label,
      v_activity_order,
      v_group_level
    )
    returning id into v_assessment_id;

    for v_override in
      select value from jsonb_array_elements(v_overrides)
    loop
      if jsonb_typeof(v_override) <> 'object' then
        raise exception 'Each individual competency result must be an object.'
          using errcode = '22023';
      end if;
      select array_agg(key order by key) into v_unknown_keys
      from jsonb_object_keys(v_override) key
      where key <> all(array[
        'participant_order', 'competency_level'
      ]::text[]);
      if v_unknown_keys is not null then
        raise exception 'Unsupported individual competency fields: %',
          array_to_string(v_unknown_keys, ', ')
          using errcode = '22023';
      end if;

      begin
        v_participant_order := nullif(v_override ->> 'participant_order', '')::integer;
      exception when invalid_text_representation then
        raise exception 'An individual competency participant is invalid.'
          using errcode = '22023';
      end;
      v_override_level := nullif(trim(v_override ->> 'competency_level'), '');
      if v_participant_order is null
         or v_override_level is null
         or not (v_override_level = any(v_allowed_levels)) then
        raise exception 'Choose a valid result for every selected participant.'
          using errcode = '22023';
      end if;

      select
        participant.participant_name,
        participant.farmer_reference_phone
      into
        v_participant_name,
        v_participant_reference
      from public.ag_reef_nursery_participants participant
      where participant.session_id = p_session_id
        and participant.participant_order = v_participant_order;
      if not found then
        raise exception 'An individual competency result does not match a current participant.'
          using errcode = '22023';
      end if;

      insert into public.ag_reef_nursery_competency_overrides (
        assessment_id,
        participant_order,
        participant_name_snapshot,
        farmer_reference_phone_snapshot,
        competency_level
      ) values (
        v_assessment_id,
        v_participant_order,
        v_participant_name,
        v_participant_reference,
        v_override_level
      );
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.ag_submit_reef_nursery_session(
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
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_competency_count integer := 0;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_result := public.ag_submit_reef_nursery_session(
    p_submission_id,
    p_session,
    p_participants,
    p_seaweed_record,
    p_photos,
    p_training_delivered
  );
  v_session_id := nullif(v_result ->> 'session_id', '')::uuid;
  if v_session_id is null then
    raise exception 'The Reef Nursery session could not be identified.'
      using errcode = 'P0001';
  end if;
  if coalesce((v_result ->> 'duplicate')::boolean, false) then
    select count(*)::integer into v_competency_count
    from public.ag_reef_nursery_competency_assessments
    where session_id = v_session_id;
    return v_result || jsonb_build_object(
      'competency_count', v_competency_count
    );
  end if;

  v_competency_count := public.ag_replace_reef_nursery_competencies(
    v_session_id,
    coalesce(p_practical_competencies, '[]'::jsonb)
  );
  update public.ag_audit_log
  set details = details || jsonb_build_object(
    'competency_count', v_competency_count
  )
  where action = 'reef_nursery_session_created'
    and target_type = 'reef_nursery_session'
    and target_id = v_session_id::text;
  return v_result || jsonb_build_object(
    'competency_count', v_competency_count
  );
end;
$$;

create or replace function public.ag_update_reef_nursery_session(
  p_session_id uuid,
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
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_email text;
  v_result jsonb;
  v_competency_count integer := 0;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_result := public.ag_update_reef_nursery_session(
    p_session_id,
    p_session,
    p_participants,
    p_seaweed_record,
    p_photos,
    p_training_delivered
  );
  v_competency_count := public.ag_replace_reef_nursery_competencies(
    p_session_id,
    coalesce(p_practical_competencies, '[]'::jsonb)
  );

  select email into v_actor_email
  from public.ag_user_profiles where id = v_actor_id;
  insert into public.ag_audit_log (
    actor_user_id, actor_email, action, target_type, target_id, details
  ) values (
    v_actor_id,
    v_actor_email,
    'reef_nursery_competency_updated',
    'reef_nursery_session',
    p_session_id::text,
    jsonb_build_object('competency_count', v_competency_count)
  );
  return v_result || jsonb_build_object(
    'competency_count', v_competency_count
  );
end;
$$;

alter function public.ag_reef_nursery_session_detail(uuid)
  rename to ag_reef_nursery_session_detail_without_competency;

create or replace function public.ag_reef_nursery_session_detail(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_competencies jsonb;
begin
  v_result := public.ag_reef_nursery_session_detail_without_competency(
    p_session_id
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'section_key', assessment.section_key,
    'activity_id', assessment.matrix_activity_id,
    'activity_label', assessment.activity_label_snapshot,
    'group_level', assessment.group_level,
    'participant_overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_order', override.participant_order,
        'participant_name', override.participant_name_snapshot,
        'farmer_reference_phone', override.farmer_reference_phone_snapshot,
        'competency_level', override.competency_level
      ) order by override.participant_order)
      from public.ag_reef_nursery_competency_overrides override
      where override.assessment_id = assessment.id
    ), '[]'::jsonb)
  ) order by assessment.section_key, assessment.activity_order, assessment.id), '[]'::jsonb)
  into v_competencies
  from public.ag_reef_nursery_competency_assessments assessment
  where assessment.session_id = p_session_id;
  return v_result || jsonb_build_object(
    'practical_competencies', v_competencies
  );
end;
$$;

revoke all on function public.ag_replace_reef_nursery_competencies(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_reef_nursery_session(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_update_reef_nursery_session(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_reef_nursery_session_detail_without_competency(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_reef_nursery_session_detail(uuid)
  from public, anon, authenticated;

grant execute on function public.ag_submit_reef_nursery_session(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.ag_update_reef_nursery_session(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.ag_reef_nursery_session_detail(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
