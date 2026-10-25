-- Optional, delayed photos for existing coastal-water sample records.
alter table public.ag_site_water_sample_records
  add column if not exists photo_attachments jsonb not null default '[]'::jsonb;
alter table public.ag_site_water_sample_records
  add constraint ag_site_water_photo_limit
  check (jsonb_typeof(photo_attachments) = 'array' and jsonb_array_length(photo_attachments) <= 4);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('site-water-sample-photos','site-water-sample-photos',false,716800,array['image/jpeg']::text[])
on conflict (id) do update set public=false,file_size_limit=716800,allowed_mime_types=array['image/jpeg']::text[];

create or replace function public.ag_can_read_site_sample_photo(p_storage_path text)
returns boolean language sql stable security definer
set search_path=public,auth,pg_temp
as $site_photo_read$
 select (select auth.uid()) is not null and exists (
  select 1 from public.ag_site_water_sample_records s
  where s.aggregator_id=public.ag_current_aggregator_id()
    and s.photo_attachments @> jsonb_build_array(jsonb_build_object('storage_path',p_storage_path))
    and (s.recorded_by_user_id=(select auth.uid())
      or public.ag_has_permission('can_view_data'))
 );
$site_photo_read$;
revoke all on function public.ag_can_read_site_sample_photo(text) from public,anon,authenticated;
grant execute on function public.ag_can_read_site_sample_photo(text) to authenticated;

