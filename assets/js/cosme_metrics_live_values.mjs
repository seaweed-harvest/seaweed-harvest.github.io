import { safeCsvCell } from "./cosme_metrics_core.mjs";

// Presentation-only live-value adapter. Authorised RPC responses are validated
// by the page before being passed here. Never change frozen release payloads.
const DRYER_FIELDS = Object.freeze({
  "SDT-0022": ["wet_weight_reduction_pct", "%"],
  "SDT-0063": ["completed_cycles", "cycles"],
  "SDT-0064": ["completed_bays", "bay records"],
  "SDT-0065": ["wet_kg", "kg"],
  "SDT-0066": ["final_kg", "kg"]
});

const validTime = value => typeof value === "string" &&
  Number.isFinite(Date.parse(value));

/** Return a new display overlay, never a mutation of a published metric. */
export function verifiedLiveValue(id, {dryer=null, coverage=null}={}) {
  const field = DRYER_FIELDS[id];
  if (field && dryer?.can_view === true && dryer.status === "current" &&
      validTime(dryer.queried_at) && Array.isArray(dryer.metric_ids) &&
      (id === "SDT-0022"
        ? ["SDT-0063","SDT-0064","SDT-0065","SDT-0066"].every(
            required=>dryer.metric_ids.includes(required))
        : dryer.metric_ids.includes(id))) {
    const value = dryer[field[0]];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return null;
    return {
      value: String(value), unit: field[1], source: "COSME drying-table records",
      queriedAt: dryer.queried_at, sourceUpdatedAt: dryer.source_updated_at || null
    };
  }
  if (id === "ON-0054" && coverage?.can_view === true &&
      coverage.metric_id === id && validTime(coverage.queried_at) &&
      Number.isSafeInteger(coverage.rope_count) && coverage.rope_count >= 0 &&
      Number.isSafeInteger(coverage.site_count) && coverage.site_count >= 0) {
    return {
      value: coverage.rope_count+" ropes / "+coverage.site_count+" sites",
      unit: "", source: "COSME nursery sample-rope register",
      queriedAt: coverage.queried_at,
      sourceUpdatedAt: coverage.source_updated_at || null
    };
  }
  return null;
}

/** Current operational context is not automatically an equivalent metric. */
export function liveStatus(id, feeds) {
  const currentValue = verifiedLiveValue(id, feeds);
  if (currentValue) return {kind:"live", source:currentValue.source, currentValue};
  if (typeof feeds?.mawimbiContext === "function" &&
      feeds.mawimbiContext(id)) return {
    kind:"linked", source:"Mawimbi operational aggregate", currentValue:null
  };
  return {kind:"published", source:"", currentValue:null};
}

/** Historical release selection must never receive a current-value overlay. */
export function displayValue(metric, status, showCurrent, latestRelease) {
  const live = showCurrent && latestRelease && status?.kind === "live"
    ? status.currentValue : null;
  return {
    value: live ? live.value : metric.value,
    unit: live ? live.unit : metric.unit,
    state: live ? "Live" : status?.kind === "linked" ? "Linked" :
      status?.kind === "live" && latestRelease ? "Published · live available" : "Published",
    checkedAt: live?.queriedAt || null,
    sourceUpdatedAt: live?.sourceUpdatedAt || null,
    publishedValue: metric.value,
    publishedUnit: metric.unit
  };
}

/** Export what the reader sees, with the frozen source value alongside it. */
export function exportMetricViewCsv(metrics, version, statusOf, showCurrent, latestRelease) {
  const header=["Metric ID","Activity","Category","Metric","Displayed value","Displayed unit",
    "Display status","Published value","Published unit","Live query checked","Source last updated",
    "Published version","Source","Notes"];
  const rows=metrics.map(metric=>{
    const state=displayValue(metric,statusOf(metric),showCurrent,latestRelease);
    return [metric.id,metric.activity,metric.theme,metric.title,state.value,state.unit,
      state.state,state.publishedValue,state.publishedUnit,state.checkedAt||"",
      state.sourceUpdatedAt||"",version||"",metric.source,metric.note];
  });
  return "\uFEFF"+[header,...rows].map(row=>row.map(safeCsvCell).join(",")).join("\r\n");
}
