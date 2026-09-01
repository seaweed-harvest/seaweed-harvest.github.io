create schema if not exists private;
revoke all on schema private from public;

create or replace function private.seaweed_harvest_cosme_finance_owner_profile(
  p_account_access_token text
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
begin
  if p_account_access_token is null
     or length(trim(p_account_access_token)) < 40
     or length(p_account_access_token) > 8192 then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_response
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
         and coalesce((v_profile->>'can_view_finance')::boolean, false)
       )
     ) then
    raise exception 'Dryer activity payment access is not permitted.' using errcode = '42501';
  end if;

  return v_profile;
end;
$$;

revoke all on function private.seaweed_harvest_cosme_finance_owner_profile(text) from public;

create or replace function private.seaweed_drying_activity_entries()
returns table (
  assistant_key text,
  assistant_name text,
  activity_date date,
  activity_type text,
  submission_id uuid,
  receipt_number text,
  table_location text,
  bay_number smallint
)
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select
    case
      when nullif(btrim(submission.enumerator_id), '') is not null
        then 'id:' || btrim(submission.enumerator_id)
      else 'name:' || lower(regexp_replace(btrim(submission.enumerator_name), '\s+', ' ', 'g'))
    end as assistant_key,
    btrim(submission.enumerator_name) as assistant_name,
    (bay.loading_at at time zone 'Africa/Nairobi')::date as activity_date,
    'loading'::text as activity_type,
    submission.id as submission_id,
    submission.receipt_number,
    submission.table_location,
    bay.bay_number
  from public.seaweed_drying_submissions submission
  join public.seaweed_drying_bay_records bay
    on bay.submission_id = submission.id
  where bay.loading_at is not null

  union all

  select
    case
      when nullif(btrim(submission.enumerator_id), '') is not null
        then 'id:' || btrim(submission.enumerator_id)
      else 'name:' || lower(regexp_replace(btrim(submission.enumerator_name), '\s+', ' ', 'g'))
    end as assistant_key,
    btrim(submission.enumerator_name) as assistant_name,
    (bay.unloading_at at time zone 'Africa/Nairobi')::date as activity_date,
    'unloading'::text as activity_type,
    submission.id as submission_id,
    submission.receipt_number,
    submission.table_location,
    bay.bay_number
  from public.seaweed_drying_submissions submission
  join public.seaweed_drying_bay_records bay
    on bay.submission_id = submission.id
  where bay.unloading_at is not null;
$$;

revoke all on function private.seaweed_drying_activity_entries() from public;

create or replace function private.seaweed_drying_activity_day_snapshot(
  p_assistant_key text,
  p_activity_date date
)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'private', 'extensions', 'pg_temp'
as $$
  with entries as (
    select *
    from private.seaweed_drying_activity_entries()
    where assistant_key = p_assistant_key
      and activity_date = p_activity_date
  ),
  event_rows as (
    select
      submission_id,
      max(receipt_number) as receipt_number,
      max(table_location) as table_location,
      count(*) filter (where activity_type = 'loading')::integer as loading_count,
      count(*) filter (where activity_type = 'unloading')::integer as unloading_count,
      count(*)::integer as total_activity_count
    from entries
    group by submission_id
  ),
  day_row as (
    select
      p_assistant_key as assistant_key,
      max(assistant_name) as assistant_name,
      p_activity_date as activity_date,
      count(*) filter (where activity_type = 'loading')::integer as loading_count,
      count(*) filter (where activity_type = 'unloading')::integer as unloading_count,
      count(*)::integer as total_activity_count
    from entries
  )
  select case
    when day_row.total_activity_count > 0 then
      jsonb_build_object(
        'assistant_key', day_row.assistant_key,
        'assistant_name', day_row.assistant_name,
        'activity_date', day_row.activity_date,
        'loading_count', day_row.loading_count,
        'unloading_count', day_row.unloading_count,
        'total_activity_count', day_row.total_activity_count,
        'qualifies',
          day_row.loading_count >= 8 or day_row.unloading_count >= 8,
        'contract_amount_kes',
          case
            when day_row.loading_count >= 8 or day_row.unloading_count >= 8
              then 500 + greatest(day_row.total_activity_count - 8, 0) * 25
            else null
          end,
        'reference_amount_kes', day_row.total_activity_count * 25,
        'activity_fingerprint',
          encode(
            extensions.digest(
              coalesce((
                select string_agg(
                  entry.activity_type || ':' || entry.submission_id::text || ':' || entry.bay_number::text,
                  '|' order by entry.activity_type, entry.submission_id, entry.bay_number
                )
                from entries entry
              ), ''),
              'sha256'
            ),
            'hex'
          ),
        'events',
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'submission_id', event_rows.submission_id,
                'receipt_number', event_rows.receipt_number,
                'table_location', event_rows.table_location,
                'loading_count', event_rows.loading_count,
                'unloading_count', event_rows.unloading_count,
                'total_activity_count', event_rows.total_activity_count
              )
              order by event_rows.table_location, event_rows.receipt_number
            )
            from event_rows
          ), '[]'::jsonb)
      )
    else null
  end
  from day_row;
