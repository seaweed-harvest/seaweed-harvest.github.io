# Dryer Activity Payments — Implementation Plan

Date: 2026-09-01
Status: implementation complete on draft branch; merge and production deployment pending separate approval
Target application: Seaweed Harvest / COSME Dryer Table Records
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Exact base commit: `067dd136a4549931ab2e2f7ee504da741af9d1c9`
Implementation branch: `work/dryer-payment-management-20260901`
Draft pull request: `#19`

## Authority and approval

This is a manual owner-directed request made in ChatGPT on 2026-09-01.

The owner approved the compensation rule and interface design, then explicitly directed: “okay, lets try this out. please implement”. This is treated as the Lane C approval to implement the agreed financial/payment logic and protected additive Supabase migration. It does not authorise merge or production deployment; those remain separate gates.

## Contract rule

An activity day qualifies for the contractual base when there are:

- at least 8 bay loadings; **or**
- at least 8 bay unloadings.

For a qualifying day:

`KES 500 + KES 25 × every loading/unloading activity above the initial 8`

Examples:

- 8 loadings, 0 unloadings = KES 500
- 8 loadings, 3 unloadings = KES 575
- 21 loadings, 0 unloadings = KES 825
- 5 loadings, 5 unloadings does not qualify because neither phase reached 8

For a below-minimum day, the interface shows a non-contractual reference of:

`KES 25 × total recorded loading/unloading activities`

The owner then approves the actual work amount manually, including KES 0 where appropriate.

Phone/data is decided separately per activity day as either KES 0 or KES 100.

## Implemented interface

Top tabs:

- All Records
- Observations
- Payments

Payments sub-tabs:

- Activity Days
- Payment Ledger

### Activity Days

One row is derived per Research Assistant and Kenya activity date. Loading and unloading activities are assigned to the date on which each phase occurred, even when both phases belong to the same drying event/submission.

Columns:

- Select
- Date
- Research Assistant
- Activity
- Status
- Work amount
- Phone/data
- Approved total
- Payment

Each day expands to show the drying events/tables and phase counts behind the total.

Qualifying days show the fixed contract calculation. Below-minimum days show the KES 25-per-activity reference and require a manual approved work amount. A day becomes approved only after both the work amount and phone/data decision are saved.

Approved unpaid days can be selected. The selected-payment panel shows:

- approved work compensation
- approved phone/data allowances
- phone/data advance credit applied
- amount to transfer now

Recording the payment links the selected days to one immutable payment transaction and prevents them being paid twice.

### Payment Ledger

Records actual money movements only:

- Activity payment
- Phone/data advance

A phone/data advance creates credit that offsets only approved phone/data allowances. It never offsets work compensation.

Activity-payment rows retain a payment-time snapshot of the selected days, approved values and source counts. Ledger rows expand to show the days and calculation breakdown.

## Existing data baseline

Current derived activity days for Research Assistant `Amina kitsao` (`id:408560572`):

| Date | Loadings | Unloadings | Qualifies | Contract / reference |
|---|---:|---:|---|---:|
| 2026-08-31 | 21 | 0 | Yes | Contract KES 825 |
| 2026-08-30 | 7 | 0 | No | Reference KES 175 |
| 2026-08-29 | 3 | 0 | No | Reference KES 75 |
| 2026-08-28 | 6 | 0 | No | Reference KES 150 |
| 2026-08-27 | 5 | 0 | No | Reference KES 125 |
| 2026-08-25 | 7 | 0 | No | Reference KES 175 |

No historic payment decisions or transfers existed before this implementation. The new tables remain empty until the owner uses the Payments interface.

## Implemented data model

Three protected tables were added in the dryer-data Supabase project:

1. `seaweed_drying_activity_day_decisions`
   - one approved decision per assistant/date
   - approved work amount
   - phone/data amount
   - optional note
   - source-count and contract/reference snapshot
   - approver audit fields

2. `seaweed_drying_payment_transactions`
   - append-only activity payments and phone/data advances through the exposed API
   - actual transferred amount
   - work, phone/data and applied-credit breakdown
   - payment date, reference, note and recorder audit fields
   - client request ID for transaction idempotency

3. `seaweed_drying_payment_activity_days`
   - immutable link from an activity payment to each settled day
   - unique decision link prevents double payment
   - payment-time activity and amount snapshot

All tables have RLS enabled, no direct public policies, and no direct `anon` or dryer-project `authenticated` table privileges. Access is only through protected-owner COSME RPCs that validate the caller’s existing Seaweed Harvest account token through the established cross-project bridge.

## Implemented protected RPCs

- `list_authenticated_seaweed_drying_payment_workspace`
- `save_authenticated_seaweed_drying_activity_day_decision`
- `record_authenticated_seaweed_drying_phone_advance`
- `record_authenticated_seaweed_drying_activity_payment`

Write RPCs reject:

- unsigned or unauthorised callers
- non-COSME or non-owner callers
- callers without the required finance/data/admin access
- invalid amounts or dates
- edits to a paid day
- duplicate payment of a day
- payment where source records changed after approval
- credit application beyond the available phone/data balance

## Scope boundaries

Included:

- Payment sub-tabs and compact summaries
- derived contract/reference calculations
- activity-day approval
- KES 0/KES 100 phone/data decision
- phone/data advance ledger
- selection and full settlement of approved days
- immutable paid snapshots and double-payment prevention

