import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../cosme_metrics.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../assets/js/cosme_metrics_page.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/css/cosme_metrics.css", import.meta.url), "utf8");

test("register exposes live-only filtering and a mirrored horizontal scrollbar", () => {
  assert.match(html, /id="linkedOnly"/);
  assert.match(html, /id="metricScrollArea"/);
  assert.match(html, /id="metricsStickyScroll"/);
  assert.match(js, /el\("linkedOnly"\)\.addEventListener\("change", renderRows\)/);
  assert.match(js, /stickyScroll\.addEventListener\("scroll"/);
  assert.match(js, /metricScrollArea\.addEventListener\("scroll"/);
  assert.match(css, /\.metrics-sticky-scroll\s*\{\s*position:\s*fixed;/);
});

test("row highlights require a verified runtime aggregate and never rewrite the release", () => {
  assert.match(js, /if\(currentDryerMetrics && DRYER_COMPARE\.some/);
  assert.match(js, /if\(currentRopeCoverage && metric\.id==="ON-0054"\)/);
  assert.match(js, /if\(mawimbiPanel\.metricContext\(metric\.id\)\)/);
  assert.match(js, /if\(mawimbiQcPanel\.metricContext\(metric\.id\)\)/);
  assert.match(js, /row\.classList\.add\("metrics-live-linked"\)/);
  assert.match(js, /liveValidated: false/);
  assert.match(js, /published value remains frozen/);
  assert.doesNotMatch(js, /metric\.value\s*=\s*currentDryerMetrics/);
});

test("activity cards and release history preserve existing navigation and approval model", () => {
  assert.match(js, /button\.className = "metrics-activity-card"/);
  assert.match(js, /activity\.value = name;\s*tab\("register"\)/);
  assert.match(css, /\.metrics-activity-card \{\s*display: flex;\s*flex-direction: column;/);
  assert.match(html, /Releases are prepared and verified separately|New releases are prepared and verified separately/);
  assert.doesNotMatch(html, /id="publishRelease"/);
});
