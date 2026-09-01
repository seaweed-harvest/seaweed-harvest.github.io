# Dryer Table Records Ledger — Implementation Plan

Date: 2026-09-01
Status: planning complete; protected backend approval gate pending
Target application: Seaweed Harvest / COSME Dryer Table
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Base branch: `main`
Exact base commit: `2b4862564aff196105e44149a8d56d3e69a1cb1a`
Implementation branch: `work/dryer-table-records-ledger-20260901`

## Authoritative request

This is a manual owner-directed request made in ChatGPT on 2026-09-01. No matching Supabase suggestion/request table or authoritative suggestion row exists for this request. The conversation is therefore the manual request source for this branch.

The user approved moving from planning to implementation with: “okay, please proceed”. That approval covers the agreed feature scope below. Repository policy requires a separate protected-work gate before changing Supabase migrations or access-control surfaces, so the backend read endpoint remains pending explicit protected-path approval.

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

The database already contains:
- `seaweed_drying_submissions`
- `seaweed_drying_bay_records`
- `seaweed_drying_bay_summary`

`seaweed_drying_bay_summary` already supplies table location, bay number, load/unload timestamps, drying minutes, wet/dry weights, weight loss kg/%, and weather fields.

`seaweed_drying_submissions` already supplies the table-level observations and table photo paths.

The current public RPC `list_seaweed_drying_records` intentionally exposes only receipt/table/status/bay-state summary data. The detailed bay summary view has no `anon` or `authenticated` SELECT grant. Therefore the agreed ledger cannot obtain its detailed data safely through the current frontend APIs alone.

## Risk classification

Overall lane: **C — approve before protected backend coding**.

Reasons:
- A new authenticated read RPC or equivalent database access surface is required.
- Any `supabase/**` migration is Lane C under `.automation/protected-paths.yml`.
- The shared `assets/js/app_navigation.js` navigation update is Lane B.

No write, delete, payment, payout, form-submission, offline-store, service-worker or deployment behaviour is required.

## Proposed implementation

1. Add one narrow authenticated, read-only database RPC through a migration.
   - Return only the fields required for the ledger and observations.
   - Require a signed-in user.
   - Apply the same owner/COSME access expectations used by the authenticated application rather than making the detailed dataset anonymous.
   - No mutations.

2. Add `dryer_table_records.html` using the shared authenticated console/record shell.

3. Add `assets/js/dryer_table_records.js` containing page-specific query, filtering, grouping and rendering logic.

4. Reuse existing `ag.css` record-ledger classes wherever possible. Only add page-specific CSS if a small layout gap cannot be expressed through shared classes.

5. Add `Dryer Table Records` to the shared Records navigation, restricted to COSME + dryer-table capability + data-view access.

6. Leave `dryer_table.html`, `dryer_table_form.js`, dryer offline/local-storage behaviour and public dryer RPCs unchanged.

## Predicted changed paths

Expected:
- `01_Ag_Planning_Documents/2026-09-01_DRYER_TABLE_RECORDS_LEDGER.md`
- `dryer_table_records.html`
- `assets/js/dryer_table_records.js`
- `assets/js/app_navigation.js` (Lane B shared shell)
- `tests/dryer_table_records_static_test.py`
- `tests/dryer_table_records_ui_probe.py`
- `supabase/migrations/<timestamp>_authenticated_dryer_table_records.sql` (Lane C protected)

Because this prediction is seven files, the actual diff will be at least Lane B even before the protected migration is considered. The protected migration makes the overall change Lane C.

## Acceptance checks

1. Anonymous/public dryer-table workflow is unchanged.
2. `dryer_table.html` remains usable without login and offline exactly as before.
3. A signed-out user cannot access the new Dryer Table Records page.
4. The Records menu shows Dryer Table Records only for an eligible COSME authenticated profile.
5. All Records renders one row per bay cycle with Table, Bay, Status, Loaded, Wet kg, Unloaded, Dry kg, Weight loss, Drying time and Photos.
6. Load-only records display as Drying without fabricated unload values.
7. Complete records calculate/display existing database drying duration and loss values rather than recalculating authoritative values inconsistently.
8. Filters work for table, date range and status.
9. Grouping works by Table and Load date.
10. Filtered summary totals update consistently with visible records.
11. Observations are shown in a separate tab and do not clutter the main bay ledger.
12. Payment Register exists but contains no payment calculation logic.
13. No dryer submission, editing, deletion, trial schedule, photo upload or offline code path is modified.

## Test plan

Required checks:
- JavaScript syntax check for `assets/js/dryer_table_records.js` and any changed JS.
- Deterministic static test asserting route structure, three tabs, expected columns, navigation gate and no modification to dryer form script references.
- UI/browser probe for tab switching, filters, grouping, responsive horizontal table behaviour and signed-out redirect/guard.
- Database migration validation.
- Positive permission test for the intended authenticated COSME/owner path.
- Negative permission test showing anonymous access to the detailed ledger RPC is rejected.
- Regression run for existing `tests/dryer_table_static_test.py`.
- Inspect actual branch diff and reclassify before PR approval.

## Rollback plan

Before merge/deployment:
- Delete or revert the implementation branch/PR; production remains untouched.

After an approved future merge:
- Revert the ledger page, JS and navigation commit.
- Apply a follow-up migration revoking/dropping only the new read RPC; do not modify existing dryer tables or public form RPCs.
- Because the feature is read-only and introduces no new stored records, rollback requires no data migration.

## Confidence

UX/data-fit confidence: high.

Implementation confidence: high once the authenticated read RPC design is approved. The existing database already contains the required summary and observation fields; the primary implementation risk is access-control correctness, not data modelling.
