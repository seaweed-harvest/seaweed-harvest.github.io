import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const navigation = read("../assets/js/app_navigation.js");
const metricsHtml = read("../cosme_metrics.html");
const script = navigation
  .replace(/^import .*?;\n/m, "")
  .replace(/export function/g, "function")
  + "\nthis.navTest = { formLinks, recordLinks };";
const context = {
  window: { location: { pathname: "/historical_records.html", search: "" } },
  localStorage: { getItem: () => null, setItem() {} }
};
runInNewContext(script, context);

const names = (entries) => Array.from(entries, (entry) => entry.label);

test("Sandbox retains ledger transcriptions but no Green Space form", () => {
  const sandbox = {
    active_aggregator_code: "SANDBOX",
    can_view_data: true,
    organisation_capabilities: { form_green_space: true }
  };
  assert.deepEqual(names(context.navTest.formLinks(sandbox)), []);
  assert.ok(names(context.navTest.recordLinks(sandbox)).includes("Ledger Transcriptions"));
  assert.doesNotMatch(navigation, /label: "Green Space Log"/);
});

test("handover Tools retain operational entries and bench experiments", () => {
  const toolSection = navigation.split("const tools = permittedLinks(profile, [")[1]
    .split("]);\n  // Metrics are granted independently")[0];
  assert.ok(toolSection);
  for (const label of ["Dataset Dashboard", "Backups", "Mawimbi Process Flow", "Receipts",
    "Suggestions", "Pricing Matrix"]) {
    assert.ok(toolSection.includes(`label: "${label}"`), `${label} remains`);
  }
  for (const label of ["Finance Review", "Form Manager", "Form Builder", "SMS Settings", "Notifications", "Tags"]) {
    assert.ok(!toolSection.includes(`label: "${label}"`), `${label} is hidden`);
  }
});

test("one grant-checked Project Summary link retains the existing journal tab", () => {
  assert.equal((navigation.match(/label: "Project Summary"/g) || []).length, 1);
  assert.doesNotMatch(navigation, /label: "Project Journal"/);
  assert.match(navigation, /authClient\.rpc\("cosme_metrics_my_access"\)/);
  assert.match(metricsHtml, /<h1>Project Summary<\/h1>/);
  assert.match(metricsHtml, /data-tab="journal"/);
});

test("offline cache is versioned to publish the clean menu", () => {
  const worker = read("../service-worker.js");
  assert.match(worker, /CACHE_VERSION = "seaweed-harvest-collection-v189-handover-release"/);
  assert.match(worker, /"\.\/assets\/js\/app_navigation\.js"/);
});
