begin;

create or replace function public.ag_reef_workspace_record_state(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_access_mode text := v_scope ->> 'access_mode';
  v_type text := lower(nullif(trim(p_record_type), ''));
  v_status text;
  v_record_number text;
  v_created_at timestamptz;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;

  if v_type = 'seaweed' then
    select record.record_status, record.record_number, record.created_at
    into v_status, v_record_number, v_created_at
    from public.ag_reef_seaweed_records record
    where record.id = p_record_id
      and record.aggregator_id = v_aggregator_id
      and record.deleted_at is null;
  elsif v_type = 'inspection' then
    select record.record_status, record.record_number, record.created_at
    into v_status, v_record_number, v_created_at
    from public.ag_reef_inspection_records record
    where record.id = p_record_id
      and record.aggregator_id = v_aggregator_id
      and record.deleted_at is null;
  else
    raise exception 'Unsupported Reef record type.' using errcode = '22023';
  end if;

  if not found then
    raise exception 'Reef record was not found.' using errcode = 'P0002';
  end if;
  if v_access_mode <> 'authenticated' and v_created_at + interval '168 hours' <= now() then
    raise exception 'This Reef record is older than 7 days. Sign in with an authorised COSME Reef account to open it.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'record_type', v_type,
    'record_id', p_record_id,
    'record_number', v_record_number,
    'record_status', v_status,
    'public_edit_until', v_created_at + interval '168 hours'
  );
end;
$$;

create or replace function public.ag_reef_records_workspace_records_v2(
  p_search text default null,
  p_record_type text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  record_type text,
  record_id uuid,
  record_number text,
  record_status text,
  record_date date,
  location text,
  recorded_by_name text,
  summary text,
  created_at timestamptz,
  updated_at timestamptz,
  public_edit_until timestamptz,
  read_only boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    base.record_type,
    base.record_id,
    base.record_number,
    case base.record_type
      when 'seaweed' then coalesce((
        select record.record_status
        from public.ag_reef_seaweed_records record
        where record.id = base.record_id
      ), base.record_status)
      when 'inspection' then coalesce((
        select record.record_status
        from public.ag_reef_inspection_records record
        where record.id = base.record_id
      ), base.record_status)
      else base.record_status
    end,
    base.record_date,
    base.location,
    base.recorded_by_name,
    case
      when base.record_type = 'seaweed' and exists (
        select 1 from public.ag_reef_seaweed_records record
        where record.id = base.record_id and record.record_status = 'draft'
      ) then concat_ws(' · ', 'Draft', nullif(base.summary, ''))
      when base.record_type = 'inspection' and exists (
        select 1 from public.ag_reef_inspection_records record
        where record.id = base.record_id and record.record_status = 'draft'
      ) then concat_ws(' · ', 'Draft', nullif(base.summary, ''))
      else base.summary
    end,
    base.created_at,
    base.updated_at,
    base.public_edit_until,
    base.read_only,
    base.total_count
  from public.ag_reef_records_workspace_records(
    p_search, p_record_type, p_limit, p_offset
  ) base;
$$;

revoke all on function public.ag_reef_training_workspace_validate_draft(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_reef_seaweed_workspace_validate_draft(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_reef_inspection_workspace_validate_draft(jsonb, jsonb)
  from public, anon, authenticated;

revoke all on function public.ag_reef_training_workspace_save(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) from public;
grant execute on function public.ag_reef_training_workspace_save(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) to anon, authenticated;

revoke all on function public.ag_reef_seaweed_workspace_save(
  uuid, uuid, jsonb, jsonb
) from public;
grant execute on function public.ag_reef_seaweed_workspace_save(
  uuid, uuid, jsonb, jsonb
) to anon, authenticated;

revoke all on function public.ag_reef_inspection_workspace_save(
  uuid, uuid, jsonb, jsonb
) from public;
grant execute on function public.ag_reef_inspection_workspace_save(
  uuid, uuid, jsonb, jsonb
) to anon, authenticated;

revoke all on function public.ag_reef_seaweed_workspace_submit_current(
  uuid, uuid, jsonb, jsonb
) from public;
grant execute on function public.ag_reef_seaweed_workspace_submit_current(
  uuid, uuid, jsonb, jsonb
) to anon, authenticated;

revoke all on function public.ag_reef_inspection_workspace_submit_current(
  uuid, uuid, jsonb, jsonb
) from public;
grant execute on function public.ag_reef_inspection_workspace_submit_current(
  uuid, uuid, jsonb, jsonb
) to anon, authenticated;

revoke all on function public.ag_reef_workspace_record_state(text, uuid) from public;
grant execute on function public.ag_reef_workspace_record_state(text, uuid)
  to anon, authenticated;

revoke all on function public.ag_reef_records_workspace_records_v2(
  text, text, integer, integer
) from public;
grant execute on function public.ag_reef_records_workspace_records_v2(
  text, text, integer, integer
) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
