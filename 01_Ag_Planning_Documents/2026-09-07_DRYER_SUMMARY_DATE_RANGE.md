# Dryer record summary date range

Owner request (7 September 2026): show the loading-to-unloading date range in each drying-event summary once unloading is recorded, instead of only its loading timestamp.

- Repository: `seaweed-harvest/seaweed-harvest.github.io`.
- Base: `main` at `5430ad4688fc03c3c516b73dc47276144e2bcfea`.
- Branch: `feature/dryer-record-summary-date-range-20260907`.
- Pull request: #50.
- Scope: owner-directed presentation change and expressly approved production release.
- The active ledger and its tests exist here but are absent from `bosunjm-cloud/Seaweed_Harvest` main at `4b89bfec557f974953eda8793ea16f5492845b0d`; this patches the actual implementation without importing unrelated ledger work.

## Behaviour

Use the earliest valid loading timestamp and latest valid unloading timestamp in each event, formatted as dates in Africa/Nairobi. Keep the existing timestamp-only heading where no valid loading/unloading range exists. Partial unloading retains existing drying/complete counts. Table/load-date grouping, individual row timestamps, weights, photos, sorting and access controls are unchanged.

Changed paths: this note, `assets/js/dryer_table_records.js`, `dryer_table_records.html`, `tests/dryer_summary_date_range_test.py`, and `tests/dryer_summary_date_range_ui_probe.py`. Runtime behaviour is 17 added JavaScript lines; the page script query version changes from v3 to v4. No dependency, database, payment, permission, workflow or service-worker changes.

## Verification

The implementation-stage evidence recorded JavaScript syntax passing, 12 deterministic regression tests passing, and the actual renderer's Chromium component probe passing at 1440px and 390px. Those browser checks use synthetic records; they are not an authenticated live-site session or a full layout audit.

At release preparation the JavaScript blob remains exactly `a575f53989883de14ac624e9550b5b6f98725a13`, unchanged from that tested implementation. A fresh local smoke check of its date-label functions passed 12 date cases plus table/load-date grouping in each of Australia/Perth, Pacific/Honolulu and UTC. The inspected HTML diff changes only the dryer records script query version.

The existing service worker uses network-first handling for both navigation and same-origin assets. The new v4 script URL refreshes the browser's script cache on an online page reload without changing shared cache policy, application data or offline storage. Existing path-filtered PR workflows do not cover these dryer files; do not describe the focused checks as full repository CI.

## Release authority and rollback

The owner explicitly approved merge and live deployment in this conversation: "please merge and deploy live". Proceed with an expected-head squash merge and verify the resulting GitHub Pages deployment. Record the merge/deployment outcome on PR #50.

Rollback: revert this isolated presentation and script-version change; no data rollback is needed.
