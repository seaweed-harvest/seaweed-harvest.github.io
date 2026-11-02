-- Additive project reference library. No operational, finance or grant records change.
create table cosme_metrics.library_folders (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reports','photos')),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(kind,name)
);
create table cosme_metrics.library_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reports','photos')),
  folder_id uuid references cosme_metrics.library_folders(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 180),
  project text not null check (length(project) between 1 and 120),
  prototype text not null default '' check (length(prototype)<=100),
  captured_at timestamptz,
  location text not null default '' check (length(location)<=180),
  activity text not null default '' check (length(activity)<=180),
  asset text not null default '' check (length(asset)<=180),
  caption text not null default '' check (length(caption)<=1000),
  report_type text not null default 'Report' check(length(btrim(report_type)) between 1 and 100),
  submitted_on date,
  check(kind='photos' or submitted_on is not null),
  file_version integer not null default 1 check(file_version>0),
  replaces_id uuid references cosme_metrics.library_items(id) on delete restrict,
  replaces_revision integer,
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 20971520),
  object_path text not null unique,
  status text not null default 'pending' check (status in ('pending','ready','superseded')),
  revision integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind='reports' and mime_type='application/pdf') or
         (kind='photos' and mime_type in ('image/jpeg','image/png','image/webp')))
);
alter table cosme_metrics.library_folders enable row level security;
alter table cosme_metrics.library_items enable row level security;
revoke all on cosme_metrics.library_folders,cosme_metrics.library_items from public,anon,authenticated;
create index library_items_catalog on cosme_metrics.library_items(kind,status,created_at desc);
create index library_folders_creator on cosme_metrics.library_folders(created_by);
create index library_items_folder on cosme_metrics.library_items(folder_id);
create index library_items_creator on cosme_metrics.library_items(created_by);
create index library_items_replaced on cosme_metrics.library_items(replaces_id);
create unique index library_current_report on cosme_metrics.library_items(project,report_type)
  where kind='reports' and status='ready';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cosme-project-library','cosme-project-library',false,20971520,
  array['application/pdf','image/jpeg','image/png','image/webp']);

-- A narrow storage-policy predicate is necessary because the private schema is not exposed.
-- It never grants existing-bucket access and requires an active Metrics grant each time.
create function public.cosme_library_object_allowed(p_name text,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from cosme_metrics.library_items i
    where i.object_path=p_name and (
      (not p_write and i.status='ready' and cosme_metrics.caller_role() in ('owner','editor','reader')) or
      (p_write and i.status='pending' and i.created_by=(select auth.uid())
        and i.created_at>now()-interval '1 hour' and cosme_metrics.caller_role() in ('owner','editor'))
    )
  );
$$;
revoke all on function public.cosme_library_object_allowed(text,boolean) from public,anon;
grant execute on function public.cosme_library_object_allowed(text,boolean) to authenticated;
create policy cosme_library_read on storage.objects for select to authenticated
  using (bucket_id='cosme-project-library' and public.cosme_library_object_allowed(name,false));
create policy cosme_library_insert on storage.objects for insert to authenticated
  with check (bucket_id='cosme-project-library' and public.cosme_library_object_allowed(name,true));
-- No UPDATE/DELETE: binaries are immutable. New report revisions are new files.

create function public.cosme_library_list(p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role();
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('owner','editor','reader') then
    raise exception 'Project Metrics access required' using errcode='42501';
  end if;
  if p_kind not in ('reports','photos') or p_kind is null then raise exception 'Invalid library'; end if;
  return jsonb_build_object('can_edit',v_role in ('owner','editor'),
    'folders',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.name),'[]'::jsonb)
      from cosme_metrics.library_folders f where f.kind=p_kind),
    'items',(select coalesce(jsonb_agg(to_jsonb(i)-'created_by' order by i.created_at desc),'[]'::jsonb)
      from cosme_metrics.library_items i where i.kind=p_kind and i.status='ready'));
