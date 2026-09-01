# Dryer Table Records Ledger — Implementation Plan

Date: 2026-09-01
Status: implementation complete on draft branch; merge/deployment and live owner-session verification pending
Target application: Seaweed Harvest / COSME Dryer Table
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Base branch: `main`
Exact base commit: `2b4862564aff196105e44149a8d56d3e69a1cb1a`
Implementation branch: `work/dryer-table-records-ledger-20260901`
Draft pull request: `#14`

## Authoritative request

This is a manual owner-directed request made in ChatGPT on 2026-09-01. No matching Supabase suggestion/request table or authoritative suggestion row exists for this request. The conversation is therefore the manual request source for this branch.

The user approved moving from planning to implementation with: “okay, please proceed”. The protected database gate was then explicitly approved with: “I approve the protected Supabase read RPC/migration for the Dryer Table Records ledger. please don't break or lose data”.

That approval authorises the additive read-only backend work recorded below. It does not authorise merge or deployment.

## Request summary

Add an authenticated Dryer Table Records ledger under the Records navigation for COSME. The existing public/offline Dryer Table form, its Review saved bay data section, local drafts, edit-token flow, and offline behaviour must remain unchanged.

The records page should reuse the established Seaweed Harvest record-ledger visual language rather than introduce new navigation, table, tab, filter, status or spacing patterns.

## User problem

Dryer-table measurements are currently captured effectively in the field, including load/unload timestamps and weights per bay, but there is no logged-in ledger for reviewing all dryer-table records together. The owner needs a clear operational summary that can be filtered/grouped by physical dryer table and date, with observations separated from the primary weight/duration ledger. A future payment-register tab will calculate Research Assistant payments under the contract, but payment calculation logic is explicitly out of scope for this first implementation.

## Agreed first-version UX

Authenticated route: `Dryer Table Records`

Tabs:
1. `All Records`
2. `Observations`
3. `Payment Register`

### All Records

One row represents one bay drying cycle.

Columns:
- Table
- Bay
- Status
- Loaded
- Wet kg
- Unloaded
- Dry kg
- Weight loss
- Drying time
- Photos

Status semantics:
- `Drying`: loading exists, unloading does not
- `Complete`: loading and unloading both exist
- `Needs review`: unloading exists without loading, or timestamps are invalid

Filters/grouping:
- Table
- From date
- To date
- Status
- Group by: Table (default) or Load date

Summary figures for the filtered result set:
- Wet loaded
- Dry unloaded
- Currently drying
- Completed cycles

### Observations

Columns:
- Date
- Table
- General observations
- Working well
- Not working

Use the existing submission record date/loading context rather than creating a new observation date field.

### Payment Register

Render the third tab now as a clearly labelled placeholder. Do not add payment calculations until the Research Assistant contract rules are supplied and separately approved.

## Existing data confirmed

The dryer database already contains:
- `seaweed_drying_submissions`
- `seaweed_drying_bay_records`
- `seaweed_drying_bay_summary`

`seaweed_drying_bay_summary` already supplies table location, bay number, load/unload timestamps, drying minutes, wet/dry weights, weight loss kg/%, and weather fields.

`seaweed_drying_submissions` already supplies the table-level observations and table photo paths.

The current public RPC `list_seaweed_drying_records` intentionally exposes only receipt/table/status/bay-state summary data. The detailed bay summary view has no `anon` or `authenticated` SELECT grant.

A further architecture check found that authentication/accounts and dryer-table records live in separate Supabase projects. The implementation therefore does not copy or migrate dryer data into the account project. Instead, the dryer project's new read-only RPC validates the caller's existing Seaweed Harvest account token against `ag_my_profile` in the account project before returning existing dryer rows.

## Risk classification

Overall lane: **C — protected backend change, explicitly approved before coding**.

Reasons:
- The new authenticated read RPC is a protected `supabase/**` migration.
- The shared `assets/js/app_navigation.js` navigation update is Lane B.
- The branch changes seven files and therefore exceeds Lane A limits regardless of the protected migration.

No write, delete, payment, payout, form-submission, offline-store, service-worker or deployment behaviour is included.

## Implemented scope

1. Added `public.list_authenticated_seaweed_drying_ledger(text, integer)` through migration `20260901103000_authenticated_dryer_table_records.sql`.
   - Read-only.
   - Validates a Seaweed Harvest account-project access token over HTTPS.
   - Requires active protected-owner status, active COSME context, dryer-table capability and data/admin access.
   - Returns existing bay summary fields plus observation rows.
   - Does not grant direct table SELECT to `anon`.
   - Does not insert, update, delete, truncate or alter dryer source tables.

