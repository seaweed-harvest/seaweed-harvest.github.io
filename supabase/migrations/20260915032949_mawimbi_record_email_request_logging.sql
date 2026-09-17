begin;
create table if not exists public.ag_record_email_requests (
  request_id bigint primary key,
  report_type text not null check (report_type in ('daily','weekly','monthly')),
  aggregator_code text not null,
  summary_date date,
  dry_run boolean not null default false,
  source text not null,
  queued_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'queued' check (status in ('queued','succeeded','failed','unknown')),
  status_code integer,
  timed_out boolean,
  error_text text,
  response_summary jsonb
);
alter table public.ag_record_email_requests enable row level security;
revoke all on public.ag_record_email_requests from public, anon, authenticated;
grant all on public.ag_record_email_requests to service_role;
comment on table public.ag_record_email_requests is 'Owner-authorised report transport diagnostics. No auth headers, secrets or full report payloads are stored. Capture responses before pg_net expiry.';
create index if not exists ag_record_email_requests_queued_at_idx on public.ag_record_email_requests (queued_at desc);

-- Approved no-send diagnostic through the existing authenticated sender.
-- The Vault credential stays inside Postgres and is not returned or logged.
insert into public.ag_record_email_requests (request_id, report_type, aggregator_code, summary_date, dry_run, source)
select net.http_post(
  url := 'https://wwzmajhdusfyfskppupg.supabase.co/functions/v1/daily-record-email-summary',
  headers := jsonb_build_object('Content-Type','application/json','x-daily-email-summary-secret',(
    select decrypted_secret from vault.decrypted_secrets where name = 'daily_aggregation_summary_secret' order by created_at desc limit 1
  )),
  body := jsonb_build_object('source','owner_diagnostic_20260915','report_type','weekly','aggregator_code','MAWIMBI','summary_date','2026-09-13','dry_run',true),
  timeout_milliseconds := 120000
), 'weekly', 'MAWIMBI', date '2026-09-13', true, 'owner_diagnostic_20260915';
commit;
