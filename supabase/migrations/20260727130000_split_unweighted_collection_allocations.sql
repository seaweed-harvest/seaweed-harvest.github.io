begin;

create or replace function public.ag_split_unweighted_collection_farmer_allocations()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_allocation_count integer;
  v_weight_count integer;
  v_total_hundredths bigint;
  v_base_hundredths bigint;
  v_remainder bigint;
begin
  select
    count(*)::integer,
    count(allocation.weight_kg)::integer
  into v_allocation_count, v_weight_count
  from public.ag_collection_farmer_allocations allocation
  where allocation.collection_id = new.id;

  if v_allocation_count = 0 or v_weight_count > 0 then
    return new;
  end if;

  v_total_hundredths := round(new.sack_weight_kg * 100)::bigint;
  v_base_hundredths := v_total_hundredths / v_allocation_count;
  v_remainder := mod(v_total_hundredths, v_allocation_count);

  with ordered as (
    select
      allocation.id,
      row_number() over (order by allocation.position, allocation.id) as allocation_number
    from public.ag_collection_farmer_allocations allocation
    where allocation.collection_id = new.id
  )
  update public.ag_collection_farmer_allocations allocation
  set weight_kg = (
    v_base_hundredths
    + case when ordered.allocation_number <= v_remainder then 1 else 0 end
  )::numeric / 100
  from ordered
  where allocation.id = ordered.id;

  return new;
end;
$$;

revoke all on function public.ag_split_unweighted_collection_farmer_allocations()
  from public, anon, authenticated;

drop trigger if exists zz_ag_collection_split_unweighted_allocations on public.collections;
create trigger zz_ag_collection_split_unweighted_allocations
after insert on public.collections
for each row
execute function public.ag_split_unweighted_collection_farmer_allocations();

with unweighted_collections as (
  select
    allocation.collection_id,
    count(*)::integer as allocation_count
  from public.ag_collection_farmer_allocations allocation
  group by allocation.collection_id
  having count(allocation.weight_kg) = 0
),
ranked_allocations as (
  select
    allocation.id,
    collection.sack_weight_kg,
    unweighted.allocation_count,
    row_number() over (
      partition by allocation.collection_id
      order by allocation.position, allocation.id
    ) as allocation_number
  from public.ag_collection_farmer_allocations allocation
  join unweighted_collections unweighted
    on unweighted.collection_id = allocation.collection_id
  join public.collections collection
    on collection.id = allocation.collection_id
)
update public.ag_collection_farmer_allocations allocation
set weight_kg = (
  floor((ranked.sack_weight_kg * 100) / ranked.allocation_count)
  + case
      when ranked.allocation_number <= mod(
        round(ranked.sack_weight_kg * 100)::bigint,
        ranked.allocation_count
      ) then 1
      else 0
    end
) / 100
from ranked_allocations ranked
where allocation.id = ranked.id;

comment on column public.ag_collection_farmer_allocations.weight_kg is
  'Share of the collection total attributed to this farmer. Blank shares are split evenly to the nearest 0.01 kg.';

commit;
