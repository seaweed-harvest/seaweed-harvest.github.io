create or replace function public.list_authenticated_seaweed_drying_ledger(
  p_account_access_token text,
  p_limit integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions', 'pg_temp'
as $$
declare
  v_account_url constant text := 'https://wwzmajhdusfyfskppupg.supabase.co/rest/v1/rpc/ag_my_profile';
  v_account_anon_key constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3em1hamhkdXNmeWZza3BwdXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDY5MzQsImV4cCI6MjA5ODE4MjkzNH0.9W8zCF8cTjWn6ArYaJmvRNX9_wDlwsOLMDi8yh5c998';
  v_response extensions.http_response;
  v_profile jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 2000), 5000));
  v_bay_rows jsonb;
  v_observations jsonb;
begin
  if p_account_access_token is null
     or length(trim(p_account_access_token)) < 40
     or length(p_account_access_token) > 8192 then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_response
  from extensions.http((
    'POST',
    v_account_url,
    array[
      extensions.http_header('apikey', v_account_anon_key),
      extensions.http_header('Authorization', 'Bearer ' || trim(p_account_access_token)),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  )::extensions.http_request);

  if coalesce(v_response.status, 0) <> 200 then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  begin
    v_profile := nullif(v_response.content, '')::jsonb;
  exception when others then
    raise exception 'Authentication validation failed.' using errcode = '42501';
  end;

  if jsonb_typeof(v_profile) <> 'object'
     or coalesce(v_profile->>'account_status', '') <> 'active'
     or coalesce((v_profile->>'is_protected_owner')::boolean, false) is not true
     or upper(coalesce(v_profile->>'active_aggregator_code', '')) <> 'COSME'
     or coalesce((v_profile->'organisation_capabilities'->>'form_dryer_table')::boolean, false) is not true
     or not (
       coalesce(v_profile->>'app_role', '') = 'system_admin'
       or (
         coalesce((v_profile->>'can_access_admin')::boolean, false)
         and coalesce((v_profile->>'can_view_data')::boolean, false)
       )
     ) then
    raise exception 'Dryer table records access is not permitted.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  into v_bay_rows
  from (
    select
      summary.submission_id,
      summary.receipt_number,
      summary.station_uid,
      summary.table_location,
      summary.drying_configuration,
      summary.recorded_at,
      summary.bay_number,
      summary.loading_at,
      summary.loading_weight_kg,
      summary.unloading_at,
      summary.unloading_weight_kg,
      summary.weight_loss_kg,
      summary.weight_loss_pct,
      summary.drying_minutes,
      case
        when summary.loading_at is null and summary.unloading_at is not null then 'needs_review'
        when summary.loading_at is not null and summary.unloading_at is null then 'drying'
        when summary.loading_at is not null
             and summary.unloading_at is not null
             and summary.unloading_at < summary.loading_at then 'needs_review'
        when summary.loading_at is not null and summary.unloading_at is not null then 'complete'
        else 'needs_review'
      end as status,
      coalesce(cardinality(bay.loading_photo_paths), 0)
        + coalesce(cardinality(bay.unloading_photo_paths), 0) as photo_count
    from public.seaweed_drying_bay_summary summary
    left join public.seaweed_drying_bay_records bay
      on bay.submission_id = summary.submission_id
     and bay.bay_number = summary.bay_number
    order by
      coalesce(summary.loading_at, summary.unloading_at, summary.recorded_at) desc nulls last,
      summary.table_location,
      summary.bay_number
    limit v_limit
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  into v_observations
  from (
    select
      submission.id as submission_id,
      submission.receipt_number,
      coalesce((
        select min(bay.loading_at)
        from public.seaweed_drying_bay_records bay
        where bay.submission_id = submission.id
      ), submission.recorded_at) as observation_at,
      submission.recorded_at,
      submission.table_location,
      submission.general_observations,
      submission.working_well,
      submission.not_working
    from public.seaweed_drying_submissions submission
    where nullif(btrim(coalesce(submission.general_observations, '')), '') is not null
       or nullif(btrim(coalesce(submission.working_well, '')), '') is not null
       or nullif(btrim(coalesce(submission.not_working, '')), '') is not null
    order by observation_at desc nulls last, submission.table_location
    limit v_limit
  ) row_data;

  return jsonb_build_object(
    'bay_rows', v_bay_rows,
    'observations', v_observations,
    'bay_row_count', jsonb_array_length(v_bay_rows),
    'observation_count', jsonb_array_length(v_observations),
    'generated_at', now()
  );
end;
$$;

revoke all on function public.list_authenticated_seaweed_drying_ledger(text, integer) from public;
grant execute on function public.list_authenticated_seaweed_drying_ledger(text, integer) to anon;
revoke execute on function public.list_authenticated_seaweed_drying_ledger(text, integer) from authenticated;

comment on function public.list_authenticated_seaweed_drying_ledger(text, integer) is
  'Read-only COSME protected-owner dryer ledger. Corrects the account-project publishable key used by the cross-project authentication bridge; validates the foreign account token before returning rows and performs no data mutations.';
