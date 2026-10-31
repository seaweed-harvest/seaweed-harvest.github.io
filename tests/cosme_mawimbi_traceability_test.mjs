import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateMawimbiTraceability} from "../assets/js/cosme_mawimbi_traceability.mjs";
const candidate={
  batch_id:"00000000-0000-4000-8000-000000000001",packed_on:"2026-10-30",
  cartons:12,date_count:1,link_id:null,confirmed_at:null,evidence_note:null,
  confirmed_process_number:null,suggested_process_id:"00000000-0000-4000-8000-000000000002",
  suggested_process_number:123
};
const unmatched={
  ...candidate,batch_id:"00000000-0000-4000-8000-000000000003",
  suggested_process_id:null,suggested_process_number:null
};
const review={
  can_view:true,total_batches:2,confirmed_links:0,same_day_candidates:1,
  unmatched_batches:1,queried_at:"2026-10-31T17:22:00Z",
  rows:[candidate,unmatched]
};
test("same-day suggestion stays unconfirmed",()=>{
 assert.equal(validateMawimbiTraceability(review),true);
 assert.equal(review.confirmed_links,0);
});
test("denies ungranted, duplicate and inconsistent records",()=>{
 assert.equal(validateMawimbiTraceability({...review,can_view:false}),false);
 assert.equal(validateMawimbiTraceability({...review,confirmed_links:1}),false);
 assert.equal(validateMawimbiTraceability({...review,rows:[candidate,candidate]}),false);
 assert.equal(validateMawimbiTraceability({...review,rows:[{...candidate,cartons:-1},unmatched]}),false);
});
test("accepts evidence-backed confirmation, rejects missing provenance",()=>{
 const confirmed={...candidate,link_id:"00000000-0000-4000-8000-000000000004",
   confirmed_at:"2026-10-31T17:24:00Z",
   evidence_note:"Checked processing logbook line 14",
   confirmed_process_number:123,
   suggested_process_id:null,suggested_process_number:null};
 assert.equal(validateMawimbiTraceability({...review,confirmed_links:1,same_day_candidates:0,rows:[confirmed,unmatched]}),true);
 assert.equal(validateMawimbiTraceability({...review,confirmed_links:1,same_day_candidates:0,rows:[{...confirmed,evidence_note:""},unmatched]}),false);
});
test("review and mutation are owner RPCs; no direct table writes",()=>{
 const js=readFileSync(new URL("../assets/js/cosme_mawimbi_traceability.mjs",import.meta.url),"utf8");
 const page=readFileSync(new URL("../assets/js/cosme_metrics_page.js",import.meta.url),"utf8");
 const html=readFileSync(new URL("../cosme_metrics.html",import.meta.url),"utf8");
 assert.match(js,/cosme_metrics_mawimbi_traceability_review/);
 assert.match(js,/cosme_metrics_confirm_mawimbi_stock_process/);
 assert.match(js,/cosme_metrics_revoke_mawimbi_stock_process/);
 assert.match(js,/evidence\.length<10/);
 assert.match(js,/reason\.length<10/);
 assert.doesNotMatch(js,/\.from\(['"]ag_stabilization_packing_records/);
 assert.match(page,/traceabilityPanel\.clear\(\)/);
 assert.match(page,/traceabilityPanel\.refresh\(\)/);
 assert.match(html,/id="currentMawimbiTraceability"/);
});
test("single and batch hydrometers use consistent unitless SG bounds",()=>{
 const html=readFileSync(new URL("../stabilization_packing.html",import.meta.url),"utf8");
 assert.match(html,/id="packingHydrometer" type="number" min="0.0001" max="10" step="0.0001"/);
 assert.match(html,/id="packingBatchHydrometer" type="number" min="0.0001" max="10" step="0.0001"/);
 assert.equal((html.match(/Record meter ID and calibration reference in Notes if available/g)||[]).length,2);
});
