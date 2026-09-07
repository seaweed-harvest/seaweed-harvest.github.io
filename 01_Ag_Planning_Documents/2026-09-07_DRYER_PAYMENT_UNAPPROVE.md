# Dryer payment Unapprove

Owner-directed scope approved 7 September 2026: retain payment by actual activity day; add Unapprove for approved, unpaid days, returning them to Needs review. This is approval to implement the specific financial control, not to change existing decisions or release to production.

Base: `738bc0ecc7c958711434ffcbb17754d90925bb05` in `seaweed-harvest/seaweed-harvest.github.io`. Branch: `fix/dryer-payment-unapprove-20260907`. Draft PR: #51. Lane C: payment controls and an additive guarded migration.

Implementation: explicit active-approval flag; preserve approval values and source snapshot; append a private audit snapshot on withdrawal. Reuse the existing COSME finance-owner guard and payment/day/row locks. Reject paid and stale-version requests; repeated withdrawals are idempotent. Existing save reactivates the approval, and payment rejects withdrawn approvals after locking the decision.

UI: Unapprove beside Update for approved/unpaid and stale unpaid approvals. Confirmation, Needs review, selection removal and recomputed due amount; retained values for reapproval. No change to phase dates, daily contract maths, transfers, allowances, credit balances, source dryer records or the public/offline form.

Changed paths: this note, `assets/js/dryer_table_payments.js`, the payment script version in `dryer_table_records.html`, `supabase/migrations/20260907073000_dryer_payment_unapprove.sql`, and the two `tests/dryer_payment_unapprove_*` files. The runtime diff was inspected in PR #51; no unrelated source changes.

## Verification completed

- JavaScript module syntax and diff whitespace passed.
- Seven new Unapprove state and migration-contract tests passed.
- Four existing payment calculation tests and twelve existing date-range tests passed.
- Existing payment component probe passed. New Chromium component probes at 1440px and 390px passed: cancel, RPC rejection, Unapprove, retained values, removed selection/due, reapproval, refresh failure after successful withdrawal, and no Unapprove/Update for paid rows. No browser errors. These use synthetic rows and stub RPCs, not a production account.
- Existing ledger static tests: 21 pass, one legacy failure. The same failure was reproduced against the unmodified base: `test_public_dryer_form_assets_are_not_replaced_by_payment_work` expects the public HTML to mention `dryer_table_form.js`, while it uses the unchanged bootstrap module. Tests were not weakened and the unrelated public form was not edited.
- Read-only PostgreSQL introspection confirmed the installed workspace, approval-save and payment function bodies match the original migration bodies by MD5; targeted patch anchors are unique.
- Committed controller blob `3a7d174fbe7e8ba1a9afe257615251144d7f558d` and HTML blob `dccf0f07708d482bacb88a92dbee0692650363b6` match the locally tested files.

## Remaining release gate

Code and component verification are prepared. The new migration/RPC has not been executed against PostgreSQL. Positive/negative database execution, stale-version/idempotency and concurrent payment/unapprove checks remain required. This local runner has no PostgreSQL binary; no live mutation test or migration was performed to work around that gap. The legacy static-test failure remains disclosed, not waived.

Keep PR #51 draft pending database validation and separate owner merge/deployment approval. Apply the guarded migration before releasing the UI, then verify the owner path without changing existing approvals. No live approval, payment, source record or balance has been changed during preparation.

Rollback after use: revert the UI or disable only the new Unapprove RPC as needed. Retain audit history and the payment rejection of withdrawn approvals; do not roll back that guard while withdrawn decisions exist. No deletion or resetting of live approvals is authorised.

Confidence: high in the scoped frontend behaviour and unchanged calculations; database execution remains unverified until the release checks above pass.
