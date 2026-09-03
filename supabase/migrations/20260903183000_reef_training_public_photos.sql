begin;

-- Keep the existing private Reef photo bucket. Public and authenticated Reef
-- users may upload only JPEGs beneath an editable Training session ID.
create or replace function private.ag_reef_training_photo_access(p_storage_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_access_mode text := v_scope ->> 'access_mode';
  v_session_id uuid;
  v_session public.ag_reef_nursery_sessions%rowtype;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    return false;
  end if;
  if p_storage_path is null
     or lower(p_storage_path) !~ '^[0-9a-f-]{36}/[0-9]{2}-[0-9a-f-]{36}[.]jpg$' then
    return false;
  end if;

  begin
    v_session_id := split_part(p_storage_path, '/', 1)::uuid;
  exception when others then
    return false;
  end;

  select *
  into v_session
  from public.ag_reef_nursery_sessions session
  where session.id = v_session_id
    and session.aggregator_id = v_aggregator_id
    and session.deleted_at is null;
  if not found then
    return false;
  end if;

  return v_access_mode = 'authenticated'
    or v_session.created_at + interval '168 hours' > now();
end;
$$;

create or replace function private.ag_reef_training_photo_insert_access(p_storage_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_session_id uuid;
begin
  if not private.ag_reef_training_photo_access(p_storage_path) then
    return false;
  end if;
  begin
    v_session_id := split_part(p_storage_path, '/', 1)::uuid;
  exception when others then
    return false;
  end;

  return (
    select count(*) < 8
    from public.ag_reef_nursery_photos photo
    where photo.session_id = v_session_id
  ) and (
    select count(*) < 8
    from storage.objects object
    where object.bucket_id = 'reef-nursery-photos'
      and object.name like v_session_id::text || '/%'
  );
end;
$$;

create or replace function private.ag_reef_training_photo_cleanup_access(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, storage, pg_temp
as $$
  select private.ag_reef_training_photo_access(p_storage_path)
    and not exists (
      select 1
      from public.ag_reef_nursery_photos photo
      where photo.storage_path = p_storage_path
    );
$$;

revoke all on function private.ag_reef_training_photo_access(text) from public;
revoke all on function private.ag_reef_training_photo_insert_access(text) from public;
revoke all on function private.ag_reef_training_photo_cleanup_access(text) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.ag_reef_training_photo_access(text) to anon, authenticated;
grant execute on function private.ag_reef_training_photo_insert_access(text) to anon, authenticated;
grant execute on function private.ag_reef_training_photo_cleanup_access(text) to anon, authenticated;

drop policy if exists "reef nursery workspace photo insert" on storage.objects;
create policy "reef nursery workspace photo insert"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'reef-nursery-photos'
  and lower(storage.extension(name)) = 'jpg'
  and private.ag_reef_training_photo_insert_access(name)
);

drop policy if exists "reef nursery workspace photo read" on storage.objects;
create policy "reef nursery workspace photo read"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'reef-nursery-photos'
  and private.ag_reef_training_photo_access(name)
);

drop policy if exists "reef nursery workspace photo cleanup" on storage.objects;
create policy "reef nursery workspace photo cleanup"
on storage.objects
for delete
to anon, authenticated
using (
  bucket_id = 'reef-nursery-photos'
  and private.ag_reef_training_photo_cleanup_access(name)
);

create or replace function public.ag_reef_training_workspace_attach_photo(
  p_session_id uuid,
  p_storage_path text,
  p_original_name text,
  p_byte_size integer,
  p_content_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_access_mode text := v_scope ->> 'access_mode';
  v_actor_id uuid := case when v_access_mode = 'authenticated' then (select auth.uid()) else null end;
  v_session public.ag_reef_nursery_sessions%rowtype;
  v_photo public.ag_reef_nursery_photos%rowtype;
  v_next_order integer;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'Training session ID is required.' using errcode = '22023';
  end if;

  select *
  into v_session
  from public.ag_reef_nursery_sessions session
  where session.id = p_session_id
    and session.aggregator_id = v_aggregator_id
    and session.deleted_at is null
  for update;
  if not found then
    raise exception 'Training record was not found.' using errcode = 'P0002';
  end if;
  if v_access_mode <> 'authenticated'
     and v_session.created_at + interval '168 hours' <= now() then
    raise exception 'This Training record is older than 7 days. Sign in with an authorised COSME Reef account to edit it.'
      using errcode = '42501';
  end if;

  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> p_session_id::text
     or lower(p_storage_path) !~ '^[0-9a-f-]{36}/[0-9]{2}-[0-9a-f-]{36}[.]jpg$' then
    raise exception 'Training photo path is invalid.' using errcode = '22023';
  end if;
  if p_original_name is null or length(trim(p_original_name)) not between 1 and 255 then
    raise exception 'Training photo name must be between 1 and 255 characters.' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size not between 1 and 1048576 then
    raise exception 'Training photo must be no larger than 1 MB.' using errcode = '22023';
  end if;
  if lower(coalesce(trim(p_content_type), '')) <> 'image/jpeg' then
    raise exception 'Training photos must be JPEG images.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'reef-nursery-photos'
      and object.name = p_storage_path
  ) then
    raise exception 'The uploaded Training photo could not be found.' using errcode = '22023';
  end if;

  select *
  into v_photo
  from public.ag_reef_nursery_photos photo
  where photo.storage_path = p_storage_path;
  if found then
    if v_photo.session_id <> p_session_id then
      raise exception 'The Training photo is already attached to another record.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id', v_photo.id,
      'photo_order', v_photo.photo_order,
      'storage_path', v_photo.storage_path,
      'original_name', v_photo.original_name,
      'byte_size', v_photo.byte_size,
      'content_type', v_photo.content_type,
      'created_at', v_photo.created_at
    );
  end if;

  select coalesce(max(photo.photo_order), 0) + 1
  into v_next_order
  from public.ag_reef_nursery_photos photo
  where photo.session_id = p_session_id;
  if v_next_order > 8 then
    raise exception 'Only 8 Training photos can be attached.' using errcode = '22023';
  end if;

  insert into public.ag_reef_nursery_photos (
    session_id,
    photo_order,
    storage_path,
    original_name,
    byte_size,
    content_type,
    uploaded_by_user_id
  ) values (
    p_session_id,
    v_next_order,
    p_storage_path,
    trim(p_original_name),
    p_byte_size,
    'image/jpeg',
    v_actor_id
  )
  returning * into v_photo;

  return jsonb_build_object(
    'id', v_photo.id,
    'photo_order', v_photo.photo_order,
    'storage_path', v_photo.storage_path,
    'original_name', v_photo.original_name,
    'byte_size', v_photo.byte_size,
    'content_type', v_photo.content_type,
    'created_at', v_photo.created_at
  );
