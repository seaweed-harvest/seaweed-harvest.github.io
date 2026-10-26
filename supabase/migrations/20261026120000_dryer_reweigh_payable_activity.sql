-- Extend the existing COSME dryer activity payment system to include bay reweighs.
-- One measured bay within one reweigh event counts as one payable activity.
-- Preserve the original 8-of-one-activity-type threshold (loading, unloading,
-- or reweigh) and the KES 500 + KES 25 per additional activity formula.
-- Prior payment transactions and their recorded amounts are left untouched.
-- This migration requires the 2026-09-21 dryer reweigh tables to exist.

alter table public.seaweed_drying_activity_day_decisions
  add column if not exists source_reweigh_count integer not null default 0;
alter table public.seaweed_drying_payment_activity_days
  add column if not exists source_reweigh_count integer not null default 0;

alter table public.seaweed_drying_activity_day_decisions
  drop constraint if exists seaweed_drying_activity_day_decisions_counts_check;
alter table public.seaweed_drying_activity_day_decisions
  add constraint seaweed_drying_activity_day_decisions_counts_check
  check (
    source_loading_count >= 0
    and source_unloading_count >= 0
    and source_reweigh_count >= 0
    and source_total_activity_count =
      source_loading_count + source_unloading_count + source_reweigh_count
  );

alter table public.seaweed_drying_payment_activity_days
  drop constraint if exists seaweed_drying_payment_activity_days_counts_check;
alter table public.seaweed_drying_payment_activity_days
  add constraint seaweed_drying_payment_activity_days_counts_check
  check (
    source_loading_count >= 0
    and source_unloading_count >= 0
    and source_reweigh_count >= 0
    and source_total_activity_count =
      source_loading_count + source_unloading_count + source_reweigh_count
  );

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
  where bay.unloading_at is not null

  union all

  -- Each measured bay in each reweigh event is one payable activity.
  -- This follows the existing record's Research Assistant identity.
  select
    case
      when nullif(btrim(submission.enumerator_id), '') is not null
        then 'id:' || btrim(submission.enumerator_id)
      else 'name:' || lower(regexp_replace(btrim(submission.enumerator_name), '\s+', ' ', 'g'))
    end as assistant_key,
    btrim(submission.enumerator_name) as assistant_name,
    (reweigh.reweigh_at at time zone 'Africa/Nairobi')::date as activity_date,
    'reweigh'::text as activity_type,
    submission.id as submission_id,
    submission.receipt_number,
    submission.table_location,
    reweigh_bay.bay_number
  from public.seaweed_drying_reweigh_events reweigh
  join public.seaweed_drying_reweigh_bay_records reweigh_bay
    on reweigh_bay.reweigh_id = reweigh.id
   and reweigh_bay.submission_id = reweigh.submission_id
  join public.seaweed_drying_submissions submission
    on submission.id = reweigh.submission_id;
$$;

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
      count(*) filter (where activity_type = 'reweigh')::integer as reweigh_count,
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
      count(*) filter (where activity_type = 'reweigh')::integer as reweigh_count,
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
        'reweigh_count', day_row.reweigh_count,
        'total_activity_count', day_row.total_activity_count,
        'qualifies',
          day_row.loading_count >= 8 or day_row.unloading_count >= 8 or day_row.reweigh_count >= 8,
        'contract_amount_kes',
          case
            when day_row.loading_count >= 8 or day_row.unloading_count >= 8 or day_row.reweigh_count >= 8
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
                'reweigh_count', event_rows.reweigh_count,
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

create or replace function public.list_authenticated_seaweed_drying_payment_workspace(
  p_account_access_token text,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_profile jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 5000));
  v_activity_days jsonb;
  v_payments jsonb;
  v_assistants jsonb;
