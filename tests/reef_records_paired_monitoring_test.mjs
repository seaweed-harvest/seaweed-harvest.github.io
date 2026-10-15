import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const raw = fs.readFileSync("assets/js/reef_seaweed_records_page.js", "utf8");
const markup = fs.readFileSync("reef_seaweed_records.html", "utf8");
const entry = fs.readFileSync("assets/js/reef_nursery_site_capture.js", "utf8");
const aliases = fs.readFileSync("assets/js/reef_mkwiro_raft_labels.js", "utf8");
const { mkwiroRaftDisplayLabel } = await import(
  "data:text/javascript;base64," + Buffer.from(aliases).toString("base64")
);
const calls = [];
const docInputs = [];
const content = { innerHTML:"", replaceChildren() {this.innerHTML="";}, addEventListener(){} };
const detail = { hidden:true };
const heading = { textContent:"" };
const status = {textContent:"",dataset:{}};
const sites = {
  "MK-R2": {site_code:"MK-R2",site_name:"Cascadia Prototype",location:"mkwiro",structure_type:"raft",rows:[
    {rope_number:1,species:"spinosum",rope_weight_kg:0.188,initial_weight_kg:1.56,date_seeded:"2026-09-29",week_2_kg:2.33,week_2_date:"2026-10-13",measurement_provenance:{week_2:{date:"2026-10-13",time:"11:30"}}}
  ]},
  "MK-SF2/R2": {site_code:"MK-SF2/R2",site_name:"Shore Farm 2",location:"mkwiro",structure_type:"shore_farm",rows:[]},
  "MK-R1": {site_code:"MK-R1",site_name:"Rectangular Raft",location:"mkwiro",structure_type:"raft",rows:[]},
  "MK-SF1/R1": {site_code:"MK-SF1/R1",site_name:"Shore Farm 1",location:"mkwiro",structure_type:"shore_farm",rows:[]}
};
const context = {
  mkwiroRaftDisplayLabel,
  authClient:{rpc:async(method,args)=>{
    calls.push([method,args.p_site_code || args.p_capture_id]);
    if(method==="ag_reef_sample_rope_register") {
      if(!sites[args.p_site_code]) return {error:new Error("Site unavailable"),data:null};
      return {data:sites[args.p_site_code],error:null};
    }
    if(method==="ag_public_cosme_reef_site_capture_detail") return {data:{
      record_number:"Seaweed Site Capture 3",location:"mkwiro",site_code:"MK-R2",
      site_name:"Cascadia Prototype",species:"spinosum",observed_at:"2026-10-15T09:00:00Z",
      recorded_by_name:"Recorder B",monitoring_team:"community",health_environment:{}
    },error:null};
    throw new Error("Unexpected RPC "+method);
  }},
  document:{readyState:"loading",addEventListener(){},querySelectorAll:()=>docInputs},
  Intl, Date, Set, Map, Promise, Number, String, Object, Array
};
vm.createContext(context);
vm.runInContext(raw.replace(/^import[\s\S]*?from "[^"]+";\s*/gm,""),context);
const els = vm.runInContext("els",context);
els.reefSeaweedRecordDetail = detail;
els.reefSeaweedRecordDetailTitle = heading;
els.reefSeaweedRecordDetailContent = content;
els.reefSeaweedRecordDetailStatus = status;
const state = vm.runInContext("state",context);
const wait = () => new Promise(resolve=>setImmediate(resolve));

assert(!markup.includes('data-open-reef-pair='), "Fixed paired buttons should be replaced");
assert(!markup.includes("Group A"), "Fixed Group A/B/C options are removed");
assert(!markup.includes('data-select-reef-site='), "Only records-list selections remain");
assert(markup.includes('id="reefSampleRopeDataTab"'), "Sample Rope Data tab exists");
assert(markup.includes("<th scope=\"col\">Show</th>"));
assert(markup.includes("Clear selection"));
assert.match(entry,/reef-rope-rs-label[^>]*>R\+S/);
assert.match(entry,/R\+S = Rope \+ Seaweed weight/);
assert(!entry.includes("data-rope-meta=\""),"Saved measurement captions should remain hidden");

// One checkbox displays only its selected site, even if a related site exists.
context.toggleSelectedRecord("sample_rope_register","MK-R2","Raft A",true);
await wait();
assert.equal(state.selectedRecords.size,1);
assert.deepEqual(calls,[["ag_reef_sample_rope_register","MK-R2"]]);
assert.match(content.innerHTML,/Raft A/);
assert.doesNotMatch(content.innerHTML,/Farm A/);
assert.match(content.innerHTML,/29 Sept 2026/);
assert.match(content.innerHTML,/reef-register-date-row/);
assert.equal((content.innerHTML.match(/<h4>MK-R2 \(Cascadia Prototype\) \| Raft A<\/h4>/g) || []).length,1,"No duplicated record heading");
assert(!content.innerHTML.includes("Time: 11:30"), "Optional recording time not displayed");


// Adding Farm A retains Raft A rather than replacing it.
context.toggleSelectedRecord("sample_rope_register","MK-SF2/R2","Farm A",true);
await wait();
assert.equal(state.selectedRecords.size,2);
assert.deepEqual(calls,[["ag_reef_sample_rope_register","MK-R2"],["ag_reef_sample_rope_register","MK-SF2/R2"]]);
assert.match(content.innerHTML,/Raft A/);
assert.match(content.innerHTML,/Farm A/);
assert.match(content.innerHTML,/No rope measurements recorded yet/);


// Deselecting the raft retains the farm card and vice versa.
context.toggleSelectedRecord("sample_rope_register","MK-R2","Raft A",false);
assert.equal(state.selectedRecords.size,1);


assert.doesNotMatch(content.innerHTML,/Cascadia Prototype/);
assert.match(content.innerHTML,/Shore Farm 2/);

// Selecting a Site Capture in the records list can coexist with the farm.
context.toggleSelectedRecord("site_capture","capture-1","Capture 3",true);
await wait();
assert.equal(state.selectedRecords.size,2);
assert.match(content.innerHTML,/Capture 3/);
assert.match(content.innerHTML,/Farm A/);
assert(calls.some(([method])=>method==="ag_public_cosme_reef_site_capture_detail"));

// Existing list row checkbox is tied to the same selection, not a duplicate.
state.rows=[{record_kind:"sample_rope_register",record_key:"MK-SF2/R2",record_number:"Farm A"}];
els.reefSeaweedRecordRows={innerHTML:""};
els.reefSeaweedRecordsPage={textContent:""};
els.previousReefSeaweedRecords={disabled:false};
els.nextReefSeaweedRecords={disabled:false};
context.renderRows();
assert.match(els.reefSeaweedRecordRows.innerHTML,/data-select-reef-record/);
assert.match(els.reefSeaweedRecordRows.innerHTML,/checked/);
assert.equal(state.selectedRecords.size,2);

// Each selected panel has an independent Remove action, plus Clear selection.
assert.match(content.innerHTML,/data-remove-reef-selection/);
context.removeSelectedRecord("site_capture:capture-1");
assert.equal(state.selectedRecords.size,1);
context.closeDetail();
assert.equal(state.selectedRecords.size,0);
assert.equal(detail.hidden,true);


// Errors on one site must not suppress other selected records.
context.toggleSelectedRecord("sample_rope_register","MK-R3","Raft B",true);
context.toggleSelectedRecord("sample_rope_register","MK-R1","Raft C",true);
await wait();
assert.match(content.innerHTML,/Site unavailable/);
assert.match(content.innerHTML,/Rectangular Raft/);
assert.equal(state.selectedRecords.size,2);

console.log("Individual/multi record selection, stacked date-row tables and R+S labels verified.");

await import("./reef_rope_data_grid_test.mjs");
