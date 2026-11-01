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

Review checks: 10 focused logic/static tests pass in a sandboxed JavaScript
test harness; source-page, core and adapter syntax compile; CSS braces are
balanced; no protected paths changed. Actual diff is eight files and more
than 400 changed lines, so Lane B review rather than Lane A applies.
Still required before merge/deployment: the repository's complete existing
test suite, browser layout and keyboard probes (desktop and narrow/mobile),
final diff review and a successful publication check. No production mutation,
migration or release update was made by this implementation.
