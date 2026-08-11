begin;

insert into public.ag_form_access_settings (
  organisation_id,
  form_key,
  entry_access,
  updated_at,
  updated_by
)
select
  organisation.id,
  'form_dryer_table',
  'public',
  now(),
  null
from public.ag_aggregators organisation
where upper(organisation.aggregator_code) = 'COSME'
on conflict (organisation_id, form_key) do update
set entry_access = excluded.entry_access,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

commit;
