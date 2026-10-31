# Browser backup website release - 31 October 2026

Owner authorised deployment and testing of the reviewed browser backup work.

- Published base: `2c78b2c6c97b24b28a0b360957f28821f90f5e27`.
- Reviewed source: Seaweed_Harvest PR #132, merged as `ad7f741f0af4c1fde2663db2caa3ae9aef6d5927`.
- Publish only `admin_backups.html`, `assets/js/admin_backups_summary.js` and `assets/js/full_backup_archive.js`.
- `assets/js/archive_files.mjs` is already identical to reviewed source.
- Preserve published login, auth client, config, navigation, service worker and deployed-only pages.

The owner can choose organisations, optionally select photos, choose a folder and back up. Existing verified photo copies are reused; replacement of damaged/different local copies requires explicit selection. The workflow needs no local server or scheduled worker.

The additive browser-backup migration and the JWT-protected backup-archive Edge Function must be deployed before these UI files. Database jobs and cloud-photo cleanup remain disabled. This release does not change existing account access and does not establish full database recovery.

Reviewed validation: 32 JavaScript checks, 6 Python checks, existing Mawimbi export flow and synthetic desktop/mobile Chrome probes. Release verification additionally checks live served file hashes, unauthenticated access refusal, database RPC privileges and organisation isolation. Authenticated owner folder saving is reported separately from synthetic checks.
