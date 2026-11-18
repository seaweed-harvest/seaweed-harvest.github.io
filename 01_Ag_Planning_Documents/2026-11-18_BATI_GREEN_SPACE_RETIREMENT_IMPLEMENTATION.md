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

## Verification and rollback

Run focused static and syntax tests, desktop/mobile UI checks, negative route and permission checks. Post-deletion verification showed the BATI organisation absent, all Green Space experiment tables and bucket empty/absent, and the Edge Function absent. Preserved counts: 1,704 Sandbox ledger rows, 697 Mawimbi collections, 589 Mawimbi receipts, 24 communities, 267 farmers and 3 COSME memberships. The frontend can be reverted; completed live database/Storage deletions cannot be rolled back without a provider recovery point. No new archive was made per owner instruction.

**Release status:** Live BATI and Green Space data/Storage/function retirement complete. The protected frontend and navigation code remain in draft PRs #170 and #168, respectively. **Neither PR has been merged or deployed.** A separate human approval and required UI/permission test evidence are still needed before code release.
