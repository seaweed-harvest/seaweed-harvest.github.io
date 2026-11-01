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
