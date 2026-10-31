import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateMawimbiOperations} from "../assets/js/cosme_mawimbi_operations.mjs";

const actual = {
  can_view:true,status:"current",month_count:2,
  payment_verified:false,batch_linkage_verified:false,
  excluded_unfinalized_collections:108,excluded_late_unfinalized_collections:108,
  source_updated_at:"2026-10-31T15:48:56Z",queried_at:"2026-10-31T17:05:00Z",
  months:[
    {month:"2026-10-01",collection_records:147,collection_wet_kg:13437,
     processing_sessions:17,processing_received_kg:12887,pressed_l:4599.17},
    {month:"2026-09-01",collection_records:183,collection_wet_kg:13854,
     processing_sessions:15,processing_received_kg:12819,pressed_l:5485.51}
  ]
};
test("accepts validated monthly Mawimbi aggregate",()=>{
  assert.equal(validateMawimbiOperations(actual),true);
});
test("never labels unverified payment or batch linkage as verified",()=>{
  assert.equal(validateMawimbiOperations({...actual,payment_verified:true}),false);
  assert.equal(validateMawimbiOperations({...actual,batch_linkage_verified:true}),false);
  assert.equal(validateMawimbiOperations({...actual,can_view:false}),false);
});
test("rejects duplicates, inverted chronology and malformed values",()=>{
  assert.equal(validateMawimbiOperations({...actual,months:[actual.months[0],actual.months[0]]}),false);
  assert.equal(validateMawimbiOperations({...actual,months:[...actual.months].reverse()}),false);
  assert.equal(validateMawimbiOperations({...actual,months:[{...actual.months[0],collection_wet_kg:-5},actual.months[1]]}),false);
  assert.equal(validateMawimbiOperations({...actual,month_count:3}),false);
});
test("page shows owner-only operations without changing original metrics",()=>{
  const page=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../assets/js/cosme_mawimbi_operations.mjs",import.meta.url),"utf8");
  assert.match(page,/createMawimbiOperationsPanel/);
  assert.match(page,/mawimbiPanel\.refresh\(\)/);
  assert.match(page,/mawimbiPanel\.clear\(\)/);
  assert.match(html,/id="currentMawimbiOperations"/);
  assert.match(panel,/cosme_metrics_live_mawimbi_operations/);
  assert.match(panel,/do not establish paid farmer purchases/);
  assert.doesNotMatch(panel,/\.from\(['"]collections/);
});
