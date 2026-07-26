begin;

create or replace function public.ag_normalize_community_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(
    regexp_replace(
      regexp_replace(trim(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g'),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.ag_submit_collection_internal(
  p_submission_id uuid,
  p_collection jsonb,
  p_aggregator_id uuid,
  p_actor_user_id uuid,
  p_collector_name text,
  p_allow_price_override boolean,
  p_queue_notifications boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator public.ag_aggregators%rowtype;
  v_existing public.collections%rowtype;
  v_collection public.collections%rowtype;
  v_receipt public.ag_collection_receipts%rowtype;
  v_farmer public.farmers%rowtype;
  v_community public.communities%rowtype;
  v_rule public.ag_pricing_rules%rowtype;
  v_collected_at timestamptz := coalesce(nullif(p_collection ->> 'collected_at', '')::timestamptz, now());
  v_type text := lower(coalesce(nullif(trim(p_collection ->> 'seaweed_type'), ''), 'spinosum'));
  v_grade_input text := upper(nullif(trim(coalesce(p_collection ->> 'grade_code', p_collection ->> 'seaweed_grade')), ''));
  v_is_ungraded boolean := v_grade_input = 'UNGRADED';
  v_grade text := case when v_grade_input = 'UNGRADED' then null else v_grade_input end;
  v_form text := lower(coalesce(nullif(trim(p_collection ->> 'product_form'), ''), 'wet'));
  v_weight numeric := nullif(p_collection ->> 'sack_weight_kg', '')::numeric;
  v_requested_price numeric := nullif(p_collection ->> 'price_per_kg', '')::numeric;
  v_override_reason text := nullif(trim(p_collection ->> 'price_override_reason'), '');
  v_create_community boolean := coalesce((p_collection ->> 'create_community')::boolean, false);
  v_requested_community_name text := nullif(regexp_replace(trim(p_collection ->> 'community_name_snapshot'), '\s+', ' ', 'g'), '');
  v_normalized_community_name text;
  v_community_created boolean := false;
  v_price numeric;
  v_total numeric;
  v_source text;
  v_currency text;
  v_receipt_number text;
  v_photo_urls text[];
  v_notification_count integer := 0;
begin
  if p_submission_id is null then raise exception 'Submission ID is required.'; end if;
  if p_aggregator_id is null then raise exception 'Aggregator is required.'; end if;
  if p_collector_name is null or length(trim(p_collector_name)) < 2 or length(trim(p_collector_name)) > 100 then
    raise exception 'Collector name must contain 2 to 100 characters.';
  end if;

  select * into v_aggregator
  from public.ag_aggregators
  where id = p_aggregator_id and active;
  if not found then raise exception 'Active aggregator was not found.' using errcode = 'P0002'; end if;

  select * into v_existing
  from public.collections c
  where c.aggregator_id = v_aggregator.id and c.submission_id = p_submission_id;
  if found then
    select * into v_receipt from public.ag_collection_receipts where collection_id = v_existing.id;
    return jsonb_build_object(
      'duplicate', true,
      'collection_id', v_existing.id,
      'transaction_id', v_existing.transaction_id,
      'receipt_id', v_receipt.id,
      'receipt_number', v_receipt.receipt_number,
      'aggregator_name', v_aggregator.organisation_name,
      'unit_price', v_receipt.unit_price_snapshot,
      'weight_kg', v_receipt.weight_kg_snapshot,
      'total', v_receipt.total,
      'currency', v_receipt.currency,
      'ungraded', v_existing.grade_code is null and v_existing.price_source = 'ungraded',
      'community_record_id', v_existing.community_record_id,
      'community_id', v_existing.community_id,
      'community_name', v_existing.community_name_snapshot,
      'community_created', false,
      'notification_count', 0
    );
  end if;

  if v_weight is null or v_weight <= 0 or v_weight > 5000 then
    raise exception 'Weight must be greater than zero and no more than 5000 kg.';
  end if;
  if v_form not in ('wet', 'dried', 'milled') then raise exception 'Select a valid product form.'; end if;
  if v_grade_input is null then raise exception 'Select a grade, or choose Ungraded.'; end if;

  if v_create_community
    and nullif(p_collection ->> 'community_record_id', '') is null
    and nullif(p_collection ->> 'community_id', '') is null then
    if v_requested_community_name is null
      or length(v_requested_community_name) < 2
      or length(v_requested_community_name) > 160
      or v_requested_community_name ~ '[[:cntrl:]]' then
      raise exception 'Community name must contain 2 to 160 characters.';
    end if;

    v_normalized_community_name := public.ag_normalize_community_name(v_requested_community_name);
    perform pg_advisory_xact_lock(hashtextextended('ag-community:' || v_normalized_community_name, 0));

    select c.* into v_community
    from public.communities c
    where c.active
      and public.ag_normalize_community_name(c.community_name) = v_normalized_community_name
    order by c.created_at, c.id
    limit 1;

    if not found then
      insert into public.communities (community_name, notes)
      values (v_requested_community_name, 'Created from the collection intake form.')
      returning * into v_community;
      v_community_created := true;
    end if;

    insert into public.ag_aggregator_communities (
      aggregator_id,
      community_id,
      is_active,
      created_by,
      updated_by
    )
    values (
      v_aggregator.id,
      v_community.id,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (aggregator_id, community_id) do update
    set is_active = true,
        updated_by = excluded.updated_by,
        updated_at = now();

    p_collection := p_collection || jsonb_build_object(
      'community_record_id', v_community.id,
      'community_id', v_community.community_id,
      'community_name_snapshot', v_community.community_name
    );
  end if;

  if nullif(p_collection ->> 'farmer_record_id', '') is not null then
    select f.* into v_farmer
    from public.farmers f
    join public.ag_aggregator_farmers af
      on af.farmer_id = f.id and af.aggregator_id = v_aggregator.id and af.is_active
    where f.id = (p_collection ->> 'farmer_record_id')::uuid and f.active;
    if not found then raise exception 'Farmer is not available for Mawimbi.' using errcode = '42501'; end if;
  elsif nullif(trim(p_collection ->> 'farmer_id'), '') is not null then
    select f.* into v_farmer
    from public.farmers f
    join public.ag_aggregator_farmers af
      on af.farmer_id = f.id and af.aggregator_id = v_aggregator.id and af.is_active
    where f.farmer_id = upper(trim(p_collection ->> 'farmer_id')) and f.active;
  end if;

  if nullif(p_collection ->> 'community_record_id', '') is not null then
    select c.* into v_community
    from public.communities c
    join public.ag_aggregator_communities ac
      on ac.community_id = c.id and ac.aggregator_id = v_aggregator.id and ac.is_active
    where c.id = (p_collection ->> 'community_record_id')::uuid and c.active;
  elsif nullif(p_collection ->> 'community_id', '') is not null then
    select c.* into v_community
    from public.communities c
    join public.ag_aggregator_communities ac
      on ac.community_id = c.id and ac.aggregator_id = v_aggregator.id and ac.is_active
    where c.community_id = upper(trim(p_collection ->> 'community_id')) and c.active;
  elsif v_farmer.id is not null and v_farmer.community_id is not null then
    select c.* into v_community
    from public.communities c
    join public.ag_aggregator_communities ac
      on ac.community_id = c.id and ac.aggregator_id = v_aggregator.id and ac.is_active
    where c.community_id = v_farmer.community_id and c.active;
  end if;
  if (nullif(p_collection ->> 'community_record_id', '') is not null or nullif(p_collection ->> 'community_id', '') is not null)
    and v_community.id is null then
    raise exception 'Community is not available for Mawimbi.' using errcode = '42501';
  end if;

  if not v_is_ungraded then
    select r.* into v_rule
    from public.ag_pricing_rules r
    where r.aggregator_id = v_aggregator.id
      and r.seaweed_type = v_type
      and r.grade_code = v_grade
      and r.product_form = v_form
      and r.is_active
      and r.effective_from <= (v_collected_at at time zone 'Africa/Nairobi')::date
      and (r.effective_to is null or r.effective_to > (v_collected_at at time zone 'Africa/Nairobi')::date)
    order by r.effective_from desc, r.created_at desc
    limit 1;
  end if;

  if v_is_ungraded then
    if v_requested_price is not null and abs(v_requested_price) >= 0.005 then
      raise exception 'Ungraded collections cannot include a payment price.';
    end if;
    v_price := 0;
    v_currency := v_aggregator.default_currency;
    v_source := 'ungraded';
  elsif v_rule.id is not null and (v_requested_price is null or abs(v_requested_price - v_rule.price_per_kg) < 0.005) then
    v_price := v_rule.price_per_kg;
    v_currency := v_rule.currency;
    v_source := 'matrix';
  elsif v_requested_price is not null and p_allow_price_override then
    if v_override_reason is null then raise exception 'A price override reason is required.'; end if;
    if v_requested_price < 0 then raise exception 'Price per kg cannot be negative.'; end if;
    v_price := v_requested_price;
    v_currency := coalesce(v_rule.currency, v_aggregator.default_currency);
    v_source := 'override';
  elsif v_rule.id is null then
    raise exception 'No active price is configured for this seaweed type, grade and product form.';
  else
    raise exception 'The entered price does not match the Mawimbi pricing matrix.' using errcode = '42501';
  end if;

  v_total := round(v_weight * v_price, 2);
  select coalesce(array_agg(value), '{}'::text[]) into v_photo_urls
  from jsonb_array_elements_text(coalesce(p_collection -> 'photo_urls', '[]'::jsonb)) value;

  perform set_config('seaweed_ag.collector_name', trim(p_collector_name), true);

  insert into public.collections (
    transaction_id, farmer_id, farmer_record_id, farmer_name_snapshot,
    community_id, community_record_id, community_name_snapshot, sack_id,
    collected_at, gps_latitude, gps_longitude, gps_accuracy_m,
    sack_weight_kg, seaweed_type, grade_code, price_per_kg, total_price,
    price_overridden, notes, photo_urls, custom_fields, aggregator_id,
    product_form, pricing_rule_id, currency, priced_weight_kg,
    unit_price_snapshot, line_total_snapshot, price_source,
    price_override_reason, submission_id, finalized_at
  ) values (
    coalesce(nullif(trim(p_collection ->> 'transaction_id'), ''), public.next_ag_transaction_id()),
    coalesce(v_farmer.farmer_id, nullif(trim(p_collection ->> 'farmer_id'), '')),
    v_farmer.id,
    coalesce(v_farmer.name, nullif(trim(p_collection ->> 'farmer_name_snapshot'), '')),
    coalesce(v_community.community_id, nullif(trim(p_collection ->> 'community_id'), '')),
    v_community.id,
    coalesce(v_community.community_name, nullif(trim(p_collection ->> 'community_name_snapshot'), '')),
    nullif(trim(p_collection ->> 'sack_id'), ''),
    v_collected_at,
    nullif(p_collection ->> 'gps_latitude', '')::numeric,
    nullif(p_collection ->> 'gps_longitude', '')::numeric,
    nullif(p_collection ->> 'gps_accuracy_m', '')::numeric,
    v_weight, v_type, v_grade, v_price, v_total, v_source = 'override',
    nullif(trim(p_collection ->> 'notes'), ''), v_photo_urls,
    coalesce(p_collection -> 'custom_fields', '{}'::jsonb),
    v_aggregator.id, v_form, v_rule.id, v_currency, v_weight,
    v_price, v_total, v_source, v_override_reason, p_submission_id, now()
  ) returning * into v_collection;

  v_receipt_number := public.ag_next_receipt_number(v_aggregator.id, v_collected_at);
  insert into public.ag_collection_receipts (
    collection_id, aggregator_id, receipt_number, issued_at,
    farmer_record_id, farmer_id_snapshot, farmer_name_snapshot,
    community_record_id, community_id_snapshot, community_name_snapshot,
    aggregator_name_snapshot, aggregator_contact_snapshot, collector_name_snapshot,
    seaweed_type_snapshot, grade_snapshot, product_form_snapshot,
    weight_kg_snapshot, unit_price_snapshot, currency, subtotal, total,
    notes, created_by
  ) values (
    v_collection.id, v_aggregator.id, v_receipt_number, now(),
    v_collection.farmer_record_id, v_collection.farmer_id, v_collection.farmer_name_snapshot,
    v_collection.community_record_id, v_collection.community_id, v_collection.community_name_snapshot,
    v_aggregator.organisation_name, coalesce(v_aggregator.phone, v_aggregator.email), trim(p_collector_name),
    v_type, v_grade, v_form, v_weight, v_price, v_currency, v_total, v_total,
    v_collection.notes, p_actor_user_id
  ) returning * into v_receipt;

  if p_queue_notifications then
    v_notification_count := public.ag_queue_receipt_notifications(v_receipt.id);
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'collection_id', v_collection.id,
    'transaction_id', v_collection.transaction_id,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'aggregator_name', v_aggregator.organisation_name,
    'price_source', v_source,
    'unit_price', v_price,
    'weight_kg', v_weight,
    'total', v_total,
    'currency', v_currency,
    'ungraded', v_is_ungraded,
    'community_record_id', v_collection.community_record_id,
    'community_id', v_collection.community_id,
    'community_name', v_collection.community_name_snapshot,
    'community_created', v_community_created,
    'notification_count', v_notification_count
  );
end;
$$;

create or replace function public.ag_public_mawimbi_farmer_phone_lookup(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := public.ag_phone_national_digits(p_phone);
  v_exact jsonb;
  v_matches jsonb;
  v_count integer;
begin
  if length(v_query) < 5 then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'id', f.id,
    'farmer_id', f.farmer_id,
    'name', f.name,
    'community_id', f.community_id,
    'community_name', c.community_name,
    'farm_size_value', f.farm_size_value,
    'farm_size_unit', f.farm_size_unit,
    'farm_size_updated_at', f.farm_size_updated_at,
    'match_exact', true
  )
  into v_exact
  from public.farmers f
  join public.ag_aggregator_farmers af
    on af.farmer_id = f.id and af.is_active
  join public.ag_aggregators a
    on a.id = af.aggregator_id and a.aggregator_code = 'MAWIMBI' and a.active
  left join public.communities c on c.community_id = f.community_id
  where f.active
    and public.ag_phone_national_digits(f.phone) = v_query
  order by f.farmer_id
  limit 1;

  if v_exact is not null then
    return v_exact;
  end if;

  select count(*)::integer, jsonb_agg(m.payload order by m.farmer_id)
  into v_count, v_matches
  from (
    select
      f.farmer_id,
      jsonb_build_object(
        'id', f.id,
        'farmer_id', f.farmer_id,
        'name', f.name,
        'community_id', f.community_id,
        'community_name', c.community_name,
        'farm_size_value', f.farm_size_value,
        'farm_size_unit', f.farm_size_unit,
        'farm_size_updated_at', f.farm_size_updated_at,
        'match_exact', false
      ) as payload
    from public.farmers f
    join public.ag_aggregator_farmers af
      on af.farmer_id = f.id and af.is_active
    join public.ag_aggregators a
      on a.id = af.aggregator_id and a.aggregator_code = 'MAWIMBI' and a.active
    left join public.communities c on c.community_id = f.community_id
    where f.active
      and public.ag_phone_national_digits(f.phone) like v_query || '%'
  ) m;

  if v_count = 1 then
    return v_matches -> 0;
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function public.ag_farmer_phone_lookup(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_query text := public.ag_phone_national_digits(p_phone);
  v_aggregator_id uuid := public.ag_require_active_aggregator();
  v_exact jsonb;
  v_matches jsonb;
  v_count integer;
begin
  if length(v_query) < 5 then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'id', f.id,
    'farmer_id', f.farmer_id,
    'name', f.name,
    'phone', f.phone,
    'community_id', f.community_id,
    'community_name', c.community_name,
    'farm_size_value', f.farm_size_value,
    'farm_size_unit', f.farm_size_unit,
    'farm_size_updated_at', f.farm_size_updated_at,
    'match_exact', true
  )
  into v_exact
  from public.farmers f
  join public.ag_aggregator_farmers af
    on af.farmer_id = f.id
    and af.aggregator_id = v_aggregator_id
    and af.is_active
  left join public.communities c on c.community_id = f.community_id
  where f.active
    and public.ag_phone_national_digits(f.phone) = v_query
  order by f.farmer_id
  limit 1;

  if v_exact is not null then
    return v_exact;
  end if;

  select count(*)::integer, jsonb_agg(m.payload order by m.farmer_id)
  into v_count, v_matches
  from (
    select
      f.farmer_id,
      jsonb_build_object(
        'id', f.id,
        'farmer_id', f.farmer_id,
        'name', f.name,
        'phone', f.phone,
        'community_id', f.community_id,
        'community_name', c.community_name,
        'farm_size_value', f.farm_size_value,
        'farm_size_unit', f.farm_size_unit,
        'farm_size_updated_at', f.farm_size_updated_at,
        'match_exact', false
      ) as payload
    from public.farmers f
    join public.ag_aggregator_farmers af
      on af.farmer_id = f.id
      and af.aggregator_id = v_aggregator_id
      and af.is_active
    left join public.communities c on c.community_id = f.community_id
    where f.active
      and public.ag_phone_national_digits(f.phone) like v_query || '%'
  ) m;

  if v_count = 1 then
    return v_matches -> 0;
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.ag_normalize_community_name(text) from public, anon, authenticated;
revoke all on function public.ag_public_mawimbi_farmer_phone_lookup(text) from public, anon, authenticated;
revoke all on function public.ag_farmer_phone_lookup(text) from public, anon, authenticated;

grant execute on function public.ag_public_mawimbi_farmer_phone_lookup(text) to anon, authenticated;
grant execute on function public.ag_farmer_phone_lookup(text) to authenticated;

notify pgrst, 'reload schema';

commit;
