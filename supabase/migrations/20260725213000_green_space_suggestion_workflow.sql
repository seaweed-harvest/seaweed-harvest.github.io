begin;

alter table public.girls_green_spaces
  add column if not exists final_submitted_at timestamptz;

alter table public.girls_reflection_entries
  add column if not exists is_final_submitted boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.girls_reflection_entries
  drop constraint if exists girls_final_submission_scope;

alter table public.girls_reflection_entries
  add constraint girls_final_submission_scope check (
    entry_type = 'final_reflection' or is_final_submitted = false
  ) not valid;

alter table public.girls_reflection_entries
  validate constraint girls_final_submission_scope;

create unique index if not exists girls_one_final_reflection_per_project
  on public.girls_reflection_entries (green_space_id)
  where entry_type = 'final_reflection';

drop function if exists public.girls_public_green_spaces();

create function public.girls_public_green_spaces()
returns table (
  id uuid,
  public_code text,
  participant_name text,
  green_space_name text,
  intentions text,
  location_description text,
  visit_schedule text,
  latitude numeric,
  longitude numeric,
  photo_path text,
  created_at timestamptz,
  updated_at timestamptz,
  final_submitted_at timestamptz,
  favourite_haiku text,
  entry_count bigint,
  latest_entry_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    spaces.id,
    spaces.public_code,
    spaces.participant_name,
    spaces.green_space_name,
    spaces.intentions,
    spaces.location_description,
    spaces.visit_schedule,
    spaces.latitude,
    spaces.longitude,
    spaces.photo_path,
    spaces.created_at,
    spaces.updated_at,
    spaces.final_submitted_at,
    submitted_final.favourite_haiku,
    (
      select count(*)::bigint
      from public.girls_reflection_entries entries
      where entries.green_space_id = spaces.id
        and (
          entries.entry_type <> 'final_reflection'
          or entries.is_final_submitted = true
        )
    ) as entry_count,
    (
      select max(entries.created_at)
      from public.girls_reflection_entries entries
      where entries.green_space_id = spaces.id
        and (
          entries.entry_type <> 'final_reflection'
          or entries.is_final_submitted = true
        )
    ) as latest_entry_at
  from public.girls_green_spaces spaces
  join public.ag_aggregators aggregators
    on aggregators.id = spaces.aggregator_id
    and aggregators.aggregator_code = 'SANDBOX'
  left join lateral (
    select entries.favourite_haiku
    from public.girls_reflection_entries entries
    where entries.green_space_id = spaces.id
      and entries.entry_type = 'final_reflection'
      and entries.is_final_submitted = true
    order by entries.updated_at desc
    limit 1
  ) submitted_final on true
  order by spaces.created_at desc;
$$;

revoke all on function public.girls_public_green_spaces() from public;
grant execute on function public.girls_public_green_spaces() to anon, authenticated;

comment on column public.girls_green_spaces.final_submitted_at is
  'When set, the final reflection is locked against further public form changes.';
comment on column public.girls_reflection_entries.is_final_submitted is
  'True only after the participant confirms final submission. Draft final reflections remain editable.';
comment on function public.girls_public_green_spaces() is
  'Public Green Space project map data, including editable Project Start fields and submitted showcase content.';

commit;
