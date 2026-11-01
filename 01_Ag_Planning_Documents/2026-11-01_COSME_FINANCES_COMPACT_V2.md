# COSME Finances — compact project-reference follow-up (2026-11-01)

## Request and owner intent
User provided live screenshot and requested: concise single-row formatting matching All Metrics/Timeline; expand for item details; cost-per-table labels for **every** dryer version including one-table builds; clearly distinguish design/pre-build vs as-built vs supplier quote; preserve separate source evidence and full 10-table PLAN quote total; avoid duplicated prose; stable open sections on automatic session refresh; dates for offshore nursery; optional activity and cost-basis selectors; general expense sheet under its own internal subview; data should inform project delivery, not become accounting software. Also supplied an early marine nursery single-raft spreadsheet as **V1.2 Design — rough values, materials only, excluding labour**.

## Scope of draft change
- Existing COSME Metrics Finances tab only; no operational stock, finance ledger or payment mutations.
- Replace tall activity cards with a compact shared register format: Stage, Date, Basis, Cost per unit, Package total, Status. Sections expandable to categories, parts and original row reference. Dates from actual source dates or entry-date ranges; when using month from source filename show an explicit asterisk qualifier.
- Inside Finances, split **Project costs & estimates** from **Expense register**. Project view has activity and basis drop-downs; expense view has an activity selector and category-level summaries; raw individual expense rows are hidden until expanded.
- Unchanged auto-refresh no longer replaces the DOM; changed refresh preserves expanded rows. Manual Refresh remains available. This does not change the underlying authorisation behaviour.
- V1.1 as-built source is still **estimated/costed BOM**, not verified paid; V1.3 PLAN 10-table procurement is still a **quote**, not certified as-built expenditure. Cost per table and full batch total are both displayed. No source numbers are adjusted.
- Draft-only early nursery source in existing private COSME Finance schema, SHA-256 `6719038169b6c9b9bd44092bb3e2e07a2fee20e1bb7a4b9c15cad7e2bc940c3a`. Source `BOM - HDPE Raft Single`, one raft and mooring system, **KES 70,850** priced items: frame 42,950; mooring/anchor 26,400; lines 1,500. 23 priced lines + 3 unpriced netting alternatives (not included). Excludes labour, tools and deployment; no exact source date, Jan 2026 is filename month. Two polyurethane entries both called Part A; source unchanged. Concrete sinker assembly and ingredients are priced in the same source and possible overlap remains marked for review. No existing nursery invoices altered.

## Source questions (non-blocking for UI release)
1. V1.2 pre-build dryer source summary KES 162,970 vs itemised list KES 178,670. Which total is intended? Continue showing source-reported figure with difference in expanded note.
2. For PLAN V1.3 dryer production, is a paid/final as-built invoice available? It must remain labelled *quote* until then.
3. Resolved: Offshore Nursery close-out BoQ, `BoQ detail` rows 43–44, explicitly records both LM invoice dates as **2026-07-28**; display these exact dates. October 2026 is the BoQ file month, not invoice date.

## Tests and release gates
- Four focused compact UI tests passed in isolated JS harness: matching page, stage labels, unchanged refresh preserves same open nodes, changed payload restores expansion, and expense subview excludes project cost rows. Existing nine finance logic and seven contract tests need to be run too.
- Staged source row counts/total and SHA validated; new nursery source held `publication_status='draft'` pending code review/release.
- Manual authenticated desktop/mobile/keyboard probe still required. Validate no flashing/open-state reset on window visibility and 375px/desktop widths. Check expense category summation, source dates, and no double-counting.
- Lane B/C: protected finance source data and read roles must stay untouched. No automatic merge/deployment; repository setting `deployment_enabled=false`. Reconcile actual changed paths before human-approved manual release.
- Rollback: revert new frontend code commit; if nursery reference was published, change only that new package from `published` to `superseded` (published snapshots are immutable). Draft source/rows can remain as private audit evidence.
