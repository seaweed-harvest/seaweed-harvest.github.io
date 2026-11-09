// Keep collection-stage checks independent of the DOM and the data store.
// A bay may be loaded without being unloaded yet; a completed cycle must be plausible.
export const MIN_DRYING_HOURS = 12;

function finiteWeight(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function dryingCycleIssue(bay, minimumHours = MIN_DRYING_HOURS) {
  const loadAt = bay?.loading_at;
  const unloadAt = bay?.unloading_at;
  const wet = finiteWeight(bay?.loading_weight_kg);
  const dry = finiteWeight(bay?.unloading_weight_kg);
  // A fresh loading may be saved without a subsequent unload.
  if (!unloadAt) return null;
  if (!loadAt || wet === null) return "missing_loading";
  if (dry === null) return "invalid_weight";
  const start = Date.parse(loadAt);
  const finish = Date.parse(unloadAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return "invalid_time";
  if (finish <= start) return "time_order";
  if (finish - start < minimumHours * 60 * 60 * 1000) return "short_duration";
  if (wet <= 0 || dry < 0) return "invalid_weight";
  if (dry >= wet) return "no_weight_loss";
  return null;
}

export function dryerCycleIssueMessage(issue, bayNumber) {
  const name = `Bay ${bayNumber}`;
  switch (issue) {
    case "invalid_time": return `${name}: check the measurement dates and times.`;
    case "missing_loading": return `${name}: record a loading date and fresh weight before unloading.`;
    case "time_order": return `${name}: unloading must be after loading.`;
    case "short_duration": return `${name}: less than 12 hours of drying. Check the dates.`;
    case "invalid_weight": return `${name}: check the loading and unloading weights.`;
    case "no_weight_loss": return `${name}: unloaded weight must be lower than loaded weight. Check the measurements.`;
    default: return "";
  }
}
