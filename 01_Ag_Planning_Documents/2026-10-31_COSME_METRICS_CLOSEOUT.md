# COSME metrics closeout review and shared Top Picks

Request: direct owner instruction in this chat on 31 October 2026, confirmed that
stars must select shared project Top Picks. No suggestion-system request is involved.

Repository: seaweed-harvest/seaweed-harvest.github.io, base live/main
`ce2fa57ab4eac746823c6042c2a8fc197efd2cf3`.
Branch: `work/cosme-metrics-closeout-20261031`.

Base refreshed before review to live/main
`751352c066c6cb685476c0a2eee7139cbcd63d25`. The intervening main changes affect
only admin_users.html and assets/js/users_page.js; no overlap with this scope.
Draft PR: https://github.com/seaweed-harvest/seaweed-harvest.github.io/pull/141.

The reader needs report-supported outcomes, consistent themes, and one shared set
of starred metrics driving the overview, filter and export. The current hardcoded
headline list differs from the workbook Top Picks and overemphasises quotations.

## Scope and approval boundary

Frontend: replace fixed headlines with shared selected metrics; accessible star
controls; persist through dedicated RPCs; eight presentation categories preserving
original themes; surface source dates, evidence and interpretation. Existing live
panels and historical releases retain their scopes. No private report values may
be embedded in publicly downloadable JavaScript or test fixtures.

Protected work remains pending an approved database implementation/test/rollback
plan: additive shared-selection storage and tightly scoped RPCs, plus a new V0.2
report-reviewed release. Do not mutate V0.1 or import/revision history. Only existing
active COSME owner/editor grants may change shared picks; readers may view them.
No change to authentication, existing grants, business ledgers or financial logic.

Risk: frontend Lane B; database/security and release-content write Lane C.
Predicted frontend paths: cosme_metrics.html, assets/css/cosme_metrics.css,
assets/js/cosme_metrics_core.mjs, assets/js/cosme_metrics_page.js,
assets/js/cosme_metrics_picks.mjs, focused tests, this planning document.
Protected backend paths will be identified in the reviewed plan before coding.

## Acceptance and verification

- One persisted shared selection drives overview, activity counts, filter and CSV.
- Owner/editor can select and deselect with keyboard or pointer; readers cannot.
- Pending and failed writes preserve the last confirmed state; report errors clearly.
- Selection reloads on a new session; historical releases remain independently scoped.
- Theme grouping covers every current theme; original labels remain in details/export.
- Every new report metric has an exact source section, as-of date, scope and caveat.
- Retain missing results and conditional findings; never turn targets into outcomes.
- Use synthetic unit/UI fixtures; check syntax and all existing metrics tests.
- Database tests must include owner/editor success, reader/anonymous/expired-grant
  rejection, unknown ID rejection, release isolation, conflicting edits, immutable
  history checks and transaction rollback before an authorised production apply.

Rollback: revert frontend commit. Restore the previous current-release pointer,
leaving immutable V0.2 history and its shared selection intact. Disable only the
new write endpoint if needed; preserve all existing access and business records.

## Evidence reviewed

Read-only review of the supplied shared closeout directory: main metrics workbook,
older summary-card workbook, four initiative cards, Solar Table closeout,
verification, innovation, assembly and maintenance reports and BoQ; Offshore
Nursery closeout Rev 3, verification Rev 4, innovation and maintenance reports,
BoQ and supporting review records; Mawimbi combined verification/closeout report
and 30 October calculation notes. Earlier revisions are context, not controlling
sources. No full Aggregation Hub verification/closeout report is present in this
directory, so its summary card and existing source register bound the claims.

The current database has one immutable V0.1 release with 302 metrics and 25 themes.
Read-only inspection confirms that owner, editor and reader are existing metrics
roles. There is currently no shared star write endpoint.

## Concrete protected implementation plan for approval

1. Add `cosme_metrics.release_picks` keyed by release and metric, containing the
   selected state, monotonic revision, editor identity and update time. Add an
   append-only `cosme_metrics.pick_events` audit. Enable RLS on both new private
   tables with no direct client table privileges; leave all existing policies,
   profiles, grants and business tables unchanged.
2. Add `public.cosme_metrics_get_picks(p_major integer,p_minor integer)` returning
   the selected release's complete metric-ID/state/revision list and `can_edit`.
   Any active existing COSME reader/editor/owner grant can read. Defaults come
   from frozen release flags, with no need to pre-create mutable rows.
3. Add `public.cosme_metrics_set_pick(p_major integer,p_minor integer,
   p_metric_id text,p_featured boolean,p_expected_revision integer)`. Independently
   require an active existing owner/editor grant and the current COSME release;
   validate the metric belongs to that release. Use a row-level compare-and-swap
   revision check, atomic mutation and audit insert; reject stale writes without
   overwriting another editor. Return the confirmed ID/state/new revision.
4. Match the existing private-schema RPC pattern: narrowly scoped definer wrappers
   with an empty search path and fully qualified identifiers. Revoke default
   PUBLIC/anon execute; grant only authenticated execute, with explicit server-side
   grant checks on every call. Do not expose private tables through the Data API.
5. Append reviewed V0.2: 327 metrics, 25 new report metrics and 16 selected defaults.
   The private proposal contains 41 report-reviewed record changes, source sections,
   dates, claim bases and caveats. Other content is copied from V0.1. Changed star
   defaults also get new revision bodies; do not misrepresent the remaining
   workbook-only rows as verified. Preserve original imported payloads and IDs.
   In one transaction, validate the prior release/hash, insert required metric
   identities and revisions, create immutable release/items, verify counts/hash,
   then change only COSME's current-release pointer. Stop if the base differs.
6. Commit a CLI-generated additive migration and synthetic database tests under
   `supabase/` after approval. Keep the actual private report data/import artifact
   outside the public repository; record only its digest and counts in the PR.

Database test plan: run synthetic fixture identities/grants inside a rolled-back
transaction, never modifying real accounts. Exercise owner/editor success,
reader/anonymous/no-grant/inactive/expired rejection, historical-release rejection,
unknown and wrong-release ID rejection, invalid revision/value rejection, stale
compare-and-swap rejection, audit atomicity, and the unchanged original release
hash. Run advisors for new functions/RLS. Only after passing these checks and an
authorised production apply, read back V0.2 and test the real authenticated UI.

Rollback plan: restore the captured V0.1 current-release pointer in a transaction;
revoke execution of the new set endpoint if necessary and revert the frontend
commit. Preserve V0.2, selection events and immutable historical evidence. No
business-record deletion, source-document edit or grant change is included.

The current frontend implements this API contract but must not be deployed before
the approved backend exists. Merge/deployment is a separate human approval gate
under AGENTS.md even after protected implementation is approved.

## Frontend validation completed

33 metrics tests pass, including eight new shared-state/category tests. Three old
static assertions also failed on the exact untouched base: optional-chain spelling,
a hardcoded old script version and an outdated Mawimbi connection expectation.
They now assert the current safety/connection contracts. Syntax and whitespace
checks pass. Synthetic browser checks cover shared save/readback, a second reader
session, read-only reader stars, keyboard deselection while filtered, and historical
selection isolation. No live business data was written by these checks.

User refinement: keep every register row on one line, with a modest star at the
far left. Stars now have a dedicated narrow leading column and a 24 × 24 px
control (17 px glyph). Browser measurement of the complete 327-row proposal
confirmed every row is 34 px high. Long values and titles stay on one line with
full content in tooltips/details. Overview cards may wrap their explanatory text.