begin
  v_profile := private.seaweed_harvest_cosme_finance_owner_profile(
    p_account_access_token
  );

  with entries as (
    select * from private.seaweed_drying_activity_entries()
  ),
  event_rows as (
    select
      assistant_key,
      activity_date,
      submission_id,
      max(receipt_number) as receipt_number,
      max(table_location) as table_location,
      count(*) filter (where activity_type = 'loading')::integer as loading_count,
      count(*) filter (where activity_type = 'unloading')::integer as unloading_count,
      count(*) filter (where activity_type = 'reweigh')::integer as reweigh_count,
      count(*)::integer as total_activity_count
    from entries
    group by assistant_key, activity_date, submission_id
  ),
  current_days as (
    select
      entry.assistant_key,
      max(entry.assistant_name) as assistant_name,
      entry.activity_date,
      count(*) filter (where entry.activity_type = 'loading')::integer as loading_count,
      count(*) filter (where entry.activity_type = 'unloading')::integer as unloading_count,
      count(*) filter (where entry.activity_type = 'reweigh')::integer as reweigh_count,
      count(*)::integer as total_activity_count,
      (
        count(*) filter (where entry.activity_type = 'loading') >= 8
        or count(*) filter (where entry.activity_type = 'unloading') >= 8
          or count(*) filter (where entry.activity_type = 'reweigh') >= 8
      ) as qualifies,
      case
        when (
          count(*) filter (where entry.activity_type = 'loading') >= 8
          or count(*) filter (where entry.activity_type = 'unloading') >= 8
          or count(*) filter (where entry.activity_type = 'reweigh') >= 8
        )
          then 500 + greatest(count(*)::integer - 8, 0) * 25
        else null
      end as contract_amount_kes,
      count(*)::integer * 25 as reference_amount_kes,
      encode(
        extensions.digest(
          string_agg(
            entry.activity_type || ':' || entry.submission_id::text || ':' || entry.bay_number::text,
            '|' order by entry.activity_type, entry.submission_id, entry.bay_number
          ),
          'sha256'
        ),
        'hex'
      ) as activity_fingerprint,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'submission_id', event_row.submission_id,
            'receipt_number', event_row.receipt_number,
            'table_location', event_row.table_location,
            'loading_count', event_row.loading_count,
            'unloading_count', event_row.unloading_count,
              'reweigh_count', event_row.reweigh_count,
            'total_activity_count', event_row.total_activity_count
          )
          order by event_row.table_location, event_row.receipt_number
        )
        from event_rows event_row
        where event_row.assistant_key = entry.assistant_key
          and event_row.activity_date = entry.activity_date
      ), '[]'::jsonb) as events
    from entries entry
    group by entry.assistant_key, entry.activity_date
  ),
  all_day_keys as (
    select assistant_key, activity_date from current_days
    union
    select assistant_key, activity_date
    from public.seaweed_drying_activity_day_decisions
  ),
  day_rows as (
    select
      decision.id as decision_id,
      coalesce(current_day.assistant_key, decision.assistant_key) as assistant_key,
      coalesce(current_day.assistant_name, decision.assistant_name) as assistant_name,
      coalesce(current_day.activity_date, decision.activity_date) as activity_date,
      coalesce(current_day.loading_count, 0) as loading_count,
      coalesce(current_day.unloading_count, 0) as unloading_count,
      coalesce(current_day.reweigh_count, 0) as reweigh_count,
      coalesce(current_day.total_activity_count, 0) as total_activity_count,
      coalesce(current_day.qualifies, false) as qualifies,
      current_day.contract_amount_kes,
      coalesce(current_day.reference_amount_kes, 0) as reference_amount_kes,
      current_day.activity_fingerprint,
      coalesce(current_day.events, '[]'::jsonb) as events,
      decision.approved_work_amount_kes,
      decision.phone_data_allowance_kes,
      decision.approval_note,
      decision.approved_at,
      decision.approved_by_user_id,
      decision.approved_by_name,
      allocation.payment_id,
      payment.payment_date,
      payment.reference as payment_reference,
      payment.amount_kes as payment_transfer_amount_kes,
      allocation.phone_data_credit_applied_kes,
      allocation.transfer_amount_kes as day_transfer_amount_kes,
      allocation.source_loading_count as paid_loading_count,
      allocation.source_unloading_count as paid_unloading_count,
      allocation.source_reweigh_count as paid_reweigh_count,
      allocation.source_total_activity_count as paid_total_activity_count,
      case
        when decision.id is null then false
        else (
          coalesce(current_day.loading_count, 0) <> decision.source_loading_count
          or coalesce(current_day.unloading_count, 0) <> decision.source_unloading_count
          or coalesce(current_day.reweigh_count, 0) <> decision.source_reweigh_count
          or coalesce(current_day.total_activity_count, 0) <> decision.source_total_activity_count
          or coalesce(current_day.qualifies, false) <> decision.source_qualifies
          or current_day.contract_amount_kes is distinct from decision.source_contract_amount_kes
          or coalesce(current_day.reference_amount_kes, 0) <> decision.source_reference_amount_kes
          or current_day.activity_fingerprint is distinct from decision.source_activity_fingerprint
        )
      end as source_changed_since_approval,
      case
        when allocation.activity_day_decision_id is null then false
        else (
          coalesce(current_day.loading_count, 0) <> allocation.source_loading_count
          or coalesce(current_day.unloading_count, 0) <> allocation.source_unloading_count
          or coalesce(current_day.reweigh_count, 0) <> allocation.source_reweigh_count
          or coalesce(current_day.total_activity_count, 0) <> allocation.source_total_activity_count
          or current_day.activity_fingerprint is distinct from allocation.source_activity_fingerprint
        )
      end as source_changed_since_payment,
      case
        when allocation.activity_day_decision_id is not null then 'paid'
        when decision.id is not null and (
          coalesce(current_day.loading_count, 0) <> decision.source_loading_count
          or coalesce(current_day.unloading_count, 0) <> decision.source_unloading_count
          or coalesce(current_day.reweigh_count, 0) <> decision.source_reweigh_count
          or coalesce(current_day.total_activity_count, 0) <> decision.source_total_activity_count
          or coalesce(current_day.qualifies, false) <> decision.source_qualifies
          or current_day.contract_amount_kes is distinct from decision.source_contract_amount_kes
          or coalesce(current_day.reference_amount_kes, 0) <> decision.source_reference_amount_kes
          or current_day.activity_fingerprint is distinct from decision.source_activity_fingerprint
        ) then 'needs_review'
        when decision.id is not null then 'approved_unpaid'
        else 'needs_review'
      end as payment_status
    from all_day_keys key
    left join current_days current_day
      on current_day.assistant_key = key.assistant_key
     and current_day.activity_date = key.activity_date
    left join public.seaweed_drying_activity_day_decisions decision
      on decision.assistant_key = key.assistant_key
     and decision.activity_date = key.activity_date
    left join public.seaweed_drying_payment_activity_days allocation
      on allocation.activity_day_decision_id = decision.id
    left join public.seaweed_drying_payment_transactions payment
      on payment.id = allocation.payment_id
  )
  select coalesce(jsonb_agg(to_jsonb(result_row)), '[]'::jsonb)
  into v_activity_days
  from (
    select *
    from day_rows
    order by activity_date desc, assistant_name, assistant_key
    limit v_limit
  ) result_row;

  with allocation_rows as (
    select
      allocation.payment_id,
      count(*)::integer as activity_day_count,
      min(allocation.activity_date) as first_activity_date,
      max(allocation.activity_date) as last_activity_date,
      jsonb_agg(
        jsonb_build_object(
          'activity_day_decision_id', allocation.activity_day_decision_id,
          'activity_date', allocation.activity_date,
          'assistant_name', allocation.assistant_name,
          'loading_count', allocation.source_loading_count,
          'unloading_count', allocation.source_unloading_count,
            'reweigh_count', allocation.source_reweigh_count,
          'approved_work_amount_kes', allocation.approved_work_amount_kes,
          'phone_data_allowance_kes', allocation.phone_data_allowance_kes,
          'phone_data_credit_applied_kes',
            allocation.phone_data_credit_applied_kes,
          'transfer_amount_kes', allocation.transfer_amount_kes
        )
        order by allocation.activity_date, allocation.activity_day_decision_id
      ) as activity_days
    from public.seaweed_drying_payment_activity_days allocation
    group by allocation.payment_id
  ),
  ordered_payments as (
    select
      payment.id,
      payment.client_request_id,
      payment.assistant_key,
      payment.assistant_name,
      payment.payment_date,
      payment.transaction_type,
      payment.amount_kes,
      payment.work_amount_kes,
      payment.phone_data_amount_kes,
      payment.phone_data_credit_applied_kes,
      payment.reference,
      payment.note,
      payment.recorded_at,
      payment.recorded_by_user_id,
      payment.recorded_by_name,
      coalesce(allocation.activity_day_count, 0) as activity_day_count,
      allocation.first_activity_date,
      allocation.last_activity_date,
      coalesce(allocation.activity_days, '[]'::jsonb) as activity_days,
      sum(
        case
          when payment.transaction_type = 'phone_data_advance'
            then payment.amount_kes
          else -payment.phone_data_credit_applied_kes
        end
      ) over (
        partition by payment.assistant_key
        order by payment.payment_date, payment.recorded_at, payment.id
        rows between unbounded preceding and current row
      )::integer as phone_data_credit_balance_after_kes
    from public.seaweed_drying_payment_transactions payment
    left join allocation_rows allocation on allocation.payment_id = payment.id
  )
  select coalesce(jsonb_agg(to_jsonb(result_row)), '[]'::jsonb)
  into v_payments
  from (
    select *
    from ordered_payments
    order by payment_date desc, recorded_at desc, id desc
    limit v_limit
  ) result_row;

  with assistant_keys as (
    select assistant_key, max(assistant_name) as assistant_name
    from (
      select assistant_key, assistant_name
      from private.seaweed_drying_activity_entries()
      union all
      select assistant_key, assistant_name
      from public.seaweed_drying_activity_day_decisions
      union all
      select assistant_key, assistant_name
      from public.seaweed_drying_payment_transactions
    ) assistant_sources
    group by assistant_key
  ),
  credit_rows as (
    select
      payment.assistant_key,
      coalesce(sum(
        case
          when payment.transaction_type = 'phone_data_advance'
            then payment.amount_kes
          else -payment.phone_data_credit_applied_kes
        end
      ), 0)::integer as phone_data_credit_balance_kes
    from public.seaweed_drying_payment_transactions payment
    group by payment.assistant_key
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'assistant_key', assistant.assistant_key,
      'assistant_name', assistant.assistant_name,
      'phone_data_credit_balance_kes',
        coalesce(credit.phone_data_credit_balance_kes, 0)
    )
    order by assistant.assistant_name, assistant.assistant_key
  ), '[]'::jsonb)
  into v_assistants
  from assistant_keys assistant
  left join credit_rows credit on credit.assistant_key = assistant.assistant_key;

  return jsonb_build_object(
    'activity_days', v_activity_days,
    'payments', v_payments,
    'assistants', v_assistants,
    'generated_at', now()
  );
