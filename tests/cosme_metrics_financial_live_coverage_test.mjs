import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {financialContext, FINANCIAL_REVIEW, metricValueType, displayMetricValue} from "../assets/js/cosme_metrics_core.mjs";

test("all 20 financial metrics have explicit review metadata",()=>{
  assert.equal(Object.keys(FINANCIAL_REVIEW).length,20);
  assert.equal(new Set(Object.keys(FINANCIAL_REVIEW)).size,20);
  for(const [id,data] of Object.entries(FINANCIAL_REVIEW)){
    assert.match(id,/^(AGH|ON|MAW)-\d{4}$/);
    assert.ok(data.type && data.caveat);
  }
});
test("classification never misstates proposed amounts as paid",()=>{
  assert.equal(metricValueType({id:"AGH-0029"}),"Working estimate");
  assert.equal(metricValueType({id:"AGH-0031"}),"Historical budget");
  assert.equal(metricValueType({id:"AGH-0032"}),"Actuals unavailable");
  assert.equal(metricValueType({id:"AGH-0060"}),"Purchase order");
  assert.equal(metricValueType({id:"MAW-0057"}),"Invoice");
  assert.equal(metricValueType({id:"ON-0053"}),"Invoice-derived average");
  assert.equal(metricValueType({id:"OTHER"}),"Not classified");
  assert.match(financialContext({id:"MAW-0057"}).caveat,/not independently confirmed/i);
});
test("original numeric value and unit are unchanged",()=>{
  assert.equal(displayMetricValue("2065520","KES").full,"KES 2,065,520");
  assert.equal(displayMetricValue(null,"KES").full,"Not recorded");
});
test("current nursery information is a separate permission-gated read",()=>{
  const page=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
  assert.match(page,/cosme_metrics_live_rope_coverage/);
  assert.match(page,/requireMetrics\(\)/);
  assert.match(page,/Historical workbook figure/);
  assert.match(page,/currentRopeCoverage\.rope_count/);
  assert.match(html,/id="currentNurseryCoverage"/);
});
