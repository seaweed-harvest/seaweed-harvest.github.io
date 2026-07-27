begin;

create table if not exists public.ag_form_access_settings (
  organisation_id uuid not null
    references public.ag_aggregators(id) on delete cascade,
  form_key text not null,
  entry_access text not null default 'private',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (organisation_id, form_key),
  constraint ag_form_access_settings_form_key_check check (
    form_key in (
      'form_site_water_samples',
      'form_intake_collection',
      'form_stock_record',
      'form_process_record',
      'form_reef_nursery',
      'form_dryer_table',
      'form_green_space'
    )
  ),
  constraint ag_form_access_settings_entry_access_check check (
    entry_access in ('private', 'link', 'public', 'review', 'paused')
  )
);

create table if not exists public.ag_form_share_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.ag_aggregators(id) on delete cascade,
  form_key text not null,
  link_kind text not null,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint ag_form_share_links_form_key_check check (
    form_key in (
      'form_site_water_samples',
      'form_intake_collection',
      'form_stock_record',
      'form_process_record',
      'form_reef_nursery',
      'form_dryer_table',
      'form_green_space'
    )
  ),
  constraint ag_form_share_links_kind_check check (
    link_kind in ('live', 'review')
  ),
  constraint ag_form_share_links_expiry_check check (
    expires_at is null or expires_at > created_at
  )
);

create unique index if not exists ag_form_share_links_one_active_idx
  on public.ag_form_share_links (organisation_id, form_key)
  where active;

create index if not exists ag_form_share_links_lookup_idx
  on public.ag_form_share_links (id, active, expires_at);

create table if not exists public.ag_shared_form_submissions (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null
    references public.ag_form_share_links(id) on delete restrict,
  organisation_id uuid not null
    references public.ag_aggregators(id) on delete restrict,
  form_key text not null,
  client_submission_id uuid not null,
  submission_kind text not null default 'test',
  submitter_name text,
  payload jsonb not null,
  client_key uuid,
  user_agent text,
  review_status text not null default 'new',
  created_at timestamptz not null default now(),
  constraint ag_shared_form_submissions_unique
    unique (share_link_id, client_submission_id),
  constraint ag_shared_form_submissions_kind_check check (
    submission_kind in ('test', 'live')
  ),
  constraint ag_shared_form_submissions_status_check check (
    review_status in ('new', 'reviewed', 'dismissed')
  ),
  constraint ag_shared_form_submissions_payload_check check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 250000
  ),
  constraint ag_shared_form_submissions_submitter_check check (
    submitter_name is null or length(trim(submitter_name)) between 2 and 100
  )
);

create index if not exists ag_shared_form_submissions_form_date_idx
  on public.ag_shared_form_submissions (
    organisation_id,
    form_key,
    created_at desc
  );

create table if not exists public.ag_form_share_rate_limits (
  share_link_id uuid not null
    references public.ag_form_share_links(id) on delete cascade,
  client_key uuid not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (share_link_id, client_key),
  constraint ag_form_share_rate_count_check check (request_count >= 0)
);

alter table public.ag_form_access_settings enable row level security;
alter table public.ag_form_share_links enable row level security;
alter table public.ag_shared_form_submissions enable row level security;
alter table public.ag_form_share_rate_limits enable row level security;

revoke all on table public.ag_form_access_settings
  from public, anon, authenticated;
revoke all on table public.ag_form_share_links
  from public, anon, authenticated;
revoke all on table public.ag_shared_form_submissions
  from public, anon, authenticated;
revoke all on table public.ag_form_share_rate_limits
  from public, anon, authenticated;

