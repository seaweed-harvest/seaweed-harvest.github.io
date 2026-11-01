# COSME Finances tab — staged implementation

Date: 2026-11-01. Direct owner approval in chat: "perfect, please implement, take your time, stage it as needed".
Target: seaweed-harvest/seaweed-harvest.github.io (COSME Project Metrics). Exact base main commit: `9634e7b4c8a45109c40d56f8bf6d7987948c5296`. Implementation branch: `feature/cosme-finances-staged-20261101`.
Risk: Lane C for finance data integrity and private Supabase schema/RPC; Lane B for cross-file feature. This is staged work only. **No production migration, financial import, merging or deployment without separate review of actual diff and explicit release approval.** App-map has deployment_enabled=false.

## User problem and scope
Provide one Finances tab within COSME Project Metrics, alongside Timeline once that pending feature merges. Clear activity / prototype version totals, with expandable categories, individual lines and their evidence. Avoid a second accounting system. Financial aggregates distinguish estimate, quoted, invoiced and paid; never add these bases together. Funders and currency stay explicit and never auto-convert. Imported costs remain separate from operational live ledger and frozen metrics releases. The existing Metrics access grant remains the sole read-authorisation gate.

## Proposed implementation
1. Add *private* `cosme_metrics.finance_sources`, `finance_lines` and `finance_allocations` tables, RLS on, revoking anon and authenticated direct access. Store source IDs, version, activity, category, subcategory, line, amount, currency, basis, payer/funder, status and source position. Keep line-level evidence; uniqueness on source + source row; no duplicate source versions.
2. Add tightly scoped authenticated read-only `public.cosme_finance_read()` RPC using existing `cosme_metrics.caller_role()`. All financial records are returned as source-backed units; client computes one basis at a time, no payments or stock tables are modified. Reconcile source subtotals to advertised control totals.
3. Add a mobile-friendly Finances tab in the *existing* Metrics page: activity cards, basis filter, version breakdown, expandable categories and line items. Error and empty states must never silently show sample figures.
4. Prepare private import/reconciliation package from uploaded source workbooks (not a public GitHub JSON file). Each document has source ID and hash and lineage. Keep estimates vs quotes vs invoices vs paid distinct. Import is a separate gated production step.
5. Timeline remains a separate in-progress branch. Its pending tab will be integrated without copying or overwriting its independent source changes.

## Acceptance checks
- Existing Metrics owner/editor/reader can view; anonymous and ungranted users cannot; no direct raw table SELECT.
- By default summaries are separated by cost basis and currency; "Total spent" means verified paid records, not BOMs or supplier quotations.
- Expand activity -> version -> category -> source items, keyboard and narrow phone widths work.
- Every cost shows source name, date if available, and row or reference. No public bundle of costs or personal details.
- Repeated imports are idempotent. A new source revision never silently replaces prior figures. Double-counted invoice, quote and purchase representations can be explicitly excluded from financial totals.
- Discrepancies carry review status rather than altering values. Missing data is shown as unavailable.
- Existing immutable metrics releases, existing finance forms and transaction ledgers stay unchanged.

## Test plan (required before production)
Pure helper/unit tests: basis/currency isolation, exclude cross-source duplicates and excluded lines, no numeric coercion of blank/unpriced, version and category totals, source lineage and zero/negative credit handling. Frontend static and syntax checks. UI probe of tab, keyboard and 375 px/390 px/desktop widths. SQL migration transaction rehearsal with rollback; positive owner/editor/reader, negative ungranted/anon, RLS grants, RPC read-only and search_path tests. Source reconciliation checks against BoQ control totals. Signed-in deployed smoke test after approved release.

## Source reconciliation and observations
- Seven original workbooks, thirteen cost packages, and 469 source line items were
  hashed and reconciled in **private staging files only**. Their values, source
  rows, receipt identifiers, and personal details must not be committed to
  public GitHub source or test fixtures.
- Two early dryer-BOM control totals do not match the item-level sums. They
  remain flagged for reviewer reconciliation; original source values are preserved.
- A later production quote and offshore nursery invoice groups reconcile to
  their respective controls. Cost bases still differ and must not be combined.
- Supplier quote photographs represent supporting evidence for one quotation,
  not additional expenditure.
- Asset allocations may overlap receipted costs. Do not treat a funder's
  allocation as a second transaction.
- Converted procurement totals retain currency and FX evidence; do not sum
  different currencies without an explicitly documented translation.
- No source expense details may enter the public repository. Import batches
  remain private drafts; publication requires an independent owner review.

## Implementation progress (2026-11-01)
- Existing COSME Metrics page wired to lazily loaded read-only Finances panel
  with activity / version / category / subcategory / item expansion and source
  references; responsive CSS and CSV export prepared.
- Private-scope schema and authenticated, access-controlled read RPC staged as
  migration only, not applied. Four tables use RLS with direct authenticated and
  anonymous access revoked.
- Fourteen focused unit / static contract checks passed in a JS harness, plus syntax
  checks for the panel and metrics page. No signed-in browser or SQL migration rehearsal
  has yet been completed. GitHub branch needs draft PR and CI review.
