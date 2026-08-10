begin;

alter table public.ag_site_feedback_automation_runs
  add column if not exists implementation_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists implementation_approved_at timestamptz,
  add column if not exists slack_thread_ts text,
  add column if not exists external_task_url text;

create or replace function public.ag_is_trusted_product_owner(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.ag_ai_automation_actors actor
    where actor.user_id = p_user_id
      and actor.active
      and actor.trust_tier = 'trusted_product_owner'
      and actor.can_auto_plan
      and actor.can_auto_implement
      and not actor.can_auto_merge
  );
$$;

revoke all on function public.ag_is_trusted_product_owner(uuid)
  from public, anon, authenticated;
grant execute on function public.ag_is_trusted_product_owner(uuid) to service_role;

create or replace function public.ag_is_current_user_trusted_product_owner()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.ag_is_trusted_product_owner(auth.uid());
$$;

revoke all on function public.ag_is_current_user_trusted_product_owner()
  from public, anon;
grant execute on function public.ag_is_current_user_trusted_product_owner()
  to authenticated;

do $$
declare
  v_owner_id uuid;
begin
  select users.id
  into v_owner_id
  from auth.users users
  where lower(users.email) = 'bmichael@cascadiaseaweed.com'
  order by users.created_at
  limit 1;

  if v_owner_id is null then
    raise exception 'Trusted product-owner account was not found';
  end if;

  insert into public.ag_ai_automation_actors (
    user_id,
    trust_tier,
    active,
    allowed_apps,
    can_auto_plan,
    can_auto_implement,
    can_auto_merge,
    maximum_risk_level,
    created_by,
    updated_at,
    notes
  ) values (
    v_owner_id,
    'trusted_product_owner',
    true,
    array['aggregation', 'green_space', 'tide']::text[],
    true,
    true,
    false,
    'low',
    v_owner_id,
    now(),
    'UUID-authorised owner lane: low-risk Lane A branch and draft pull request only.'
  )
  on conflict (user_id) do update
  set trust_tier = excluded.trust_tier,
      active = excluded.active,
      allowed_apps = excluded.allowed_apps,
      can_auto_plan = excluded.can_auto_plan,
      can_auto_implement = excluded.can_auto_implement,
      can_auto_merge = excluded.can_auto_merge,
      maximum_risk_level = excluded.maximum_risk_level,
      updated_at = now(),
      notes = excluded.notes;
end;
$$;

create or replace function public.ag_prepare_site_feedback_automation()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.submitter_user_id is null then
    new.automation_enabled := false;
    new.automation_status := 'new';
    new.review_decision := 'review_required';
    return new;
  end if;

  new.automation_enabled := true;
  new.automation_status := 'queued';
  new.automation_summary := 'Queued for authenticated suggestion assessment.';
  new.review_decision := case
    when public.ag_is_trusted_product_owner(new.submitter_user_id) then 'approved'
    else 'review_required'
  end;
  return new;
end;
$$;

drop trigger if exists ag_site_feedback_prepare_automation on public.ag_site_feedback;
create trigger ag_site_feedback_prepare_automation
before insert on public.ag_site_feedback
for each row
execute function public.ag_prepare_site_feedback_automation();

update public.ag_site_feedback feedback
set automation_enabled = true,
    automation_status = case
      when feedback.automation_status in ('new', 'failed', 'cancelled') then 'queued'
      else feedback.automation_status
    end,
    automation_summary = case
      when feedback.automation_status in ('new', 'failed', 'cancelled')
        then 'Queued for authenticated suggestion assessment.'
      else feedback.automation_summary
    end,
    review_decision = case
      when public.ag_is_trusted_product_owner(feedback.submitter_user_id) then 'approved'
      else feedback.review_decision
    end
where feedback.submitter_user_id is not null
  and feedback.status <> 'closed';

