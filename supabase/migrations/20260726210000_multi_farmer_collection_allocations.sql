begin;

create table if not exists public.ag_collection_farmer_allocations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  aggregator_id uuid not null references public.ag_aggregators(id) on delete cascade,
  position smallint not null,
  farmer_record_id uuid references public.farmers(id) on delete set null,
  farmer_id_snapshot text,
  farmer_name_snapshot text not null,
  community_record_id uuid references public.communities(id) on delete set null,
  community_id_snapshot text,
  community_name_snapshot text,
  farm_size_value numeric,
  farm_size_unit text,
  weight_kg numeric,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint ag_collection_farmer_allocations_position_check
    check (position between 1 and 25),
  constraint ag_collection_farmer_allocations_name_check
    check (length(trim(farmer_name_snapshot)) between 1 and 200),
  constraint ag_collection_farmer_allocations_farm_size_check
    check (farm_size_value is null or farm_size_value >= 0),
  constraint ag_collection_farmer_allocations_weight_check
    check (weight_kg is null or weight_kg between 0 and 5000),
  constraint ag_collection_farmer_allocations_position_unique
    unique (collection_id, position)
);

comment on table public.ag_collection_farmer_allocations is
  'Farmers attached to one collection. The collection retains the overall harvest weight; optional allocation weights divide that total between farmers.';
comment on column public.ag_collection_farmer_allocations.position is
  'Farmer order from the collection form. Position 1 remains the backward-compatible primary farmer on collections.';
comment on column public.ag_collection_farmer_allocations.weight_kg is
  'Optional share of the collection total attributed to this farmer.';

create unique index if not exists ag_collection_farmer_allocations_registered_unique
  on public.ag_collection_farmer_allocations(collection_id, farmer_record_id)
  where farmer_record_id is not null;
create index if not exists ag_collection_farmer_allocations_collection_idx
  on public.ag_collection_farmer_allocations(collection_id, position);
create index if not exists ag_collection_farmer_allocations_farmer_idx
  on public.ag_collection_farmer_allocations(farmer_record_id, collection_id)
  where farmer_record_id is not null;
create index if not exists ag_collection_farmer_allocations_aggregator_idx
  on public.ag_collection_farmer_allocations(aggregator_id, collection_id);

alter table public.ag_collection_farmer_allocations enable row level security;

drop policy if exists "ag authorised read collection farmer allocations"
  on public.ag_collection_farmer_allocations;
create policy "ag authorised read collection farmer allocations"
on public.ag_collection_farmer_allocations
for select
to authenticated
using (
  (
    public.ag_user_has_aggregator_access(aggregator_id, (select auth.uid()))
    and (
      public.ag_has_permission('can_view_data')
      or public.ag_has_permission('can_edit_collections')
      or public.ag_has_permission('can_view_registry')
    )
  )
  or farmer_record_id = (
    select profile.farmer_record_id
    from public.ag_user_profiles profile
    where profile.id = (select auth.uid())
      and profile.account_status = 'active'
  )
);

revoke all on table public.ag_collection_farmer_allocations from public, anon;
grant select on table public.ag_collection_farmer_allocations to authenticated;

create or replace function public.ag_capture_collection_farmer_allocations()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_items jsonb := new.custom_fields -> 'collection_farmers';
  v_item jsonb;
  v_position bigint;
  v_farmer public.farmers%rowtype;
  v_community public.communities%rowtype;
  v_farmer_record_text text;
  v_farmer_id text;
  v_farmer_name text;
  v_community_record_text text;
  v_community_id text;
  v_community_name text;
  v_farm_size numeric;
  v_farm_unit text;
  v_weight numeric;
  v_original_farm_size numeric;
  v_original_farm_unit text;
  v_allocation_count integer;
  v_weight_count integer;
  v_weight_total numeric;
