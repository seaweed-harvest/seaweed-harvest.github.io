import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../assets/js/dryer_reweigh_math.js", import.meta.url));
const { deriveReweighMeasurements } = await import(`data:text/javascript;base64,${source.toString("base64")}`);

test("keeps every per-bay measurement in time order and computes interim loss", () => {
  const events = [
    { reweigh_at: "2026-10-25T22:04:00Z", weather: "mixed", bays: Array.from({ length: 8 }, (_, i) => ({ bay_number: i + 1, weight_kg: 2.875 })) },
    { reweigh_at: "2026-10-24T22:10:00Z", weather: "cloudy", bays: Array.from({ length: 8 }, (_, i) => ({ bay_number: i + 1, weight_kg: 5 })) }
  ];
  const result = deriveReweighMeasurements(events, 80, "2026-10-24T02:00:00Z");
  assert.equal(result.length, 2);
  assert.equal(result[0].totalKg, 40);
  assert.equal(result[0].lossPct, 50);
  assert.equal(result[1].totalKg, 23);
  assert.equal(result[1].lossPct, 71.25);
  assert.equal(result[1].bays[0].weight_kg, 2.875);
  assert.equal(result[1].weather, "mixed");
  assert.equal(result[1].elapsedHours, 44 + 4 / 60);
});

test("preserves a weight increase for review and does not invent a total for missing weights", () => {
  const result = deriveReweighMeasurements([
    { reweigh_at: "2026-10-18T15:00:00Z", bays: [{ bay_number: 1, weight_kg: 6.855 }] },
    { reweigh_at: "2026-10-19T15:00:00Z", bays: [{ bay_number: 1, weight_kg: null }] }
  ], 5.25, "2026-10-17T15:00:00Z");
  assert.equal(result[0].totalKg, 6.855);
  assert.ok(result[0].lossPct < 0);
  assert.equal(result[1].totalKg, null);
  assert.equal(result[1].lossPct, null);
});
