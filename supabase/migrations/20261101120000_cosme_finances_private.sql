-- Staged only: apply after owner review, permission tests and a verified backup.
-- Existing COSME grants are the sole read authority. No operational finance/stock tables change.
create table cosme_metrics.finance_sources (
  id uuid primary key default gen_random_uuid(),
  project_key text not null default 'COSME' check (project_key='COSME'),
  source_key text not null,
  revision text not null default '1',
  display_name text not null,
  source_kind text not null check (source_kind in ('bom','quote','invoice','receipt','expense_register','asset_register','closeout','other')),
  source_date date,
  source_url text,
  source_sha256 text,
  note text,
  created_at timestamptz not null default now(),
  unique (project_key,source_key,revision)
);
create table cosme_metrics.finance_packages (
  id uuid primary key default gen_random_uuid(),
  project_key text not null default 'COSME' check (project_key='COSME'),
  source_id uuid not null references cosme_metrics.finance_sources(id),
  package_key text not null,
  activity text not null,
  version text,
  basis text not null check (basis in ('estimated','quoted','invoiced','paid')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  units_covered numeric(14,3) not null default 1 check (units_covered>0),
  unit_label text,
  funding_scope text,
  control_total numeric(18,2),
  reconciliation_status text not null default 'review' check (reconciliation_status in ('verified','review','disputed')),
  publication_status text not null default 'draft' check (publication_status in ('draft','published','superseded')),
  scope_key text not null,
  display_order integer not null default 100,
  note text,
  created_at timestamptz not null default now(),
  unique (source_id,package_key)
);
-- A scope may have only one *currently published* source. Revisions must first
-- mark the previous package superseded; the historical numbers stay immutable.
create unique index cosme_finance_published_scope
  on cosme_metrics.finance_packages(project_key,scope_key)
  where publication_status='published';
create table cosme_metrics.finance_lines (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references cosme_metrics.finance_packages(id),
  source_row text not null,
  entry_date date,
  category text not null,
  subcategory text not null default 'Other',
  description text not null,
  quantity numeric(18,4),
  unit text,
  unit_rate numeric(18,4),
  rate_currency text check (rate_currency is null or rate_currency ~ '^[A-Z]{3}
  funding_org text,
  included_in_total boolean not null default true,
  reconciliation_status text not null default 'review'
    check (reconciliation_status in ('verified','review','excluded')),
  duplicate_reference text,
  note text,
  created_at timestamptz not null default now(),
  unique (package_id,source_row),
  check (amount is not null or reconciliation_status <> 'verified')
);
-- Allocation evidence is shown separately; it must never be blindly added to
-- already-counted line amounts (e.g. RO 50/50 cost sharing).
create table cosme_metrics.finance_allocations (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references cosme_metrics.finance_lines(id),
  source_row text not null,
  organisation text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  allocated_amount numeric(18,2) not null,
  status text not null check (status in ('estimated','committed','invoiced','paid')),
  note text,
  unique (line_id,source_row,organisation,status)
);
create index cosme_finance_package_source_idx on cosme_metrics.finance_packages(source_id);
create index cosme_finance_line_package_idx on cosme_metrics.finance_lines(package_id);
create index cosme_finance_alloc_line_idx on cosme_metrics.finance_allocations(line_id);

-- Immutable source snapshots after publishing. New revisions use new source,
-- package and item identifiers; old published records are never overwritten.
create function cosme_metrics.finance_reject_published_mutation()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if TG_TABLE_NAME='finance_packages' then
    if OLD.publication_status='published'
       and TG_OP='UPDATE' and NEW.publication_status='superseded'
       and to_jsonb(NEW)-'publication_status'=to_jsonb(OLD)-'publication_status' then
      return NEW;
    end if;
    if OLD.publication_status in ('published','superseded') then
      raise exception 'Published COSME finance packages are immutable' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='finance_lines' then
    if exists(select 1 from cosme_metrics.finance_packages
      where id=OLD.package_id and publication_status in ('published','superseded')) then
      raise exception 'Published COSME finance lines are immutable' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='finance_allocations' then
    if exists(select 1 from cosme_metrics.finance_lines l
      join cosme_metrics.finance_packages p on p.id=l.package_id
      where l.id=OLD.line_id and p.publication_status in ('published','superseded')) then
      raise exception 'Published COSME finance allocations are immutable' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='finance_sources' then
    if exists(select 1 from cosme_metrics.finance_packages
      where source_id=OLD.id and publication_status in ('published','superseded')) then
      raise exception 'Published COSME finance sources are immutable' using errcode='42501';
    end if;
  end if;
  if TG_OP='UPDATE' then return NEW; end if;
  return OLD;
end
$function$;
create trigger cosme_finance_packages_immutable before update or delete on cosme_metrics.finance_packages
 for each row execute function cosme_metrics.finance_reject_published_mutation();
create trigger cosme_finance_lines_immutable before update or delete on cosme_metrics.finance_lines
 for each row execute function cosme_metrics.finance_reject_published_mutation();
create trigger cosme_finance_alloc_immutable before update or delete on cosme_metrics.finance_allocations
 for each row execute function cosme_metrics.finance_reject_published_mutation();
create trigger cosme_finance_sources_immutable before update or delete on cosme_metrics.finance_sources
 for each row execute function cosme_metrics.finance_reject_published_mutation();

alter table cosme_metrics.finance_sources enable row level security;
alter table cosme_metrics.finance_packages enable row level security;
alter table cosme_metrics.finance_lines enable row level security;
alter table cosme_metrics.finance_allocations enable row level security;
revoke all on cosme_metrics.finance_sources,cosme_metrics.finance_packages,
  cosme_metrics.finance_lines,cosme_metrics.finance_allocations
  from public,anon,authenticated;
revoke all on function cosme_metrics.finance_reject_published_mutation()
  from public,anon,authenticated;

create function public.cosme_finance_read()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_role text := cosme_metrics.caller_role();
begin
  if (select auth.uid()) is null or v_role not in ('owner','editor','reader') then
    raise exception 'COSME Metrics access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'sources',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'display_name',s.display_name,'source_kind',s.source_kind,
        'source_date',s.source_date,'revision',s.revision,
        'source_url',s.source_url) order by s.display_name),'[]'::jsonb)
      from cosme_metrics.finance_sources s
      where s.project_key='COSME' and exists(
        select 1 from cosme_metrics.finance_packages p
        where p.source_id=s.id and p.publication_status='published'
          and p.project_key='COSME'
      )
    ),
    'packages',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,'source_id',p.source_id,'activity',p.activity,
        'version',p.version,'basis',p.basis,'currency',p.currency,
        'units_covered',p.units_covered,'unit_label',p.unit_label,
        'funding_scope',p.funding_scope,'control_total',p.control_total,
        'reconciliation_status',p.reconciliation_status
      ) order by p.display_order,p.activity,p.version),'[]'::jsonb)
      from cosme_metrics.finance_packages p
      where p.project_key='COSME' and p.publication_status='published'
    ),
    'lines',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',l.id,'package_id',l.package_id,'source_row',l.source_row,
        'entry_date',l.entry_date,'category',l.category,'subcategory',l.subcategory,
        'description',l.description,'quantity',l.quantity,'unit',l.unit,
        'unit_rate',l.unit_rate,'rate_currency',l.rate_currency,'amount',l.amount,'funding_org',l.funding_org,
        'included_in_total',l.included_in_total,
        'reconciliation_status',l.reconciliation_status,'note',l.note
      ) order by l.source_row),'[]'::jsonb)
      from cosme_metrics.finance_lines l
      join cosme_metrics.finance_packages p on p.id=l.package_id
      where p.project_key='COSME' and p.publication_status='published'
    )
  );
