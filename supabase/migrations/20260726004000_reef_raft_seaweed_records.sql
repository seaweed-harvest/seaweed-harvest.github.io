begin;

create table if not exists public.ag_reef_nursery_raft_seaweed_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.ag_reef_nursery_sessions(id) on delete cascade,
  raft_number smallint not null,
  seaweed_health text,
  seed_weight_value numeric(12,3),
  seed_weight_unit text not null default 'kg',
  harvest_weight_value numeric(12,3),
  harvest_weight_unit text not null default 'kg',
  equipment_replaced text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ag_reef_raft_seaweed_session_raft_unique
    unique (session_id, raft_number),
  constraint ag_reef_raft_seaweed_number_check
    check (raft_number in (1, 2)),
  constraint ag_reef_raft_seaweed_health_check
    check (seaweed_health is null or length(seaweed_health) <= 500),
  constraint ag_reef_raft_seed_weight_check
    check (seed_weight_value is null or seed_weight_value between 0 and 100000),
  constraint ag_reef_raft_seed_unit_check
    check (seed_weight_unit in ('kg', 'g')),
  constraint ag_reef_raft_harvest_weight_check
    check (harvest_weight_value is null or harvest_weight_value between 0 and 100000),
  constraint ag_reef_raft_harvest_unit_check
    check (harvest_weight_unit in ('kg', 'g')),
  constraint ag_reef_raft_equipment_check
    check (equipment_replaced is null or length(equipment_replaced) <= 1000)
);

create index if not exists ag_reef_raft_seaweed_session_idx
  on public.ag_reef_nursery_raft_seaweed_records (session_id, raft_number);

alter table public.ag_reef_nursery_raft_seaweed_records enable row level security;

comment on table public.ag_reef_nursery_raft_seaweed_records is
  'One optional Seaweed Record measurement block for each selected Reef Nursery raft.';
comment on column public.ag_reef_nursery_raft_seaweed_records.raft_number is
  'Stable Reef Nursery raft number. The initial form supports Raft #1 and Raft #2.';

insert into public.ag_reef_nursery_raft_seaweed_records (
  session_id,
  raft_number,
  seaweed_health,
  seed_weight_value,
  seed_weight_unit,
  harvest_weight_value,
  harvest_weight_unit,
  equipment_replaced,
  created_at,
  updated_at
)
select
  legacy.session_id,
  1,
  legacy.seaweed_health,
  legacy.seed_weight_value,
  legacy.seed_weight_unit,
  legacy.harvest_weight_value,
  legacy.harvest_weight_unit,
  legacy.equipment_replaced,
  legacy.created_at,
  legacy.updated_at
from public.ag_reef_nursery_seaweed_records legacy
on conflict (session_id, raft_number) do nothing;

