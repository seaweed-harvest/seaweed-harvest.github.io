begin;

alter table public.ag_site_feedback
  drop constraint if exists ag_site_feedback_source_app_check;

alter table public.ag_site_feedback
  add constraint ag_site_feedback_source_app_check
  check (source_app in ('aggregation', 'green_space', 'tide'));

alter table public.ag_site_feedback
  add column if not exists automation_enabled boolean;

update public.ag_site_feedback
set automation_enabled = false
where automation_enabled is null;

alter table public.ag_site_feedback
  alter column automation_enabled set default false,
  alter column automation_enabled set not null;

alter table public.ag_site_feedback
  add column if not exists automation_status text not null default 'new'
    check (automation_status in (
      'new',
      'queued',
      'shadow_assessing',
      'dispatched',
      'assessing',
      'assessment_complete',
      'approval_required',
      'coding',
      'testing',
      'pull_request_open',
      'merged',
      'deploying',
      'deployed',
      'held',
      'failed',
      'cancelled'
    )),
  add column if not exists automation_decision text,
  add column if not exists automation_risk_level text,
  add column if not exists automation_summary text,
  add column if not exists automation_last_processed_at timestamptz,
  add column if not exists automation_latest_run_id uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

create table if not exists public.ag_ai_automation_actors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trust_tier text not null default 'standard_submitter'
    check (trust_tier in ('standard_submitter', 'trusted_product_owner', 'system_operator')),
  active boolean not null default false,
  allowed_apps text[] not null default array[]::text[],
  can_auto_plan boolean not null default false,
  can_auto_implement boolean not null default false,
  can_auto_merge boolean not null default false,
  maximum_risk_level text not null default 'low'
    check (maximum_risk_level in ('low', 'moderate', 'high', 'protected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text,
  check (allowed_apps <@ array['aggregation', 'green_space', 'tide']::text[])
);

create table if not exists public.ag_site_feedback_automation_runs (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.ag_site_feedback(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  mode text not null default 'shadow' check (mode in ('shadow', 'dispatch')),
  state text not null default 'queued'
    check (state in (
      'queued',
      'shadow_assessment_pending',
      'dispatch_pending',
      'dispatched',
      'assessing',
      'assessment_complete',
      'approval_required',
      'coding',
      'testing',
      'pull_request_open',
      'merged',
      'deploying',
      'deployed',
      'held',
      'failed',
      'cancelled'
    )),
  trust_tier text not null default 'standard_submitter'
    check (trust_tier in ('standard_submitter', 'trusted_product_owner', 'system_operator')),
  actor_user_id uuid references auth.users(id) on delete set null,
  can_auto_plan boolean not null default false,
  can_auto_implement boolean not null default false,
  can_auto_merge boolean not null default false,
  maximum_risk_level text not null default 'low'
    check (maximum_risk_level in ('low', 'moderate', 'high', 'protected')),
  source_app text not null check (source_app in ('aggregation', 'green_space', 'tide')),
  target_key text not null,
  target_repository text not null,
  target_branch text not null default 'main',
  correlation_key text not null unique,
  decision text,
  risk_level text,
  assessment jsonb,
  implementation_plan jsonb,
  github_dispatch_status text,
  github_workflow_run_id bigint,
  github_branch text,
  github_commit_sha text,
  github_pull_request_number integer,
  github_pull_request_url text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feedback_id, attempt_number)
);

create index if not exists ag_site_feedback_automation_runs_feedback_idx
  on public.ag_site_feedback_automation_runs (feedback_id, attempt_number desc);

create index if not exists ag_site_feedback_automation_runs_state_idx
  on public.ag_site_feedback_automation_runs (state, created_at asc);

create index if not exists ag_site_feedback_automation_runs_repository_idx
  on public.ag_site_feedback_automation_runs (target_repository, created_at desc);

alter table public.ag_site_feedback
  drop constraint if exists ag_site_feedback_automation_latest_run_id_fkey;

alter table public.ag_site_feedback
  add constraint ag_site_feedback_automation_latest_run_id_fkey
  foreign key (automation_latest_run_id)
  references public.ag_site_feedback_automation_runs(id)
  on delete set null;

create or replace function public.ag_create_site_feedback_automation_run(
  p_feedback_id uuid,
  p_mode text default 'shadow'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_feedback public.ag_site_feedback%rowtype;
  v_actor public.ag_ai_automation_actors%rowtype;
  v_attempt integer;
  v_run_id uuid;
  v_target_key text;
  v_target_repository text;
  v_trust_tier text := 'standard_submitter';
  v_can_auto_plan boolean := false;
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

  if not v_feedback.automation_enabled then
    raise exception 'Automation is disabled for this suggestion';
  end if;

  if v_feedback.submitter_user_id is null then
    raise exception 'Authenticated AI Assist owner is required';
  end if;

  select *
  into v_actor
  from public.ag_ai_automation_actors
  where user_id = v_feedback.submitter_user_id
    and active = true
    and trust_tier = 'trusted_product_owner'
    and can_auto_plan = true
    and can_auto_merge = false
    and v_feedback.source_app = any(allowed_apps);

  if not found then
    raise exception 'AI Assist is not enabled for this authenticated owner';
  end if;

  v_trust_tier := v_actor.trust_tier;
  v_can_auto_plan := v_actor.can_auto_plan;
  v_can_auto_implement := v_actor.can_auto_implement;
  v_can_auto_merge := false;
  v_maximum_risk_level := v_actor.maximum_risk_level;

  if v_feedback.source_app in ('aggregation', 'green_space') then
    v_target_key := 'seaweed-harvest';
    v_target_repository := 'bosunjm-cloud/Seaweed_Ag_Hub';
  elsif v_feedback.source_app = 'tide' then
    v_target_key := 'seaweed-tide';
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

alter table public.ag_ai_automation_actors enable row level security;
alter table public.ag_site_feedback_automation_runs enable row level security;

revoke all on table public.ag_ai_automation_actors from anon, authenticated;
revoke all on table public.ag_site_feedback_automation_runs from anon, authenticated;
revoke all on function public.ag_create_site_feedback_automation_run(uuid, text) from public, anon, authenticated;

grant all on table public.ag_ai_automation_actors to service_role;
grant all on table public.ag_site_feedback_automation_runs to service_role;
grant execute on function public.ag_create_site_feedback_automation_run(uuid, text) to service_role;

comment on table public.ag_ai_automation_actors is
  'Authenticated users explicitly authorised for AI suggestion planning, implementation or merge lanes.';
comment on table public.ag_site_feedback_automation_runs is
  'One traceable processing attempt per suggestion dispatch, assessment, coding and deployment lifecycle.';
comment on function public.ag_create_site_feedback_automation_run(uuid, text) is
  'Creates an idempotent-numbered automation run with server-derived repository routing and actor permissions.';

commit;
