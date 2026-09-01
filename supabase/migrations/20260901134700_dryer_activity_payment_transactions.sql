create or replace function public.record_authenticated_seaweed_drying_phone_advance(
  p_account_access_token text,
  p_client_request_id uuid,
  p_assistant_key text,
  p_payment_date date,
  p_amount_kes integer,
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
  v_assistant_name text;
  v_latest_payment_date date;
  v_payment public.seaweed_drying_payment_transactions%rowtype;
begin
  v_profile := private.seaweed_harvest_cosme_finance_owner_profile(
    p_account_access_token
  );

  if p_client_request_id is null then
    raise exception 'Payment request ID is required.';
  end if;
  if p_assistant_key is null or length(btrim(p_assistant_key)) not between 3 and 180 then
    raise exception 'Research Assistant is invalid.';
  end if;
  if p_payment_date is null
     or p_payment_date < date '2020-01-01'
     or p_payment_date > (now() at time zone 'Africa/Nairobi')::date + 1 then
    raise exception 'Advance date is invalid.';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 or p_amount_kes > 10000000 then
    raise exception 'Advance amount is invalid.';
  end if;
  if length(coalesce(p_reference, '')) > 300
     or length(coalesce(p_note, '')) > 2000 then
    raise exception 'Advance reference or note is too long.';
  end if;

  select *
  into v_existing
  from public.seaweed_drying_payment_transactions
  where client_request_id = p_client_request_id;
  if found then
    if v_existing.transaction_type <> 'phone_data_advance'
       or v_existing.assistant_key <> btrim(p_assistant_key)
       or v_existing.payment_date <> p_payment_date
       or v_existing.amount_kes <> p_amount_kes then
      raise exception 'Payment request ID has already been used for a different transaction.';
    end if;
    return to_jsonb(v_existing);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('dryer-payment:' || btrim(p_assistant_key), 0)
  );

  select max(assistant_name)
  into v_assistant_name
  from (
    select assistant_name
    from private.seaweed_drying_activity_entries()
    where assistant_key = btrim(p_assistant_key)
    union all
    select assistant_name
    from public.seaweed_drying_activity_day_decisions
    where assistant_key = btrim(p_assistant_key)
    union all
    select assistant_name
    from public.seaweed_drying_payment_transactions
    where assistant_key = btrim(p_assistant_key)
  ) names;

  if nullif(btrim(coalesce(v_assistant_name, '')), '') is null then
    raise exception 'Research Assistant was not found in dryer records.';
  end if;

  select max(payment_date)
  into v_latest_payment_date
  from public.seaweed_drying_payment_transactions
  where assistant_key = btrim(p_assistant_key);

  if v_latest_payment_date is not null and p_payment_date < v_latest_payment_date then
    raise exception 'Transactions must be recorded in date order. Latest ledger date is %.',
      v_latest_payment_date;
  end if;

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
    btrim(p_assistant_key),
    v_assistant_name,
    p_payment_date,
    'phone_data_advance',
    p_amount_kes,
    0,
    0,
    0,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    (v_profile->>'id')::uuid,
    nullif(btrim(coalesce(v_profile->>'display_name', v_profile->>'email', '')), '')
  )
  returning * into v_payment;

  return to_jsonb(v_payment);
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

revoke all on function public.record_authenticated_seaweed_drying_phone_advance(text, uuid, text, date, integer, text, text) from public;
revoke all on function public.record_authenticated_seaweed_drying_activity_payment(text, uuid, uuid[], date, text, text) from public;

grant execute on function public.record_authenticated_seaweed_drying_phone_advance(text, uuid, text, date, integer, text, text) to anon;
grant execute on function public.record_authenticated_seaweed_drying_activity_payment(text, uuid, uuid[], date, text, text) to anon;

revoke execute on function public.record_authenticated_seaweed_drying_phone_advance(text, uuid, text, date, integer, text, text) from authenticated;
revoke execute on function public.record_authenticated_seaweed_drying_activity_payment(text, uuid, uuid[], date, text, text) from authenticated;

comment on table public.seaweed_drying_activity_day_decisions is
  'Protected owner decisions for Research Assistant dryer activity days. Source dryer records remain unchanged.';
comment on table public.seaweed_drying_payment_transactions is
  'Immutable dryer Research Assistant money-movement ledger: activity payments and phone/data advances.';
comment on table public.seaweed_drying_payment_activity_days is
  'Immutable payment-time snapshot linking each paid activity day to one payment transaction.';

comment on function public.list_authenticated_seaweed_drying_payment_workspace(text, integer) is
  'Protected-owner COSME read workspace for derived activity days, approvals, payment ledger and phone/data credit.';
comment on function public.save_authenticated_seaweed_drying_activity_day_decision(text, text, date, integer, integer, text) is
  'Protected-owner COSME approval/update for an unpaid dryer activity day.';
comment on function public.record_authenticated_seaweed_drying_phone_advance(text, uuid, text, date, integer, text, text) is
  'Protected-owner COSME immutable phone/data advance entry.';
comment on function public.record_authenticated_seaweed_drying_activity_payment(text, uuid, uuid[], date, text, text) is
  'Protected-owner COSME atomic settlement of selected approved dryer activity days with double-payment protection.';
