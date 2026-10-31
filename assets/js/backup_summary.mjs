export const LEDGER_LABELS = Object.freeze({
  collections: "Collections", ag_process_records: "Processing",
  ag_site_water_sample_records: "Site water samples", ag_mawimbi_ro_monitoring_records: "RO water monitoring",
  ag_stabilization_packing_records: "Stock and packing", ag_stabilization_stock_actions: "Stock movements",
  ag_reef_nursery_sessions: "Nursery training", ag_reef_seaweed_records: "Nursery monitoring",
  ag_reef_inspection_records: "Nursery inspections", ag_reef_sample_rope_cycles: "Sample ropes",
  ag_reef_site_captures: "Site captures", ag_historical_ledger_rows: "Historical ledger",
  ag_historical_stock_refilter_groups: "Historical refiltering",
  ag_historical_unidentified_stock_disposals: "Historical stock disposals",
  girls_green_spaces: "Green spaces", girls_reflection_entries: "Green space reflections",
  seaweed_drying_submissions: "Dryer records", seaweed_drying_reweigh_events: "Dryer reweighs",
  ag_deleted_records: "Deleted-record archive",
});
export function recordedPhotoCounts(rows, manifest) {
  const saved = new Map((manifest?.files ?? []).map(f => [`${f.object_id}:${f.object_version}`, f]));
  let recorded = 0;
  for (const row of rows) {
    const f = saved.get(`${row.object_id}:${row.object_version}`);
    if (f && f.bucket_id === row.bucket_id && f.object_path === row.object_path &&
      Number(f.byte_size) === Number(row.byte_size) &&
      (!row.archive?.sha256 || f.sha256 === row.archive.sha256)) recorded++;
  }
  return { recorded, newOrChanged: rows.length - recorded };
}
export function lastCompletedBackup(manifest, scope) {
  return (manifest?.snapshots ?? []).filter(s => {
    if (s.status !== "complete" || !s.relative_path || !s.sha256) return false;
    const p = s.photo_results ?? {};
    if (Number(p.failed ?? 0) || Number(p.skipped ?? 0) || Number(p.pending ?? 0) ||
      (s.photos_requested && Number(s.missing_linked_photo_references ?? 0))) return false;
    // An all-organisation backup covers an individual selection, too.
    return s.organisation_ids == null || (scope != null && scope.every(id => s.organisation_ids.includes(id)));
  }).filter(s => Number.isFinite(Date.parse(s.completed_at || s.captured_at)))
    .sort((a,b) => Date.parse(b.completed_at || b.captured_at) - Date.parse(a.completed_at || a.captured_at))[0] ?? null;
}
