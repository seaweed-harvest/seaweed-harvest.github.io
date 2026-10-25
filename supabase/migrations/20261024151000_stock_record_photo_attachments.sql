-- Private two-photo attachments for individual new-carton and QC/retest stock records.
begin;

alter table public.ag_stabilization_packing_records
  add column if not exists photo_attachments jsonb not null default '[]'::jsonb;
alter table public.ag_stabilization_packing_records
  add constraint ag_stock_photo_attachments_limit
  check (jsonb_typeof(photo_attachments) = 'array' and jsonb_array_length(photo_attachments) <= 2);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stock-record-photos','stock-record-photos',false,716800,array['image/jpeg']::text[])
on conflict (id) do update set public=false,file_size_limit=716800,allowed_mime_types=array['image/jpeg']::text[];

create policy "stock record photo upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'stock-record-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and lower(storage.extension(name)) = 'jpg'
  and public.ag_has_permission('can_submit_collection')
);
-- Storage RLS must use a scoped SECURITY DEFINER helper: the stock table
-- intentionally grants no direct SELECT to authenticated accounts.
create or replace function public.ag_can_read_stock_photo(p_storage_path text)
returns boolean language sql stable security definer
set search_path = public, auth, pg_temp
as $photo_read$
  select exists(
    select 1 from public.ag_stabilization_packing_records s
    where s.aggregator_id = public.ag_current_aggregator_id()
      and s.photo_attachments @> jsonb_build_array(jsonb_build_object('storage_path',p_storage_path))
      and (s.recorded_by_user_id = (select auth.uid())
           or public.ag_has_permission('can_view_data'))
  );
$photo_read$;
revoke all on function public.ag_can_read_stock_photo(text) from public, anon, authenticated;
grant execute on function public.ag_can_read_stock_photo(text) to authenticated;

create policy "stock record photo read" on storage.objects for select to authenticated
using (
  bucket_id = 'stock-record-photos'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.ag_can_read_stock_photo(name)
  )
);
create policy "stock record photo uploader cleanup" on storage.objects for delete to authenticated
using (
  bucket_id='stock-record-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.ag_validate_stock_photo_attachments(
  p_attachments jsonb, p_user_id uuid, p_submission_id uuid
) returns void language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_photo jsonb;
  v_path text;
  v_storage_size bigint;
begin
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array'
     or jsonb_array_length(p_attachments) > 2 then
    raise exception 'Choose at most two stock photos.' using errcode='22023';
  end if;
  for v_photo in select value from jsonb_array_elements(p_attachments)
  loop
    if jsonb_typeof(v_photo) <> 'object' then
      raise exception 'Invalid stock photo.' using errcode='22023';
    end if;
    v_path := v_photo ->> 'storage_path';
    if v_path is null or v_path !~ ('^' || p_user_id::text || '/' || p_submission_id::text || '/[A-Za-z0-9-]+[.]jpg$')
       or v_photo ->> 'content_type' <> 'image/jpeg'
       or length(coalesce(v_photo ->> 'original_name','')) not between 1 and 255
       or coalesce((v_photo ->> 'byte_size')::bigint,0) not between 1 and 716800
    then
      raise exception 'Invalid stock photo metadata.' using errcode='22023';
    end if;
    select (metadata ->> 'size')::bigint into v_storage_size
    from storage.objects where bucket_id='stock-record-photos' and name=v_path;
    if not found or v_storage_size is distinct from (v_photo ->> 'byte_size')::bigint then
      raise exception 'Upload the stock photo before saving the record.' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct item ->> 'storage_path') from jsonb_array_elements(p_attachments) item)
     <> jsonb_array_length(p_attachments) then
    raise exception 'Duplicate stock photos are not allowed.' using errcode='22023';
  end if;
end;
$$;
revoke all on function public.ag_validate_stock_photo_attachments(jsonb,uuid,uuid) from public,anon,authenticated;

