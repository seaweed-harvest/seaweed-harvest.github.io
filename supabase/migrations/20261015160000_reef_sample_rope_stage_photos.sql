begin;

-- Photo attachments belong to a site visit and measurement stage, not to
-- an individual rope. Older rope readings and existing photos are untouched.
create table if not exists public.ag_reef_sample_rope_stage_photos (
  id uuid primary key default gen_random_uuid(),
  aggregator_id uuid not null references public.ag_aggregators(id),
  site_code text not null,
  measurement_stage text not null check (measurement_stage in ('initial','week_2','week_4','week_6')),
  capture_date date not null,
  storage_path text not null unique,
  original_name text not null,
  byte_size integer,
  content_type text,
  status text not null default 'pending' check (status in ('pending','ready')),
  uploaded_by_user_id uuid,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint reef_sample_stage_photo_size check (byte_size is null or byte_size between 1 and 1048576)
);
create index if not exists reef_stage_photos_site_stage_idx
  on public.ag_reef_sample_rope_stage_photos (aggregator_id, site_code, measurement_stage, capture_date, created_at desc)
  where status = 'ready';
alter table public.ag_reef_sample_rope_stage_photos enable row level security;
revoke all on public.ag_reef_sample_rope_stage_photos from public, anon, authenticated;

-- A 30-minute reservation allows the existing browser JPEG compressor to
-- upload directly to the private bucket. Only its unique reserved path is
-- accepted, and read access requires a completed attachment.
create or replace function private.ag_reef_sample_rope_stage_photo_access(
  p_storage_path text, p_action text
) returns boolean
language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_photo public.ag_reef_sample_rope_stage_photos%rowtype;
begin
  if p_action not in ('insert','read') or
     p_storage_path !~ '^sample-ropes/[0-9a-f-]{36}/photo[.]jpg$' or
     not coalesce((v_scope->>'allowed')::boolean,false) then
    return false;
  end if;
  select * into v_photo
  from public.ag_reef_sample_rope_stage_photos p
  where p.storage_path = p_storage_path
    and p.aggregator_id = nullif(v_scope->>'aggregator_id','')::uuid;
  if not found then return false; end if;
  if p_action = 'insert' then
    return v_photo.status = 'pending' and v_photo.created_at > now() - interval '30 minutes';
  end if;
  return v_photo.status = 'ready';
end;
$$;
revoke all on function private.ag_reef_sample_rope_stage_photo_access(text,text) from public;
grant execute on function private.ag_reef_sample_rope_stage_photo_access(text,text) to anon,authenticated;

create policy "reef sample rope stage photo insert"
  on storage.objects for insert to anon,authenticated
  with check (bucket_id = 'reef-seaweed-record-photos'
    and lower(storage.extension(name)) = 'jpg'
    and private.ag_reef_sample_rope_stage_photo_access(name,'insert'));

create policy "reef sample rope stage photo read"
  on storage.objects for select to anon,authenticated
  using (bucket_id = 'reef-seaweed-record-photos'
    and private.ag_reef_sample_rope_stage_photo_access(name,'read'));

create or replace function public.ag_reef_sample_rope_stage_photo_reserve(
  p_site_code text, p_stage text, p_capture_date date, p_original_name text
) returns jsonb
language plpgsql volatile security definer
set search_path = public,auth,storage,pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_agg uuid := nullif(v_scope->>'aggregator_id','')::uuid;
  v_id uuid := gen_random_uuid();
  v_name text := trim(p_original_name);
  v_has_measurement boolean;
  v_count integer;
