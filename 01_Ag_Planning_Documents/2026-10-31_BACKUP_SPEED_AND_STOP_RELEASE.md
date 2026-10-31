# Photo backup speed and stop controls

Owner asked for faster photo downloads, larger gains than four concurrent files, a stop control, and clarity about closing/navigating away. This is the continuing approved backup rollout; production page publication was approved in chat. No backend, storage deletion, authentication policy or schema changes.

Runtime base: c8fe310777d54f67068841fe9ee2c744cf76e082. Branch: release/faster-photo-backups. Source: bosunjm-cloud/Seaweed_Harvest PR #137.

Publish the reviewed frontend files and matching UI/static tests. Exact paths: admin_backups.html; assets/js/admin_backups_summary.js; assets/js/full_backup_archive.js; tests/backup-archive/ui.test.mjs; tests/simple_mawimbi_backup_summary_static_test.py; this note. Risk B for photo transfer/disk concurrency with the existing explicit owner authority.

Behaviour: eight concurrent photos, limited to 32 MiB of declared in-flight file sizes; serialized manifest writes and same-path writers; first preparation URL reused; normal download server receipts omitted because local checksum read-back and durable manifests retain backup proof. Existing explicit verification/cleanup/restore still records fresh server receipts before those operations.

Stop safely drains active files, stops scheduling new work, checkpoints pending counts, and permits resume using the same folder. beforeunload warns during a running backup. Closing the page/browser still stops processing; no background service is introduced.

Validation: 27 focused Node tests, 11 markup/source checks, existing export-flow test and syntax checks pass. Tests cover eight-way overlap, the size budget, writer serialization, stop/drain/resume, leaving-page warnings, interrupted downloads, verified-copy reuse, stale versions, and fresh explicit verification receipts. A 24-photo synthetic-latency comparison was 2,200ms before versus 229ms after (9.6x); server requests fell from 73 to 25. This is laboratory evidence, not a production speed guarantee.

Acceptance: publish matching v8 page module/v4 archive module, verify live assets and signed-in controls. Cloud browser folder permission remains unavailable, so actual on-disk production speed and stop/resume require a desktop Chrome/Edge run.

Rollback: revert the five runtime code/test paths to the base above through a reviewed revert. Existing local archive format remains compatible. Never delete local files, cloud originals, records or permissions as part of rollback.