- The private staging import now records entry_date for 251 lines, keeps three inconsistent
  asset receipt dates null with reviewer notes, preserves original transaction
  currency separately from reporting currency, and verifies all seven workbook
  hashes plus expected line counts in a transaction. Nothing has been applied.
- All imported packages are `draft`; empty published state is deliberate
  until reviewed and expressly authorised. No production data changed.
- Timeline work is on an independent pending PR; integrate tab ordering only
  after conflict-aware merge of those changes.

## Rollback
Before deployment: close draft PR and leave production untouched. After authorised deployment: revert frontend commit; drop only the new private COSME Finance RPC and tables if there is verified no dependent data, otherwise revoke RPC execute and preserve private evidence; no changes to existing finance or metrics tables. Preserve source/import audit history. No automation flag modification.

## Aggregation Hub source addendum (2026-11-01)
User supplied two further sources for the **Bati dry seaweed aggregation centre**:
- July 2026 Cascadia scoping BoQ, with Eng. Tom technical support. Four workbook tabs; the controlling priced "Aggregation Hub BoQ" contains **36 priced source rows totalling KES 2,065,520**. This is an estimated working scope, *not cash expenditure*. The historical "BoQ Simplified (Original_" tab contains `#REF!` formulas and should not become a separate additive package. Two source rate/amount inconsistencies (solar system: rate 338,000 vs total 320,000; stitching material: rate 5,000 vs total 60,000) and ambiguous safety labels are flagged. One pallet stacker row says "ACTUAL" but is not proof of payment.
- Eng. Tom signed August 2026 consultant proposal, dated 3 August and signed 5 August, **52 priced rows and KES 3,831,250** total. Pages 1–2 cover KES 2,561,000 site works/equipment/commissioning, and page 4 covers KES 1,270,250 consultant fee, accommodation, travel and logistics; direct professional supervision is KES 640,250 *within* the latter. PDF marks KES 840,000 of grading tables, baler and installation "Covered by Cascadia"; this is a *stated allocation*, not verified contribution or payment.
- The two are different **dated scope/proposal stages**, not additive transactions. Show under the same Aggregation Hub activity and separate version/date labels. A numeric July–August comparison needs scope qualification; do not infer a like-for-like overspend.
- Updated **private** staging dataset: 9 source files, 15 draft cost packages, 557 source-referenced items (+2 sources, +2 packages, +88 rows). SQL import draft remains outside GitHub with all packages `draft`. Original PDF personal contact details remain in the source, never copied to public assets.
- Also found and corrected a preexisting truncated `rate_currency` column/check in the proposed migration. Still requires a transaction rehearsal and role-based security tests. **No production import, publication or migration authorised by adding files.**

## Timeline integration and migration cleanup (2026-11-01)
- Merged the existing Timeline production/main commit `d984b6dd60a9b2a97c659694f6da3c397eb5d4a3` into Finance draft branch. Preserved Timeline UI, refresh/clear data logic, and added Finance tab after Timeline.
- Combined page JavaScript parses, both tab/section IDs appear once, the Finance panel loads lazily only after existing COSME Metrics access is confirmed, and the previously merged Timeline remains intact.
- Repaired an accidentally repeated DDL portion in the proposed private migration. Single source/package/line/allocation table, read RPC and immutability trigger function definitions; single PostgREST reload; four private tables enable RLS.
- Nine focused financial calculation tests and seven static/contract checks passed in isolated JavaScript harness; the new contract test checks against duplicated DDL before any rollout.
- Read-only production inspection confirms the existing `cosme_metrics.caller_role()` predicate uses active non-expired grants, active profiles and enabled COSME project; Finance RPC calls this same function. The new finance tables and RPC are absent from production.
- Latest draft PR #145 is mergeable against main, but remains in protected review Lane C. The private source import is still NOT applied; all fifteen proposed packages retain `draft` in private staging.
- **Still missing**: full native repo tests, authenticated desktop/mobile browser checks, a SQL transaction rollback rehearsal and positive/negative RLS tests. Do not merge or deploy finance migration or the draft import without the remaining gates and explicit release approval.

## Rollback-only schema rehearsal (1 November 2026)
- Executed the complete private finance DDL within a single PostgreSQL `BEGIN ... ROLLBACK` transaction against the connected Seaweed Harvest Supabase project.
- Transaction assertions passed: exactly four private tables and RLS enabled on each; no direct `anon` or `authenticated` SELECT on financial lines; `anon` cannot execute the read RPC; `authenticated` has RPC execute but the unauthenticated identity is rejected; the existing COSME owner's identity passes the grant gate and sees only empty published arrays.
- Post-rollback verification returned **0** finance tables and **no** public finance read RPC. This is a reversible schema rehearsal, not a production migration or import.
- Private draft importer regenerated with all 557 source line positions, 241 source payment dates, 14 missing dates, and the originating payment currency for 255 procurement rows. Thirty-seven source `KSH` labels standardised to ISO `KES` with the original label retained in row notes. All nine SHA-256 source hashes match originals.
- The private import is **not executed**. Still required: import-in-transaction rehearsal, idempotency and full role-negative tests, authenticated UI/mobile check, published-package reconciliation, reviewed manual release. Do not include private raw imports in public GitHub.
