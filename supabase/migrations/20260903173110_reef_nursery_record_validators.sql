begin;

create or replace function public.ag_reef_seaweed_workspace_validate_draft(
  p_record jsonb,
  p_units jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_unknown_keys text[];
  v_record_date date;
  v_location text;
  v_recorded_by_name text;
  v_unit jsonb;
  v_unit_code text;
  v_species text;
  v_line_count integer;
  v_health text;
  v_seed_weight numeric;
  v_seed_unit text;
  v_harvest_weight numeric;
  v_harvest_unit text;
  v_notes text;
  v_seen_units text[] := '{}'::text[];
  v_normalized_units jsonb := '[]'::jsonb;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Seaweed Record details must be an object.' using errcode = '22023';
  end if;
  if p_units is null
     or jsonb_typeof(p_units) <> 'array'
     or jsonb_array_length(p_units) > 7 then
    raise exception 'Seaweed Record units must be an array of no more than 7 rows.'
      using errcode = '22023';
  end if;

  select array_agg(key order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_record) key
  where key <> all(array['record_date', 'location', 'recorded_by_name']::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported Seaweed Record fields: %', array_to_string(v_unknown_keys, ', ')
      using errcode = '22023';
  end if;

  begin
    v_record_date := nullif(p_record ->> 'record_date', '')::date;
  exception when others then
    raise exception 'Enter a valid Seaweed Record date.' using errcode = '22023';
  end;
  v_location := lower(nullif(trim(p_record ->> 'location'), ''));
  v_recorded_by_name := nullif(trim(p_record ->> 'recorded_by_name'), '');
  if v_location is not null
     and v_location not in ('tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore') then
    raise exception 'Select a valid Seaweed Record location.' using errcode = '22023';
  end if;
  if v_recorded_by_name is not null and length(v_recorded_by_name) > 160 then
    raise exception 'Person filling the form must be 160 characters or fewer.' using errcode = '22023';
  end if;

  for v_unit in select value from jsonb_array_elements(p_units)
  loop
    if jsonb_typeof(v_unit) <> 'object' then
      raise exception 'Each Seaweed Record unit must be an object.' using errcode = '22023';
    end if;
    select array_agg(key order by key)
    into v_unknown_keys
    from jsonb_object_keys(v_unit) key
    where key <> all(array[
      'unit_code', 'species', 'line_count', 'seaweed_health',
      'seed_weight_value', 'seed_weight_unit',
      'harvest_weight_value', 'harvest_weight_unit',
      'notes_equipment_replaced'
    ]::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported Seaweed unit fields: %', array_to_string(v_unknown_keys, ', ')
        using errcode = '22023';
    end if;

    v_unit_code := lower(nullif(trim(v_unit ->> 'unit_code'), ''));
    v_species := lower(nullif(trim(v_unit ->> 'species'), ''));
    v_health := nullif(trim(v_unit ->> 'seaweed_health'), '');
    v_seed_unit := coalesce(lower(nullif(trim(v_unit ->> 'seed_weight_unit'), '')), 'kg');
    v_harvest_unit := coalesce(lower(nullif(trim(v_unit ->> 'harvest_weight_unit'), '')), 'kg');
    v_notes := nullif(trim(v_unit ->> 'notes_equipment_replaced'), '');
    begin
      v_line_count := nullif(v_unit ->> 'line_count', '')::integer;
      v_seed_weight := nullif(v_unit ->> 'seed_weight_value', '')::numeric;
      v_harvest_weight := nullif(v_unit ->> 'harvest_weight_value', '')::numeric;
    exception when others then
      raise exception 'Enter valid line counts and weights.' using errcode = '22023';
    end;

    if v_unit_code is null
       or v_unit_code not in (
         'raft_1', 'raft_2', 'raft_3', 'raft_4', 'raft_5',
         'mkwiro_farm', 'tumbe_farm'
       ) then
      raise exception 'Select valid Reef Nursery rafts or farms.' using errcode = '22023';
    end if;
    if v_unit_code = any(v_seen_units) then
      raise exception 'Each raft or farm can appear only once.' using errcode = '22023';
    end if;
    v_seen_units := array_append(v_seen_units, v_unit_code);

    if v_location in ('tumbe_offshore', 'mkwiro_offshore')
       and v_unit_code not in ('raft_1', 'raft_2', 'raft_3', 'raft_4', 'raft_5') then
      raise exception 'Offshore Seaweed Records can use Raft #1 through Raft #5.' using errcode = '22023';
    end if;
    if v_location = 'mkwiro_shore' and v_unit_code <> 'mkwiro_farm' then
      raise exception 'Mkwiro Shore Seaweed Records use Mkwiro Farm.' using errcode = '22023';
    end if;
    if v_location = 'tumbe_shore' and v_unit_code <> 'tumbe_farm' then
      raise exception 'Tumbe Shore Seaweed Records use Tumbe Farm.' using errcode = '22023';
    end if;

    if v_species is not null and v_species not in ('spinosum', 'cottonii') then
      raise exception 'Select Spinosum or Cottonii for each entered unit.' using errcode = '22023';
    end if;
    if v_line_count is not null and (v_line_count < 0 or v_line_count > 10000) then
      raise exception 'Number of lines is outside the allowed range.' using errcode = '22023';
    end if;
    if v_seed_weight is not null and (v_seed_weight < 0 or v_seed_weight > 100000) then
      raise exception 'Seed total weight is outside the allowed range.' using errcode = '22023';
    end if;
    if v_harvest_weight is not null and (v_harvest_weight < 0 or v_harvest_weight > 100000) then
      raise exception 'Harvest total weight is outside the allowed range.' using errcode = '22023';
    end if;
    if v_seed_unit not in ('kg', 'g') or v_harvest_unit not in ('kg', 'g') then
      raise exception 'Select kg or g for Seaweed Record weights.' using errcode = '22023';
    end if;
    if v_health is not null and length(v_health) > 500 then
      raise exception 'Seaweed health must be 500 characters or fewer.' using errcode = '22023';
    end if;
    if v_notes is not null and length(v_notes) > 1000 then
      raise exception 'Notes / Equipment Replaced must be 1000 characters or fewer.' using errcode = '22023';
    end if;

    v_normalized_units := v_normalized_units || jsonb_build_array(
      jsonb_build_object(
        'unit_code', v_unit_code,
        'species', v_species,
        'line_count', v_line_count,
        'seaweed_health', v_health,
        'seed_weight_value', v_seed_weight,
        'seed_weight_unit', v_seed_unit,
        'harvest_weight_value', v_harvest_weight,
        'harvest_weight_unit', v_harvest_unit,
        'notes_equipment_replaced', v_notes
      )
    );
  end loop;

  return jsonb_build_object(
    'record', jsonb_build_object(
      'record_date', v_record_date,
      'location', v_location,
      'recorded_by_name', v_recorded_by_name
    ),
    'units', v_normalized_units
  );
end;
$$;

create or replace function public.ag_reef_inspection_workspace_validate(
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
  v_overall text;
  v_lines text;
  v_hdpe text;
  v_rigging text;
  v_components text;
  v_anchors text;
  v_attachment_points text;
  v_seen_rafts integer[] := '{}'::integer[];
  v_normalized_rafts jsonb := '[]'::jsonb;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Inspection details must be an object.' using errcode = '22023';
  end if;
  if p_rafts is null
     or jsonb_typeof(p_rafts) <> 'array'
     or jsonb_array_length(p_rafts) < 1
     or jsonb_array_length(p_rafts) > 5 then
    raise exception 'Select between 1 and 5 rafts.' using errcode = '22023';
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

  if v_inspection_date is null then
    raise exception 'Inspection date is required.' using errcode = '22023';
  end if;
  if v_location is null
     or v_location not in ('tumbe_shore', 'tumbe_offshore', 'mkwiro_shore', 'mkwiro_offshore') then
    raise exception 'Select a valid Reef Nursery location.' using errcode = '22023';
  end if;
  if v_recorded_by_name is null or length(v_recorded_by_name) > 160 then
    raise exception 'Person filling the form is required and must be 160 characters or fewer.'
      using errcode = '22023';
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
    where key <> all(array[
      'raft_number', 'overall_position_condition', 'seaweed_lines_attachments',
      'hdpe_floating_frame', 'rigging_harness', 'mooring_components',
      'mooring_anchors', 'mooring_attachment_points'
    ]::text[]);
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

    v_overall := nullif(trim(v_raft ->> 'overall_position_condition'), '');
    v_lines := nullif(trim(v_raft ->> 'seaweed_lines_attachments'), '');
    v_hdpe := nullif(trim(v_raft ->> 'hdpe_floating_frame'), '');
    v_rigging := nullif(trim(v_raft ->> 'rigging_harness'), '');
    v_components := nullif(trim(v_raft ->> 'mooring_components'), '');
    v_anchors := nullif(trim(v_raft ->> 'mooring_anchors'), '');
    v_attachment_points := nullif(trim(v_raft ->> 'mooring_attachment_points'), '');

    if greatest(
      coalesce(length(v_overall), 0), coalesce(length(v_lines), 0),
      coalesce(length(v_hdpe), 0), coalesce(length(v_rigging), 0),
      coalesce(length(v_components), 0), coalesce(length(v_anchors), 0),
      coalesce(length(v_attachment_points), 0)
    ) > 3000 then
      raise exception 'Each raft inspection response must be 3000 characters or fewer.'
        using errcode = '22023';
    end if;
    if num_nonnulls(
      v_overall, v_lines, v_hdpe, v_rigging,
      v_components, v_anchors, v_attachment_points
    ) = 0 then
      raise exception 'Enter at least one observation for Raft #%.', v_raft_number
        using errcode = '22023';
    end if;

    v_normalized_rafts := v_normalized_rafts || jsonb_build_array(
      jsonb_build_object(
        'raft_number', v_raft_number,
        'overall_position_condition', v_overall,
        'seaweed_lines_attachments', v_lines,
        'hdpe_floating_frame', v_hdpe,
        'rigging_harness', v_rigging,
        'mooring_components', v_components,
        'mooring_anchors', v_anchors,
        'mooring_attachment_points', v_attachment_points
      )
    );
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
