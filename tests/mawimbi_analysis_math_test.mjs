import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../assets/js/mawimbi_analysis.js", import.meta.url), "utf8")
  .replace(/^import[^\n]*\n/gm, "")
  + "\nthis.math = { buildStockTimeline, groupIntakeSeries, fillMissingPeriods, periodStart, nextPeriod, drawLineChart, buildProcessingMetrics, drawProcessingScatter, rollingTrendPoints, cumulativeWeeklyPoints };";
function mockElement() {
  return {
    children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    append(node) { this.children.push(node); },
    replaceChildren() { this.children = []; }
  };
}
const context = {
  document: { addEventListener() {}, createElementNS() { return mockElement(); } },
  Intl, Date, Math, Number, String, Array, Map, Set
};
runInNewContext(script, context, { filename: "mawimbi_analysis.js" });
const { buildStockTimeline, groupIntakeSeries, fillMissingPeriods, periodStart, nextPeriod, drawLineChart, buildProcessingMetrics, drawProcessingScatter, rollingTrendPoints, cumulativeWeeklyPoints } = context.math;

test("monthly average uses distinct days with collections, not collection count or calendar days", () => {
  const trend = groupIntakeSeries([
    { date: "2026-07-01", volume: 300, count: 6 },
    { date: "2026-07-02", volume: 300, count: 1 },
    { date: "2026-08-10", volume: 1000, count: 10 },
    { date: "2026-08-11", volume: 1000, count: 1 }
  ], "month", { start: "2026-07-01", end: "2026-08-31" });
  assert.equal(trend.points[0].days, 2);
  assert.equal(trend.points[0].average, 300);
  assert.equal(trend.points[1].average, 1000);
  assert.equal(trend.points[1].cumulative, 2600);
  assert.equal(trend.selectedTotal, 2600);
});

test("filtered cumulative includes earlier records, but the average uses only visible dates", () => {
  const trend = groupIntakeSeries([
    { date: "2026-07-01", volume: 100, count: 1 },
    { date: "2026-07-02", volume: 200, count: 1 },
    { date: "2026-07-20", volume: 300, count: 1 }
  ], "month", { start: "2026-07-10", end: "2026-07-31" });
  assert.equal(trend.opening, 300);
  assert.equal(trend.points[0].volume, 300);
  assert.equal(trend.points[0].days, 1);
  assert.equal(trend.points[0].average, 300);
  assert.equal(trend.points[0].cumulative, 600);
});

test("no-record periods have no invented average; accumulation holds steady", () => {
  const trend = groupIntakeSeries([
    { date: "2026-07-01", volume: 100, count: 1 },
    { date: "2026-09-01", volume: 300, count: 1 }
  ], "month", { start: "2026-07-01", end: "2026-09-30" });
  assert.equal(trend.points.length, 3);
  assert.equal(trend.points[1].volume, 0);
  assert.equal(trend.points[1].average, null);
  assert.equal(trend.points[1].cumulative, 100);
});

test("initial numbered stock entries add production; duplicate serials remain distinct; QC retests never add production", () => {
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
  const timeline = buildStockTimeline(records, actions, { start: "2026-07-04", end: "2026-07-08" });
  assert.equal(timeline.initialCount, 3);
  assert.equal(timeline.qcCount, 2);
  assert.equal(timeline.actionCount, 2);
  assert.equal(timeline.points[0].balance, 48.5);
  assert.equal(timeline.lastBalance, 48.5);
  assert.equal(timeline.points.find(row => row.date === "2026-07-05").balance, 24.5);
  const trend = groupIntakeSeries(timeline.intakeDays, "week",
    { start: "2026-07-04", end: "2026-07-08" });
  assert.equal(trend.opening, 48);
  assert.equal(trend.selectedTotal, .5);
  assert.equal(trend.cumulative, 48.5);
  assert.equal(trend.points.reduce((sum, row) => sum + row.qc, 0), 0);
});

