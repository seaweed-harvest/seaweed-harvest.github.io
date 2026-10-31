# Backup page recovery release — 31 October 2026

Owner request: troubleshoot failed backups and provide organisation/all-organisation selection with optional photos. Production frontend and backup-archive deployment explicitly approved in chat after source PR #136 was merged.

Runtime repository: seaweed-harvest/seaweed-harvest.github.io. Exact base: 2af52a7ce59a7c9b11275cdae3bec76bb67fe412. Branch: release/backup-page-recovery-20261031.

This publishes reviewed frontend files and matching tests from bosunjm-cloud/Seaweed_Harvest source PR #136 (merge 7d68e71d664dbec2916fc85593b0c29f6329bda1). Expected/actual paths: admin_backups.html; assets/js/admin_backups_summary.js, full_backup_archive.js, backup_connection.mjs; tests/admin_backups_export_flow_test.mjs, simple_mawimbi_backup_summary_static_test.py, backup-archive/ui.test.mjs, backup-archive/page.test.mjs; this note. No workflow, permission, data or credential changes.

Risk: protected production release with explicit owner approval; existing authorization checks remain. The owner sees the organisation archive without depending on the legacy Mawimbi dashboard. Account connection errors have bounded recovery and manual retry. The legacy export remains for existing permitted non-owner users.

Acceptance: initial loading is generic; failed account checks reveal retry; owner receives all/selected organisations and optional photos; existing Mawimbi export remains permission-controlled; scoped inventory uses bounded reads in the deployed backend.

Evidence: 30 focused Node tests, 11 markup/source checks, existing Mawimbi create/poll/download flow and syntax checks passed in the source workspace. GitHub source validation passed. Live first-page SQL checks succeeded for all and selected organisation scopes. backup-archive version 5 deployed after explicit approval, preserving JWT verification and the protected-owner guard. No migration required.

Rollback: revert these exact runtime paths to the recorded base via a reviewed revert; redeploy the retained version-4 function files if backend rollback is necessary. Do not change records, photo storage, permissions or secrets during rollback.

Remaining verification: successful Pages publication and live asset checks, then a complete authenticated browser backup and local file integrity check. Source/test success alone is not end-to-end verification.
