begin;

create table if not exists public.ag_organisation_permissions (
  organisation_id uuid primary key
    references public.ag_aggregators(id) on delete cascade,
  capabilities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capabilities) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.ag_organisation_permissions enable row level security;
revoke all on table public.ag_organisation_permissions from public, anon, authenticated;

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
      'tool_qr_tags', true,
      'tool_sms', true,
      'tool_form_builder', true,
      'tool_pricing', true,
      'tool_notifications', true
    )
  end;
$$;

insert into public.ag_organisation_permissions (
  organisation_id,
  capabilities,
  updated_at
)
select
  organisation.id,
  public.ag_default_organisation_capabilities(organisation.aggregator_code),
  now()
from public.ag_aggregators organisation
on conflict (organisation_id) do nothing;

create or replace function public.ag_organisation_capabilities(
  p_organisation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    permissions.capabilities,
    public.ag_default_organisation_capabilities(organisation.aggregator_code)
  )
  from public.ag_aggregators organisation
  left join public.ag_organisation_permissions permissions
    on permissions.organisation_id = organisation.id
  where organisation.id = p_organisation_id
    and organisation.active;
$$;

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
    'tool_qr_tags',
    'tool_sms',
    'tool_form_builder',
    'tool_pricing',
    'tool_notifications'
  ]::text[]) then
    return false;
  end if;

  v_capabilities := public.ag_organisation_capabilities(v_organisation_id);
  return coalesce((v_capabilities ->> p_capability)::boolean, false);
end;
$$;

