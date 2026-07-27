begin;

alter table public.ag_site_feedback
  alter column automation_enabled set default false;

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
      notes = 'Disabled by the owner-only AI Assist trial.'
  where user_id <> v_owner_id;

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
    'Owner-only AI Assist trial. Draft pull requests only; merge and deployment are disabled.'
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

comment on column public.ag_site_feedback.automation_enabled is
  'True only when the authenticated protected owner explicitly selects AI Assist.';

commit;
