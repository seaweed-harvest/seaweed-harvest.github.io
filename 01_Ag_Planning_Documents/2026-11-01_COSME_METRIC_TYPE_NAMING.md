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

## Second review pass (1 November 2026)

A read-only inspection of every ID, activity and frozen title in the current
release counted 347 published metrics: 64 Aggregation Hub, 101 Mawimbi,
81 Offshore Nursery, 81 Solar Drying Tables and 20 Off-bottom Farming.
This is separate from the current live operational indicators.

The initial type rules placed several metrics under an unrelated common word
rather than their meaning: raft supplier invoices under raft design, actual hub
site cost under deployment, hydraulic baler purchase price under performance,
weather protection under temperature, press frame allocation under productivity,
and drying-area cost savings under dimensions. The audited classification now
uses narrow type patterns and explicit, traceable exceptions by metric ID.
Every published metric now has a named group; no published metrics remain in
the generic "Other metrics" group.

Added focused classification regressions for the identified cases. No new
derived values, site assignments, metric IDs, report figures, shared picks or
release records were created. PR remains a draft for Node suite and browser
review before separate release approval.

## Complete naming review (1 November 2026)

The owner requested a further, complete pass that puts the core metric first,
followed by the site, period, design, status or measurement basis. The exact
branch base remains `d364211f45ec1d5a94c450bb7d5d664464c215de`; this
pass continues draft PR #157 on the same branch and stays in Lane B. Changed
paths are the presentation helper, its focused tests, this plan and the
before/after comparison. No protected path, release payload, metric ID,
published value, permission, live calculation or shared pick is changed.

The read-only current-release query returned 347 IDs, titles and notes across
the five activities (64 Hub, 101 Mawimbi, 81 Nursery, 81 Drying Tables, 20
Off-bottom). Notes were checked where a proposed label could imply an achieved
outcome. Of those 347, 271 receive a clearer display name and 76 retain their
source title. All 347 still have a named metric type; there are no duplicate
display names within an activity. The current code can also show 17 fixed
live indicators and three Mkwiro matched-pair comparisons. All 20 receive
quantity-first names when present; the live source titles and values remain
unchanged. Pair labels require the validated MK site codes.

The complete [before/after comparison](2026-11-01_COSME_METRIC_NAMES_BEFORE_AFTER.csv)
lists each published ID and each potential live indicator with its activity,
original title, proposed display name, metric type and retain/revise decision.
The live rows were generated with synthetic values; their presence in a user's
view still depends on permissions and current operational data. The comparison
contains no notes, underlying values or private source documents.

Review examples: storage capacity before upgrade is explicitly unmeasured;
factory bale times are reported, not verified site performance; the site bale
cycle time is pending; final recorded drying mass does not claim measured
moisture content; modelled nursery harvest and plot design remain models;
selected dryer comparisons retain their selection qualifier. The original
titles remain available in details and CSV for source traceability.

Acceptance checks for this pass: review all 347 title/note pairs and live
definitions; keep meaningful baselines, targets, reports, models and missing
results distinct; preserve immutable release and live values; search both
names; run the COSME test suite, syntax checks and a narrow/desktop UI probe;
inspect the final diff and leave PR #157 in draft. Rollback is a frontend PR
revert. Merge and deployment require separate owner approval.

Verification: 74 COSME Node tests pass, including a complete comparison/map
contract; changed JavaScript syntax and diff whitespace checks pass. A local
browser fixture with synthetic values showed the 347-row register, type
headings, original-name search, source title in Details and no page overflow
at desktop 1440 px and emulated phone 390 px. The fixture has no permitted
live feed, so it cannot verify authenticated production live values or grants.
Across all historical releases, ten IDs have changed source titles. Nine of
these use display aliases in the current release; exact-title guards keep
their earlier frozen titles from inheriting the later label. The tenth title
is retained in this pass. A regression test covers the nine guarded cases.
