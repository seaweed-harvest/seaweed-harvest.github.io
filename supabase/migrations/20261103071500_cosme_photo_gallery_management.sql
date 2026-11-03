
-- COSME photo library: additive favourites, soft delete and camera/source metadata.
-- Existing reports and immutable storage objects are unchanged.
alter table cosme_metrics.library_items
  add column if not exists is_favourite boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists photo_metadata jsonb not null default '{}'::jsonb,
  add column if not exists photo_source text not null default 'unknown';

alter table cosme_metrics.library_items add constraint library_photo_metadata_json check (
  jsonb_typeof(photo_metadata)='object' and pg_column_size(photo_metadata)<=16384
);
alter table cosme_metrics.library_items add constraint library_photo_source_enum check (
  photo_source in ('web','chatgpt','drive','shortcut','unknown')
);
create index library_photo_favourite on cosme_metrics.library_items (is_favourite,captured_at desc)
where kind='photos' and status='ready' and deleted_at is null;

create or replace function public.cosme_library_object_allowed(p_name text,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists(
  select 1 from cosme_metrics.library_items i
  where i.object_path=p_name and i.deleted_at is null and (
   (not p_write and i.status='ready' and cosme_metrics.caller_role() in ('owner','editor','reader')) or
   (p_write and i.status='pending' and i.created_by=(select auth.uid())
     and i.created_at>now()-interval '1 hour' and cosme_metrics.caller_role() in ('owner','editor'))
  )
 );
$$;

create or replace function public.cosme_library_list(p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role();
begin
 if (select auth.uid()) is null or v_role not in ('owner','editor','reader')
 then raise exception 'Project Metrics access required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('reports','photos') then raise exception 'Invalid library'; end if;
 return jsonb_build_object(
  'can_edit',v_role in ('owner','editor'),
  'folders',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.name),'[]'::jsonb)
    from cosme_metrics.library_folders f where f.kind=p_kind),
  'items',(select coalesce(jsonb_agg(to_jsonb(i)-'created_by' order by i.created_at desc),'[]'::jsonb)
    from cosme_metrics.library_items i where i.kind=p_kind and i.status='ready' and i.deleted_at is null),
  'trashed_items',(select coalesce(jsonb_agg(to_jsonb(i)-'created_by' order by i.deleted_at desc),'[]'::jsonb)
    from cosme_metrics.library_items i where i.kind=p_kind and i.status='ready'
    and i.deleted_at is not null and v_role in ('owner','editor'))
 );
end;
$$;

create function public.cosme_library_photo_action(p_ids uuid[], p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role(); v_count integer;
begin
 if (select auth.uid()) is null or v_role not in ('owner','editor')
 then raise exception 'Project Metrics editor access required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('favourite','unfavourite','trash','restore')
  or p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>100
  or array_position(p_ids,null) is not null
 then raise exception 'Invalid photo action'; end if;
 update cosme_metrics.library_items i set
  is_favourite=case when p_action='favourite' then true when p_action='unfavourite' then false else i.is_favourite end,
  deleted_at=case when p_action='trash' then now() when p_action='restore' then null else i.deleted_at end,
  revision=revision+1,updated_at=now()
 where i.id=any(p_ids) and i.kind='photos' and i.status='ready' and (
  (p_action='restore' and i.deleted_at is not null) or
  (p_action in ('trash','favourite','unfavourite') and i.deleted_at is null));
 get diagnostics v_count=row_count;
 return jsonb_build_object('action',p_action,'updated',v_count);
end;
$$;

-- Patch only supplied fields, so AI can update descriptions without overwriting EXIF/capture details.
create function public.cosme_library_photo_patch(p_id uuid,p_expected_revision integer,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role(); v_item cosme_metrics.library_items; v_key text;
begin
 if (select auth.uid()) is null or v_role not in ('owner','editor')
 then raise exception 'Project Metrics editor access required' using errcode='42501'; end if;
 if p_id is null or p_expected_revision is null or jsonb_typeof(p_changes)<>'object'
   or p_changes='{}'::jsonb
 then raise exception 'Invalid photo edit'; end if;
 for v_key in select jsonb_object_keys(p_changes) loop
  if v_key not in ('title','project','prototype','captured_at','location','activity','asset','caption')
  then raise exception 'Photo field not editable: %',v_key; end if;
 end loop;
 update cosme_metrics.library_items i set
  title=case when p_changes ? 'title' then btrim(p_changes->>'title') else i.title end,
  project=case when p_changes ? 'project' then btrim(p_changes->>'project') else i.project end,
  prototype=case when p_changes ? 'prototype' then coalesce(btrim(p_changes->>'prototype'),'') else i.prototype end,
  captured_at=case when p_changes ? 'captured_at' then nullif(p_changes->>'captured_at','')::timestamptz else i.captured_at end,
  location=case when p_changes ? 'location' then coalesce(btrim(p_changes->>'location'),'') else i.location end,
  activity=case when p_changes ? 'activity' then coalesce(btrim(p_changes->>'activity'),'') else i.activity end,
  asset=case when p_changes ? 'asset' then coalesce(btrim(p_changes->>'asset'),'') else i.asset end,
  caption=case when p_changes ? 'caption' then coalesce(btrim(p_changes->>'caption'),'') else i.caption end,
  revision=revision+1,updated_at=now()
 where i.id=p_id and i.kind='photos' and i.status='ready' and i.deleted_at is null
   and i.revision=p_expected_revision
 returning * into v_item;
 if not found then raise exception 'This photo changed. Refresh before editing.' using errcode='40001'; end if;
 return to_jsonb(v_item)-'created_by';
end;
$$;

create function public.cosme_library_photo_capture(
 p_id uuid,p_expected_revision integer,p_metadata jsonb,p_source text default 'web'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text:=cosme_metrics.caller_role();v_item cosme_metrics.library_items;
begin
 if (select auth.uid()) is null or v_role not in ('owner','editor')
 then raise exception 'Project Metrics editor access required' using errcode='42501'; end if;
 if p_id is null or p_expected_revision is null
  or jsonb_typeof(p_metadata)<>'object' or pg_column_size(p_metadata)>16384
  or p_source not in ('web','chatgpt','drive','shortcut','unknown')
 then raise exception 'Invalid photo capture metadata'; end if;
 update cosme_metrics.library_items i
 set photo_metadata=p_metadata,photo_source=p_source,revision=revision+1,updated_at=now()
 where i.id=p_id and i.kind='photos' and i.status='ready'
   and i.deleted_at is null and i.revision=p_expected_revision
 returning * into v_item;
 if not found then raise exception 'This photo changed. Refresh before editing.' using errcode='40001'; end if;
 return to_jsonb(v_item)-'created_by';
end;
$$;
revoke all on function public.cosme_library_photo_action(uuid[],text),
 public.cosme_library_photo_patch(uuid,integer,jsonb),
 public.cosme_library_photo_capture(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.cosme_library_photo_action(uuid[],text),
 public.cosme_library_photo_patch(uuid,integer,jsonb),
 public.cosme_library_photo_capture(uuid,integer,jsonb,text) to authenticated;
notify pgrst, 'reload schema';
