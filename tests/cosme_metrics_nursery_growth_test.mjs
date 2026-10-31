import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateNurseryGrowth } from "../assets/js/cosme_nursery_growth.mjs";

const sample = {
  can_view:true,status:"current",
  active_initial_ropes:6,week2_matched_ropes:6,week4_matched_ropes:5,site_count:1,
  source_updated_at:"2026-10-31T11:50:50Z",queried_at:"2026-10-31T16:45:00Z",
  sites:[{site_code:"MK-SF1/R1",structure:"shore",area:"Mkwiro",
    initial_n:6,week2_n:6,week4_n:5,
    week2_initial_kg:9,week2_net_kg:10.515,week2_factor:1.168,
    week4_initial_kg:7.5,week4_net_kg:12.08,week4_factor:1.611,
    week4_mean_gain_kg_per_rope_day:0.034,
    week4_mean_sgr_pct_per_day:1.69,
    week4_days_min:27,week4_days_max:27}],
  structures:[{structure:"shore",week4_n:5,matched_initial_kg:7.5,
    matched_week4_kg:12.08,week4_factor:1.611,mean_sgr_pct_per_day:1.69}]
};

test("accepts a partial Week 4 sample without filling missing rope with zero",()=>{
  assert.equal(validateNurseryGrowth(sample),true);
  assert.equal(sample.sites[0].week4_n,5);
  assert.equal(sample.sites[0].initial_n,6);
});

test("does not accept ungranted or inconsistent aggregate data",()=>{
  assert.equal(validateNurseryGrowth({...sample,can_view:false}),false);
  assert.equal(validateNurseryGrowth({...sample,status:"published"}),false);
  assert.equal(validateNurseryGrowth({...sample,week4_matched_ropes:6}),false);
  assert.equal(validateNurseryGrowth({...sample,sites:[{...sample.sites[0],week4_n:7}]}),false);
  assert.equal(validateNurseryGrowth({...sample,sites:[sample.sites[0],sample.sites[0]],site_count:2,active_initial_ropes:12,week2_matched_ropes:12,week4_matched_ropes:10}),false);
});

test("does not accept invalid or missing timestamps",()=>{
  assert.equal(validateNurseryGrowth({...sample,queried_at:"not-a-date"}),false);
  assert.equal(validateNurseryGrowth({...sample,source_updated_at:"garbage"}),false);
});

test("panel independently reads growth RPC and does not alter frozen V0.1",()=>{
  const app=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../assets/js/cosme_nursery_growth.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
  assert.match(app,/createNurseryGrowthPanel/);
  assert.match(app,/nurseryGrowthPanel\.refresh\(\)/);
  assert.match(app,/nurseryGrowthPanel\.clear\(\)/);
  assert.match(panel,/cosme_metrics_live_nursery_growth/);
  assert.match(panel,/not whole-farm yield, survival/);
  assert.match(html,/id="currentNurseryGrowth"/);
  assert.doesNotMatch(panel,/\.from\(['"]ag_reef_sample_rope_cycles/);
});
