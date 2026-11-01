# COSME metrics — mobile register list and compact controls

Owner request: 1 November 2026. Implement the mobile improvements agreed after
reviewing an iPhone screenshot of the All Metrics register.

- Target: `seaweed-harvest/seaweed-harvest.github.io`
- Base `main`: `bbd87af31a80c12630faf96f0590618356054a6e`
- Branch: `work/cosme-metrics-mobile-list-20261101`
- Scope: `cosme_metrics.html`, the metrics page script, metrics page stylesheet,
  and one focused contract test. No database, RLS, navigation, global style or
  deployment settings changes.

## Acceptance

1. On phones (up to 700px wide), do not show a truncated horizontal metrics
   table. Show full metric titles, activity, live/linked/published status and
   displayed values with units in a compact, vertically flowing list.
2. Use exactly the same selected records, live-data validation, current-value
   preference and metric details dialog as the desktop register. Published
   snapshots remain immutable and linked-only source data never gets a Live badge.
3. Preserve starred Top Picks, search, activity/category filtering, Linked data,
   Current values, refreshing, hidden metrics, column settings, reset and CSV
   export; reduce clutter using collapsible Filters and Actions controls.
4. Add touch-sized Live only and Top picks quick filters, synchronized with the
   existing source-of-truth control state; reset returns them to defaults.
5. Keep desktop table, sorting, column widths and pinned horizontal scrollbar
   unchanged; no change to permissions, data queries or backend.

## Tests, limits, rollback

- Review: execute `node --test tests/cosme_metrics_mobile_list_test.mjs` and
  existing COSME metrics tests, plus `node --check` on the edited JS.
- Browser verification still needed: 375/390/700/768/1280px widths, long
  names/values, popovers, touch filters, detail dialog, keyboard and VoiceOver.
- Rollback: revert this PR. No database migration, operational records or
  release pointers are modified.
- Deployment: this repository's current automation app-map explicitly has
  `deployment_enabled: false`; this branch is a reviewable frontend change.
  Do not treat it as production-deployed without a separate permitted release.
