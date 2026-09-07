# Dryer record summary date range

Owner request (7 September 2026): show the loading-to-unloading date range in each drying-event summary once unloading is recorded, instead of only its loading timestamp.

- Repository: `seaweed-harvest/seaweed-harvest.github.io`.
- Base: `main` at `5430ad4688fc03c3c516b73dc47276144e2bcfea`.
- Branch: `feature/dryer-record-summary-date-range-20260907`.
- Scope: presentation-only, low-risk Lane A candidate; manual owner-directed request, not a Supabase suggestion dispatch.
- The active ledger and its tests exist in this repository but are absent from `bosunjm-cloud/Seaweed_Harvest` main at `4b89bfec557f974953eda8793ea16f5492845b0d`. Patch the existing implementation here rather than introducing the whole ledger into the other repository.

## Acceptance and verification

Use the earliest valid loading timestamp and latest valid unloading timestamp in each event, formatted as dates in Africa/Nairobi. Keep the existing timestamp-only heading where no valid loading/unloading range exists. Partial unloading must retain the existing drying/complete counts. Table/load-date grouping, individual row timestamps, weights, photos, sorting and access controls are unchanged.

Changed paths: this note, `assets/js/dryer_table_records.js`, `tests/dryer_summary_date_range_test.py`, and `tests/dryer_summary_date_range_ui_probe.py`. Runtime change is 17 added lines. No new dependency, database mutation, payment change or permission change is required.

## Verification results

- `node --input-type=module --check < assets/js/dryer_table_records.js`: passed.
- `python -m unittest discover -s tests -p 'dryer_summary_date_range_test.py' -v`: 12 tests passed. Covers completed, partial, missing, invalid and same-day dates; earliest/latest selection; mixed-offset chronology; Nairobi dates regardless of host timezone; unchanged grouping, ordering, row timestamps, weights and photo summary.
- `python tests/dryer_summary_date_range_ui_probe.py`: passed in Chromium at 1440px and 390px using synthetic rows and the actual renderer. Verified heading, summary totals, pointer expansion, keyboard collapse and event-photo title/click routing. No browser errors. This is a component browser fixture, not an authenticated live-site test or a full layout audit.
- The tested runtime file matches committed blob `a575f53989883de14ac624e9550b5b6f98725a13` byte-for-byte. Original materialisation also matched the base blob before editing.
- Existing static loading-timestamp fallback assertions remain intact. Full repository checks are left to the existing PR workflows; this local environment contains only the scoped files.

## Release gate

Implementation and focused verification are complete. Confidence: high; both timestamps already exist in the loaded ledger data.

Merge/deployment are not authorised by this implementation request. Keep a draft PR and seek explicit approval before changing main or the live site. An approved release must account for the existing cached page asset. No service-worker or deployment configuration was changed in this preparation.

Rollback: revert only this isolated presentation change; no data rollback is needed.
