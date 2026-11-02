# COSME Project Metrics — MCP proposals and linked photos

**Date:** 2 November 2026
**Status:** Draft PR only. Production deployment not authorised.
**Source application:** Seaweed Harvest Project Metrics.
**Website repository:** `seaweed-harvest/seaweed-harvest.github.io`.
**Pinned website base:** `a8db3d6f1b7d94396d8a0073fcc8dc79ae4f2ac2` on `main`.
**MCP dependency:** `bosunjm-cloud/Seaweed_Harvest` draft PR #154,
`feature/mcp-dynamic-organisation-access-20261101`. Its additive SQL
migration is NOT applied to production, and its write tools are disabled.

## User need and acceptance

- View unpublished ChatGPT-created metric proposals in Project Metrics, separately
  from immutable released values.
- See title, activity, proposed value and unit, target metric ID (if a proposed
  revision), review status and notes, without suggesting any draft is published.
- See references to new photos from the existing private Project Photos library
  on saved drafts and on existing metric details; no uploads or new storage buckets.
- Preserve normal website Project Metrics owner/editor/reader grants, mobile display,
  app navigation, public field forms and the original frozen release.
- Gracefully show unavailable status if the new MCP SQL RPCs are not installed;
  the page must remain operational for all existing users.
- Never use a service-role key or direct table query from the browser; use
  `cosme_mcp_metric_draft_list`, `cosme_mcp_metric_photo_links`,
  `cosme_library_list`, and the existing user-scoped storage signed URL API.

## User-facing behavior

The Proposals tab appears only to existing website metrics owners/editors and
loads on demand. It is read-only; ChatGPT's permission-checked MCP draft tools
make changes. Review status uses the explicit Draft / Ready for review /
Approved (not published) vocabulary. The reviewer can refresh the tab manually.

Metric detail fetches links by exact metric ID; the new section is hidden when
there are no matching ready photos. Linked images have short-lived signed URLs.
Proposals are never inserted into All Metrics or release history. Source data
definitions are displayed as references, not silently recalculated.

## Release ordering

1. Complete and approve PR #154, incl. prerequisite SQL, OAuth and Worker
   staged tests. Keep both the nursery stage writer and the separate Project
   Metrics writer disabled unless separately authorised.
2. Apply and verify only approved additive SQL changes with an established
   rollback plan. Verify `cosme_mcp_metric_draft_list` and photo-link RPCs
   with owner/editor/reader/non-member test accounts.
3. Test this website draft on a staging/pre-production page with the required
   SQL; check phone, desktop, approved/revoked access, old and current releases,
   missing RPCs, empty data, signed-link expiry and logout while requests run.
4. Review actual diff and obtain required separate human merge approval, then
   publish approved website changes through the existing release process.
5. Never claim approval of an MCP draft publishes an immutable register release.
   A separate atomic release publisher must satisfy the documented metrics
   governance contract before any actual publication.

## Rollback

Revert the website files and page asset-version changes without altering
`cosme_metrics` releases or deleting photos. If the MCP draft feature fails,
disable its integration/feature gates; the legacy photo library and published
metrics remain in place. Never drop a table while a deployed client references it.

## Test plan

- Node pure-selector tests for exact-ID photo associations, ready-only images,
  no duplicates, malformed drafts and newest-first sorting.
- Static contract checks for owner/editor tab gating, lifecycle cleanup,
  private storage signing and absence of raw SQL/service-role/API writes.
- Real browser and database permission smoke tests are REQUIRED before deployment.
  No synthetic test substitutes for those production-equivalent checks.