end
$function$;
revoke all on function public.cosme_finance_read() from public,anon;
grant execute on function public.cosme_finance_read() to authenticated;
comment on function public.cosme_finance_read() is
  'Read-only, COSME Metrics-grant-gated finance source package and evidence feed. No transactions are modified.';
notify pgrst,'reload schema';
),
  amount numeric(18,2),
  funding_org text,
  included_in_total boolean not null default true,
  reconciliation_status text not null default 'review'
    check (reconciliation_status in ('verified','review','excluded')),
  duplicate_reference text,
  note text,
  created_at timestamptz not null default now(),
  unique (package_id,source_row),
  check (amount is not null or reconciliation_status <> 'verified')
);
-- Allocation evidence is shown separately; it must never be blindly added to
-- already-counted line amounts (e.g. RO 50/50 cost sharing).
create table cosme_metrics.finance_allocations (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references cosme_metrics.finance_lines(id),
  source_row text not null,
  organisation text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  allocated_amount numeric(18,2) not null,
  status text not null check (status in ('estimated','committed','invoiced','paid')),
  note text,
  unique (line_id,source_row,organisation,status)
);
create index cosme_finance_package_source_idx on cosme_metrics.finance_packages(source_id);
create index cosme_finance_line_package_idx on cosme_metrics.finance_lines(package_id);
create index cosme_finance_alloc_line_idx on cosme_metrics.finance_allocations(line_id);

