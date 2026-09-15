# Mawimbi weekly email recovery — 15 September 2026

## Owner request and authority
Bosun reported missing weekly Mawimbi emails. After an investigation, the proposed scope was to capture the weekly function error, correct it, resend the missing report, and add early failure visibility. Owner response in ChatGPT: "please do so". This is an explicitly owner-directed repair, not execution by the paused in-app suggestion automation.

## Confirmed target and base
- Repository: seaweed-harvest/seaweed-harvest.github.io
- Base: main@4ea798a8386e2d6027072ab7c49388b6389eda87
- Branch: fix/mawimbi-weekly-email-recovery-20260915
- Supabase project: wwzmajhdusfyfskppupg (v1_Ag_System)
- Existing function: daily-record-email-summary
- Missing report: 7–13 September 2026, due 14 September 2026.
- Risk: protected backend maintenance, explicitly authorised scope. Do not alter auth, membership permissions, report subscriptions, unrelated jobs or operational records.

## Verified observations
- Four weekly subscriptions remain active.
- Last weekly delivery rows are marked sent on 7 September (week ending 6 September).
- Both 14 September weekly cron requests were queued, but no weekly delivery rows exist for the week ending 13 September.
- Daily deliveries were marked sent on 14 September using the same Edge Function.
- Missing week has 22 collection and three processing records; it was not empty.
- The connected execute_sql action runs as supabase_read_only_user, explaining why it cannot use the scheduler Vault secret. Do not change that role, expose a secret or add an unauthenticated diagnostic endpoint.
- Exact original HTTP error is not retained. Do not claim a root cause without evidence.

## Implementation and test plan
1. Use the separately available, approved migration/deployment actions to establish whether backend maintenance is possible. If denied, stop live writes and retain a tested repair/handoff rather than bypass access controls.
2. Reproduce through the existing authenticated sender with dry_run=true and explicit week ending 2026-09-13; no email during diagnosis.
3. Make the smallest evidence-backed repair to report generation.
4. Retain request/run failures independently of per-recipient delivery rows, including failures before sending and failed HTTP invocations. Do not retain auth headers or report payloads containing operational/personal data in new diagnostic logs.
5. Run deterministic regression tests including empty periods, pre-send failure, subscription selection and duplicate prevention. Inspect the final diff.
6. Deploy only approved scoped changes, run a successful no-send diagnostic, then resend the missing report to the existing weekly recipients without force. Verify delivery rows and provider status where access permits.
7. Preserve daily/weekly/monthly schedules and existing sent-email idempotency. Record evidence, limitations and exact deployment/commit receipts here.

## Rollback
Restore the previous Edge Function version from its retained source if the code patch regresses. Restore the original cron commands from the 20260803090000 schedule migration if scheduling wrappers are changed. Keep additive diagnostic history; do not delete operational data or sent-email history. Remove any temporary diagnostic job immediately after its bounded run.

## Status
Investigation/recovery in progress. No email has been resent and no production backend change has yet been applied.