create or replace function public.ag_default_form_entry_access(
  p_organisation_code text,
  p_form_key text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when upper(coalesce(p_organisation_code, '')) = 'MAWIMBI'
      and p_form_key = 'form_intake_collection'
      then 'public'
    when upper(coalesce(p_organisation_code, '')) = 'SANDBOX'
      and p_form_key = 'form_green_space'
      then 'public'
    else 'private'
  end;
$$;

insert into public.ag_form_access_settings (
  organisation_id,
  form_key,
  entry_access,
  updated_at
)
select
  organisation.id,
  definition.form_key,
  public.ag_default_form_entry_access(
    organisation.aggregator_code,
    definition.form_key
  ),
  now()
from public.ag_aggregators organisation
cross join (
  values
    ('form_site_water_samples'),
    ('form_intake_collection'),
    ('form_stock_record'),
    ('form_process_record'),
    ('form_reef_nursery'),
    ('form_dryer_table'),
    ('form_green_space')
) definition(form_key)
where organisation.active
on conflict (organisation_id, form_key) do nothing;

create or replace function public.ag_form_manager_definition(
  p_form_key text
)
returns table (
  form_key text,
  capability_key text,
  form_name text,
  form_description text,
  form_route text,
  builder_route text,
  sharing_support text,
  sort_order integer
)
language sql
immutable
set search_path = public, pg_temp
as $$
  select definition.*
  from (
    values
      (
        'form_site_water_samples',
        'form_site_water_samples',
        'Site Water Samples',
        'Site water-quality measurements.',
        'site_water_sample.html',
        null,
        'private',
        10
      ),
      (
        'form_intake_collection',
        'form_intake_collection',
        'Intake Collection',
        'Seaweed intake, grading and weighing.',
        'collection.html',
        'admin_builder.html',
        'live',
        20
      ),
      (
        'form_stock_record',
        'form_stock_record',
        'Stock Record',
        'Stabilisation and packing records.',
        'stabilization_packing.html',
        null,
        'private',
        30
      ),
      (
        'form_process_record',
        'form_process_record',
        'Process Record',
        'Seaweed processing measurements.',
        'process_record.html',
        null,
        'private',
        40
      ),
      (
        'form_reef_nursery',
        'form_reef_nursery',
        'Reef Nursery',
        'COSME nursery training and raft inspection.',
        'reef_nursery.html',
        null,
        'review',
        50
      ),
      (
        'form_dryer_table',
        'form_dryer_table',
        'Dryer Table',
        'COSME dryer table measurements.',
        'dryer_table.html',
        null,
        'private',
        60
      ),
      (
        'form_green_space',
        'form_green_space',
        'Green Space Log',
        'Observation and reflection project.',
        'green-space/',
        null,
        'live',
        70
      )
  ) definition(
    form_key,
    capability_key,
    form_name,
    form_description,
    form_route,
    builder_route,
    sharing_support,
    sort_order
  )
  where definition.form_key = p_form_key;
$$;

create or replace function public.ag_admin_form_manager()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid;
  v_organisation public.ag_aggregators%rowtype;
  v_capabilities jsonb;
  v_forms jsonb;
begin
  perform public.ag_require_permission('can_manage_settings');
  v_organisation_id := public.ag_require_active_aggregator();
  perform public.ag_require_organisation_capability(
    'tool_form_builder',
    v_organisation_id
  );

  select organisation.*
  into v_organisation
  from public.ag_aggregators organisation
  where organisation.id = v_organisation_id
    and organisation.active;

  v_capabilities := public.ag_effective_organisation_capabilities(
    v_organisation_id,
    v_user_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'form_key', definition.form_key,
        'name', definition.form_name,
        'description', definition.form_description,
        'route', definition.form_route,
        'builder_route', definition.builder_route,
        'sharing_support', case
          when definition.form_key = 'form_intake_collection'
               and upper(v_organisation.aggregator_code) = 'MAWIMBI'
            then 'live'
          when definition.form_key = 'form_green_space'
               and upper(v_organisation.aggregator_code) = 'SANDBOX'
            then 'live'
          when definition.form_key = 'form_reef_nursery'
               and upper(v_organisation.aggregator_code) = 'COSME'
            then 'review'
          else 'private'
        end,
        'entry_access', coalesce(
          settings.entry_access,
          public.ag_default_form_entry_access(
            v_organisation.aggregator_code,
            definition.form_key
          )
        ),
        'share_link_id', share_link.id,
        'share_link_kind', share_link.link_kind,
        'share_link_expires_at', share_link.expires_at,
        'shared_submission_count', coalesce(submissions.submission_count, 0)
      )
      order by definition.sort_order
    ),
    '[]'::jsonb
  )
  into v_forms
  from (
    values
      ('form_site_water_samples', 'form_site_water_samples', 'Site Water Samples', 'Site water-quality measurements.', 'site_water_sample.html', null, 'private', 10),
      ('form_intake_collection', 'form_intake_collection', 'Intake Collection', 'Seaweed intake, grading and weighing.', 'collection.html', 'admin_builder.html', 'live', 20),
      ('form_stock_record', 'form_stock_record', 'Stock Record', 'Stabilisation and packing records.', 'stabilization_packing.html', null, 'private', 30),
      ('form_process_record', 'form_process_record', 'Process Record', 'Seaweed processing measurements.', 'process_record.html', null, 'private', 40),
      ('form_reef_nursery', 'form_reef_nursery', 'Reef Nursery', 'COSME nursery training and raft inspection.', 'reef_nursery.html', null, 'review', 50),
      ('form_dryer_table', 'form_dryer_table', 'Dryer Table', 'COSME dryer table measurements.', 'dryer_table.html', null, 'private', 60),
      ('form_green_space', 'form_green_space', 'Green Space Log', 'Observation and reflection project.', 'green-space/', null, 'live', 70)
  ) definition(
    form_key,
    capability_key,
    form_name,
    form_description,
    form_route,
    builder_route,
    sharing_support,
    sort_order
  )
  left join public.ag_form_access_settings settings
    on settings.organisation_id = v_organisation_id
    and settings.form_key = definition.form_key
  left join lateral (
    select link.id, link.link_kind, link.expires_at
    from public.ag_form_share_links link
    where link.organisation_id = v_organisation_id
      and link.form_key = definition.form_key
      and link.active
      and (link.expires_at is null or link.expires_at > now())
    order by link.created_at desc
    limit 1
  ) share_link on true
  left join lateral (
    select count(*)::integer as submission_count
    from public.ag_shared_form_submissions submission
    where submission.organisation_id = v_organisation_id
      and submission.form_key = definition.form_key
  ) submissions on true
  where coalesce(
    (v_capabilities ->> definition.capability_key)::boolean,
    false
  );

  return jsonb_build_object(
    'organisation', jsonb_build_object(
      'id', v_organisation.id,
      'code', v_organisation.aggregator_code,
      'name', v_organisation.organisation_name,
      'short_name', v_organisation.short_name
    ),
    'forms', v_forms
  );
