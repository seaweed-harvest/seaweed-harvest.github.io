import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = fs.readFileSync("assets/js/reef_nursery_site_capture.js", "utf8");
const getFunction = (name) => {
  const start = source.indexOf("function " + name + "(");
  assert(start !== -1, name + " must exist");
  const after = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, after === -1 ? source.length : after);
};
const getSampleRows = () => ({
  rows: [
    { rope_number: 1, species: "spinosum", date_seeded: "2026-08-01", initial_weight_kg: 1.5, week_2_kg: 1.9, week_2_date: "2026-08-14" },
    { rope_number: 2, species: "spinosum", date_seeded: "2026-08-03", initial_weight_kg: 1.6, week_2_kg: 2.0, week_2_date: "2026-08-17" },
    { rope_number: 5, species: null, date_seeded: null, initial_weight_kg: null, week_2_kg: null, week_2_date: null }
  ]
});

const dateFields = [
  { date: "date_seeded", weight: "initial_weight_kg", label: "Initial seeding" },
  { date: "week_2_date", weight: "week_2_kg", label: "Week 2" },
  { date: "week_4_date", weight: "week_4_kg", label: "Week 4" },
  { date: "week_6_date", weight: "week_6_kg", label: "Week 6" }
];
const input = (value = "") => ({ value });
const headers = Object.fromEntries(dateFields.map(({date}) => [date, input()]));
const mkRow = (number) => {
  const fields = Object.fromEntries(["species", "rope_weight_kg", "initial_weight_kg", "week_2_kg", "week_4_kg", "week_6_kg"].map(x => [x, input()]));
  return {
    dataset: { ropeNumber: String(number) },
    querySelector(selector) {
      const m = selector.match(/data-rope-field="([^"]+)"/);
      return fields[m?.[1]] || null;
    }
  };
};
const rows = [mkRow(1), mkRow(2), mkRow(5), mkRow(6), mkRow(9), mkRow(10)];
const warning = { textContent: "", hidden: true };
const panel = {
  querySelectorAll(selector) { assert.equal(selector, "[data-sample-rope-row]"); return rows; },
  querySelector(selector) {
    const m = selector.match(/data-sample-date="([^"]+)"/);
    return headers[m?.[1]] || null;
  }
};
const state = { sampleDateEdits: new Set(), sampleRegisterDirty: false };
const context = { SAMPLE_MEASUREMENT_DATES: dateFields, els: { reefSampleRopePanel: panel }, document: {getElementById:()=>warning},
   state, Set, Map, Object, Boolean, Number, setSampleStatus: () => {} };
vm.createContext(context);
new vm.Script([
  getFunction("collectSampleRopeRows"),
  getFunction("applySampleRegister"),
  getFunction("markSampleRegisterDirty")
].join("\n")).runInContext(context);

context.applySampleRegister(getSampleRows());
assert.equal(headers.date_seeded.value, "", "mixed saved seed dates must remain unselected");
assert.equal(headers.week_2_date.value, "", "mixed week-two dates must remain unselected");
assert.match(warning.textContent, /Different saved dates/);
assert.equal(warning.hidden, false);
let data = context.collectSampleRopeRows();
assert.equal(data[0].date_seeded, "2026-08-01");
assert.equal(data[1].date_seeded, "2026-08-03");
assert.equal(data[0].week_2_date, "2026-08-14");
assert.equal(data[1].week_2_date, "2026-08-17");
assert.equal(data[2].date_seeded, null);

headers.week_2_date.value = "2026-08-21";
context.markSampleRegisterDirty({ target: {closest: sel => sel === "[data-sample-date]" ? {dataset:{ sampleDate: "week_2_date" }} : null} });
assert(state.sampleRegisterDirty);
data = context.collectSampleRopeRows();
assert.equal(data[0].week_2_date, "2026-08-21");
assert.equal(data[1].week_2_date, "2026-08-21");
assert.equal(data[2].week_2_date, null, "empty rope must not acquire a new measurement date");
assert.equal(data[0].date_seeded, "2026-08-01", "changing week date must not rewrite seeded dates");

context.applySampleRegister({ rows: data });
assert.equal(headers.week_2_date.value, "2026-08-21");
assert.equal(state.sampleDateEdits.size, 0);
assert.equal(headers.date_seeded.value, "");
headers.date_seeded.value = "2026-08-22";
state.sampleDateEdits.add("date_seeded");
data = context.collectSampleRopeRows();
assert.equal(data[0].date_seeded, "2026-08-22");
assert.equal(data[1].date_seeded, "2026-08-22");
assert.equal(data[2].date_seeded, null);

context.applySampleRegister({rows: []});
assert.equal(headers.date_seeded.value, "");
assert.equal(headers.week_2_date.value, "");
assert.equal(state.sampleDateEdits.size, 0);
console.log("Shared Sample Rope date logic passed: mixed data, updates, empty rows and reset.");
