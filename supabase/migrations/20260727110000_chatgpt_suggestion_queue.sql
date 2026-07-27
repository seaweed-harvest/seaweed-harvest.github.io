begin;

do $$
declare
  v_owner_id uuid;
begin
  select id
  into v_owner_id
  from auth.users
  where lower(email) = 'bmichael@cascadiaseaweed.com'
  order by created_at
  limit 1;

  if v_owner_id is null then
    raise exception 'Protected AI Assist owner account was not found';
  end if;

  update public.ag_ai_automation_actors
  set active = false,
      can_auto_plan = false,
      can_auto_implement = false,
      can_auto_merge = false,
      updated_at = now(),
      notes = 'Disabled. Suggestions use the owner ChatGPT/Codex subscription queue.'
  where user_id <> v_owner_id;

  update public.ag_ai_automation_actors
  set active = true,
      allowed_apps = array['aggregation', 'green_space', 'tide']::text[],
      can_auto_plan = true,
      can_auto_implement = false,
      can_auto_merge = false,
      maximum_risk_level = 'low',
      updated_at = now(),
      notes = 'Owner-only ChatGPT/Codex subscription queue. API implementation, merge and deployment are disabled.'
  where user_id = v_owner_id;
end;
$$;

update public.ag_site_feedback
set automation_status = 'queued',
    automation_summary = 'Queued for review in the owner''s connected ChatGPT/Codex workspace.',
    automation_last_processed_at = null
where automation_enabled = true
  and automation_status in (
    'new',
    'shadow_assessing',
    'dispatched',
    'assessing',
    'failed'
  );

comment on column public.ag_site_feedback.automation_enabled is
  'True only when the authenticated protected owner explicitly queues the suggestion for ChatGPT/Codex review.';

commit;
