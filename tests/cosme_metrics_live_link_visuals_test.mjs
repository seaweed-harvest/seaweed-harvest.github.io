import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const html=read("../cosme_metrics.html");
const js=read("../assets/js/cosme_metrics_page.js");
const live=read("../assets/js/cosme_metrics_live_values.mjs");
const css=read("../assets/css/cosme_metrics.css");

test("register offers automatic current values, link filter and bottom scrollbar",()=>{
  assert.match(html,/id="showLiveValues" checked/);
  assert.match(html,/id="refreshLiveValues"/);
  assert.match(html,/id="linkedOnly"/);
  assert.match(html,/id="metricsStickyScroll"/);
  assert.match(js,/stickyScroll\.addEventListener\("scroll"/);
  assert.match(js,/metricScrollArea\.addEventListener\("scroll"/);
  assert.match(css,/\.metrics-sticky-scroll\s*\{\s*position:\s*fixed;/);
});

test("only precise validated live values are substituted; linked records remain distinct",()=>{
  assert.match(live,/const DRYER_FIELDS = Object\.freeze/);
  assert.match(live,/if \(id === "ON-0054"/);
  assert.match(live,/dryer\?\.can_view === true/);
  assert.match(live,/coverage\?\.can_view === true/);
  assert.match(live,/kind:"linked"/);
  assert.match(js,/row\.classList\.add\("metrics-live-linked"\)/);
  assert.match(js,/row\.classList\.add\("metrics-data-linked"\)/);
  assert.match(js,/liveValidated: false/);
  assert.match(js,/el\("showLiveValues"\)\.disabled=!isLatestRelease\(\)/);
  assert.match(js,/exportMetricViewCsv\(visible/);
  assert.match(live,/publishedValue: metric\.value/);
});

test("overview cards remain clickable; immutable publication is not UI-editable",()=>{
  assert.match(js,/button\.className = "metrics-activity-card"/);
  assert.match(js,/activity\.value = name;\s*tab\("register"\)/);
  assert.match(css,/\.metrics-activity-card \{\s*display: flex;\s*flex-direction: column;/);
  assert.match(html,/New releases are prepared and verified separately/);
  assert.doesNotMatch(html,/id="publishRelease"/);
});
