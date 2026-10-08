begin;

-- Physical carton identity follows the stock event, not its printed serial.
alter table public.ag_stabilization_stock_actions
  add column if not exists carton_instance_id uuid;
-- One-time backfill of an existing immutable log. Restore the guard within
-- this same transaction, before application access can resume.
drop trigger if exists ag_stabilization_stock_actions_immutable
  on public.ag_stabilization_stock_actions;
update public.ag_stabilization_stock_actions action
set carton_instance_id = record.carton_instance_id
from public.ag_stabilization_packing_records record
where record.id = action.source_record_id
  and action.carton_instance_id is null;
create trigger ag_stabilization_stock_actions_immutable
before update or delete on public.ag_stabilization_stock_actions
for each row execute function public.ag_reject_stabilization_stock_action_mutation();
alter table public.ag_stabilization_stock_actions
  alter column carton_instance_id set not null;
create index if not exists ag_stabilization_stock_action_instance_idx
  on public.ag_stabilization_stock_actions
  (aggregator_id, carton_instance_id, action_sequence desc);

-- One row per requested numeric label, with ALL physical candidates retained.
-- Only one ACTIVE candidate is auto-selected. Otherwise an explicit UUID is required.
create or replace function public.ag_preview_stabilization_stock_removal_with_selection(
  p_first_carton_serial text,
  p_last_carton_serial text,
  p_selected_cartons jsonb
)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_first_text text := nullif(trim(p_first_carton_serial),'');
  v_last_text text := coalesce(nullif(trim(p_last_carton_serial),''),v_first_text);
  v_first bigint;
  v_last bigint;
  v_width integer;
  v_selection jsonb := coalesce(p_selected_cartons, '{}'::jsonb);
  v_result jsonb;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability('form_stock_record');
  perform public.ag_validate_stabilization_stock_range(v_first_text,v_last_text);
  v_first := v_first_text::bigint;
  v_last := v_last_text::bigint;
  v_width := greatest(length(v_first_text),length(v_last_text));
  if jsonb_typeof(v_selection) <> 'object' then
    raise exception 'Carton selections must be an object keyed by carton number.'
      using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_each_text(v_selection) sel
    where sel.key !~ '^(0|[1-9][0-9]{0,17})$'
      or sel.key::numeric not between v_first and v_last
      or sel.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Carton selections must reference valid physical IDs within the requested range.'
      using errcode='22023';
  end if;

  with requested as (
    select n as serial_number,
      lpad(n::text,v_width,'0') as requested_serial,
      v_selection ->> n::text as selected_instance
    from generate_series(v_first,v_last) as series(n)
  ),
  last_tests as (
    select distinct on (record.carton_instance_id)
      record.carton_instance_id, record.carton_serial, record.id,
      record.packed_on, record.species, record.weight_value,
      record.weight_unit, record.recorded_by_name, record.created_at
    from public.ag_stabilization_packing_records record
    where record.aggregator_id=v_aggregator_id
      and record.carton_serial::numeric between v_first and v_last
    order by record.carton_instance_id,
      record.test_sequence desc, record.created_at desc, record.id desc
  ),
  candidates as (
    select req.serial_number, last_tests.carton_instance_id,
      last_tests.carton_serial, last_tests.id as source_record_id,
      last_tests.packed_on as latest_test_date,
      last_tests.species, last_tests.recorded_by_name,
      (select min(original.packed_on)
       from public.ag_stabilization_packing_records original
       where original.aggregator_id=v_aggregator_id
         and original.carton_instance_id=last_tests.carton_instance_id) as first_packed_on,
      (select count(*)::integer
       from public.ag_stabilization_packing_records history
       where history.aggregator_id=v_aggregator_id
         and history.carton_instance_id=last_tests.carton_instance_id) as test_count,
      case when last_tests.weight_unit='L' then last_tests.weight_value
           when last_tests.weight_unit='mL' then last_tests.weight_value/1000.0
           else null end as volume_l,
      latest_action.action_type as latest_action_type,
      latest_action.action_date as latest_action_date,
      latest_action.reason_code as latest_reason_code
    from requested req
    join last_tests on last_tests.carton_serial::numeric=req.serial_number
    left join lateral (
      select action.action_type,action.action_date,action.reason_code
      from public.ag_stabilization_stock_actions action
      where action.aggregator_id=v_aggregator_id
        and action.carton_instance_id=last_tests.carton_instance_id
      order by action.action_sequence desc,action.created_at desc
      limit 1
    ) latest_action on true
  ),
  bucket as (
    select req.serial_number,req.requested_serial,req.selected_instance,
      count(c.carton_instance_id)::integer as physical_count,
      count(c.carton_instance_id) filter (
        where c.latest_action_type is distinct from 'removal'
      )::integer as active_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'carton_instance_id',c.carton_instance_id,
        'carton_serial',c.carton_serial,
        'first_packed_on',c.first_packed_on,
        'latest_test_date',c.latest_test_date,
        'volume_l',round(c.volume_l,3),
        'species',c.species,
        'test_count',c.test_count,
        'recorded_by_name',c.recorded_by_name,
        'status',case
          when c.latest_action_type='removal' then 'inactive'
          when c.volume_l is null then 'unsupported_volume'
          else 'ready' end
      ) order by c.first_packed_on,c.carton_instance_id)
      filter (where c.carton_instance_id is not null),'[]'::jsonb) as candidates
    from requested req
    left join candidates c on c.serial_number=req.serial_number
    group by req.serial_number,req.requested_serial,req.selected_instance
  ),
  resolved as (
    select bucket.*, chosen.carton_instance_id,chosen.carton_serial,
      chosen.source_record_id,chosen.species,chosen.volume_l,
      chosen.test_count,chosen.latest_test_date,chosen.latest_action_type,
      chosen.latest_action_date,chosen.latest_reason_code,
      case
        when bucket.physical_count=0 then 'missing'
        when bucket.selected_instance is not null and chosen.carton_instance_id is null
          then 'invalid_selection'
        when bucket.selected_instance is null and bucket.active_count>1
          then 'ambiguous'
        when bucket.active_count=0 or chosen.latest_action_type='removal'
          then 'inactive'
        when chosen.volume_l is null then 'unsupported_volume'
        when chosen.carton_instance_id is null then 'ambiguous'
        else 'ready'
      end as status
    from bucket
    left join lateral (
      select c.* from candidates c
      where c.serial_number=bucket.serial_number
        and (
          (bucket.selected_instance is not null
            and c.carton_instance_id::text=bucket.selected_instance)
          or (bucket.selected_instance is null and bucket.active_count=1
            and c.latest_action_type is distinct from 'removal')
        )
      order by c.first_packed_on,c.carton_instance_id
      limit 1
    ) chosen on true
  )
  select jsonb_build_object(
    'first_carton_serial',v_first_text,'last_carton_serial',v_last_text,
    'requested_count',v_last-v_first+1,
    'valid',coalesce(bool_and(status='ready'),false),
    'total_litres',round(coalesce(sum(volume_l) filter (where status='ready'),0),3),
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'requested_serial',requested_serial,
      'carton_serial',carton_serial,
      'carton_instance_id',carton_instance_id,
      'selected_instance_id',selected_instance,
      'physical_count',physical_count,'active_count',active_count,
      'candidates',candidates,
      'status',status,'source_record_id',source_record_id,
      'species',species,'volume_l',round(volume_l,3),
      'test_count',test_count,'latest_test_date',latest_test_date,
      'latest_action_type',latest_action_type,
      'latest_action_date',latest_action_date,
      'latest_action_reason',
        public.ag_stabilization_removal_reason_label(latest_reason_code)
    ) order by serial_number),'[]'::jsonb)
  ) into v_result from resolved;
  return v_result;