-- Immutable source snapshots after publishing. New revisions use new source,
-- package and item identifiers; old published records are never overwritten.
create function cosme_metrics.finance_reject_published_mutation()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if TG_TABLE_NAME='finance_packages' then
    if OLD.publication_status='published'
       and TG_OP='UPDATE' and NEW.publication_status='superseded'
       and to_jsonb(NEW)-'publication_status'=to_jsonb(OLD)-'publication_status' then
      return NEW;
    end if;
    if OLD.publication_status in ('published','superseded') then
      raise exception 'Published COSME finance packages are immutable' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='finance_lines' then
    if exists(select 1 from cosme_metrics.finance_packages
      where id=OLD.package_id and publication_status in ('published','superseded')) then
      raise exception 'Published COSME finance lines are immutable' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='finance_allocations' then
    if exists(select 1 from cosme_metrics.finance_lines l
      join cosme_metrics.finance_packages p on p.id=l.package_id
      where l.id=OLD.line_id and p.publication_status in ('published','superseded')) then
      raise exception 'Published COSME finance allocations are immutable' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='finance_sources' then
    if exists(select 1 from cosme_metrics.finance_packages
      where source_id=OLD.id and publication_status in ('published','superseded')) then
      raise exception 'Published COSME finance sources are immutable' using errcode='42501';
    end if;
  end if;
  if TG_OP='UPDATE' then return NEW; end if;
  return OLD;
end
$function$;
create trigger cosme_finance_packages_immutable before update or delete on cosme_metrics.finance_packages
 for each row execute function cosme_metrics.finance_reject_published_mutation();
create trigger cosme_finance_lines_immutable before update or delete on cosme_metrics.finance_lines
 for each row execute function cosme_metrics.finance_reject_published_mutation();
create trigger cosme_finance_alloc_immutable before update or delete on cosme_metrics.finance_allocations
 for each row execute function cosme_metrics.finance_reject_published_mutation();
create trigger cosme_finance_sources_immutable before update or delete on cosme_metrics.finance_sources
 for each row execute function cosme_metrics.finance_reject_published_mutation();

alter table cosme_metrics.finance_sources enable row level security;
alter table cosme_metrics.finance_packages enable row level security;
alter table cosme_metrics.finance_lines enable row level security;
alter table cosme_metrics.finance_allocations enable row level security;
revoke all on cosme_metrics.finance_sources,cosme_metrics.finance_packages,
  cosme_metrics.finance_lines,cosme_metrics.finance_allocations
  from public,anon,authenticated;
revoke all on function cosme_metrics.finance_reject_published_mutation()
  from public,anon,authenticated;

create function public.cosme_finance_read()
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_role text := cosme_metrics.caller_role();
begin
  if (select auth.uid()) is null or v_role not in ('owner','editor','reader') then
    raise exception 'COSME Metrics access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'sources',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'display_name',s.display_name,'source_kind',s.source_kind,
        'source_date',s.source_date,'revision',s.revision,
        'source_url',s.source_url) order by s.display_name),'[]'::jsonb)
      from cosme_metrics.finance_sources s
      where s.project_key='COSME' and exists(
        select 1 from cosme_metrics.finance_packages p
        where p.source_id=s.id and p.publication_status='published'
          and p.project_key='COSME'
      )
    ),
    'packages',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,'source_id',p.source_id,'activity',p.activity,
        'version',p.version,'basis',p.basis,'currency',p.currency,
        'units_covered',p.units_covered,'unit_label',p.unit_label,
        'funding_scope',p.funding_scope,'control_total',p.control_total,
        'reconciliation_status',p.reconciliation_status
      ) order by p.display_order,p.activity,p.version),'[]'::jsonb)
      from cosme_metrics.finance_packages p
      where p.project_key='COSME' and p.publication_status='published'
    ),
    'lines',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',l.id,'package_id',l.package_id,'source_row',l.source_row,
        'entry_date',l.entry_date,'category',l.category,'subcategory',l.subcategory,
        'description',l.description,'quantity',l.quantity,'unit',l.unit,
        'unit_rate',l.unit_rate,'amount',l.amount,'funding_org',l.funding_org,
        'included_in_total',l.included_in_total,
        'reconciliation_status',l.reconciliation_status,'note',l.note
      ) order by l.source_row),'[]'::jsonb)
      from cosme_metrics.finance_lines l
      join cosme_metrics.finance_packages p on p.id=l.package_id
      where p.project_key='COSME' and p.publication_status='published'
    )
  );
end
$function$;
revoke all on function public.cosme_finance_read() from public,anon;
grant execute on function public.cosme_finance_read() to authenticated;
comment on function public.cosme_finance_read() is
  'Read-only, COSME Metrics-grant-gated finance source package and evidence feed. No transactions are modified.';
notify pgrst,'reload schema';
