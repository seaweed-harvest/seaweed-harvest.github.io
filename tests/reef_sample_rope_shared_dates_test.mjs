import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Table-column dates apply to each measured rope in that column, rather than
// requiring a date input on every rope. Week metadata remains independent.
const source = fs.readFileSync("assets/js/reef_nursery_site_capture.js","utf8");
const getFunction = name => {
  const start = source.indexOf("function " + name + "(");
  assert(start >= 0, name + " must exist");
  const end = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, end < 0 ? source.length : end);
};
const input = (value = "") => ({value});
const stages = ["initial","week_2","week_4","week_6"];
const fields = ["species","rope_weight_kg","initial_weight_kg","week_2_kg","week_4_kg","week_6_kg"];
function mkRow(number) {
  const cells = Object.fromEntries(fields.map(x => [x,input()]));
  const metadata = Object.fromEntries(stages.map(x => [x,{textContent:""}]));
  return { dataset:{ropeNumber:String(number)}, cells, metadata,
    querySelector(selector) {
      const m = selector.match(/data-rope-field="([^"]+)"/);
      if (m) return cells[m[1]] || null;
      const n = selector.match(/data-rope-meta="([^"]+)"/);
      return metadata[n?.[1]] || null;
    }
  };
}
const rows = [1,2,5,6,9,10].map(mkRow);
const dates = Object.fromEntries(stages.map(x => [x,input()]));
const times = Object.fromEntries(stages.map(x => [x,input()]));
const mixed = Object.fromEntries(stages.map(x => [x,{hidden:true,textContent:""}]));
const panel = {
 querySelectorAll(sel) { assert.equal(sel,"[data-sample-rope-row]"); return rows; },
 querySelector(sel) {
   const match = sel.match(/data-stage-(date|time|mixed)="([^"]+)"/);
   if (!match) return null;
   return {date:dates,time:times,mixed}[match[1]][match[2]];
 }
};
const visit = {
 reefSampleVisitRecorder:input("Recorder B"),
 reefSampleVisitTeam:input("community"),
 reefSampleVisitOtherTeam:input("")
};
let status = "";
const state = {sampleSavedRows:new Map(),sampleStageEdits:new Set(),sampleRegisterDirty:false};
const context = {SAMPLE_STAGES:stages,els:{reefSampleRopePanel:panel,...visit},state,
 Number,Map,Set,String,Object,
 setSampleStatus:s=>{status=s;},
 kenyaNow:()=>({date:"2026-10-15"})};
vm.createContext(context);
new vm.Script([
  getFunction("sampleStageField"),
  getFunction("sampleStageDateField"),
  getFunction("stageControl"),
  getFunction("collectSampleRopeRows"),
  getFunction("applySampleRegister"),
  getFunction("markSampleRegisterDirty"),
  getFunction("validatedSampleVisit")
].join("\n")).runInContext(context);

const initialA = {date:"2026-08-01",recorder:"Recorder A",team:"pik"};
const initialC = {date:"2026-08-03",recorder:"Recorder C",team:"pik"};
const week2B = {date:"2026-08-17",recorder:"Recorder B",team:"community"};
context.applySampleRegister({rows:[
 {rope_number:1,species:"spinosum",date_seeded:"2026-08-01",initial_weight_kg:1.5,week_2_kg:1.9,week_2_date:"2026-08-17",measurement_provenance:{initial:initialA,week_2:week2B}},
 {rope_number:2,species:"spinosum",date_seeded:"2026-08-03",initial_weight_kg:1.6,week_2_kg:2.0,week_2_date:"2026-08-17",measurement_provenance:{initial:initialC,week_2:week2B}}
]});
assert.equal(dates.initial.value,"","Different historical initial dates must not be overwritten");
assert.equal(mixed.initial.hidden,false);
assert.equal(dates.week_2.value,"2026-08-17");
assert.match(rows[0].metadata.initial.textContent,/Recorder A/);
assert.match(rows[0].metadata.week_2.textContent,/Recorder B/);
const first = context.collectSampleRopeRows();
assert.equal(first[0].date_seeded,"2026-08-01");
assert.equal(first[1].date_seeded,"2026-08-03");
assert.equal(first[0].week_2_date,undefined,"Unedited week date is preserved server-side");

// Backfill all initial dates and a different week-two date in one save.
dates.initial.value="2026-08-02";
dates.week_2.value="2026-08-18";
times.week_2.value="11:35";
context.markSampleRegisterDirty({target:{closest:sel=>sel==="[data-stage-date]"?{dataset:{stageDate:"initial"}}:null}});
context.markSampleRegisterDirty({target:{closest:sel=>sel==="[data-stage-date]"?{dataset:{stageDate:"week_2"}}:null}});
const payload=context.collectSampleRopeRows();
assert.equal(payload[0].date_seeded,"2026-08-02");
assert.equal(payload[1].date_seeded,"2026-08-02");
assert.equal(payload[0].week_2_date,"2026-08-18");
assert.equal(payload[1].week_2_date,"2026-08-18");
assert.equal(payload[2].date_seeded,null,"Unmeasured rope is not given an initial date");
assert.equal(payload[2].week_2_date,undefined,"Unmeasured rope does not gain a Week 2 date");
assert.equal(payload[0].week_4_date,undefined);
const attrs=context.validatedSampleVisit(payload);
assert.equal(attrs.stage_dates.initial.date,"2026-08-02");
assert.equal(attrs.stage_dates.week_2.date,"2026-08-18");
assert.equal(attrs.stage_dates.week_2.time,"11:35");
assert.equal(attrs.stage_dates.week_4.edited,false);
assert.equal(attrs.recorder,"Recorder B");
assert.equal(state.sampleRegisterDirty,true);

// Clearing a date on an explicitly edited stage must not destroy saved dates.
dates.initial.value="";
assert.equal(context.validatedSampleVisit(payload),null);
assert.match(status,/date above Initial Weight/i);
context.applySampleRegister({rows:[]});
assert.equal(dates.initial.value,"");
assert.equal(rows[0].metadata.initial.textContent,"");
assert.equal(state.sampleStageEdits.size,0);
console.log("Independent header dates/time and per-rope historical preservation passed.");