Not included:

- changes to the public/offline Dryer Table form
- payroll, tax, bank or M-Pesa integration
- partial settlement of an approved day
- deletion, editing or reversal of recorded payment transactions
- automatic assumption that phone/data is owed
- payments for work outside dryer-table records

## Actual changed paths

- `01_Ag_Planning_Documents/2026-09-01_DRYER_ACTIVITY_PAYMENTS.md`
- `dryer_table_records.html`
- `assets/js/dryer_payment_math.js`
- `assets/js/dryer_table_payments.js`
- `tests/dryer_table_records_static_test.py`
- `tests/dryer_table_payment_logic_test.py`
- `tests/dryer_table_payment_ui_probe.py`
- `supabase/migrations/20260901134500_dryer_activity_payment_foundation.sql`
- `supabase/migrations/20260901134600_dryer_activity_payment_workspace.sql`
- `supabase/migrations/20260901134700_dryer_activity_payment_transactions.sql`

No shared navigation, public Dryer Table form, offline-store, service-worker or existing dryer-ledger JavaScript file is changed.

## Acceptance checks

1. Existing All Records and Observations behaviour remains unchanged.
2. Top tab is labelled Payments, with Activity Days and Payment Ledger sub-tabs.
3. Activity counts use Kenya dates and count loadings/unloadings on their actual phase dates.
4. The threshold is `loadings >= 8 OR unloadings >= 8`.
5. Qualifying contract amounts and below-minimum reference values match the approved rule.
6. Below-minimum days require a human-approved work amount.
7. Phone/data is explicitly set to KES 0 or KES 100; it is never assumed.
8. Activity-day evidence expands to show source events.
9. Approved unpaid days can be selected and totalled.
10. Phone/data advances offset only selected phone/data allowances.
11. Recording a payment creates one ledger transaction and marks all selected days paid.
12. Paid days cannot be selected or paid again.
13. Source changes after approval prevent payment until the day is reviewed again.
14. Recorded payment snapshots do not silently change when dryer records later change.
15. No existing dryer records are updated, deleted or migrated.

## Verification evidence — 2026-09-01

Completed:

- All three additive payment migrations applied successfully to the dryer-data project.
- Contract snapshots verified directly from the live source data:
  - 2026-08-31: 21 loadings, qualifies, KES 825 contract amount.
  - 2026-08-30: 7 loadings, below minimum, KES 175 reference amount.
- Deterministic JavaScript calculation tests passed for:
  - 8L/0U
  - 8L/3U
  - 21L/0U
  - 5L/5U
  - 7L/0U
  - 3L/0U
  - phone/data credit limits and separation from work compensation.
- New JavaScript syntax checks passed.
- In-memory Chromium payment UI probe passed for:
  - Activity Days and Payment Ledger sub-tabs
  - summary metrics
  - below-minimum approval
  - KES 0/KES 100 phone/data selection
  - selecting multiple approved days
  - work/phone/credit/transfer totals
  - existing phone/data advance ledger display.
- Updated Dryer Table Records static suite passed: 22 tests.
- Transactional database validation passed for:
  - below-minimum decision snapshot
  - phone/data advance entry
  - activity payment allocation
  - work/phone/credit transfer breakdown
  - unique double-payment rejection.
- The transactional validation was rolled back; persisted payment decisions, transactions and allocations remain zero.
- Missing and invalid access-token calls are rejected.
- One existing protected-owner COSME finance-access path is present in the account project.
- `anon` and dryer-project `authenticated` roles have no direct SELECT on payment tables.
- Payment RPCs are callable only through the guarded dryer-project `anon` bridge; the dryer-project `authenticated` role is revoked because the accepted account token belongs to the separate account project.
- Source dryer data remains unchanged:
  - 8 submissions
  - 49 bay records
  - 569.001 kg recorded wet load.
- Actual branch diff inspected: exactly the ten paths listed above; no public/offline dryer form path is present.
- Branch is 0 commits behind current `main`.

## Advisor review

Post-DDL Supabase security advisor review produced the expected warnings for:

- RLS-enabled payment tables with no direct policies; this is intentional because direct role privileges are revoked and all access is through guarded security-definer RPCs.
- `anon`-executable security-definer payment RPCs; this is required by the cross-project account-token bridge, and each RPC validates the external signed-in owner token and COSME/finance permissions before reading or writing.

No mutable-search-path warning was raised for the new functions. Performance review raised only expected unused-index notices while all three new tables are empty; it did not identify a missing foreign-key index for the new payment model.

## Rollback plan

Before merge/deployment:

- close or revert the branch and PR;
- revoke execution of the four payment RPCs to disable the feature immediately if required;
- because all three payment tables are empty, they may be removed under the existing implementation approval if the implementation is abandoned before first use.

After future production use:

- revert the frontend files;
- revoke payment RPC execution to disable writes immediately;
- preserve payment tables and ledger history by default;
- only drop or destructively alter payment tables under a separate explicit data-destruction approval.

## Confidence

Rule and interface confidence: high.

Data-integrity confidence: high with transactional writes, payment-time snapshots and unique double-payment protection.

Access-control confidence: high for the verified negative paths and existing eligible owner path. A final positive call through the real owner browser session remains a sensible pre-merge or post-preview check because the two Supabase projects use separate sessions.
