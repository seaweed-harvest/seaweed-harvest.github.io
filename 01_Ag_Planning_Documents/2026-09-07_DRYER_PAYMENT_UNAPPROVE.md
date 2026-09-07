# Dryer payment Unapprove

Owner-directed scope approved 7 September 2026: retain payment by actual activity day; add Unapprove for approved, unpaid days, returning them to Needs review. This is approval to implement the specific financial control, not to change existing decisions or release to production.

Base: `738bc0ecc7c958711434ffcbb17754d90925bb05` in `seaweed-harvest/seaweed-harvest.github.io`. Branch: `fix/dryer-payment-unapprove-20260907`. Lane C: payment controls and an additive guarded migration. No open PR duplicated this scope at start.

Implementation: explicit active-approval flag; preserve the approval values and source snapshot; append a private audit snapshot when an active approval is withdrawn. Reuse the existing COSME finance-owner guard. Serialize with existing payment and decision locks, reject paid and stale-version requests, and make repeated withdrawals idempotent. Existing save reactivates an approval; payment must reject withdrawn approvals server-side, not merely hide checkboxes.

UI: Unapprove beside Update for approved/unpaid and stale unpaid approvals; confirmation; return to Needs review, clear selection and recompute the displayed due amount. Preserve editable values for reapproval. No changes to phase dates, daily contract maths, recorded transfers, allowances, credit balances, source dryer records or the public/offline form.

Expected paths: payment controller, page script version, one additive migration and focused tests. Checks: syntax; existing payment logic/static tests; synthetic desktop/mobile unapprove/cancel/error/reapprove/paid-state probes; migration anchor and permission checks; database positive/negative, stale-version, repeated-action and payment-race checks before release. Never weaken an existing test to conceal a failure.

Rollback: revert the UI and disable only the new Unapprove RPC if needed; retain the audit table and payment rejection of withdrawn approvals. Do not revert the server rejection while withdrawn approvals exist. No deletion or resetting of live approvals is authorised.

Status: implementation in progress. Separate owner merge/deployment approval and database validation are required before release. No live database writes have been made.
