# Mawimbi weekly email recovery — 15 September 2026

## Owner request and scope
Bosun reported missing weekly Mawimbi emails. The proposed scope was to capture the weekly function error, correct the fault, resend the missing report and add early failure visibility. Owner response in ChatGPT: "please do so". This is owner-directed maintenance, not execution by the paused in-app suggestion automation.

- Repository: seaweed-harvest/seaweed-harvest.github.io
- Base: main@4ea798a8386e2d6027072ab7c49388b6389eda87
- Branch: fix/mawimbi-weekly-email-recovery-20260915
- Supabase project: wwzmajhdusfyfskppupg (v1_Ag_System)
- Existing sender: daily-record-email-summary, version 31; unchanged by this repair.
- Missing report: 7–13 September 2026, due 14 September 2026.
- Classification: protected backend maintenance. Source PR remains at the separate merge-review gate. The owner-authorised production database maintenance below is already applied.

## Investigation and conclusions
Four weekly subscriptions were still active. Both 14 September weekly cron runs queued requests, but no corresponding delivery rows existed. Daily sends still worked. The missing week had 22 collection and three processing records, so it was not an empty period.

The original HTTP response expired before investigation. A no-send replay on 15 September succeeded without changing the report generator. Therefore the exact original transport/runtime error remains unproven; this work does not claim to have identified a deterministic generation defect. The demonstrated reliability gap was that request outcomes were not retained independently of delivery rows, so early errors disappeared while cron showed successful queuing.

The read-only SQL connector cannot use the scheduler credential. The separately authorised migration action executed maintenance successfully. No existing role, permission, credential or authentication setting was changed; the scheduler credential remained inside Postgres.

## Production recovery receipts
These observations were read directly from the production database and HTTP response records on 15 September 2026.

| Action | Evidence |
| --- | --- |
| No-send replay | Request 147, queued 03:29:49 UTC, HTTP 200, ok=true, dry_run=true, four recipients, 7–13 September period |
| Catch-up send | Request 148, queued 03:30:22 UTC, HTTP 200, ok=true, sent_count=4, failed_count=0 |
| Sender subject | Mawimbi weekly report - 07 Sept 2026 - 13 Sept 2026 |
| Delivery history | Four sent rows, one attempt each; sends completed 03:30:23–03:30:24 UTC |
| Final count check | At 03:43:31 UTC: four sent rows and four total attempts, no extra sends |
| Durable outcomes | Requests 147 and 148 persisted as succeeded with HTTP 200 and whitelisted result counters |
| First automatic monitor run | Cron job 12 succeeded at 03:40:00 UTC; duration approximately 11 ms |

All existing weekly recipients were selected by the sender. No recipient or subscription was changed and force=false was used. Provider message IDs were returned for all four emails. This proves acceptance by the sending provider, not inbox placement or recipient reading.

A separate provider-delivery/readback and live duplicate-replay operation was blocked by tool safety checks and made no changes. It was not retried through another route. Therefore provider delivery events and a live second invocation proving duplicate skips are not claimed; duplicate guards were checked in code and actual send counts remained unchanged.

## Applied migrations and behaviour
The filenames match the versions actually recorded in supabase_migrations.schema_migrations:

1. 20260915032949_mawimbi_record_email_request_logging.sql — secure transport history plus explicit no-send diagnostic.
2. 20260915033022_recover_mawimbi_weekly_report_20260913.sql — owner-approved catch-up through the existing sender, without force.
3. 20260915033729_record_email_outcome_monitor.sql — persistent response classification, dispatch wrapper, capped weekly recovery and 27 database assertions.
4. 20260915033850_isolate_record_email_recovery_failures.sql — isolate retry exceptions so they cannot roll back original failure evidence; three permission assertions.

Existing cron IDs 5, 8, 9, 10 and 11 retain their original schedules and active flags; their commands now use the logged wrapper. Daily remains 05:00 UTC, weekly Monday 05:05 UTC with 05:20 retry, monthly day 1 at 05:10 UTC with 05:25 retry. Next normal weekly send: 21 September 2026, 08:05 East Africa Time.

New cron job 12, record-email-outcome-monitor, runs every ten minutes. It captures HTTP errors and timeouts before pg_net expiry and marks missing responses as unknown, never as successful. Late responses can replace unknown outcomes. Response summaries exclude full report contents, recipient lists, auth headers and secrets; error text is length-limited and redacted.

Only failed or unknown automatic weekly sends are candidates for recovery. Attempts are limited to three total automatic requests per period, including the existing scheduled retry, with a minimum 15-minute gap and an eight-day age limit. Diagnostics and manual sends are excluded. Existing per-recipient/provider duplicate protection remains; the wrapper adds an overlap lock, an in-flight guard and an already-sent subscriber check. Recovery never uses force.

This is retained failure evidence plus bounded recovery, not a new user-facing Slack/email alarm or a guarantee against every possible outage. A scheduler/database outage itself remains visible through cron/system history rather than an HTTP request that was never queued.

## Test evidence
- 27 functional PostgreSQL assertions ran inside the monitoring migration with plpgsql.check_asserts=on and passed: successful sends, empty periods, already-sent responses, build errors, non-2xx, timeouts, malformed responses, redaction, retry bounds and deny-by-default permissions.
- Three additional permission assertions passed in the isolation migration.
- python tests/record_email_monitor_static_test.py — nine tests passed (re-run 15 September).
- Live no-send report succeeded; catch-up returned four accepted sends and zero failures.
- Readback verified retained outcomes and original schedules. First automatic monitor execution succeeded.
- The new wrapper's outbound recovery branch was not exercised with an artificial failed production email; retry predicate tests and static dispatch guards cover its logic without deliberately generating failures or extra emails.

Security advisor reviewed after deployment. The new table has the expected INFO notice for RLS enabled with no app-facing policy (intentional backend-only, deny-all app access). No new helper appeared in the callable-by-anon/authenticated or mutable-search-path warnings. Existing unrelated project advisories were not changed. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy for the INFO classification.

## Rollback and review
Disable only record-email-outcome-monitor, restore the five original cron commands from their earlier schedule migrations, and retain the additive history for diagnosis. No Edge Function rollback is needed because its source was unchanged. Do not delete operational records, subscription settings or sent-email history.

The catch-up send cannot be undone and should not be replayed by hand. These migration versions are already recorded in production; source merge is a source-of-truth reconciliation, not a request to force-send again. Retain the protected-change source PR for separate merge review.

## Outcome
Missing report recovered; persistent request outcomes and bounded weekly recovery live. Exact historical 14 September error and final inbox delivery remain unverified. No operational data, report calculations, subscriptions, existing permissions or frontend code were modified.
