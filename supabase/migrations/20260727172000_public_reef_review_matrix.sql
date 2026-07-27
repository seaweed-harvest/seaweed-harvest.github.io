begin;

create or replace function public.ag_public_reef_training_matrix()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'section_key', section_row.section_key,
        'section_label', section_row.section_label,
        'section_order', section_row.section_order,
        'activities', section_row.activities
      )
      order by section_row.section_order
    ),
    '[]'::jsonb
  )
  from (
    select
      section.section_key,
      section.section_label,
      section.section_order,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', activity.id,
            'label', activity.activity_label,
            'activity_order', activity.activity_order
          )
          order by activity.activity_order, activity.id
        ) filter (where activity.id is not null),
        '[]'::jsonb
      ) as activities
    from public.ag_reef_training_matrix_sections section
    left join public.ag_reef_training_matrix_activities activity
      on activity.section_key = section.section_key
      and activity.is_active
    where section.is_active
    group by
      section.section_key,
      section.section_label,
      section.section_order
  ) section_row;
$$;

revoke all on function public.ag_public_reef_training_matrix()
  from public, anon, authenticated;
grant execute on function public.ag_public_reef_training_matrix()
  to anon, authenticated, service_role;

create or replace function public.ag_public_form_entry_context(
  p_form_key text,
  p_organisation_code text,
  p_share_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organisation public.ag_aggregators%rowtype;
  v_capabilities jsonb;
  v_entry_access text;
  v_share_link public.ag_form_share_links%rowtype;
  v_allowed boolean := false;
  v_training_matrix jsonb := null;
begin
  select organisation.*
  into v_organisation
  from public.ag_aggregators organisation
  where upper(organisation.aggregator_code) = upper(trim(p_organisation_code))
    and organisation.active
  limit 1;

  if v_organisation.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'Form unavailable');
  end if;

  v_capabilities := public.ag_organisation_capabilities(v_organisation.id);
  if not coalesce((v_capabilities ->> p_form_key)::boolean, false) then
    return jsonb_build_object('allowed', false, 'reason', 'Form unavailable');
  end if;

  select coalesce(
    settings.entry_access,
    public.ag_default_form_entry_access(
      v_organisation.aggregator_code,
      p_form_key
    )
  )
  into v_entry_access
  from (select 1) seed
  left join public.ag_form_access_settings settings
    on settings.organisation_id = v_organisation.id
    and settings.form_key = p_form_key;

  if v_entry_access = 'public' then
    v_allowed := true;
  elsif v_entry_access in ('link', 'review')
        and coalesce(p_share_token, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select link.*
    into v_share_link
    from public.ag_form_share_links link
    where link.id = p_share_token::uuid
      and link.organisation_id = v_organisation.id
      and link.form_key = p_form_key
      and link.link_kind = case
        when v_entry_access = 'review' then 'review'
        else 'live'
      end
      and link.active
      and (link.expires_at is null or link.expires_at > now());
    v_allowed := v_share_link.id is not null;
  end if;

  if v_allowed and p_form_key = 'form_reef_nursery' then
    v_training_matrix := public.ag_public_reef_training_matrix();
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'entry_access', v_entry_access,
    'form_key', p_form_key,
    'organisation_code', v_organisation.aggregator_code,
    'organisation_name', v_organisation.organisation_name,
    'share_link_id', v_share_link.id,
    'submission_kind', case
      when v_entry_access = 'review' then 'test'
      when v_allowed then 'live'
      else null
    end,
    'records_private', true,
    'training_matrix', v_training_matrix,
    'reason', case
      when v_allowed then null
      when v_entry_access = 'paused' then 'This form is paused.'
      when v_entry_access = 'private' then 'Sign in to open this form.'
      else 'This share link is invalid or no longer active.'
    end
  );
end;
$$;

revoke all on function public.ag_public_form_entry_context(text, text, text)
  from public, anon, authenticated;
grant execute on function public.ag_public_form_entry_context(text, text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
