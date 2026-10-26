# Dryer reweigh reporting and recovery — 26 October 2026

## Request and scope

The owner confirmed that older dryer entries and reweighs must be preserved, asked for a safe move into the main Seaweed Harvest Supabase project, and asked that Records and Analysis show the latest individual measurements. The older project cannot currently be added to the connected Supabase tool. This branch contains the additive reporting contract and interface change for the existing dryer project; it does **not** redirect the form, import data, or delete the original.

Published-repository base commit: `baf4e6c3299661873c77a0cc590462b1b114d488` (`live/main`). Branch: `work/dryer-reweigh-report-20261026`. The related source repository was inspected at `157b016d01570eaf86ceb2d273558b2fd8d1078d`.

Risk: protected database migration and owner-scoped measurements, lane C. The owner's direct request authorizes preparation. Production application and merge require the database and permission checks below.

## Acceptance checks

- An authorized COSME owner receives every intermediate event and exact per-bay weight for the drying runs returned by the existing ledger, with measurement time and weather.
- Records displays the events under each run. Analysis includes ordered intermediate totals, time since loading and weight change; increasing weights remain visible for review.
- Anonymous, inactive and wrong-organization accounts cannot obtain the new event data.
- The current form remains pointed at the original project until a separate verified consolidation cutover, including photo bytes and a final write reconciliation.

## Implementation and validation

The new RPC calls the existing authenticated ledger before adding events for its returned submission IDs. The two page modules consume its new `reweigh_events` field. The pure measurement helper has synthetic unit tests, including an increase and a missing weight. Syntax, static contract and UI checks are required; migration validation, positive and negative permission tests require an accessible database. Keep the PR in draft while those checks are unavailable.

The private row export and its audit receipt are stored outside both Git repositories under `dryer-investigation/private-exports/`. It contains 859 rows from nine dryer tables, including 10 reweigh events and 36 reweigh bay measurements, with no orphan or duplicate keys found. It includes personal/payment fields and upload-token hashes and must never be committed. The 550 photo catalog rows are **not** a verified backup of photo bytes. The old database's scheduled backup predates the newest reweigh. No destination import or cutover is safe yet.

## Rollback and consolidation gate

If the new reporting RPC fails after application, restore the previous page versions and drop only `list_authenticated_seaweed_drying_ledger_with_reweighs(text, integer)`; the existing ledger and stored records are unchanged by this branch. Before main-project consolidation, obtain a recoverable source and destination database backup, copy and hash the original photo bytes, create destination schema and authorization with reviewed permissions, import with preserved keys, reconcile a final source snapshot after holding writes, test submissions and reweighs, and only then change the shared dryer configuration. Preserve the original project for rollback and later retention review.
