# COSME Photo Records — Implementation Plan

Date: 2026-09-01
Status: approved for implementation; merge and deployment require separate approval
Target application: Seaweed Harvest / COSME records
Target repository: `seaweed-harvest/seaweed-harvest.github.io`
Exact base commit: `099f32cfb6d93ab95c31590022c66305a0baaf4d`
Implementation branch: `work/cosme-photo-records-20260901`

## Authority

This is an owner-directed request made in ChatGPT on 2026-09-01. After reviewing the proposed event-level photo viewer and simplified COSME photo library, the owner directed: “okay, please proceed”.

That instruction authorises implementation and the additive protected photo-access/database work below. It does not authorise merge or production deployment.

## User problem

Dryer Table Records currently shows a numeric photo count against each bay, but it does not explain whether the count represents table, loading or unloading evidence. The collapsed drying-event header does not show the total photographic evidence for the form submission, and there is no direct same-page way to view the event photographs.

The existing generic Photos page also shows intake/process/community/grade controls in COSME even though COSME currently uses Reef Nursery and Dryer Table photographs. Dryer photographs are held in a separate private Supabase project and are not presently included in the Photos page.

## Confirmed source data

For Bati Table 1 on 2026-08-31, the stored submission contains 17 distinct photos:

- 1 table overview photo
- 2 loading photos for each of 8 bays
- 0 unloading photos

Across the current eight Dryer Table submissions there are 91 referenced photos:

- 7 table overview photos
- 84 loading-bay photos
- 0 unloading-bay photos

The existing `2` against each bay is therefore accurate, but insufficiently labelled.

## Agreed interface

### Dryer Table Records

For default `Drying event` grouping, the collapsed event heading will show a separate photo action, for example:

`17 photos`

Selecting that action opens a same-page modal containing all photographs belonging to the submission, ordered and captioned by:

- Table overview
- Bay number — Loading
- Bay number — Unloading

The modal does not navigate away from Dryer Table Records.

Expanded bay rows retain the Photos column, but replace an unexplained number with contextual labels such as:

- `2 loading`
- `2 loading · 2 unloading`

Selecting the bay-level label opens only that bay’s photographs.

For Table or Load-date grouping, the group heading may show a non-clickable aggregate count; direct event viewing remains attached to a single drying event/submission.

### COSME Photos page

When the active organisation is COSME, use source tabs:

- Dryer Table
- Reef Nursery

COSME filters:

- From
- To
- Location
- Recorded by

Hide Intake Collection, Process Record, Community terminology, Grade and Seaweed Type in COSME mode. Preserve the existing generic photo library for non-COSME organisations.

Thumbnail view is the COSME default. A `Show list` / `Show thumbnails` control switches between the thumbnail gallery and a compact list.

COSME list columns:

- Photo
- Date and time
- Record type
- Reference
- Location
- Recorded by
- Photo context

## Architecture

### Account Supabase project

Add an authenticated COSME Reef Nursery photo-library RPC with date, location, recorder, sort and pagination support. It reuses the existing account session and private Reef Nursery storage bucket.

### Dryer-data Supabase project

Add a read-only dryer photo catalog view, available only to the service role, and extend the authenticated dryer ledger RPC with:

- table photo count
- bay loading photo count
- bay unloading photo count

No existing dryer submission, bay record or photo path is changed.

### Dryer photo Edge Function

Add `dryer-record-photos` to the dryer-data project.

The function:

1. accepts the existing Seaweed Harvest account JWT in the Authorization header;
2. validates the token against account-project `ag_my_profile`;
3. requires active protected-owner, COSME, dryer-table capability and data/admin access;
4. queries only photo paths already referenced by dryer records;
5. creates short-lived signed URLs with the dryer project service role;
6. supports event/bay preview and paginated Dryer Table photo-library requests;
7. never makes the private dryer photo bucket public.

The Edge Function has gateway JWT verification disabled only because the accepted JWT belongs to the separate account Supabase project. Custom foreign-token validation is mandatory before any metadata or signed URL is returned.

## Risk classification

Overall lane: **C**.

Reasons:

- `supabase/**` protected migrations and Edge Function
- cross-project authentication/access validation
- private photo-storage access
- `assets/js/**/*photo*` protected Lane B paths
- shared Photos page behaviour
- expected diff exceeds Lane A limits

## Predicted changed paths

- `01_Ag_Planning_Documents/2026-09-01_COSME_PHOTO_RECORDS.md`
- `dryer_table_records.html`
- `photos.html`
- `assets/js/dryer_table_records.js`
- `assets/js/photos_page.js`
- `assets/js/photo_viewer.js`
- `assets/js/dryer_photo_client.js`
- `assets/js/app_navigation.js`
- `supabase/functions/dryer-record-photos/index.ts`
- `supabase/migrations/20260901*_dryer_photo_catalog*.sql`
- `supabase/migrations/20260901*_cosme_reef_photo_library*.sql`
- focused static/unit/UI tests

No public Dryer Table form, offline store, service worker, submission RPC or photo-upload code is expected to change.

## Acceptance checks

1. Bati Table 1 / 2026-08-31 displays 17 event photos, not 2.
2. Bay rows clearly distinguish loading and unloading photo counts.
3. Event and bay photo actions open a modal without leaving Dryer Table Records.
4. The modal returns only photographs referenced by the requested submission/bay.
5. Missing or invalid authentication cannot obtain dryer photo metadata or signed URLs.
6. The dryer photo bucket remains private and receives no public read policy.
7. COSME Photos shows Dryer Table and Reef Nursery source tabs only.
8. COSME Photos removes irrelevant intake/process/community/grade/seaweed-type controls.
9. COSME defaults to thumbnails and can switch to a compact list.
10. COSME date, location and recorder filters work for both sources.
11. Non-COSME Photos behaviour remains compatible with the existing generic library.
12. Existing Dryer Table form, offline operation, saved-bay review and uploads remain unchanged.
13. Existing dryer submission/bay/payment records and photo paths remain unchanged.

## Test plan

- JavaScript and Edge Function syntax/type checks.
- Static tests for event-level and phase-labelled photo controls.
- Deterministic event-photo count tests, including 1 table + 16 loading = 17.
- Browser/UI probe for modal open/close without navigation.
- Browser/UI probe for COSME source tabs, default thumbnail view and list toggle.
- Account-project Reef photo RPC positive/negative permission tests.
- Dryer catalog migration validation and direct-role privilege checks.
- Edge Function missing/invalid-token tests.
- Edge Function positive protected-owner event and library tests.
- Verify signed URLs are short-lived and paths are derived from stored records only.
- Regression check for dryer submission, bay, payment and referenced-photo counts.
- Confirm no public/offline Dryer Table form or service-worker path appears in the diff.

## Rollback plan

Before merge/deployment:

- close/revert the implementation branch and PR;
- undeploy or replace the Edge Function with a deny-all version;
- revoke its service-only catalog access;
- retain existing dryer records/photos unchanged.

After future production use:

- revert the frontend changes;
- deploy a deny-all Edge Function or delete it;
- revoke/drop only the new read-only catalog/RPC objects after confirming no dependency;
- no user photo or dryer-record deletion is required.

## Confidence

Data-model confidence: high.

UX confidence: high; the event/submission is the correct primary photo container while bay context remains available.

Primary risk: secure cross-project signed-URL delivery. The design limits that risk through foreign-token validation, service-only catalog access, stored-path lookup and short expiry.
