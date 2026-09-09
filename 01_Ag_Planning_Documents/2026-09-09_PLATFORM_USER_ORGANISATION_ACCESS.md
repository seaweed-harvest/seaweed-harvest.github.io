# Platform-only user organisation access

## Request and approval
The owner requested COSME membership and Reef Nursery access for an existing Tide-only account, preserving its login and Tide access. After assessment of the locked platform-user editor, the owner explicitly replied "please do" to the scoped account correction and editor fix on 2026-09-09. This direct request is the implementation authority; no automated suggestion workflow is being enabled.

## Target and risk
- Repository: `seaweed-harvest/seaweed-harvest.github.io` (confirmed by `.automation/app-map.yml`).
- Base: `main@908f3498f1b0273b6dff7371e73d683d4818c417`.
- Branch: `fix/platform-user-organisation-access-20260909`.
- Lane C: roles and user permissions. Implementation approved; separate merge/deployment approval remains required.
- Read `AGENTS.md`, app map, development policy, protected paths and the Reef Nursery navigation-scope plan.

## Findings
The live account is active, has `platform_user` role, no organisation memberships, and active Tide user access without expiry. COSME already enables Reef Nursery. `configurePlatformOnlyEditor` locks the role and hides organisation/form access and Save user. The deployed admin-users update handler already allows a system administrator to update an organisation-less account to a supported organisation role; non-system administrators are rejected if the target is outside their active organisation. The protected owner currently has system_admin role.

Reef Nursery requires COSME membership, effective `form_reef_nursery`, and `can_submit_collection` (or system_admin). The least-privilege existing role is Field collector, with only Reef Nursery selected within COSME and other profile permissions off.

## Implementation plan
1. Enable an explicit organisation-role selection for system administrators editing platform-only users. Keep application-only behaviour until a supported role is selected.
2. Reuse the existing organisation/form selectors and admin-users update operation. Do not change authentication, RLS, Tide records, organisation-wide permissions or backend scope rules.
3. Preserve existing restrictions for other administrators; explain the transition and leave new form selections unchecked rather than implicitly granting every enabled organisation form.
4. Keep Save application access independent. Saving organisation access must not write Tide access or reset its expiry.
5. Bump only the user-page script URL for release cache refresh.

## Acceptance and test plan
- Platform-only editor remains application-only on opening; system administrator can deliberately select a supported organisation role.
- Organisation and form controls appear after role selection and disappear if returned to platform-only; ordinary users/admins cannot unlock the transition.
- New organisation form access defaults off; selecting only Reef Nursery does not select Dryer or another form.
- Existing regular-user and farmer editor behaviour remains intact, including disabled-state reset between users.
- Missing organisation / unsupported platform role cannot submit; saves retain existing permission and scope validation.
- Synthetic Node/UI tests, JavaScript syntax, exact diff review and relevant regression checks. No production mutation tests or login impersonation.

## Account apply and rollback
A guarded single-account transaction was attempted through the Supabase management connector. It was rejected at SELECT FOR UPDATE with PostgreSQL 25006: read-only transaction, before any profile, membership or audit write. No account changes were applied. Do not bypass the read-only setting. A write-enabled connection is required to apply the owner-approved correction.

When writable, lock and recheck the exact assessed profile/Tide state; update only role, COSME active organisation, submission permission and activation timestamp; insert COSME collector membership with Reef Nursery-only explicit form flags; audit the management-connector action without impersonating an application user; verify Reef access, negative form/permission checks and byte-for-byte unchanged application-access rows in one transaction. Abort on any failed condition.

Rollback: revert the editor release. For the one-account change only, use its private audit snapshot to restore touched profile fields and remove/deactivate only the newly added COSME membership after checking for subsequent changes. Never reset the login or Tide access. No production rollback is currently needed because the write was rejected.

## Status
Implementation in progress. Account correction blocked by read-only Supabase connection. No merge, deployment or schema change authorised/applied in this branch.