end;
$$;

-- Existing unselected preview RPC stays compatible; duplicate active cartons
-- are still rejected when no physical ID is supplied.
create or replace function public.ag_preview_stabilization_stock_removal_validated_core_v1(
  p_first_carton_serial text,
  p_last_carton_serial text default null
)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
begin
  return public.ag_preview_stabilization_stock_removal_with_selection(
    p_first_carton_serial,p_last_carton_serial,'{}'::jsonb);
end;
$$;

-- Atomically re-check physical selection while holding the stock-action lock.
-- Never rely on a client preview as proof that a carton is still active.
create or replace function public.ag_remove_stabilization_stock_with_selection(
  p_action_group_id uuid,
  p_first_carton_serial text,
  p_last_carton_serial text,
  p_action_date date,
  p_reason_code text,
  p_note text,
  p_selected_cartons jsonb
)
returns jsonb language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_profile public.ag_user_profiles%rowtype;
  v_aggregator_id uuid;
  v_date date := coalesce(p_action_date,(now() at time zone 'Africa/Nairobi')::date);
  v_note text := nullif(trim(p_note),'');
  v_first text := nullif(trim(p_first_carton_serial),'');
  v_last text := coalesce(nullif(trim(p_last_carton_serial),''),v_first);
  v_selections jsonb := coalesce(p_selected_cartons,'{}'::jsonb);
  v_count integer;
  v_existing_count integer;
  v_preview jsonb;
  v_item jsonb;
  v_sequence integer;
  v_result jsonb;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability('form_stock_record');
  perform public.ag_validate_stabilization_stock_range(v_first,v_last);
  v_count := (v_last::bigint-v_first::bigint+1)::integer;
  if p_action_group_id is null then
    raise exception 'Stock action group ID is required.' using errcode='22023';
  end if;
  if p_reason_code is null or p_reason_code not in (
    'sold_dispatched','quality_rejected','damaged_leaking',
    'testing_samples','missing_inventory','other'
  ) then
    raise exception 'Select a valid removal reason.' using errcode='22023';
  end if;
  if v_date > (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Removal date cannot be in the future.' using errcode='22023';
  end if;
  if v_note is not null and length(v_note)>1000 then
    raise exception 'Removal note must be 1000 characters or fewer.' using errcode='22023';
  end if;
  select * into v_profile from public.ag_user_profiles
  where id=v_actor_id and account_status='active';
  if not found then
    raise exception 'An active user profile is required.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'ag_stabilization_stock_actions:'||v_aggregator_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'ag_stabilization_carton:'||v_aggregator_id::text,0));

  -- Validate selections even on replay, then enforce immutable group identity.
  if jsonb_typeof(v_selections)<>'object' or exists (
    select 1 from jsonb_each_text(v_selections) sel
    where sel.key !~ '^(0|[1-9][0-9]{0,17})$'
       or sel.key::numeric not between v_first::bigint and v_last::bigint
       or sel.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid carton selections.' using errcode='22023';
  end if;

  select count(*)::integer into v_existing_count
  from public.ag_stabilization_stock_actions action
  where action.action_group_id=p_action_group_id;
  if v_existing_count>0 then
    if v_existing_count<>v_count
      or (select count(distinct action.carton_serial::numeric)
          from public.ag_stabilization_stock_actions action
          where action.action_group_id=p_action_group_id)<>v_count
      or (select min(action.carton_serial::numeric)
          from public.ag_stabilization_stock_actions action
          where action.action_group_id=p_action_group_id)<>v_first::bigint
      or (select max(action.carton_serial::numeric)
          from public.ag_stabilization_stock_actions action
          where action.action_group_id=p_action_group_id)<>v_last::bigint
      or exists (
      select 1 from public.ag_stabilization_stock_actions action
      where action.action_group_id=p_action_group_id and (
        action.aggregator_id<>v_aggregator_id or action.action_type<>'removal'
        or action.reason_code<>p_reason_code
        or action.note is distinct from v_note
        or (p_action_date is not null and action.action_date<>v_date)
        or action.carton_serial::numeric not between v_first::bigint and v_last::bigint
        or (v_selections ? coalesce(nullif(ltrim(action.carton_serial,'0'),''),'0')
          and action.carton_instance_id::text <>
              v_selections ->> coalesce(nullif(ltrim(action.carton_serial,'0'),''),'0'))
      )
    ) then
      raise exception 'Stock action group ID is already in use for another selection.'
        using errcode='23505';
    end if;
    select jsonb_build_object(
      'duplicate',true,'action_group_id',p_action_group_id,
      'action_type','removal','action_date',min(action.action_date),
      'carton_count',count(*),'total_litres',round(sum(action.volume_l),3),
      'cartons',jsonb_agg(action.carton_serial order by action.carton_serial::numeric),
      'carton_instance_ids',jsonb_agg(action.carton_instance_id order by action.carton_serial::numeric)
    ) into v_result from public.ag_stabilization_stock_actions action
    where action.action_group_id=p_action_group_id
      and action.aggregator_id=v_aggregator_id;
    return v_result;
  end if;

  v_preview := public.ag_preview_stabilization_stock_removal_with_selection(
    v_first,v_last,v_selections);
  if not coalesce((v_preview->>'valid')::boolean,false) then
    raise exception 'Review carton selection: %',
      (select string_agg(
        format('%s: %s',item->>'requested_serial',item->>'status'),', '
        order by item->>'requested_serial')
       from jsonb_array_elements(v_preview->'rows') item
       where item->>'status'<>'ready')
       using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_preview->'rows') item
    where (item->>'latest_test_date')::date > v_date
  ) then
    raise exception 'Removal date cannot be before the latest stored carton record.'
      using errcode='22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_preview->'rows') loop
    select coalesce(max(action.action_sequence),0)+1 into v_sequence
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id=v_aggregator_id
      and action.carton_serial=v_item->>'carton_serial';
    insert into public.ag_stabilization_stock_actions (
      action_group_id,aggregator_id,carton_serial,carton_instance_id,
      action_sequence,action_type,action_date,reason_code,note,
      source_record_id,species,volume_l,actor_user_id,actor_name
    ) values (
      p_action_group_id,v_aggregator_id,v_item->>'carton_serial',
      (v_item->>'carton_instance_id')::uuid,
      v_sequence,'removal',v_date,p_reason_code,v_note,
      (v_item->>'source_record_id')::uuid,
      v_item->>'species',(v_item->>'volume_l')::numeric,
      v_actor_id,coalesce(nullif(trim(v_profile.display_name),''),
        nullif(trim(v_profile.email),''),'Signed-in user')
    );
  end loop;

  insert into public.ag_audit_log (
    actor_user_id,actor_email,action,target_type,target_id,details
  ) values (
    v_actor_id,v_profile.email,'stabilization_stock_removed',
    'stabilization_stock_action_group',p_action_group_id::text,
    jsonb_build_object(
      'aggregator_id',v_aggregator_id,'action_date',v_date,
      'reason_code',p_reason_code,'note',v_note,
      'carton_count',v_count,'total_litres',v_preview->'total_litres',
      'rows',v_preview->'rows')
  );
  return jsonb_build_object(
    'duplicate',false,'action_group_id',p_action_group_id,
    'action_type','removal','action_date',v_date,'reason_code',p_reason_code,
    'carton_count',v_count,'total_litres',v_preview->'total_litres',
    'cartons',(select jsonb_agg(item->>'carton_serial' order by item->>'requested_serial')
      from jsonb_array_elements(v_preview->'rows') item),
    'carton_instance_ids',(select jsonb_agg(item->>'carton_instance_id' order by item->>'requested_serial')
      from jsonb_array_elements(v_preview->'rows') item)
  );
