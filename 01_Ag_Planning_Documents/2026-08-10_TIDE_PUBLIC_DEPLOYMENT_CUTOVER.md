# Tide Public Deployment Cutover

Date: 2026-08-10
Status: Approved for implementation and draft pull request; merge and deployment are not approved
Risk lane: C (protected deployment mapping, authentication routing and application-access administration)

## Request and approval

The Tide Planner runtime already merged into `bosunjm-cloud/Seaweed_Ag_Hub` is to be published under `/tide/` in `seaweed-harvest/seaweed-harvest.github.io`. The user explicitly approved updating the protected Tide deployment mapping, preparing a deployment branch and draft pull request, and running pre-deployment checks. The approval explicitly requires a separate review and approval before merge or deployment.

This is a manually approved cutover. It does not enable automatic coding, merge or deployment.

## Exact repositories and revisions

- Deployment repository: `seaweed-harvest/seaweed-harvest.github.io`
- Deployment base branch: `main`
- Exact deployment base commit: `fde6d83e84c082ad56a986649c9bbef25eeb0521`
- Implementation branch: `agent/tide-public-cutover`
- Canonical source repository: `bosunjm-cloud/Seaweed_Ag_Hub`
- Canonical source branch: `main`
- Exact canonical source commit: `3540e39f1a76e57e2363ff8f5b00738747b7554b`
- Source pull request: `bosunjm-cloud/Seaweed_Ag_Hub#22`

## Included scope

- Confirm the Tide source and public deployment repository mapping while leaving automatic deployment disabled.
- Publish the exact tracked `tide/` runtime from the canonical source commit.
- Publish the shared application-access module and the reviewed login-return routing needed by `/tide/`.
- Publish the reviewed Tide application-access controls in Admin Users.
- Add deterministic deployment, login, application-access and mapping checks.

Predicted changed paths:

- `.automation/app-map.yml`
- `01_Ag_Planning_Documents/2026-08-10_TIDE_PUBLIC_DEPLOYMENT_CUTOVER.md`
- `admin_users.html`
- `assets/css/ag.css`
- `assets/js/auth_client.js`
- `assets/js/login_page.js`
- `assets/js/platform_access.js`
- `assets/js/users_page.js`
- `tests/automation_policy_static_test.py`
- `tests/platform_application_access_static_test.py`
- `tests/platform_application_invite_static_test.py`
- `tests/platform_login_routing_static_test.py`
- `tests/tide_deployment_static_test.py`
- `tide/**`

## Excluded scope

- No Supabase schema, data, RLS, function or secret changes.
- No production database writes.
- No root service-worker, GitHub Actions or deployment-credential changes.
- No merge, GitHub Pages deployment, custom-domain change or live post-deployment probe in this approval stage.
- No redirect, archive or removal of the legacy Tide site or backend.
- No historical Tide source documents or bulk non-runtime datasets.

## Acceptance checks

1. `/tide/` contains the exact lean tracked runtime from the canonical source commit, including the printable observation form and excluding historical source directories.
2. Tide's PWA scope remains confined to `/tide/`.
3. Unauthenticated Tide routes return through the shared `/login.html` flow with a safe `tide/...` return path.
4. Tide access is resolved through the shared platform application grant and its user/operator/admin roles.
5. Admin Users exposes the reviewed Tide invitation and application-access controls only to authorised platform administrators.
6. The beta notice and the Mombasa single-source main-page configuration remain present in the deployed copy.
7. The mapping identifies `Seaweed_Ag_Hub` as Tide's canonical source and this repository as its deployment target, while all automatic deployment controls remain false.
8. Relevant Python tests, Tide Node tests, JavaScript syntax checks, credential-pattern scan and `git diff --check` pass.
9. The resulting pull request remains draft and unmerged pending separate approval.

## Test plan

- Run the deployment and application-access static tests added from the canonical source.
- Run the existing automation policy tests after updating their mapping contract.
- Run all Tide Python static/unit tests.
- Run both Tide Node test suites.
- Run `node --check` for every Tide JavaScript file and each changed shared JavaScript file.
- Compare every deployed `tide/` file hash and path against the exact canonical source commit.
- Run the full public repository Python static/unit test suite.
- Scan the actual diff for credential-like material and run `git diff --check`.

## Rollback plan

Before merge there is no live impact: close the draft pull request and delete the implementation branch. After a separately approved deployment, rollback by reverting the deployment pull request on `main`; the legacy Tide deployment and backend remain available until cohort acceptance. Do not redirect or retire the legacy site during this cutover.

## Implementation record

- Planning and approval gate recorded before application changes.
- Canonical Tide tree: `45936d0097bfb357457a95ef7554e399e30d379f` from source commit `3540e39f1a76e57e2363ff8f5b00738747b7554b`.
- Published Tide package: 62 tracked files, 919,393 bytes. Four ignored local Python cache files from the source working copy were deliberately not published.
- Actual diff: 75 files, 20,676 insertions and 30 deletions, including the 62-file Tide tree and its 95,944-byte printable observation form.
- Actual changed paths match the predicted path groups. No Supabase, root service-worker, GitHub Actions, credential or deployment-secret paths changed.
- `python tests/automation_policy_static_test.py`: passed.
- Deployment/application tests: 15 tests passed across `platform_application_access_static_test.py`, `platform_application_invite_static_test.py`, `platform_login_routing_static_test.py` and `tide_deployment_static_test.py`.
- Tide Python suite: 21 tests passed.
- Tide Node suite: 2 suites passed.
- JavaScript syntax: 24 changed/shared and Tide files passed `node --check`.
- Source integrity: every one of the 62 deployed Tide blobs matched the exact canonical source tree.
- `git diff --cached --check` and the repository credential-pattern scan passed.
- Full repository discovery was attempted: 110 tests passed and 3 skipped; one pre-existing `organisation_permissions_static_test.py` error remains because the deployment repository's base test references `self.admin_users` without defining it. The same defect exists at base commit `fde6d83` and is unrelated to this diff. The focused deployment gates are green, but this baseline test gap must remain visible during review.
- Merge/deployment approval: pending.
