// Shared selection rules for optional whole-table or per-level weighing.
// B1–B4 = upper level; B5–B8 = lower level. No database changes are needed.
export function baysForDryerLevel(level, bayCount) {
  if (!Number.isInteger(bayCount) || bayCount < 1 || bayCount > 8) return [];
  const all = Array.from({ length: bayCount }, (_, index) => index + 1);
  if (level === "all") return all;
  if (bayCount !== 8) return [];
  if (level === "upper") return all.filter((number) => number <= 4);
  if (level === "lower") return all.filter((number) => number >= 5);
  return [];
}

export function sameBaySelection(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

export function baysForPhase(level, bayCount, phase, loadedBayNumbers, unloadedBayNumbers = []) {
  const candidate = baysForDryerLevel(level, bayCount);
  if (phase === "loading") return candidate;
  const loaded = new Set(loadedBayNumbers);
  const unloaded = new Set(unloadedBayNumbers);
  return candidate.filter((number) => loaded.has(number) && !unloaded.has(number));
}
