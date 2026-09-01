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
      count(*)::integer as total_activity_count,
      (
        count(*) filter (where entry.activity_type = 'loading') >= 8
        or count(*) filter (where entry.activity_type = 'unloading') >= 8
      ) as qualifies,
      case
        when (
          count(*) filter (where entry.activity_type = 'loading') >= 8
          or count(*) filter (where entry.activity_type = 'unloading') >= 8
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
      allocation.source_total_activity_count as paid_total_activity_count,
      case
        when decision.id is null then false
        else (
          coalesce(current_day.loading_count, 0) <> decision.source_loading_count
          or coalesce(current_day.unloading_count, 0) <> decision.source_unloading_count
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
          or coalesce(current_day.total_activity_count, 0) <> allocation.source_total_activity_count
          or current_day.activity_fingerprint is distinct from allocation.source_activity_fingerprint
        )
      end as source_changed_since_payment,
      case
        when allocation.activity_day_decision_id is not null then 'paid'
        when decision.id is not null and (
          coalesce(current_day.loading_count, 0) <> decision.source_loading_count
          or coalesce(current_day.unloading_count, 0) <> decision.source_unloading_count
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
    raise exception 'No dryer loading or unloading activity exists for this day.';
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

revoke all on function public.list_authenticated_seaweed_drying_payment_workspace(text, integer) from public;
revoke all on function public.save_authenticated_seaweed_drying_activity_day_decision(text, text, date, integer, integer, text) from public;

grant execute on function public.list_authenticated_seaweed_drying_payment_workspace(text, integer) to anon;
grant execute on function public.save_authenticated_seaweed_drying_activity_day_decision(text, text, date, integer, integer, text) to anon;

revoke execute on function public.list_authenticated_seaweed_drying_payment_workspace(text, integer) from authenticated;
revoke execute on function public.save_authenticated_seaweed_drying_activity_day_decision(text, text, date, integer, integer, text) from authenticated;