end;
$$;

-- Preserve the old RPC signature for existing users and integrations while
-- enforcing the same instance-aware checks for all removal paths.
create or replace function public.ag_remove_stabilization_stock_validated_core_v1(
  p_action_group_id uuid,p_first_carton_serial text,
  p_last_carton_serial text default null,p_action_date date default null,
  p_reason_code text default null,p_note text default null
)
returns jsonb language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
begin
  return public.ag_remove_stabilization_stock_with_selection(
    p_action_group_id,p_first_carton_serial,p_last_carton_serial,
    p_action_date,p_reason_code,p_note,'{}'::jsonb);
end;
$$;

revoke all on function public.ag_preview_stabilization_stock_removal_with_selection(text,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.ag_remove_stabilization_stock_with_selection(uuid,text,text,date,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.ag_preview_stabilization_stock_removal_with_selection(text,text,jsonb)
  to authenticated;
grant execute on function public.ag_remove_stabilization_stock_with_selection(uuid,text,text,date,text,text,jsonb)
  to authenticated;


-- Restoration must follow the removal's exact physical carton, not its label.
create or replace function public.ag_restore_stabilization_stock(
  p_restoration_group_id uuid,
  p_removal_group_id uuid,
  p_action_date date default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_profile public.ag_user_profiles%rowtype;
  v_aggregator_id uuid;
  v_action_date date := coalesce(
    p_action_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_reason text := nullif(trim(p_reason), '');
  v_existing_count integer;
  v_removal_count integer;
  v_removal public.ag_stabilization_stock_actions%rowtype;
  v_latest_id uuid;
  v_sequence integer;
  v_result jsonb;
begin
  perform public.ag_require_permission('can_edit_collections');
  v_aggregator_id := public.ag_require_organisation_capability(
    'form_stock_record'
  );

  if p_restoration_group_id is null or p_removal_group_id is null then
    raise exception 'Removal and restoration group IDs are required.'
      using errcode = '22023';
  end if;
  if p_restoration_group_id = p_removal_group_id then
    raise exception 'Restoration group ID must differ from the removal group ID.'
      using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A restoration reason is required.' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'Restoration reason must be 1000 characters or fewer.'
      using errcode = '22023';
  end if;
  if v_action_date > (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Restoration date cannot be in the future.'
      using errcode = '22023';
  end if;

  select * into v_profile
  from public.ag_user_profiles
  where id = v_actor_id
    and account_status = 'active';
  if not found then
    raise exception 'An active user profile is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ag_stabilization_stock_actions:' || v_aggregator_id::text,
    0
  ));

  select count(*)::integer
  into v_existing_count
  from public.ag_stabilization_stock_actions action
  where action.action_group_id = p_restoration_group_id;

  if v_existing_count > 0 then
    if exists (
      select 1
      from public.ag_stabilization_stock_actions action
      left join public.ag_stabilization_stock_actions original
        on original.id = action.reverses_action_id
      where action.action_group_id = p_restoration_group_id
        and (
          action.aggregator_id <> v_aggregator_id
          or action.action_type <> 'restoration'
          or action.note is distinct from v_reason
          or (p_action_date is not null and action.action_date <> v_action_date)
          or original.aggregator_id is distinct from v_aggregator_id
          or original.action_type is distinct from 'removal'
          or original.action_group_id is distinct from p_removal_group_id
        )
    ) then
      raise exception 'Stock action group ID is already in use for another restoration.'
        using errcode = '23505';
    end if;

    if v_existing_count <> (
      select count(*)::integer
      from public.ag_stabilization_stock_actions original
      where original.aggregator_id = v_aggregator_id
        and original.action_group_id = p_removal_group_id
        and original.action_type = 'removal'
    ) then
      raise exception 'Restoration action group does not match the complete removal group.'
        using errcode = '23505';
    end if;

    select jsonb_build_object(
      'duplicate', true,
      'action_group_id', p_restoration_group_id,
      'action_type', 'restoration',
      'restores_group_id', p_removal_group_id,
      'action_date', min(action.action_date),
      'carton_count', count(*),
      'total_litres', round(sum(action.volume_l), 3),
      'cartons', jsonb_agg(
        action.carton_serial
        order by action.carton_serial::numeric, action.carton_serial
      )
    )
    into v_result
    from public.ag_stabilization_stock_actions action
    where action.action_group_id = p_restoration_group_id
      and action.aggregator_id = v_aggregator_id;
    return v_result;
  end if;

  select count(*)::integer
  into v_removal_count
  from public.ag_stabilization_stock_actions action
  where action.aggregator_id = v_aggregator_id
    and action.action_group_id = p_removal_group_id
    and action.action_type = 'removal';

  if v_removal_count < 1 then
    raise exception 'The removal group was not found.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
      and action.action_group_id = p_removal_group_id
      and action.action_type = 'removal'
      and action.action_date > v_action_date
  ) then
    raise exception 'Restoration date cannot be before the removal date.'
      using errcode = '22023';
  end if;

  for v_removal in
    select action.*
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
      and action.action_group_id = p_removal_group_id
      and action.action_type = 'removal'
    order by action.carton_serial::numeric, action.carton_serial
  loop
    select action.id
    into v_latest_id
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
      and action.carton_instance_id = v_removal.carton_instance_id
    order by action.action_sequence desc
    limit 1;

    if v_latest_id is distinct from v_removal.id then
      raise exception 'Carton % is no longer inactive under this removal group.',
        v_removal.carton_serial
        using errcode = '23514';
    end if;

    select coalesce(max(action.action_sequence), 0) + 1
    into v_sequence
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
      and action.carton_serial = v_removal.carton_serial;

    insert into public.ag_stabilization_stock_actions (
      action_group_id,
      aggregator_id,
      carton_serial,
      carton_instance_id,
      action_sequence,
      action_type,
      action_date,
      reason_code,
      note,
      source_record_id,
      species,
      volume_l,
      actor_user_id,
      actor_name,
      reverses_action_id
    ) values (
      p_restoration_group_id,
      v_aggregator_id,
      v_removal.carton_serial,
      v_removal.carton_instance_id,
      v_sequence,
      'restoration',
      v_action_date,
      null,
      v_reason,
      v_removal.source_record_id,
      v_removal.species,
      v_removal.volume_l,
      v_actor_id,
      coalesce(
        nullif(trim(v_profile.display_name), ''),
        nullif(trim(v_profile.email), ''),
        'Signed-in user'
      ),
      v_removal.id
    );
  end loop;

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_actor_id,
    v_profile.email,
    'stabilization_stock_restored',
    'stabilization_stock_action_group',
    p_restoration_group_id::text,
    jsonb_build_object(
      'aggregator_id', v_aggregator_id,
      'restores_group_id', p_removal_group_id,
      'action_date', v_action_date,
      'reason', v_reason,
      'carton_count', v_removal_count
    )
  );

  select jsonb_build_object(
    'duplicate', false,
    'action_group_id', p_restoration_group_id,
    'action_type', 'restoration',
    'restores_group_id', p_removal_group_id,
    'action_date', min(action.action_date),
    'reason', v_reason,
    'carton_count', count(*),
    'total_litres', round(sum(action.volume_l), 3),
    'cartons', jsonb_agg(
      action.carton_serial
      order by action.carton_serial::numeric, action.carton_serial
    )
  )
  into v_result
  from public.ag_stabilization_stock_actions action
  where action.action_group_id = p_restoration_group_id
    and action.aggregator_id = v_aggregator_id;

  return v_result;
end;
$$;


-- A removal group's restore button is current only if each chosen carton is still removed.
create or replace function public.ag_stabilization_stock_action_ledger(
  p_start_date date default null,
  p_end_date date default null,
  p_search text default null,
  p_page_limit integer default 50,
  p_page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_start date := coalesce(
    p_start_date,
    (now() at time zone 'Africa/Nairobi')::date - 29
  );
  v_end date := coalesce(
    p_end_date,
    (now() at time zone 'Africa/Nairobi')::date
  );
  v_search text := nullif(trim(p_search), '');
  v_limit integer := least(greatest(coalesce(p_page_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_page_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  perform public.ag_require_permission('can_view_data');
  v_aggregator_id := public.ag_require_organisation_capability(
    'form_stock_record'
  );

  if v_end < v_start then
    raise exception 'End date must be on or after start date.'
      using errcode = '22023';
  end if;

  with latest_actions as (
    select distinct on (action.carton_instance_id)
      action.carton_instance_id,
      action.id
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
    order by action.carton_instance_id, action.action_sequence desc
  ),
  grouped as (
    select
      action.action_group_id,
      action.action_type,
      action.action_date,
      min(action.reason_code) as reason_code,
      max(action.note) as note,
      max(action.actor_name) as actor_name,
      min(action.created_at) as recorded_at,
      (array_agg(
        action.carton_serial
        order by action.carton_serial::numeric, action.carton_serial
      ))[1] as first_carton,
      (array_agg(
        action.carton_serial
        order by action.carton_serial::numeric desc, action.carton_serial desc
      ))[1] as last_carton,
      jsonb_agg(
        action.carton_serial
        order by action.carton_serial::numeric, action.carton_serial
      ) as carton_list,
      count(*)::integer as carton_count,
      round(sum(action.volume_l), 3) as total_litres,
      string_agg(distinct action.species, ', ' order by action.species) as species_summary,
      bool_and(latest.id = action.id) as is_current_group,
      min(original.action_group_id::text) as restores_group_id
    from public.ag_stabilization_stock_actions action
    join latest_actions latest
      on latest.carton_instance_id = action.carton_instance_id
    left join public.ag_stabilization_stock_actions original
      on original.id = action.reverses_action_id
      and original.aggregator_id = v_aggregator_id
    where action.aggregator_id = v_aggregator_id
      and action.action_date between v_start and v_end
    group by
      action.action_group_id,
      action.action_type,
      action.action_date
  ),
  filtered as (
    select grouped.*
    from grouped
    where v_search is null
      or grouped.action_group_id::text ilike '%' || v_search || '%'
      or grouped.action_type ilike '%' || v_search || '%'
      or coalesce(grouped.note, '') ilike '%' || v_search || '%'
      or grouped.actor_name ilike '%' || v_search || '%'
      or grouped.species_summary ilike '%' || v_search || '%'
      or coalesce(
        public.ag_stabilization_removal_reason_label(grouped.reason_code),
        ''
      ) ilike '%' || v_search || '%'
      or exists (
        select 1
        from public.ag_stabilization_stock_actions item
        where item.aggregator_id = v_aggregator_id
          and item.action_group_id = grouped.action_group_id
          and item.carton_serial ilike '%' || v_search || '%'
      )
  )
  select count(*)
  into v_total
  from filtered;

  with latest_actions as (
    select distinct on (action.carton_instance_id)
      action.carton_instance_id,
      action.id
    from public.ag_stabilization_stock_actions action
    where action.aggregator_id = v_aggregator_id
    order by action.carton_instance_id, action.action_sequence desc
  ),
  grouped as (
    select
      action.action_group_id,
      action.action_type,
      action.action_date,
      min(action.reason_code) as reason_code,
      max(action.note) as note,
      max(action.actor_name) as actor_name,
      min(action.created_at) as recorded_at,
      (array_agg(
        action.carton_serial
        order by action.carton_serial::numeric, action.carton_serial
      ))[1] as first_carton,
      (array_agg(
        action.carton_serial
        order by action.carton_serial::numeric desc, action.carton_serial desc
      ))[1] as last_carton,
      jsonb_agg(
        action.carton_serial
        order by action.carton_serial::numeric, action.carton_serial
      ) as carton_list,
      count(*)::integer as carton_count,
      round(sum(action.volume_l), 3) as total_litres,
      string_agg(distinct action.species, ', ' order by action.species) as species_summary,
      bool_and(latest.id = action.id) as is_current_group,
      min(original.action_group_id::text) as restores_group_id
    from public.ag_stabilization_stock_actions action
    join latest_actions latest
      on latest.carton_instance_id = action.carton_instance_id
    left join public.ag_stabilization_stock_actions original
      on original.id = action.reverses_action_id
      and original.aggregator_id = v_aggregator_id
    where action.aggregator_id = v_aggregator_id
      and action.action_date between v_start and v_end
    group by
      action.action_group_id,
      action.action_type,
      action.action_date
  ),
  filtered as (
    select grouped.*
    from grouped
    where v_search is null
      or grouped.action_group_id::text ilike '%' || v_search || '%'
      or grouped.action_type ilike '%' || v_search || '%'
      or coalesce(grouped.note, '') ilike '%' || v_search || '%'
      or grouped.actor_name ilike '%' || v_search || '%'
      or grouped.species_summary ilike '%' || v_search || '%'
      or coalesce(
        public.ag_stabilization_removal_reason_label(grouped.reason_code),
        ''
      ) ilike '%' || v_search || '%'
      or exists (
        select 1
        from public.ag_stabilization_stock_actions item
        where item.aggregator_id = v_aggregator_id
          and item.action_group_id = grouped.action_group_id
          and item.carton_serial ilike '%' || v_search || '%'
      )
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.action_date desc, page_rows.recorded_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      filtered.action_group_id,
      filtered.action_type,
      filtered.action_date,
      filtered.recorded_at,
      filtered.first_carton,
      filtered.last_carton,
      filtered.carton_list,
      filtered.carton_count,
      filtered.total_litres,
      filtered.species_summary,
      filtered.reason_code,
      case
        when filtered.action_type = 'removal'
          then public.ag_stabilization_removal_reason_label(filtered.reason_code)
        else filtered.note
      end as reason,
      case
        when filtered.action_type = 'removal' then filtered.note
        else null
      end as note,
      filtered.actor_name as recorded_by_name,
      filtered.restores_group_id,
      case
        when filtered.action_type = 'removal' and filtered.is_current_group
          then 'inactive'
        when filtered.action_type = 'removal'
          then 'restored'
        else 'restored'
      end as status,
      (
        filtered.action_type = 'removal'
        and filtered.is_current_group
        and public.ag_has_permission('can_edit_collections')
      ) as can_restore
    from filtered
    order by filtered.action_date desc, filtered.recorded_at desc
    limit v_limit offset v_offset
  ) page_rows;

  return jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'rows', v_rows,
    'total_count', v_total
  );
end;
$$;


notify pgrst,'reload schema';
commit;
