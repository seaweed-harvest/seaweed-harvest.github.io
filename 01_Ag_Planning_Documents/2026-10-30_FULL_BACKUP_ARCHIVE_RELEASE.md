# Full backup and photo archive — approved release

Owner directly approved merge and deployment on 30 October 2026. This is an owner-directed release, not a Supabase suggestion-automation run. Source: https://github.com/bosunjm-cloud/Seaweed_Harvest/pull/131.

Published base: `e99251f3ecb5f570d91b6d115c2a281036946e73`. Source release candidate: `4a2c88120804a6d5d14fe9f8934cb787982b119e`. The two existing backup frontend files matched source base exactly before the update.

Scope: `admin_backups.html`, `assets/js/admin_backups_summary.js`, `assets/js/full_backup_archive.js`, and `assets/js/archive_files.mjs`. Preserve all other deployed assets, account/login routes, service worker, permissions and operational records. No private SQL, snapshots, database archives, credentials or original photos are published.

Validation: 33 focused source checks plus 11 existing Mawimbi markup/contract checks passed. New owner-only UI and failure cases use synthetic DOM/Storage/Auth fixtures. Public release copies the exact four validated frontend files. Public-API and live-page checks follow deployment. Authenticated owner-folder write/read-back still needs the real browser and chosen destination.

Backend: additive private-service registry/RPC migration and new `backup-archive` Edge Function. Cloud cleanup remains disabled. Full database backup jobs remain disabled until the separate secured runner has its one-time connection configured. Installation does not start backups, delete originals or activate COSME metrics.

Rollback: revert this release's four frontend files and disable the new Edge Function if needed; retain archive registry/history. Do not restore the whole database or overwrite newer operational records for a routine feature rollback.
