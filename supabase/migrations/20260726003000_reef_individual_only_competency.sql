begin;

alter table public.ag_reef_nursery_competency_assessments
  alter column group_level drop not null,
  drop constraint if exists ag_reef_nursery_competency_level_check;

alter table public.ag_reef_nursery_competency_assessments
  add constraint ag_reef_nursery_competency_level_check check (
    group_level is null
    or group_level in ('needs_support', 'with_supervision', 'independent')
  );

comment on table public.ag_reef_nursery_competency_assessments is
  'Optional practical-task assessments with an all-participants result, individual participant results, or both.';
comment on table public.ag_reef_nursery_competency_overrides is
  'Named participant practical competency results. These may supplement or replace an all-participants result.';

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
    if v_group_level is not null
       and not (v_group_level = any(v_allowed_levels)) then
      raise exception 'Choose a valid all-participants practical competency result.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_overrides) <> 'array'
       or jsonb_array_length(v_overrides) > 200 then
      raise exception 'Individual competency results must be an array of up to 200 participants.'
        using errcode = '22023';
    end if;
    if v_group_level is null and jsonb_array_length(v_overrides) = 0 then
      raise exception 'Add an all-participants or individual practical competency result.'
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

notify pgrst, 'reload schema';

commit;
