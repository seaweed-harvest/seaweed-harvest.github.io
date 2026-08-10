import assert from "node:assert/strict";
import { TIDE_PROFILES } from "../assets/data/tide_profiles.js";
import {
  findNextExtreme,
  findNextHarvestLow,
  moonIllumination,
  moonPhase,
  moonPhaseName,
  rangeAroundNow,
  tideCurve,
  tideExtremes,
  tideHeight
} from "../assets/js/tide_core.js";

const kenya = TIDE_PROFILES.kenya_mombasa_reference;
const fremantle = TIDE_PROFILES.fremantle_reference;
const referenceDate = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

assert.ok(kenya, "Kenya tide profile should exist");
assert.ok(fremantle, "Fremantle tide profile should exist");

const kenyaHeight = tideHeight(referenceDate, kenya);
const fremantleHeight = tideHeight(referenceDate, fremantle);

assert.equal(Number.isFinite(kenyaHeight), true, "Kenya tide height should be finite");
assert.equal(Number.isFinite(fremantleHeight), true, "Fremantle tide height should be finite");
assert.notEqual(kenyaHeight.toFixed(3), fremantleHeight.toFixed(3), "Profiles should produce different heights");

const range = rangeAroundNow(referenceDate, 0, 3);
const curve = tideCurve(kenya, range.start, range.end, 30);
const extremes = tideExtremes(curve);

assert.ok(curve.length > 100, "Curve should include multiple days of points");
assert.ok(extremes.some((extreme) => extreme.type === "low"), "Curve should include low tides");
assert.ok(extremes.some((extreme) => extreme.type === "high"), "Curve should include high tides");

const nextLow = findNextExtreme(extremes, referenceDate, "low");
assert.ok(nextLow, "Next low tide should be found");

const nextHarvest = findNextHarvestLow(extremes, referenceDate, 0.9, true);
assert.ok(nextHarvest, "Next harvest low should be found for a 0.9 m threshold");

const phase = moonPhase(referenceDate);
assert.ok(phase >= 0 && phase <= 1, "Moon phase should be normalized");
assert.equal(Number.isFinite(moonIllumination(phase)), true, "Moon illumination should be finite");
assert.equal(typeof moonPhaseName(phase), "string", "Moon phase name should be a string");

console.log("tide_core_smoke.test.js passed");
