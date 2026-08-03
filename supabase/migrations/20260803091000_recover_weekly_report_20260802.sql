-- One-time idempotent recovery for the weekly report that remained pending on
-- 3 August 2026. Resend receives the same idempotency key as earlier attempts.
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
    'source', 'missed_weekly_recovery',
    'report_type', 'weekly',
    'summary_date', '2026-08-02',
    'aggregator_code', 'MAWIMBI'
  ),
  timeout_milliseconds := 120000
);