create or replace function public.ag_create_site_feedback_automation_run(
  p_feedback_id uuid,
  p_mode text default 'dispatch'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_feedback public.ag_site_feedback%rowtype;
  v_actor public.ag_ai_automation_actors%rowtype;
  v_existing public.ag_site_feedback_automation_runs%rowtype;
  v_attempt integer;
  v_run_id uuid;
  v_target_key text;
  v_target_repository text;
  v_trust_tier text := 'standard_submitter';
  v_can_auto_plan boolean := true;
  v_can_auto_implement boolean := false;
  v_can_auto_merge boolean := false;
  v_maximum_risk_level text := 'low';
begin
  if p_mode not in ('shadow', 'dispatch') then
    raise exception 'Unknown automation mode';
  end if;

  select *
  into v_feedback
  from public.ag_site_feedback
  where id = p_feedback_id
  for update;

  if not found then
    raise exception 'Feedback not found';
  end if;
  if not v_feedback.automation_enabled or v_feedback.submitter_user_id is null then
    raise exception 'Authenticated suggestion record is required';
  end if;

  select *
  into v_existing
  from public.ag_site_feedback_automation_runs
  where feedback_id = p_feedback_id
  order by attempt_number desc
  limit 1;

  if found then
    update public.ag_site_feedback
    set automation_latest_run_id = v_existing.id,
        automation_last_processed_at = coalesce(automation_last_processed_at, now())
    where id = p_feedback_id;
    return v_existing.id;
  end if;

  select *
  into v_actor
  from public.ag_ai_automation_actors
  where user_id = v_feedback.submitter_user_id
    and active
    and can_auto_plan
    and not can_auto_merge
    and v_feedback.source_app = any(allowed_apps);

  if found then
    v_trust_tier := v_actor.trust_tier;
    v_can_auto_plan := v_actor.can_auto_plan;
    v_can_auto_implement := v_actor.trust_tier = 'trusted_product_owner'
      and v_actor.can_auto_implement;
    v_maximum_risk_level := v_actor.maximum_risk_level;
  end if;

  if v_feedback.source_app in ('aggregation', 'green_space') then
    v_target_key := 'seaweed-harvest';
    v_target_repository := 'bosunjm-cloud/Seaweed_Ag_Hub';
  elsif v_feedback.source_app = 'tide' then
    v_target_key := 'seaweed-tide-planner';
    v_target_repository := 'bosunjm-cloud/Seaweed_Tide_App';
  else
    raise exception 'Unsupported source application';
  end if;

  select coalesce(max(attempt_number), 0) + 1
  into v_attempt
  from public.ag_site_feedback_automation_runs
  where feedback_id = p_feedback_id;

  insert into public.ag_site_feedback_automation_runs (
    feedback_id,
    attempt_number,
    mode,
    state,
    trust_tier,
    actor_user_id,
    can_auto_plan,
    can_auto_implement,
    can_auto_merge,
    maximum_risk_level,
    source_app,
    target_key,
    target_repository,
    correlation_key
  ) values (
    p_feedback_id,
    v_attempt,
    p_mode,
    case when p_mode = 'shadow' then 'shadow_assessment_pending' else 'dispatch_pending' end,
    v_trust_tier,
    v_feedback.submitter_user_id,
    v_can_auto_plan,
    v_can_auto_implement,
    v_can_auto_merge,
    v_maximum_risk_level,
    v_feedback.source_app,
    v_target_key,
    v_target_repository,
    p_feedback_id::text || ':' || v_attempt::text
  )
  returning id into v_run_id;

  update public.ag_site_feedback
  set automation_status = case when p_mode = 'shadow' then 'shadow_assessing' else 'queued' end,
      automation_latest_run_id = v_run_id,
      automation_last_processed_at = now(),
      status = case when status = 'new' then 'reviewing' else status end
  where id = p_feedback_id;

  return v_run_id;
end;
$$;

create or replace function public.ag_authorize_site_feedback_coding(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_run public.ag_site_feedback_automation_runs%rowtype;
  v_feedback public.ag_site_feedback%rowtype;
  v_lane text;
  v_likely_files jsonb;
  v_authorization_source text;
begin
  select *
  into v_run
  from public.ag_site_feedback_automation_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'Automation run not found.' using errcode = 'P0002';
  end if;
  if v_run.mode <> 'dispatch' or v_run.state <> 'assessment_complete' then
    raise exception 'Coding requires an assessed dispatch-mode run.' using errcode = '55000';
  end if;
  if v_run.decision <> 'implement' or v_run.risk_level <> 'low' then
    raise exception 'Coding is limited to low-risk implementation decisions.' using errcode = '42501';
  end if;

  v_lane := coalesce(v_run.assessment ->> 'lane', '');
  if v_lane <> 'A' then
    raise exception 'Coding is limited to Lane A.' using errcode = '42501';
  end if;

  select *
  into v_feedback
  from public.ag_site_feedback
  where id = v_run.feedback_id
    and automation_enabled
    and submitter_user_id is not null;

  if not found or v_feedback.submitter_user_id is distinct from v_run.actor_user_id then
    raise exception 'Authoritative suggestion identity does not match the run actor.'
      using errcode = '42501';
  end if;

  if v_run.can_auto_implement
    and public.ag_is_trusted_product_owner(v_run.actor_user_id)
    and exists (
      select 1
      from public.ag_ai_automation_actors actor
      where actor.user_id = v_run.actor_user_id
        and v_run.source_app = any(actor.allowed_apps)
    ) then
    v_authorization_source := 'auto_trusted_owner';
  elsif v_run.implementation_approved_at is not null
    and public.ag_is_trusted_product_owner(v_run.implementation_approved_by) then
    v_authorization_source := 'manual_approval';
  else
    raise exception 'Trusted product-owner implementation approval is required.'
      using errcode = '42501';
  end if;

  v_likely_files := coalesce(v_run.assessment -> 'likely_files', '[]'::jsonb);
  if jsonb_typeof(v_likely_files) <> 'array' or jsonb_array_length(v_likely_files) < 1 then
    raise exception 'Assessment must identify likely files before coding.' using errcode = '22023';
  end if;

  update public.ag_site_feedback_automation_runs
  set state = 'coding',
      coding_authorized_at = now(),
      coding_authorization_source = v_authorization_source,
      implementation_dispatch_status = 'pending',
      updated_at = now(),
      completed_at = null,
      error_code = null,
      error_message = null
  where id = v_run.id;

  update public.ag_site_feedback
  set automation_status = 'coding',
      automation_last_processed_at = now()
  where id = v_run.feedback_id;

  return jsonb_build_object(
    'automation_run_id', v_run.id,
    'feedback_id', v_run.feedback_id,
    'source_app', v_run.source_app,
    'target_key', v_run.target_key,
    'target_repository', v_run.target_repository,
    'target_branch', v_run.target_branch,
    'authorization_source', v_authorization_source,
    'may_edit_repository', true,
    'may_create_pull_request', true,
    'may_merge', false,
    'may_deploy', false
  );
end;
$$;

create or replace function public.ag_claim_site_feedback_assessment_dispatch(
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_claimed_id uuid;
begin
  update public.ag_site_feedback_automation_runs
  set state = 'dispatched',
      github_dispatch_status = 'claiming',
      started_at = coalesce(started_at, now()),
      updated_at = now(),
      error_code = null,
      error_message = null
  where id = p_run_id
    and mode = 'dispatch'
    and state = 'dispatch_pending'
    and github_dispatch_status is null
    and slack_thread_ts is null
    and external_task_url is null
    and github_branch is null
    and github_pull_request_url is null
  returning id into v_claimed_id;

  return v_claimed_id is not null;
end;
$$;

create or replace function public.ag_owner_approve_suggestion_implementation(
  p_feedback_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner_id uuid := auth.uid();
  v_run public.ag_site_feedback_automation_runs%rowtype;
begin
  if not public.ag_is_trusted_product_owner(v_owner_id) then
    raise exception 'Trusted product-owner approval is required.' using errcode = '42501';
  end if;

  select runs.*
  into v_run
  from public.ag_site_feedback_automation_runs runs
  where runs.feedback_id = p_feedback_id
  order by runs.attempt_number desc
  limit 1
  for update;

  if not found then
    raise exception 'Suggestion has not been assessed.' using errcode = 'P0002';
  end if;
  if v_run.state not in ('assessment_complete', 'approval_required')
    or v_run.decision <> 'implement'
    or v_run.risk_level <> 'low'
    or coalesce(v_run.assessment ->> 'lane', '') <> 'A' then
    raise exception 'Only an assessed low-risk Lane A plan can be approved.'
      using errcode = '42501';
  end if;

  update public.ag_site_feedback_automation_runs
  set state = 'assessment_complete',
      implementation_approved_by = v_owner_id,
      implementation_approved_at = coalesce(implementation_approved_at, now()),
      updated_at = now()
  where id = v_run.id;

  update public.ag_site_feedback
  set review_decision = 'approved',
      automation_summary = coalesce(
        automation_summary,
        'Low-risk implementation approved by the trusted product owner.'
      ),
      automation_last_processed_at = now()
  where id = p_feedback_id;

  return v_run.id;
end;
$$;

revoke all on function public.ag_create_site_feedback_automation_run(uuid, text)
  from public, anon, authenticated;
revoke all on function public.ag_authorize_site_feedback_coding(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_claim_site_feedback_assessment_dispatch(uuid)
  from public, anon, authenticated;
revoke all on function public.ag_owner_approve_suggestion_implementation(uuid)
  from public, anon;
revoke all on function public.ag_prepare_site_feedback_automation()
  from public, anon, authenticated;
grant execute on function public.ag_create_site_feedback_automation_run(uuid, text)
  to service_role;
grant execute on function public.ag_authorize_site_feedback_coding(uuid)
  to service_role;
grant execute on function public.ag_claim_site_feedback_assessment_dispatch(uuid)
  to service_role;
grant execute on function public.ag_owner_approve_suggestion_implementation(uuid)
  to authenticated;

drop policy if exists ag_site_feedback_owner_photo_read on storage.objects;
create policy ag_site_feedback_owner_photo_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'site-feedback-photos'
  and public.ag_is_current_user_trusted_product_owner()
);

drop function if exists public.ag_owner_site_feedback(text, text, integer);

create function public.ag_owner_site_feedback(
  p_status text default 'open',
  p_search text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  created_at timestamptz,
  source_app text,
  source_page text,
  page_url text,
  feedback_type text,
  message text,
  submitter_user_id uuid,
  submitter_name text,
  submitter_email text,
  status text,
  review_decision text,
  photo_path text,
  photo_content_type text,
  photo_byte_size integer,
  slack_status text,
  closed_at timestamptz,
  automation_enabled boolean,
  automation_status text,
  automation_decision text,
  automation_risk_level text,
  automation_summary text,
  automation_last_processed_at timestamptz,
  automation_run_state text,
  automation_trust_tier text,
  automation_can_auto_implement boolean,
  automation_lane text,
  implementation_approved_at timestamptz,
  coding_authorization_source text,
  automation_branch text,
  automation_pull_request_url text,
  automation_error_message text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  if not public.ag_is_current_user_trusted_product_owner() then
    raise exception 'Suggestions workspace is available only to the trusted product owner.'
      using errcode = '42501';
  end if;
  if v_status is not null
    and v_status not in ('open', 'new', 'reviewing', 'planned', 'closed') then
    raise exception 'Unknown suggestion status.';
  end if;

  return query
  select
    feedback.id,
    feedback.created_at,
    feedback.source_app,
    feedback.source_page,
    feedback.page_url,
    feedback.feedback_type,
    feedback.message,
    feedback.submitter_user_id,
    feedback.submitter_name,
    feedback.submitter_email,
    feedback.status,
    feedback.review_decision,
    feedback.photo_path,
    feedback.photo_content_type,
    feedback.photo_byte_size,
    feedback.slack_status,
    feedback.closed_at,
    feedback.automation_enabled,
    feedback.automation_status,
    feedback.automation_decision,
    feedback.automation_risk_level,
    feedback.automation_summary,
    feedback.automation_last_processed_at,
    latest_run.state,
    latest_run.trust_tier,
    latest_run.can_auto_implement,
    latest_run.assessment ->> 'lane',
    latest_run.implementation_approved_at,
    latest_run.coding_authorization_source,
    latest_run.github_branch,
    latest_run.github_pull_request_url,
    latest_run.error_message
  from public.ag_site_feedback feedback
  left join public.ag_site_feedback_automation_runs latest_run
    on latest_run.id = feedback.automation_latest_run_id
  where (
      v_status is null
      or (v_status = 'open' and feedback.status <> 'closed')
      or (v_status <> 'open' and feedback.status = v_status)
    )
    and (
      v_search is null
      or feedback.message ilike '%' || v_search || '%'
      or feedback.source_page ilike '%' || v_search || '%'
      or feedback.submitter_name ilike '%' || v_search || '%'
      or feedback.submitter_email ilike '%' || v_search || '%'
    )
  order by
    case feedback.status
      when 'new' then 1
      when 'reviewing' then 2
      when 'planned' then 3
      else 4
    end,
    feedback.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

create or replace function public.ag_owner_update_site_feedback(
  p_feedback_id uuid,
  p_status text,
  p_review_decision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result public.ag_site_feedback%rowtype;
begin
  if not public.ag_is_current_user_trusted_product_owner() then
    raise exception 'Suggestions workspace is available only to the trusted product owner.'
      using errcode = '42501';
  end if;
  if p_status not in ('new', 'reviewing', 'planned', 'closed') then
    raise exception 'Unknown suggestion status.';
  end if;
  if p_review_decision is not null
    and p_review_decision not in ('approved', 'review_required', 'flagged') then
    raise exception 'Unknown review decision.';
  end if;

  update public.ag_site_feedback
  set status = p_status,
      review_decision = coalesce(p_review_decision, review_decision),
      closed_at = case when p_status = 'closed' then now() else null end,
      closed_by = case when p_status = 'closed' then auth.uid() else null end
  where id = p_feedback_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Suggestion was not found.';
  end if;

  return jsonb_build_object(
    'id', v_result.id,
    'status', v_result.status,
    'review_decision', v_result.review_decision,
    'closed_at', v_result.closed_at
  );
end;
$$;

revoke all on function public.ag_owner_site_feedback(text, text, integer) from public, anon;
revoke all on function public.ag_owner_update_site_feedback(uuid, text, text) from public, anon;
grant execute on function public.ag_owner_site_feedback(text, text, integer) to authenticated;
grant execute on function public.ag_owner_update_site_feedback(uuid, text, text) to authenticated;

comment on column public.ag_site_feedback.automation_enabled is
  'Server-derived: true for authenticated suggestions; trust and coding authority come from UUID actor records.';
comment on function public.ag_create_site_feedback_automation_run(uuid, text) is
  'Creates at most one authoritative automation run per suggestion UUID and reuses existing task, branch or pull-request state.';
comment on function public.ag_claim_site_feedback_assessment_dispatch(uuid) is
  'Atomically claims one pending assessment dispatch so concurrent callers cannot create duplicate GitHub tasks.';
comment on function public.ag_owner_approve_suggestion_implementation(uuid) is
  'Records trusted-owner UUID approval for a non-owner low-risk Lane A implementation; it does not merge or deploy.';

commit;
