# Bati organisation and Green Space retirement — protected implementation

Date: 18 November 2026. Repository: `seaweed-harvest/seaweed-harvest.github.io`.
Base: `main@a82abb9bfa04bd4fd5a3714db528dfbf2e19f98b`.
Branch: `work/retire-bati-greenspace-20261118`. Risk: Lane C.

Approval: owner message, **"approved to proceed with bati organisation and greenspace"** after reviewing draft plan PR #169. This approves the implementation and its scoped irreversible-deletion plan, **not merging/deploying**. A separate human release approval is still required under `AGENTS.md`.

## Scope

- Remove dedicated Green Space frontend pages, public app route, login special case, user role/capability controls, feedback routing and backup presentation labels.
- Remove the BATI **organisation** from the MCP organisations selector and prepare guarded data deletion. **Never delete the Bati community or Mawimbi's collection, farmer, payment or dryer records.**
- Supabase cleanup was completed live on 18 November 2026 through small, individually guarded connector operations. The old destructive script was replaced with **read-only verification** at `scripts/retire_bati_organisation_and_green_space.sql`; it must not be replayed at deployment. BATI-only test/audit/permission rows were deleted; two Green Space-only app profiles were suspended; nonprotected Green Space grants and five experiment tables' rows were cleared. The protected owner retains the historic internal permission flag because a security trigger forbids modifying protected-owner permissions.
- All 23 `green-space-photos` Storage objects were deleted using the Supabase Dashboard, followed by the empty bucket; the `green-space-log` Edge Function was deleted in the Dashboard. No Storage metadata was directly deleted through SQL.
- Leave the separate navigation-benching PR #168 in its own scope. It contains Notifications/Tags/SMS shortcuts and Project Summary improvements. Retire no Mawimbi operational email, COSME nursery function or Sandbox ledger.
- Remove remaining experimental SMS/notification, tag and form-builder choices from user/organisation permissions and SMS receipt choices from My Details. Leave email receipt choices and stored phone/notification values intact. The live read-only check found all 267 farmers have `receipt_delivery_preference = 'none'`; no existing SMS preference requires migration. Weekly/monthly and daily operational email reporting remain unchanged.

## Verification and rollback

Run focused static and syntax tests, desktop/mobile UI checks, negative route and permission checks. Post-deletion verification showed the BATI organisation absent, all Green Space experiment tables and bucket empty/absent, and the Edge Function absent. Preserved counts: 1,704 Sandbox ledger rows, 697 Mawimbi collections, 589 Mawimbi receipts, 24 communities, 267 farmers and 3 COSME memberships. The frontend can be reverted; completed live database/Storage deletions cannot be rolled back without a provider recovery point. No new archive was made per owner instruction.

**Release status:** Live BATI and Green Space data/Storage/function retirement complete. The protected frontend and navigation code remain in draft PRs #170 and #168, respectively. **Neither PR has been merged or deployed.** A separate human approval and required UI/permission test evidence are still needed before code release. Full-suite failures reproduce on the original base branch; focused retirement checks pass. Browser probes remain blocked in this runner, and the two PRs overlap on shared navigation/service-worker paths.

## Owner-approved combined release — 18 November 2026

The owner responded **"i approve"** to the explicit request to **prepare, merge and publish PRs #168 and #170, subject to final checks passing**. This is the required separate human release approval (Lane C). The combined release branch is `work/handover-combined-release-20261118`, integrating PR #170 and PR #168 against the same recorded `main@a82abb9` base. Overlaps were resolved deliberately in `service-worker.js` (new `v189-handover-release` cache) and `tests/organisation_permissions_static_test.py`; the operational COSME nursery, Mawimbi and Bati farming code was retained.

Pre-release evidence: focused Python navigation, permission, Reef Nursery, retirement and Form Manager tests pass (26 tests; 2 skips for absent source); 15 focused Node tests pass; changed JavaScript syntax and whitespace checks pass. A new executable synthetic DOM interaction probe exercises the shared menu at desktop/phone widths in COSME, Mawimbi and Sandbox (6 contexts), including the mobile menu toggle. The original Chromium probe remains unavailable due the execution runner's socket restriction; a post-publication Chrome smoke test is required. Full-suite existing failures match the unchanged base (Python 8; Node 14 after the two navigation fixes, compared with 16 at base), and are not counted as newly passing.

Rollback: revert the combined frontend release to the known prior GitHub Pages commit. This does **not** restore the separately approved and completed provider-side deletions. Do not execute the read-only post-retirement SQL as a migration or attempt to recreate Green Space storage or the Edge Function as part of rollback.

## Follow-up: leftover backup label — 19 November 2026

The owner identified a remaining Green Space name on the live Backups page and explicitly requested removal from every Seaweed Harvest page. Read-only inspection confirmed the retired app pages and links were already absent from the deployed GitHub Pages repository; the remaining label was returned dynamically from `public.ag_aggregators.organisation_name` for the `SANDBOX` organisation. It still holds the 1,704 historical ledger transcriptions that the retirement scope protects.

The live Cascadia Supabase row `f207d31e-0b35-4f21-b405-2588d2347b7f` was updated with an exact-match guard from `Green Space Project Sandbox` to `Sandbox`. The organisation UUID, code, membership and all historical ledger records were left unchanged. Rollback, if needed, is a guarded update of that same row's `organisation_name` to its former text. No record deletion or new schema migration is involved.

Source follow-up: `work/finish-green-space-retirement-20261119` from `main@4a85e59eb1abad71f3a9e54c7de0c56ea976ac82` removes the unused `green-space-log` function configuration and adds a retirement regression check. Verify with the focused retirement test and a source scan; no new frontend asset or cache revision is needed. As required by this repository's release policy, this follow-up must be reviewed before merge; the live database naming fix is already complete.

Owner follow-up on 19 November: the retained internal Sandbox organisation must not be mentioned anywhere on the Backups page, even under its neutral name. The archive UI now omits its checkbox and its named summary row by immutable UUID. The **full archive still contains all 1,704 historical ledger records** and keeps the existing total, photo inventory and export scope intact; the selected COSME/Mawimbi scopes are unchanged. The checkbox is labelled "Full archive (all records)" to make that coverage explicit. A focused UI regression test verifies both invisible labels and unchanged all-records scope. Rollback is the frontend PR revert; no additional database operation is needed.