$$;

revoke all on function private.seaweed_drying_activity_day_snapshot(text, date) from public;

create table if not exists public.seaweed_drying_activity_day_decisions (
  id uuid primary key default gen_random_uuid(),
  assistant_key text not null,
  assistant_name text not null,
  activity_date date not null,
  approved_work_amount_kes integer not null,
  phone_data_allowance_kes integer not null,
  approval_note text,
  source_loading_count integer not null,
  source_unloading_count integer not null,
  source_total_activity_count integer not null,
  source_qualifies boolean not null,
  source_contract_amount_kes integer,
  source_reference_amount_kes integer not null,
  source_activity_fingerprint text not null,
  approved_at timestamptz not null default now(),
  approved_by_user_id uuid not null,
  approved_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seaweed_drying_activity_day_decisions_unique
    unique (assistant_key, activity_date),
  constraint seaweed_drying_activity_day_decisions_key_check
    check (length(assistant_key) between 3 and 180),
  constraint seaweed_drying_activity_day_decisions_name_check
    check (length(assistant_name) between 2 and 160),
  constraint seaweed_drying_activity_day_decisions_date_check
    check (activity_date >= date '2020-01-01'),
  constraint seaweed_drying_activity_day_decisions_work_check
    check (approved_work_amount_kes between 0 and 1000000),
  constraint seaweed_drying_activity_day_decisions_phone_check
    check (phone_data_allowance_kes in (0, 100)),
  constraint seaweed_drying_activity_day_decisions_counts_check
    check (
      source_loading_count >= 0
      and source_unloading_count >= 0
      and source_total_activity_count = source_loading_count + source_unloading_count
    ),
  constraint seaweed_drying_activity_day_decisions_reference_check
    check (source_reference_amount_kes = source_total_activity_count * 25),
  constraint seaweed_drying_activity_day_decisions_contract_check
    check (
      (source_qualifies and source_contract_amount_kes is not null)
      or (not source_qualifies and source_contract_amount_kes is null)
    ),
  constraint seaweed_drying_activity_day_decisions_fingerprint_check
    check (source_activity_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint seaweed_drying_activity_day_decisions_note_check
    check (approval_note is null or length(approval_note) <= 2000)
);

create table if not exists public.seaweed_drying_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  assistant_key text not null,
  assistant_name text not null,
  payment_date date not null,
  transaction_type text not null,
  amount_kes integer not null,
  work_amount_kes integer not null default 0,
  phone_data_amount_kes integer not null default 0,
  phone_data_credit_applied_kes integer not null default 0,
  reference text,
  note text,
  recorded_at timestamptz not null default now(),
  recorded_by_user_id uuid not null,
  recorded_by_name text,
  constraint seaweed_drying_payment_transactions_key_check
    check (length(assistant_key) between 3 and 180),
  constraint seaweed_drying_payment_transactions_name_check
    check (length(assistant_name) between 2 and 160),
  constraint seaweed_drying_payment_transactions_date_check
    check (payment_date >= date '2020-01-01'),
  constraint seaweed_drying_payment_transactions_type_check
    check (transaction_type in ('activity_payment', 'phone_data_advance')),
  constraint seaweed_drying_payment_transactions_amounts_check
    check (
      amount_kes between 0 and 10000000
      and work_amount_kes between 0 and 10000000
      and phone_data_amount_kes between 0 and 10000000
      and phone_data_credit_applied_kes between 0 and phone_data_amount_kes
    ),
  constraint seaweed_drying_payment_transactions_breakdown_check
    check (
      (
        transaction_type = 'phone_data_advance'
        and amount_kes > 0
        and work_amount_kes = 0
        and phone_data_amount_kes = 0
        and phone_data_credit_applied_kes = 0
      )
      or (
        transaction_type = 'activity_payment'
        and amount_kes = work_amount_kes
          + phone_data_amount_kes
          - phone_data_credit_applied_kes
      )
    ),
  constraint seaweed_drying_payment_transactions_reference_check
    check (reference is null or length(reference) <= 300),
  constraint seaweed_drying_payment_transactions_note_check
    check (note is null or length(note) <= 2000)
);

