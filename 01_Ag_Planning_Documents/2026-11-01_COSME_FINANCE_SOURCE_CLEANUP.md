# COSME Finance source and reporting cleanup — 1 November 2026

Owner request: cross-check closeout workbooks and COSME Drive; correct BOM scope/category handling, reduce text, align filters with All Metrics, show unit costs and dates, treat confirmed costs as actual/paid, remove Current data navigation.

Base: 30341e6b44e36da0fccb05e34866f6d7b20ad454. Branch: feature/cosme-finance-source-cleanup-20261101. Risk: C (financial source integrity), implementation explicitly requested in chat. Existing release approvals cover preceding finance release; this review is prepared as a new concrete revision.

Acceptance: priced source lines occur once under meaningful categories; headings and spare lists never inflate a table BOM; reconstructed estimate uses closeout proxy-rate evidence; July/August categories align; per-raft quantities reflect one and three rafts; dated references distinguish installation from invoice/expected delivery; paid Mawimbi source amounts and funders preserved; compact white panel with horizontal filters; stable expansion; no Current data navigation; operational live metric feeds preserved.

Implementation: immutable private source/package revisions, no financial schema/RLS/auth changes; old packages and rows preserved. Frontend generic report metadata supplies dates, budget and accepted differences without hardcoding private source values in public code. Unpriced genuinely optional scope appears once in a collapsed options section, without broad warning boilerplate.

Testing: focused financial helpers, rendering/expansion tests, syntax checks, desktop/mobile UI probe; private import rollback rehearsal, totals/unit/funder assertions, positive/negative access and idempotency. Review actual diff before release.

Rollback: close draft PR before release; after release revert frontend; publish a new restoration revision from the previous immutable financial snapshots. Never mutate historical published values or operational payment/stock records.

Source access: attached dryer and nursery closeout workbooks and V1.1/V1.2 BOMs; original V1.3 BOM and updated asset master from Library; July aggregation and asset master cross-check from connected Google Drive. Windows D: folder is not mounted; do not claim it was read. Source extracts/imports stay private, outside git. Exact V1.3 deployment and QC/press installation dates require supporting event evidence; never relabel quotation or expected-delivery dates as actual installation.

Validation completed:
- 30 focused Finance logic, metadata, category, unit-cost, read-only, rendering and expansion-state tests pass; changed JS syntax checks pass.
- Wider COSME suite has two existing failures (hydrometer static count and stale renderHeadlines presentation assertion), reproduced unchanged on detached base 30341e6. They are outside this reporting scope; no new failures were introduced.
- Full private revision set inserted twice, published and read in one rollback-only transaction: no duplicates, 18 published scopes, one/three-raft units, metadata availability, paid COSME funder total, and anonymous/ungranted rejection all passed. Rollback confirmed.
- Ten corrected packages now exist as PRIVATE DRAFT revisions only. Existing 18 published packages remain active. Published package immutability and operational ledgers are untouched.
- Browser visual preview unavailable: cloud browser cannot reach the local server; data-protocol previews are blocked by its URL policy. No workaround attempted after that rejection. UI interaction probes pass, but real signed-in desktop/mobile visual QA remains outstanding.

Release gate: review this concrete diff and approve publication of ten source revisions plus read metadata function and frontend. Previous approval released PR 152; this is a separate new correction set. Repository AGENTS.md requires separate human approval before merge. Do not claim live deployment.
