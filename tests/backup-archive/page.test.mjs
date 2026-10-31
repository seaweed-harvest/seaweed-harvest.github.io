import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { readBackupAccess } from "../../assets/js/backup_connection.mjs";

const html = readFileSync(new URL("../../admin_backups.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../../assets/js/admin_backups_summary.js", import.meta.url), "utf8");
function page(read) {
  const dom = new JSDOM(html, { url: "https://seaweed-harvest.com/admin_backups.html" });
  const calls = [];
  const context = vm.createContext({
    document: dom.window.document, window: dom.window, navigator: { onLine: true },
    setTimeout, clearTimeout, console, Intl, Date,
    requireAuthenticatedAccount: read,
    readBackupAccess: (fn, options) => readBackupAccess(fn, { ...options, retryDelayMs: 0 }),
    authClient: { rpc: async name => { calls.push(name); throw new Error("Synthetic summary unavailable"); } },
    populateAppSidebar: () => ({}), setupAccountControls() {}, setupAppNavigation() {},
    routeForProfile: () => "./home.html",
    mountFullBackupArchive: async () => { calls.push("archive"); dom.window.document.getElementById("fullBackupArchive").hidden = false; }
  });
  // Invoke explicitly in each scenario; JSDOM also emits DOMContentLoaded asynchronously.
  const manualSource = source.slice(source.indexOf("const ACTIVE_DATASET_KEYS"))
    .replace(/document\.addEventListener\("DOMContentLoaded",[\s\S]*?\n\}\);/, "");
  vm.runInContext(manualSource + "\nglobalThis.initPage = init;", context);
  return { context, calls, q: id => dom.window.document.getElementById(id) };
}
test("initial page shows generic loading, with both backup scopes hidden", () => {
  const f = page(() => null);
  assert.equal(f.q("backupConnection").hidden, false);
  assert.equal(f.q("fullBackupArchive").hidden, true);
  assert.equal(f.q("legacyBackup").hidden, true);
});
test("protected owner uses the organisation archive without requesting the Mawimbi summary", async () => {
  const f = page(async () => ({ profile: { account_status: "active", is_protected_owner: true } }));
  await f.context.initPage();
  assert.deepEqual(f.calls, ["archive"]);
  assert.equal(f.q("legacyBackup").hidden, true);
  assert.equal(f.q("backupConnection").hidden, true);
  assert.equal(f.q("fullBackupArchive").hidden, false);
});
test("persistent account network failure exposes retry without revealing stale backup controls", async () => {
  let attempts = 0, available = false;
  const f = page(async () => {
    attempts++;
    if (!available) throw new Error("Failed to fetch");
    return { profile: { account_status: "active", is_protected_owner: true } };
  });
  await f.context.initPage();
  assert.equal(attempts, 2);
  assert.match(f.q("backupConnectionStatus").textContent, /Account verification could not finish/);
  assert.equal(f.q("backupConnectionRetry").hidden, false);
  assert.equal(f.q("legacyBackup").hidden, true);
  assert.equal(f.q("fullBackupArchive").hidden, true);
  assert.deepEqual(f.calls, []);
  available = true;
  await f.context.initPage();
  assert.deepEqual(f.calls, ["archive"]);
  assert.equal(f.q("backupConnection").hidden, true);
});
test("existing permitted non-owner export remains available and reports its own summary failure", async () => {
  const f = page(async () => ({ profile: { account_status: "active", can_export_backups: true } }));
  await f.context.initPage();
  assert.deepEqual(f.calls, ["ag_backup_dashboard"]);
  assert.equal(f.q("legacyBackup").hidden, false);
  assert.equal(f.q("fullBackupArchive").hidden, true);
  assert.match(f.q("backupScopeNote").textContent, /Synthetic summary unavailable/);
});
test("read-only account check retries a transient failure once but never retries permission errors", async () => {
  let calls = 0;
  assert.equal(await readBackupAccess(async () => {
    if (++calls === 1) throw new Error("Failed to fetch");
    return "verified";
  }, { retryDelayMs: 0 }), "verified");
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(readBackupAccess(async () => { calls++; throw new Error("Access denied"); }), /Access denied/);
  assert.equal(calls, 1);
});
test("stalled account checks settle with a timeout", async () => {
  await assert.rejects(readBackupAccess(() => new Promise(() => {}), { timeoutMs: 5, retryDelayMs: 0 }), /timed out/);
});
