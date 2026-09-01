# Dryer Shed No-Configuration Submission Fix

Date: 2026-09-01
Status: implementation verified on draft branch; protected migration applied; merge/deployment approval pending
Target application: Seaweed Harvest / COSME Dryer Table
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Base branch: `main`
Exact base commit: `b6c589314b5fb5fb40a361ffda93235923199913`
Implementation branch: `fix/dryer-shed-no-configuration-20260901`
Draft pull request: `#28`

## Authoritative request

Manual owner-directed request in ChatGPT on 2026-09-01 after the live Dryer Table form returned `400 Dryer location is invalid` when `Dryer Shed` was selected.

The user requested:
- Dryer Shed has no cover/back drying configuration.
- Selecting Dryer Shed should default the configuration to no configuration.
- Fix the submission error.
- Push to production after verification.

The protected implementation/test/rollback plan was explicitly approved with `approved` on 2026-09-01. This approval authorised the protected Supabase migration and implementation described here. Repository policy still requires a separate human approval after the tested diff is shown before merge/deployment.

## Root cause confirmed

The browser already exposed `bati-dryer-shed`, and the client config mapped it to station `ST-0102` with one bay. The production `submit_seaweed_drying_observation(jsonb,text)` function did not include that location in its accepted location map, so it raised `Dryer location is invalid`.

The database also constrained `drying_configuration` to the three cover/back configurations. Therefore merely clearing or disabling the browser configuration field would have caused a second backend validation failure.

Pre-migration production evidence:
- submissions: 8
- bay records: 49
- wet weight stored: 568,999.96 g

## Implemented scope

1. Updated the existing Dryer Table bootstrap only to provide a Dryer Shed-specific configuration state:
   - dynamically adds a `No configuration` option with value `no_configuration`;
   - selects and disables it whenever `bati-dryer-shed` is selected;
   - restores the normal required configuration selector when a dryer table is selected;
   - keeps the behaviour correct after draft restore, programmatic saved-record hydration and form reset;
   - provides the corresponding Kiswahili label `Hakuna mpangilio`.
2. Added and applied one protected Supabase migration that:
   - permits stored `no_configuration` values;
   - adds `bati-dryer-shed` -> `ST-0102` / `Dryer Shed` to the existing submission function;
   - requires `no_configuration` for Dryer Shed;
   - rejects `no_configuration` for ordinary dryer tables;
   - otherwise preserves the existing submission logic.
3. Added focused deterministic static coverage and a browser interaction probe.
4. Did not change dryer table layout, navigation, payment logic, records ledger, photo behaviour, offline store, service worker or unrelated code.

## Risk classification

Overall lane: **C — protected backend change**.

Reasons:
- `supabase/**` migration is protected.
- The production submission function and a database check constraint are changed.
- User explicitly approved the protected implementation before coding.
- The actual diff exceeds Lane A changed-line limits because the protected submission function is intentionally reproduced in the migration.

## Actual changed paths

- `01_Ag_Planning_Documents/2026-09-01_DRYER_SHED_NO_CONFIGURATION_FIX.md`
- `assets/js/dryer_table_bootstrap.js`
- `supabase/migrations/20260901195500_dryer_shed_no_configuration.sql`
- `tests/dryer_table_static_test.py`
- `tests/dryer_table_shed_ui_probe.py`

No service-worker, offline-store, photo-upload, navigation, records-ledger, payment or Dryer Table submission-module path is present in the actual diff.

## Acceptance checks

1. Selecting Dryer Shed visibly shows `No configuration` and the configuration selector cannot be changed.
2. Switching from Dryer Shed back to a normal table clears `No configuration`, re-enables the selector and requires one of the three existing configurations.
3. Dryer Shed submissions are accepted by the backend with `dryer_location_code = bati-dryer-shed`, `table_location = Dryer Shed`, station `ST-0102`, one bay and `drying_configuration = no_configuration`.
4. Dryer Shed submissions using a cover/back configuration are rejected.
5. Normal dryer-table submissions using `no_configuration` are rejected.
6. Existing normal configurations continue to be accepted.
7. Existing dryer submission and bay records are unchanged by the migration.
8. No service-worker, offline-store, photo-upload, navigation or records-ledger paths are changed.

## Verification evidence — 2026-09-01

Completed:
- Exact branch base rechecked immediately before the draft PR: `main` remains `b6c589314b5fb5fb40a361ffda93235923199913`; branch is not behind main.
- Approved migration `dryer_shed_no_configuration` applied successfully to production dryer-data project `iyoihlwtvdshtlzjdoed`.
- Source data immediately before migration: 8 submissions, 49 bay records, 568,999.96 g stored wet weight.
- Source data immediately after migration and all rolled-back probes: 8 submissions, 49 bay records, 568,999.96 g stored wet weight.
- The updated database constraint contains the three existing configurations plus `no_configuration`.
- Transactional live positive probe: Dryer Shed + `no_configuration` succeeded, returned a one-bay in-progress receipt, then rolled back.
- Transactional live positive probe: Bati Table 1 + `cover_open_back_open` succeeded, then rolled back.
- Transactional live negative probe: Dryer Shed + `cover_open_back_open` was rejected with `Dryer Shed must use no configuration`.
- Transactional live negative probe: normal table + `no_configuration` was rejected with `Drying configuration is invalid`.
- Transactional live `anon` role probe: a valid Dryer Shed + `no_configuration` payload succeeded, then rolled back, confirming the existing public-form execution path remains usable.
- JavaScript syntax check passed for the exact branch version of `assets/js/dryer_table_bootstrap.js`.
- Browser interaction probe passed against the exact Dryer Shed helper source for:
  - selecting Dryer Shed;
  - automatic `No configuration` value;
  - disabled configuration selector;
  - switching back to a normal table;
  - programmatic location assignment used by saved-record hydration;
  - form reset; and
  - English/Kiswahili label switching.
- Deterministic source-contract assertions were added to `tests/dryer_table_static_test.py`.
- Actual branch diff inspected: exactly the five planned paths listed above.
- Draft PR `#28` opened against unchanged `main`.

## Rollback plan

Before merge/deployment:
- Close/revert the implementation branch for browser/test changes.
- If the database change must be rolled back, apply a follow-up protected migration that restores the prior three-value drying-configuration constraint and prior submission-function definition. Because the migration does not rewrite existing records, no source-data rollback is required provided no Dryer Shed record has been created after the new backend went live.

After merge/deployment:
- Revert the browser/bootstrap commit.
- Apply the same follow-up backend rollback only after confirming no stored Dryer Shed records use `no_configuration`; if such records exist, preserve them and use a compatibility rollback rather than deleting or rewriting data.

## Merge/deployment gate

Do not merge this branch or deploy the browser change until:
- actual diff remains limited to the five recorded paths;
- branch remains based on current `main` or is safely refreshed;
- the user gives separate post-implementation approval to merge/deploy.

All implementation and verification gates before that final human approval are now satisfied.
