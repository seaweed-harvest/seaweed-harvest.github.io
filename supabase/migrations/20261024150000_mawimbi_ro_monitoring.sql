-- Separate RO process-water monitoring from the coastal site samples.
begin;

create table if not exists public.ag_mawimbi_ro_monitoring_records (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  aggregator_id uuid not null references public.ag_aggregators(id) on delete restrict,
  recorded_on date not null,
  pure_water_flow_lpm numeric(10,2) not null check (pure_water_flow_lpm between 0 and 100000),
  wastewater_flow_lpm numeric(10,2) not null check (wastewater_flow_lpm between 0 and 100000),
  membrane_front_pressure_psi numeric(10,2) not null check (membrane_front_pressure_psi between 0 and 10000),
  permeate_tds_ppm numeric(12,3) not null check (permeate_tds_ppm between 0 and 1000000),
  recorded_by_user_id uuid references auth.users(id) on delete set null,
  recorded_by_name text not null,
  created_at timestamptz not null default now(),
  constraint ag_mawimbi_ro_submission_unique unique (aggregator_id, submission_id)
);
create index if not exists ag_mawimbi_ro_date_idx
  on public.ag_mawimbi_ro_monitoring_records (aggregator_id, recorded_on desc, created_at desc);
alter table public.ag_mawimbi_ro_monitoring_records enable row level security;
revoke all on public.ag_mawimbi_ro_monitoring_records from public, anon, authenticated;
comment on table public.ag_mawimbi_ro_monitoring_records is
  'Mawimbi Harvo RO system process-water measurements, not coastal-site water samples.';

create or replace function public.ag_submit_mawimbi_ro_monitoring(
  p_submission_id uuid, p_recorded_on date,
  p_pure_water_flow_lpm numeric, p_wastewater_flow_lpm numeric,
  p_membrane_front_pressure_psi numeric, p_permeate_tds_ppm numeric
) returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_profile public.ag_user_profiles%rowtype;
  v_saved public.ag_mawimbi_ro_monitoring_records%rowtype;
begin
  perform public.ag_require_permission('can_submit_collection');
  v_aggregator_id := public.ag_require_organisation_capability('form_site_water_samples');
  if not exists (
    select 1 from public.ag_aggregators
    where id = v_aggregator_id and aggregator_code = 'MAWIMBI' and active
  ) then
    raise exception 'RO process water monitoring is only available in Mawimbi.'
      using errcode = '42501';
  end if;
  if p_submission_id is null or p_recorded_on is null
     or p_pure_water_flow_lpm is null or p_pure_water_flow_lpm < 0 or p_pure_water_flow_lpm > 100000
     or p_wastewater_flow_lpm is null or p_wastewater_flow_lpm < 0 or p_wastewater_flow_lpm > 100000
     or p_membrane_front_pressure_psi is null or p_membrane_front_pressure_psi < 0 or p_membrane_front_pressure_psi > 10000
     or p_permeate_tds_ppm is null or p_permeate_tds_ppm < 0 or p_permeate_tds_ppm > 1000000 then
    raise exception 'Enter a valid date and all four nonnegative RO readings.'
      using errcode = '22023';
  end if;
  select * into v_profile from public.ag_user_profiles
    where id = (select auth.uid()) and account_status = 'active';
  if not found then raise exception 'Active user profile required.' using errcode = '42501'; end if;

  insert into public.ag_mawimbi_ro_monitoring_records (
    submission_id, aggregator_id, recorded_on,
    pure_water_flow_lpm, wastewater_flow_lpm,
    membrane_front_pressure_psi, permeate_tds_ppm,
    recorded_by_user_id, recorded_by_name
  ) values (
    p_submission_id, v_aggregator_id, p_recorded_on,
    p_pure_water_flow_lpm, p_wastewater_flow_lpm,
    p_membrane_front_pressure_psi, p_permeate_tds_ppm,
    (select auth.uid()), coalesce(nullif(trim(v_profile.display_name),''), v_profile.email, v_profile.phone, 'Signed-in user')
  )
  on conflict (aggregator_id, submission_id) do update set
    submission_id = excluded.submission_id
  returning * into v_saved;

  insert into public.ag_audit_log (actor_user_id, actor_email, action, target_type, target_id, details)
  values (
    (select auth.uid()), v_profile.email,
    'mawimbi_ro_monitoring_saved', 'mawimbi_ro_monitoring',
    v_saved.id::text,
    jsonb_build_object('aggregator_id', v_aggregator_id, 'recorded_on', v_saved.recorded_on)
  );
  return jsonb_build_object('record_id',v_saved.id,'recorded_on',v_saved.recorded_on);
end;
$$;

create or replace function public.ag_list_mawimbi_ro_monitoring(p_limit integer default 40)
returns jsonb
language plpgsql stable security definer set search_path = public, auth, pg_temp
as $$
declare
  v_aggregator_id uuid;
  v_data jsonb;
begin
  if not (
    public.ag_has_permission('can_view_data') or
    public.ag_has_permission('can_submit_collection')
  ) then
    raise exception 'Not permitted to view RO monitoring records.' using errcode = '42501';
  end if;
  v_aggregator_id := public.ag_require_organisation_capability('form_site_water_samples');
  if not exists (select 1 from public.ag_aggregators
    where id = v_aggregator_id and aggregator_code = 'MAWIMBI' and active) then
    raise exception 'RO monitoring records are only available in Mawimbi.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.recorded_on desc, r.created_at desc), '[]'::jsonb)
    into v_data
  from (
    select id, recorded_on, pure_water_flow_lpm, wastewater_flow_lpm,
      membrane_front_pressure_psi, permeate_tds_ppm, recorded_by_name, created_at
    from public.ag_mawimbi_ro_monitoring_records
    where aggregator_id = v_aggregator_id
    order by recorded_on desc, created_at desc
    limit greatest(1, least(coalesce(p_limit,40),200))
  ) r;
  return v_data;
end;
$$;

revoke all on function public.ag_submit_mawimbi_ro_monitoring(uuid,date,numeric,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.ag_submit_mawimbi_ro_monitoring(uuid,date,numeric,numeric,numeric,numeric) to authenticated;
revoke all on function public.ag_list_mawimbi_ro_monitoring(integer) from public,anon,authenticated;
grant execute on function public.ag_list_mawimbi_ro_monitoring(integer) to authenticated;
notify pgrst,'reload schema';
commit;
