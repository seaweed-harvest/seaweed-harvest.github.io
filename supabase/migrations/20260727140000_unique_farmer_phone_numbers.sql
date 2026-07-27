begin;

create or replace function public.ag_enforce_unique_farmer_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := public.ag_phone_national_digits(new.phone);
begin
  if nullif(v_phone, '') is null then
    return new;
  end if;

  if exists (
    select 1
    from public.farmers farmer
    where public.ag_phone_national_digits(farmer.phone) = v_phone
      and farmer.id is distinct from new.id
  ) then
    raise exception 'This phone number is already registered to another farmer.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.ag_enforce_unique_farmer_phone()
  from public, anon, authenticated;

drop trigger if exists ag_farmers_enforce_unique_phone on public.farmers;
create trigger ag_farmers_enforce_unique_phone
before insert or update of phone on public.farmers
for each row
execute function public.ag_enforce_unique_farmer_phone();

create unique index if not exists farmers_phone_national_digits_unique
  on public.farmers (public.ag_phone_national_digits(phone))
  where nullif(public.ag_phone_national_digits(phone), '') is not null;

create or replace function public.ag_reject_duplicate_collection_farmer_phones()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb := new.custom_fields -> 'collection_farmers';
begin
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    return new;
  end if;

  if exists (
    select 1
    from (
      select public.ag_phone_national_digits(item.value ->> 'phone_snapshot') as phone
      from jsonb_array_elements(v_items) item(value)
    ) phones
    where nullif(phones.phone, '') is not null
    group by phones.phone
    having count(*) > 1
  ) then
    raise exception 'Each farmer in a collection must use a different phone number.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.ag_reject_duplicate_collection_farmer_phones()
  from public, anon, authenticated;

drop trigger if exists ag_collections_reject_duplicate_farmer_phones on public.collections;
create trigger ag_collections_reject_duplicate_farmer_phones
before insert or update of custom_fields on public.collections
for each row
execute function public.ag_reject_duplicate_collection_farmer_phones();

commit;
