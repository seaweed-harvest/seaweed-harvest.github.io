begin;

create or replace function public.ag_reef_inspection_workspace_validate_draft(
  p_record jsonb,
  p_rafts jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_unknown_keys text[];
  v_inspection_date date;
  v_location text;
  v_recorded_by_name text;
  v_general_notes text;
  v_raft jsonb;
  v_raft_number integer;
  v_field text;
  v_seen_rafts integer[] := '{}'::integer[];
  v_normalized_rafts jsonb := '[]'::jsonb;
  v_normalized_raft jsonb;
  v_allowed_fields text[] := array[
    'overall_position_condition', 'seaweed_lines_attachments',
    'hdpe_floating_frame', 'rigging_harness', 'mooring_components',
    'mooring_anchors', 'mooring_attachment_points'
  ];
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Inspection details must be an object.' using errcode = '22023';
  end if;
  if p_rafts is null
     or jsonb_typeof(p_rafts) <> 'array'
     or jsonb_array_length(p_rafts) > 5 then
    raise exception 'Inspection rafts must be an array of no more than 5 rows.'
      using errcode = '22023';
  end if;

  select array_agg(key order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_record) key
  where key <> all(array[
    'inspection_date', 'location', 'recorded_by_name', 'general_notes'
  ]::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported inspection fields: %', array_to_string(v_unknown_keys, ', ')
      using errcode = '22023';
  end if;

  begin
    v_inspection_date := nullif(p_record ->> 'inspection_date', '')::date;
  exception when others then
    raise exception 'Enter a valid inspection date.' using errcode = '22023';
  end;
  v_location := lower(nullif(trim(p_record ->> 'location'), ''));
  v_recorded_by_name := nullif(trim(p_record ->> 'recorded_by_name'), '');
  v_general_notes := nullif(trim(p_record ->> 'general_notes'), '');
  if v_location is not null
     and v_location not in ('tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore') then
    raise exception 'Select a valid Reef Nursery location.' using errcode = '22023';
  end if;
  if v_recorded_by_name is not null and length(v_recorded_by_name) > 160 then
    raise exception 'Person filling the form must be 160 characters or fewer.' using errcode = '22023';
  end if;
  if v_general_notes is not null and length(v_general_notes) > 3000 then
    raise exception 'General Notes must be 3000 characters or fewer.' using errcode = '22023';
  end if;

  for v_raft in select value from jsonb_array_elements(p_rafts)
  loop
    if jsonb_typeof(v_raft) <> 'object' then
      raise exception 'Each raft inspection must be an object.' using errcode = '22023';
    end if;
    select array_agg(key order by key)
    into v_unknown_keys
    from jsonb_object_keys(v_raft) key
    where key <> all(array_prepend('raft_number', v_allowed_fields));
    if v_unknown_keys is not null then
      raise exception 'Unsupported raft inspection fields: %', array_to_string(v_unknown_keys, ', ')
        using errcode = '22023';
    end if;

    begin
      v_raft_number := nullif(v_raft ->> 'raft_number', '')::integer;
    exception when others then
      raise exception 'Enter a valid raft number.' using errcode = '22023';
    end;
    if v_raft_number is null or v_raft_number < 1 or v_raft_number > 5 then
      raise exception 'Raft number must be between 1 and 5.' using errcode = '22023';
    end if;
    if v_raft_number = any(v_seen_rafts) then
      raise exception 'Each raft can appear only once.' using errcode = '22023';
    end if;
    v_seen_rafts := array_append(v_seen_rafts, v_raft_number);

    v_normalized_raft := jsonb_build_object('raft_number', v_raft_number);
    foreach v_field in array v_allowed_fields
    loop
      if nullif(trim(v_raft ->> v_field), '') is not null
         and length(trim(v_raft ->> v_field)) > 3000 then
        raise exception 'Each raft inspection response must be 3000 characters or fewer.'
          using errcode = '22023';
      end if;
      v_normalized_raft := v_normalized_raft || jsonb_build_object(
        v_field,
        nullif(trim(v_raft ->> v_field), '')
      );
    end loop;
    v_normalized_rafts := v_normalized_rafts || jsonb_build_array(v_normalized_raft);
  end loop;

  return jsonb_build_object(
    'record', jsonb_build_object(
      'inspection_date', v_inspection_date,
      'location', v_location,
      'recorded_by_name', v_recorded_by_name,
      'general_notes', v_general_notes
    ),
    'rafts', v_normalized_rafts
  );
end;
$$;


commit;