begin
  if v_items is not null and jsonb_typeof(v_items) <> 'array' then
    raise exception 'Collection farmers must be supplied as a list.';
  end if;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    if new.farmer_record_id is null
      and nullif(trim(new.farmer_id), '') is null
      and nullif(trim(new.farmer_name_snapshot), '') is null then
      return new;
    end if;
    v_items := jsonb_build_array(jsonb_build_object(
      'farmer_record_id', new.farmer_record_id,
      'farmer_id', new.farmer_id,
      'farmer_name_snapshot', new.farmer_name_snapshot,
      'community_record_id', new.community_record_id,
      'community_id_snapshot', new.community_id,
      'community_name_snapshot', new.community_name_snapshot,
      'farm_size_value', new.custom_fields -> 'farm_size_value',
      'farm_size_unit', new.custom_fields ->> 'farm_size_unit',
      'weight_kg', new.sack_weight_kg
    ));
  end if;

  if jsonb_array_length(v_items) > 25 then
    raise exception 'A collection can contain no more than 25 farmers.';
  end if;

  for v_item, v_position in
    select item.value, item.position
    from jsonb_array_elements(v_items) with ordinality as item(value, position)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each collection farmer must be an object.';
    end if;

    v_farmer := null;
    v_community := null;
    v_farmer_record_text := nullif(trim(v_item ->> 'farmer_record_id'), '');
    v_farmer_id := upper(nullif(trim(v_item ->> 'farmer_id'), ''));
    v_community_record_text := nullif(trim(v_item ->> 'community_record_id'), '');
    v_community_id := upper(nullif(trim(v_item ->> 'community_id_snapshot'), ''));

    if v_farmer_record_text is not null then
      select farmer.* into v_farmer
      from public.farmers farmer
      join public.ag_aggregator_farmers link
        on link.farmer_id = farmer.id
        and link.aggregator_id = new.aggregator_id
        and link.is_active
      where farmer.id = v_farmer_record_text::uuid
        and farmer.active;
      if not found then
        raise exception 'A selected farmer is not available for this aggregator.' using errcode = '42501';
      end if;
    elsif v_farmer_id is not null then
      select farmer.* into v_farmer
      from public.farmers farmer
      join public.ag_aggregator_farmers link
        on link.farmer_id = farmer.id
        and link.aggregator_id = new.aggregator_id
        and link.is_active
      where farmer.farmer_id = v_farmer_id
        and farmer.active;
    end if;

    v_farmer_name := coalesce(
      nullif(trim(v_farmer.name), ''),
      nullif(regexp_replace(trim(v_item ->> 'farmer_name_snapshot'), '\s+', ' ', 'g'), '')
    );
    if v_farmer_name is null or length(v_farmer_name) > 200 or v_farmer_name ~ '[[:cntrl:]]' then
      raise exception 'Each added farmer requires a valid name.';
    end if;

    if v_community_record_text is not null then
      select community.* into v_community
      from public.communities community
      join public.ag_aggregator_communities link
        on link.community_id = community.id
        and link.aggregator_id = new.aggregator_id
        and link.is_active
      where community.id = v_community_record_text::uuid
        and community.active;
      if not found then
        raise exception 'A farmer community is not available for this aggregator.' using errcode = '42501';
      end if;
    elsif v_community_id is not null then
      select community.* into v_community
      from public.communities community
      join public.ag_aggregator_communities link
        on link.community_id = community.id
        and link.aggregator_id = new.aggregator_id
        and link.is_active
      where community.community_id = v_community_id
        and community.active;
    elsif v_farmer.id is not null and nullif(trim(v_farmer.community_id), '') is not null then
      select community.* into v_community
      from public.communities community
      where community.community_id = v_farmer.community_id
        and community.active;
    end if;

    v_community_name := coalesce(
      nullif(trim(v_community.community_name), ''),
      nullif(regexp_replace(trim(v_item ->> 'community_name_snapshot'), '\s+', ' ', 'g'), '')
    );
    v_farm_size := nullif(v_item ->> 'farm_size_value', '')::numeric;
    v_farm_unit := lower(nullif(trim(v_item ->> 'farm_size_unit'), ''));
    v_weight := nullif(v_item ->> 'weight_kg', '')::numeric;

    if v_farm_size is not null and v_farm_size < 0 then
      raise exception 'Farm size cannot be negative.';
    end if;
    if v_farm_unit is not null and length(v_farm_unit) > 30 then
      raise exception 'Farm size unit is too long.';
    end if;
    if v_weight is not null and (v_weight < 0 or v_weight > 5000) then
      raise exception 'Individual farmer weight must be between 0 and 5000 kg.';
    end if;

    insert into public.ag_collection_farmer_allocations (
      collection_id,
      aggregator_id,
      position,
      farmer_record_id,
      farmer_id_snapshot,
      farmer_name_snapshot,
      community_record_id,
      community_id_snapshot,
      community_name_snapshot,
      farm_size_value,
      farm_size_unit,
      weight_kg,
      created_by
    ) values (
      new.id,
      new.aggregator_id,
      v_position,
      v_farmer.id,
      coalesce(v_farmer.farmer_id, v_farmer_id),
      v_farmer_name,
      v_community.id,
      coalesce(v_community.community_id, v_community_id),
      v_community_name,
      v_farm_size,
      v_farm_unit,
      v_weight,
      new.recorded_by_user_id
    );

    if v_farmer.id is not null and v_item ? 'farm_size_value' then
      v_original_farm_size := v_farmer.farm_size_value;
      v_original_farm_unit := nullif(trim(v_farmer.farm_size_unit), '');
      if v_original_farm_size is distinct from v_farm_size
        or v_original_farm_unit is distinct from v_farm_unit then
        perform set_config('seaweed_ag.farm_size_change_source', 'collection_form', true);
        perform set_config(
          'seaweed_ag.farm_size_change_notes',
          'Updated during collection intake by '
            || coalesce(nullif(current_setting('seaweed_ag.collector_name', true), ''), 'collector'),
          true
        );
        update public.farmers
        set farm_size_value = v_farm_size,
            farm_size_unit = v_farm_unit
        where id = v_farmer.id;
      end if;
    end if;
  end loop;

  select
    count(*)::integer,
    count(allocation.weight_kg)::integer,
    coalesce(sum(allocation.weight_kg), 0)
  into v_allocation_count, v_weight_count, v_weight_total
  from public.ag_collection_farmer_allocations allocation
  where allocation.collection_id = new.id;

  if v_weight_count > 0 and v_weight_count <> v_allocation_count then
    raise exception 'Enter a weight for every farmer, or leave all individual weights empty.';
  end if;
  if v_weight_count > 0 and abs(v_weight_total - new.sack_weight_kg) >= 0.005 then
    raise exception 'Individual farmer weights must equal the collection total.';
  end if;

  return new;