end;
$$;

create or replace function public.save_authenticated_seaweed_drying_activity_day_decision(
  p_account_access_token text,
  p_assistant_key text,
  p_activity_date date,
  p_approved_work_amount_kes integer,
  p_phone_data_allowance_kes integer,
  p_approval_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_profile jsonb;
  v_snapshot jsonb;
  v_decision public.seaweed_drying_activity_day_decisions%rowtype;
  v_qualifies boolean;
  v_contract_amount integer;
  v_reference_amount integer;
begin
  v_profile := private.seaweed_harvest_cosme_finance_owner_profile(
    p_account_access_token
  );

  if p_assistant_key is null or length(btrim(p_assistant_key)) not between 3 and 180 then
    raise exception 'Research Assistant is invalid.';
  end if;
  if p_activity_date is null
     or p_activity_date < date '2020-01-01'
     or p_activity_date > (now() at time zone 'Africa/Nairobi')::date + 1 then
    raise exception 'Activity date is invalid.';
  end if;
  if p_phone_data_allowance_kes is null or p_phone_data_allowance_kes not in (0, 100) then
    raise exception 'Phone/data must be set to KES 0 or KES 100.';
  end if;
  if p_approved_work_amount_kes is null
     or p_approved_work_amount_kes < 0
     or p_approved_work_amount_kes > 1000000 then
    raise exception 'Approved work amount is invalid.';
  end if;
  if length(coalesce(p_approval_note, '')) > 2000 then
    raise exception 'Approval note is too long.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'dryer-decision:' || btrim(p_assistant_key) || ':' || p_activity_date::text,
      0
    )
  );

  v_snapshot := private.seaweed_drying_activity_day_snapshot(
    btrim(p_assistant_key),
    p_activity_date
  );
  if v_snapshot is null then
    raise exception 'No dryer loading, reweigh or unloading activity exists for this day.';
  end if;

  v_qualifies := coalesce((v_snapshot->>'qualifies')::boolean, false);
  v_contract_amount := nullif(v_snapshot->>'contract_amount_kes', '')::integer;
  v_reference_amount := coalesce((v_snapshot->>'reference_amount_kes')::integer, 0);

  if v_qualifies and p_approved_work_amount_kes <> v_contract_amount then
    raise exception 'Qualifying days must use the calculated contract amount of KES %.',
      v_contract_amount;
  end if;

  select decision.*
  into v_decision
  from public.seaweed_drying_activity_day_decisions decision
  where decision.assistant_key = btrim(p_assistant_key)
    and decision.activity_date = p_activity_date
  for update;

  if found and exists (
    select 1
    from public.seaweed_drying_payment_activity_days allocation
    where allocation.activity_day_decision_id = v_decision.id
  ) then
    raise exception 'This activity day has already been paid and cannot be changed.';
  end if;

  insert into public.seaweed_drying_activity_day_decisions (
    assistant_key,
    assistant_name,
    activity_date,
    approved_work_amount_kes,
    phone_data_allowance_kes,
    approval_note,
    source_loading_count,
    source_unloading_count,
    source_reweigh_count,
    source_total_activity_count,
    source_qualifies,
    source_contract_amount_kes,
    source_reference_amount_kes,
    source_activity_fingerprint,
    approved_at,
    approved_by_user_id,
    approved_by_name,
    updated_at
  ) values (
    btrim(p_assistant_key),
    v_snapshot->>'assistant_name',
    p_activity_date,
    p_approved_work_amount_kes,
    p_phone_data_allowance_kes,
    nullif(btrim(coalesce(p_approval_note, '')), ''),
    (v_snapshot->>'loading_count')::integer,
    (v_snapshot->>'unloading_count')::integer,
    (v_snapshot->>'reweigh_count')::integer,
    (v_snapshot->>'total_activity_count')::integer,
    v_qualifies,
    v_contract_amount,
    v_reference_amount,
    v_snapshot->>'activity_fingerprint',
    now(),
    (v_profile->>'id')::uuid,
    nullif(btrim(coalesce(v_profile->>'display_name', v_profile->>'email', '')), ''),
    now()
  )
  on conflict (assistant_key, activity_date) do update set
    assistant_name = excluded.assistant_name,
    approved_work_amount_kes = excluded.approved_work_amount_kes,
    phone_data_allowance_kes = excluded.phone_data_allowance_kes,
    approval_note = excluded.approval_note,
    source_loading_count = excluded.source_loading_count,
    source_unloading_count = excluded.source_unloading_count,
    source_reweigh_count = excluded.source_reweigh_count,
    source_total_activity_count = excluded.source_total_activity_count,
    source_qualifies = excluded.source_qualifies,
    source_contract_amount_kes = excluded.source_contract_amount_kes,
    source_reference_amount_kes = excluded.source_reference_amount_kes,
    source_activity_fingerprint = excluded.source_activity_fingerprint,
    approved_at = excluded.approved_at,
    approved_by_user_id = excluded.approved_by_user_id,
    approved_by_name = excluded.approved_by_name,
    updated_at = now()
  returning * into v_decision;

  return to_jsonb(v_decision);
