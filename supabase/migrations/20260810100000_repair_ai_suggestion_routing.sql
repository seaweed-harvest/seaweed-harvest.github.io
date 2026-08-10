begin;

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

  select * into v_feedback
  from public.ag_site_feedback
  where id = p_feedback_id
  for update;

  if not found then raise exception 'Feedback not found'; end if;
  if not v_feedback.automation_enabled or v_feedback.submitter_user_id is null then
    raise exception 'Authenticated suggestion record is required';
  end if;

  select * into v_existing
  from public.ag_site_feedback_automation_runs
  where feedback_id = p_feedback_id
  order by attempt_number desc
  limit 1;

  if found then
    if p_mode = 'dispatch'
      and v_existing.state in ('shadow_assessment_pending', 'held', 'failed', 'cancelled') then
      update public.ag_site_feedback_automation_runs
      set state = 'cancelled',
          completed_at = coalesce(completed_at, now()),
          updated_at = now()
      where id = v_existing.id
        and state <> 'cancelled';
    else
      update public.ag_site_feedback
      set automation_latest_run_id = v_existing.id,
          automation_last_processed_at = coalesce(automation_last_processed_at, now())
      where id = p_feedback_id;
      return v_existing.id;
    end if;
  end if;

  select * into v_actor
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
    v_target_repository := 'seaweed-harvest/seaweed-harvest.github.io';
  elsif v_feedback.source_app = 'tide' then
    v_target_key := 'seaweed-tide-planner';
    v_target_repository := 'bosunjm-cloud/Seaweed_Tide_App';
  else
    raise exception 'Unsupported source application';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
  from public.ag_site_feedback_automation_runs
  where feedback_id = p_feedback_id;

  insert into public.ag_site_feedback_automation_runs (
    feedback_id, attempt_number, mode, state, trust_tier, actor_user_id,
    can_auto_plan, can_auto_implement, can_auto_merge, maximum_risk_level,
    source_app, target_key, target_repository, correlation_key
  ) values (
    p_feedback_id, v_attempt, p_mode,
    case when p_mode = 'shadow' then 'shadow_assessment_pending' else 'dispatch_pending' end,
    v_trust_tier, v_feedback.submitter_user_id, v_can_auto_plan,
    v_can_auto_implement, v_can_auto_merge, v_maximum_risk_level,
    v_feedback.source_app, v_target_key, v_target_repository,
    p_feedback_id::text || ':' || v_attempt::text
  )
  returning id into v_run_id;

  update public.ag_site_feedback
  set automation_status = case when p_mode = 'shadow' then 'shadow_assessing' else 'queued' end,
      automation_summary = case
        when p_mode = 'shadow' then 'AI review is paused until its GitHub workflow and OpenAI API key are configured.'
        else 'Queued for authenticated suggestion assessment.'
      end,
      automation_latest_run_id = v_run_id,
      automation_last_processed_at = now(),
      status = case when status = 'new' then 'reviewing' else status end
  where id = p_feedback_id;

  return v_run_id;
end;
$$;

revoke all on function public.ag_create_site_feedback_automation_run(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ag_create_site_feedback_automation_run(uuid, text)
  to service_role;

update public.ag_site_feedback_automation_runs
set target_repository = 'seaweed-harvest/seaweed-harvest.github.io',
    state = case when state = 'shadow_assessment_pending' then 'held' else state end,
    error_code = case when state = 'shadow_assessment_pending' then 'automation_paused' else error_code end,
    error_message = case
      when state = 'shadow_assessment_pending'
        then 'AI review is paused until the GitHub workflow and OpenAI API key are configured.'
      else error_message
    end,
    completed_at = case when state = 'shadow_assessment_pending' then coalesce(completed_at, now()) else completed_at end,
    updated_at = now()
where source_app in ('aggregation', 'green_space')
  and state in ('shadow_assessment_pending', 'dispatch_pending', 'held', 'failed');

update public.ag_site_feedback feedback
set automation_status = 'held',
    automation_summary = 'AI review is paused until its GitHub workflow and OpenAI API key are configured.',
    automation_last_processed_at = now()
where feedback.automation_status = 'shadow_assessing'
  and feedback.status <> 'closed';

comment on function public.ag_create_site_feedback_automation_run(uuid, text) is
  'Creates one active suggestion automation run, routes Harvest work to the organisation repository, and permits an owner retry after paused or failed attempts.';

commit;
