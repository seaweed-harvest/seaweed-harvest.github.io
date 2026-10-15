import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const script = fs.readFileSync("assets/js/reef_seaweed_records_page.js", "utf8");
const html = fs.readFileSync("reef_seaweed_records.html", "utf8");
const labels = fs.readFileSync("assets/js/reef_mkwiro_raft_labels.js", "utf8");
const { pairedMkwiroSites, mkwiroRaftDisplayLabel } = await import(
  "data:text/javascript;base64," + Buffer.from(labels).toString("base64")
);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, character =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]);
const detail = { innerHTML: "" };
const heading = { textContent: "" };
const calls = [];
const data = {
  "MK-R2": {
    site_code: "MK-R2", site_name: "Cascadia Prototype", location: "mkwiro", structure_type: "raft",
    rows: [
      { rope_number: 1, species: "spinosum", rope_weight_kg: 0.188, initial_weight_kg: 1.56,
        date_seeded: "2026-09-29", week_2_kg: 2.33, week_2_date: "2026-10-13",
        measurement_provenance: { week_2: { date: "2026-10-13", time: "11:30" } } },
      { rope_number: 2, species: "spinosum", rope_weight_kg: 0.188, initial_weight_kg: 1.68,
        date_seeded: "2026-09-29", week_2_kg: 2.4, week_2_date: "2026-10-13" }
    ]
  },
  "MK-SF2/R2": {
    site_code: "MK-SF2/R2", site_name: "Shore Farm 2", location: "mkwiro", structure_type: "shore_farm",
    rows: [{ rope_number: 1, initial_weight_kg: null, week_2_kg: null, week_4_kg: null, week_6_kg: null }]
  },
  "MK-R1": { site_code: "MK-R1", site_name: "Rectangular Raft", rows: [] },
  "MK-SF1/R1": { site_code: "MK-SF1/R1", site_name: "Shore Farm 1", rows: [] },
  "MK-R3": { site_code: "MK-R3", site_name: "LM / PIK Raft", rows: [] },
  "MK-SF3/R3": { site_code: "MK-SF3/R3", site_name: "Shore Farm 3", rows: [] }
};
const context = {
  authClient: { rpc: async (method, args) => {
    assert.equal(method, "ag_reef_sample_rope_register");
    calls.push(args.p_site_code);
    return data[args.p_site_code] ? { data: data[args.p_site_code], error: null } :
      { data: null, error: new Error("Unknown site") };
  } },
  els: { reefSeaweedRecordDetailContent: detail, reefSeaweedRecordDetailTitle: heading },
  pairedMkwiroSites, mkwiroRaftDisplayLabel,
  escapeHtml, displayNumber: (x) => x ?? "-", formatDate: (x) => x,
  humanize: (x) => String(x || ""), LOCATION_LABELS: { mkwiro: "Mkwiro" },
  Promise, Object, Array, Set, String
};
vm.createContext(context);
const start = script.indexOf("async function openSampleRegister(siteCode)");
const end = script.indexOf("\nasync function deleteRecord(", start);
assert(start >= 0 && end > start);
vm.runInContext(script.slice(start, end), context);

assert.deepEqual(pairedMkwiroSites("MK-R2"), { group: "A", raftCode: "MK-R2", farmCode: "MK-SF2/R2" });
assert.deepEqual(pairedMkwiroSites("MK-SF2/R2"), pairedMkwiroSites("MK-R2"));
assert.equal(pairedMkwiroSites("MK-R1").group, "C");
assert.equal(pairedMkwiroSites("MK-R3").group, "B");
assert.equal(pairedMkwiroSites("MK-SF1/R1").group, "C");
assert.equal(pairedMkwiroSites("MK-SF3/R3").group, "B");
assert.equal(pairedMkwiroSites("TB-R1"), null);

await context.openSampleRegister("MK-R2");
assert.deepEqual(calls, ["MK-R2", "MK-SF2/R2"], "Opening Raft A must load Farm A as well");
assert.match(heading.textContent, /Raft A and Farm A/);
assert.match(detail.innerHTML, /MK-R2 \(Cascadia Prototype\) \| Raft A/);
assert.match(detail.innerHTML, /MK-SF2\/R2 \(Shore Farm 2\) \| Farm A/);
assert.match(detail.innerHTML, /Date: 2026-09-29/);
assert.match(detail.innerHTML, /data-stage="week_2"[\s\S]*Date: 2026-10-13/);
assert.match(detail.innerHTML, /Time: 11:30/);
assert.match(detail.innerHTML, /No rope measurements recorded yet for this site/);
assert(!detail.innerHTML.includes("<th>Date Seeded</th>"), "Dates must appear above the columns, not in a per-rope date column");
assert.match(detail.innerHTML, /2\.33/);
assert(html.includes('data-open-reef-pair="MK-R2"'));
assert(html.includes('data-open-reef-pair="MK-R3"'));
assert(html.includes('data-open-reef-pair="MK-R1"'));

calls.length = 0;
await context.openSampleRegister("MK-SF2/R2");
assert.deepEqual(calls, ["MK-R2", "MK-SF2/R2"], "Opening Farm A must show the same two registers");

const mixed = [
  { initial_weight_kg: 1, date_seeded: "2026-09-29" },
  { initial_weight_kg: 2, date_seeded: "2026-10-01" }
];
assert.match(context.sampleStageHeading(mixed, ["initial", "Initial Weight (kg)", "initial_weight_kg", "date_seeded"]), /Multiple dates/);
assert.match(context.sampleStageHeading([], ["week_6", "Wk6", "week_6_kg", "week_6_date"]), /Date: —/);

data["MK-SF2/R2"] = null;
calls.length = 0;
await context.openSampleRegister("MK-R2");
assert.match(detail.innerHTML, /Unable to load this site's register/);
assert.match(detail.innerHTML, /Raft A/);
assert.deepEqual(calls, ["MK-R2", "MK-SF2/R2"]);

console.log("Paired Raft/Farm A/B/C records, per-stage header dates, and empty/error isolation passed.");
