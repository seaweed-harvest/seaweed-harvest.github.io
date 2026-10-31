-- Approved in the owner chat on 31 October 2026. Values/history remain immutable.
-- Private tables have RLS and no direct API privileges. Only the scoped RPCs below
-- access them, using the existing COSME grant/profile checks on every request.
create table cosme_metrics.release_picks (
  release_id uuid not null,
  metric_id uuid not null,
  featured boolean not null,
  revision integer not null check (revision >= 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (release_id,metric_id),
  foreign key (release_id,metric_id)
    references cosme_metrics.release_items(release_id,metric_id)
);
create table cosme_metrics.pick_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null,
  metric_id uuid not null,
  featured boolean not null,
  revision integer not null check (revision > 0),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  unique (release_id,metric_id,revision),
  foreign key (release_id,metric_id)
    references cosme_metrics.release_items(release_id,metric_id)
);
alter table cosme_metrics.release_picks enable row level security;
alter table cosme_metrics.pick_events enable row level security;
revoke all on cosme_metrics.release_picks,cosme_metrics.pick_events
  from public,anon,authenticated;
create trigger cosme_metrics_pick_events_immutable
before update or delete on cosme_metrics.pick_events
for each row execute function cosme_metrics.reject_history_mutation();

create function public.cosme_metrics_get_picks(p_major integer,p_minor integer)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_role text := cosme_metrics.caller_role();
  v_release uuid;
  v_current uuid;
  v_picks jsonb;
begin
  if (select auth.uid()) is null or v_role is null then
    raise exception 'Metrics access denied' using errcode='42501';
  end if;
  if p_major is null or p_minor is null or p_major<0 or p_minor<0 then
    raise exception 'Invalid release version' using errcode='22023';
  end if;
  select r.id,p.current_release_id into v_release,v_current
  from cosme_metrics.releases r
  join cosme_metrics.projects p on p.project_key=r.project_key
  where r.project_key='COSME' and p.enabled
    and r.major=p_major and r.minor=p_minor;
  if not found then
    raise exception 'Unknown metrics release' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'metric_id',m.human_id,
    'featured',coalesce(s.featured,(i.frozen_payload->>'featured')::boolean,false),
    'revision',coalesce(s.revision,0)
  ) order by i.display_order,m.human_id),'[]'::jsonb) into v_picks
  from cosme_metrics.release_items i
  join cosme_metrics.metrics m on m.id=i.metric_id and m.project_key=i.project_key
  left join cosme_metrics.release_picks s on s.release_id=i.release_id and s.metric_id=i.metric_id
  where i.release_id=v_release and i.project_key='COSME';
  return jsonb_build_object('can_edit',v_role in ('owner','editor') and v_release=v_current,
    'picks',v_picks);
end
$function$;

create function public.cosme_metrics_set_pick(
  p_major integer,p_minor integer,p_metric_id text,
  p_featured boolean,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_role text := cosme_metrics.caller_role();
  v_current uuid;
  v_release uuid;
  v_metric uuid;
  v_default boolean;
  v_revision integer;
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('owner','editor') then
    raise exception 'Metrics owner or editor access required' using errcode='42501';
  end if;
  if p_major is null or p_minor is null or p_major<0 or p_minor<0
     or p_metric_id is null or length(p_metric_id) not between 1 and 80
     or p_featured is null or p_expected_revision is null or p_expected_revision<0
     or p_expected_revision=2147483647 then
    raise exception 'Invalid shared Top Pick request' using errcode='22023';
  end if;
  -- Prevent a release-pointer change from racing a save to the old release.
  select p.current_release_id into v_current from cosme_metrics.projects p
  where p.project_key='COSME' and p.enabled for share;
  select r.id into v_release from cosme_metrics.releases r
  where r.project_key='COSME' and r.major=p_major and r.minor=p_minor;
  if v_release is null or v_release is distinct from v_current then
    raise exception 'Only the current release selection can be edited' using errcode='22023';
  end if;
  select m.id,coalesce((i.frozen_payload->>'featured')::boolean,false)
    into v_metric,v_default
  from cosme_metrics.release_items i
  join cosme_metrics.metrics m on m.id=i.metric_id and m.project_key=i.project_key
  where i.release_id=v_release and i.project_key='COSME' and m.human_id=p_metric_id;
  if not found then
    raise exception 'Metric is not in the selected release' using errcode='22023';
  end if;
  -- The unique key serialises first inserts; the revision predicate rejects stale
  -- editors, including a second editor that read the same published default.
  insert into cosme_metrics.release_picks(release_id,metric_id,featured,revision,updated_by)
  values(v_release,v_metric,v_default,0,(select auth.uid()))
  on conflict(release_id,metric_id) do nothing;
  update cosme_metrics.release_picks s
  set featured=p_featured,revision=s.revision+1,
      updated_by=(select auth.uid()),updated_at=clock_timestamp()
  where s.release_id=v_release and s.metric_id=v_metric and s.revision=p_expected_revision
  returning s.revision into v_revision;
  if not found then
    raise exception 'Top Pick changed by another editor; reload the selection'
      using errcode='40001';
  end if;
  insert into cosme_metrics.pick_events(release_id,metric_id,featured,revision,changed_by)
  values(v_release,v_metric,p_featured,v_revision,(select auth.uid()));
  return jsonb_build_object('metric_id',p_metric_id,'featured',p_featured,'revision',v_revision);
end
$function$;

revoke all on function public.cosme_metrics_get_picks(integer,integer) from public,anon;
revoke all on function public.cosme_metrics_set_pick(integer,integer,text,boolean,integer) from public,anon;
grant execute on function public.cosme_metrics_get_picks(integer,integer) to authenticated;
grant execute on function public.cosme_metrics_set_pick(integer,integer,text,boolean,integer) to authenticated;
comment on table cosme_metrics.release_picks is
  'Mutable shared presentation selections, separate from immutable published metric values.';
comment on table cosme_metrics.pick_events is
  'Append-only audit of authorised shared Top Pick changes.';
notify pgrst,'reload schema';