2. Added `dryer_table_records.html` using the shared authenticated record-ledger classes.

3. Added `assets/js/dryer_table_records.js` for authentication, data loading, filtering, grouping, summaries and the three-tab interaction.

4. Added an owner-only `Dryer Table Records` link to the shared Records menu, additionally gated by COSME, `form_dryer_table` and `can_view_data`.

5. Added deterministic static coverage and a signed-out browser guard probe.

6. Left `dryer_table.html`, `dryer_table_form.js`, `dryer_table_bootstrap.js`, dryer local/offline storage, service worker and existing public dryer RPCs unchanged.

## Actual changed paths

- `01_Ag_Planning_Documents/2026-09-01_DRYER_TABLE_RECORDS_LEDGER.md`
- `dryer_table_records.html`
- `assets/js/dryer_table_records.js`
- `assets/js/app_navigation.js`
- `tests/dryer_table_records_static_test.py`
- `tests/dryer_table_records_ui_probe.py`
- `supabase/migrations/20260901103000_authenticated_dryer_table_records.sql`

The `assets/js/app_navigation.js` diff is one added Records-menu entry only.

## Acceptance checks

1. Anonymous/public dryer-table workflow is unchanged.
2. `dryer_table.html` remains usable without login and offline exactly as before.
3. A signed-out user cannot access the new Dryer Table Records page.
4. The Records menu shows Dryer Table Records only for the protected owner in eligible COSME context with dryer-table/data access.
5. All Records renders one row per bay cycle with Table, Bay, Status, Loaded, Wet kg, Unloaded, Dry kg, Weight loss, Drying time and Photos.
6. Load-only records display as Drying without fabricated unload values.
7. Complete records display existing database drying duration and loss values rather than recalculating authoritative values inconsistently.
8. Filters work for table, date range and status.
9. Grouping works by Table and Load date.
10. Filtered summary totals update consistently with visible records.
11. Observations are shown in a separate tab and do not clutter the main bay ledger.
12. Payment Register exists but contains no payment calculation logic.
13. No dryer submission, editing, deletion, trial schedule, photo upload or offline code path is modified.

## Verification evidence — 2026-09-01

Completed:
- Protected migration applied successfully to the existing dryer-data Supabase project after explicit approval.
- Source record counts immediately before migration: 8 submissions and 49 bay records.
- Source record counts immediately after migration: 8 submissions and 49 bay records.
- Current existing wet-load total after migration: 569.001 kg; no source records were rewritten by the migration.
- `anon` still has no direct SELECT privilege on `seaweed_drying_bay_records` or `seaweed_drying_submissions`.
- Missing-token and invalid-token calls to the new RPC are rejected with SQLSTATE `42501`.
- JavaScript syntax check passed for the new ledger script.
- A null-display regression was identified during verification and fixed so unfinished bays render `-` rather than fabricated `0 kg`, `0.0%` or `0m` unload values.
- Actual navigation patch inspected: exactly one added menu entry.
- Actual changed-path list inspected: only the seven planned files above; public/offline dryer form assets are absent from the diff.

Added but not yet executed in a live owner browser session:
- `tests/dryer_table_records_static_test.py`
- `tests/dryer_table_records_ui_probe.py`

The repository has no automatic CI run attached to this draft PR. A true positive cross-project permission test requires a genuine authorised owner session. No privileged temporary owner account was created in production solely to satisfy the test. The live owner-session check remains a required pre-merge/deployment verification item.

## Rollback plan

Before merge/deployment:
- Revert or close the implementation branch/PR for UI/navigation changes.
- If the protected backend endpoint itself must be rolled back, apply a follow-up migration that revokes/drops only `public.list_authenticated_seaweed_drying_ledger(text, integer)`.
- The `http` extension may be removed only if confirmed unused by any other database object.

After an approved future merge:
- Revert the ledger page, JS and navigation commit.
- Apply a follow-up migration revoking/dropping only the new read RPC; do not modify existing dryer tables or public form RPCs.
- Because the feature is read-only and introduces no new stored dryer records, rollback requires no data migration.

## Confidence

Data-integrity confidence: high. The migration contains no dryer-data mutations and before/after source row counts are unchanged.

UX/data-fit confidence: high.

Access-control confidence: good, with one intentionally outstanding verification: a positive live call using the actual authorised owner session before merge/deployment.