end;
$$;

create or replace function public.ag_admin_save_form_access(
  p_form_key text,
  p_entry_access text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid;
  v_organisation_code text;
  v_definition record;
  v_existing text;
  v_link_kind text;
begin
  perform public.ag_require_permission('can_manage_settings');
  v_organisation_id := public.ag_require_active_aggregator();
  perform public.ag_require_organisation_capability(
    'tool_form_builder',
    v_organisation_id
  );
  perform public.ag_require_organisation_capability(
    p_form_key,
    v_organisation_id
  );

  select * into v_definition
  from public.ag_form_manager_definition(p_form_key);
  if not found then
    raise exception 'Unknown form.' using errcode = '22023';
  end if;

  select organisation.aggregator_code
  into v_organisation_code
  from public.ag_aggregators organisation
  where organisation.id = v_organisation_id;

  if p_entry_access not in ('private', 'link', 'public', 'review', 'paused') then
    raise exception 'Unknown form entry access.' using errcode = '22023';
  end if;
  if p_entry_access not in ('private', 'paused')
     and not (
       (p_form_key = 'form_intake_collection' and upper(v_organisation_code) = 'MAWIMBI')
       or (p_form_key = 'form_green_space' and upper(v_organisation_code) = 'SANDBOX')
       or (
         p_form_key = 'form_reef_nursery'
         and upper(v_organisation_code) = 'COSME'
         and p_entry_access = 'review'
       )
     ) then
    raise exception 'This form currently supports signed-in access only.'
      using errcode = '22023';
  end if;
  if v_definition.sharing_support = 'private'
     and p_entry_access not in ('private', 'paused') then
    raise exception 'This form currently supports signed-in access only.'
      using errcode = '22023';
  end if;
  if v_definition.sharing_support = 'review'
     and p_entry_access not in ('private', 'review', 'paused') then
    raise exception 'This form currently supports private access or a review link.'
      using errcode = '22023';
  end if;
  if v_definition.sharing_support = 'live'
     and p_entry_access not in ('private', 'link', 'public', 'paused') then
    raise exception 'This form supports private, link-only or public entry.'
      using errcode = '22023';
  end if;

  select coalesce(
    settings.entry_access,
    public.ag_default_form_entry_access(
      v_organisation_code,
      p_form_key
    )
  )
  into v_existing
  from (select 1) seed
  left join public.ag_form_access_settings settings
    on settings.organisation_id = v_organisation_id
    and settings.form_key = p_form_key;

  insert into public.ag_form_access_settings (
    organisation_id,
    form_key,
    entry_access,
    updated_at,
    updated_by
  ) values (
    v_organisation_id,
    p_form_key,
    p_entry_access,
    now(),
    v_user_id
  )
  on conflict (organisation_id, form_key) do update
  set entry_access = excluded.entry_access,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  if p_entry_access in ('link', 'review') then
    v_link_kind := case
      when p_entry_access = 'review' then 'review'
      else 'live'
    end;
    if not exists (
      select 1
      from public.ag_form_share_links link
      where link.organisation_id = v_organisation_id
        and link.form_key = p_form_key
        and link.link_kind = v_link_kind
        and link.active
        and (link.expires_at is null or link.expires_at > now())
    ) then
      update public.ag_form_share_links
      set active = false,
          revoked_at = now(),
          revoked_by = v_user_id
      where organisation_id = v_organisation_id
        and form_key = p_form_key
        and active;

      insert into public.ag_form_share_links (
        organisation_id,
        form_key,
        link_kind,
        created_by
      ) values (
        v_organisation_id,
        p_form_key,
        v_link_kind,
        v_user_id
      );
    end if;
  else
    update public.ag_form_share_links
    set active = false,
        revoked_at = now(),
        revoked_by = v_user_id
    where organisation_id = v_organisation_id
      and form_key = p_form_key
      and active;
  end if;

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  )
  select
    v_user_id,
    profile.email,
    'form_entry_access_updated',
    'form',
    p_form_key,
    jsonb_build_object(
      'organisation_id', v_organisation_id,
      'before', v_existing,
      'after', p_entry_access
    )
  from public.ag_user_profiles profile
  where profile.id = v_user_id;

  return public.ag_admin_form_manager();
