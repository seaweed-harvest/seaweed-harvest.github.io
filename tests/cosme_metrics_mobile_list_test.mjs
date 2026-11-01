import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../cosme_metrics.html");
const page = read("../assets/js/cosme_metrics_page.js");
const css = read("../assets/css/cosme_metrics.css");

test("mobile register uses collapsible controls and a dedicated metric list", () => {
  for (const id of ["mobileFiltersToggle", "mobileActionsToggle", "mobileFilters",
    "registerActions", "mobileLiveOnly", "mobileTopPicks", "mobileMetricList"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /aria-controls="mobileFilters"/);
  assert.match(html, /aria-controls="registerActions"/);
  assert.match(page, /button\.setAttribute\("aria-expanded",String\(open\)\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.metrics-filter-controls\.is-open \{ display: grid; \}/);
  assert.match(css, /\.metrics-action-controls\.is-open \{ display: flex; \}/);
});

test("phone cards are generated from the same filtered rows and original authorised overlays", () => {
  assert.match(page, /function renderMobileRows\(\)/);
  assert.match(page, /for\(const metric of visible\)/);
  assert.match(page, /const status=currentStatus\(metric\)/);
  assert.match(page, /const overlay=metricDisplay\(metric\)/);
  assert.match(page, /const formatted=displayMetricValue\(overlay\.value,overlay\.unit\)/);
  assert.match(page, /if\(state==="Live"\)card\.classList\.add\("metrics-mobile-card-live"\)/);
  assert.match(page, /if\(!metric\.operationalLive\)star\.addEventListener\("click",\(\)=>togglePick\(metric\.id\)\)/);
  assert.match(page, /open\.addEventListener\("click",\(\)=>openMetric\(metric,open\)\)/);
  assert.match(page, /tbody\.append\(fragment\);\s*renderMobileRows\(\);/);
  assert.match(page, /isLatestRelease\(\) && status\.kind==="linked" \? "Linked" : "Published"/);
});

test("quick filters stay in sync with original filters and do not change data", () => {
  assert.match(page, /if\(mobileLiveOnly\)visible=visible\.filter\(metric=>currentStatus\(metric\)\.kind==="live"\)/);
  assert.match(page, /el\("mobileTopPicks"\)\.setAttribute\("aria-pressed",String\(el\("featured"\)\.checked\)\)/);
  assert.match(page, /el\("mobileTopPicks"\)\.addEventListener\("click",\(\)=>\{/);
  assert.match(page, /el\("featured"\)\.checked=!el\("featured"\)\.checked;/);
  assert.match(page, /if\(!isLatestRelease\(\)\)mobileLiveOnly=false;/);
  assert.match(page, /mobileLiveOnly=false;\s*selectedCategories\.clear\(\);/);
  assert.match(css, /#metricScrollArea,\s*\.cosme-metrics-page #metricsStickyScroll \{ display: none !important; \}/);
  assert.match(css, /\.metrics-mobile-card-title \{[^}]*white-space: normal;/s);
  assert.match(css, /\.metrics-mobile-card-value \{[^}]*overflow-wrap: anywhere;/s);
});

test("desktop spreadsheet, export and scroll synchronisation remain in place", () => {
  assert.match(html, /id="metricHead"/);
  assert.match(html, /id="rows"/);
  assert.match(html, /id="exportCsv"/);
  assert.match(html, /id="metricsStickyScroll"/);
  assert.match(page, /stickyScroll\.addEventListener\("scroll"/);
  assert.match(page, /el\("exportCsv"\)\.addEventListener\("click", exportCsv\)/);
  assert.match(css, /\.metrics-filter-controls,\s*\.cosme-metrics-page \.metrics-action-controls \{ display: contents; \}/);
});
