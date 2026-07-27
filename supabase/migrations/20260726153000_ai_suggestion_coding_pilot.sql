begin;

alter table public.ag_site_feedback_automation_runs
  add column if not exists coding_authorized_at timestamptz,
  add column if not exists coding_authorization_source text
    check (coding_authorization_source is null or coding_authorization_source in ('auto_trusted_owner', 'manual_approval')),
  add column if not exists implementation_dispatch_status text,
  add column if not exists implementation_base_commit text,
  add column if not exists implementation_completed_at timestamptz;

create or replace function public.ag_authorize_site_feedback_coding(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_run public.ag_site_feedback_automation_runs%rowtype;
  v_actor public.ag_ai_automation_actors%rowtype;
  v_feedback public.ag_site_feedback%rowtype;
  v_lane text;
  v_likely_files jsonb;
begin
  select *
  into v_run
  from public.ag_site_feedback_automation_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'Automation run not found.' using errcode = 'P0002';
  end if;

  if v_run.mode <> 'dispatch' then
    raise exception 'Coding requires a dispatch-mode automation run.' using errcode = '42501';
  end if;

  if v_run.state <> 'assessment_complete' then
    raise exception 'Coding cannot start from state %.', v_run.state using errcode = '55000';
  end if;

  if v_run.decision <> 'implement' or v_run.risk_level <> 'low' then
    raise exception 'Automatic coding pilot is limited to low-risk implementation decisions.' using errcode = '42501';
  end if;

  v_lane := coalesce(v_run.assessment ->> 'lane', '');
  if v_lane <> 'A' then
    raise exception 'Automatic coding pilot is limited to Lane A.' using errcode = '42501';
  end if;

  if not v_run.can_auto_implement then
    raise exception 'The resolved actor is not authorised for automatic implementation.' using errcode = '42501';
  end if;

  if v_run.actor_user_id is null then
    raise exception 'Authenticated actor identity is required.' using errcode = '42501';
  end if;

  select *
  into v_actor
  from public.ag_ai_automation_actors
  where user_id = v_run.actor_user_id
    and active
    and trust_tier = 'trusted_product_owner'
    and can_auto_implement
    and v_run.source_app = any(allowed_apps);

  if not found then
    raise exception 'Trusted product owner configuration is not active.' using errcode = '42501';
  end if;

  select *
  into v_feedback
  from public.ag_site_feedback
  where id = v_run.feedback_id
    and automation_enabled;

  if not found or v_feedback.submitter_user_id is distinct from v_run.actor_user_id then
    raise exception 'Suggestion identity no longer matches the authorised actor.' using errcode = '42501';
  end if;

  v_likely_files := coalesce(v_run.assessment -> 'likely_files', '[]'::jsonb);
  if jsonb_typeof(v_likely_files) <> 'array' or jsonb_array_length(v_likely_files) < 1 then
    raise exception 'Assessment must identify likely files before coding.' using errcode = '22023';
  end if;

  update public.ag_site_feedback_automation_runs
  set state = 'coding',
      coding_authorized_at = now(),
      coding_authorization_source = 'auto_trusted_owner',
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
    'authorization_source', 'auto_trusted_owner',
    'may_edit_repository', true,
    'may_create_pull_request', true,
    'may_merge', false,
    'may_deploy', false
  );
end;
$$;

revoke all on function public.ag_authorize_site_feedback_coding(uuid) from public, anon, authenticated;
grant execute on function public.ag_authorize_site_feedback_coding(uuid) to service_role;

comment on function public.ag_authorize_site_feedback_coding(uuid) is
  'Authorises the disabled-by-default pilot coding lane only for low-risk Lane A suggestions from an active trusted product owner; merge and deployment remain prohibited.';

commit;
