# Dryer Payment UI Refinement — 2026-09-17

Status: implementation authorised; merge and deployment require separate owner approval
Target application: Seaweed Harvest / COSME Dryer Table Records / Payments
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Exact base commit: `d84b6b60e3178647c7ef661d936553274f665698`
Implementation branch: `refine/dryer-payment-reference-ui-20260917`
Risk lane: C — protected payment UI path / financial presentation

## Authority and user problem

The owner directly requested this refinement in ChatGPT on 2026-09-17. The request authorises implementation of the scoped Payments UI change. It does not authorise merge or production deployment; those remain separate gates.

The current Activity Days table uses a separate `Reference KES …` / `Contract KES …` hint above the Work amount input. That makes each activity day taller than necessary and makes the payment rule harder to reference while reviewing a day.

## Approved outcome

1. Add a small **Payment terms reference** disclosure in the Payments section. It is collapsed by default and contains concise bullets for:
   - KES 500 per qualifying activity day once either 8 bay loadings or 8 bay unloadings is reached;
   - KES 25 for every additional loading/unloading activity above the initial 8;
   - KES 100 phone/data allowance when the Research Assistant uses their own phone and mobile data.
2. Make Activity Days rows slightly more compact vertically and keep normal row content on one line where practical.
3. Move `Reference KES …` / `Contract KES …` into the Work amount control visually instead of rendering a separate hint line.
4. Pending Work amount controls use the existing yellow/review visual language. A pending below-minimum reference amount is prefilled as the editable suggested amount, so an explicit Approve action can accept it without retyping; the owner can still focus the control and replace it before approval.
5. Once an activity day has an approval decision, show only its numeric work amount and retain the existing approved control appearance.
6. When an activity date is expanded, add a **Pay detail** block under Recorded activity showing:
   - base day amount;
   - bay bonus (or below-minimum bay reference);
   - contract total or reference total.
7. Keep the existing backend/RPC approval, phone/data decision, ledger, payment and double-payment protections unchanged.

## Implementation approach

Use a presentation-focused module loaded only by `dryer_table_records.html`. The helper observes only direct Activity Days row replacement and decorates the current payment markup. It imports the existing `calculateContractWorkAmount()` helper so the expanded pay breakdown uses the same contract calculation already used by the payment feature.

No Supabase migration, RPC, authentication, permission, ledger write or service-worker change is in scope.

## Acceptance checks

- Payment terms disclosure exists and is closed by default.
- Terms show KES 500, KES 25 and KES 100 rules accurately.
- Pending reference and contract labels appear inside the Work amount box, not as a separate line.
- Pending boxes use yellow review styling.
- Below-minimum reference value is editable before approval and is available to the existing approval handler as the suggested numeric amount.
- Approved rows show only the numeric amount and no overlay label.
- Expanded qualifying day shows KES 500 base, correct extra-bay bonus and correct contract total.
- Expanded below-minimum day shows KES 0 base, correct KES 25-per-bay reference and correct reference total.
- Existing payment save/ledger backend code is unchanged.
- Existing All Records and Observations tabs are unchanged.

## Test plan

- JavaScript syntax check for the new module.
- Focused headless-Chromium fixture covering collapsed terms, pending reference/contract controls, edit behaviour, approved-row behaviour and both pay-detail calculations.
- Inspect the actual PR diff and confirm only the scoped page loader, helper, deterministic probe and this planning note change.

## Rollback plan

Before merge: close the branch/PR.

After a future authorised deployment: revert the HTML module include and helper file. The change does not alter database records, RPC definitions, payment ledger data, permissions or service-worker state, so no data rollback is required.

## Confidence

High for the requested presentation change. The only intentional workflow change is that a below-minimum reference amount is offered as an editable default; an explicit owner approval action and explicit phone/data choice are still required before the existing write RPC is called.
