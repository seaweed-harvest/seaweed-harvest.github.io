begin;

alter table public.ag_site_feedback
  add column if not exists photo_path text,
  add column if not exists photo_content_type text,
  add column if not exists photo_byte_size integer,
  add column if not exists review_decision text not null default 'review_required'
    check (review_decision in ('approved', 'review_required', 'flagged')),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null;

update public.ag_site_feedback
set review_decision = case
  when lower(coalesce(submitter_email, '')) = 'bmichael@cascadiaseaweed.com' then 'approved'
  else 'review_required'
end;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-feedback-photos',
  'site-feedback-photos',
  false,
  716800,
  array['image/jpeg']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ag_site_feedback_owner_photo_read on storage.objects;
create policy ag_site_feedback_owner_photo_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'site-feedback-photos'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'bmichael@cascadiaseaweed.com'
);

create or replace function public.ag_owner_site_feedback(
  p_status text default null,
  p_search text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  created_at timestamptz,
  source_app text,
  source_page text,
  page_url text,
  feedback_type text,
  message text,
  submitter_name text,
  submitter_email text,
  status text,
  review_decision text,
  photo_path text,
  photo_content_type text,
  photo_byte_size integer,
  slack_status text,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  select lower(coalesce(u.email, ''))
  into v_email
  from auth.users u
  where u.id = (select auth.uid());

  if v_email is distinct from 'bmichael@cascadiaseaweed.com' then
    raise exception 'Suggestions workspace is available only to the protected owner.'
      using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('new', 'reviewing', 'planned', 'closed') then
    raise exception 'Unknown suggestion status.';
  end if;

  return query
  select
    feedback.id,
    feedback.created_at,
    feedback.source_app,
    feedback.source_page,
    feedback.page_url,
    feedback.feedback_type,
    feedback.message,
    feedback.submitter_name,
    feedback.submitter_email,
    feedback.status,
    feedback.review_decision,
    feedback.photo_path,
    feedback.photo_content_type,
    feedback.photo_byte_size,
    feedback.slack_status,
    feedback.closed_at
  from public.ag_site_feedback feedback
  where (v_status is null or feedback.status = v_status)
    and (
      v_search is null
      or feedback.message ilike '%' || v_search || '%'
      or feedback.source_page ilike '%' || v_search || '%'
      or feedback.submitter_name ilike '%' || v_search || '%'
      or feedback.submitter_email ilike '%' || v_search || '%'
    )
  order by
    case feedback.status
      when 'new' then 1
      when 'reviewing' then 2
      when 'planned' then 3
      else 4
    end,
    feedback.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

create or replace function public.ag_owner_update_site_feedback(
  p_feedback_id uuid,
  p_status text,
  p_review_decision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text;
  v_result public.ag_site_feedback%rowtype;
begin
  select lower(coalesce(u.email, ''))
  into v_email
  from auth.users u
  where u.id = (select auth.uid());

  if v_email is distinct from 'bmichael@cascadiaseaweed.com' then
    raise exception 'Suggestions workspace is available only to the protected owner.'
      using errcode = '42501';
  end if;
  if p_status not in ('new', 'reviewing', 'planned', 'closed') then
    raise exception 'Unknown suggestion status.';
  end if;
  if p_review_decision is not null
    and p_review_decision not in ('approved', 'review_required', 'flagged') then
    raise exception 'Unknown review decision.';
  end if;

  update public.ag_site_feedback
  set status = p_status,
      review_decision = coalesce(p_review_decision, review_decision),
      closed_at = case when p_status = 'closed' then now() else null end,
      closed_by = case when p_status = 'closed' then (select auth.uid()) else null end
  where id = p_feedback_id
  returning * into v_result;

  if v_result.id is null then raise exception 'Suggestion was not found.'; end if;

  return jsonb_build_object(
    'id', v_result.id,
    'status', v_result.status,
    'review_decision', v_result.review_decision,
    'closed_at', v_result.closed_at
  );
end;
$$;

revoke all on function public.ag_owner_site_feedback(text, text, integer) from public, anon;
revoke all on function public.ag_owner_update_site_feedback(uuid, text, text) from public, anon;
grant execute on function public.ag_owner_site_feedback(text, text, integer) to authenticated;
grant execute on function public.ag_owner_update_site_feedback(uuid, text, text) to authenticated;

comment on column public.ag_site_feedback.review_decision is
  'Owner submissions are approved automatically; all others remain review-required unless flagged.';
comment on function public.ag_owner_site_feedback(text, text, integer) is
  'Protected-owner suggestions queue for Seaweed Harvest administration.';

commit;
