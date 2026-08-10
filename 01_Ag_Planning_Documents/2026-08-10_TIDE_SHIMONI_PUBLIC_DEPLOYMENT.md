# Tide Shimoni Region Public Deployment

Date: 2026-08-10
Status: Approved for implementation, merge and live deployment
Risk lane: B (manual cross-repository deployment of a reviewed low-risk Tide presentation change)

## Approval and request

The user approved pushing the reviewed login and Tide Shimoni changes live with the direct instruction `please push live`. This approval was given after draft public login PR #3 and draft Tide source PR #23, their scope and their deployment boundary were presented.

## Exact repositories and revisions

- Deployment repository: `seaweed-harvest/seaweed-harvest.github.io`
- Deployment base branch: `main`
- Exact deployment base commit: `b39b77c08034af36f73a2cfdab97ef3c3952d378`
- Deployment branch: `agent/deploy-tide-shimoni-region`
- Canonical source repository: `bosunjm-cloud/Seaweed_Ag_Hub`
- Canonical source merge commit: `3fc86b5e00d684a8826ad9e4763709120df0bc35`
- Reviewed source PR: `bosunjm-cloud/Seaweed_Ag_Hub#23`
- Login deployment commit already present in the deployment base: `b39b77c08034af36f73a2cfdab97ef3c3952d378`

## Scope and predicted paths

- Publish the three changed Tide runtime files exactly from source commit `3fc86b5e`.
- Publish the focused source regression test unchanged.
- Record deployment approval, checks and rollback evidence.

Predicted changed paths:

- `tide/assets/js/tide_page.js`
- `tide/assets/js/language.js`
- `tide/index.html`
- `tide/tests/main_page_location_scope_static_test.py`
- `01_Ag_Planning_Documents/2026-08-10_TIDE_SHIMONI_PUBLIC_DEPLOYMENT.md`

No backend, location data, calibration, Supabase, map-page, service-worker, workflow, automation-policy or deployment-credential files will change.

## Acceptance checks

1. The three deployed Tide runtime files and focused test exactly match canonical source commit `3fc86b5e`.
2. The live `/tide/` dropdown and selected card show only `Shimoni Region` while retaining the `kenya-coast` key and Mombasa/KMFRI data.
3. The live map still exposes its full location/reference inventory.
4. The live login page does not show the public Collection shortcut, while sign-in/account-help controls remain available.
5. Focused tests, Tide suites, JavaScript syntax, source hashes and `git diff --check` pass before merge.
6. GitHub Pages completes successfully and live browser checks have no console errors.
7. The legacy Tide site remains available for rollback.

## Test plan

- Compare the four copied source files byte-for-byte with source commit `3fc86b5e`.
- Run the focused main-page location test and relevant public login tests.
- Run all Tide Python tests and both Tide Node suites.
- Run JavaScript syntax checks for the changed modules.
- Run `git diff --check` and inspect the complete deployment diff.
- After GitHub Pages succeeds, check the live login, Tide main page, Tide map and legacy rollback URL in a browser.

## Rollback plan

Revert the public deployment squash commit on `main`. If only the Tide presentation needs rollback, restore the four copied Tide source files from deployment commit `b39b77c0`; the login change can remain independent. The legacy Tide site and production backend remain untouched throughout this deployment.

## Confidence

High. The public runtime change is a byte-for-byte copy of the reviewed source merge and does not alter stored data, access control, the map implementation or offline service-worker logic.

## Implementation record

- Actual changed paths match the five predicted paths.
- Actual diff size: 5 files, 148 insertions and 16 deletions.
- Source integrity passed for all four copied Tide files against canonical merge commit `3fc86b5e`.
- Eight focused public login/routing/automation tests passed.
- All 25 Tide Python tests and both Tide Node suites passed.
- JavaScript syntax and `git diff --check` passed.
- No backend, location data, calibration, Supabase, map-page, service-worker, workflow, automation-policy or credential files changed.
- Approval evidence: direct user instruction `please push live` after both reviewed draft PRs and the public deployment boundary were presented.
- GitHub Pages deployment and live browser verification remain to be recorded after merge.