create or replace function public.ag_replace_reef_nursery_raft_seaweed_records(
  p_session_id uuid,
  p_raft_records jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_record jsonb;
  v_unknown_keys text[];
  v_seen smallint[] := '{}'::smallint[];
  v_raft_number smallint;
  v_health text;
  v_seed_weight numeric;
  v_seed_unit text;
  v_harvest_weight numeric;
  v_harvest_unit text;
  v_equipment text;
  v_count integer := 0;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_active_aggregator();

  if p_session_id is null then
    raise exception 'Reef Nursery session ID is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.ag_reef_nursery_sessions session
    where session.id = p_session_id
      and session.aggregator_id = v_aggregator_id
      and session.deleted_at is null
  ) then
    raise exception 'Reef Nursery record was not found.' using errcode = 'P0002';
  end if;
  if p_raft_records is null
     or jsonb_typeof(p_raft_records) <> 'array'
     or jsonb_array_length(p_raft_records) > 2 then
    raise exception 'Selected raft records must be an array of no more than two rows.'
      using errcode = '22023';
  end if;

  delete from public.ag_reef_nursery_raft_seaweed_records
  where session_id = p_session_id;

  for v_record in select value from jsonb_array_elements(p_raft_records)
  loop
    if jsonb_typeof(v_record) <> 'object' then
      raise exception 'Each selected raft record must be an object.'
        using errcode = '22023';
    end if;

    select array_agg(key order by key) into v_unknown_keys
    from jsonb_object_keys(v_record) key
    where key <> all(array[
      'raft_number', 'seaweed_health', 'seed_weight_value', 'seed_weight_unit',
      'harvest_weight_value', 'harvest_weight_unit', 'equipment_replaced'
    ]::text[]);
    if v_unknown_keys is not null then
      raise exception 'Unsupported selected raft fields: %',
        array_to_string(v_unknown_keys, ', ') using errcode = '22023';
    end if;

    begin
      v_raft_number := nullif(v_record ->> 'raft_number', '')::smallint;
      v_seed_weight := nullif(v_record ->> 'seed_weight_value', '')::numeric;
      v_harvest_weight := nullif(v_record ->> 'harvest_weight_value', '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A selected raft number or weight is invalid.'
        using errcode = '22023';
    end;

    if v_raft_number not in (1, 2) then
      raise exception 'Select Raft #1 or Raft #2.' using errcode = '22023';
    end if;
    if v_raft_number = any(v_seen) then
      raise exception 'Each selected raft can appear only once.' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_raft_number);

    v_health := nullif(trim(v_record ->> 'seaweed_health'), '');
    v_seed_unit := coalesce(
      nullif(lower(trim(v_record ->> 'seed_weight_unit')), ''),
      'kg'
    );
    v_harvest_unit := coalesce(
      nullif(lower(trim(v_record ->> 'harvest_weight_unit')), ''),
      'kg'
    );
    v_equipment := nullif(trim(v_record ->> 'equipment_replaced'), '');

    if v_health is not null and length(v_health) > 500 then
      raise exception 'Seaweed health must be 500 characters or fewer.'
        using errcode = '22023';
    end if;
    if v_seed_weight is not null
       and (v_seed_weight < 0 or v_seed_weight > 100000) then
      raise exception 'Seed weight is outside the allowed range.'
        using errcode = '22023';
    end if;
    if v_harvest_weight is not null
       and (v_harvest_weight < 0 or v_harvest_weight > 100000) then
      raise exception 'Harvest weight is outside the allowed range.'
        using errcode = '22023';
    end if;
    if v_seed_unit not in ('kg', 'g')
       or v_harvest_unit not in ('kg', 'g') then
      raise exception 'Select valid weight units.' using errcode = '22023';
    end if;
    if v_equipment is not null and length(v_equipment) > 1000 then
      raise exception 'Equipment replaced must be 1000 characters or fewer.'
        using errcode = '22023';
    end if;

    insert into public.ag_reef_nursery_raft_seaweed_records (
      session_id,
      raft_number,
      seaweed_health,
      seed_weight_value,
      seed_weight_unit,
      harvest_weight_value,
      harvest_weight_unit,
      equipment_replaced
    ) values (
      p_session_id,
      v_raft_number,
      v_health,
      v_seed_weight,
      v_seed_unit,
      v_harvest_weight,
      v_harvest_unit,
      v_equipment
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.ag_submit_reef_nursery_session_v2(
  p_submission_id uuid,
  p_session jsonb,
  p_participants jsonb,
  p_seaweed_record jsonb,
  p_photos jsonb,
  p_training_delivered jsonb,
  p_practical_competencies jsonb,
  p_raft_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_raft_count integer;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_result := public.ag_submit_reef_nursery_session(
    p_submission_id,
    p_session,
    p_participants,
    p_seaweed_record,
    p_photos,
    p_training_delivered,
    p_practical_competencies
  );
  v_session_id := nullif(v_result ->> 'session_id', '')::uuid;
  if v_session_id is null then
    raise exception 'The Reef Nursery session could not be identified.'
      using errcode = 'P0001';
  end if;
  v_raft_count := public.ag_replace_reef_nursery_raft_seaweed_records(
    v_session_id,
    coalesce(p_raft_records, '[]'::jsonb)
  );
  return v_result || jsonb_build_object('raft_count', v_raft_count);
end;
$$;

create or replace function public.ag_update_reef_nursery_session_v2(
  p_session_id uuid,
  p_session jsonb,
  p_participants jsonb,
  p_seaweed_record jsonb,
  p_photos jsonb,
  p_training_delivered jsonb,
  p_practical_competencies jsonb,
  p_raft_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result jsonb;
  v_raft_count integer;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_result := public.ag_update_reef_nursery_session(
    p_session_id,
    p_session,
    p_participants,
    p_seaweed_record,
    p_photos,
    p_training_delivered,
    p_practical_competencies
  );
  v_raft_count := public.ag_replace_reef_nursery_raft_seaweed_records(
    p_session_id,
    coalesce(p_raft_records, '[]'::jsonb)
  );
  return v_result || jsonb_build_object('raft_count', v_raft_count);
end;
$$;

create or replace function public.ag_save_reef_nursery_draft_v2(
  p_session_id uuid,
  p_submission_id uuid,
  p_session jsonb,
  p_participants jsonb,
  p_seaweed_record jsonb,
  p_photos jsonb,
  p_training_delivered jsonb,
  p_practical_competencies jsonb,
  p_raft_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_raft_count integer;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_result := public.ag_save_reef_nursery_draft(
    p_session_id,
    p_submission_id,
    p_session,
    p_participants,
    p_seaweed_record,
    p_photos,
    p_training_delivered,
    p_practical_competencies
  );
  v_session_id := nullif(v_result ->> 'session_id', '')::uuid;
  if v_session_id is null then
    raise exception 'The Reef Nursery draft could not be identified.'
      using errcode = 'P0001';
  end if;
  v_raft_count := public.ag_replace_reef_nursery_raft_seaweed_records(
    v_session_id,
    coalesce(p_raft_records, '[]'::jsonb)
  );
  return v_result || jsonb_build_object('raft_count', v_raft_count);
end;
$$;

create or replace function public.ag_reef_nursery_session_detail_v3(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_raft_records jsonb;
begin
  v_result := public.ag_reef_nursery_session_detail_v2(p_session_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'raft_number', record.raft_number,
    'seaweed_health', record.seaweed_health,
    'seed_weight_value', record.seed_weight_value,
    'seed_weight_unit', record.seed_weight_unit,
    'harvest_weight_value', record.harvest_weight_value,
    'harvest_weight_unit', record.harvest_weight_unit,
    'equipment_replaced', record.equipment_replaced
  ) order by record.raft_number), '[]'::jsonb)
  into v_raft_records
  from public.ag_reef_nursery_raft_seaweed_records record
  where record.session_id = p_session_id;

  return v_result || jsonb_build_object(
    'raft_seaweed_records',
    v_raft_records
  );
end;
$$;

revoke all on table public.ag_reef_nursery_raft_seaweed_records
  from public, anon, authenticated;
revoke all on function public.ag_replace_reef_nursery_raft_seaweed_records(
  uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_submit_reef_nursery_session_v2(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_update_reef_nursery_session_v2(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_save_reef_nursery_draft_v2(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.ag_reef_nursery_session_detail_v3(uuid)
  from public, anon, authenticated;

grant execute on function public.ag_submit_reef_nursery_session_v2(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.ag_update_reef_nursery_session_v2(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.ag_save_reef_nursery_draft_v2(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.ag_reef_nursery_session_detail_v3(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