create or replace function public.ag_submit_stabilization_stock_with_photos(
  p_submission_id uuid, p_record jsonb, p_photos jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public,auth,pg_temp
as $$
declare
  v_result jsonb;
  v_id uuid;
  v_org uuid;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_org := public.ag_require_organisation_capability('form_stock_record');
  perform public.ag_validate_stock_photo_attachments(p_photos, (select auth.uid()), p_submission_id);
  v_result := public.ag_submit_stabilization_packing_record_v3(p_submission_id,p_record);
  -- Repeated submissions must never overwrite photos on a committed stock record.
  if coalesce((v_result ->> 'duplicate')::boolean, false) then
    return v_result;
  end if;
  v_id := nullif(v_result ->> 'record_id','')::uuid;
  update public.ag_stabilization_packing_records
  set photo_attachments = p_photos,
      updated_at = now()
  where id=v_id and aggregator_id=v_org and recorded_by_user_id=(select auth.uid());
  if not found then raise exception 'Cannot attach photos to this stock record.' using errcode='42501'; end if;
  return v_result || jsonb_build_object('photo_count',jsonb_array_length(p_photos));
end;
$$;
revoke all on function public.ag_submit_stabilization_stock_with_photos(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ag_submit_stabilization_stock_with_photos(uuid,jsonb,jsonb) to authenticated;

create or replace function public.ag_get_stabilization_stock_photos(p_record_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public,auth,pg_temp
as $$
declare
  v_record public.ag_stabilization_packing_records%rowtype;
  v_org uuid;
begin
  v_org:=public.ag_require_organisation_capability('form_stock_record');
  select * into v_record from public.ag_stabilization_packing_records
  where id=p_record_id and aggregator_id=v_org
    and (recorded_by_user_id=(select auth.uid()) or public.ag_has_permission('can_view_data'));
  if not found then raise exception 'Stock record not found or not accessible.' using errcode='42501'; end if;
  return jsonb_build_object(
    'id',v_record.id,'carton_serial',v_record.carton_serial,'record_type',v_record.record_type,
    'packed_on',v_record.packed_on,'recorded_by_name',v_record.recorded_by_name,
    'can_add',v_record.recorded_by_user_id=(select auth.uid()) or public.ag_has_permission('can_edit_collections'),
    'photo_attachments',v_record.photo_attachments
  );
end;
$$;
revoke all on function public.ag_get_stabilization_stock_photos(uuid) from public,anon,authenticated;
grant execute on function public.ag_get_stabilization_stock_photos(uuid) to authenticated;

create or replace function public.ag_add_stabilization_stock_photos(
  p_record_id uuid, p_submission_id uuid, p_photos jsonb
) returns jsonb language plpgsql security definer set search_path = public,auth,pg_temp
as $$
declare
  v_record public.ag_stabilization_packing_records%rowtype;
  v_org uuid;
  v_merged jsonb;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_org:=public.ag_require_organisation_capability('form_stock_record');
  select * into v_record from public.ag_stabilization_packing_records
  where id=p_record_id and aggregator_id=v_org for update;
  if not found or not (
    v_record.recorded_by_user_id=(select auth.uid())
    or public.ag_has_permission('can_edit_collections')
  ) then raise exception 'Cannot add photos to this stock record.' using errcode='42501'; end if;
  perform public.ag_validate_stock_photo_attachments(p_photos,(select auth.uid()),p_submission_id);
  v_merged:=v_record.photo_attachments || p_photos;
  if jsonb_array_length(v_merged)>2 then
    raise exception 'Maximum two photos per stock record.' using errcode='22023';
  end if;
  if (select count(distinct item ->> 'storage_path') from jsonb_array_elements(v_merged) item)
    <> jsonb_array_length(v_merged) then
    raise exception 'Duplicate stock photos are not allowed.' using errcode='22023';
  end if;
  update public.ag_stabilization_packing_records
  set photo_attachments=v_merged,updated_at=now() where id=p_record_id;
  insert into public.ag_audit_log (actor_user_id,actor_email,action,target_type,target_id,details)
  values ((select auth.uid()),(select email from public.ag_user_profiles where id=(select auth.uid())),
    'stock_photos_added','stabilization_packing_record',p_record_id::text,
     jsonb_build_object('photo_count',jsonb_array_length(v_merged),'aggregator_id',v_org));
  return jsonb_build_object('record_id',p_record_id,'photo_count',jsonb_array_length(v_merged));
end;
$$;
revoke all on function public.ag_add_stabilization_stock_photos(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ag_add_stabilization_stock_photos(uuid,uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
