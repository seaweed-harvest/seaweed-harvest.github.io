# COSME Metrics — Timeline tab and read-only release projection

Owner request: 1 November 2026, explicitly approved the read-only timeline database connection. Build a Timeline **tab inside the existing COSME Project Metrics page**, not a new application or milestone database. Only draw events from verified COSME source material and link to existing published metrics. No arbitrary milestone generation.

Source repository: `seaweed-harvest/seaweed-harvest.github.io`
Target base: `main` at `9634e7b4c8a45109c40d56f8bf6d7987948c5296`.
Working branch: `work/cosme-metrics-timeline-readonly-20261101`.
Earlier UI prototype: `feature/cosme-metrics-timeline-20261101` at `4b28b7060f1b1685a15a958df5bc3b8d5d900508`; this prototype predates the latest live-value/mobile release and must not replace newer main-page code.

## Change classification and authority
Lane C: small SQL SECURITY DEFINER API function in protected `supabase/**` path; explicit owner approval given in conversation 1 November 2026 to implement the read-only connection. Separate review/approval is required before merge or applying to production. Frontend-only files follow current shared Metrics page structure. No extra tables, RLS, organisational permissions, publication revisions, money, ledgers, or operational record writes.

## Acceptance checks
1. Metrics page contains `Timeline` beside existing Overview, All metrics, Current data and Releases, with existing mobile accessible navigation preserved.
2. Timeline + month calendar views, activity/type/year filters, and dated event source/related-metric links.
3. Curated event descriptions derive from latest published COSME metrics and separately cross-checked dated sources; distinguish work completed from planned deliverables and preliminary findings.
4. A single read-only `public.cosme_metrics_timeline()` RPC projects verified date metadata onto the existing `cosme_metrics.release_items` / `cosme_metrics.metrics` records. No milestone table or parallel register.
5. Access enforced with `auth.uid()` and the existing `cosme_metrics.caller_role()` before any data exposure; anon/PUBLIC cannot execute. No sensitive links in public front-end assets.
6. Existing metric values/releases/picks and other organisations' access are unchanged. Unavailable metrics are excluded from event links.
7. Tests for grant/safety contract, curated dates, UI integration and build syntax. Browser/mobile probe before merge; stop if browser runner unavailable.
8. Neither migration nor frontend is applied to production without separate merge approval.

## Validation and rollback
- Query the current release read-only to verify every selected metric anchor and event date against its frozen value/note/source.
- Static Node tests validate the projected dataset, source link handling, access-checks, and no mutation SQL; SQL validation/negative access-control tests are required before production apply.
- Verify latest main features are preserved and review exact changed paths. Keep this PR a draft until review and browser checks.
- Rollback: revert the front-end commit; if the RPC were applied in a separately approved production change, revoke its EXECUTE grant then drop `public.cosme_metrics_timeline()`. No persistent timeline data to recover.