end;
$$;
create function public.cosme_library_add_folder(p_kind text,p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role(); v_id uuid;
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('owner','editor') then
    raise exception 'Project Metrics editor access required' using errcode='42501';
  end if;
  insert into cosme_metrics.library_folders(kind,name,created_by)
  values(p_kind,btrim(p_name),(select auth.uid())) returning id into v_id;
  return v_id;
end;
$$;

-- The same validation applies to new uploads and metadata edits.
create function public.cosme_library_save(p_kind text,p_metadata jsonb,p_id uuid default null,p_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text:=cosme_metrics.caller_role(); v_item cosme_metrics.library_items;
  v_folder uuid:=nullif(p_metadata->>'folder_id','')::uuid;
  v_type text:=p_metadata->>'mime_type'; v_ext text; v_previous cosme_metrics.library_items;
  v_report_type text:=coalesce(nullif(btrim(p_metadata->>'report_type'),''),'Report');
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('owner','editor') then
    raise exception 'Project Metrics editor access required' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('reports','photos') then raise exception 'Invalid library'; end if;
  if v_folder is not null and not exists(select 1 from cosme_metrics.library_folders where id=v_folder and kind=p_kind) then
    raise exception 'Folder does not belong to this library';
  end if;
  if p_id is null then
    if p_kind='reports' then
      if nullif(p_metadata->>'replaces_id','') is not null then
        select * into v_previous from cosme_metrics.library_items
          where id=(p_metadata->>'replaces_id')::uuid and kind='reports' and status='ready';
        if not found or v_previous.revision is distinct from (p_metadata->>'replaces_revision')::integer then
          raise exception 'The current report changed. Refresh before replacing its PDF.' using errcode='40001';
        end if;
      else
        select * into v_previous from cosme_metrics.library_items
          where kind='reports' and status='ready' and project=btrim(p_metadata->>'project') and report_type=v_report_type;
      end if;
    end if;
    v_ext:=case v_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
      when 'image/png' then 'png' when 'image/webp' then 'webp' end;
    if v_ext is null then raise exception 'Unsupported file type'; end if;
    insert into cosme_metrics.library_items(kind,folder_id,title,project,prototype,captured_at,location,activity,asset,caption,
      filename,mime_type,byte_size,object_path,created_by,report_type,submitted_on,file_version,replaces_id,replaces_revision)
    values(p_kind,v_folder,btrim(p_metadata->>'title'),btrim(p_metadata->>'project'),
      coalesce(btrim(p_metadata->>'prototype'),''),nullif(p_metadata->>'captured_at','')::timestamptz,
      coalesce(btrim(p_metadata->>'location'),''),coalesce(btrim(p_metadata->>'activity'),''),
      coalesce(btrim(p_metadata->>'asset'),''),coalesce(btrim(p_metadata->>'caption'),''),
      p_metadata->>'filename',v_type,(p_metadata->>'byte_size')::bigint,
      p_kind||'/'||gen_random_uuid()::text||'.'||v_ext,(select auth.uid()),v_report_type,
      nullif(p_metadata->>'submitted_on','')::date,coalesce(v_previous.file_version+1,1),v_previous.id,v_previous.revision) returning * into v_item;
  else
    update cosme_metrics.library_items set folder_id=v_folder,title=btrim(p_metadata->>'title'),
      project=btrim(p_metadata->>'project'),prototype=coalesce(btrim(p_metadata->>'prototype'),''),
      captured_at=nullif(p_metadata->>'captured_at','')::timestamptz,
      location=coalesce(btrim(p_metadata->>'location'),''),activity=coalesce(btrim(p_metadata->>'activity'),''),
      asset=coalesce(btrim(p_metadata->>'asset'),''),caption=coalesce(btrim(p_metadata->>'caption'),''),
      report_type=v_report_type,submitted_on=nullif(p_metadata->>'submitted_on','')::date,
      revision=revision+1,updated_at=now()
    where id=p_id and kind=p_kind and status='ready' and revision=p_revision returning * into v_item;
    if not found then raise exception 'This reference changed. Refresh before editing.' using errcode='40001'; end if;
  end if;
  return to_jsonb(v_item)-'created_by';
end;
$$;
create function public.cosme_library_finish(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role(); v_item cosme_metrics.library_items;
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('owner','editor') then
    raise exception 'Project Metrics editor access required' using errcode='42501';
  end if;
  select * into v_item from cosme_metrics.library_items where id=p_id and created_by=(select auth.uid()) for update;
  if not found then raise exception 'Upload reservation not found'; end if;
  if v_item.status='ready' then return; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='cosme-project-library'
      and o.name=v_item.object_path and (o.metadata->>'size')::bigint=v_item.byte_size
      and o.metadata->>'mimetype'=v_item.mime_type) then
    raise exception 'Upload is missing or its file details do not match';
  end if;
  if v_item.replaces_id is not null then
    update cosme_metrics.library_items set status='superseded',updated_at=now()
      where id=v_item.replaces_id and kind='reports' and status='ready' and revision=v_item.replaces_revision;
    if not found then raise exception 'The current report changed. Refresh before replacing its PDF.' using errcode='40001'; end if;
  end if;
  update cosme_metrics.library_items set status='ready',updated_at=now() where id=p_id;
end;
$$;
revoke all on function public.cosme_library_list(text),public.cosme_library_add_folder(text,text),
  public.cosme_library_save(text,jsonb,uuid,integer),public.cosme_library_finish(uuid) from public,anon;
grant execute on function public.cosme_library_list(text),public.cosme_library_add_folder(text,text),
  public.cosme_library_save(text,jsonb,uuid,integer),public.cosme_library_finish(uuid) to authenticated;
notify pgrst,'reload schema';