end;
$$;

create or replace function public.ag_admin_regenerate_form_share_link(
  p_form_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid;
  v_entry_access text;
  v_link_kind text;
begin
  perform public.ag_require_permission('can_manage_settings');
  v_organisation_id := public.ag_require_active_aggregator();
  perform public.ag_require_organisation_capability(
    'tool_form_builder',
    v_organisation_id
  );
  perform public.ag_require_organisation_capability(
    p_form_key,
    v_organisation_id
  );

  select settings.entry_access
  into v_entry_access
  from public.ag_form_access_settings settings
  where settings.organisation_id = v_organisation_id
    and settings.form_key = p_form_key;

  if v_entry_access not in ('link', 'review') then
    raise exception 'This form does not currently use a share link.'
      using errcode = '22023';
  end if;
  v_link_kind := case when v_entry_access = 'review' then 'review' else 'live' end;

  update public.ag_form_share_links
  set active = false,
      revoked_at = now(),
      revoked_by = v_user_id
  where organisation_id = v_organisation_id
    and form_key = p_form_key
    and active;

  insert into public.ag_form_share_links (
    organisation_id,
    form_key,
    link_kind,
    created_by
  ) values (
    v_organisation_id,
    p_form_key,
    v_link_kind,
    v_user_id
  );

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  )
  select
    v_user_id,
    profile.email,
    'form_share_link_regenerated',
    'form',
    p_form_key,
    jsonb_build_object('organisation_id', v_organisation_id)
  from public.ag_user_profiles profile
  where profile.id = v_user_id;

  return public.ag_admin_form_manager();
end;
$$;

create or replace function public.ag_public_reef_training_matrix()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'section_key', section_row.section_key,
        'section_label', section_row.section_label,
        'section_order', section_row.section_order,
        'activities', section_row.activities
      )
      order by section_row.section_order
    ),
    '[]'::jsonb
  )
  from (
    select
      section.section_key,
      section.section_label,
      section.section_order,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', activity.id,
            'label', activity.activity_label,
            'activity_order', activity.activity_order
          )
          order by activity.activity_order, activity.id
        ) filter (where activity.id is not null),
        '[]'::jsonb
      ) as activities
    from public.ag_reef_training_matrix_sections section
    left join public.ag_reef_training_matrix_activities activity
      on activity.section_key = section.section_key
      and activity.is_active
    where section.is_active
    group by
      section.section_key,
      section.section_label,
      section.section_order
  ) section_row;
