# Software handover — navigation cleanup (18 November 2026)

## Request and scope

The owner requested a cleaner Seaweed Harvest handover interface across COSME,
Mawimbi and Sandbox. The immediate, reversible scope is to remove experimental
or unused shortcuts from the shared sidebar, retain operational tools, and give
the COSME project workspace one clear entry point. This is a direct owner
request; it does not activate suggestion automation.

Repository: `seaweed-harvest/seaweed-harvest.github.io`.
Base: `main@a82abb9bfa04bd4fd5a3714db528dfbf2e19f98b`.
Branch: `work/handover-navigation-cleanup-20261118`.
Risk: Lane B — shared `assets/js/app_navigation.js`; implementation then
separate owner approval for merge/deployment. No protected-path changes.

## Acceptance checks

- Sandbox retains the Ledger Transcriptions record shortcut; the Green Space
  form link is removed from desktop and mobile shared navigation.
- Tools hides Finance Review, Form Manager, Form Builder, SMS Settings,
  Notifications and Tags.
  Existing pages, databases, jobs, permissions and stored records are not
  changed in this navigation-only release.
- Dataset Dashboard, Backups, Mawimbi Process Flow, Receipts,
  Suggestions and Pricing Matrix retain their previous permission and
  organisation gates until their operational scope is agreed.
- A metrics-authorised user sees exactly one `Project Summary` shortcut to
  the existing COSME metrics page; the Project Journal tab and its records
  remain available *inside* that page.
- Title and page heading match `Project Summary`; its internal Metrics Register
  heading remains unchanged.
- Desktop/mobile navigation and COSME/Mawimbi/Sandbox contexts have focused
  regression checks. No new privileged access is introduced.

## Assessment and exclusions

- Green Space still has eight log rows, 27 reflections and three photo metadata
  rows in the Harvest database. A verified independent archive / migration
  check and explicit retirement plan are required before deleting data,
  removing routes or Edge Functions, or changing Sandbox capability rules.
- Bati has no rows in the sampled operational collections/processing tables,
  but retains two memberships (one active), 24 community relationships and
  three farmer relationships. Removing or deactivating an organisation touches
  the tenant boundary (Lane C), so that is **not** included in this UI branch.
- Tags has 30 reserved IDs and no recorded printing; Notifications has 644
  suppressed SMS requests. On 18 November the owner expressly decided to
  bench both navigation entries, retaining their underlying data and code
  pending separately approved protected cleanup.
- Do not retire Mawimbi's independent daily/weekly/monthly summary emails,
  current backup paths or active process/collection forms.

## Test plan and rollback

- JavaScript syntax and deterministic navigation tests; existing relevant
  organisation, form and COSME metrics tests.
- Synthetic desktop/mobile menu probe if the browser test harness is available.
- Review diff for scope creep and protected paths; keep PR draft until a separate
  owner release approval and required checks pass.
- Rollback is to revert the frontend commit (or redeploy the previous known
  working revision). No database rollback is needed: this stage does not write
  any database, account, storage or provider configuration.

## Implementation and review

Changed shared navigation, the COSME page title/heading and the service-worker
cache revision. Updated three existing navigation/form tests and added a focused
navigation contract test. Added a synthetic Chromium UI probe for six
organisation/viewport combinations, but the local browser launch was blocked
by the execution environment's socket restriction. Do not claim that probe as
passed. There were no production SQL, storage, account or service writes.

Passed: JavaScript syntax checks; seven focused Node tests; five Form Manager
tests (one source-omission skip); five public nursery navigation tests; `git diff
--check`. The older `organisation_permissions_static_test.py` still has an
unrelated baseline error (`self.admin_users` was never initialised), and the
older Journal contract test has a baseline assertion about a stale revision
parameter. Neither was changed to mask the discrepancy.

Actual touched paths: shared navigation, COSME metrics HTML, service worker,
three existing tests, two new tests and this plan. Lane B remains appropriate.

Status: implementation prepared for a draft PR; not approved for merge or live
release. Browser/UI verification remains an explicit release gate.

Follow-up (18 November): owner authorised permanent retirement of the Bati
organisation, Green Space records/pages and experimental SMS/settings. Those
are protected tenant, privacy and backend changes and remain outside this
navigation PR until a separate reviewed plan/test/rollback gate is approved.
