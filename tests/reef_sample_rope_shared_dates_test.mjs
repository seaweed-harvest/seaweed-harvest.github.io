import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Regression for the revised one-visit-at-a-time Sample Rope Register.
// Week 2 must retain its own recorder/date without replacing initial records.
const source = fs.readFileSync("assets/js/reef_nursery_site_capture.js", "utf8");
const getFunction = (name) => {
  const start = source.indexOf("function " + name + "(");
  assert(start !== -1, name + " must exist");
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};
const input = (value = "") => ({ value });
const stages = ["initial", "week_2", "week_4", "week_6"];
const columns = ["species", "date_seeded", "rope_weight_kg", "initial_weight_kg", "week_2_kg", "week_4_kg", "week_6_kg"];
const makeRow = (number) => {
  const fields = Object.fromEntries(columns.map(x => [x, input()]));
  const metadata = Object.fromEntries(stages.map(x => [x, { textContent: "" }]));
  return {
    dataset: { ropeNumber: String(number) },
    fields,
    metadata,
    querySelector(selector) {
      let m = selector.match(/data-rope-field="([^"]+)"/);
      if (m) return fields[m[1]] || null;
      m = selector.match(/data-rope-meta="([^"]+)"/);
      return metadata[m?.[1]] || null;
    }
  };
};
const rows = [1, 2, 5, 6, 9, 10].map(makeRow);
const visit = {
  reefSampleVisitDate: input("2026-10-15"),
  reefSampleVisitTime: input(""),
  reefSampleVisitRecorder: input("Recorder B"),
  reefSampleVisitTeam: input("community"),
  reefSampleVisitOtherTeam: input("")
};
let status = "";
const context = {
  els: { reefSampleRopePanel: {
    querySelectorAll(selector) {
      assert.equal(selector, "[data-sample-rope-row]");
      return rows;
    }
  }, ...visit },
  state: { sampleRegisterDirty: false },
  Number, Map,
  setSampleStatus: message => { status = message; }
};
vm.createContext(context);
new vm.Script([
  getFunction("collectSampleRopeRows"),
  getFunction("applySampleRegister"),
  getFunction("markSampleRegisterDirty"),
  getFunction("validatedSampleVisit")
].join("\n")).runInContext(context);

const initial = { date: "2026-10-01", recorder: "Recorder A", team: "pik" };
const weekTwo = { date: "2026-10-15", recorder: "Recorder B", team: "community" };
context.applySampleRegister({
  rows: [
    {
      rope_number: 1, species: "spinosum", date_seeded: "2026-10-01",
      rope_weight_kg: 0.4, initial_weight_kg: 0.8, week_2_kg: 1.2,
      measurement_provenance: { initial, week_2: weekTwo }, cycle_number: 1
    },
    {
      rope_number: 2, species: "spinosum", date_seeded: "2026-10-02",
      initial_weight_kg: 0.7, measurement_provenance: {
        initial: { date: "2026-10-02", recorder: "Recorder C", team: "reefolution" }
      }, cycle_number: 1
    }
  ]
});

assert.match(rows[0].metadata.initial.textContent, /2026-10-01.*Recorder A.*pik/);
assert.match(rows[0].metadata.week_2.textContent, /2026-10-15.*Recorder B.*community/);
assert.equal(rows[0].fields.initial_weight_kg.value, 0.8);
assert.equal(rows[0].fields.week_2_kg.value, 1.2);
assert.equal(rows[1].fields.date_seeded.value, "2026-10-02");
assert.equal(rows[1].metadata.week_2.textContent, "", "No invented Week 2 recorder");
assert.equal(rows[2].metadata.initial.textContent, "", "Empty ropes stay empty");

const collected = context.collectSampleRopeRows();
assert.equal(collected[0].initial_weight_kg, 0.8);
assert.equal(collected[0].week_2_kg, 1.2);
assert.equal(collected[0].date_seeded, "2026-10-01");
assert.equal(collected[1].date_seeded, "2026-10-02");
assert.equal(collected[2].initial_weight_kg, null);
assert(!Object.hasOwn(collected[0], "week_2_date"), "Existing legacy per-week dates remain preserved by the database");

// Recording date/time is per save, with time optional.
const contextForWeekTwo = context.validatedSampleVisit();
assert.equal(contextForWeekTwo.date, "2026-10-15");
assert.equal(contextForWeekTwo.time, null);
assert.equal(contextForWeekTwo.recorder, "Recorder B");
assert.equal(contextForWeekTwo.team, "community");
visit.reefSampleVisitTime.value = "09:30";
assert.equal(context.validatedSampleVisit().time, "09:30");
visit.reefSampleVisitRecorder.value = "";
assert.equal(context.validatedSampleVisit(), null);
assert.match(status, /recorder/i);
visit.reefSampleVisitRecorder.value = "Recorder B";

context.markSampleRegisterDirty({
  target: { closest: sel => sel === "[data-sample-rope-row]" ? rows[0] : null }
});
assert.equal(context.state.sampleRegisterDirty, true);

context.applySampleRegister({ rows: [] });
assert.equal(rows[0].fields.initial_weight_kg.value, "");
assert.equal(rows[0].metadata.initial.textContent, "");
assert.equal(rows[0].metadata.week_2.textContent, "");
console.log("Sample Rope visit attribution passed: separate recorder/date per stage, optional time and reset.");
