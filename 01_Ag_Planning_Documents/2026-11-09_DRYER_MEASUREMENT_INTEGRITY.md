# COSME dryer measurement integrity — 9 November 2026

Status: **implemented on protected review branch; migration and merge not deployed**
Owner request: "please fix up", following investigation of overwritten dryer measurements, zero-duration cycles and questionable payment activities.

## Scope and authority
- Application/repository: Seaweed Harvest COSME Dryer, `seaweed-harvest/seaweed-harvest.github.io`.
- Base main: `e9d957682dd6839df4049825d219e5cab05bbcdd`.
- Branch: `fix/dryer-measurement-audit-validation-20261109`.
- Risk: Lane C. Affects protected Supabase migrations, research data integrity, payment approvals, and the offline-capable form.
- Owner request authorizes preparing the scoped fix. **Separate human approval and database verification are required before applying the migrations, merging or releasing.** Automation is disabled under the repository's policy.
- Historical records, payment decisions, and payment transfers must not be rewritten by this change.

## Problem
The published `submit_seaweed_drying_observation` SQL function upserts a complete bay payload over the previous row. It accepts unloading on the same timestamp as loading, and permits unchanged or increased weight while still marking the run complete. Its `updated_at` trigger stores only the latest change time; original values are not versioned. The public form also used a strict “unloading earlier than loading” test, which allowed same-time events. Payment-day calculations counted those activity rows.

Observed production issues motivating this work: one 8-bay same-time 59.1 kg loading/unloading, one 1-bay same-time 11.3 kg loading/unloading, and a 4-bay six-minute loading/unloading. An earlier confirmed duplicate reweigh was separately removed with an archive; this change is not an attempt to reconstruct that or other historical edits.

## Acceptance checks
1. Initial saved source measurements get a clearly marked **baseline** snapshot; changes after deployment preserve old and new values, time, and available request actor plus enumerator label. Audit includes submission metadata, loading/unloading bay fields, reweigh event details and reweigh bay measurements.
2. A future edited measurement never destroys the previous version; ordinary photo-only updates and incomplete drafts continue to save.
3. A run cannot be marked complete if any bay is missing data, unloads before/at loading, dries for less than 12 hours, has zero/invalid wet mass, or has no mass loss. The 12-hour cutoff is a **review threshold**, not a scientific definition of valid drying.
4. Loading can be recorded before unloading without forcing completion; unrelated reweigh increases remain preserved for review.
5. The public form shows a compact, specific validation error before submitting such an impossible full cycle; new helper is included in offline cache.
6. Owner payment approval, review creation and settlement are blocked if the day contains unresolved flags or an implausible completed bay. Existing approved/unpaid days remain unchanged until the owner re-reviews. Already settled transactions are immutable.
7. No existing measurements, approvals or payments are changed/deleted by the migration.
8. Direct unauthenticated/regular authenticated users cannot read or mutate the private revision history or flags.
9. No credentials or upload tokens are copied into the audit history.
10. The actual diff and integration tests are reviewed before separate merge/deployment permission.

## Proposed changes
- `supabase/migrations/20261109210000_cosme_dryer_measurement_revisions.sql`: append-only private baseline/revision history, four measurement tables, deferred completion checks.
- `supabase/migrations/20261109210500_cosme_dryer_payment_anomaly_guard.sql`: owner-review flags and guarded approval/review/settlement writes.
- `assets/js/dryer_cycle_integrity.js`, `assets/js/dryer_table_form.js`: shared pure validation helper and form integration.
- `assets/js/dryer_table_bootstrap.js`, `dryer_table.html`, `service-worker.js`: version refresh and offline asset.
- `tests/dryer_cycle_integrity_test.py`: synthetic cases and static controls.

## Verification
- Pure JavaScript cycle-validation cases run in a V8 isolate: valid 3-day cycle accepted; equal time, 6-minute duration and no weight loss rejected; incomplete draft accepted. All nine test cases returned expected values, including unloading without a prior loading.
- Static integration check of form imports and both save/finalization validation sites passed.
- PostgreSQL migration execution and migration-specific permission/rollback tests **not yet run**. Run against an isolated database before deployment.
- Draft PR #163 GitHub checks: frontend-contract, two verify jobs, and layout passed; validate failed on an untouched reef sample-rope assertion; browser-regression failed on an untouched dryer bulk-approval probe. Root causes remain unverified; both are blocking under the repository policy.
- Read-only proposed payment-gate impact check: three unpaid approved days (17, 29, 30 October 2026). No production decision or transaction was changed.
- Browser/device offline UI probe, positive/negative owner payment tests and service-worker regression **pending**.
- No database migration applied to the live project as part of this branch; no historic records or payment values changed.

## Test plan before release
1. Run `python -m unittest tests/dryer_cycle_integrity_test.py`, related existing dryer tests, and `node --check` against changed modules.
2. In an isolated DB, apply both migrations; exercise insert/update/reweigh/delete revisions, verify old/new states, and check that image-only updates and drafts remain possible.
3. Test four invalid completion cases and valid 3-day completion. Validate that existing invalid historical rows are not modified by migration.
4. Check invalid-day approval, PDF-review creation and paid allocations are refused; unaffected days remain payable. Check double payment is still prevented and no payment rows change after a rejected transaction.
5. Check RLS/direct grants from anon/authenticated, and verify rollback/idempotent reapply behaviour.
6. Test form online/offline capture, reconnect/sync, old record edit and photo upload on a phone-width viewport.
7. Confirm exactly which days become unpayable pending review; prepare the owner review queue before production activation.

## Rollback
- Before migration: close/revert PR with no production effects.
- After migration: disable the new deferred completion and payment-guard triggers if they block legitimate operations; preserve the append-only audit table and all archived revisions. Revert form/HTML/cache files to previously released versions if necessary.
- No deletion or editing of historical measurement versions as a rollback shortcut.
- Only apply migrations after a pre-release backup and verification that the branch matches the intended COSME source project.

## Known limitations
- Existing overwritten values cannot be reconstructed merely by installing version history. The baseline is the **current** data at migration time.
- The request actor may be unavailable for a public/offline form using an anonymous database connection; the form's enumerator name is preserved as a label but is not a cryptographically verified identity.
- The 12-hour threshold is intentionally conservative for data quality; any legitimate special-case drying cycle needs an explicit review/exception workflow rather than a fabricated replacement weight.
- This initial payment gate pauses the **whole activity day** if an affected submission has unresolved issues; the owner will need a deliberate partial-activity exclusion/waiver policy if that is required.

## Approval gate
This is protected Lane C work under `AGENTS.md` and `.automation/development-policy.yml`. **Do not merge or deploy until the owner separately approves the final diff and checks.**
