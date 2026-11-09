-- Block approving or paying unresolved dryer anomalies without rewriting historic decisions.
-- An owner must correct/confirm source measurements before reapproval.
-- Historical partial submissions (loading-only or unloading-only) are not treated
-- as false measurements by default; an explicit unresolved flag still holds review.
create table if not exists private.seaweed_drying_data_quality_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.seaweed_drying_submissions(id) on delete restrict,
  issue_code text not null,
  review_status text not null default 'needs_confirmation'
    check (review_status in ('needs_confirmation','confirmed','dismissed')),
  probable_activity_type text
    check (probable_activity_type in ('loading','unloading','reweigh') or probable_activity_type is null),
  probable_activity_date date,
  evidence jsonb not null default '{}'::jsonb,
  review_note text,
  source text not null default 'owner_chat_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id,issue_code)
);
alter table private.seaweed_drying_data_quality_flags enable row level security;
revoke all on private.seaweed_drying_data_quality_flags from public,anon,authenticated;

create or replace function private.seaweed_drying_unverified_day_count(
 p_assistant_key text, p_activity_date date
) returns integer
language sql stable security definer
set search_path = ''
as $fn$
  with active_submissions as (
    select distinct e.submission_id
    from private.seaweed_drying_activity_entries() e
    where e.assistant_key=p_assistant_key and e.activity_date=p_activity_date
  )
  select count(*)::integer
  from active_submissions e
  where exists (
    select 1 from private.seaweed_drying_data_quality_flags f
    where f.submission_id=e.submission_id and f.review_status='needs_confirmation'
  )
  or exists (
    select 1 from public.seaweed_drying_bay_records b
    where b.submission_id=e.submission_id
      and (
        (b.loading_at is not null and (b.loading_weight_g is null or b.loading_weight_g <= 0))
        or
        (b.unloading_at is not null and b.loading_at is not null and (
          b.loading_weight_g is null or b.unloading_weight_g is null
          or b.unloading_weight_g < 0 or
          b.unloading_weight_g >= b.loading_weight_g or
          b.unloading_at < b.loading_at + interval '12 hours'
        ))
      )
  );
$fn$;

create or replace function private.seaweed_drying_guard_payment_integrity()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v_bad_date date;
  v_assistant text;
  v_decision uuid;
begin
  if tg_table_name='seaweed_drying_activity_day_decisions' then
    if new.approved_at is null then return new; end if;
    v_bad_date:=new.activity_date;
    v_assistant:=new.assistant_key;
  elsif tg_table_name='seaweed_drying_payment_activity_days' then
    v_bad_date:=new.activity_date;
    v_assistant:=new.assistant_key;
  elsif tg_table_name='seaweed_drying_payment_reviews' then
    if new.status<>'review_generated' then return new; end if;
    select d.id,d.assistant_key,d.activity_date
      into v_decision,v_assistant,v_bad_date
    from public.seaweed_drying_activity_day_decisions d
    where d.id=any(new.activity_day_decision_ids)
      and private.seaweed_drying_unverified_day_count(d.assistant_key,d.activity_date)>0
    order by d.activity_date limit 1;
    if v_bad_date is null then return new; end if;
  else
    raise exception 'Unexpected dryer payment integrity trigger on %',tg_table_name;
  end if;

  if private.seaweed_drying_unverified_day_count(v_assistant,v_bad_date)>0 then
    raise exception
      'Dryer activity on % includes unverified or implausible measurements. Correct or resolve flagged source records before approval/payment.',
      v_bad_date
      using errcode='23514';
  end if;
  return new;
end;
$fn$;

-- Direct approvals, PDF review generation and actual payment allocations all guarded.
drop trigger if exists seaweed_drying_guard_approval_integrity on public.seaweed_drying_activity_day_decisions;
create trigger seaweed_drying_guard_approval_integrity
before insert or update on public.seaweed_drying_activity_day_decisions
for each row execute function private.seaweed_drying_guard_payment_integrity();

drop trigger if exists seaweed_drying_guard_review_integrity on public.seaweed_drying_payment_reviews;
create trigger seaweed_drying_guard_review_integrity
before insert on public.seaweed_drying_payment_reviews
for each row execute function private.seaweed_drying_guard_payment_integrity();

drop trigger if exists seaweed_drying_guard_settlement_integrity on public.seaweed_drying_payment_activity_days;
create trigger seaweed_drying_guard_settlement_integrity
before insert on public.seaweed_drying_payment_activity_days
for each row execute function private.seaweed_drying_guard_payment_integrity();

revoke all on function private.seaweed_drying_unverified_day_count(text,date) from public,anon,authenticated;
revoke all on function private.seaweed_drying_guard_payment_integrity() from public,anon,authenticated;