create policy "site sample photo insert" on storage.objects for insert to authenticated
with check (
 bucket_id='site-water-sample-photos'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and lower(storage.extension(name))='jpg'
 and public.ag_has_permission('can_submit_collection')
);
create policy "site sample photo select" on storage.objects for select to authenticated
using (
 bucket_id='site-water-sample-photos'
 and ((storage.foldername(name))[1]=(select auth.uid())::text
   or public.ag_can_read_site_sample_photo(name))
);
create policy "site sample photo upload cleanup" on storage.objects for delete to authenticated
using (bucket_id='site-water-sample-photos'
 and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.ag_validate_site_sample_photos(
 p_attachments jsonb, p_user_id uuid, p_upload_id uuid
) returns void language plpgsql security definer set search_path=public,auth,pg_temp
as $sample_photo_validate$
declare
 v_item jsonb;
 v_path text;
 v_size bigint;
begin
 if p_user_id is null or p_user_id is distinct from (select auth.uid())
    or p_upload_id is null
    or p_attachments is null
    or jsonb_typeof(p_attachments)<>'array'
    or jsonb_array_length(p_attachments) > 4 then
  raise exception 'Invalid photo upload request.' using errcode='22023';
 end if;
 for v_item in select value from jsonb_array_elements(p_attachments) loop
   if jsonb_typeof(v_item)<>'object' then
     raise exception 'Invalid photo metadata.' using errcode='22023';
   end if;
   v_path := v_item ->> 'storage_path';
   if v_path is null
      or v_path !~ ('^'||p_user_id::text||'/'||p_upload_id::text||'/[A-Za-z0-9-]+[.]jpg$')
      or v_item->>'content_type'<>'image/jpeg'
      or length(coalesce(v_item->>'original_name','')) not between 1 and 255
      or coalesce((v_item->>'byte_size')::bigint,0) not between 1 and 716800 then
     raise exception 'Invalid photo metadata.' using errcode='22023';
   end if;
   select (metadata->>'size')::bigint into v_size
   from storage.objects where bucket_id='site-water-sample-photos' and name=v_path;
   if not found or v_size is distinct from (v_item->>'byte_size')::bigint then
     raise exception 'Please upload the image before attaching it.' using errcode='22023';
   end if;
 end loop;
 if (select count(distinct item->>'storage_path') from jsonb_array_elements(p_attachments) item)
    <>jsonb_array_length(p_attachments) then
   raise exception 'Duplicate images are not allowed.' using errcode='22023';
 end if;
end;
$sample_photo_validate$;
revoke all on function public.ag_validate_site_sample_photos(jsonb,uuid,uuid)
 from public,anon,authenticated;

create or replace function public.ag_get_site_water_sample_photos(p_record_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,auth,pg_temp
as $sample_photo_get$
declare
 v_sample public.ag_site_water_sample_records%rowtype;
 v_org uuid;
 v_actor uuid := (select auth.uid());
begin
 if v_actor is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 v_org:=public.ag_require_organisation_capability('form_site_water_samples');
 select * into v_sample from public.ag_site_water_sample_records
 where id=p_record_id and aggregator_id=v_org
   and (recorded_by_user_id=v_actor or public.ag_has_permission('can_view_data'));
 if not found then raise exception 'Sample not found or not accessible.' using errcode='42501'; end if;
 return jsonb_build_object(
  'id',v_sample.id,'sample_number',v_sample.sample_number,
  'sampled_at',v_sample.sampled_at,'community_name',v_sample.community_name_snapshot,
  'e_coli_sample_taken',v_sample.e_coli_sample_taken,
  'photo_attachments',v_sample.photo_attachments,
  'can_add', public.ag_has_permission('can_submit_collection')
   and (v_sample.recorded_by_user_id=v_actor or public.ag_has_permission('can_edit_collections'))
 );
end;
$sample_photo_get$;
revoke all on function public.ag_get_site_water_sample_photos(uuid) from public,anon,authenticated;
grant execute on function public.ag_get_site_water_sample_photos(uuid) to authenticated;

create or replace function public.ag_add_site_water_sample_photos(
 p_record_id uuid,p_upload_id uuid,p_photos jsonb
) returns jsonb language plpgsql security definer
set search_path=public,auth,pg_temp
as $sample_photo_add$
declare
 v_sample public.ag_site_water_sample_records%rowtype;
 v_org uuid;
 v_actor uuid := (select auth.uid());
 v_photos jsonb;
begin
 perform public.ag_require_permission('can_submit_collection');
 v_org:=public.ag_require_organisation_capability('form_site_water_samples');
 select * into v_sample from public.ag_site_water_sample_records
  where id=p_record_id and aggregator_id=v_org for update;
 if not found or not (
  v_sample.recorded_by_user_id=v_actor or public.ag_has_permission('can_edit_collections')
 ) then raise exception 'Not permitted to attach photos to this sample.' using errcode='42501'; end if;
 perform public.ag_validate_site_sample_photos(p_photos,v_actor,p_upload_id);
 v_photos:=v_sample.photo_attachments || p_photos;
 if jsonb_array_length(v_photos)>4 then
  raise exception 'Maximum four photos per coastal sample.' using errcode='22023';
 end if;
 if (select count(distinct item->>'storage_path') from jsonb_array_elements(v_photos) item)
    <>jsonb_array_length(v_photos) then
   raise exception 'Duplicate images are not allowed.' using errcode='22023';
 end if;
 update public.ag_site_water_sample_records
   set photo_attachments=v_photos,updated_at=now() where id=p_record_id and aggregator_id=v_org;
 insert into public.ag_audit_log(actor_user_id,actor_email,action,target_type,target_id,details)
 select v_actor,up.email,'site_sample_photos_added','site_water_sample',p_record_id::text,
  jsonb_build_object('aggregator_id',v_org,'photo_count',jsonb_array_length(v_photos),
   'new_photos',jsonb_array_length(p_photos))
 from public.ag_user_profiles up where up.id=v_actor;
 return jsonb_build_object('record_id',p_record_id,'photo_count',jsonb_array_length(v_photos));
end;
$sample_photo_add$;
revoke all on function public.ag_add_site_water_sample_photos(uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.ag_add_site_water_sample_photos(uuid,uuid,jsonb)
 to authenticated;
notify pgrst,'reload schema';