await import("./reef_nursery_training_rpc_guard.js?v=4");
await import("./reef_nursery_training_dom_guard.js?v=7");
await import("./reef_nursery_training_optional_participants.js?v=1");
await import("./reef_nursery_training_entry_bridge.js?v=2");
await import("./reef_nursery_training_public.js?v=4");

export const REEF_CANONICAL_ROUTE_PARAMETERS = Object.freeze([
  "tab",
  "record",
  "seaweed_record",
  "inspection_record",
  "legacy_record",
  "share",
  "org"
]);

const parameters = new URLSearchParams(window.location.search);
const reviewMode = Boolean(parameters.get("share") && parameters.get("org"));

if (!reviewMode) {
  await Promise.all([
    import("./reef_nursery_seaweed.js?v=1"),
    import("./reef_nursery_inspection.js?v=2")
  ]);
}

await import("./reef_nursery_cleanup.js?v=1");
