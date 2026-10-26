# COSME dryer database consolidation — production cutover

**Status:** Not executed. Keep the current dryer Supabase endpoint live and read/write until all source data, photo objects, and payment history are safely copied and verified.

## Projects and scope

- Source (legacy COSME dryer): `v4_Super_Seaweed`, `iyoihlwtvdshtlzjdoed`.
- Destination (main Seaweed Harvest, with COSME and Mawimbi organisation tenancy): `v1_Ag_System`, `wwzmajhdusfyfskppupg`.
- The destination currently has **no** `public.seaweed_drying_%` tables, dryer RPCs, `station_registry` or `seaweed-drying-photos` bucket. Do not repoint the form yet.
- Source inspection, writes, and schema deployment require authenticated COSME_Seaweed Supabase project management access; the current ChatGPT Supabase connector is authorized only for the destination organisation.

## Required data inventory (source)

Query the old project while keeping user writes running. Compare against a second count during cutover:

```sql
select table_schema, table_name from information_schema.tables
where (table_schema = 'public' and (table_name like 'seaweed_drying_%' or table_name = 'station_registry'))
order by table_schema, table_name;

select
  (select count(*) from public.seaweed_drying_submissions) as runs,
  (select count(*) from public.seaweed_drying_bay_records) as loading_unloading_bays,
  (select count(*) from public.seaweed_drying_reweigh_events) as reweigh_events,
  (select count(*) from public.seaweed_drying_reweigh_bay_records) as reweigh_bay_measurements,
  (select count(*) from public.seaweed_drying_activity_day_decisions) as payment_decisions,
  (select count(*) from public.seaweed_drying_payment_transactions) as payment_transactions,
  (select count(*) from public.seaweed_drying_payment_activity_days) as paid_day_allocations;

select id, name, public from storage.buckets where id = 'seaweed-drying-photos';
select count(*) from storage.objects where bucket_id = 'seaweed-drying-photos';
```

Include **all** other dryer tables identified by the inventory, especially trial schedules, observations, station registrations, finance and photo metadata. Also inspect **all** source dryer functions, views, sequences, triggers, grants, RLS policies and storage policies. Record a manifest with identifiers and timestamps.

## Safe migration order

1. Back up source database and the entire **private** `seaweed-drying-photos` bucket, including original object paths. Test that one full backup is restorable. Store backup outside both projects.
2. Build equivalent dryer schema in destination under COSME organisation controls. Carry forward the complete current functions and permissions, including reweighs, editing, receipts, location validation and payments; avoid applying only the earliest historical baseline. Rework the dryer owner/finance bridge to use the destination's local organisation permissions rather than recursively calling its own HTTP endpoint. Keep dryer records restricted to COSME roles. Do not grant public table reads.
3. Copy all source rows in foreign-key dependency order, preserving UUIDs, receipt numbers, timestamps, original `upload_token_hash` values, weights, individual reweigh event IDs, weather, trial settings, RA identifiers, approval snapshots, immutable ledger transaction IDs, phone advances and all photo path arrays. No silent deduplication or recalculation of paid transactions.
4. Copy photo objects to destination private storage `seaweed-drying-photos` preserving object path, content type and file bytes; confirm signed photo preview works, including reweigh photos. Check all referenced objects exist.
5. Allow a short, clearly communicated write freeze for the final delta copy and source/destination reconciliation; verify no submissions, reweighs or photo uploads are in flight. Reconcile totals **and** sample per-run data including the recent October reweighs. Verify existing recorded payment ledger, paid-day allocations and credits are unchanged.
6. Test the destination RPCs with representative genuine permissions and records: create an unsigned-in dryer entry, amend a previously created record using its token, add reweighs with photos, unload a bay, list records, view weather analysis, approve a new activity day, and view payments. Do not create actual money-transfer ledger transactions as a test on production.
7. **Only after all checks pass**, change `assets/js/dryer_table_config.js` to point the dryer modules at the destination URL/key, update every versioned module import, roll the PWA cache, and deploy. Repeat read/write smoke checks on desktop and mobile. Keep the old source read-only as a rollback snapshot and monitor for straggler writes.
8. Retire old storage and database **only** after a separately verified retention period and independent backups. No deletion in this PR.

## Reweigh payment extension

The PR includes `20261026120000_dryer_reweigh_payable_activity.sql` and `20261026121000_dryer_shed_t6_t8.sql` for the **current source dryer backend**, before any planned cutover. One bay measured in a reweigh event is one activity. The same base contract applies to 8 or more *loadings, or reweighs, or unloadings* on an assistant/day. Bonus of KES 25 per additional event applies after eight, including reweighs. The field form uses the submission's Research Assistant identity for subsequent reweighs.

## Gate and non-negotiable reconciliation

Do **not** merge the web changes or change the database URL until the COSME source project permits SQL deployment and backfill access. Two user-visible screens connecting does not mean both projects share storage or SQL credentials.

The live Payment section previously showed 34 activity days, 13 paid and two ledger transactions (KES 7,125 work transfer and KES 1,000 phone/data advance). These figures are useful **checkpoints, not a replacement for full SQL reconciliation**. Existing paid ledger amounts and credit applications must remain untouched. Reweigh days from October must be attributed and counted on their actual Kenya dates.
