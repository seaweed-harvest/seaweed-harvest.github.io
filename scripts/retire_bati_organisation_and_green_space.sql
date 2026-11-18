-- Historical retirement verification (read-only).
--
-- The owner-approved BATI organisation and Green Space deletion was completed
-- directly in the live Cascadia Supabase project on 18 November 2026 through
-- small guarded connector transactions and the Supabase Dashboard.
-- Do NOT replay the original destructive script during merge or deployment.
-- This file is deliberately SELECT-only and safe to re-run as an audit.
--
-- BATI is the obsolete *organisation* below, not the Bati farming community.
-- Mawimbi's Bati collections, receipts, farmers, solar-dryer records and all
-- other operating data must remain untouched.

select
  not exists (
    select 1 from public.ag_aggregators
    where id = '59f5db4c-c85f-4a49-ae4e-11232e95ac02'::uuid
      and aggregator_code = 'BATI'
  ) as bati_test_organisation_absent,
  (select count(*) from public.ag_aggregators
     where aggregator_code in ('COSME', 'MAWIMBI', 'SANDBOX')) = 3
    as operational_organisations_present,
  (select count(*) from public.girls_green_spaces) = 0
    as green_spaces_empty,
  (select count(*) from public.girls_reflection_entries) = 0
    as green_reflections_empty,
  (select count(*) from public.girls_green_space_photos) = 0
    as green_photo_metadata_empty,
  (select count(*) from public.girls_final_assessment_snapshots) = 0
    as green_assessments_empty,
  (select count(*) from public.girls_submission_rate_limits) = 0
    as green_rate_limits_empty,
  (select count(*) from storage.buckets where id = 'green-space-photos') = 0
    as green_storage_bucket_absent,
  (select count(*) from storage.objects where bucket_id = 'green-space-photos') = 0
    as green_storage_objects_empty,
  (select count(*) from public.ag_form_access_settings
     where form_key = 'form_green_space') = 0
    as green_form_settings_empty,
  (select count(*) from public.ag_aggregator_memberships
     where form_access ? 'form_green_space') = 0
    as green_member_form_grants_empty,
  (select count(*) from public.ag_organisation_permissions
     where capabilities ->> 'form_green_space' = 'true') = 0
    as green_org_form_access_disabled,
  (select count(*) from public.ag_user_profiles
     where app_role = 'green_space_teacher' and account_status = 'active') = 0
    as green_teacher_accounts_inactive,
  (select count(*) from public.ag_user_profiles
     where can_manage_green_space and not is_protected_owner) = 0
    as green_non_owner_grants_empty,
  (select count(*) from public.ag_historical_ledger_rows) >= 1704
    as sandbox_historical_ledger_preserved,
  (select count(*) from public.collections
     where aggregator_id = (select id from public.ag_aggregators
        where aggregator_code = 'MAWIMBI')) >= 697
    as mawimbi_collections_preserved,
  (select count(*) from public.ag_collection_receipts
     where aggregator_id = (select id from public.ag_aggregators
        where aggregator_code = 'MAWIMBI')) >= 589
    as mawimbi_receipts_preserved,
  (select count(*) from public.communities) >= 24
    as shared_communities_preserved,
  (select count(*) from public.farmers) >= 267
    as shared_farmers_preserved;

-- Provider-level verification is separate: the `green-space-log` Edge
-- Function was deleted using Supabase Dashboard and is absent from the
-- live functions list. The protected owner's legacy internal permission bit
-- remains unchanged by design; retired UI and endpoint are removed.
