# Dryer Activity Payments — Implementation Plan

Date: 2026-09-01
Status: approved for implementation; protected financial/database work in progress
Target application: Seaweed Harvest / COSME Dryer Table Records
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Exact base commit: `067dd136a4549931ab2e2f7ee504da741af9d1c9`
Implementation branch: `work/dryer-payment-management-20260901`

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

## Agreed interface

Top tabs:

- All Records
- Observations
- Payments

Payments sub-tabs:

- Activity Days
- Payment Ledger

### Activity Days

One row per Research Assistant and Kenya activity date. Loading and unloading activities are assigned to the date on which each phase occurred, even when both phases belong to the same drying event/submission.

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

Each day can expand to show the drying events/tables and phase counts behind the total.

Qualifying days show the fixed contract calculation. Below-minimum days show the KES 25-per-activity reference and require a manual approved work amount. A day is approved only after the work amount and phone/data decision are saved.

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

Activity-payment rows retain a snapshot of the selected days, approved values and source counts at payment time.

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

No historic payment decisions or transfers are currently stored in the dryer project.

## Data model

Add three protected tables in the dryer-data Supabase project:

1. `seaweed_drying_activity_day_decisions`
   - one approved decision per assistant/date
   - approved work amount
   - phone/data amount
   - optional note
   - source-count and contract/reference snapshot
   - approver audit fields

2. `seaweed_drying_payment_transactions`
   - immutable activity payments and phone/data advances
   - actual transferred amount
   - work, phone/data and applied-credit breakdown
   - payment date, reference, note and recorder audit fields

3. `seaweed_drying_payment_activity_days`
   - immutable link from an activity payment to each settled day
   - unique decision link prevents double payment
   - payment-time activity and amount snapshot

All tables have RLS enabled and no direct public policies. Access is only through protected-owner COSME RPCs that validate the caller’s existing Seaweed Harvest account token through the established cross-project bridge.

## Protected RPCs

- list payment workspace
- approve/update an unpaid activity day
- record phone/data advance
- record an activity payment for selected approved days

Write RPCs reject:

- unsigned/unauthorised callers
- non-COSME or non-owner callers
- invalid amounts or dates
- edits to a paid day
- duplicate payment of a day
- payment where source records changed after approval
- phone/data credit exceeding available credit

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
- deletion or editing of recorded payments
- automatic assumption that phone/data is owed
- payments for work outside dryer-table records

## Predicted changed paths

- `01_Ag_Planning_Documents/2026-09-01_DRYER_ACTIVITY_PAYMENTS.md`
- `dryer_table_records.html`
- `assets/js/dryer_table_records.js`
- `tests/dryer_table_records_static_test.py`
- `tests/dryer_table_payment_logic_test.py`
- `supabase/migrations/20260901*_dryer_activity_payments.sql`

The migration and payment-named paths make this Lane C. No shared navigation, offline, service-worker or public dryer-form files are expected to change.

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

## Test plan

- JavaScript syntax check.
- Static DOM and contract-rule coverage.
- Deterministic unit tests for qualifying and below-minimum calculations.
- Tests for 8L/0U, 8L/3U, 21L/0U, 5L/5U and below-minimum references.
- Browser/UI probe for payment sub-tabs, row approval controls, selection totals and payment/advance forms.
- Migration validation in a rollback transaction before production application.
- Positive protected-owner permission test.
- Negative missing/invalid-token tests.
- Database tests for double-payment prevention, credit limits, paid snapshots and source-change rejection.
- Regression check that source dryer submission/bay counts and total wet weight are unchanged.

## Rollback plan

Before merge/deployment:

- close/revert the branch and PR;
- if a test migration was applied, drop only the new payment RPCs/tables after confirming they contain no required records.

After future production use:

- revert the frontend files;
- revoke payment RPC execution to disable writes immediately;
- preserve payment tables and ledger history by default;
- only drop payment tables under a separate explicit data-destruction approval.

## Confidence

Rule and interface confidence: high.

Data-integrity confidence: high with transactional writes, immutable payment allocations and unique double-payment protection.

Primary implementation risk: cross-project access validation and financial-state concurrency; both are addressed in the database transaction/RPC design and required tests.
