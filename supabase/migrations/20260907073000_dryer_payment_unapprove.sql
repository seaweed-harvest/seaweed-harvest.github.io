-- Unapprove only an unpaid approval, retaining its values and an audit snapshot.
-- Apply before releasing the payment controller. No source activity or transfer is changed.
begin;

alter table public.seaweed_drying_activity_day_decisions
  add column if not exists approval_active boolean not null default true;

create table if not exists private.seaweed_drying_approval_withdrawals (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.seaweed_drying_activity_day_decisions(id) on delete restrict,
  withdrawn_at timestamptz not null default clock_timestamp(),
  withdrawn_by_user_id uuid not null,
  withdrawn_by_name text,
  approval_snapshot jsonb not null
);
alter table private.seaweed_drying_approval_withdrawals enable row level security;
revoke all on table private.seaweed_drying_approval_withdrawals from public, anon, authenticated;

create or replace function public.unapprove_authenticated_seaweed_drying_activity_day_decision(
  p_account_access_token text,
  p_decision_id uuid,
  p_expected_approved_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $$
declare
  v_profile jsonb;
  v_decision public.seaweed_drying_activity_day_decisions%rowtype;
begin
  v_profile := private.seaweed_harvest_cosme_finance_owner_profile(p_account_access_token);
  if p_decision_id is null or p_expected_approved_at is null then
    raise exception 'Choose an approved activity day and refresh before trying again.';
  end if;

  select * into v_decision
  from public.seaweed_drying_activity_day_decisions where id = p_decision_id;
  if not found then
    raise exception 'The activity-day approval was not found. Refresh and try again.';
  end if;

  -- Share the existing payment lock first, then the save-decision lock and row lock.
  -- This prevents a concurrent payment or reapproval from being silently withdrawn.
  perform pg_advisory_xact_lock(hashtextextended('dryer-payment:' || v_decision.assistant_key, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'dryer-decision:' || v_decision.assistant_key || ':' || v_decision.activity_date::text, 0));
  select * into v_decision
  from public.seaweed_drying_activity_day_decisions where id = p_decision_id for update;
  if not found then
    raise exception 'The activity-day approval was not found. Refresh and try again.';
  end if;
  if exists (select 1 from public.seaweed_drying_payment_activity_days
             where activity_day_decision_id = p_decision_id) then
    raise exception 'This activity day has already been paid and cannot be unapproved.';
  end if;
  if v_decision.approved_at is distinct from p_expected_approved_at then
    raise exception 'This approval changed. Refresh and review it before unapproving.';
  end if;
  if not v_decision.approval_active then
    return to_jsonb(v_decision);
  end if;

  insert into private.seaweed_drying_approval_withdrawals (
    decision_id, withdrawn_by_user_id, withdrawn_by_name, approval_snapshot
  ) values (
    v_decision.id, (v_profile->>'id')::uuid,
    nullif(btrim(coalesce(v_profile->>'display_name', v_profile->>'email', '')), ''),
    to_jsonb(v_decision)
  );
  update public.seaweed_drying_activity_day_decisions
  set approval_active = false, updated_at = clock_timestamp()
  where id = p_decision_id
  returning * into v_decision;
  return to_jsonb(v_decision);
end;
$$;
revoke all on function public.unapprove_authenticated_seaweed_drying_activity_day_decision(text, uuid, timestamptz)
  from public, anon, authenticated;
-- The established bridge accepts the external account token; the helper authenticates it.
grant execute on function public.unapprove_authenticated_seaweed_drying_activity_day_decision(text, uuid, timestamptz)
  to anon;

-- Narrow, fail-closed edits to the installed functions preserve their other behaviour,
-- existing grants, daily calculations and payment snapshots. Do not rewrite old migrations.
do $migration$
declare
  v_target regprocedure;
  v_old text;
  v_new text;
  v_definition text;
begin
  for v_target, v_old, v_new in
    select * from (values
      ('public.list_authenticated_seaweed_drying_payment_workspace(text,integer)'::regprocedure,
       $old$      decision.approved_at,$old$,
       $new$      decision.approved_at,
      coalesce(decision.approval_active, false) as approval_active,$new$),
      ('public.list_authenticated_seaweed_drying_payment_workspace(text,integer)'::regprocedure,
       $old$        when allocation.activity_day_decision_id is not null then 'paid'$old$,
       $new$        when allocation.activity_day_decision_id is not null then 'paid'
        when decision.id is not null and not decision.approval_active then 'needs_review'$new$),
      ('public.save_authenticated_seaweed_drying_activity_day_decision(text,text,date,integer,integer,text)'::regprocedure,
       $old$    approved_at = excluded.approved_at,$old$,
       $new$    approved_at = excluded.approved_at,
    approval_active = true,$new$),
      ('public.record_authenticated_seaweed_drying_activity_payment(text,uuid,uuid[],date,text,text)'::regprocedure,
       $old$  loop
    v_snapshot := private.seaweed_drying_activity_day_snapshot($old$,
       $new$  loop
    if not v_decision.approval_active then
      raise exception 'Activity day % is not approved. Review and approve it before payment.',
        v_decision.activity_date;
    end if;
    v_snapshot := private.seaweed_drying_activity_day_snapshot($new$)
    ) as patches(target, old_text, new_text)
  loop
    select pg_get_functiondef(v_target) into v_definition;
    if strpos(v_definition, v_new) > 0 then
      continue; -- Safe migration retry; do not duplicate the added guard.
    end if;
    if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'Unapprove migration stopped: expected one patch anchor in %.', v_target;
    end if;
    execute replace(v_definition, v_old, v_new);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
