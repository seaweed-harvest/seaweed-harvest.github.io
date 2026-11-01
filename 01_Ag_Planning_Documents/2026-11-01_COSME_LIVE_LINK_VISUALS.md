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
2. The row's value remains the selected frozen release value. Current values
   continue to appear separately in Current data and relevant detail views.
3. Users can filter to live-linked rows without changing shared Top Picks.
   The count identifies how many current adapters are linked this session.
4. The bottom horizontal scrollbar is visible whenever the register is
   onscreen and wider than its container, including narrow viewports.
   Synchronise both directions without adding page-wide horizontal overflow.
5. Restore distinct, clickable Overview activity cards using actual populated
   counts; clicking filters All Metrics.
6. Explain that releases are immutable, reviewed, owner-approved snapshots;
   no unauthorised in-page publish control or implicit releases.
7. Preserve existing Project Highlights selection for now. Its curation
   into 4–8 outcome-oriented, source-verified KPIs is a separate follow-up.

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
- Thus **up to nine specific rows** can be highlighted, depending on
  available release rows and successful authorised data responses.
  Connection failure produces no green marker.
- Linking more metrics requires definition-by-definition source matching,
  scope validation and, when needed, a separately approved backend change.

## Tests and release gate

Synthetic/static assertions inspect the DOM hooks, current-aggregate guards,
frozen-value boundary and scrollbar wiring. Syntax compilation is included.
Still required before merge: desktop/mobile browser layout and keyboard probes,
actual diff review, existing metrics test suite and explicit approval under
repository policy. No deploy was authorised by this planning document.
