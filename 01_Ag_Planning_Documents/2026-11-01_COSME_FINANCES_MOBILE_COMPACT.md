# COSME Finance mobile layout refinement — 1 November 2026

**Request:** The owner provided mobile screenshots of the Finance tab, reviewed a compact alternative and explicitly asked "Please update." No request to change monetary records or accounting logic.

## Scope and authority

- Repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base: `d364211f45ec1d5a94c450bb7d5d664464c215de`
- Branch: `work/cosme-finances-mobile-compact-20261101`
- Changed surfaces: COSME Finance read-only presentation, CSS, cache references, deterministic tests and this plan.
- Finance-named paths are **protected Lane C** per `.automation/protected-paths.yml`. The owner approved the described implementation by saying "Please update." **Merge and production publication remain separate human approval gates.**
- No change to `cosme_finance_read`, grants, underlying packages, amounts, exchange rates, classifications, source rows, approvals, payments, source attribution, private records or database.

## Acceptance criteria

1. On phone widths up to 700px the initial control block is short: side-by-side Project costs / Expenses selector, one search field, then two collapsed touch-accessible toggles, Filters and Actions.
2. Activity and Cost basis remain functional within Filters; Refresh and Export stay accessible under Actions. Buttons report `aria-expanded` and preserve their open state when filters or modes redraw.
3. The collapsed project summary shows a **labelled source-derived total** and (where comparable) per-raft or per-table rate, with clear scope / classification. Do not imply paid status when source only establishes owner-confirmed actual cost.
4. The Solar Drying Tables reference uses owner-confirmed `v13-plan-10` actual costs, not receipt status; Offshore Nursery uses `nursery-future-4-rafts` partial four-raft estimate. Aggregation proposal and Mawimbi planning budget are labelled accordingly.
5. Expanded package rows show the package total, unit cost (where defined), date, and original financial basis/status. Nested categories remain expandable and the price lines show a compact 2-column description/amount layout on mobile, while the full table remains visible on desktop.
6. Entire project/package/category headings remain tappable. One chevron convention, consistently on the right on phone.
7. No change to search, ledger query, expense regrouping, financing totals, source references, CSV detail or mobile/desktop access.

## Verification

- JS modules parsed in isolated runtime (core, view and panel); CSS braces balanced; asset versions updated.
- 4 focused synthetic-data interaction checks passed: expanded source refs and data, correct project totals/rounding and status scope, filter/action ARIA toggles surviving redraw, and desktop + mobile source line representations.
- Existing `tests/cosme_finances_compact.test.mjs` updated only for asset version strings; added `tests/cosme_finances_mobile_compact.test.mjs`.
- **Before merge:** Run native Node finance tests and signed-in browser checks at 375px, 390px, 700px and desktop 1280px. Verify no page overflow, visible cost totals, Chevron and nested details, device touch and keyboard controls; verify categories and CSV unchanged.
- Missing native test runner/UI probe is a release blocker. Keep PR draft.
- **Rollback:** Revert this front-end PR; no finance source data or permissions changed.

## Source basis notes

These labels represent different cost scopes and should **not** be compared as equivalent:
- Solar Drying Tables: KES 2,471,500 / 10 tables = KES 247,150 per table, owner-confirmed actual project cost supported by original supplier quotation, not a payment receipt.
- Offshore Nursery future repeat-build: KES 1,081,868.80 / 4 rafts = KES 270,467.20 per raft, partial estimate, excludes several mobilisation/deployment items.
- Offshore Nursery V1.2: rough design materials-only estimate; V1.3 LM/PLAN: invoiced historic component packages.
- Aggregation Hub: KES 3,831,250 consultant proposal, not expenditure.
- Mawimbi: planned budget with KES and CAD references, not paid status.

All displayed amounts derive from authenticated existing `cosme_finance_read` records; no new hardcoded financial values in the front-end.
