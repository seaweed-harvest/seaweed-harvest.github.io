# Dryer Table live analysis integration

Date: 17 September 2026

## Request

Add the validated Dryer Table analysis to the existing Dryer Table Records workspace as an **Analysis** tab, using the shared Seaweed Harvest shell and the same live Dryer Table ledger source as All Records. New dryer entries must flow into the analysis without regenerating a static data file.

## Repository and branch

- Repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base branch: `main`
- Exact base commit: `38c51255970436194a19ce076a7a7279005f39dd`
- Implementation branch: `release/dryer-analysis-live-20260917`

## Risk classification

Lane B / human-merge release. This is a meaningful Records UI feature and the final diff exceeds the Lane A line-count ceiling. It does not change authentication, permissions, payments, database schema, RLS, deployment workflows or secrets.

## Scope

- `dryer_table_records.html`: load the Dryer Analysis page module.
- `assets/js/dryer_table_analysis.js`: inject the Analysis tab/panel, fetch the existing authenticated dryer ledger RPC, derive run metrics, and render summary, weather/timeline, scatter and run-level tables.
- `assets/css/dryer_analysis_live.css`: analysis-only presentation using the existing Records workspace styles.
- `tests/dryer_analysis_live_contract.test.mjs`: deterministic source-contract checks.

No Supabase migrations, payment logic, permission changes, service worker changes or shared navigation changes.

## Acceptance checks

1. Dryer Table Records shows `All Records | Observations | Analysis | Payments`.
2. Analysis retains the normal Seaweed Harvest shell and Records-page layout.
3. Opening Analysis refreshes `list_authenticated_seaweed_drying_ledger`; no static dryer-run snapshot is used as the primary dataset.
4. A newly submitted dryer event therefore appears automatically when Analysis is opened/refreshed.
5. Summary, scatter and run-level source data derive from the live ledger rows.
6. Historical 4 September timing-confidence handling is preserved: 31 Aug NEW T1/T2/T3 runs are caution; the other 4 Sep bulk-unload runs are excluded from speed analysis.
7. Conditional formatting keeps temperature as green→yellow→red, humidity as light green→blue, and rainfall as white→blue.
8. Existing All Records, Observations and Payments panels remain untouched functionally.

## Weather-context limitation

The dryer event dataset is live. Temperature/humidity and regional-rainfall context currently use the validated analysis snapshot (temperature/humidity through 16 Sep 2026; rainfall through 15 Sep 2026). Dryer events after that point still appear automatically, but their weather enrichment is left blank until a repeatable live weather import is added.

## Test plan

- JavaScript syntax check for `assets/js/dryer_table_analysis.js`.
- Deterministic contract test verifies live RPC usage, Analysis tab installation, absence of the former `DRYER_RUNS` static source, timing-confidence rules, and requested heatmap palettes.
- Review actual PR diff before merge.
- Human browser smoke test after merge: open Dryer Table Records, select Analysis, confirm live rows render, then return to All Records / Observations / Payments.

## Rollback

Revert the release PR. The analysis is isolated to one page-loader line plus analysis-specific JS/CSS/test/planning files; no stored data is modified.