$$;

create or replace function public.ag_public_form_entry_context(
  p_form_key text,
  p_organisation_code text,
  p_share_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organisation public.ag_aggregators%rowtype;
  v_capabilities jsonb;
  v_entry_access text;
  v_share_link public.ag_form_share_links%rowtype;
  v_allowed boolean := false;
  v_training_matrix jsonb := null;
begin
  select organisation.*
  into v_organisation
  from public.ag_aggregators organisation
  where upper(organisation.aggregator_code) = upper(trim(p_organisation_code))
    and organisation.active
  limit 1;

  if v_organisation.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'Form unavailable');
  end if;

  v_capabilities := public.ag_organisation_capabilities(v_organisation.id);
  if not coalesce((v_capabilities ->> p_form_key)::boolean, false) then
    return jsonb_build_object('allowed', false, 'reason', 'Form unavailable');
  end if;

  select coalesce(
    settings.entry_access,
    public.ag_default_form_entry_access(
      v_organisation.aggregator_code,
      p_form_key
    )
  )
  into v_entry_access
  from (select 1) seed
  left join public.ag_form_access_settings settings
    on settings.organisation_id = v_organisation.id
    and settings.form_key = p_form_key;

  if v_entry_access = 'public' then
    v_allowed := true;
  elsif v_entry_access in ('link', 'review')
        and coalesce(p_share_token, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select link.*
    into v_share_link
    from public.ag_form_share_links link
    where link.id = p_share_token::uuid
      and link.organisation_id = v_organisation.id
      and link.form_key = p_form_key
      and link.link_kind = case
        when v_entry_access = 'review' then 'review'
        else 'live'
      end
      and link.active
      and (link.expires_at is null or link.expires_at > now());
    v_allowed := v_share_link.id is not null;
  end if;

  if v_allowed and p_form_key = 'form_reef_nursery' then
    v_training_matrix := public.ag_public_reef_training_matrix();
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'entry_access', v_entry_access,
    'form_key', p_form_key,
    'organisation_code', v_organisation.aggregator_code,
    'organisation_name', v_organisation.organisation_name,
    'share_link_id', v_share_link.id,
    'submission_kind', case
      when v_entry_access = 'review' then 'test'
      when v_allowed then 'live'
      else null
    end,
    'records_private', true,
    'training_matrix', v_training_matrix,
    'reason', case
      when v_allowed then null
      when v_entry_access = 'paused' then 'This form is paused.'
      when v_entry_access = 'private' then 'Sign in to open this form.'
      else 'This share link is invalid or no longer active.'
    end
  );
end;
$$;

