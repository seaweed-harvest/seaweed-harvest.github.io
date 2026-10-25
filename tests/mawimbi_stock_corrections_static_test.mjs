import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const html = read("stabilization_packing.html");
const js = read("assets/js/stock_corrections.js");
const css = read("assets/css/stock_corrections.css");
const worker = read("service-worker.js");

test("Stock corrections are published on the actual BioStim form", () => {
  assert.match(html, /id="stockCorrections"/);
  assert.match(html, /id="scModeRecord"[^>]*>Edit record</);
  assert.match(html, /id="scModeBatch"[^>]*>Edit batch</);
  assert.match(html, /id="scBatchEditor"/);
  assert.match(html, /id="scRecordEditor"/);
  assert.match(html, /stock_corrections\.js\?v=2/);
  assert.match(html, /stock_corrections\.css\?v=2/);
  assert.match(html, /href="#stockCorrections"/);
});
test("Correction controls preserve existing stock QC and photos", () => {
  for (const id of ["packingRecordForm", "packingBatchForm", "packingPhotoFiles", "packingBatchHydrometer", "packingBatchBrix"]) {
    assert.ok(html.includes(`id="${id}"`), `Missing existing control: ${id}`);
  }
  assert.match(html, /name="packingBatchEColiSampleTaken"/);
  assert.match(html, /stabilization_packing_form\.js\?v=22/);
});
test("Selectors match HTML and editor uses the audited RPCs", () => {
  const controls = [...js.matchAll(/\$\("([a-zA-Z][a-zA-Z0-9]+)"\)/g)];
  for (const [, id] of controls) {
    assert.ok(html.includes(`id="${id}"`), `Editor expects missing element ${id}`);
  }
  assert.match(js, /ag_correct_stabilization_packing_record/);
  assert.match(js, /ag_correct_stabilization_packing_batch/);
  assert.match(js, /ag_today_form_records/);
  assert.match(js, /expected_latest_updated_at/);
});
test("PWA knows the new assets and correction styling is mobile friendly", () => {
  assert.match(worker, /seaweed-harvest-collection-v176-stock-corrections/);
  assert.match(worker, /\.\/assets\/js\/stock_corrections\.js/);
  assert.match(worker, /\.\/assets\/css\/stock_corrections\.css/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /@media\(max-width:390px\)/);
});
