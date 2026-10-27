# Dryer reweigh reporting and recovery — 26 October 2026

## Request and scope

The owner confirmed that older dryer entries and reweighs must be preserved, asked for a safe move into the main Seaweed Harvest Supabase project, and asked that Records and Analysis show the latest individual measurements. This branch prepares the form, records, analysis, payments and photo-library clients to use the main project. The additive schema and reporting RPC are maintained in the companion source-repository PR #125. The old project remains intact.

Published-repository base commit: `baf4e6c3299661873c77a0cc590462b1b114d488` (`live/main`). Branch: `work/dryer-reweigh-report-20261026`. The related source repository was inspected at `157b016d01570eaf86ceb2d273558b2fd8d1078d`.

Risk: protected database migration and owner-scoped measurements, lane C. The owner's direct request authorized the database backup and additive transfer. The public-page cutover and merge remain a separate review gate under the repository policy.

## Acceptance checks

- An authorized COSME owner receives every intermediate event and exact per-bay weight for the drying runs returned by the existing ledger, with measurement time and weather.
- Records displays the events under each run. Analysis includes ordered intermediate totals, time since loading and weight change; increasing weights remain visible for review.
- Anonymous, inactive and wrong-organization accounts cannot obtain the new event data.
- The public form and all owner views switch to the main project together; a final source write reconciliation occurs immediately before release.

## Implementation and validation

The new RPC calls the existing authenticated ledger before adding events for its returned submission IDs. The two page modules consume its new `reweigh_events` field. The pure measurement helper has synthetic unit tests, including an increase and a missing weight. The client now sends the main Seaweed Harvest account token in authenticated reporting requests. The legacy admin-password delete control is hidden because that older-project endpoint was deliberately not migrated. Module URL and service-worker cache versions were advanced so updated clients fetch the new project configuration.

Private exports are stored outside both Git repositories under `dryer-investigation/private-exports/`; none may be committed. The older project contains 309 rows in eight dryer base tables, 10 reweigh events, 36 individual reweigh measurements and 823 photo objects. A source export and byte backup were verified. The main project was backed up before the import: a PostgreSQL archive includes 107 public, 27 authentication and eight storage tables, and all 64 pre-existing Storage objects were copied and hash-checked. The archive was structurally inspected with `pg_restore --list`; it has not been restored into an isolated Supabase instance.

On 27 October, the additive main-project schema, functions and private photo bucket were applied and recorded in migration history. All 309 base rows were imported with their original identities and values. Live source and destination fingerprints match on all eight tables. All 823 dryer photo objects were uploaded to the main private bucket and independently read back with matching byte hashes. A simulated authorized owner request returned 178 bay rows and all 10 reweigh events; anonymous function and table access checks passed. A synthetic loading → reweigh → unloading cycle passed inside a transaction that was rolled back. The photo Edge Function was deployed to the main project. A local browser check loaded the public form's 50 most recent records from the main project and confirmed that the retired delete control is hidden. The public site has **not** been switched yet.

## Rollback and consolidation gate

Before merging this branch, hold old-project dryer writes, drain in-flight submissions, and compare all eight source and destination table fingerprints and all 823 photo objects again. Import any new or changed source rows before releasing the page switch. Verify a controlled loading → reweigh → unloading cycle and the owner Records, Analysis, Payments and photo views against the main project. After release, monitor both projects for stale-client writes; reconcile any such writes before disabling old-project public writes. If the page switch must be reversed, preserve and reconcile any new main-project submissions first rather than silently splitting the data. Retain the older project and both private backups until a separate retention decision.