begin
  if not coalesce((v_scope->>'allowed')::boolean,false) then
    raise exception 'Reef Nursery access is required.' using errcode='42501';
  end if;
  if p_stage not in ('initial','week_2','week_4','week_6')
     or p_capture_date is null or p_capture_date > current_date + 1
     or p_site_code is null or not exists(
       select 1 from public.ag_reef_sites s where s.site_code=p_site_code and s.is_active)
     or length(v_name) not between 1 and 255 then
    raise exception 'Select a valid site, stage, date and photo.' using errcode='22023';
  end if;
  -- Stage photos can only be attached after a matching register measurement
  -- has been saved. A new stage with no weights is not a valid attachment.
  select exists(
    select 1 from public.ag_reef_sample_rope_cycles c
    where c.aggregator_id=v_agg and c.site_code=p_site_code
      and c.status='active' and c.deleted_at is null
      and case p_stage
        when 'initial' then c.initial_weight_kg
        when 'week_2' then c.week_2_kg
        when 'week_4' then c.week_4_kg
        when 'week_6' then c.week_6_kg
      end is not null
  ) into v_has_measurement;
  if not v_has_measurement then
    raise exception 'Save the selected stage weight measurements before adding a photo.' using errcode='22023';
  end if;
  select count(*) into v_count from public.ag_reef_sample_rope_stage_photos p
  where p.aggregator_id=v_agg and p.site_code=p_site_code
    and p.measurement_stage=p_stage and p.capture_date=p_capture_date
    and (p.status='ready' or p.created_at>now()-interval '30 minutes');
  if v_count>=20 then
    raise exception 'Photo limit reached for this site, stage and date.' using errcode='22023';
  end if;
  insert into public.ag_reef_sample_rope_stage_photos
    (id,aggregator_id,site_code,measurement_stage,capture_date,storage_path,original_name,uploaded_by_user_id)
  values (v_id,v_agg,p_site_code,p_stage,p_capture_date,
    'sample-ropes/'||v_id::text||'/photo.jpg',v_name,
    case when v_scope->>'access_mode'='authenticated' then auth.uid() else null end);
  return jsonb_build_object('photo_id',v_id,
    'storage_path','sample-ropes/'||v_id::text||'/photo.jpg');
end;
$$;

create or replace function public.ag_reef_sample_rope_stage_photo_finalize(
  p_photo_id uuid, p_byte_size integer
) returns jsonb
language plpgsql volatile security definer
set search_path = public,auth,storage,pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_photo public.ag_reef_sample_rope_stage_photos%rowtype;
  v_stored_size bigint;
begin
  if not coalesce((v_scope->>'allowed')::boolean,false) then
    raise exception 'Reef Nursery access is required.' using errcode='42501';
  end if;
  if p_byte_size is null or p_byte_size not between 1 and 1048576 then
    raise exception 'JPEG photo must be 1 MB or smaller.' using errcode='22023';
  end if;
  select * into v_photo from public.ag_reef_sample_rope_stage_photos p
    where p.id=p_photo_id
      and p.aggregator_id=nullif(v_scope->>'aggregator_id','')::uuid
    for update;
  if not found or v_photo.status <> 'pending' or v_photo.created_at <= now()-interval '30 minutes' then
    raise exception 'Photo reservation expired or unavailable.' using errcode='42501';
  end if;
  select nullif(o.metadata->>'size','')::bigint into v_stored_size
  from storage.objects o
  where o.bucket_id='reef-seaweed-record-photos'
    and o.name=v_photo.storage_path;
  if not found then raise exception 'The uploaded photo was not found.' using errcode='P0002'; end if;
  if v_stored_size is not null and v_stored_size <> p_byte_size then
    raise exception 'Uploaded photo size mismatch.' using errcode='22023';
  end if;
  update public.ag_reef_sample_rope_stage_photos
  set byte_size=p_byte_size,content_type='image/jpeg',status='ready',finalized_at=now()
  where id=p_photo_id;
  return jsonb_build_object('photo_id',p_photo_id,'status','ready');
end;
$$;

create or replace function public.ag_reef_sample_rope_stage_photos(p_site_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public,auth,pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_agg uuid := nullif(v_scope->>'aggregator_id','')::uuid;
  v_photos jsonb;
begin
  if not coalesce((v_scope->>'allowed')::boolean,false) then
    raise exception 'Reef Nursery access is required.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'photo_id',p.id,'stage',p.measurement_stage,'date',p.capture_date,
    'storage_path',p.storage_path,'original_name',p.original_name
  ) order by p.capture_date,p.created_at),'[]'::jsonb)
  into v_photos
  from public.ag_reef_sample_rope_stage_photos p
  where p.aggregator_id=v_agg and p.site_code=p_site_code and p.status='ready';
  return v_photos;
end;
$$;

revoke all on function public.ag_reef_sample_rope_stage_photo_reserve(text,text,date,text) from public;
revoke all on function public.ag_reef_sample_rope_stage_photo_finalize(uuid,integer) from public;
revoke all on function public.ag_reef_sample_rope_stage_photos(text) from public;
grant execute on function public.ag_reef_sample_rope_stage_photo_reserve(text,text,date,text) to anon,authenticated;
grant execute on function public.ag_reef_sample_rope_stage_photo_finalize(uuid,integer) to anon,authenticated;
grant execute on function public.ag_reef_sample_rope_stage_photos(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
