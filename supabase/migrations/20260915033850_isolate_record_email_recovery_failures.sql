begin;
set local plpgsql.check_asserts = on;
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
  v_retry_errors integer := 0;
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
    -- A recovery enqueue failure must not roll back captured transport outcomes.
    begin
      if public.ag_enqueue_record_email_request('weekly',v_row.summary_date,false,'pg_cron_recovery') is not null then
        v_retried := v_retried + 1;
      end if;
    exception when others then
      update public.ag_record_email_requests
      set response_summary = coalesce(response_summary, '{}'::jsonb)
        || jsonb_build_object('recovery_enqueue_failed',true,'recovery_enqueue_failed_at',now())
      where request_id = v_row.request_id;
      v_retry_errors := v_retry_errors + 1;
    end;
  end loop;
  return jsonb_build_object('captured',v_captured,'unknown',v_missing,
    'retries_queued',v_retried,'recovery_enqueue_failures',v_retry_errors);
end;
$$;
comment on function public.ag_monitor_record_email_requests() is
  'Persist HTTP outcomes before pg_net expiry. Recover failed automatic weekly requests with bounded attempts; isolate retry errors so original failure evidence commits.';
do $$
begin
  assert not has_function_privilege('anon','public.ag_monitor_record_email_requests()','EXECUTE');
  assert not has_function_privilege('authenticated','public.ag_monitor_record_email_requests()','EXECUTE');
  assert has_function_privilege('service_role','public.ag_monitor_record_email_requests()','EXECUTE');
end;
$$;
select public.ag_monitor_record_email_requests();
commit;
