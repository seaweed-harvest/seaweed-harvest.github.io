import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateNurseryQuality } from "../assets/js/cosme_nursery_growth.mjs";

const growth={
 sites:[{site_code:"MK-SF1/R1",initial_n:6,week4_n:5}],
 can_view:true,active_initial_ropes:6,week4_matched_ropes:5
};
const quality={
 can_view:true,status:"current",
 queried_at:"2026-10-31T16:45:00Z",source_updated_at:"2026-10-31T11:50:50Z",
 sites:[{site_code:"MK-SF1/R1",initial_n:6,week4_n:5,due_missing_week4:1,pending_week4:0,
  tare_review_n:2,min_factor:1.133,p25_factor:1.460,median_factor:1.533,p75_factor:1.930,
  max_factor:1.997,sgr_stddev_pct_per_day:0.85}]
};
test("validates same-cohort quality with one missing follow-up and two tare review flags",()=>{
 assert.equal(validateNurseryQuality(quality,growth),true);
 assert.equal(quality.sites[0].due_missing_week4,1);
 assert.equal(quality.sites[0].tare_review_n,2);
});
test("rejects ungranted, mismatched and inverted distributions",()=>{
 assert.equal(validateNurseryQuality({...quality,can_view:false},growth),false);
 assert.equal(validateNurseryQuality({...quality,sites:[{...quality.sites[0],week4_n:6}]},growth),false);
 assert.equal(validateNurseryQuality({...quality,sites:[{...quality.sites[0],median_factor:0.7}]},growth),false);
 assert.equal(validateNurseryQuality({...quality,sites:[{...quality.sites[0],pending_week4:6}]},growth),false);
});
test("ensures overview reports missing organisational connections rather than inferred live data",()=>{
 const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
 const page=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
 const growthSource=readFileSync(new URL("../assets/js/cosme_nursery_growth.mjs",import.meta.url),"utf8");
 assert.match(html,/id="metricsConnectionStatus"/);
 assert.match(page,/Mawimbi", false, "Historical reference only"/);
 assert.match(page,/Aggregation Hub", false, "Historical reference only"/);
 assert.match(growthSource,/cosme_metrics_live_nursery_quality/);
 assert.match(growthSource,/Flags do not change recorded weights/);
});