create table if not exists public.seaweed_drying_payment_activity_days (
  payment_id uuid not null
    references public.seaweed_drying_payment_transactions(id) on delete restrict,
  activity_day_decision_id uuid not null
    references public.seaweed_drying_activity_day_decisions(id) on delete restrict,
  assistant_key text not null,
  assistant_name text not null,
  activity_date date not null,
  source_loading_count integer not null,
  source_unloading_count integer not null,
  source_total_activity_count integer not null,
  source_qualifies boolean not null,
  source_contract_amount_kes integer,
  source_reference_amount_kes integer not null,
  source_activity_fingerprint text not null,
  approved_work_amount_kes integer not null,
  phone_data_allowance_kes integer not null,
  phone_data_credit_applied_kes integer not null,
  transfer_amount_kes integer not null,
  created_at timestamptz not null default now(),
  primary key (payment_id, activity_day_decision_id),
  constraint seaweed_drying_payment_activity_days_one_payment
    unique (activity_day_decision_id),
  constraint seaweed_drying_payment_activity_days_counts_check
    check (
      source_loading_count >= 0
      and source_unloading_count >= 0
      and source_total_activity_count = source_loading_count + source_unloading_count
    ),
  constraint seaweed_drying_payment_activity_days_fingerprint_check
    check (source_activity_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint seaweed_drying_payment_activity_days_phone_check
    check (
      phone_data_allowance_kes in (0, 100)
      and phone_data_credit_applied_kes between 0 and phone_data_allowance_kes
    ),
  constraint seaweed_drying_payment_activity_days_amount_check
    check (
      approved_work_amount_kes >= 0
      and transfer_amount_kes =
        approved_work_amount_kes
        + phone_data_allowance_kes
        - phone_data_credit_applied_kes
    )
);

create index if not exists seaweed_drying_activity_day_decisions_date_idx
  on public.seaweed_drying_activity_day_decisions(activity_date desc);

create index if not exists seaweed_drying_payment_transactions_assistant_date_idx
  on public.seaweed_drying_payment_transactions(
    assistant_key,
    payment_date,
    recorded_at,
    id
  );

create index if not exists seaweed_drying_payment_activity_days_date_idx
  on public.seaweed_drying_payment_activity_days(activity_date desc);

alter table public.seaweed_drying_activity_day_decisions enable row level security;
alter table public.seaweed_drying_payment_transactions enable row level security;
alter table public.seaweed_drying_payment_activity_days enable row level security;

revoke all on table public.seaweed_drying_activity_day_decisions from anon, authenticated;
revoke all on table public.seaweed_drying_payment_transactions from anon, authenticated;
revoke all on table public.seaweed_drying_payment_activity_days from anon, authenticated;
