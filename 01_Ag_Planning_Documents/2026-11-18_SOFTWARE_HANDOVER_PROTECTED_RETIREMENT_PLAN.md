# Software handover — protected retirement plan (18 November 2026)

**Status:** Plan for explicit owner approval **before coding or deleting data**.
**Repository:** `seaweed-harvest/seaweed-harvest.github.io`.
**Base:** `main@a82abb9bfa04bd4fd5a3714db528dfbf2e19f98b`.
**Planning branch:** `plan/harvest-retirement-20261118`.
**Intended implementation:** New scoped Lane C branch(es) after this plan is approved; keep separate from navigation draft PR #168.

## User problem and decision

The handover must expose working COSME and Mawimbi tools, not abandoned experiments. The owner has requested permanent removal of the unused Bati organisation and the personal Green Space module (without making a separate archive); removal of Green Space, SMS and QR/Tags options from user and permission screens; and preservation of the operational Mawimbi emails, COSME nursery, and Sandbox ledger. The owner separately asked for clarification of an optional COSME nursery review link.

This plan does **not** give permission to apply production SQL, remove storage objects, delete users or merge/deploy code. It defines those steps for the repository's required Lane C approval-before-coding gate. All quantities below are from a read-only 18 November Supabase audit and must be rechecked immediately before mutation.

## Audited data and precise deletion boundaries

### Bati organisation

ID: `59f5db4c-c85f-4a49-ae4e-11232e95ac02`.

| Bati-specific relation | Rows | Proposed disposition |
| --- | ---: | --- |
| Previously deleted audit entries | 53 | Delete Bati-only audit rows (37 stock, 7 process, 5 site samples, 4 intake). The four intake rows bear artificial `2001-01-02` dates and total 492 kg; monetary total is 0 KES. |
| Suppressed SMS request history | 22 | Delete only Bati-scoped requests, not Mawimbi SMS history. |
| Organisation–community links | 24 | Delete Bati join rows, **retain all 24 shared community records**. |
| Organisation–farmer links | 3 | Delete Bati join rows, **retain all three shared farmer records**. |
| Organisation memberships | 2 | Delete Bati membership rows; do not remove an account's COSME membership. |
| Receipt counter | 1 | Delete Bati-specific counter. |
| Form access settings | 7 | Remove Bati settings. |
| Organisation permissions | 1 | Remove Bati permission link. |
| User profile whose selected organisation is Bati | 1 | Change its active organisation to COSME **only after confirming that profile's active COSME membership**. Preserve the login and COSME access. |
| Current Bati collections, receipts, stock, processes, site samples, nursery, photos and other operations | 0 | No operational rows to migrate. |

The 24 communities and three farmers are also associated with other organisations. A tenant-safe deletion **must not delete those shared registry objects**. Foreign-key restrictions require removal of Bati-specific child rows before the `ag_aggregators` row.

### Green Space in Sandbox

| Green Space data | Rows/objects | Proposed disposition |
| --- | ---: | --- |
| Spaces | 8 | Delete. |
| Reflection entries | 27 | Delete. |
| Photo metadata | 3 | Delete. |
| Final assessment snapshots | 5 | Delete. |
| Submission-rate-limit records | 52 | Delete. |
| Storage bucket `green-space-photos` | 23 objects (~1.7 MB) | Remove via Supabase Storage API, verify object listing empty, then retire bucket if unreferenced. Do **not** SQL-delete from `storage.objects`. |

Remove dedicated Green Space pages, routes, form metadata, backend functions and capability checks only after proving they are not shared with live forms. Green Space currently has **two active `green_space_teacher` app-role profiles**, neither with another active organisation membership, and six profiles granted `can_manage_green_space`. Proposed approach: disable the two Green Space-only app profiles, clear Green Space-only grants for other profiles and remove the role/capability from the administration UI. **Do not delete Supabase Auth identities without inspecting account dependencies and separate express approval.**

The Sandbox organisation and its **1,704-row Ledger Transcriptions import must remain unchanged**. No deletion may target generic Sandbox records, permissions or storage.

### Experimental SMS, Tags and Form Manager surfaces

