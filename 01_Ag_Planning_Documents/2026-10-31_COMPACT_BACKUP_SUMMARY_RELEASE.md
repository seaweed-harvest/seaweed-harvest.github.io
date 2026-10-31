# Compact backup summary release

Owner requested implementation of the agreed summary design and reuse improvement as part of the approved backup rollout.

Runtime base: ac3672031bbce4500db2f0ec1d93d8c48099cd74. Branch: release/compact-backup-summary. Source PR: bosunjm-cloud/Seaweed_Harvest#138.

Publish admin_backups.html; assets/js/admin_backups_summary.js, full_backup_archive.js, backup_summary.mjs; matching UI, helper and markup tests; this note. No runtime workflow, credential, role, permission or operational data changes. Risk B/C for the approved backup data-summary/manifest work; protected-owner access remains unchanged.

UI: one-organisation ledger counts, multi-organisation rows, shared/unassigned row for unscoped data, unique total where records belong to several exports, compact optional-photo size/new-or-recorded counts, and folder-specific completed history. Individual photos are lazy-rendered only under Advanced. Context paragraphs removed; keep-tab-open hint appears only during an actual backup. History excludes failed/stopped/incomplete attempts and includes scope and photo mode/count.

Reuse: bounded parallel checks remain; durable manifest checkpoints batch every 16 changes and flush on stop/completion. Local file checksums and read-back verification stay intact. Eight concurrent transfers and same-path writer locks remain.

Backend prerequisite deployed: SECURITY INVOKER service-role-only read function ag_archive_summary, migration version 20261031132109. It reuses existing export predicates and projects only recognised photo fields. backup-archive v6 is active. No export scoping or source data was changed. The new function took approximately 160ms in a live database EXPLAIN ANALYZE. Direct COSME training count and preview both returned 11. RPC execution denied to anon/authenticated; service_role allowed. Security advisor findings are unchanged, with no new finding for this helper.

Proof: 42 focused Node tests plus 2 PGlite database tests, 11 markup/source checks, existing export flow and syntax checks passed. Coverage includes scopes and child photos, role guards, new/changed version comparison, completed history, lazy rows, stop/resume and batched existing-file checkpoints. Reuse of 48 synthetic saved files required at most six manifest writes and no preparation/download calls.

Acceptance: verify live v9 entry/v5 archive module, all/single organisation summaries, photo toggle and collapsed details in the signed-in browser. Actual folder-based backup remains unavailable in the cloud browser; file/history/stop checks use synthetic folder handles.

Rollback: revert the changed runtime assets to the base. Restore the previous Edge Function source if required; leaving the additive unused RPC in place is safe. Do not alter records, photo storage or user access during rollback.
