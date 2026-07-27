begin;

alter table public.ag_user_profiles
  add column if not exists can_manage_organisation_permissions boolean not null default false;

update public.ag_user_profiles
set can_manage_organisation_permissions = true
where app_role = 'system_admin'
   or is_protected_owner = true;

update public.ag_user_profiles
set can_manage_users = true
where can_manage_organisation_permissions;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ag_profiles_organisation_permissions_requires_users'
  ) then
    alter table public.ag_user_profiles
      add constraint ag_profiles_organisation_permissions_requires_users
      check (
        not can_manage_organisation_permissions
        or can_manage_users
      );
  end if;
end;
$$;

create or replace function public.ag_guard_protected_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'DELETE' and old.is_protected_owner then
    raise exception 'Protected owner accounts cannot be deleted.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.is_protected_owner and (
    new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.app_role is distinct from old.app_role
    or new.account_status is distinct from old.account_status
    or new.community_id is distinct from old.community_id
    or new.farmer_record_id is distinct from old.farmer_record_id
    or new.can_access_admin is distinct from old.can_access_admin
    or new.can_submit_collection is distinct from old.can_submit_collection
    or new.can_view_dashboard is distinct from old.can_view_dashboard
    or new.can_view_registry is distinct from old.can_view_registry
    or new.can_edit_registry is distinct from old.can_edit_registry
    or new.can_view_map is distinct from old.can_view_map
    or new.can_view_data is distinct from old.can_view_data
    or new.can_edit_collections is distinct from old.can_edit_collections
    or new.can_view_finance is distinct from old.can_view_finance
    or new.can_manage_pricing is distinct from old.can_manage_pricing
    or new.can_export_data is distinct from old.can_export_data
    or new.can_manage_settings is distinct from old.can_manage_settings
    or new.can_manage_users is distinct from old.can_manage_users
    or new.can_manage_admin_users is distinct from old.can_manage_admin_users
    or new.can_manage_organisation_permissions is distinct from old.can_manage_organisation_permissions
    or new.can_view_user_activity is distinct from old.can_view_user_activity
    or new.can_view_notifications is distinct from old.can_view_notifications
    or new.can_manage_notifications is distinct from old.can_manage_notifications
    or new.can_manage_sms_settings is distinct from old.can_manage_sms_settings
    or new.can_manage_green_space is distinct from old.can_manage_green_space
    or new.is_protected_owner is distinct from old.is_protected_owner
  ) then
    raise exception 'Protected owner access cannot be changed.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.ag_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce((
    select case
      when p.account_status <> 'active' then false
      when p.app_role = 'system_admin' then true
      when p_permission = 'can_access_admin' then p.can_access_admin
      when p_permission = 'can_submit_collection' then p.can_submit_collection
      when p_permission = 'can_view_dashboard' then p.can_view_dashboard
      when p_permission = 'can_view_registry' then p.can_view_registry
      when p_permission = 'can_edit_registry' then p.can_edit_registry
      when p_permission = 'can_view_map' then p.can_view_map
      when p_permission = 'can_view_data' then p.can_view_data
      when p_permission = 'can_edit_collections' then p.can_edit_collections
      when p_permission = 'can_view_finance' then p.can_view_finance
      when p_permission = 'can_manage_pricing' then p.can_manage_pricing
      when p_permission = 'can_export_data' then p.can_export_data
      when p_permission = 'can_manage_settings' then p.can_manage_settings
      when p_permission = 'can_manage_users' then p.can_manage_users
      when p_permission = 'can_manage_admin_users' then p.can_manage_admin_users
      when p_permission = 'can_manage_organisation_permissions'
        then p.can_manage_organisation_permissions
      when p_permission = 'can_view_user_activity' then p.can_view_user_activity
      when p_permission = 'can_view_notifications' then p.can_view_notifications
      when p_permission = 'can_manage_notifications' then p.can_manage_notifications
      when p_permission = 'can_manage_sms_settings' then p.can_manage_sms_settings
      when p_permission = 'can_manage_green_space' then p.can_manage_green_space
      else false
    end
    from public.ag_user_profiles p
    where p.id = (select auth.uid())
  ), false);
$$;

