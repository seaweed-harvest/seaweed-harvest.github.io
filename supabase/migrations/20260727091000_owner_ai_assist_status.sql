begin;

drop function if exists public.ag_owner_site_feedback(text, text, integer);

create function public.ag_owner_site_feedback(
  p_status text default 'open',
  p_search text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  created_at timestamptz,
  source_app text,
  source_page text,
  page_url text,
  feedback_type text,
  message text,
  submitter_name text,
  submitter_email text,
  status text,
  review_decision text,
  photo_path text,
  photo_content_type text,
  photo_byte_size integer,
  slack_status text,
  closed_at timestamptz,
  automation_enabled boolean,
  automation_status text,
  automation_decision text,
  automation_risk_level text,
  automation_summary text,
  automation_last_processed_at timestamptz,
  automation_pull_request_url text,
  automation_error_message text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  select lower(coalesce(u.email, ''))
  into v_email
  from auth.users u
  where u.id = (select auth.uid());

  if v_email is distinct from 'bmichael@cascadiaseaweed.com' then
    raise exception 'Suggestions workspace is available only to the protected owner.'
      using errcode = '42501';
  end if;

  if v_status is not null
    and v_status not in ('open', 'new', 'reviewing', 'planned', 'closed') then
    raise exception 'Unknown suggestion status.';
  end if;

  return query
  select
    feedback.id,
    feedback.created_at,
    feedback.source_app,
    feedback.source_page,
    feedback.page_url,
    feedback.feedback_type,
    feedback.message,
    feedback.submitter_name,
    feedback.submitter_email,
    feedback.status,
    feedback.review_decision,
    feedback.photo_path,
    feedback.photo_content_type,
    feedback.photo_byte_size,
    feedback.slack_status,
    feedback.closed_at,
    feedback.automation_enabled,
    feedback.automation_status,
    feedback.automation_decision,
    feedback.automation_risk_level,
    feedback.automation_summary,
    feedback.automation_last_processed_at,
    latest_run.github_pull_request_url,
    latest_run.error_message
  from public.ag_site_feedback feedback
  left join public.ag_site_feedback_automation_runs latest_run
    on latest_run.id = feedback.automation_latest_run_id
  where (
      v_status is null
      or (v_status = 'open' and feedback.status <> 'closed')
      or (v_status <> 'open' and feedback.status = v_status)
    )
    and (
      v_search is null
      or feedback.message ilike '%' || v_search || '%'
      or feedback.source_page ilike '%' || v_search || '%'
      or feedback.submitter_name ilike '%' || v_search || '%'
      or feedback.submitter_email ilike '%' || v_search || '%'
    )
  order by
    case feedback.status
      when 'new' then 1
      when 'reviewing' then 2
      when 'planned' then 3
      else 4
    end,
    feedback.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

revoke all on function public.ag_owner_site_feedback(text, text, integer) from public, anon;
grant execute on function public.ag_owner_site_feedback(text, text, integer) to authenticated;

comment on function public.ag_owner_site_feedback(text, text, integer) is
  'Protected-owner suggestions queue with the latest AI Assist assessment and draft pull-request state.';

commit;
