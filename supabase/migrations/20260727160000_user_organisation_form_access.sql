begin;

alter table public.ag_aggregator_memberships
  add column if not exists form_access jsonb;

alter table public.ag_aggregator_memberships
  drop constraint if exists ag_aggregator_memberships_form_access_object;

alter table public.ag_aggregator_memberships
  add constraint ag_aggregator_memberships_form_access_object
  check (
    form_access is null
    or jsonb_typeof(form_access) = 'object'
  );

comment on column public.ag_aggregator_memberships.form_access is
  'Per-user form access for this organisation. Null inherits every form enabled for the organisation.';

create or replace function public.ag_effective_organisation_capabilities(
  p_organisation_id uuid,
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organisation_capabilities jsonb;
  v_form_access jsonb;
  v_profile public.ag_user_profiles%rowtype;
  v_effective jsonb;
  v_form_key text;
begin
  if p_organisation_id is null or p_user_id is null then
    return '{}'::jsonb;
  end if;

  v_organisation_capabilities :=
    public.ag_organisation_capabilities(p_organisation_id);
  if v_organisation_capabilities is null then
    return '{}'::jsonb;
  end if;

  select *
  into v_profile
  from public.ag_user_profiles
  where id = p_user_id
    and account_status = 'active';

  if not found then
    return '{}'::jsonb;
  end if;

  if v_profile.app_role = 'system_admin'
     or v_profile.is_protected_owner then
    return v_organisation_capabilities;
  end if;

  select membership.form_access
  into v_form_access
  from public.ag_aggregator_memberships membership
  where membership.aggregator_id = p_organisation_id
    and membership.user_id = p_user_id
    and membership.is_active;

  if not found then
    return '{}'::jsonb;
  end if;

  if v_form_access is null then
    return v_organisation_capabilities;
  end if;

  v_effective := v_organisation_capabilities;
  foreach v_form_key in array array[
    'form_site_water_samples',
    'form_intake_collection',
    'form_stock_record',
    'form_process_record',
    'form_reef_nursery',
    'form_dryer_table',
    'form_green_space'
  ]::text[]
  loop
    v_effective := jsonb_set(
      v_effective,
      array[v_form_key],
      to_jsonb(
        coalesce(
          (v_organisation_capabilities ->> v_form_key)::boolean,
          false
        )
        and coalesce((v_form_access ->> v_form_key)::boolean, false)
      ),
      true
    );
  end loop;

  return v_effective;
end;
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
    'form_green_space',
    'tool_qr_tags',
    'tool_sms',
    'tool_form_builder',
    'tool_pricing',
    'tool_notifications'
  ]::text[]) then
    return false;
  end if;

  if v_organisation_id is null then
    return false;
  end if;

  v_capabilities := public.ag_effective_organisation_capabilities(
    v_organisation_id,
    (select auth.uid())
  );
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
    raise exception 'This form or dataset is not available to this account.'
      using errcode = '42501';
  end if;
  return v_organisation_id;
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
      and coalesce((
        public.ag_effective_organisation_capabilities(
          organisation.id,
          p_user_id
        ) ->> 'form_reef_nursery'
      )::boolean, false)
      and (
        profile.app_role = 'system_admin'
        or profile.can_submit_collection
      )
  ), false);
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
        'capabilities', public.ag_effective_organisation_capabilities(
          organisation.id,
          v_user_id
        )
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
          public.ag_effective_organisation_capabilities(
            organisation.id,
            v_user_id
          ) as capabilities,
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
        public.ag_effective_organisation_capabilities(
          organisation.id,
          profile.id
        ),
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

create or replace function public.ag_admin_user_aggregator_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_result jsonb;
begin
  perform public.ag_require_permission('can_manage_users');

  select coalesce(
    jsonb_agg(to_jsonb(row_data) order by row_data.organisation_name),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      organisation.id,
      organisation.aggregator_code,
      organisation.organisation_name,
      organisation.short_name,
      public.ag_effective_organisation_capabilities(
        organisation.id,
        v_actor
      ) as capabilities
    from public.ag_organisation_permission_scope(v_actor) organisation
  ) row_data;

  return v_result;
end;
$$;

create or replace function public.ag_admin_user_form_access(
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_result jsonb;
begin
  perform public.ag_require_permission('can_manage_users');

  select coalesce(
    jsonb_object_agg(
      membership.aggregator_id::text,
      case
        when membership.form_access is null then 'null'::jsonb
        else membership.form_access
      end
    ),
    '{}'::jsonb
  )
  into v_result
  from public.ag_aggregator_memberships membership
  join public.ag_organisation_permission_scope(v_actor) scope
    on scope.id = membership.aggregator_id
  where membership.user_id = p_user_id
    and membership.is_active;

  return v_result;
end;
$$;

revoke all on function public.ag_effective_organisation_capabilities(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ag_admin_user_form_access(uuid)
  from public, anon;
revoke all on function public.ag_organisation_capabilities(uuid)
  from public, anon, authenticated;

grant execute on function public.ag_effective_organisation_capabilities(uuid, uuid)
  to service_role;
grant execute on function public.ag_organisation_capabilities(uuid)
  to service_role;
grant execute on function public.ag_admin_user_form_access(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