create or replace function public.ag_default_organisation_capabilities(
  p_organisation_code text
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case upper(coalesce(p_organisation_code, ''))
    when 'COSME' then jsonb_build_object(
      'form_site_water_samples', false,
      'form_intake_collection', false,
      'form_stock_record', false,
      'form_process_record', false,
      'form_reef_nursery', true,
      'form_dryer_table', true,
      'form_green_space', false,
      'tool_qr_tags', true,
      'tool_sms', true,
      'tool_form_builder', true,
      'tool_pricing', true,
      'tool_notifications', true
    )
    when 'SANDBOX' then jsonb_build_object(
      'form_site_water_samples', false,
      'form_intake_collection', false,
      'form_stock_record', false,
      'form_process_record', false,
      'form_reef_nursery', false,
      'form_dryer_table', false,
      'form_green_space', true,
      'tool_qr_tags', false,
      'tool_sms', false,
      'tool_form_builder', false,
      'tool_pricing', false,
      'tool_notifications', false
    )
    else jsonb_build_object(
      'form_site_water_samples', true,
      'form_intake_collection', true,
      'form_stock_record', true,
      'form_process_record', true,
      'form_reef_nursery', false,
      'form_dryer_table', false,
      'form_green_space', false,
      'tool_qr_tags', true,
      'tool_sms', true,
      'tool_form_builder', true,
      'tool_pricing', true,
      'tool_notifications', true
    )
  end;
$$;

update public.ag_organisation_permissions permissions
set capabilities =
  public.ag_default_organisation_capabilities(organisation.aggregator_code)
  || permissions.capabilities
  || case
       when permissions.capabilities ? 'form_green_space' then '{}'::jsonb
       else jsonb_build_object(
         'form_green_space',
         upper(organisation.aggregator_code) = 'SANDBOX'
       )
     end,
    updated_at = now()
from public.ag_aggregators organisation
where organisation.id = permissions.organisation_id;

create or replace function public.ag_has_organisation_capability(
  p_capability text,
  p_organisation_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organisation_id uuid := coalesce(
    p_organisation_id,
    public.ag_current_aggregator_id()
  );
  v_capabilities jsonb;
begin
  if p_capability <> all(array[
    'form_site_water_samples',
    'form_intake_collection',
    'form_stock_record',
    'form_process_record',
    'form_reef_nursery',
    'form_dryer_table',
    'form_green_space',
    'tool_qr_tags',
    'tool_sms',
    'tool_form_builder',
    'tool_pricing',
    'tool_notifications'
  ]) then
    return false;
  end if;

  if v_organisation_id is null then
    return false;
  end if;

  v_capabilities := public.ag_organisation_capabilities(v_organisation_id);
  return coalesce((v_capabilities ->> p_capability)::boolean, false);
end;
$$;

create or replace function public.ag_organisation_permission_scope(
  p_user_id uuid default auth.uid()
)
returns table (
  id uuid,
  aggregator_code text,
  organisation_name text,
  short_name text
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    organisation.id,
    organisation.aggregator_code,
    organisation.organisation_name,
    organisation.short_name
  from public.ag_aggregators organisation
  left join public.ag_aggregator_memberships membership
    on membership.aggregator_id = organisation.id
    and membership.user_id = p_user_id
    and membership.is_active
    and membership.membership_role = 'aggregator_admin'
  where organisation.active
    and (
      public.ag_is_system_admin(p_user_id)
      or membership.id is not null
    )
  order by organisation.organisation_name;
$$;

create or replace function public.ag_can_manage_organisation_permissions(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce((
    select
      profile.account_status = 'active'
      and (
        profile.app_role = 'system_admin'
        or profile.is_protected_owner
        or profile.can_manage_organisation_permissions
      )
      and profile.can_manage_users
      and (
        select count(*)
        from public.ag_organisation_permission_scope(p_user_id)
      ) > 1
    from public.ag_user_profiles profile
    where profile.id = p_user_id
  ), false);
$$;

create or replace function public.ag_admin_organisation_permission_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_can_access boolean;
  v_active_id uuid;
  v_organisations jsonb := '[]'::jsonb;
begin
  perform public.ag_require_permission('can_manage_users');
  v_can_access := public.ag_can_manage_organisation_permissions(v_user_id);

  if v_can_access then
    v_active_id := public.ag_current_aggregator_id();
    select coalesce(
      jsonb_agg(to_jsonb(scope) order by scope.organisation_name),
      '[]'::jsonb
    )
    into v_organisations
    from public.ag_organisation_permission_scope(v_user_id) scope;
  end if;

  return jsonb_build_object(
    'can_access', v_can_access,
    'active_organisation_id', case when v_can_access then v_active_id else null end,
    'organisations', v_organisations
  );
end;
$$;

drop function if exists public.ag_admin_organisation_permissions();

create function public.ag_admin_organisation_permissions(
  p_organisation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation public.ag_aggregators%rowtype;
begin
  perform public.ag_require_permission('can_manage_users');

  if not public.ag_can_manage_organisation_permissions(v_user_id) then
    raise exception 'Multi-organisation permission is required.'
      using errcode = '42501';
  end if;

  select organisation.*
  into v_organisation
  from public.ag_aggregators organisation
  join public.ag_organisation_permission_scope(v_user_id) scope
    on scope.id = organisation.id
  where organisation.id = p_organisation_id
    and organisation.active;

  if v_organisation.id is null then
    raise exception 'This organisation is outside your permission scope.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'organisation', jsonb_build_object(
      'id', v_organisation.id,
      'code', v_organisation.aggregator_code,
      'name', v_organisation.organisation_name,
      'short_name', v_organisation.short_name,
      'active', v_organisation.active
    ),
    'capabilities', public.ag_organisation_capabilities(v_organisation.id),
    'can_edit', true
  );
end;
$$;

drop function if exists public.ag_admin_save_organisation_permissions(jsonb);

create function public.ag_admin_save_organisation_permissions(
  p_organisation_id uuid,
  p_capabilities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile public.ag_user_profiles%rowtype;
  v_existing jsonb;
  v_saved jsonb;
begin
  perform public.ag_require_permission('can_manage_users');

  if not public.ag_can_manage_organisation_permissions(v_user_id) then
    raise exception 'Multi-organisation permission is required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ag_organisation_permission_scope(v_user_id) scope
    where scope.id = p_organisation_id
  ) then
    raise exception 'This organisation is outside your permission scope.'
      using errcode = '42501';
  end if;

  if p_capabilities is null or jsonb_typeof(p_capabilities) <> 'object' then
    raise exception 'Organisation permissions must be an object.'
      using errcode = '22023';
  end if;

  select *
  into v_profile
  from public.ag_user_profiles
  where id = v_user_id
    and account_status = 'active';

  v_existing := public.ag_organisation_capabilities(p_organisation_id);
  v_saved := jsonb_build_object(
    'form_site_water_samples', coalesce(
      (p_capabilities ->> 'form_site_water_samples')::boolean,
      (v_existing ->> 'form_site_water_samples')::boolean,
      false
    ),
    'form_intake_collection', coalesce(
      (p_capabilities ->> 'form_intake_collection')::boolean,
      (v_existing ->> 'form_intake_collection')::boolean,
      false
    ),
    'form_stock_record', coalesce(
      (p_capabilities ->> 'form_stock_record')::boolean,
      (v_existing ->> 'form_stock_record')::boolean,
      false
    ),
    'form_process_record', coalesce(
      (p_capabilities ->> 'form_process_record')::boolean,
      (v_existing ->> 'form_process_record')::boolean,
      false
    ),
    'form_reef_nursery', coalesce(
      (p_capabilities ->> 'form_reef_nursery')::boolean,
      (v_existing ->> 'form_reef_nursery')::boolean,
      false
    ),
    'form_dryer_table', coalesce(
      (p_capabilities ->> 'form_dryer_table')::boolean,
      (v_existing ->> 'form_dryer_table')::boolean,
      false
    ),
    'form_green_space', coalesce(
      (p_capabilities ->> 'form_green_space')::boolean,
      (v_existing ->> 'form_green_space')::boolean,
      false
    ),
    'tool_qr_tags', coalesce(
      (p_capabilities ->> 'tool_qr_tags')::boolean,
      (v_existing ->> 'tool_qr_tags')::boolean,
      false
    ),
    'tool_sms', coalesce(
      (p_capabilities ->> 'tool_sms')::boolean,
      (v_existing ->> 'tool_sms')::boolean,
      false
    ),
    'tool_form_builder', coalesce(
      (p_capabilities ->> 'tool_form_builder')::boolean,
      (v_existing ->> 'tool_form_builder')::boolean,
      false
    ),
    'tool_pricing', coalesce(
      (p_capabilities ->> 'tool_pricing')::boolean,
      (v_existing ->> 'tool_pricing')::boolean,
      false
    ),
    'tool_notifications', coalesce(
      (p_capabilities ->> 'tool_notifications')::boolean,
      (v_existing ->> 'tool_notifications')::boolean,
      false
    )
  );

  insert into public.ag_organisation_permissions (
    organisation_id,
    capabilities,
    updated_at,
    updated_by
  ) values (
    p_organisation_id,
    v_saved,
    now(),
    v_user_id
  )
  on conflict (organisation_id) do update
  set capabilities = excluded.capabilities,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_user_id,
    v_profile.email,
    'organisation_permissions_updated',
    'organisation',
    p_organisation_id::text,
    jsonb_build_object(
      'before', v_existing,
      'after', v_saved
    )
  );

  return public.ag_admin_organisation_permissions(p_organisation_id);
end;
$$;

revoke all on function public.ag_organisation_permission_scope(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_can_manage_organisation_permissions(uuid)
  from public, anon;
revoke all on function public.ag_admin_organisation_permission_options()
  from public, anon;
revoke all on function public.ag_admin_organisation_permissions(uuid)
  from public, anon;
revoke all on function public.ag_admin_save_organisation_permissions(uuid, jsonb)
  from public, anon;

grant execute on function public.ag_can_manage_organisation_permissions(uuid)
  to authenticated;
grant execute on function public.ag_admin_organisation_permission_options()
  to authenticated;
grant execute on function public.ag_admin_organisation_permissions(uuid)
  to authenticated;
grant execute on function public.ag_admin_save_organisation_permissions(uuid, jsonb)
  to authenticated;

comment on column public.ag_user_profiles.can_manage_organisation_permissions is
  'Allows an eligible multi-organisation administrator to configure form, record, and tool availability for organisations they administer.';
comment on function public.ag_admin_organisation_permission_options() is
  'Returns organisation choices only when the caller has explicit permission and administers more than one organisation.';
comment on function public.ag_admin_save_organisation_permissions(uuid, jsonb) is
  'Updates capabilities for a selected organisation within the caller multi-organisation scope.';

notify pgrst, 'reload schema';

commit;
