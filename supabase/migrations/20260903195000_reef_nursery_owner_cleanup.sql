begin;

create or replace function public.ag_reef_records_workspace_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_actor_id uuid := nullif(v_scope ->> 'actor_user_id', '')::uuid;
  v_can_manage_users boolean := false;
  v_can_delete_records boolean := false;
begin
  if v_actor_id is not null and v_scope ->> 'access_mode' = 'authenticated' then
    select
      coalesce(profile.can_manage_users, false),
      coalesce(profile.is_protected_owner, false)
    into v_can_manage_users, v_can_delete_records
    from public.ag_user_profiles profile
    where profile.id = v_actor_id
      and profile.account_status = 'active';
  end if;

  return v_scope || jsonb_build_object(
    'record_types', jsonb_build_array('training', 'seaweed', 'inspection', 'legacy'),
    'public_window_hours', 168,
    'can_manage_users', v_can_manage_users,
    'can_delete_records', v_can_delete_records,
    'account_management_url', 'admin_users.html',
    'account_flow', 'existing_seaweed_harvest'
  );
end;
$$;

create or replace function public.ag_reef_records_workspace_delete(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_actor_id uuid := (select auth.uid());
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_record_type text := lower(nullif(trim(p_record_type), ''));
  v_record_number text;
  v_target_type text;
  v_actor_email text;
  v_deleted_at timestamptz := clock_timestamp();
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false)
     or v_scope ->> 'access_mode' <> 'authenticated'
     or v_actor_id is null then
    raise exception 'Sign in with the protected owner account to delete Reef records.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ag_user_profiles profile
    where profile.id = v_actor_id
      and profile.account_status = 'active'
      and profile.is_protected_owner
  ) then
    raise exception 'Only the protected owner can delete Reef records.'
      using errcode = '42501';
  end if;

  if p_record_id is null or v_record_type not in ('training', 'seaweed', 'inspection') then
    raise exception 'Select a valid Reef record to delete.' using errcode = '22023';
  end if;

  case v_record_type
    when 'training' then
      update public.ag_reef_nursery_sessions
      set deleted_at = v_deleted_at,
          deleted_by_user_id = v_actor_id,
          updated_at = v_deleted_at
      where id = p_record_id
        and aggregator_id = v_aggregator_id
        and deleted_at is null
      returning record_number into v_record_number;
      v_target_type := 'reef_nursery_session';

    when 'seaweed' then
      update public.ag_reef_seaweed_records
      set deleted_at = v_deleted_at,
          deleted_by_user_id = v_actor_id,
          updated_at = v_deleted_at
      where id = p_record_id
        and aggregator_id = v_aggregator_id
        and deleted_at is null
      returning record_number into v_record_number;
      v_target_type := 'reef_seaweed_record';

    when 'inspection' then
      update public.ag_reef_inspection_records
      set deleted_at = v_deleted_at,
          deleted_by_user_id = v_actor_id,
          updated_at = v_deleted_at
      where id = p_record_id
        and aggregator_id = v_aggregator_id
        and deleted_at is null
      returning record_number into v_record_number;
  end case;

  if v_record_number is null then
    raise exception 'The Reef record was not found or has already been deleted.'
      using errcode = 'P0002';
  end if;

  if v_target_type is null then
    v_target_type := 'reef_inspection_record';
  end if;

  select profile.email
  into v_actor_email
  from public.ag_user_profiles profile
  where profile.id = v_actor_id;

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_actor_id,
    v_actor_email,
    'reef_record_soft_deleted',
    v_target_type,
    p_record_id::text,
    jsonb_build_object(
      'record_type', v_record_type,
      'record_number', v_record_number,
      'aggregator_id', v_aggregator_id,
      'deleted_at', v_deleted_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'record_type', v_record_type,
    'record_id', p_record_id,
    'record_number', v_record_number,
    'deleted_at', v_deleted_at
  );
end;
$$;

revoke all on function public.ag_reef_records_workspace_delete(text, uuid) from public, anon;
grant execute on function public.ag_reef_records_workspace_delete(text, uuid) to authenticated;

comment on function public.ag_reef_records_workspace_delete(text, uuid)
is 'Soft-deletes active Reef Training, Seaweed or Inspection records for the protected owner only.';

commit;