end;
$$;

create or replace function public.record_authenticated_seaweed_drying_activity_payment(
  p_account_access_token text,
  p_client_request_id uuid,
  p_activity_day_decision_ids uuid[],
  p_payment_date date,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_profile jsonb;
  v_existing public.seaweed_drying_payment_transactions%rowtype;
  v_decision public.seaweed_drying_activity_day_decisions%rowtype;
  v_snapshot jsonb;
  v_assistant_key text;
  v_assistant_name text;
  v_selected_count integer;
  v_distinct_count integer;
  v_work_total integer := 0;
  v_phone_total integer := 0;
  v_credit_balance integer := 0;
  v_credit_applied integer := 0;
  v_remaining_credit integer := 0;
  v_day_credit integer := 0;
  v_transfer_total integer := 0;
  v_latest_payment_date date;
  v_latest_activity_date date;
  v_payment public.seaweed_drying_payment_transactions%rowtype;
begin
  v_profile := private.seaweed_harvest_cosme_finance_owner_profile(
    p_account_access_token
  );

  if p_client_request_id is null then
    raise exception 'Payment request ID is required.';
  end if;
  v_selected_count := coalesce(cardinality(p_activity_day_decision_ids), 0);
  if v_selected_count < 1 or v_selected_count > 100 then
    raise exception 'Select between 1 and 100 approved activity days.';
  end if;
  select count(distinct decision_id)
  into v_distinct_count
  from unnest(p_activity_day_decision_ids) decision_id;
  if v_distinct_count <> v_selected_count then
    raise exception 'Duplicate activity days were selected.';
  end if;
  if p_payment_date is null
     or p_payment_date < date '2020-01-01'
     or p_payment_date > (now() at time zone 'Africa/Nairobi')::date + 1 then
    raise exception 'Payment date is invalid.';
  end if;
  if length(coalesce(p_reference, '')) > 300
     or length(coalesce(p_note, '')) > 2000 then
    raise exception 'Payment reference or note is too long.';
  end if;

  select *
  into v_existing
  from public.seaweed_drying_payment_transactions
  where client_request_id = p_client_request_id;
  if found then
    if v_existing.transaction_type <> 'activity_payment'
       or (
         select array_agg(allocation.activity_day_decision_id order by allocation.activity_day_decision_id)
         from public.seaweed_drying_payment_activity_days allocation
         where allocation.payment_id = v_existing.id
       ) is distinct from (
         select array_agg(selected_id order by selected_id)
         from unnest(p_activity_day_decision_ids) selected_id
       ) then
      raise exception 'Payment request ID has already been used for a different transaction.';
    end if;
    return to_jsonb(v_existing) || jsonb_build_object(
      'activity_day_count', cardinality(p_activity_day_decision_ids)
    );
  end if;

  select
    min(decision.assistant_key),
    max(decision.assistant_name),
    count(*)::integer,
    count(distinct decision.assistant_key)::integer,
    max(decision.activity_date)
  into
    v_assistant_key,
    v_assistant_name,
    v_distinct_count,
    v_selected_count,
    v_latest_activity_date
  from public.seaweed_drying_activity_day_decisions decision
  where decision.id = any(p_activity_day_decision_ids);

  if v_distinct_count <> cardinality(p_activity_day_decision_ids) then
    raise exception 'One or more selected activity days were not found.';
  end if;
  if v_selected_count <> 1 then
    raise exception 'One payment can only cover one Research Assistant.';
  end if;
  if p_payment_date < v_latest_activity_date then
    raise exception 'Payment date cannot be earlier than the latest selected activity day.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('dryer-payment:' || v_assistant_key, 0)
  );

  if exists (
    select 1
    from public.seaweed_drying_payment_activity_days allocation
    where allocation.activity_day_decision_id = any(p_activity_day_decision_ids)
  ) then
    raise exception 'One or more selected activity days have already been paid.';
  end if;

  select max(payment_date)
  into v_latest_payment_date
  from public.seaweed_drying_payment_transactions
  where assistant_key = v_assistant_key;

  if v_latest_payment_date is not null and p_payment_date < v_latest_payment_date then
    raise exception 'Transactions must be recorded in date order. Latest ledger date is %.',
      v_latest_payment_date;
  end if;

  for v_decision in
    select decision.*
    from public.seaweed_drying_activity_day_decisions decision
    where decision.id = any(p_activity_day_decision_ids)
    order by decision.activity_date, decision.id
    for update
  loop
    v_snapshot := private.seaweed_drying_activity_day_snapshot(
      v_decision.assistant_key,
      v_decision.activity_date
    );

    if v_snapshot is null
       or (v_snapshot->>'loading_count')::integer <> v_decision.source_loading_count
       or (v_snapshot->>'unloading_count')::integer <> v_decision.source_unloading_count
        or (v_snapshot->>'reweigh_count')::integer <> v_decision.source_reweigh_count
       or (v_snapshot->>'total_activity_count')::integer <> v_decision.source_total_activity_count
       or coalesce((v_snapshot->>'qualifies')::boolean, false) <> v_decision.source_qualifies
       or nullif(v_snapshot->>'contract_amount_kes', '')::integer
            is distinct from v_decision.source_contract_amount_kes
       or (v_snapshot->>'reference_amount_kes')::integer
            <> v_decision.source_reference_amount_kes
       or v_snapshot->>'activity_fingerprint'
            is distinct from v_decision.source_activity_fingerprint then
      raise exception 'Dryer records changed after approval for activity day %. Review and approve the day again.',
        v_decision.activity_date;
    end if;

    v_work_total := v_work_total + v_decision.approved_work_amount_kes;
    v_phone_total := v_phone_total + v_decision.phone_data_allowance_kes;
  end loop;

  select coalesce(sum(
    case
      when payment.transaction_type = 'phone_data_advance'
        then payment.amount_kes
      else -payment.phone_data_credit_applied_kes
    end
  ), 0)::integer
  into v_credit_balance
  from public.seaweed_drying_payment_transactions payment
  where payment.assistant_key = v_assistant_key;

  v_credit_applied := least(v_phone_total, greatest(v_credit_balance, 0));
  v_transfer_total := v_work_total + v_phone_total - v_credit_applied;

  insert into public.seaweed_drying_payment_transactions (
    client_request_id,
    assistant_key,
    assistant_name,
    payment_date,
    transaction_type,
    amount_kes,
    work_amount_kes,
    phone_data_amount_kes,
    phone_data_credit_applied_kes,
    reference,
    note,
    recorded_by_user_id,
    recorded_by_name
  ) values (
    p_client_request_id,
    v_assistant_key,
    v_assistant_name,
    p_payment_date,
    'activity_payment',
    v_transfer_total,
    v_work_total,
    v_phone_total,
    v_credit_applied,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (v_profile->>'id')::uuid,
    nullif(btrim(coalesce(v_profile->>'display_name', v_profile->>'email', '')), '')
  )
  returning * into v_payment;

  v_remaining_credit := v_credit_applied;

  for v_decision in
    select decision.*
    from public.seaweed_drying_activity_day_decisions decision
    where decision.id = any(p_activity_day_decision_ids)
    order by decision.activity_date, decision.id
  loop
    v_day_credit := least(
      v_remaining_credit,
      v_decision.phone_data_allowance_kes
    );

    insert into public.seaweed_drying_payment_activity_days (
      payment_id,
      activity_day_decision_id,
      assistant_key,
      assistant_name,
      activity_date,
      source_loading_count,
      source_unloading_count,
      source_reweigh_count,
      source_total_activity_count,
      source_qualifies,
      source_contract_amount_kes,
      source_reference_amount_kes,
      source_activity_fingerprint,
      approved_work_amount_kes,
      phone_data_allowance_kes,
      phone_data_credit_applied_kes,
      transfer_amount_kes
    ) values (
      v_payment.id,
      v_decision.id,
      v_decision.assistant_key,
      v_decision.assistant_name,
      v_decision.activity_date,
      v_decision.source_loading_count,
      v_decision.source_unloading_count,
      v_decision.source_reweigh_count,
      v_decision.source_total_activity_count,
      v_decision.source_qualifies,
      v_decision.source_contract_amount_kes,
      v_decision.source_reference_amount_kes,
      v_decision.source_activity_fingerprint,
      v_decision.approved_work_amount_kes,
      v_decision.phone_data_allowance_kes,
      v_day_credit,
      v_decision.approved_work_amount_kes
        + v_decision.phone_data_allowance_kes
        - v_day_credit
    );

    v_remaining_credit := v_remaining_credit - v_day_credit;
  end loop;

  return to_jsonb(v_payment) || jsonb_build_object(
    'activity_day_count', cardinality(p_activity_day_decision_ids)
  );
end;
$$;

comment on function public.list_authenticated_seaweed_drying_payment_workspace(text, integer) is
  'Protected-owner COSME activity/payment workspace; counts each per-bay reweigh along with loading and unloading, without rewriting paid ledger snapshots.';
comment on function private.seaweed_drying_activity_entries() is
  'Day activity source: one row per loaded, reweighed or unloaded bay. Reweighs use the original submission Research Assistant.';

notify pgrst, 'reload schema';