end;
$$;

create or replace function public.ag_reef_training_workspace_photos(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_scope jsonb := public.ag_reef_training_workspace_scope();
  v_aggregator_id uuid := nullif(v_scope ->> 'aggregator_id', '')::uuid;
  v_access_mode text := v_scope ->> 'access_mode';
  v_session public.ag_reef_nursery_sessions%rowtype;
  v_photos jsonb;
begin
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then
    raise exception '%', coalesce(v_scope ->> 'reason', 'Reef Nursery access is required.')
      using errcode = '42501';
  end if;

  select *
  into v_session
  from public.ag_reef_nursery_sessions session
  where session.id = p_session_id
    and session.aggregator_id = v_aggregator_id
    and session.deleted_at is null;
  if not found then
    raise exception 'Training record was not found.' using errcode = 'P0002';
  end if;
  if v_access_mode <> 'authenticated'
     and v_session.created_at + interval '168 hours' <= now() then
    raise exception 'This Training record is older than 7 days. Sign in with an authorised COSME Reef account to open it.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', photo.id,
    'photo_order', photo.photo_order,
    'storage_path', photo.storage_path,
    'original_name', photo.original_name,
    'byte_size', photo.byte_size,
    'content_type', photo.content_type,
    'created_at', photo.created_at
  ) order by photo.photo_order, photo.id), '[]'::jsonb)
  into v_photos
  from public.ag_reef_nursery_photos photo
  where photo.session_id = p_session_id;

  return v_photos;
end;
$$;

revoke all on function public.ag_reef_training_workspace_attach_photo(uuid, text, text, integer, text) from public;
revoke all on function public.ag_reef_training_workspace_photos(uuid) from public;
grant execute on function public.ag_reef_training_workspace_attach_photo(uuid, text, text, integer, text)
  to anon, authenticated;
grant execute on function public.ag_reef_training_workspace_photos(uuid)
  to anon, authenticated;

commit;
