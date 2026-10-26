import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");
const stock = read("stabilization_packing.html");
const form = read("assets/js/stabilization_packing_form.js");
const today = read("assets/js/today_record_tabs.js");
const ledgers = read("assets/js/records_page.js");
const records = read("records.html");
const standalone = read("today.html");
const adminToday = read("admin_today.html");
const sw = read("service-worker.js");

test("A separate Correct Stock Records panel no longer appears on the form", () => {
  assert.doesNotMatch(stock, /id="stockCorrections"|stock_corrections\.js|stock_corrections\.css/);
  assert.match(stock, /id="packingBatchForm"/);
  assert.match(stock, /id="packingBatchEditNotice"/);
  assert.match(stock, /id="packingBatchEditCancel"/);
  assert.match(stock, /id="packingBatchHydrometer"/);
  assert.match(stock, /name="packingBatchEColiSampleTaken"/);
  assert.match(stock, /packingPhotoFiles/);
});

test("Both record views preserve inline Edit and only add the batch action", () => {
  for (const html of [records, standalone, adminToday]) {
    assert.match(html, /id="todayStockRecordStartEdit"/);
    assert.match(html, /id="todayStockRecordEditBatch"/);
  }
  assert.match(records, /id="formLedgerStartEdit"/);
  assert.match(records, /id="formLedgerEditBatch"/);
  assert.match(today, /selectedTodayStockBatch\(\)/);
  assert.match(ledgers, /selectedLedgerStockBatch\(\)/);
  assert.match(today, /row\.record_type !== "initial"/);
  assert.match(ledgers, /row\.record_type !== "initial"/);
});

test("Batch opens its original form and edits existing batch rather than inserting anew", () => {
  assert.match(form, /ag_get_stabilization_packing_batch_for_edit/);
  assert.match(form, /loadOriginalBatchForEditing/);
  assert.match(form, /fillOriginalBatch/);
  assert.match(form, /metadata_changes: metadataChanges/);
  assert.match(form, /ag_update_stabilization_packing_batch_from_form/);
  assert.match(form, /ag_submit_stabilization_packing_batch_v3/);
  assert.match(form, /editingBatch\.expectedCount/);
  assert.match(form, /editingBatch\.latest/);
  assert.match(form, /batchReturnUrl\(\)/);
  assert.match(form, /window\.confirm/);
});

test("Mobile cache is refreshed and retired editor is no longer preloaded", () => {
  assert.match(sw, /seaweed-harvest-collection-v177-ledger-batch-edit/);
  assert.doesNotMatch(sw, /stock_corrections\.(?:js|css)/);
});
