// Standalone Site Capture weight math; no legacy-record module side effects.
export function formatWeightPerLine(totalWeight, unit, lineCount) {
  const total = Number(totalWeight);
  const lines = Number(lineCount);
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(lines) || lines <= 0) {
    return "—";
  }
  const formatted = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(total / lines);
  return `${formatted} ${unit || "kg"}/line`;
}
