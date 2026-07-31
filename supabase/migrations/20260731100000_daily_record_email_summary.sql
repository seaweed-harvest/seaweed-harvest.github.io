begin;

alter table public.ag_aggregator_memberships
  add column if not exists receive_daily_summary_email boolean not null default false;

comment on column public.ag_aggregator_memberships.receive_daily_summary_email is
  'Sends this user the organisation daily record email at 08:00 Africa/Nairobi time.';

create index if not exists idx_ag_memberships_daily_summary_recipients
  on public.ag_aggregator_memberships (aggregator_id, user_id)
  where is_active and receive_daily_summary_email;

create table if not exists public.ag_daily_record_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  aggregator_id uuid not null references public.ag_aggregators(id) on delete restrict,
  summary_date date not null,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  subject text,
  summary_payload jsonb not null default '{}'::jsonb,
  provider_message_id text,
  error_text text,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ag_daily_record_email_recipient_normalized
    check (recipient_email = lower(trim(recipient_email))),
  constraint ag_daily_record_email_delivery_unique
    unique (aggregator_id, summary_date, recipient_email)
);

create index if not exists idx_ag_daily_record_email_delivery_history
  on public.ag_daily_record_email_deliveries
    (aggregator_id, summary_date desc, status);

alter table public.ag_daily_record_email_deliveries enable row level security;
revoke all on public.ag_daily_record_email_deliveries
  from public, anon, authenticated;

create or replace function public.ag_admin_daily_summary_recipient_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  perform public.ag_require_permission('can_manage_users');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', membership.user_id,
        'aggregator_id', membership.aggregator_id
      )
      order by aggregator.organisation_name, profile.display_name, profile.email
    ),
    '[]'::jsonb
  )
  into v_result
  from public.ag_aggregator_memberships membership
  join public.ag_aggregators aggregator
    on aggregator.id = membership.aggregator_id
    and aggregator.active
  join public.ag_user_profiles profile
    on profile.id = membership.user_id
  where membership.is_active
    and membership.receive_daily_summary_email
    and profile.account_status = 'active'
    and nullif(trim(profile.email), '') is not null
    and (
      public.ag_is_system_admin(v_actor)
      or exists (
        select 1
        from public.ag_aggregator_memberships actor_membership
        where actor_membership.user_id = v_actor
          and actor_membership.aggregator_id = membership.aggregator_id
          and actor_membership.membership_role = 'aggregator_admin'
          and actor_membership.is_active
      )
    );

  return v_result;
end;
$$;

revoke all on function public.ag_admin_daily_summary_recipient_state()
  from public, anon, authenticated;
grant execute on function public.ag_admin_daily_summary_recipient_state()
  to authenticated;

update public.ag_aggregator_memberships membership
set
  receive_daily_summary_email = true,
  updated_at = now()
from public.ag_aggregators aggregator,
     public.ag_user_profiles profile
where membership.aggregator_id = aggregator.id
  and membership.user_id = profile.id
  and aggregator.aggregator_code = 'MAWIMBI'
  and lower(profile.email) = 'bmichael@cascadiaseaweed.com'
  and membership.is_active;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'daily-record-email-summary-0800-eat'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'daily-record-email-summary-0800-eat',
  '0 5 * * *',
  $cron$
    select net.http_post(
      url := 'https://wwzmajhdusfyfskppupg.supabase.co/functions/v1/daily-record-email-summary',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-daily-email-summary-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'daily_aggregation_summary_secret'
          order by created_at desc
          limit 1
        )
      ),
      body := jsonb_build_object(
        'source', 'pg_cron',
        'aggregator_code', 'MAWIMBI'
      ),
      timeout_milliseconds := 60000
    );
  $cron$
);

notify pgrst, 'reload schema';

commit;