- Hide or retire SMS settings, QR/Tags and Notifications links, options and role/capability controls throughout organisation administration, user management, profile/settings and mobile/desktop menus. `my_details.html` currently offers `sms` and `both` receipt delivery options; 267 farmer records all have `none`, so these choices can be removed from the UI. Preserve functional `none` and `email` flows.
- Remove experimental `green_space_teacher`, `can_manage_green_space`, `can_manage_sms_settings`, SMS notification and QR/Tags permissions from visible admin UI, without broadening any user's permissions. Inspect any residual server-side capability before removal; client hiding alone is not authorisation.
- Leave Mawimbi daily/weekly/monthly operational summary **emails**, cron triggers, receipts, backups, pricing matrix and collection workflows intact.
- Existing SMS delivery history: 644 requests all suppressed (22 Bati, 622 Mawimbi). The scope deletes the 22 Bati-only requests; **retain the 622 Mawimbi suppressed requests** unless expressly included in an approved data-retention change. Tags has 30 reserved IDs, none recorded printed; bench the UI but do not delete those rows without a separate decision.
- Nine COSME Reef Nursery shared `review` links exist (one active; eight expired/revoked) and have **zero recorded shared submissions**. The optional review link is distinct from the main `form_reef_nursery` public-entry form. Leave the active link untouched during retirement until the public nursery entry and reviewers have been tested; recommend later revocation if no longer needed.

## Implementation sequence (Lane C, after plan approval)

1. Refresh the exact `main` base SHA and all row counts, FK dependencies, account memberships, Storage objects, form settings, function references and operational email paths. Halt if scopes or counts differ materially.
2. Prepare narrowly scoped, idempotent scripts/migrations and permission-UI changes in a new protected branch. Use deterministic synthetic fixtures; do not leak real user identifiers in tests or PR text.
3. Make retired UI inaccessible in all navigational and settings surfaces and remove dedicated Green Space static content; remove or disable only demonstrably unused dedicated Edge Functions. Assert existing public COSME nursery, Mawimbi intake/process and Sandbox ledger remain reachable.
4. In one guarded database transaction, reassign the Bati-selected profile to COSME after checking membership, delete only Bati-scoped child rows, verify no remaining references, and delete the Bati organisation; commit only if row counts and FK constraints match the approved manifest.
5. Remove only the enumerated Green Space database records in a guarded transaction; clear/disable corresponding app-role and permission grants after negative permission tests. Do not delete authentication identities in this pass. Check remaining Sandbox ledger row count before and after.
6. Remove the enumerated `green-space-photos` objects through the Storage API after verifying bucket contents; confirm success before deleting an empty, unused bucket. Cross-check 3 metadata rows versus 23 physical objects to avoid accidentally targeting unrelated files.
7. Verify COSME/Mawimbi forms, registry, metrics, nursery public entry/review, receipts, email summaries and existing memberships, plus negative access checks for retired routes and capabilities. Inspect exact diff and keep the implementation PR **draft**.
8. Request **separate owner approval to merge and release**. No production deployment occurs merely because coding or data-change plan is approved.

## Acceptance checks and testing

- Bati absent from organisation lists and foreign-key references; no Bati records remain; all 24 shared communities, three shared farmers, retained COSME account and other organisation records unchanged.
- Sandbox displays only Ledger Transcriptions where Green Space used to appear; 1,704 ledger rows preserved; no Green Space data, objects, routes, forms, settings, role choices or visible permissions remain.
- No SMS, Notifications, QR/Tags or experimental Form Manager/Builder settings exposed in desktop, mobile, admin user management, organisation permission editors or own-profile screens; disabled users do not gain alternate access by URL.
- COSME and Mawimbi tenant isolation/RLS, normal emails, backups, active forms, project summary/journal, receipts and nursery workflows remain functional.
- JS syntax, focused static/unit tests, browser menu/settings probes (desktop and phone), Supabase transaction/FK validation, positive and negative permission tests, Storage listing checks and post-release smoke tests pass. Capture old versus new row counts without identifying persons.

## Rollback and irreversible-deletion notice

- **Before DB commit:** any FK, count, account or permission mismatch triggers `ROLLBACK` of the Bati or Green Space transaction. Rerunning scripts must not delete additional rows.
- **After DB commit:** deletion is intentional and cannot be reconstructed from this work because the owner declined a separate Green Space/Bati archive. Recovery of database rows would depend on whatever provider backup or point-in-time restore is actually available; this must be checked before execution and must not be assumed. Storage object deletion is not part of the DB transaction and may be irreversible.
- **Code:** revert/redeploy the last known-good revision; keep migration and Storage deletion separated with checkpoints, so failures do not silently continue.
- Halt without destructive writes if the owner does not accept irreversible data loss or if shared resources cannot be distinguished from the target set.

## Gate

**Await explicit approval of this implementation plan, test plan and rollback/irreversibility terms before Lane C coding or any production data deletion.** After implementation, request a second human review for merge/deployment as required by `AGENTS.md` and `.automation/development-policy.yml`.
