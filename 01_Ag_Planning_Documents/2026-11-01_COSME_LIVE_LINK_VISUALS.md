# COSME metrics: live-link clarity and overview navigation

Owner request: 1 November 2026. Work scoped to the existing COSME Project Metrics
page only; no Mawimbi forms, operational ledgers, permissions, or database changes.

- Repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base main commit: `e7e112120ef943b512aff6a205f6e5ed1bc56974`
- Branch: `work/cosme-live-links-and-overview-20261101`
- Frontend classification: review-required UI change. The separate proposal to add
  new live-data RPCs or release-publication actions is protected work, not in scope.
- Rollback: revert the frontend PR; no data migration or release pointer changed.

## Acceptance criteria

1. An All Metrics row is visually marked as linked only if an authorised,
   validated current aggregate has succeeded during this browser session.
   Historic source citations alone do not qualify.
2. The latest register automatically shows the validated current value for
   exact metric-level matches, with a prominent Live label and check time.
   Its original published value remains immutable, appears in metric details
   and is included alongside the current value in CSV export. Historical
   release selection always shows frozen values.
3. Users can filter to live-linked rows without changing shared Top Picks.
   The count separates exact Live calculations from related Linked data.
   The Current values switch permits reviewing the frozen figure in the latest
   release without changing the underlying record.
4. The bottom horizontal scrollbar is visible whenever the register is
   onscreen and wider than its container, including narrow viewports.
   Synchronise both directions without adding page-wide horizontal overflow.
5. Restore distinct, clickable Overview activity cards using actual populated
   counts; clicking filters All Metrics.
6. Explain that releases are immutable, reviewed, owner-approved snapshots;
   no unauthorised in-page publish control or implicit releases.
7. Preserve existing Project Highlights selection for now, but display the
   live calculation where an exact selected metric has a verified overlay.
   Curating 4–8 outcome-oriented KPIs is a separate follow-up.
8. Refresh validated aggregates on page open, foreground return, on-demand
   and every five minutes while the authorised page is visible and online.
   Failed checks fall back to published values; never imply streaming updates.

## Live-source audit and limitations

- COSME dryer adapter: SDT-0022, 0063, 0064, 0065, 0066. This is a
  validated current aggregate for completed Bati tables, not Dryer Shed.
- COSME nursery: ON-0054 is linked to validated current rope-coverage counts.
  Nursery growth and variability are available in Current data, but cannot
  yet be mapped honestly to individual historical metric values without
  reviewed metric-level definitions.
- Mawimbi: MAW-0082 and MAW-0086 current operations context, and MAW-0087
  current stock-QC field-presence context, require separate authorised
  aggregate access. They do not establish batch traceability, extraction yield
  or calibrated QC compliance.
- Aggregation Hub: no verified live adapter in the page. Do not colour it.
- **Six metric IDs** receive directly substitutable, live current values
  (five dryer and one nursery coverage). **Three Mawimbi metric IDs** have
  informative but non-equivalent linked data. Green Live and neutral Linked
  must never be confused. Adapter failures revert to Published.
- CSV exports include the currently displayed value and separate frozen
  published value, version and source timestamps. No operational data persists
  in the browser beyond the existing session state.
- Linking more metrics requires definition-by-definition source matching,
  scope validation and, when needed, a separately approved backend change.

## Tests and release gate

The owner approved proceeding and asked for automatically updated live values
on 1 November 2026. The update is implemented in the same review branch with
a pure overlay adapter and explicit published/live display states.

Review checks: 38 existing metrics tests and 10 new logic/static tests pass
in an isolated JavaScript test harness; source-page, core and adapter syntax
compile; CSS braces are balanced; no protected paths changed. GitHub reported
no CI statuses/workflow runs for the branch. Browser layout and actual project
Node test command were not executed from this chat environment. Actual diff is eight files and more
than 400 changed lines, so Lane B review rather than Lane A applies.
Still required before merge/deployment: the repository's complete existing
test suite, browser layout and keyboard probes (desktop and narrow/mobile),
final diff review and a successful publication check. No production mutation,
migration or release update was made by this implementation.

## Mobile access and release-gate review (1 November 2026)

**Owner request:** Make the Metrics page available on an iPhone and deploy the
changes live. Mobile acceptance: a signed-in account with a dedicated COSME
Metrics grant finds Project Metrics in the mobile Tools drawer, regardless
of active organisation; accounts without the server grant do not see the
shortcut; the direct URL supports sign-in return and does not broaden ledger
permissions; Overview cards and All Metrics work at phone widths.

**Implementation:** The shared navigation checks the dedicated authorised
RPC for each signed-in profile, independently of its active aggregator.
Only a successful grant reveals the mobile Tools section and Project Metrics
shortcut. Metrics and Home entry points use a new versioned navigation import.
The phone tabs now scroll horizontally with touch-friendly 44px controls,
and the mirrored table scrollbar respects the bottom safe area.

**Checks:** Relevant JavaScript source syntax parsed; ten source/negative
permission assertions passed. A component-level Chromium browser fixture at
375, 390, 768 and 1280px confirmed constrained page widths, horizontally
scrolling table, two-column cards at phone size and mobile-tab access.
This fixture is not a substitute for a full signed-in browser probe of the
actual staging/production page. Seven live-value unit tests pass after the
derived dryer-reduction validation correction; earlier existing metrics
logic tests passed in an isolated JS harness.

**Change classification:** Shared `assets/js/app_navigation.js` is Lane B.
No Lane C files or Supabase permissions/grants were altered. Actual changed
paths and diff must be reviewed before any merge.

**Deployment gate:** `.automation/app-map.yml` currently declares
`deployment_enabled: false` with a `deployment_when_disabled: stop`
routing rule. The development policy also disables automatic deployment.
The user requested a live release, but the AI deployment control has not
been changed. Do not circumvent it; keep production unchanged pending
the approved manual release procedure and full authenticated live checks.
