# Production connection recovery — 29 October 2026

## Request, authority and scope

The user directly requested urgent diagnosis, a safe targeted fix, tests, deployment
and production verification for the nursery page, sign-in and password-reset
"Failed to fetch" failures. This direct request authorizes this incident work and
deployment; it is not an automated suggestion. Preserve every user, role,
permission, record and unsynced offline entry. Never reset passwords.

Production repository: `seaweed-harvest/seaweed-harvest.github.io`, branch `main`,
base `0d153728f179df97c989d91c58a0ad7d97854b74`.
Implementation branch: `fix/production-fetch-20261029`.
Source repository: `bosunjm-cloud/Seaweed_Harvest`, branch `main`,
base `a8d81c4359dfa28df8d5d1bc12acecfe2614caa3`.
Only the incident patch will be carried between these divergent repositories.

Risk: Lane C because login/recovery error presentation is protected. The direct
human instruction authorizes this scope. Do not edit automation controls, auth
client/session logic, backend configuration, database or permission code.

## Findings

- Production serves the expected project URL and public anon key. GitHub Pages
  deployment of the production base succeeded. Cloudflare DNS is unproxied and
  there are no Worker routes.
- Supabase is ACTIVE_HEALTHY. Production logs show successful mobile requests
  and successful CORS preflights; users are still submitting records.
- Both the user's existing Chrome tab and a fresh Chrome tab show the failure.
  The SDK reports an AuthRetryableFetchError during session refresh.
- Non-browser TCP connections from this PC time out to both public Supabase
  addresses. Local DNS and Google public DNS agree. This failure precedes HTTP,
  CORS, API-key validation and account permissions.
- The user confirms the page works on their phone using mobile data.
- The PC has address 192.168.3.213/24 and two equal-cost Wi-Fi default gateways,
  192.168.2.254 and 192.168.3.254. Windows selects 192.168.2.254 for both Supabase
  addresses. This is a routing concern, not yet proven as the sole cause.
  This process has no administrator privileges. A PC hotspot test was requested.
- The nursery startup error leaves "Opening form…" visible and has no retry.
  Sign-in can label transport failures as credential errors.

## Implementation and acceptance

1. Add a pure connection-error formatter and an abortable deadline for startup
   reads. Never replay writes or alter session storage.
2. Bound the nursery workspace-context read, replace the stale loading message
   after failure, and offer a retry only before the form has been initialized.
3. Explain transport failures accurately on sign-in/recovery screens. Existing
   credential, permission and server errors keep their current handling.
4. Precache the helper using the existing app-shell cache name. Do not introduce
   any cache purge, IndexedDB deletion, sign-out or offline-store operation.
5. Advance the three page module URLs so the release is reviewable on production.

Expected paths: `assets/js/connection_status.js`, nursery startup module,
login/recovery presentation modules and their HTML entrypoints, `service-worker.js`,
focused deterministic tests, and this incident document.

## Test and rollback plan

- JavaScript syntax checks, deterministic error/deadline/retry tests with synthetic
  data, positive and negative access-gate checks, and existing relevant contracts.
- Browser verification of failure presentation, retry, public workspace opening
  and authenticated access when the network permits. Do not submit records or
  password resets. Verify production assets and Pages deployment.
- Verify auth client/config/offline storage/sync and database policy fingerprints
  remain unchanged. Baseline: 16 auth users, 80 policies, policy fingerprint
  `5fb13903e7db2c9fb85c827f19a6c44d`.
- Revert the incident commit(s) to roll back presentation. No database rollback
  or offline-data deletion is needed. Do not change PC routes without a safe
  administrator-supported recovery path.

## Limits

The presentation patch cannot repair an unavailable network path. A successful
PC end-to-end check remains dependent on restoring connectivity. DNS replacement,
new API proxies, password resets and permission changes are not proposed fixes.

## Pre-deployment evidence

- All five changed JavaScript files pass syntax checks; the diff passes whitespace
  validation. All 142 app-shell assets exist, including the new helper.
- 13 focused behavioral tests pass: transport classification, server-error
  preservation, read timeout/abort, no replay, late-result suppression, recovery,
  concurrent-click protection, access denial, unsaved-form preservation and mocked
  reset failure. No real credentials or password resets are used.
- 15 existing nursery/application-access assertions and five existing nursery
  feature test programs pass. Five navigation tests pass using LF-normalized
  test input; the old VM fixture does not strip Windows CRLF imports correctly.
- The older `test_platform_user_defaults_to_tide_when_granted` already fails on
  the exact untouched production base. Its expected Tide routing contradicts
  existing production behavior. Login routing is outside this incident scope;
  the patch changes error presentation only. This pre-existing failure is
  recorded rather than changing access behavior to satisfy a stale assertion.
- Chrome against the local patched app shows "Connection unavailable" and the
  retry control after a stalled read. Clicking retry starts a fresh startup read.
- A read-only database call confirms the public nursery workspace is allowed.
- `auth_client.js`, configuration, offline storage/sync, navigation, Supabase,
  automation controls and workflows are byte-for-byte unchanged by the patch.

## Network isolation and release-check repair

The user confirmed the same PC works after connecting to their phone hotspot.
The PC now has a single default gateway (172.20.10.1). Auth health/settings, login
and recovery OPTIONS preflights, and the public workspace RPC all return HTTP 200
with valid CORS responses for the production origin. The workspace returns ten
sites. Chrome opens the patched local public form and the existing signed-in
production form successfully. No authentication credential was entered or reset.

This confirms the incident follows the original Wi-Fi path. Competing original
gateways are a concrete configuration defect to investigate; the precise router
or ISP fault has not been proven. The hotspot restores service without changing
accounts, application permissions or PC security settings.

Production PR #117 initially passed four application checks. Its two payment
browser checks failed before executing tests because Playwright 1.56 does not
support the new `ubuntu-latest` image (Ubuntu 26.04). Pin only those two existing
jobs to `ubuntu-24.04`, supported by the installed browser-test package. This is a
necessary release-check environment repair under the user's requested tests and
deployment scope. Job permissions, triggers, credentials and tests are unchanged.
This supersedes the earlier prediction that workflows would remain untouched.
The source repository does not contain these two production-only jobs.
