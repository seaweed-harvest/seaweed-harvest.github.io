begin;

create or replace function public.ag_public_reef_review_submissions(
  p_share_token text,
  p_search text default null,
  p_sort text default 'training_date',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  session_id uuid,
  record_number text,
  record_status text,
  training_date text,
  trainer_name text,
  location text,
  session_types jsonb,
  payload jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.ag_form_share_links%rowtype;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_sort text := lower(coalesce(p_sort, 'training_date'));
  v_direction text := lower(coalesce(p_direction, 'desc'));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if coalesce(p_share_token, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'This review link is invalid or no longer active.'
      using errcode = '42501';
  end if;
  if v_sort not in ('record_number', 'training_date', 'trainer_name', 'location') then
    v_sort := 'training_date';
  end if;
  if v_direction not in ('asc', 'desc') then
    v_direction := 'desc';
  end if;

  select link.*
  into v_link
  from public.ag_form_share_links link
  join public.ag_form_access_settings settings
    on settings.organisation_id = link.organisation_id
   and settings.form_key = link.form_key
   and settings.entry_access = 'review'
  where link.id = p_share_token::uuid
    and link.form_key = 'form_reef_nursery'
    and link.link_kind = 'review'
    and link.active
    and (link.expires_at is null or link.expires_at > now());

  if v_link.id is null then
    raise exception 'This review link is invalid or no longer active.'
      using errcode = '42501';
  end if;

  return query
  with matching as (
    select
      submission.id,
      submission.submitter_name,
      submission.payload,
      submission.created_at,
      submission.payload #>> '{record,session,training_date}' as form_training_date,
      coalesce(
        nullif(submission.payload #>> '{record,session,trainer_name}', ''),
        submission.submitter_name
      ) as form_trainer_name,
      submission.payload #>> '{record,session,location}' as form_location,
      case
        when jsonb_typeof(submission.payload #> '{record,session,session_types}') = 'array'
          then submission.payload #> '{record,session,session_types}'
        else '[]'::jsonb
      end as form_session_types
    from public.ag_shared_form_submissions submission
    where submission.share_link_id = v_link.id
      and submission.organisation_id = v_link.organisation_id
      and submission.form_key = 'form_reef_nursery'
      and submission.submission_kind = 'test'
      and (
        v_search is null
        or coalesce(submission.submitter_name, '') ilike '%' || v_search || '%'
        or coalesce(submission.payload #>> '{record,session,trainer_name}', '') ilike '%' || v_search || '%'
        or coalesce(submission.payload #>> '{record,session,location}', '') ilike '%' || v_search || '%'
        or coalesce(submission.payload #> '{record,session,session_types}', '[]'::jsonb)::text ilike '%' || v_search || '%'
      )
  ),
  counted as (
    select matching.*, count(*) over () as matched_count
    from matching
  )
  select
    counted.id as session_id,
    'Review ' || to_char(counted.created_at at time zone 'Africa/Nairobi', 'DD Mon YYYY, HH24:MI')
      as record_number,
    'test'::text as record_status,
    counted.form_training_date as training_date,
    counted.form_trainer_name as trainer_name,
    counted.form_location as location,
    counted.form_session_types as session_types,
    counted.payload,
    counted.created_at,
    counted.matched_count as total_count
  from counted
  order by
    case when v_sort = 'record_number' and v_direction = 'asc' then counted.created_at end asc,
    case when v_sort = 'record_number' and v_direction = 'desc' then counted.created_at end desc,
    case when v_sort = 'training_date' and v_direction = 'asc' then counted.form_training_date end asc nulls last,
    case when v_sort = 'training_date' and v_direction = 'desc' then counted.form_training_date end desc nulls last,
    case when v_sort = 'trainer_name' and v_direction = 'asc' then lower(counted.form_trainer_name) end asc nulls last,
    case when v_sort = 'trainer_name' and v_direction = 'desc' then lower(counted.form_trainer_name) end desc nulls last,
    case when v_sort = 'location' and v_direction = 'asc' then lower(counted.form_location) end asc nulls last,
    case when v_sort = 'location' and v_direction = 'desc' then lower(counted.form_location) end desc nulls last,
    counted.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.ag_public_reef_review_submissions(
  text, text, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.ag_public_reef_review_submissions(
  text, text, text, text, integer, integer
) to anon, authenticated, service_role;

comment on function public.ag_public_reef_review_submissions(
  text, text, text, text, integer, integer
) is
  'Lists isolated Reef test submissions for the same active review bearer link.';

notify pgrst, 'reload schema';

commit;
