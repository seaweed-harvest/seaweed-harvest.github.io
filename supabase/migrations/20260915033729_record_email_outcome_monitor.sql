begin;
set local plpgsql.check_asserts = on;

-- Transport outcomes survive pg_net expiry; no raw response/report is retained.
create or replace function public.ag_record_email_response_outcome(
  p_status_code integer, p_timed_out boolean, p_error text, p_content text
) returns jsonb
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_body jsonb := '{}'::jsonb;
  v_failed boolean;
  v_error text;
  v_summary jsonb;
begin
  begin
    v_body := coalesce(p_content::jsonb, '{}'::jsonb);
    if jsonb_typeof(v_body) <> 'object' then v_body := '{}'::jsonb; end if;
  exception when invalid_text_representation then
    v_body := '{}'::jsonb;
  end;
  v_failed := coalesce(p_timed_out, false)
    or nullif(p_error, '') is not null
    or p_status_code is null or p_status_code not between 200 and 299
    or v_body -> 'ok' is distinct from 'true'::jsonb
    or coalesce(v_body -> 'failed_count', '0'::jsonb) <> '0'::jsonb;
  if v_failed then
    v_error := coalesce(nullif(v_body ->> 'error', ''), nullif(p_error, ''),
      case when p_timed_out then 'Report HTTP request timed out'
           when p_status_code between 200 and 299 then 'Report returned an unsuccessful or unexpected response'
           else 'Report HTTP request failed: ' || coalesce(p_status_code::text, 'no status') end);
    v_error := regexp_replace(v_error, 'Bearer[[:space:]]+[^[:space:]]+', 'Bearer [redacted]', 'gi');
    v_error := regexp_replace(v_error, 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[redacted-token]', 'g');
    v_error := regexp_replace(v_error, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '[redacted-email]', 'g');
    v_error := left(v_error, 1000);
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_summary
  from jsonb_each(v_body)
  where key in ('ok','dry_run','report_type','period_start','period_end','summary_date',
    'recipient_count','sent_count','skipped_count','failed_count','report_skipped',
    'skip_reason','no_recipients');
  return jsonb_build_object('status', case when v_failed then 'failed' else 'succeeded' end,
    'error_text', v_error, 'response_summary', v_summary);
end;
$$;

create or replace function public.ag_record_email_retry_due(
  p_status text, p_queued_at timestamptz, p_attempt_count bigint, p_now timestamptz
) returns boolean
language sql immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(p_status in ('failed','unknown')
    and p_queued_at <= p_now - interval '15 minutes'
    and p_queued_at >= p_now - interval '8 days'
    and p_attempt_count < 3, false);
$$;

create or replace function public.ag_enqueue_record_email_request(
  p_report_type text, p_summary_date date default null,
  p_dry_run boolean default false, p_source text default 'pg_cron'
) returns bigint
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_end date;
  v_org uuid;
  v_request_id bigint;
  v_secret text;
begin
  if p_report_type is null or p_report_type not in ('daily','weekly','monthly') then
    raise exception 'Invalid report type';
  end if;
  if p_dry_run is null or p_source is null then raise exception 'Invalid report options'; end if;
  v_end := coalesce(p_summary_date, case p_report_type
    when 'daily' then v_today - 1
    when 'weekly' then date_trunc('week', v_today::timestamp)::date - 1
    else date_trunc('month', v_today::timestamp)::date - 1 end);
  select id into strict v_org from public.ag_aggregators
    where aggregator_code = 'MAWIMBI' and active;

  -- Serialize the fixed retry and the recovery check, without changing recipients.
  perform pg_advisory_xact_lock(hashtextextended('mawimbi-report:' || p_report_type || ':' || v_end::text, 0));
  if not p_dry_run then
    if exists (
      select 1 from public.ag_record_email_requests
      where aggregator_code = 'MAWIMBI' and report_type = p_report_type
        and summary_date = v_end and not dry_run and status = 'queued'
        and queued_at > now() - interval '5 minutes'
    ) then return null; end if;
    -- The sender still retains its own per-recipient and provider idempotency.
    if not exists (
      select 1 from public.ag_aggregator_memberships m
      join public.ag_user_profiles p on p.id = m.user_id
      where m.aggregator_id = v_org and m.is_active and p.account_status = 'active'
        and case p_report_type
          when 'daily' then m.receive_daily_summary_email
          when 'weekly' then m.receive_weekly_summary_email
          else m.receive_monthly_summary_email end
        and not exists (
          select 1 from public.ag_daily_record_email_deliveries d
          where d.aggregator_id = v_org and d.report_type = p_report_type
            and d.summary_date = v_end and d.recipient_email = lower(trim(p.email))
            and d.status = 'sent'
        )
    ) then return null; end if;
    if p_source = 'pg_cron_recovery' and (
      p_report_type <> 'weekly' or v_end < v_today - 8 or
      (select count(*) from public.ag_record_email_requests
       where aggregator_code = 'MAWIMBI' and report_type = p_report_type
         and summary_date = v_end and not dry_run
         and source in ('pg_cron','pg_cron_retry','pg_cron_recovery')) >= 3
    ) then return null; end if;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'daily_aggregation_summary_secret' order by created_at desc limit 1;
  if nullif(v_secret, '') is null then raise exception 'Report scheduler credential is not configured'; end if;
  v_request_id := net.http_post(
    url := 'https://wwzmajhdusfyfskppupg.supabase.co/functions/v1/daily-record-email-summary',
    headers := jsonb_build_object('Content-Type','application/json','x-daily-email-summary-secret',v_secret),
    body := jsonb_build_object('source',p_source,'report_type',p_report_type,'aggregator_code','MAWIMBI',
      'summary_date',v_end,'dry_run',p_dry_run,'force',false),
    timeout_milliseconds := case when p_report_type = 'daily' then 60000 else 120000 end
  );
  insert into public.ag_record_email_requests
    (request_id,report_type,aggregator_code,summary_date,dry_run,source)
  values (v_request_id,p_report_type,'MAWIMBI',v_end,p_dry_run,p_source);
  return v_request_id;
end;
$$;

create or replace function public.ag_monitor_record_email_requests()
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_captured integer;
  v_missing integer;
  v_retried integer := 0;
begin
  update public.ag_record_email_requests q
  set status = o.outcome ->> 'status', status_code = r.status_code,
      timed_out = r.timed_out, error_text = o.outcome ->> 'error_text',
      response_summary = o.outcome -> 'response_summary', completed_at = now()
  from net._http_response r
  cross join lateral (select public.ag_record_email_response_outcome(
    r.status_code,r.timed_out,r.error_msg,r.content) as outcome) o
  where q.request_id = r.id and q.status in ('queued','unknown');
  get diagnostics v_captured = row_count;

  update public.ag_record_email_requests
  set status = 'unknown', completed_at = now(),
      error_text = 'No HTTP response was available five minutes after queuing; outcome is unknown, not successful.'
  where status = 'queued' and queued_at < now() - interval '5 minutes';
  get diagnostics v_missing = row_count;

  -- Only failed automatic weekly sends are recoverable. Never retry diagnostics.
  for v_row in
    select * from (
      select q.*, count(*) over (partition by aggregator_code,report_type,summary_date) as attempts,
        row_number() over (partition by aggregator_code,report_type,summary_date
          order by queued_at desc,request_id desc) as newest
      from public.ag_record_email_requests q
      where report_type = 'weekly' and not dry_run
        and source in ('pg_cron','pg_cron_retry','pg_cron_recovery')
    ) recent
    where newest = 1 and public.ag_record_email_retry_due(status,queued_at,attempts,now())
  loop
    if public.ag_enqueue_record_email_request('weekly',v_row.summary_date,false,'pg_cron_recovery') is not null then
      v_retried := v_retried + 1;
    end if;
  end loop;
  return jsonb_build_object('captured',v_captured,'unknown',v_missing,'retries_queued',v_retried);
end;
$$;

revoke all on function public.ag_record_email_response_outcome(integer,boolean,text,text) from public,anon,authenticated;
revoke all on function public.ag_record_email_retry_due(text,timestamptz,bigint,timestamptz) from public,anon,authenticated;
revoke all on function public.ag_enqueue_record_email_request(text,date,boolean,text) from public,anon,authenticated;
revoke all on function public.ag_monitor_record_email_requests() from public,anon,authenticated;
grant execute on function public.ag_record_email_response_outcome(integer,boolean,text,text) to service_role;
grant execute on function public.ag_record_email_retry_due(text,timestamptz,bigint,timestamptz) to service_role;
grant execute on function public.ag_enqueue_record_email_request(text,date,boolean,text) to service_role;
grant execute on function public.ag_monitor_record_email_requests() to service_role;

-- Tests are side-effect-free and abort the whole migration on any failure.
do $$
declare
  v_now timestamptz := timestamptz '2026-09-15 03:00:00+00';
  v_result jsonb;
begin
  assert public.ag_record_email_response_outcome(200,false,null,'{"ok":true,"sent_count":4,"failed_count":0}') ->> 'status' = 'succeeded';
  assert public.ag_record_email_response_outcome(200,false,null,'{"ok":true,"report_skipped":true,"skip_reason":"no_operational_records"}') ->> 'status' = 'succeeded';
  assert public.ag_record_email_response_outcome(200,false,null,'{"ok":true,"sent_count":0,"skipped_count":4,"failed_count":0}') ->> 'status' = 'succeeded';
  assert public.ag_record_email_response_outcome(500,false,null,'{"ok":false,"error":"Build failed"}') ->> 'status' = 'failed';
  assert public.ag_record_email_response_outcome(null,true,'Timeout',null) ->> 'status' = 'failed';
  assert public.ag_record_email_response_outcome(401,false,null,'{"error":"Unauthorized"}') ->> 'status' = 'failed';
  assert public.ag_record_email_response_outcome(200,false,null,'{"ok":true,"failed_count":1}') ->> 'status' = 'failed';
  assert public.ag_record_email_response_outcome(200,false,null,'not JSON') ->> 'status' = 'failed';
  assert public.ag_record_email_response_outcome(200,false,null,'[]') ->> 'status' = 'failed';
  v_result := public.ag_record_email_response_outcome(500,false,null,
    '{"ok":false,"error":"Bad recipient person@example.test Bearer TEST_VALUE","summary":{"private":"data"},"recipients":["person@example.test"]}');
  assert position('person@example.test' in v_result::text) = 0;
  assert position('TEST_VALUE' in v_result::text) = 0;
  assert not ((v_result -> 'response_summary') ?| array['summary','recipients','deliveries']);
  assert public.ag_record_email_retry_due('failed',v_now - interval '16 minutes',1,v_now);
  assert public.ag_record_email_retry_due('unknown',v_now - interval '16 minutes',2,v_now);
  assert not public.ag_record_email_retry_due('succeeded',v_now - interval '16 minutes',1,v_now);
  assert not public.ag_record_email_retry_due('queued',v_now - interval '16 minutes',1,v_now);
  assert not public.ag_record_email_retry_due('failed',v_now - interval '5 minutes',1,v_now);
  assert not public.ag_record_email_retry_due('failed',v_now - interval '16 minutes',3,v_now);
  assert not public.ag_record_email_retry_due('failed',v_now - interval '9 days',1,v_now);
  assert not has_function_privilege('anon','public.ag_enqueue_record_email_request(text,date,boolean,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.ag_enqueue_record_email_request(text,date,boolean,text)','EXECUTE');
  assert not has_function_privilege('anon','public.ag_monitor_record_email_requests()','EXECUTE');
  assert not has_function_privilege('authenticated','public.ag_monitor_record_email_requests()','EXECUTE');
  assert has_function_privilege('service_role','public.ag_enqueue_record_email_request(text,date,boolean,text)','EXECUTE');
  assert not has_table_privilege('anon','public.ag_record_email_requests','SELECT');
  assert not has_table_privilege('authenticated','public.ag_record_email_requests','SELECT');
  assert (select relrowsecurity from pg_class where oid='public.ag_record_email_requests'::regclass);
end;
$$;

-- Keep all original job IDs, schedules and active settings. Only wrap dispatch.
do $$
declare v_job record; v_count integer := 0;
begin
  for v_job in
    select j.jobid, m.report_type, m.source
    from cron.job j join (values
      ('daily-record-email-summary-0800-eat','daily','pg_cron'),
      ('weekly-record-email-summary-0800-eat','weekly','pg_cron'),
      ('weekly-record-email-summary-retry-0820-eat','weekly','pg_cron_retry'),
      ('monthly-record-email-summary-0800-eat','monthly','pg_cron'),
      ('monthly-record-email-summary-retry-0825-eat','monthly','pg_cron_retry')
    ) m(jobname,report_type,source) using (jobname)
  loop
    perform cron.alter_job(v_job.jobid, command := format(
      'select public.ag_enqueue_record_email_request(%L, null, false, %L);',v_job.report_type,v_job.source));
    v_count := v_count + 1;
  end loop;
  if v_count <> 5 then raise exception 'Expected five existing report schedules; found %',v_count; end if;
end;
$$;
select cron.schedule('record-email-outcome-monitor','*/10 * * * *','select public.ag_monitor_record_email_requests();');
select public.ag_monitor_record_email_requests();
commit;
