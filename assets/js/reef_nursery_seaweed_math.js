if (typeof document !== "undefined") {
  void import("./reef_nursery_records_unified.js?v=1");
}

export function calculateWeightPerLine(totalWeight, lineCount) {
  const total = Number(totalWeight);
  const lines = Number(lineCount);
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(lines) || lines <= 0) {
    return null;
  }
  return total / lines;
}

export function formatWeightPerLine(totalWeight, unit, lineCount) {
  const value = calculateWeightPerLine(totalWeight, lineCount);
  if (value === null) return "—";
  const formatted = new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 3
  }).format(value);
  return `${formatted} ${unit || "kg"}/line`;
}
