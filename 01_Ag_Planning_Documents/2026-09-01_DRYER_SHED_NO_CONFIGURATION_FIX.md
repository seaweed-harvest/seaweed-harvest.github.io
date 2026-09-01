# Dryer Shed No-Configuration Submission Fix

Date: 2026-09-01
Status: approved for protected implementation; merge/deployment approval still required
Target application: Seaweed Harvest / COSME Dryer Table
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Base branch: `main`
Exact base commit: `b6c589314b5fb5fb40a361ffda93235923199913`
Implementation branch: `fix/dryer-shed-no-configuration-20260901`

## Authoritative request

Manual owner-directed request in ChatGPT on 2026-09-01 after the live Dryer Table form returned `400 Dryer location is invalid` when `Dryer Shed` was selected.

The user requested:
- Dryer Shed has no cover/back drying configuration.
- Selecting Dryer Shed should default the configuration to no configuration.
- Fix the submission error.
- Push to production after verification.

The protected implementation/test/rollback plan was explicitly approved with `approved` on 2026-09-01. This approval authorises the protected Supabase migration and implementation described here. Repository policy still requires a separate human approval after the tested diff is shown before merge/deployment.

## Root cause confirmed

The browser already exposes `bati-dryer-shed`, and the client config maps it to station `ST-0102` with one bay. The production `submit_seaweed_drying_observation(jsonb,text)` function does not include that location in its accepted location map, so it raises `Dryer location is invalid`.

The database also currently constrains `drying_configuration` to the three cover/back configurations. Therefore merely clearing or disabling the browser configuration field would cause a second backend validation failure.

Pre-migration production evidence:
- submissions: 8
- bay records: 49
- wet weight stored: 568,999.96 g

## Scope

1. Update the existing Dryer Table bootstrap only to provide a Dryer Shed-specific configuration state:
   - dynamically add a `No configuration` option with value `no_configuration`;
   - select and disable it whenever `bati-dryer-shed` is selected;
   - restore the normal required configuration selector when a dryer table is selected;
   - keep the behaviour correct after draft restore, programmatic record hydration and form reset.
2. Add one protected Supabase migration that:
   - permits stored `no_configuration` values;
   - adds `bati-dryer-shed` -> `ST-0102` / `Dryer Shed` to the existing submission function;
   - requires `no_configuration` for Dryer Shed;
   - rejects `no_configuration` for ordinary dryer tables;
   - otherwise preserves the existing submission logic.
3. Add focused deterministic static coverage and a browser interaction probe.
4. Do not change dryer table layout, navigation, payment logic, records ledger, photo behaviour, offline store, service worker or unrelated code.

## Risk classification

Overall lane: **C — protected backend change**.

Reasons:
- `supabase/**` migration is protected.
- The production submission function and a database check constraint are changed.
- User explicitly approved the protected implementation before coding.

Predicted changed paths:
- `01_Ag_Planning_Documents/2026-09-01_DRYER_SHED_NO_CONFIGURATION_FIX.md`
- `assets/js/dryer_table_bootstrap.js`
- `supabase/migrations/20260901195500_dryer_shed_no_configuration.sql`
- `tests/dryer_table_static_test.py`
- `tests/dryer_table_shed_ui_probe.py`

## Acceptance checks

1. Selecting Dryer Shed visibly shows `No configuration` and the configuration selector cannot be changed.
2. Switching from Dryer Shed back to a normal table clears `No configuration`, re-enables the selector and requires one of the three existing configurations.
3. Dryer Shed submissions are accepted by the backend with `dryer_location_code = bati-dryer-shed`, `table_location = Dryer Shed`, station `ST-0102`, one bay and `drying_configuration = no_configuration`.
4. Dryer Shed submissions using a cover/back configuration are rejected.
5. Normal dryer-table submissions using `no_configuration` are rejected.
6. Existing normal configurations continue to be accepted.
7. Existing dryer submission and bay records are unchanged by the migration.
8. No service-worker, offline-store, photo-upload, navigation or records-ledger paths are changed.

## Test plan

- JavaScript syntax check for `assets/js/dryer_table_bootstrap.js`.
- `tests/dryer_table_static_test.py` validates the UI/backend contract in source.
- `tests/dryer_table_shed_ui_probe.py` validates browser interaction for selecting Dryer Shed, switching back to a normal table, programmatic location assignment and form reset.
- Apply the approved migration to the existing dryer-data Supabase project.
- Transactional live database probes:
  - Dryer Shed + `no_configuration` succeeds then rolls back;
  - normal table + standard configuration succeeds then rolls back;
  - Dryer Shed + normal configuration is rejected;
  - normal table + `no_configuration` is rejected.
- Recheck production source row counts and wet-weight total after migration.

## Rollback plan

Before merge/deployment:
- Close/revert the implementation branch for browser/test changes.
- If the database change must be rolled back, apply a follow-up protected migration that restores the prior three-value drying-configuration constraint and prior submission-function definition. Because the migration does not rewrite existing records, no source-data rollback is required provided no Dryer Shed record has been created after the new backend goes live.

After merge/deployment:
- Revert the browser/bootstrap commit.
- Apply the same follow-up backend rollback only after confirming no stored Dryer Shed records use `no_configuration`; if such records exist, preserve them and use a compatibility rollback rather than deleting or rewriting data.

## Merge/deployment gate

Do not merge this branch or deploy the browser change until:
- focused tests pass;
- live transactional backend probes pass;
- actual diff is inspected and remains within this scope; and
- the user gives separate post-implementation approval to merge/deploy.
