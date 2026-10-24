import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../assets/js/mawimbi_analysis.js", import.meta.url), "utf8")
  .replace(/^import[^\n]*\n/gm, "")
  + "\nthis.math = { buildStockTimeline, fillMissingPeriods, periodStart, nextPeriod };";
const context = {
  document: { addEventListener() {} },
  Intl, Date, Math, Number, String, Array, Map, Set
};
runInNewContext(script, context, { filename: "mawimbi_analysis.js" });
const { buildStockTimeline, fillMissingPeriods, periodStart, nextPeriod } = context.math;

test("initial stock is counted by physical entry, not unique serial, and retests never add volume", () => {
  const records = [
    { id: "a", record_date: "2026-07-01", record_type: "initial", record_number: "2",
      weight_value: 24, weight_unit: "L", ph_value: 4, batch_submission_id: "batch-a" },
    { id: "b", record_date: "2026-07-02", record_type: "initial", record_number: "0002",
      weight_value: 24, weight_unit: "L" },
    { id: "c", record_date: "2026-07-03", record_type: "retest", record_number: "2",
      weight_value: 24, weight_unit: "L", ph_value: 3.8 },
    { id: "d", record_date: "2026-07-04", record_type: "initial", record_number: "3",
      weight_value: 500, weight_unit: "mL" }
  ];
  const actions = [
    { action_date: "2026-07-05", action_type: "removal", total_litres: 24 },
    { action_date: "2026-07-07", action_type: "restoration", total_litres: 24 }
  ];
  const result = buildStockTimeline(records, actions, {
    start: "2026-07-04", end: "2026-07-08"
  });
  assert.equal(result.initialCount, 3);
  assert.equal(result.qcCount, 2);
  assert.equal(result.actionCount, 2);
  assert.equal(result.points[0].balance, 48.5);
  assert.equal(result.lastBalance, 48.5);
  assert.equal(result.points.find(row => row.date === "2026-07-05").balance, 24.5);
  assert.equal(result.points.find(row => row.date === "2026-07-07").balance, 48.5);
});

test("unidentified disposals and mass-only units are not silently used as litre deductions", () => {
  const records = [
    { record_date: "2026-09-01", record_type: "initial", weight_unit: "L", weight_value: 24 },
    { record_date: "2026-10-07", record_type: "removal", unidentified_disposal: true,
      weight_unit: "L", weight_value: 23, ph_value: 4 },
    { record_date: "2026-10-08", record_type: "initial", weight_unit: "kg", weight_value: 23 }
  ];
  const result = buildStockTimeline(records, [], { start: "2026-09-01", end: "2026-10-09" });
  assert.equal(result.lastBalance, 24);
  assert.equal(result.initialCount, 1);
});

test("date periods retain zero-collection gaps", () => {
  const rows = fillMissingPeriods([
    { date: "2026-07-01", kg: 10, count: 1 },
    { date: "2026-07-03", kg: 20, count: 1 }
  ], "day", "2026-07-01", "2026-07-03");
  assert.equal(rows.length, 3);
  assert.equal(rows[1].date, "2026-07-02");
  assert.equal(rows[1].kg, 0);
  assert.equal(periodStart("2026-07-15", "week"), "2026-07-13");
  assert.equal(nextPeriod("2026-12-01", "month"), "2027-01-01");
});

test("the Records menu links analysis in mobile and desktop navigation with Mawimbi scoping", () => {
  const nav = readFileSync(new URL("../assets/js/app_navigation.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../mawimbi_analysis.html", import.meta.url), "utf8");
  const style = readFileSync(new URL("../assets/css/mawimbi_analysis.css", import.meta.url), "utf8");
  assert.match(nav, /label: "Analysis", href: "\.\/mawimbi_analysis.html".*requiredAggregator: "MAWIMBI"/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(page, /id="harvestCommunity"/);
  assert.match(page, /id="stockPlot"/);
  assert.match(style, /overflow-x:auto/);
  assert.match(style, /min-width:600px/);
});
