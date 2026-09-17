# Photo gallery navigation and page size — 17 Sep 2026

Owner-approved production change for the shared Seaweed Harvest photo library.

## Scope
- Add previous/next controls to the enlarged photo viewer.
- Support Left Arrow / Right Arrow keyboard navigation through photos loaded on the current page.
- Add 20 / 40 / 60 photos-per-page options.
- Persist the page-size preference in browser localStorage so it is device/browser-specific rather than account-specific.
- Apply to Mawimbi/general photo records, COSME Reef Nursery and COSME Dryer Table.

## Data and access
- No photo records, storage objects, permissions or historical data are changed.
- Generic and COSME Reef photo-library RPC page limits are raised to 60.
- Dryer Table keeps the existing server page cap and the client composes a 60-photo page from a 50-photo request plus the remaining 10, preserving correct offsets and avoiding skipped records.

## Navigation boundary
Arrow navigation is intentionally limited to the photos already loaded on the current page. It does not silently fetch the next database page.
