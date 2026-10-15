import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = fs.readFileSync("assets/js/reef_sample_rope_data_table.js", "utf8");
const markup = fs.readFileSync("reef_seaweed_records.html", "utf8");
const aliases = fs.readFileSync("assets/js/reef_mkwiro_raft_labels.js", "utf8");
const { mkwiroRaftDisplayLabel } = await import(
  "data:text/javascript;base64," + Buffer.from(aliases).toString("base64")
);
const storage = new Map();
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
const context = {
  mkwiroRaftDisplayLabel, window: {localStorage},
  Intl, Date, Set, Map, Number, String, Array, Object, Promise
};
vm.createContext(context);
vm.runInContext(source.replace(/^import[\s\S]*?from "[^"]+";\s*/gm,"").replace(/^export /gm,""),context);
const calculate = vm.runInContext("rowRelativeWeightColours",context);
const siteFilter = vm.runInContext("filterRopeRowsBySites",context);
const initialize = vm.runInContext("initializeSampleRopeDataTable",context);

assert.deepEqual(Object.keys(calculate({
  rope_weight_kg: 0.15, initial_weight_kg: 1, week_2_kg: 3, week_4_kg: 2
})).sort(),["initial_weight_kg","week_2_kg","week_4_kg"]);
const range = calculate({initial_weight_kg: 1, week_2_kg:3,week_4_kg:2,week_6_kg:null});
assert.equal(range.initial_weight_kg.css,"background-color:hsl(0 68% 88%);");
assert.equal(range.week_4_kg.css,"background-color:hsl(60 68% 88%);");
assert.equal(range.week_2_kg.css,"background-color:hsl(120 68% 88%);");
assert.equal(calculate({initial_weight_kg:2,week_2_kg:2}).initial_weight_kg.css,"background-color:hsl(60 68% 88%);","Equal saved weights use a neutral baseline");
assert.equal(calculate({initial_weight_kg:2}).initial_weight_kg.css,"background-color:hsl(60 68% 88%);","An Initial-only row must also be coloured");
assert.equal(Object.keys(calculate({initial_weight_kg:0,week_2_kg:1})).length,2,"Zero is a valid lower measurement");
assert.equal(Object.keys(calculate({rope_weight_kg:.15,initial_weight_kg:null,week_2_kg:""})).length,0);
assert.deepEqual(siteFilter([{site_code:"MK-R2"},{site_code:"MK-SF2/R2"}],new Set(["MK-R2"])).map(x=>x.site_code),["MK-R2"]);

assert(markup.includes('id="reefSampleRopeSiteFilter"'));
assert(markup.includes('id="reefSampleRopeSiteChoices"'));
assert(markup.includes('id="reefSampleRopeSitesAll"'));
assert(markup.includes('id="reefSampleRopeSitesNone"'));
assert(markup.includes("reef-rope-heat-legend"));
assert(markup.includes('reef-rope-site-filter-menu'));
assert(markup.includes("Rope Weight excluded"));
assert(markup.includes('reef_seaweed_records_page.js?v=9'));

function makeControl() {
  const handlers={};
  return {
    value:"",innerHTML:"",textContent:"",dataset:{},disabled:false,open:false,
    addEventListener(type, fn) {handlers[type] = fn;},
    emit(type, target) {assert(handlers[type],type+" listener missing");handlers[type]({target});}
  };
}
const idList=[
  "reloadReefSampleRopeData","reefSampleRopeDataSearch",
  "reefSampleRopeDataColumns","resetReefSampleRopeDataColumns",
  "reefSampleRopeSiteFilter","reefSampleRopeSiteFilterLabel",
  "reefSampleRopeSiteChoices","reefSampleRopeSitesAll","reefSampleRopeSitesNone",
  "reefSampleRopeDataHead","reefSampleRopeDataBody","reefSampleRopeDataStatus"
];
const elements=Object.fromEntries(idList.map(id=>[id,makeControl()]));
const root={querySelector:selector=>elements[selector.slice(1)]};
const sites=[
 {site_code:"MK-R2",site_name:"Cascadia Prototype",location:"mkwiro",structure_type:"raft"},
 {site_code:"MK-SF2/R2",site_name:"Shore Farm 2",location:"mkwiro",structure_type:"shore_farm"}
];
const register={
 "MK-R2":{rows:[
  {rope_number:1,species:"spinosum",rope_weight_kg:.15,initial_weight_kg:1,week_2_kg:3,week_4_kg:2},
  {rope_number:2,species:"spinosum",rope_weight_kg:.15,initial_weight_kg:2,week_2_kg:null}
 ]},
 "MK-SF2/R2":{rows:[{rope_number:1,species:"spinosum",rope_weight_kg:.19,initial_weight_kg:1,week_2_kg:1}]}
};
const calls=[];
const authClient={rpc: async (name,args)=>{
 calls.push(name);
 if(name==="ag_reef_site_capture_workspace_context") return {data:{allowed:true,sites},error:null};
 if(name==="ag_reef_sample_rope_register") return {data:register[args.p_site_code],error:null};
 throw Error("unexpected rpc "+name);
}};
const grid=initialize({authClient,root});
await grid.refresh();
assert.equal(grid.state.rows.length,3);
assert.equal(grid.state.availableSites.length,2);
assert.equal(grid.state.selectedSites,null,"All sites visible by default");
assert.match(elements.reefSampleRopeSiteFilterLabel.textContent,/Sites · All \(2\)/);
assert.match(elements.reefSampleRopeSiteChoices.innerHTML,/MK-R2 \(Cascadia Prototype\) \| Raft A/);
assert.match(elements.reefSampleRopeSiteChoices.innerHTML,/MK-SF2\/R2 \(Shore Farm 2\) \| Farm A/);
assert.match(elements.reefSampleRopeDataBody.innerHTML,/hsl\(0 68% 88%\)/);
assert.match(elements.reefSampleRopeDataBody.innerHTML,/hsl\(60 68% 88%\)/);
assert.match(elements.reefSampleRopeDataBody.innerHTML,/hsl\(120 68% 88%\)/);
assert(!/data-label="Rope Weight \(kg\)" class="reef-rope-heat-cell"/.test(elements.reefSampleRopeDataBody.innerHTML));
assert.equal(calls.filter(name=>name==="ag_reef_sample_rope_register").length,2,"Only read-only site RPCs");

// Toggle just the raft off; leave Farm A displayed.
const mkRaftToggle={
 checked:false,dataset:{ropeSite:"MK-R2"},
 closest(selector){assert.equal(selector,"[data-rope-site]");return this;}
};
elements.reefSampleRopeSiteChoices.emit("change",mkRaftToggle);
assert.deepEqual([...grid.state.selectedSites],["MK-SF2/R2"]);
assert.match(elements.reefSampleRopeSiteFilterLabel.textContent,/1 of 2/);
assert(!elements.reefSampleRopeDataBody.innerHTML.includes("Cascadia Prototype"));
assert(elements.reefSampleRopeDataBody.innerHTML.includes("Shore Farm 2"));
assert.equal(JSON.parse(storage.get("reefSampleRopeSiteFilterV1"))[0],"MK-SF2/R2");

// Header dropdown button controls same site filter.
const openButton={closest:selector=>selector==="[data-open-rope-sites]"?{}:null};
elements.reefSampleRopeDataHead.emit("click",openButton);
assert.equal(elements.reefSampleRopeSiteFilter.open,true);

// Clear all -> empty results (not silently 'all').
elements.reefSampleRopeSitesNone.emit("click");
assert.equal(grid.state.selectedSites.size,0);
assert.match(elements.reefSampleRopeSiteFilterLabel.textContent,/Sites · None/);
assert.match(elements.reefSampleRopeDataBody.innerHTML,/No matching rope measurements/);
assert.deepEqual(JSON.parse(storage.get("reefSampleRopeSiteFilterV1")),[]);

// Restore all, no extra provider calls.
elements.reefSampleRopeSitesAll.emit("click");
assert.equal(grid.state.selectedSites,null);
assert.equal(storage.has("reefSampleRopeSiteFilterV1"),false);
assert(elements.reefSampleRopeDataBody.innerHTML.includes("Cascadia Prototype"));
assert.equal(calls.length,3,"Site toggling is client-side, without new paid reads");

// A new table instance remembers previously selected sites.
storage.set("reefSampleRopeSiteFilterV1",JSON.stringify(["MK-R2"]));
const persistedControls=Object.fromEntries(idList.map(id=>[id,makeControl()]));
const second=initialize({authClient,root:{querySelector:selector=>persistedControls[selector.slice(1)]}});
await second.refresh();
assert.deepEqual([...second.state.selectedSites],["MK-R2"]);
assert(!persistedControls.reefSampleRopeDataBody.innerHTML.includes("Shore Farm 2"));
console.log("Multi-site dropdown filtering, persistence, and per-row low-to-high R+S heatmap passed.");
await import("./reef_sample_rope_stage_photos_test.mjs");
