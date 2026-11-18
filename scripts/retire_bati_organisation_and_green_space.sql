-- Lane C protected release script. DO NOT run during PR review.
-- Approved scope: delete ONLY the unused BATI organisation and Green Space
-- experiment; preserve Mawimbi's Bati farming community and every operational
-- record, COSME membership, and all 1,704 historical ledger entries.
--
-- Prerequisites: separate owner merge/release approval, successful app/role
-- tests, no live Green Space writers, confirmed safe Storage API removal of all
-- 23 objects in green-space-photos. Deletion is intentionally irreversible
-- without provider recovery. Do not run this script a second time.

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $retirement$
declare
  v_bati uuid := '59f5db4c-c85f-4a49-ae4e-11232e95ac02'::uuid;
  v_cosme uuid;
  v_sandbox uuid;
  v_preserved_ledger integer;
  v_preserved_mawimbi_collections integer;
  v_preserved_mawimbi_receipts integer;
  v_preserved_communities integer;
  v_preserved_farmers integer;
  v_preserved_cosme_memberships integer;
  v_profile uuid;
  v_referencing record;
  v_count bigint;
begin
  select id into strict v_cosme from public.ag_aggregators where aggregator_code = 'COSME';
  select id into strict v_sandbox from public.ag_aggregators where aggregator_code = 'SANDBOX';

  if (select count(*) from public.ag_aggregators
      where id = v_bati and aggregator_code = 'BATI') <> 1 then
    raise exception 'BATI organisation identity mismatch; aborting.';
  end if;

  -- Exact counts from read-only 18 Nov 2026 audit. Refuse to silently discard
  -- any newly created records in this organisation or Green Space.
  if (select count(*) from public.ag_deleted_records where aggregator_id = v_bati) <> 53
      or (select count(*) from public.seaweedke_notification_requests where aggregator_id = v_bati) <> 22
      or (select count(*) from public.ag_aggregator_communities where aggregator_id = v_bati) <> 24
      or (select count(*) from public.ag_aggregator_farmers where aggregator_id = v_bati) <> 3
      or (select count(*) from public.ag_aggregator_memberships where aggregator_id = v_bati) <> 2
      or (select count(*) from public.ag_aggregator_receipt_counters where aggregator_id = v_bati) <> 1
      or (select count(*) from public.ag_form_access_settings where organisation_id = v_bati) <> 7
      or (select count(*) from public.ag_organisation_permissions where organisation_id = v_bati) <> 1
      or (select count(*) from public.ag_user_profiles where active_aggregator_id = v_bati) <> 1 then
    raise exception 'BATI counts changed since audit; aborting.';
  end if;

  if (select count(*) from public.ag_aggregator_communities bc
      where bc.aggregator_id = v_bati
        and exists (select 1 from public.ag_aggregator_communities shared
          where shared.community_id = bc.community_id and shared.aggregator_id <> v_bati)) <> 24
      or (select count(*) from public.ag_aggregator_farmers bf
        where bf.aggregator_id = v_bati
          and exists (select 1 from public.ag_aggregator_farmers shared
            where shared.farmer_id = bf.farmer_id and shared.aggregator_id <> v_bati)) <> 3 then
    raise exception 'A BATI community or farmer is not independently linked; aborting.';
  end if;

  -- This checks every foreign key pointing at the BATI organisation, including
  -- future tables not known when this script was written. Never delete by name
  -- of community, farm, village, drying table, or farmer.
  for v_referencing in
    select n.nspname as schema_name, t.relname as table_name, a.attname as fk_column
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.ag_aggregators'::regclass
      and t.relname <> all(array[
        'ag_deleted_records', 'seaweedke_notification_requests',
        'ag_aggregator_communities', 'ag_aggregator_farmers',
        'ag_aggregator_memberships', 'ag_aggregator_receipt_counters',
        'ag_form_access_settings', 'ag_organisation_permissions',
        'ag_user_profiles'
      ])
  loop
    execute format('select count(*) from %I.%I where %I = $1',
      v_referencing.schema_name, v_referencing.table_name, v_referencing.fk_column)
      into v_count using v_bati;
    if v_count <> 0 then
      raise exception 'Unexpected BATI operational references: %.% (% rows); aborting.',
        v_referencing.schema_name, v_referencing.table_name, v_count;
    end if;
  end loop;

  select p.id into strict v_profile
  from public.ag_user_profiles p
  where p.active_aggregator_id = v_bati
    and p.account_status = 'active'
    and p.app_role = 'system_admin'
    and not p.is_protected_owner
    and exists (select 1 from public.ag_aggregator_memberships m
      where m.user_id = p.id and m.aggregator_id = v_cosme and m.is_active);

  if (select count(*) from public.girls_green_spaces where aggregator_id = v_sandbox) <> 8
      or (select count(*) from public.girls_green_spaces) <> 8
      or (select count(*) from public.girls_reflection_entries) <> 27
      or (select count(*) from public.girls_green_space_photos) <> 3
      or (select count(*) from public.girls_final_assessment_snapshots) <> 5
      or (select count(*) from public.girls_submission_rate_limits) <> 52
      or (select count(*) from public.ag_form_access_settings
        where organisation_id = v_sandbox and form_key = 'form_green_space') <> 1
      or (select count(*) from public.ag_form_share_links
        where form_key = 'form_green_space') <> 0
      or (select count(*) from public.ag_user_profiles
        where app_role = 'green_space_teacher' and account_status = 'active'
          and not is_protected_owner) <> 2
      or (select count(*) from public.ag_user_profiles
        where can_manage_green_space and not is_protected_owner) <> 5 then
    raise exception 'Green Space counts changed since audit; aborting.';
  end if;

  if (select count(*) from public.ag_aggregator_memberships m
      join public.ag_user_profiles p on p.id = m.user_id
      where p.app_role = 'green_space_teacher' and m.aggregator_id = v_sandbox
        and m.is_active) <> 1 then
    raise exception 'Green Space teacher membership changed; aborting.';
  end if;

  v_preserved_ledger := (select count(*) from public.ag_historical_ledger_rows);
  v_preserved_mawimbi_collections := (select count(*) from public.collections
    where aggregator_id = (select id from public.ag_aggregators where aggregator_code = 'MAWIMBI'));
  v_preserved_mawimbi_receipts := (select count(*) from public.ag_collection_receipts
    where aggregator_id = (select id from public.ag_aggregators where aggregator_code = 'MAWIMBI'));
  v_preserved_communities := (select count(*) from public.ag_communities);
  v_preserved_farmers := (select count(*) from public.ag_farmers);
  v_preserved_cosme_memberships := (select count(*) from public.ag_aggregator_memberships
    where aggregator_id = v_cosme);

  if v_preserved_ledger <> 1704 then
    raise exception 'Sandbox ledger differs from approved 1,704-row baseline; aborting.';
  end if;

  -- BATI is an organisation ID, NOT the Bati farming community belonging to
  -- Mawimbi. The shared ag_communities / ag_farmers tables are never deleted.
  update public.ag_user_profiles set active_aggregator_id = v_cosme
    where id = v_profile and active_aggregator_id = v_bati;
  delete from public.ag_deleted_records where aggregator_id = v_bati;
  delete from public.seaweedke_notification_requests where aggregator_id = v_bati;
  delete from public.ag_aggregator_communities where aggregator_id = v_bati;
  delete from public.ag_aggregator_farmers where aggregator_id = v_bati;
  delete from public.ag_aggregator_memberships where aggregator_id = v_bati;
  delete from public.ag_aggregator_receipt_counters where aggregator_id = v_bati;
  delete from public.ag_form_access_settings where organisation_id = v_bati;
  delete from public.ag_organisation_permissions where organisation_id = v_bati;
  delete from public.ag_aggregators where id = v_bati and aggregator_code = 'BATI';

  -- Green Space-only identities are suspended, not deleted from Auth. All
  -- other user accounts and all operational organisation memberships remain.
  delete from public.ag_aggregator_memberships m
    using public.ag_user_profiles p
    where m.user_id = p.id and p.app_role = 'green_space_teacher'
      and m.aggregator_id = v_sandbox;

  update public.ag_user_profiles
    set account_status = 'suspended', app_role = 'read_only_auditor',
      can_manage_green_space = false, active_aggregator_id = null
    where app_role = 'green_space_teacher' and not is_protected_owner;

  update public.ag_user_profiles set can_manage_green_space = false
    where can_manage_green_space and not is_protected_owner;
  -- The protected owner's flag is deliberately left unchanged: an existing
  -- security trigger forbids any alteration to protected-owner permissions.
  -- The retired UI and endpoint provide no Green Space functionality.

  update public.ag_organisation_permissions
    set capabilities = jsonb_set(capabilities, '{form_green_space}', 'false'::jsonb, true)
    where capabilities ? 'form_green_space';
  update public.ag_aggregator_memberships
    set form_access = form_access - 'form_green_space'
    where form_access ? 'form_green_space';
  delete from public.ag_form_access_settings
    where organisation_id = v_sandbox and form_key = 'form_green_space';

  delete from public.girls_final_assessment_snapshots;
  delete from public.girls_green_space_photos;
  delete from public.girls_reflection_entries;
  delete from public.girls_green_spaces where aggregator_id = v_sandbox;
  delete from public.girls_submission_rate_limits;

  if exists (select 1 from public.ag_aggregators where id = v_bati)
      or exists (select 1 from public.girls_green_spaces)
      or exists (select 1 from public.girls_reflection_entries)
      or exists (select 1 from public.girls_green_space_photos)
      or exists (select 1 from public.girls_final_assessment_snapshots)
      or exists (select 1 from public.girls_submission_rate_limits)
      or exists (select 1 from public.ag_user_profiles
        where app_role = 'green_space_teacher' and account_status = 'active') then
    raise exception 'Retirement left targeted records behind; rolling back.';
  end if;

  if (select count(*) from public.ag_historical_ledger_rows) <> v_preserved_ledger
      or (select count(*) from public.collections where aggregator_id =
        (select id from public.ag_aggregators where aggregator_code = 'MAWIMBI')) <> v_preserved_mawimbi_collections
      or (select count(*) from public.ag_collection_receipts where aggregator_id =
        (select id from public.ag_aggregators where aggregator_code = 'MAWIMBI')) <> v_preserved_mawimbi_receipts
      or (select count(*) from public.ag_communities) <> v_preserved_communities
      or (select count(*) from public.ag_farmers) <> v_preserved_farmers
      or (select count(*) from public.ag_aggregator_memberships where aggregator_id = v_cosme) <> v_preserved_cosme_memberships then
    raise exception 'A preserved dataset changed; rolling back.';
  end if;
end
$retirement$;

commit;
