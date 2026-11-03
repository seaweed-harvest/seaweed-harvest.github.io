# COSME Project Photos — interruption-safe mobile uploads

**Date:** 3 November 2026  
**Owner request:** Recover selected photos after iPhone Home Screen app restarts, reduce metadata warnings, avoid duplicate files, and improve upload speed.

## Scope and baseline
- Application: Seaweed Harvest, COSME Project Metrics > Photos
- Source and deployment repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base branch: `main`
- Frozen starting commit: `85213f5f383c9fed229e5439a6995b7dea4f6efd`
- Lane B: photo upload, local/offline storage, PWA shell; no authorization, RLS, DB or Edge Function edits.
- Source records from 3 November 2026: six latest-batch photos already ready with camera metadata; two older pending reservations have no storage objects.

## Implementation
1. IndexedDB retains source images under an authenticated user-specific local batch before any network upload.
2. Once converted to a smaller image, the device queue replaces the original with the compressed copy; server upload reservations, readiness and metadata state are persisted per image.
3. A returned/reloaded photo tab discovers unfinished batches, resumes while online, and retains manual Resume/Stop controls.
4. The existing private storage path is reused after interrupted transfers. A 409 after reconnect is reconciled with the original reservation; completed capture records are checked against their stored batch ID and index.
5. Metadata capture is retried separately and does not cause the photo bytes to be re-uploaded.
6. Gallery duplicate checks skip prior photos with matching original filename and original size.
7. Four bounded upload transfer slots share a serialized image-preparation queue. Existing 1920-pixel, 80%-quality conversion is retained.
8. Home Screen updates no longer forcibly reload an active page. The app remembers its last safe page and COSME metrics tab.

## Acceptance and verification
- A 28-photo upload may be interrupted by phone lock, app process termination or network loss and resumed from retained IndexedDB files without reselecting the batch.
- Already-ready photos remain counted as saved; metadata-only retries do not retransmit images.
- Restarting and reselecting already-saved originals excludes duplicates.
- Stop Remaining pauses the unsent portion but keeps the queue.
- No new permission surface, no anonymous storage, no shared device uploads across different signed-in accounts.
- Run JavaScript syntax checks, queue/duplicate regression checks, existing COSME gallery tests, PWA restart checks, and manual iOS Home Screen interruption verification before production rollout.
- iOS may terminate background JavaScript; actual background uploads are not promised.
- Device storage may be unavailable or evicted; show an explicit local-storage error rather than falsely promising recovery.

## Deployment and rollback
- Proposed release is a regular source PR to `main`; no GitHub Actions or new deployment infrastructure.
- Release check: after approval and checks, verify new photo selection persists locally, reopen COSME Photos, and test the Resume control on an iPhone.
- Rollback: revert the frontend commits. Existing private photo records and camera metadata remain unchanged. IndexedDB is local and need not be deleted on rollback.
