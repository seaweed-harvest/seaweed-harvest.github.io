# Remove Collection Shortcut From Sign-In

Date: 2026-08-10
Status: Implemented and awaiting draft pull-request review
Risk lane: A (presentation-only HTML change; no authentication logic or protected path changes)

## Request summary

Remove the visible `Collection form` shortcut from the shared Seaweed Harvest sign-in page. Keep the hidden offline-collection recovery link because it is shown only when an eligible offline snapshot exists.

## User problem

The public Collection shortcut is not wanted on the login/sign-in screen. Its presence makes the authentication gateway look like it offers an alternate primary route.

## Repository and revision

- Repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base branch: `main`
- Exact base commit: `712edfda2282dd6e3247d09de9f436a5e3e68321`
- Implementation branch: `agent/remove-login-collection-link`

## Scope and predicted paths

- Remove only the visible `auth-collection-link` anchor from `login.html`.
- Add a deterministic static regression test.
- Record this implementation plan and evidence.

Predicted changed paths:

- `login.html`
- `tests/login_collection_link_static_test.py`
- `01_Ag_Planning_Documents/2026-08-10_REMOVE_COLLECTION_LOGIN_LINK.md`

No JavaScript, CSS, authentication behavior, account recovery, permissions, Supabase, service worker, deployment configuration, workflow or collection-form functionality will change.

## Acceptance checks

1. The visible `Collection form` shortcut is absent from the sign-in page.
2. Sign-in, account creation and password-reset controls remain unchanged.
3. The hidden `offlineCollectionLink` remains available for the existing offline recovery flow.
4. The focused static test, relevant authentication tests and repository diff checks pass.
5. The change remains in a draft pull request until separately approved for merge/deployment.

## Test plan

- Run `tests/login_collection_link_static_test.py`.
- Run the existing first-party authentication and login-routing static tests.
- Run the repository automation-policy contract test.
- Run `git diff --check` and inspect the actual diff.

## Rollback plan

Before merge, close the draft pull request. After a separately approved merge, revert the squash commit to restore the visible shortcut. The hidden offline recovery flow is unchanged, so no data or backend rollback is required.

## Confidence

High. The requested UI is a single standalone anchor and the regression test distinguishes it from the separate hidden offline fallback.

## Implementation record

- Actual changed paths match the three predicted paths.
- Actual diff size: 3 files, 92 insertions and 2 deletions.
- `login.html` removes only the visible Collection shortcut.
- The hidden `offlineCollectionLink` and all sign-in/account controls remain unchanged.
- Eight focused login, routing and automation-policy tests passed.
- `git diff --check` passed.
- Local browser probe passed: no Collection shortcut, all primary sign-in controls visible, offline fallback present but hidden, and zero console errors.
- No JavaScript, CSS, Supabase, service-worker, workflow or deployment files changed.
- Merge and deployment remain pending separate human approval.
