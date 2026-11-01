# Project Metrics presentation cleanup

Direct owner request, 1 November 2026: simplify the overview, remove the outlined
favourites appearance and explanatory footer text, omit placeholder rows, and
provide named assessment groups when supported by original sources. Preserve the
compact single-line register, left-aligned values and visible units.

Repository: seaweed-harvest/seaweed-harvest.github.io. Exact base live/main:
`6f1b1ffec1a262a8aa3b225dacfa66c61f5b8661`.
Branch: `work/metrics-overview-cleanup-20261101`.

Frontend scope (Lane B): cosme_metrics.html, page-specific CSS/JavaScript, one pure
presentation helper, synthetic tests and this plan. Existing shared star/access
services and immutable release data remain unchanged during presentation work.
No private evidence names or raw report data may be embedded in public JS assets.

Acceptance checks:

- Overview shows compact activity navigation and plain clickable highlights,
  without star controls, outlined favourite cards or explanatory text blocks.
- Existing current-data panels are accessible in a separate Current data view.
- Register/category/activity counts, highlights and CSV use populated metrics;
  zero values and meaningful negative test results remain visible.
- Blank, missing and placeholder values are omitted without deleting records.
- Clicking a value opens the same details as clicking its metric title.
- Evidence detail can show named groups, source location and derivation method
  from an authorised release payload; no inferred or invented group membership.
- Register rows remain 34 px with a compact leftmost star and left-aligned units.
- Status text is concise and appears for operations/errors, not permanent guidance.
- Run all metrics tests, syntax/diff checks and desktop/narrow-browser probes.

Research: the January 2024 assessment analysis matrix identifies 16 groups, with
four marked new to seaweed farming. The March 2025 innovation report confirms a
12-group experienced denominator. The drying challenge rows identify eleven
groups overall, ten after excluding the new-group population. The July 2025 FGP
summary names the five represented drying-rack groups. Private source coordinates
and group lists are retained in the local evidence proposal, outside this public
repository. Sources are read-only.

Owner-approved content update (1 November 2026): append a small V0.3 evidence supplement
using the existing release model, copying existing values and original payloads,
and carrying forward the latest shared picks. Seven supported assessment metrics
receive source_evidence, the actual assessment month, Source checked verification,
Report snapshot source mode and an assessment/focus-group response-count basis.
No new schema, policy, grants, business-record or financial
logic changes. Validate exact list counts/source coordinates and original payloads;
rehearse the append in a rolled-back transaction before any authorised apply.
Rollback restores the previous current-release pointer and reverts the frontend;
all immutable evidence/history and shared audit events remain intact.

Draft PR #142 and the private evidence proposal were prepared before approval.
The owner explicitly approved publishing the cleanup and applying the reviewed
group details to seven existing metrics on 1 November 2026.

Implementation and verification (1 November 2026):

- 38 metrics tests pass, including synthetic placeholder/zero/negative-value,
  optional evidence validation, shared-selection, unit and category contracts.
- Changed JavaScript syntax and diff whitespace checks pass.
- Private local preview: 291 populated records; 36 placeholders omitted from
  counts, highlights, register and CSV. Original release records remain intact.
- Desktop and 390 px browser probes: all rows are 34 px; stars are 24 x 24 px;
  all value buttons are left-aligned; neither view causes page overflow.
- Clicking the assessment value shows the ten named groups and matrix location.
  Browser fixtures verify shared-star persistence after reload and detail updates;
  no browser console errors. These are local previews, not production changes.
- Record metadata is collapsed; evidence and ordinary source details remain
  available on demand. Current calculation modules remain in Current data.
- Actual frontend diff is seven files, Lane B. No protected paths are changed.

Evidence supplement apply plan: use the existing append-only release model for
V0.3, keeping 327 metric IDs and all values, units and original evidence objects.
Lock the project row (the same lock used by shared-star writes), confirm the
reviewed V0.2 hash, and carry forward each effective current shared selection,
including user overrides. Add the five reviewed metadata fields to exactly seven
records. Check counts of 16 surveyed, 12 experienced, 10 drying-challenge,
8 seed-challenge and 5 focus-group participants against source coordinates.
Rehearse the transaction with rollback, then apply only with explicit approval.
Confirm unchanged V0.1/V0.2 payload fingerprints, all 327 values/units/originals,
seven evidence lists and the carried selection before publishing the pointer.
If needed, restore the pointer to V0.2; retain V0.3 and all audit/history records.
The private local evidence proposal contains the names and exact source locations;
it is intentionally excluded from the public PR. Import implementation and writes
were performed only after the protected-work approval.

Evidence supplement result: the rehearsal passed and rolled back to V0.2. The
authorised append published V0.3 with 327 records and seven group lists, preserving
13 effective shared selections (including all three prior user overrides).
Fresh committed-state checks report zero changed values, units, original evidence
objects or effective selections. V0.1 and V0.2 fingerprints remain unchanged.
V0.3 content SHA-256:
`d29a43085f4b080b53e0d598af46543f5d397dcd2a2df05e074c08bcd5729897`.