create or replace function public.ag_require_organisation_capability(
  p_capability text,
  p_organisation_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid := coalesce(
    p_organisation_id,
    public.ag_current_aggregator_id()
  );
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if v_organisation_id is null
     or not public.ag_user_has_aggregator_access(v_organisation_id, v_user_id) then
    raise exception 'The organisation is not available to this account.'
      using errcode = '42501';
  end if;
  if not public.ag_has_organisation_capability(
    p_capability,
    v_organisation_id
  ) then
    raise exception 'This form or dataset is not enabled for the active organisation.'
      using errcode = '42501';
  end if;
  return v_organisation_id;
end;
$$;

create or replace function public.ag_admin_organisation_permissions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid := public.ag_require_active_aggregator();
  v_profile public.ag_user_profiles%rowtype;
  v_organisation public.ag_aggregators%rowtype;
  v_can_edit boolean;
begin
  perform public.ag_require_permission('can_manage_users');

  select * into v_profile
  from public.ag_user_profiles
  where id = v_user_id and account_status = 'active';

  select * into v_organisation
  from public.ag_aggregators
  where id = v_organisation_id and active;

  v_can_edit := public.ag_is_system_admin(v_user_id)
    or (
      coalesce(v_profile.can_manage_users, false)
      and coalesce(v_profile.can_manage_settings, false)
      and public.ag_current_membership_role() = 'aggregator_admin'
    );

  return jsonb_build_object(
    'organisation', jsonb_build_object(
      'id', v_organisation.id,
      'code', v_organisation.aggregator_code,
      'name', v_organisation.organisation_name,
      'short_name', v_organisation.short_name,
      'active', v_organisation.active
    ),
    'capabilities', public.ag_organisation_capabilities(v_organisation_id),
    'can_edit', v_can_edit
  );
end;
$$;

create or replace function public.ag_admin_save_organisation_permissions(
  p_capabilities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid := public.ag_require_active_aggregator();
  v_profile public.ag_user_profiles%rowtype;
  v_existing jsonb := public.ag_organisation_capabilities(v_organisation_id);
  v_saved jsonb;
begin
  perform public.ag_require_permission('can_manage_users');
  perform public.ag_require_permission('can_manage_settings');

  if p_capabilities is null or jsonb_typeof(p_capabilities) <> 'object' then
    raise exception 'Organisation permissions must be an object.'
      using errcode = '22023';
  end if;

  select * into v_profile
  from public.ag_user_profiles
  where id = v_user_id and account_status = 'active';

  if not (
    public.ag_is_system_admin(v_user_id)
    or (
      coalesce(v_profile.can_manage_users, false)
      and coalesce(v_profile.can_manage_settings, false)
      and public.ag_current_membership_role() = 'aggregator_admin'
    )
  ) then
    raise exception 'Organisation administrator permission is required.'
      using errcode = '42501';
  end if;

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
    v_organisation_id,
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
    v_organisation_id::text,
    jsonb_build_object(
      'before', v_existing,
      'after', v_saved
    )
  );

  return public.ag_admin_organisation_permissions();
end;
$$;

create or replace function public.ag_can_access_reef_nursery(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(exists (
    select 1
    from public.ag_user_profiles profile
    join public.ag_aggregator_memberships membership
      on membership.user_id = profile.id and membership.is_active
    join public.ag_aggregators organisation
      on organisation.id = membership.aggregator_id and organisation.active
    where profile.id = p_user_id
      and profile.account_status = 'active'
      and organisation.aggregator_code = 'COSME'
      and public.ag_has_organisation_capability(
        'form_reef_nursery',
        organisation.id
      )
      and (
        profile.app_role = 'system_admin'
        or profile.can_submit_collection
      )
  ), false);
$$;

create or replace function public.ag_require_reef_nursery_access()
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organisation_id uuid := public.ag_reef_nursery_aggregator_id();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if v_organisation_id is null then
    raise exception 'The COSME organisation is unavailable.' using errcode = 'P0002';
  end if;
  if not public.ag_can_access_reef_nursery() then
    raise exception 'Reef Nursery is not available to this COSME user.'
      using errcode = '42501';
  end if;
  perform public.ag_require_organisation_capability(
    'form_reef_nursery',
    v_organisation_id
  );
  return v_organisation_id;
end;
$$;

create or replace function public.ag_my_aggregator_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_active_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_active_id := public.ag_current_aggregator_id();
  select jsonb_build_object(
    'active_aggregator_id', v_active_id,
    'active_aggregator', (
      select jsonb_build_object(
        'id', organisation.id,
        'aggregator_code', organisation.aggregator_code,
        'organisation_name', organisation.organisation_name,
        'short_name', organisation.short_name,
        'receipt_prefix', organisation.receipt_prefix,
        'default_currency', organisation.default_currency,
        'membership_role', public.ag_current_membership_role(),
        'capabilities', public.ag_organisation_capabilities(organisation.id)
      )
      from public.ag_aggregators organisation
      where organisation.id = v_active_id
    ),
    'aggregators', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.organisation_name)
      from (
        select
          organisation.id,
          organisation.aggregator_code,
          organisation.organisation_name,
          organisation.short_name,
          organisation.organisation_role,
          organisation.receipt_prefix,
          organisation.default_currency,
          public.ag_organisation_capabilities(organisation.id) as capabilities,
          case
            when public.ag_is_system_admin(v_user_id) then 'platform_admin'
            else membership.membership_role
          end as membership_role
        from public.ag_aggregators organisation
        left join public.ag_aggregator_memberships membership
          on membership.aggregator_id = organisation.id
          and membership.user_id = v_user_id
          and membership.is_active
        where organisation.active
          and public.ag_user_has_aggregator_access(
            organisation.id,
            v_user_id
          )
      ) row_data
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.ag_my_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    to_jsonb(profile) || jsonb_build_object(
      'farmer_id', farmer.farmer_id,
      'active_aggregator_code', organisation.aggregator_code,
      'active_aggregator_name', organisation.organisation_name,
      'active_membership_role', public.ag_current_membership_role(),
      'organisation_capabilities',
        public.ag_organisation_capabilities(organisation.id),
      'can_access_reef_nursery',
        public.ag_can_access_reef_nursery(profile.id)
    ),
    '{}'::jsonb
  )
  from public.ag_user_profiles profile
  left join public.farmers farmer
    on farmer.id = profile.farmer_record_id
  left join public.ag_aggregators organisation
    on organisation.id = public.ag_current_aggregator_id()
  where profile.id = (select auth.uid());
$$;

alter function public.ag_submit_collection_v2(uuid, jsonb)
  rename to ag_submit_collection_v2_without_organisation_access;
create function public.ag_submit_collection_v2(
  p_submission_id uuid,
  p_collection jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.ag_require_organisation_capability(
    'form_intake_collection'
  );
  return public.ag_submit_collection_v2_without_organisation_access(
    p_submission_id,
    p_collection
  );
end;
$$;

alter function public.ag_submit_collection_for_aggregator_v1(
  uuid, jsonb, uuid, uuid
)
  rename to ag_submit_collection_for_aggregator_v1_without_organisation_access;
create function public.ag_submit_collection_for_aggregator_v1(
  p_submission_id uuid,
  p_collection jsonb,
  p_aggregator_id uuid,
  p_original_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.ag_require_organisation_capability(
    'form_intake_collection',
    p_aggregator_id
  );
  return public.ag_submit_collection_for_aggregator_v1_without_organisation_access(
    p_submission_id,
    p_collection,
    p_aggregator_id,
    p_original_user_id
  );
end;
$$;

alter function public.ag_submit_site_water_sample_record_v4(uuid, jsonb)
  rename to ag_submit_site_water_sample_record_v4_without_organisation_access;
create function public.ag_submit_site_water_sample_record_v4(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.ag_require_organisation_capability(
    'form_site_water_samples'
  );
  return public.ag_submit_site_water_sample_record_v4_without_organisation_access(
    p_submission_id,
    p_record
  );
end;
$$;

alter function public.ag_submit_stabilization_packing_record_v3(uuid, jsonb)
  rename to ag_submit_stabilization_packing_record_v3_without_organisation_access;
create function public.ag_submit_stabilization_packing_record_v3(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.ag_require_organisation_capability('form_stock_record');
  return public.ag_submit_stabilization_packing_record_v3_without_organisation_access(
    p_submission_id,
    p_record
  );
end;
$$;

alter function public.ag_submit_stabilization_packing_batch_v2(uuid, jsonb)
  rename to ag_submit_stabilization_packing_batch_v2_without_organisation_access;
create function public.ag_submit_stabilization_packing_batch_v2(
  p_batch_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.ag_require_organisation_capability('form_stock_record');
  return public.ag_submit_stabilization_packing_batch_v2_without_organisation_access(
    p_batch_submission_id,
    p_record
  );
end;
$$;

alter function public.ag_submit_process_record(uuid, jsonb)
  rename to ag_submit_process_record_without_organisation_access;
create function public.ag_submit_process_record(
  p_submission_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
begin
  perform public.ag_require_organisation_capability('form_process_record');
  return public.ag_submit_process_record_without_organisation_access(
    p_submission_id,
    p_record
  );
end;
$$;

create or replace function public.ag_record_type_capability(
  p_record_type text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_record_type
    when 'process' then 'form_process_record'
    when 'site_sample' then 'form_site_water_samples'
    when 'stock' then 'form_stock_record'
    when 'intake' then 'form_intake_collection'
    else null
  end;
$$;

alter function public.ag_form_record_ledger(
  text, date, date, text, text, integer, integer
)
  rename to ag_form_record_ledger_without_organisation_access;
create function public.ag_form_record_ledger(
  p_record_type text,
  p_start_date date default null,
  p_end_date date default null,
  p_community_id text default null,
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
  v_capability text := public.ag_record_type_capability(p_record_type);
begin
  if v_capability is null then
    raise exception 'Unknown record type.' using errcode = '22023';
  end if;
  perform public.ag_require_organisation_capability(v_capability);
  return public.ag_form_record_ledger_without_organisation_access(
    p_record_type,
    p_start_date,
    p_end_date,
    p_community_id,
    p_search,
    p_page_limit,
    p_page_offset
  );
end;
$$;

alter function public.ag_form_record_summary(text, date, date, text)
  rename to ag_form_record_summary_without_organisation_access;
create function public.ag_form_record_summary(
  p_record_type text,
  p_start_date date default null,
  p_end_date date default null,
  p_community_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_capability text := public.ag_record_type_capability(p_record_type);
begin
  if v_capability is null then
    raise exception 'Unknown record type.' using errcode = '22023';
  end if;
  perform public.ag_require_organisation_capability(v_capability);
  return public.ag_form_record_summary_without_organisation_access(
    p_record_type,
    p_start_date,
    p_end_date,
    p_community_id
  );
end;
$$;

revoke all on function public.ag_default_organisation_capabilities(text)
  from public, anon, authenticated;
revoke all on function public.ag_organisation_capabilities(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_has_organisation_capability(text, uuid)
  from public, anon;
revoke all on function public.ag_require_organisation_capability(text, uuid)
  from public, anon, authenticated;
revoke all on function public.ag_admin_organisation_permissions()
  from public, anon;
revoke all on function public.ag_admin_save_organisation_permissions(jsonb)
  from public, anon;
revoke all on function public.ag_record_type_capability(text)
  from public, anon, authenticated;

revoke all on function public.ag_submit_collection_v2_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_collection_for_aggregator_v1_without_organisation_access(uuid, jsonb, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ag_submit_site_water_sample_record_v4_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_stabilization_packing_record_v3_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_stabilization_packing_batch_v2_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_process_record_without_organisation_access(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_form_record_ledger_without_organisation_access(text, date, date, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.ag_form_record_summary_without_organisation_access(text, date, date, text)
  from public, anon, authenticated;

revoke all on function public.ag_submit_collection_v2(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_collection_for_aggregator_v1(uuid, jsonb, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ag_submit_site_water_sample_record_v4(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_stabilization_packing_record_v3(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_stabilization_packing_batch_v2(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_submit_process_record(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ag_form_record_ledger(text, date, date, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.ag_form_record_summary(text, date, date, text)
  from public, anon, authenticated;

grant execute on function public.ag_has_organisation_capability(text, uuid)
  to authenticated;
grant execute on function public.ag_admin_organisation_permissions()
  to authenticated;
grant execute on function public.ag_admin_save_organisation_permissions(jsonb)
  to authenticated;
grant execute on function public.ag_submit_collection_v2(uuid, jsonb)
  to authenticated;
grant execute on function public.ag_submit_collection_for_aggregator_v1(uuid, jsonb, uuid, uuid)
  to authenticated;
grant execute on function public.ag_submit_site_water_sample_record_v4(uuid, jsonb)
  to authenticated;
grant execute on function public.ag_submit_stabilization_packing_record_v3(uuid, jsonb)
  to authenticated;
grant execute on function public.ag_submit_stabilization_packing_batch_v2(uuid, jsonb)
  to authenticated;
grant execute on function public.ag_submit_process_record(uuid, jsonb)
  to authenticated;
grant execute on function public.ag_form_record_ledger(text, date, date, text, text, integer, integer)
  to authenticated;
grant execute on function public.ag_form_record_summary(text, date, date, text)
  to authenticated;

comment on table public.ag_organisation_permissions is
  'Organisation-level availability for forms, their paired datasets, and optional tools.';
comment on function public.ag_admin_save_organisation_permissions(jsonb) is
  'Updates capabilities for the active organisation and records an audit event.';

notify pgrst, 'reload schema';

commit;
