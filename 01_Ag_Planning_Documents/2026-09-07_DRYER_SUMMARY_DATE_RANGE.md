# Dryer record summary date range

Owner request (7 September 2026): show the loading-to-unloading date range in each drying-event summary once unloading is recorded, instead of only its loading timestamp.

- Repository: `seaweed-harvest/seaweed-harvest.github.io`.
- Base: `main` at `5430ad4688fc03c3c516b73dc47276144e2bcfea`.
- Branch: `feature/dryer-record-summary-date-range-20260907`.
- Scope: presentation-only, low-risk Lane A candidate; manual owner-directed request, not a Supabase suggestion dispatch.
- The active ledger and its tests exist in this repository but are absent from `bosunjm-cloud/Seaweed_Harvest` main at `4b89bfec557f974953eda8793ea16f5492845b0d`. Patch the existing implementation here rather than introducing the whole ledger into the other repository.

## Acceptance and verification

Use the earliest valid loading timestamp and latest valid unloading timestamp in each event, formatted as dates in Africa/Nairobi. Keep the existing timestamp-only heading where no valid loading/unloading range exists. Partial unloading must retain the existing drying/complete counts. Table/load-date grouping, individual row timestamps, weights, photos, sorting and access controls are unchanged.

Predicted changed paths: this note, `assets/js/dryer_table_records.js`, and a focused test under `tests/`. No new dependency, database mutation, payment change or permission change is required.

Verification: JavaScript syntax; deterministic completed/partial/missing/invalid/same-day/time-zone cases; a synthetic browser check of the rendered heading and expansion. Inspect the final diff. Existing static loading-timestamp fallback checks must continue to pass.

Rollback: revert only this isolated presentation change; no data rollback is needed. Merge/deployment are not authorised by this implementation request. Keep a draft PR and seek explicit approval before changing main or the live site. A release must also account for the existing cached page asset.

Status: implementation and focused verification in progress. Confidence: high; both timestamps already exist in the loaded ledger data.
