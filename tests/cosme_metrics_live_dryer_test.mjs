import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {displayMetricValue} from "../assets/js/cosme_metrics_core.mjs";

const page = readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
const html = readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
const css = readFileSync(new URL("../assets/css/cosme_metrics.css",import.meta.url),"utf8");

test("four frozen dryer metrics remain separate from current aggregation",()=>{
  for(const id of ["SDT-0063","SDT-0064","SDT-0065","SDT-0066"]) {
    assert.ok(page.includes(id),id);
  }
  assert.match(page,/displayMetricValue\(item\.metric\.value,item\.metric\.unit\)/);
  assert.match(page,/displayMetricValue\(currentDryerMetrics\[item\.key\],item\.unit\)/);
  assert.doesNotMatch(page,/metric\.value\s*=\s*currentDryerMetrics/);
  assert.equal(displayMetricValue("1397.2","kg").full,"1,397.2 kg");
});
test("metrics endpoint is owner-gated and validated before display",()=>{
  assert.match(page,/authClient\.rpc\("cosme_metrics_live_dryer_metrics"\)/);
  assert.match(page,/const grant = await requireMetrics\(\)/);
  assert.match(page,/!data\?\.can_view/);
  assert.match(page,/data\.excluded_completed/);
  assert.match(page,/source_updated_at/);
  assert.match(page,/queried_at/);
});
test("comparison is responsive and visible in the Overview",()=>{
  assert.match(html,/id="currentDryerMetrics"/);
  assert.match(css,/metrics-dryer-comparison-wrap/);
  assert.match(css,/overflow-x:auto/);
  assert.match(html,/cosme_metrics_page\.js\?v=\d+/);
});
