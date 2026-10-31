import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateMawimbiStockQc} from "../assets/js/cosme_mawimbi_stock_qc.mjs";
const fixture={
  can_view:true,status:"current",metric_id:"MAW-0087",
  batch_qc_completeness_verified:false,process_stock_linkage_verified:false,
  initial_records:5,cartons:5,retest_records:2,referenced_batch_ids:1,
  ph_recorded:3,brix_recorded:2,ec_recorded:3,sg_recorded:0,
  month_count:2,source_updated_at:"2026-10-31T11:00:00Z",queried_at:"2026-10-31T17:12:00Z",
  months:[
    {month:"2026-10-01",initial_records:3,retest_records:2,ph_recorded:2,brix_recorded:2,ec_recorded:2,sg_recorded:0},
    {month:"2026-09-01",initial_records:2,retest_records:0,ph_recorded:1,brix_recorded:0,ec_recorded:1,sg_recorded:0}
  ]
};
test("accepts record counts but explicitly unverified batch QC",()=>{
 assert.equal(validateMawimbiStockQc(fixture),true);
 assert.equal(fixture.batch_qc_completeness_verified,false);
});
test("denies unauthorized, bad sums and manufactured QC completeness",()=>{
 assert.equal(validateMawimbiStockQc({...fixture,can_view:false}),false);
 assert.equal(validateMawimbiStockQc({...fixture,batch_qc_completeness_verified:true}),false);
 assert.equal(validateMawimbiStockQc({...fixture,process_stock_linkage_verified:true}),false);
 assert.equal(validateMawimbiStockQc({...fixture,initial_records:6}),false);
 assert.equal(validateMawimbiStockQc({...fixture,months:[fixture.months[0],fixture.months[0]]}),false);
});
test("isolates current stock QC from original 302 metric register",()=>{
 const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
 const page=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
 const panel=readFileSync(new URL("../assets/js/cosme_mawimbi_stock_qc.mjs",import.meta.url),"utf8");
 assert.match(html,/id="currentMawimbiStockQc"/);
 assert.match(page,/mawimbiQcPanel\.refresh\(\)/);
 assert.match(page,/mawimbiQcPanel\.clear\(\)/);
 assert.match(page,/mawimbiQcPanel\.metricContext/);
 assert.match(panel,/cosme_metrics_live_mawimbi_stock_qc/);
 assert.match(panel,/not been matched to processing submissions/);
 assert.doesNotMatch(panel,/\.from\(['"]ag_stabilization_packing_records/);
});