test("QC marking follows initial batch and retest dates and production does not change on QC-only days", () => {
  const timeline = buildStockTimeline([
    { record_date: "2026-08-01", record_type: "initial", weight_unit: "L",
      weight_value: 24, ph_value: 4, batch_submission_id: "batch" },
    { record_date: "2026-08-07", record_type: "retest", weight_unit: "L",
      weight_value: 24, ph_value: 3.9 }
  ], [], { start: "2026-08-01", end: "2026-08-31" });
  const trend = groupIntakeSeries(timeline.intakeDays, "week",
    { start: "2026-08-01", end: "2026-08-31" });
  assert.equal(trend.cumulative, 24);
  assert.equal(trend.points.reduce((sum, row) => sum + row.qc, 0), 2);
  assert.equal(trend.points.reduce((sum, row) => sum + row.days, 0), 1);
});

test("unidentified disposals and mass-only units are not silently counted in litres", () => {
  const timeline = buildStockTimeline([
    { record_date: "2026-09-01", record_type: "initial", weight_unit: "L", weight_value: 24 },
    { record_date: "2026-10-07", record_type: "removal", unidentified_disposal: true,
      weight_unit: "L", weight_value: 23, ph_value: 4 },
    { record_date: "2026-10-08", record_type: "initial", weight_unit: "kg", weight_value: 23 }
  ], [], { start: "2026-09-01", end: "2026-10-09" });
  const trend = groupIntakeSeries(timeline.intakeDays, "month",
    { start: "2026-09-01", end: "2026-10-09" });
  assert.equal(timeline.lastBalance, 24);
  assert.equal(trend.cumulative, 24);
});

test("date grouping and fill gaps retain correct Kenya calendar dates", () => {
  const rows = fillMissingPeriods([
    { date: "2026-07-01", kg: 10, count: 1 },
    { date: "2026-07-03", kg: 20, count: 1 }
  ], "day", "2026-07-01", "2026-07-03");
  assert.equal(rows[1].date, "2026-07-02");
  assert.equal(periodStart("2026-07-15", "week"), "2026-07-13");
  assert.equal(nextPeriod("2026-12-01", "month"), "2027-01-01");
});

test("line SVG is readable on a narrow phone and has accessible point tooltips", () => {
  const plot = mockElement();
  plot.clientWidth = 390;
  const series = groupIntakeSeries([
    { date: "2026-07-01", volume: 300, count: 1 },
    { date: "2026-08-01", volume: 1000, count: 1 }
  ], "month", { start: "2026-07-01", end: "2026-08-31" });
  drawLineChart(plot, series.points, "average", "kg/day", "Collection progress");
  assert.equal(plot.children[0].attributes.viewBox, "0 0 390 268");
  assert.match(plot.attributes["aria-label"], /Collection progress/);
  assert.ok(plot.children[0].children.some(node => node.attributes.class === "analysis-stroke"));
});

test("missing collection months get a dashed connector rather than a fake zero-average line", () => {
  const plot = mockElement();
  plot.clientWidth = 420;
  const series = groupIntakeSeries([
    { date: "2026-07-01", volume: 300, count: 1 },
    { date: "2026-09-01", volume: 1000, count: 1 }
  ], "month", { start: "2026-07-01", end: "2026-09-30" });
  drawLineChart(plot, series.points, "average", "kg/day", "Collection trend");
  assert.equal(series.points[1].average, null);
  assert.ok(plot.children[0].children.some(node => node.attributes.class === "analysis-gap-stroke"));
});

