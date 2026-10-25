import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const js = readFileSync(new URL("../assets/js/stabilization_packing_form.js", import.meta.url), "utf8")
  .replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/g, "");
const api = runInNewContext(
  js + "\nthis.unit = { formatBatchNumber, updateBatchState, submitBatch, els };",
  {
    document: { addEventListener() {} },
    crypto: { randomUUID: () => "test-uuid" },
    window: { confirm: () => false },
    Intl, Number, String, Date, BigInt
  }
).unit;

function setup(volume, unit = "L") {
  const form = { reportValidity: () => true, querySelectorAll: () => [], querySelector: () => ({ value: "no" }) };
  Object.assign(api.els, {
    packingBatchFirst: { value: "00615" },
    packingBatchLast: { value: "00628" },
    packingBatchVolume: { value: String(volume), focus() {} },
    packingBatchVolumeUnit: { value: unit },
    packingBatchVolumePreview: { textContent: "" },
    packingBatchCount: { textContent: "" },
    packingBatchForm: form,
    packingBatchStatus: { textContent: "", dataset: {} },
    savePackingBatch: { disabled: false }
  });
  api.updateBatchState();
  return api.els;
}

test("Batch preview shows fourteen 22.8 L cartons as 319.2 L total", () => {
  const els = setup(22.8);
  assert.equal(els.packingBatchCount.textContent, "14");
  assert.equal(els.packingBatchVolumePreview.textContent, "14 containers × 22.8 L = 319.2 L total");
});

test("Incorrect whole-batch volume entered per carton shows multiplied total and warns", () => {
  const els = setup(319.2);
  assert.match(els.packingBatchVolumePreview.textContent, /4,468\.8 L total/);
  assert.match(els.packingBatchVolumePreview.textContent, /Check: is this volume per container/);
});

test("Millilitres convert into litres for batch total", () => {
  const els = setup(22800, "mL");
  assert.equal(els.packingBatchVolumePreview.textContent, "14 containers × 22,800 mL = 319.2 L total");
});

test("Blank input keeps guidance instead of implying zero stock", () => {
  const els = setup("");
  assert.match(els.packingBatchVolumePreview.textContent, /Enter the volume in each container/);
});

test("Atypical carton volume must be confirmed; cancelling prevents record submission", async () => {
  const els = setup(319.2);
  await api.submitBatch({ preventDefault() {} });
  assert.match(els.packingBatchStatus.textContent, /Not saved/);
  assert.equal(els.savePackingBatch.disabled, false);
});

test("Stock batch form loads the preview field and a cache-busted script", () => {
  const page = readFileSync(new URL("../stabilization_packing.html", import.meta.url), "utf8");
  assert.match(page, /id="packingBatchVolumePreview"/);
  assert.match(page, /stabilization_packing_form\.js\?v=21/);
});