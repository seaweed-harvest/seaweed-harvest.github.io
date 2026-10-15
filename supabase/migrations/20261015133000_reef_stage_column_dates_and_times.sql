begin;

-- Permit independent date/time values above each Sample Rope measurement
-- column while retaining per-rope historical dates and existing permissions.
-- Only changed measurements or explicitly edited stage dates/times receive
-- new attribution; other weeks and soft-deleted cycles are preserved.
create or replace function public.ag_reef_sample_rope_register_save_visit(
  p_site_code text, p_rows jsonb, p_visit jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_actor_id uuid := case when v_scope ->> 'access_mode' = 'authenticated'
    then (select auth.uid()) else null end;
  v_site_code text := upper(trim(p_site_code));
  v_unknown_keys text[];
  v_date date;
  v_time time;
  v_recorder text;
  v_team text;
  v_other text;
  v_rows jsonb;
  v_row jsonb;
  v_rope_number integer;
  v_old jsonb;
  v_current jsonb;
  v_before jsonb;
  v_provenance jsonb;
  v_visit_meta jsonb;
  v_change boolean;
  v_stage text;
  v_stage_spec jsonb;
  v_stage_date date;
  v_stage_time time;
  v_stage_edited boolean;
  v_invalid_stages text[];
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;
  if v_site_code is null or v_site_code = '' then
    raise exception 'Select a site.' using errcode = '22023';
  end if;
  if p_visit is null or jsonb_typeof(p_visit) <> 'object' then
    raise exception 'Recording date, recorder and monitoring team are required.'
      using errcode = '22023';
  end if;
  select array_agg(key order by key) into v_unknown_keys
  from jsonb_object_keys(p_visit) key
  where key <> all(array['date','time','recorder','team','other_team','stage_dates']::text[]);
  if v_unknown_keys is not null then
    raise exception 'Unsupported visit fields: %', array_to_string(v_unknown_keys, ', ')
      using errcode = '22023';
  end if;

  if coalesce(p_visit ->> 'time', '') <> ''
    and (p_visit ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Enter a valid optional monitoring time (HH:MM).'
      using errcode = '22023';
  end if;
  begin
    v_date := nullif(p_visit ->> 'date','')::date;
    v_time := nullif(p_visit ->> 'time','')::time;
  exception when others then
    raise exception 'Enter a valid monitoring date and optional time.'
      using errcode = '22023';
  end;
  v_recorder := nullif(trim(p_visit ->> 'recorder'), '');
  v_team := lower(nullif(trim(p_visit ->> 'team'), ''));
  v_other := nullif(trim(p_visit ->> 'other_team'), '');
  if v_date is null or v_recorder is null or length(v_recorder) > 160 then
    raise exception 'Recording date and recorder (up to 160 characters) are required.'
      using errcode = '22023';
  end if;
  if v_team is null or v_team not in ('reefolution','pik','community','other') then
    raise exception 'Select a valid monitoring team.' using errcode = '22023';
  end if;
  if v_team = 'other' then
    if v_other is null or length(v_other) > 160 then
      raise exception 'Enter the other monitoring team.' using errcode = '22023';
    end if;
  else
    v_other := null;
  end if;
  if p_visit ? 'stage_dates' then
    if jsonb_typeof(p_visit -> 'stage_dates') <> 'object' then
      raise exception 'Column dates must be an object.' using errcode='22023';
    end if;
    select array_agg(key order by key) into v_invalid_stages
    from jsonb_object_keys(p_visit -> 'stage_dates') key
    where key <> all(array['initial','week_2','week_4','week_6']::text[]);
    if v_invalid_stages is not null then
      raise exception 'Invalid Sample Rope measurement stage.' using errcode='22023';
    end if;
  end if;
  v_rows := public.ag_reef_sample_rope_rows_validate(p_rows);

  -- The existing saver shares this advisory lock. Capture before-values and
  -- apply updates within the same transaction, with per-stage attribution.
  perform pg_advisory_xact_lock(hashtextextended(
    v_aggregator_id::text || ':' || v_site_code, 0));
  select coalesce(jsonb_object_agg(c.rope_number::text, to_jsonb(c)), '{}'::jsonb)
  into v_before
  from public.ag_reef_sample_rope_cycles c
  where c.aggregator_id = v_aggregator_id and c.site_code = v_site_code
    and c.status = 'active' and c.deleted_at is null;

  perform public.ag_reef_sample_rope_save_internal(
    v_aggregator_id, v_site_code, v_rows, v_actor_id);

  -- Each measurement column has an independent date/time, including
  -- historical backfills. Existing RPC callers may still send the old
  -- single visit date and time; those remain the fallback.

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_rope_number := (v_row ->> 'rope_number')::integer;
    v_old := v_before -> v_rope_number::text;
    select to_jsonb(c) into v_current
    from public.ag_reef_sample_rope_cycles c
    where c.aggregator_id = v_aggregator_id and c.site_code = v_site_code
      and c.rope_number = v_rope_number and c.status = 'active'
      and c.deleted_at is null;
    if v_current is null then continue; end if;
    v_provenance := coalesce(v_current -> 'measurement_provenance', '{}'::jsonb);
    v_change := false;
    for v_stage in select unnest(array['initial','week_2','week_4','week_6']::text[])
    loop
      v_stage_spec := p_visit -> 'stage_dates' -> v_stage;
      if v_stage_spec is null then
        v_stage_date := v_date;
        v_stage_time := v_time;
        v_stage_edited := false;
      else
        if jsonb_typeof(v_stage_spec) <> 'object' then
          raise exception 'Invalid date/time for Sample Rope stage %.', v_stage using errcode='22023';
        end if;
        if coalesce(v_stage_spec ->> 'time','') <> ''
          and (v_stage_spec ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          raise exception 'Invalid optional time for Sample Rope stage %.', v_stage using errcode='22023';
        end if;
        begin
          v_stage_date := nullif(v_stage_spec ->> 'date','')::date;
          v_stage_time := nullif(v_stage_spec ->> 'time','')::time;
          v_stage_edited := coalesce((v_stage_spec ->> 'edited')::boolean,false);
        exception when others then
          raise exception 'Invalid date/time or edit flag for Sample Rope stage %.', v_stage using errcode='22023';
        end;
      end if;
      -- If a stage's header has mixed/blank historical values, preserve
      -- each existing rope's own date and time rather than assigning today's
      -- fallback to an unchanged stage.
      if v_stage_date is null then
        v_stage_date := coalesce(
          nullif(v_current ->> (case when v_stage = 'initial' then 'date_seeded' else v_stage || '_date' end), '')::date,
          nullif(v_current -> 'measurement_provenance' -> v_stage ->> 'date', '')::date,
          v_date);
      end if;
      if v_stage_time is null and not v_stage_edited then
        v_stage_time := nullif(v_current -> 'measurement_provenance' -> v_stage ->> 'time', '')::time;
      end if;
      v_visit_meta := jsonb_build_object(
        'date', v_stage_date, 'time', v_stage_time,
        'recorder', v_recorder, 'team', v_team, 'other_team', v_other,
        'saved_at', clock_timestamp()
      );
      if v_stage = 'initial' then
        if (v_old ->> 'species') is not distinct from (v_current ->> 'species')
          and (v_old ->> 'date_seeded') is not distinct from (v_current ->> 'date_seeded')
          and nullif(v_old ->> 'rope_weight_kg', '')::numeric
            is not distinct from nullif(v_current ->> 'rope_weight_kg', '')::numeric
          and nullif(v_old ->> 'initial_weight_kg', '')::numeric
            is not distinct from nullif(v_current ->> 'initial_weight_kg', '')::numeric
          and not (
            v_stage_edited
            and v_current ->> 'initial_weight_kg' is not null
            and (
              v_old -> 'measurement_provenance' -> 'initial' ->> 'date' is distinct from v_visit_meta ->> 'date'
              or v_old -> 'measurement_provenance' -> 'initial' ->> 'time' is distinct from v_visit_meta ->> 'time'
            )
          )
        then continue; end if;
        if v_current ->> 'species' is null and v_current ->> 'date_seeded' is null
          and v_current ->> 'rope_weight_kg' is null and v_current ->> 'initial_weight_kg' is null then
          v_provenance := v_provenance - 'initial';
        else
          v_provenance := jsonb_set(v_provenance, '{initial}', v_visit_meta, true);
        end if;
      else
        if nullif(v_old ->> (v_stage || '_kg'), '')::numeric
          is not distinct from nullif(v_current ->> (v_stage || '_kg'), '')::numeric
          and (v_old ->> (v_stage || '_date'))
            is not distinct from (v_current ->> (v_stage || '_date'))
          and not (
            v_stage_edited
            and v_current ->> (v_stage || '_kg') is not null
            and (
              v_old -> 'measurement_provenance' -> v_stage ->> 'date' is distinct from v_visit_meta ->> 'date'
              or v_old -> 'measurement_provenance' -> v_stage ->> 'time' is distinct from v_visit_meta ->> 'time'
            )
          )
        then continue;
        end if;
        if v_current ->> (v_stage || '_kg') is null then
          v_provenance := v_provenance - v_stage;
        else
          v_provenance := jsonb_set(v_provenance, array[v_stage], v_visit_meta, true);
        end if;
      end if;
      v_change := true;
    end loop;
    if v_change then
      update public.ag_reef_sample_rope_cycles c
      set measurement_provenance = v_provenance
      where c.id = (v_current ->> 'id')::uuid;
    end if;
  end loop;

  return public.ag_reef_sample_rope_register_internal(v_aggregator_id, v_site_code)
    || jsonb_build_object('saved_at', clock_timestamp());
end;
$$;
revoke all on function public.ag_reef_sample_rope_register_save_visit(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ag_reef_sample_rope_register_save_visit(text,jsonb,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
