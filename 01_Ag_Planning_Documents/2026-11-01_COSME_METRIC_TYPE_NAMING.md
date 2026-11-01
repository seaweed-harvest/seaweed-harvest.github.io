# COSME Metrics Register — consistent type grouping and site-qualified labels

**Owner request:** 1 November 2026. Group related metrics by their metric type,
and distinguish Mkwiro from Tumbe where structures reuse Raft A/B/C names.

- Source/deployment repo: `seaweed-harvest/seaweed-harvest.github.io`
- Base main: `d364211f45ec1d5a94c450bb7d5d664464c215de`
- Work branch: `work/cosme-metrics-grouped-labels-20261101`
- Scope: COSME metrics UI, presentation helpers, live CSV formatting, contract
  tests. No change to Supabase schema, operations records, grants or release data.
- Risk lane: B (more than six changed files). Human review and explicit
  publication approval required. The repository's automatic release controls
  remain disabled; no attempt to relax them.

## Source/title audit

Read-only audit of the current 1 November 2026 COSME release examined the
metric IDs, names, activity and themes (without editing any release records).
It confirmed:

- ON-0016: original 2025 4×5m design;
- ON-0034: Living Machines as-built rounded envelope, approximately 6.5×3m;
- ON-0064: September 2025 prototype, 6×4m;
- ON-0070: KMFRI 2025–26 trial, 4×5m.

They must all be displayed as distinct **Raft dimensions — [design variant]**
metrics, not mistaken for one or another project's dimensions. Source titles
and immutable values remain available on each detail view and in CSV.

- ON-0056/57/58: Mkwiro sample biomass Raft C/A/B at MK-R1/2/3 respectively;
- ON-0059/60: Mkwiro Shore A/B at MK-SF2/R2, MK-SF3/R3 respectively;
- The present validated, matched Raft/Shore comparison RPC source is
  Mkwiro-only (`MK-R*` ↔ `MK-SF*/R*`). Label it Mkwiro. Do not fabricate
  Tumbe comparison values or attach a site label to records without site evidence.

## Acceptance

1. A clear, consistent metric-type label groups comparable metrics within each
   activity; sort by metric type by default, while retaining metric-name and
   original-ID sorting and clickable table-column sorts.
2. The four raft dimensions appear close together in the register. Site-qualified
   names distinguish Mkwiro A/B/C sample records. Live daily growth comparisons
   display Mkwiro where the source MK pair codes prove it.
3. The existing owner-editable shared Top Picks, evidence, values, history,
   category/activity/linked filters, details, CSV export, and mobile card/table
   views still operate; no released content or identity is rewritten.
4. Search works against both new display labels and original source names.
5. CSV contains both reader-friendly display name and original source metric name;
   all published and live values remain unchanged.

## Checks and release gate

- Source modules and changed page scripts parsed in an isolated JavaScript
  harness. Focused runtime assertions cover four raft dimensions, all five
  site-coded Mkwiro sample labels, live MK-only labelling, grouping order,
  search, both CSV names and preservation of source values.
- Still required: full Node project test suite, browser layout and interaction
  probes at mobile/desktop widths, and authenticated production checks.
- Rollback: revert the frontend PR, with no database migration or frozen metrics
  publication to undo.
- Keep in draft until required review checks and owner release approval.
