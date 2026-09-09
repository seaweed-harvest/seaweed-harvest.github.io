# Platform-only user organisation access

## Request and approval
The owner requested COSME membership and Reef Nursery access for an existing Tide-only account, preserving its login and Tide access. After assessment of the locked platform-user editor, the owner explicitly replied "please do" to the scoped account correction and editor fix on 2026-09-09. This direct request is the implementation authority; no automated suggestion workflow is being enabled.

## Target and risk
- Repository: `seaweed-harvest/seaweed-harvest.github.io` (confirmed by `.automation/app-map.yml`).
- Base: `main@908f3498f1b0273b6dff7371e73d683d4818c417`.
- Branch: `fix/platform-user-organisation-access-20260909`.
- Draft pull request: **#56**.
- Lane C: roles and user permissions. Implementation approved; separate merge/deployment approval remains required.
- Read `AGENTS.md`, app map, development policy, protected paths and the Reef Nursery navigation-scope plan.

## Findings
The live account is active, has `platform_user` role, no organisation memberships, and active Tide user access without expiry. COSME already enables Reef Nursery. `configurePlatformOnlyEditor` locks the role and hides organisation/form access and Save user. The deployed admin-users update handler already allows a system administrator to update an organisation-less account to a supported organisation role; non-system administrators are rejected if the target is outside their active organisation. The protected owner currently has system_admin role.

Reef Nursery requires COSME membership, effective `form_reef_nursery`, and `can_submit_collection` (or system_admin). The least-privilege existing role is Field collector, with only Reef Nursery selected within COSME and other profile permissions off.

## Implementation
1. Enable an explicit organisation-role selection for active system administrators with user-management permission editing platform-only users. Keep application-only behaviour until a supported role is selected. Reject platform/system/unsupported roles in the conversion submit guard.
2. Reuse the existing organisation/form selectors and admin-users update operation. No authentication, RLS, Tide records, organisation-wide permissions or backend scope rules changed.
3. Preserve existing restrictions for other administrators; explain the transition and leave platform-account form selections unchecked rather than implicitly granting every enabled organisation form.
4. Keep Save application access independent. Saving organisation access does not write Tide access or reset its expiry.
5. Refresh only the user-page script URL from v13 to v14. No CSS or shared-navigation changes.

## Validation completed
- `node --check assets/js/users_page.js`: passed.
- `node --test tests/platform_user_organisation_access_test.mjs`: **8 passed**. Covers deliberate conversion, denied ordinary/inactive/missing-permission actors, owner label alone, invalid roles, return to application-only, regular/farmer state reset, Reef-only form flags, Field collector least-privilege preset and separation from the Tide writer.
- `python tests/platform_user_organisation_access_ui_probe.py`: **1440px and 390px passed**, zero page errors. Uses the actual HTML/controller with synthetic accounts and stubbed requests. Covers change listeners, missing-organisation rejection, Reef-only selection, failed-save retry, application expiry preservation, state reset and rejection of an ordinary administrator even with a manipulated role control.
- The browser probe omits external styles/assets and is an interaction test, not production visual or authenticated end-to-end verification.
- Runtime JavaScript blob `d4e96aa1ab6537e575706cc0edf29bb58c9d5562`; HTML blob `cc4f9946b0584cedaab3cbc4227f650cdcf93421`; Node-test blob `bd53ccd431ffee71d59140e1fae2100999dd5238`; browser-test blob `d5079d2b28f0f5fc11138d6001bcec29ea201f76`. All match the locally tested files byte-for-byte.
- Actual PR runtime diff reviewed: JavaScript 42 additions / 7 deletions; HTML only the script version. Remaining files are this plan and the two tests. No backend, schema, authentication, Tide, policy or deployment changes.
- Full repository suite not run. No production mutation tests or login impersonation performed.

## Account apply and rollback
A guarded single-account transaction was attempted through the Supabase management connector. It was rejected at SELECT FOR UPDATE with PostgreSQL 25006: read-only transaction, before any profile, membership or audit write. No account changes were applied. Do not bypass the read-only setting. A write-enabled connection is required to apply the owner-approved correction.

Final table-only readback confirmed the original platform role, no active organisation, submission permission false, zero memberships, zero correction audit entries, and unchanged profile/Tide updated timestamps. Tide remains active User access with no expiry. An attempted read-only call to the Reef permission function was also denied by the connection, so no effective-permission execution claim is made.

When writable, lock and recheck the exact assessed profile/Tide state; update only role, COSME active organisation, submission permission and activation timestamp; insert COSME collector membership with Reef Nursery-only explicit form flags; audit the management-connector action without impersonating an application user; verify Reef access, negative form/permission checks and byte-for-byte unchanged application-access rows in one transaction. Abort on any failed condition.

Rollback: revert the editor release. For the one-account change only, use its private audit snapshot to restore touched profile fields and remove/deactivate only the newly added COSME membership after checking for subsequent changes. Never reset the login or Tide access. No production rollback is currently needed because the write was rejected.

## Status and release gate
Editor implementation and focused local validation complete in draft PR #56. **Not merged or deployed. The live account correction is still blocked by the read-only Supabase connection and has not been applied.** Owner release approval and applicable release checks are required before merge/deployment. After release, verify through an authorised administrator session; no new backend deployment is required for this UI change.
