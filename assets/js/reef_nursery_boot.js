await import("./reef_nursery_training_rpc_guard.js?v=4");
await import("./reef_nursery_training_dom_guard.js?v=7");
await import("./reef_nursery_training_optional_participants.js?v=1");
await import("./reef_nursery_training_entry_bridge.js?v=2");
await import("./reef_nursery_training_public.js?v=20261015a");

export const REEF_CANONICAL_ROUTE_PARAMETERS = Object.freeze([
  "tab",
  "record",
  "seaweed_record",
  "inspection_record",
  "legacy_record",
  "share",
  "org",
  "record_type"
]);

const parameters = new URLSearchParams(window.location.search);
const reviewMode = Boolean(parameters.get("share") && parameters.get("org"));
const legacySeaweedRecordRequested = Boolean(parameters.get("seaweed_record"));

// Existing links to the former combined workspace go to the independent form.
if (!reviewMode && parameters.get("tab") === "seaweed" && !legacySeaweedRecordRequested) {
  window.location.replace("./reef_nursery_seaweed_data.html");
}

if (!reviewMode) {
  await Promise.all([
    ...(legacySeaweedRecordRequested ? [import("./reef_nursery_seaweed.js?v=1")] : []),
    import("./reef_nursery_inspection.js?v=2")
  ]);
}

// Do not load the former Training / Seaweed shared-workspace tabs.
// Retain the live Training submission, photo, cleanup and records helpers.
await import("./reef_nursery_delete_hotfix.js?v=1");
await import("./reef_nursery_cleanup.js?v=1");
await import("./reef_nursery_site_capture_records_hotfix.js?v=20260917a");
