begin;

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
      'weekly-record-email-summary-retry-0820-eat',
      'monthly-record-email-summary-0800-eat',
      'monthly-record-email-summary-retry-0825-eat'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

-- Stagger period reports after the daily 08:00 EAT report. The retry jobs are
-- safe because the Edge Function skips delivery rows already marked as sent.
select cron.schedule(
  'weekly-record-email-summary-0800-eat',
  '5 5 * * 1',
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
  'weekly-record-email-summary-retry-0820-eat',
  '20 5 * * 1',
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
        'source', 'pg_cron_retry',
        'report_type', 'weekly',
        'aggregator_code', 'MAWIMBI'
      ),
      timeout_milliseconds := 120000
    );
  $cron$
);

select cron.schedule(
  'monthly-record-email-summary-0800-eat',
  '10 5 1 * *',
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

select cron.schedule(
  'monthly-record-email-summary-retry-0825-eat',
  '25 5 1 * *',
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
        'source', 'pg_cron_retry',
        'report_type', 'monthly',
        'aggregator_code', 'MAWIMBI'
      ),
      timeout_milliseconds := 120000
    );
  $cron$
);

commit;
