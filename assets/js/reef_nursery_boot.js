await import("./reef_nursery_training_rpc_guard.js?v=3");
await import("./reef_nursery_training_dom_guard.js?v=5");
await import("./reef_nursery_training_optional_participants.js?v=1");
await import("./reef_nursery_training_public.js?v=3");

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