test("mobile and desktop navigation, four production plots and QC balance drill-down are preserved", () => {
  const nav = readFileSync(new URL("../assets/js/app_navigation.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../mawimbi_analysis.html", import.meta.url), "utf8");
  const style = readFileSync(new URL("../assets/css/mawimbi_analysis.css", import.meta.url), "utf8");
  assert.match(nav, /label: "Analysis", href: "\.\/mawimbi_analysis.html".*requiredAggregator: "MAWIMBI"/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  for (const id of ["harvestPlot", "harvestCumulativePlot", "stockAveragePlot", "stockCumulativePlot", "stockPlot"]) {
    assert.ok(page.includes('id="' + id + '"'), "Missing " + id);
  }
  assert.match(page, /average daily collection/i);
  assert.match(page, /Accumulated stock produced/);
  assert.match(style, /analysis-chart-grid/);
  assert.match(style, /min-width:0/);
});

test("Processing yield is total pressed liquid divided by total matched received kg, not an average of daily ratios", () => {
  const metrics = buildProcessingMetrics([
    { record_date: "2026-07-29", received_seaweed_kg: 300, pressed_liquid_l: 90,
      created_at: "2026-08-02T08:00:00+03:00" },
    { record_date: "2026-07-30", received_seaweed_kg: 700, pressed_liquid_l: 420 },
    { record_date: "2026-08-01", received_seaweed_kg: 1000, pressed_liquid_l: 450 }
  ], "month", { start: "2026-07-01", end: "2026-08-31" });
  assert.equal(metrics.daily.length, 3);
  assert.equal(metrics.daily[0].date, "2026-07-29");
  assert.equal(metrics.received, 2000);
  assert.equal(metrics.pressed, 960);
  assert.equal(metrics.yield, .48);
  assert.equal(metrics.periods[0].received, 1000);
  assert.equal(metrics.periods[0].average, 500);
  assert.equal(metrics.periods[0].yield, .51);
  assert.equal(metrics.periods[1].yield, .45);
});

test("Two processing forms on the same date count as one processing day and are combined", () => {
  const metrics = buildProcessingMetrics([
    { record_date: "2026-09-15", received_seaweed_kg: 500, pressed_liquid_l: 200 },
    { record_date: "2026-09-15", received_seaweed_kg: 600, pressed_liquid_l: 240 },
    { record_date: "2026-09-16", received_seaweed_kg: 900, pressed_liquid_l: 450 }
  ], "week", { start: "2026-09-14", end: "2026-09-20" });
  assert.equal(metrics.daily.length, 2);
  assert.equal(metrics.daily[0].received, 1100);
  assert.equal(metrics.daily[0].yield, .4);
  assert.equal(metrics.periods[0].days, 2);
  assert.equal(metrics.periods[0].average, 1000);
  assert.equal(metrics.periods[0].yield, 890 / 2000);
});

test("Incomplete or zero denominator records cannot contaminate yield and are separately counted", () => {
  const metrics = buildProcessingMetrics([
    { record_date: "2026-10-10", received_seaweed_kg: 100, pressed_liquid_l: 40 },
    { record_date: "2026-10-10", received_seaweed_kg: 200, pressed_liquid_l: null },
    { record_date: "2026-10-11", received_seaweed_kg: 0, pressed_liquid_l: 20 }
  ], "month", { start: "2026-10-01", end: "2026-10-31" });
  assert.equal(metrics.received, 300);
  assert.equal(metrics.missing, 2);
  assert.equal(metrics.yield, .4);
  assert.equal(metrics.periods[0].yield, .4);
  assert.equal(metrics.periods[0].average, 150);
});

test("Processing trend respects selected date range and doesn't use submission timestamps", () => {
  const metrics = buildProcessingMetrics([
    { record_date: "2026-07-13", received_seaweed_kg: 600, pressed_liquid_l: 200 },
    { record_date: "2026-09-01", received_seaweed_kg: 1000, pressed_liquid_l: 450,
      created_at: "2026-10-04T07:00:00Z" }
  ], "month", { start: "2026-09-01", end: "2026-09-30" });
  assert.equal(metrics.daily.length, 1);
  assert.equal(metrics.daily[0].date, "2026-09-01");
  assert.equal(metrics.received, 1000);
  assert.equal(metrics.pressed, 450);
});

test("Processing scatter uses real dates and full, readable numeric axes on phones", () => {
  const plot = mockElement();
  plot.clientWidth = 390;
  const metrics = buildProcessingMetrics([
    { record_date: "2026-07-29", received_seaweed_kg: 378, pressed_liquid_l: 110 },
    { record_date: "2026-10-24", received_seaweed_kg: 800, pressed_liquid_l: 308 }
  ], "month", { start: "2026-07-01", end: "2026-10-31" });
  drawProcessingScatter(plot, metrics.daily, "received", "kg", "Daily processing received",
    { start: "2026-07-29", end: "2026-10-24" });
  assert.equal(plot.children[0].attributes.viewBox, "0 0 390 268");
  assert.equal(plot.children[0].children.filter(el => el.attributes.class === "analysis-point").length, 2);
  const axis = plot.children[0].children.filter(el => el.attributes["text-anchor"] === "end")
    .map(el => el.textContent);
  assert.ok(axis.includes("1,000") || axis.includes("1000"));
  assert.ok(axis.every(label => !label.includes("k")));
  const yieldPlot = mockElement();
  yieldPlot.clientWidth = 390;
  drawProcessingScatter(yieldPlot, metrics.daily, "yield", "L/kg", "Yield per processing day",
    { start: "2026-07-29", end: "2026-10-24" });
  assert.ok(yieldPlot.children[0].children.some(el => el.textContent === "0.300"));
});

test("Mawimbi Analysis includes processing plots and only displays them with Processing form capability", () => {
  const js = readFileSync(new URL("../assets/js/mawimbi_analysis.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../mawimbi_analysis.html", import.meta.url), "utf8");
  for (const id of ["processingAnalysisSection", "processingReceivedPlot", "processingAveragePlot",
    "processingDailyYieldPlot", "processingYieldPlot", "processingPeriodRows", "processingDailyRows"]) {
    assert.ok(page.includes('id="' + id + '"'), "Missing " + id);
  }
  assert.match(js, /hasOrganisationCapability\(access.profile, "form_process_record"\)/);
  assert.match(js, /p_record_type: "process"/);
  assert.match(page, /total pressed liquid \(L\).*received seaweed \(kg\)/i);
});


test("Rolling fourteen-day intake windows overlap on both sides of a Sunday/Monday boundary", () => {
  const result = rollingTrendPoints([
    {date:"2026-09-06",volume:1000,count:1},
    {date:"2026-09-07",volume:1000,count:1}
  ], {start:"2026-09-01",end:"2026-09-15"});
  assert.equal(result[0].date, "2026-09-01");
  assert.equal(result[1].date, "2026-09-08");
  assert.equal(result[0].volume, 2000);
  assert.equal(result[1].volume, 2000);
  assert.equal(result[0].average, 1000);
  assert.equal(result[1].average, 1000);
});

test("Rolling extraction yield is weighted by matching seaweed kg and ignores inactive dates", () => {
  const rows=[
    {date:"2026-08-02",received:100,yieldReceived:100,yieldPressed:20},
    {date:"2026-08-03",received:900,yieldReceived:900,yieldPressed:450},
    {date:"2026-08-20",received:700,yieldReceived:700,yieldPressed:280}
  ];
  const result=rollingTrendPoints(rows,{start:"2026-08-01",end:"2026-08-22"},"yield");
  assert.equal(result[0].yield, .47);
  assert.equal(result[0].average, 500);
  assert.equal(result[1].yield, .47);
  assert.equal(result[2].yield, null);
  assert.equal(result[3].yield, .4);
});

test("Rolling trend leaves gaps when no processing or collection days were recorded", () => {
  const rows=[
    {date:"2026-08-01",volume:300,count:1},
    {date:"2026-09-01",volume:900,count:1}
  ];
  const result=rollingTrendPoints(rows,{start:"2026-08-01",end:"2026-09-01"});
  assert.equal(result[0].average,300);
  assert.equal(result[2].average,null);
  assert.equal(result.at(-1).average,900);
});

test("Cumulative weekly points retain actual totals including prior filtered history", () => {
  const rows=[
    {date:"2026-07-29",volume:100},
    {date:"2026-08-02",volume:300},
    {date:"2026-08-03",volume:500},
    {date:"2026-08-16",volume:400}
  ];
  const result=cumulativeWeeklyPoints(rows,{start:"2026-08-01",end:"2026-08-16"});
  assert.equal(result[0].cumulative,100);
  assert.equal(result[1].cumulative,900);
  assert.equal(result.at(-1).cumulative,1300);
});

test("Default rolling selector, compact copy and outlier exclusion are visible without editing data", () => {
  const page=readFileSync(new URL("../mawimbi_analysis.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../assets/js/mawimbi_analysis.js",import.meta.url),"utf8");
  assert.equal((page.match(/value="rolling" selected/g)||[]).length,3);
  assert.match(js,/row\.date !== "2026-07-13"/);
  assert.match(page,/13 Jul outlier excluded/);
  assert.ok(!page.includes("Useful for spotting a shift in daily output"));
  assert.ok(!page.includes("Records missing either measurement are not included"));
  assert.match(js,/function rollingTrendPoints/);
  assert.match(js,/function cumulativeWeeklyPoints/);
});
