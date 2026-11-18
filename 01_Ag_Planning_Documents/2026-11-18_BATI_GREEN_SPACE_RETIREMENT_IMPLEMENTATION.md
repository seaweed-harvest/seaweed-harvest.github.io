# Bati organisation and Green Space retirement — protected implementation

Date: 18 November 2026. Repository: `seaweed-harvest/seaweed-harvest.github.io`.
Base: `main@a82abb9bfa04bd4fd5a3714db528dfbf2e19f98b`.
Branch: `work/retire-bati-greenspace-20261118`. Risk: Lane C.

Approval: owner message, **"approved to proceed with bati organisation and greenspace"** after reviewing draft plan PR #169. This approves the implementation and its scoped irreversible-deletion plan, **not merging/deploying**. A separate human release approval is still required under `AGENTS.md`.

## Scope

- Remove dedicated Green Space frontend pages, public app route, login special case, user role/capability controls, feedback routing and backup presentation labels.
- Remove the BATI **organisation** from the MCP organisations selector and prepare guarded data deletion. **Never delete the Bati community or Mawimbi's collection, farmer, payment or dryer records.**
- Supabase data release script: `scripts/retire_bati_organisation_and_green_space.sql`. Refuse to execute unless exact audited counts, shared-link checks, COSME re-assignment and operational-record preservation hold. Delete only BATI-scoped test/audit/permission records, suspend two Green Space-only app profiles, revoke nonprotected Green Space grants, remove five Green Space tables' data, and preserve the 1,704 historical ledger rows. The protected owner retains the historic internal permission flag because a security trigger forbids modifying protected-owner permissions.
- Treat 23 `green-space-photos` Storage objects and the active `green-space-log` Edge Function as explicit **release blockers**: confirm safe provider-side removal, then remove via supported Storage and function management operations; never delete `storage.objects` directly in SQL.
- Leave the separate navigation-benching PR #168 in its own scope. It contains Notifications/Tags/SMS shortcuts and Project Summary improvements. Retire no Mawimbi operational email, COSME nursery function or Sandbox ledger.

## Verification and rollback

Run focused static and syntax tests, desktop/mobile UI checks, negative route and permission checks; confirm all Bati farm and Mawimbi metrics unchanged. Live SQL must be run once in a transaction with count/FK guards. On any exception it rolls back before commit. Deployed frontend can be reverted. After commit, database/Storage deletion is irreversible unless the provider has a usable recovery point; no new archive is made per owner instruction.

**Release status:** Draft implementation; no production SQL, Storage deletion, Edge Function change, merge or deployment at this coding stage.