create or replace function public.ag_public_shared_form_submission(
  p_share_token text,
  p_submission_id uuid,
  p_payload jsonb,
  p_submitter_name text default null,
  p_client_key uuid default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.ag_form_share_links%rowtype;
  v_settings public.ag_form_access_settings%rowtype;
  v_rate public.ag_form_share_rate_limits%rowtype;
  v_existing public.ag_shared_form_submissions%rowtype;
  v_saved public.ag_shared_form_submissions%rowtype;
  v_submitter_name text := nullif(trim(p_submitter_name), '');
begin
  if coalesce(p_share_token, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'This share link is invalid or no longer active.'
      using errcode = '42501';
  end if;
  if p_submission_id is null then
    raise exception 'A submission ID is required.' using errcode = '22023';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 250000 then
    raise exception 'The review submission is invalid or too large.'
      using errcode = '22023';
  end if;
  if v_submitter_name is not null
     and length(v_submitter_name) not between 2 and 100 then
    raise exception 'The submitter name must contain 2 to 100 characters.'
      using errcode = '22023';
  end if;

  select link.*
  into v_link
  from public.ag_form_share_links link
  where link.id = p_share_token::uuid
    and link.link_kind = 'review'
    and link.active
    and (link.expires_at is null or link.expires_at > now());
  if v_link.id is null then
    raise exception 'This share link is invalid or no longer active.'
      using errcode = '42501';
  end if;

  select settings.*
  into v_settings
  from public.ag_form_access_settings settings
  where settings.organisation_id = v_link.organisation_id
    and settings.form_key = v_link.form_key
    and settings.entry_access = 'review';
  if v_settings.organisation_id is null then
    raise exception 'This review link is no longer active.'
      using errcode = '42501';
  end if;

  select submission.*
  into v_existing
  from public.ag_shared_form_submissions submission
  where submission.share_link_id = v_link.id
    and submission.client_submission_id = p_submission_id;
  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'submission_id', v_existing.id,
      'created_at', v_existing.created_at
    );
  end if;

  if p_client_key is not null then
    select rate.*
    into v_rate
    from public.ag_form_share_rate_limits rate
    where rate.share_link_id = v_link.id
      and rate.client_key = p_client_key
    for update;

    if not found then
      insert into public.ag_form_share_rate_limits (
        share_link_id,
        client_key,
        request_count
      ) values (
        v_link.id,
        p_client_key,
        1
      );
    elsif v_rate.window_started_at <= now() - interval '1 hour' then
      update public.ag_form_share_rate_limits
      set window_started_at = now(),
          request_count = 1,
          updated_at = now()
      where share_link_id = v_link.id
        and client_key = p_client_key;
    elsif v_rate.request_count >= 20 then
      raise exception 'Several review submissions were recently sent. Please wait.'
        using errcode = 'P0001';
    else
      update public.ag_form_share_rate_limits
      set request_count = request_count + 1,
          updated_at = now()
      where share_link_id = v_link.id
        and client_key = p_client_key;
    end if;
  end if;

  insert into public.ag_shared_form_submissions (
    share_link_id,
    organisation_id,
    form_key,
    client_submission_id,
    submission_kind,
    submitter_name,
    payload,
    client_key,
    user_agent
  ) values (
    v_link.id,
    v_link.organisation_id,
    v_link.form_key,
    p_submission_id,
    'test',
    v_submitter_name,
    p_payload,
    p_client_key,
    left(p_user_agent, 500)
  )
  returning * into v_saved;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'submission_id', v_saved.id,
    'created_at', v_saved.created_at
  );
end;
$$;

revoke all on function public.ag_default_form_entry_access(text, text)
  from public, anon, authenticated;
revoke all on function public.ag_form_manager_definition(text)
  from public, anon, authenticated;
revoke all on function public.ag_admin_form_manager()
  from public, anon;
revoke all on function public.ag_admin_save_form_access(text, text)
  from public, anon;
revoke all on function public.ag_admin_regenerate_form_share_link(text)
  from public, anon;
revoke all on function public.ag_public_reef_training_matrix()
  from public, anon, authenticated;
revoke all on function public.ag_public_form_entry_context(text, text, text)
  from public, anon, authenticated;
revoke all on function public.ag_public_shared_form_submission(
  text, uuid, jsonb, text, uuid, text
) from public, anon, authenticated;

grant execute on function public.ag_admin_form_manager()
  to authenticated;
grant execute on function public.ag_admin_save_form_access(text, text)
  to authenticated;
grant execute on function public.ag_admin_regenerate_form_share_link(text)
  to authenticated;
grant execute on function public.ag_public_reef_training_matrix()
  to anon, authenticated, service_role;
grant execute on function public.ag_public_form_entry_context(text, text, text)
  to anon, authenticated, service_role;
grant execute on function public.ag_public_shared_form_submission(
  text, uuid, jsonb, text, uuid, text
) to anon, authenticated;

comment on table public.ag_form_access_settings is
  'Form-level entry mode. Organisation and user permissions remain separate.';
comment on table public.ag_form_share_links is
  'Revocable bearer links for link-only and review form entry.';
comment on table public.ag_shared_form_submissions is
  'Private test submissions from review links; never exposed to anonymous readers.';
comment on function public.ag_admin_form_manager() is
  'Returns forms enabled for the active organisation and their sharing state.';
comment on function public.ag_public_form_entry_context(text, text, text) is
  'Resolves public or bearer-link form entry without exposing stored records.';

notify pgrst, 'reload schema';

commit;