end;
$$;

revoke all on function public.ag_capture_collection_farmer_allocations()
  from public, anon, authenticated;

drop trigger if exists ag_collection_capture_farmer_allocations on public.collections;
create trigger ag_collection_capture_farmer_allocations
after insert on public.collections
for each row
execute function public.ag_capture_collection_farmer_allocations();

insert into public.ag_collection_farmer_allocations (
  collection_id,
  aggregator_id,
  position,
  farmer_record_id,
  farmer_id_snapshot,
  farmer_name_snapshot,
  community_record_id,
  community_id_snapshot,
  community_name_snapshot,
  farm_size_value,
  farm_size_unit,
  weight_kg,
  created_at,
  created_by
)
select
  collection.id,
  collection.aggregator_id,
  1,
  collection.farmer_record_id,
  collection.farmer_id,
  coalesce(nullif(trim(collection.farmer_name_snapshot), ''), nullif(trim(collection.farmer_id), ''), 'Unassigned farmer'),
  collection.community_record_id,
  collection.community_id,
  collection.community_name_snapshot,
  nullif(collection.custom_fields ->> 'farm_size_value', '')::numeric,
  nullif(trim(collection.custom_fields ->> 'farm_size_unit'), ''),
  collection.sack_weight_kg,
  collection.created_at,
  collection.recorded_by_user_id
from public.collections collection
where (
    collection.farmer_record_id is not null
    or nullif(trim(collection.farmer_id), '') is not null
    or nullif(trim(collection.farmer_name_snapshot), '') is not null
  )
  and not exists (
    select 1
    from public.ag_collection_farmer_allocations allocation
    where allocation.collection_id = collection.id
  )
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
