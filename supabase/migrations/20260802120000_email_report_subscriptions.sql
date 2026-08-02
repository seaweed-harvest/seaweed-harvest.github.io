begin;

alter table public.ag_aggregator_memberships
  add column if not exists receive_weekly_summary_email boolean not null default false,
  add column if not exists receive_monthly_summary_email boolean not null default false;

comment on column public.ag_aggregator_memberships.receive_weekly_summary_email is
  'Sends this user the completed organisation week report at 08:00 Africa/Nairobi time each Monday.';
comment on column public.ag_aggregator_memberships.receive_monthly_summary_email is
  'Sends this user the completed organisation month report at 08:00 Africa/Nairobi time after month end.';

create index if not exists idx_ag_memberships_weekly_summary_recipients
  on public.ag_aggregator_memberships (aggregator_id, user_id)
  where is_active and receive_weekly_summary_email;
create index if not exists idx_ag_memberships_monthly_summary_recipients
  on public.ag_aggregator_memberships (aggregator_id, user_id)
  where is_active and receive_monthly_summary_email;

alter table public.ag_daily_record_email_deliveries
  add column if not exists report_type text not null default 'daily',
  add column if not exists period_start date;

update public.ag_daily_record_email_deliveries
set period_start = summary_date
where period_start is null;

alter table public.ag_daily_record_email_deliveries
  alter column period_start set not null,
  drop constraint if exists ag_daily_record_email_delivery_unique,
  drop constraint if exists ag_record_email_report_type_check;

alter table public.ag_daily_record_email_deliveries
  add constraint ag_record_email_report_type_check
    check (report_type in ('daily', 'weekly', 'monthly')),
  add constraint ag_record_email_delivery_unique
    unique (aggregator_id, report_type, summary_date, recipient_email);

create index if not exists idx_ag_record_email_delivery_report_history
  on public.ag_daily_record_email_deliveries
    (aggregator_id, report_type, summary_date desc, status);

comment on table public.ag_daily_record_email_deliveries is
  'Delivery and idempotency history for daily, weekly and monthly organisation record emails.';
comment on column public.ag_daily_record_email_deliveries.summary_date is
  'Final local date covered by the report.';

create or replace function public.ag_my_report_subscriptions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'Sign in to manage report subscriptions';
  end if;

  select nullif(lower(trim(profile.email)), '')
  into v_email
  from public.ag_user_profiles profile
  where profile.id = v_actor
    and profile.account_status = 'active';

  if not found then
    raise exception 'An active account is required';
  end if;

  select jsonb_build_object(
    'email', v_email,
    'subscriptions', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'aggregator_id', membership.aggregator_id,
          'aggregator_code', aggregator.aggregator_code,
          'organisation_name', aggregator.organisation_name,
          'short_name', aggregator.short_name,
          'daily', membership.receive_daily_summary_email,
          'weekly', membership.receive_weekly_summary_email,
          'monthly', membership.receive_monthly_summary_email
        )
        order by aggregator.organisation_name
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.ag_aggregator_memberships membership
  join public.ag_aggregators aggregator
    on aggregator.id = membership.aggregator_id
   and aggregator.active
  where membership.user_id = v_actor
    and membership.is_active;

  return coalesce(
    v_result,
    jsonb_build_object('email', v_email, 'subscriptions', '[]'::jsonb)
  );
end;
$$;

create or replace function public.ag_save_my_report_subscriptions(
  p_subscriptions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_requested_count integer;
  v_valid_count integer;
  v_enabled boolean;
begin
  if v_actor is null then
    raise exception 'Sign in to manage report subscriptions';
  end if;
  if p_subscriptions is null or jsonb_typeof(p_subscriptions) <> 'array' then
    raise exception 'Report subscriptions must be an array';
  end if;

  select nullif(lower(trim(profile.email)), '')
  into v_email
  from public.ag_user_profiles profile
  where profile.id = v_actor
    and profile.account_status = 'active';

  if not found then
    raise exception 'An active account is required';
  end if;

  select count(*), coalesce(bool_or(
    coalesce((item ->> 'daily')::boolean, false)
    or coalesce((item ->> 'weekly')::boolean, false)
    or coalesce((item ->> 'monthly')::boolean, false)
  ), false)
  into v_requested_count, v_enabled
  from jsonb_array_elements(p_subscriptions) item;

  select count(*)
  into v_valid_count
  from jsonb_array_elements(p_subscriptions) item
  join public.ag_aggregator_memberships membership
    on membership.aggregator_id = (item ->> 'aggregator_id')::uuid
   and membership.user_id = v_actor
   and membership.is_active;

  if v_valid_count <> v_requested_count then
    raise exception 'A report subscription refers to an unavailable organisation';
  end if;
  if v_enabled and v_email is null then
    raise exception 'Add an email address to receive reports';
  end if;

  update public.ag_aggregator_memberships membership
  set receive_daily_summary_email = coalesce((item ->> 'daily')::boolean, false),
      receive_weekly_summary_email = coalesce((item ->> 'weekly')::boolean, false),
      receive_monthly_summary_email = coalesce((item ->> 'monthly')::boolean, false),
      updated_at = now()
  from jsonb_array_elements(p_subscriptions) item
  where membership.user_id = v_actor
    and membership.is_active
    and membership.aggregator_id = (item ->> 'aggregator_id')::uuid;

  insert into public.ag_audit_log (
    actor_user_id,
    actor_email,
    action,
    target_type,
    target_id,
    details
  ) values (
    v_actor,
    v_email,
    'report_subscriptions_updated',
    'user',
    v_actor::text,
    jsonb_build_object('subscriptions', p_subscriptions)
  );

  return public.ag_my_report_subscriptions();
end;
$$;

revoke all on function public.ag_my_report_subscriptions()
  from public, anon, authenticated;
revoke all on function public.ag_save_my_report_subscriptions(jsonb)
  from public, anon, authenticated;
grant execute on function public.ag_my_report_subscriptions()
  to authenticated;
grant execute on function public.ag_save_my_report_subscriptions(jsonb)
  to authenticated;

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
    where jobname in (
      'weekly-record-email-summary-0800-eat',
      'monthly-record-email-summary-0800-eat'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'weekly-record-email-summary-0800-eat',
  '0 5 * * 1',
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
        'report_type', 'weekly',
        'aggregator_code', 'MAWIMBI'
      ),
      timeout_milliseconds := 120000
    );
  $cron$
);

select cron.schedule(
  'monthly-record-email-summary-0800-eat',
  '0 5 1 * *',
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
        'report_type', 'monthly',
        'aggregator_code', 'MAWIMBI'
      ),
      timeout_milliseconds := 120000
    );
  $cron$
);

notify pgrst, 'reload schema';

commit;
