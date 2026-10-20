begin;
-- Owner-approved catch-up, not a forced resend. Existing sent rows are skipped.
insert into public.ag_record_email_requests (request_id, report_type, aggregator_code, summary_date, dry_run, source)
select net.http_post(
  url := 'https://wwzmajhdusfyfskppupg.supabase.co/functions/v1/daily-record-email-summary',
  headers := jsonb_build_object('Content-Type','application/json','x-daily-email-summary-secret',(
    select decrypted_secret from vault.decrypted_secrets where name = 'daily_aggregation_summary_secret' order by created_at desc limit 1
  )),
  body := jsonb_build_object('source','owner_recovery_20260915','report_type','weekly','aggregator_code','MAWIMBI','summary_date','2026-09-13','dry_run',false,'force',false),
  timeout_milliseconds := 120000
), 'weekly', 'MAWIMBI', date '2026-09-13', false, 'owner_recovery_20260915';
commit;
