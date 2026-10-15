import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = fs.readFileSync("assets/js/reef_sample_rope_data_table.js", "utf8");
const markup = fs.readFileSync("reef_seaweed_records.html", "utf8");
const aliases = fs.readFileSync("assets/js/reef_mkwiro_raft_labels.js", "utf8");
const { mkwiroRaftDisplayLabel } = await import(
  "data:text/javascript;base64," + Buffer.from(aliases).toString("base64")
);
const context = {mkwiroRaftDisplayLabel, Intl, Date, Set, Map, String, Number, Array, Object};
vm.createContext(context);
vm.runInContext(
  source.replace(/^import[\s\S]*?from "[^"]+";\s*/gm, "").replace(/^export /gm, ""),
  context
);
const flatten = vm.runInContext("flattenActiveRopeRegisters",context);
const sort = vm.runInContext("sortRopeData",context);
const defaults = [...vm.runInContext("DEFAULT_ROPE_COLUMNS",context)];
const columns = [...vm.runInContext("ROPE_DATA_COLUMNS",context)];
assert.deepEqual(defaults, [
  "site","rope_number","species","rope_weight_kg",
  "initial_weight_kg","initial_date","week_2_kg","week_2_date",
  "week_4_kg","week_4_date","week_6_kg","week_6_date"
]);
assert(columns.length > defaults.length, "Additional optional columns offered");
assert(markup.includes('id="reefSampleRopeDataTab"'));
assert(markup.includes('id="reefSampleRopeDataHead"'));
assert(markup.includes('id="reefSampleRopeDataColumns"'));
assert(markup.includes('id="reefRecordsListTab"'));
assert(markup.includes('class="reef-selected-records-grid"') === false || 
  markup.includes(".reef-selected-records-grid { display:grid; grid-template-columns:minmax(0,1fr)"));
assert(!markup.includes('Group A'), "Group A/B/C selectors removed");
assert(!markup.includes('data-select-reef-site'), "No fixed Mkwiro site picker remains");
const records = [
 {site:{site_code:"MK-R2",site_name:"Cascadia Prototype",location:"mkwiro",structure_type:"raft"},
  register:{rows:[
   {rope_number:2,species:"spinosum",rope_weight_kg:0.145,initial_weight_kg:1.83,
    date_seeded:"2026-09-29",week_2_kg:2.1,week_2_date:"2026-10-13",history_count:1,
    measurement_provenance:{initial:{recorder:"A"},week_2:{recorder:"B"}}},
   {rope_number:1,species:"spinosum",rope_weight_kg:0.175,initial_weight_kg:1.105,date_seeded:"2026-09-29",
    week_2_kg:null,week_2_date:null},
   {rope_number:5,species:null,rope_weight_kg:null,initial_weight_kg:null,week_2_kg:null,week_4_kg:null,week_6_kg:null}
  ]}},
 {site:{site_code:"MK-SF2/R2",site_name:"Shore Farm 2",location:"mkwiro",structure_type:"shore_farm"},
  register:{rows:[{rope_number:1,species:"spinosum",rope_weight_kg:0.188,initial_weight_kg:1.56,
    measurement_provenance:{initial:{date:"2026-09-30",recorder:"C"}}}]}},
 {site:{site_code:"TB-R1",site_name:"LM / PIK Raft 1",location:"tumbe",structure_type:"raft"},
  register:{rows:[]}}
];
const rows=flatten(records);
assert.equal(rows.length,3,"Only populated active ropes from all sites");
assert.equal(rows[0].site,"MK-R2 (Cascadia Prototype) | Raft A");
assert.equal(rows[2].site,"MK-SF2/R2 (Shore Farm 2) | Farm A");
assert.equal(rows[0].week_2_date,"2026-10-13");
assert.equal(rows[2].initial_date,"2026-09-30","Date falls back to saved provenance");
assert.equal(rows[2].initial_recorder,"C");
assert.equal(rows[0].week_2_recorder,"B");
assert.equal(rows[0].history_count,1);
assert.deepEqual([...sort(rows,"rope_number")].map(x=>x.rope_number),[1,1,2]);
assert.deepEqual([...sort(rows,"initial_weight_kg","desc")].map(x=>x.initial_weight_kg),[1.83,1.56,1.105]);
assert.deepEqual([...sort(rows,"week_2_date")].map(x=>x.week_2_date),["2026-10-13", "", ""]);
assert(source.includes('ag_reef_site_capture_workspace_context'), "Sites discovered dynamically");
assert(source.includes('ag_reef_sample_rope_register'), "Public read-only register per site");
assert(source.includes('Promise.allSettled'), "Partial site failures reported");
assert(!source.includes("ag_reef_sample_rope_register_save"), "Flat table never writes measurements");
console.log("All-sites consolidated Sample Rope Data columns, sorting, filtering and read-only acquisition passed.");
