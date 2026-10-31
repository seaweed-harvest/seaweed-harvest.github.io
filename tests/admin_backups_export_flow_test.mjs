import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.className = "";
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = 0;
    this.href = "#";
    this.download = "";
    this.rel = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.clickCount = 0;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "download") this.download = "";
    if (name === "rel") this.rel = "";
  }

  querySelector() {
    return null;
  }

  click() {
    this.clickCount += 1;
  }
}

class FakeRow extends FakeElement {
  constructor(id) {
    super(id);
    this.fields = new Map();
  }

  querySelector(selector) {
    const fieldMatch = selector.match(/^\[data-backup-field="([^"]+)"\]$/);
    if (fieldMatch) {
      if (!this.fields.has(fieldMatch[1])) this.fields.set(fieldMatch[1], new FakeElement(fieldMatch[1]));
      return this.fields.get(fieldMatch[1]);
    }
    return null;
  }
}

const ids = [
  "backupSidebar",
  "legacyBackup",
  "backupSummaryPanel",
  "backupSummaryStatus",
  "backupScopeNote",
  "backupActiveRecordCount",
  "backupDeletedRecordCount",
  "backupTotalRecordCount",
  "backupLinkedPhotoCount",
  "backupAvailablePhotoCount",
  "backupRecordExportSize",
  "backupExportButton",
  "backupExportProgress",
  "backupDownloadLink",
  "backupExportStatus"
];
const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
const rows = new Map([
  "intake",
  "site_water_samples",
  "stock_records",
  "process_records",
  "active-total",
  "deleted_record_archive"
].map((key) => [key, new FakeRow(key)]));
const storage = new Map();
const actions = [];
let statusCalls = 0;

const dashboard = {
  generated_at: "2026-09-01T14:00:00Z",
  datasets: [
    { dataset_key: "intake", record_count: 3, linked_photo_count: 2, present_photo_count: 1, export_bytes: 100, earliest_at: "2026-08-01", latest_at: "2026-08-02" },
    { dataset_key: "site_water_samples", record_count: 0, linked_photo_count: 0, present_photo_count: 0, export_bytes: 0, earliest_at: null, latest_at: null },
    { dataset_key: "stock_records", record_count: 2, linked_photo_count: 0, present_photo_count: 0, export_bytes: 50, earliest_at: "2026-08-03", latest_at: "2026-08-04" },
    { dataset_key: "process_records", record_count: 1, linked_photo_count: 1, present_photo_count: 1, export_bytes: 25, earliest_at: "2026-08-05", latest_at: "2026-08-05" },
    { dataset_key: "deleted_record_archive", record_count: 1, linked_photo_count: 1, present_photo_count: 0, export_bytes: 20, earliest_at: "2026-08-06", latest_at: "2026-08-06" }
  ],
  latest_attempt: null,
  latest_verified: null
};

const verifiedJob = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "verified",
  stage: "verified",
  progress_percent: 100,
  status_message: "Mawimbi backup ZIP passed content and SHA-256 verification.",
  total_record_count: 7,
  physical_photo_count: 2,
  missing_photo_count: 2,
  mawimbi_package_bytes: 2048,
  completed_at: "2026-09-01T14:01:00Z"
};

const authClient = {
  rpc: async (name) => {
    assert.equal(name, "ag_backup_dashboard");
    return { data: dashboard, error: null };
  },
  functions: {
    invoke: async (name, { body }) => {
      assert.equal(name, "system-backup");
      actions.push(body.action);
      if (body.action === "create") {
        return {
          data: {
            ok: true,
            job: {
              id: verifiedJob.id,
              status: "queued",
              stage: "queued",
              progress_percent: 0,
              status_message: "Mawimbi backup request accepted."
            }
          },
          error: null
        };
      }
      if (body.action === "status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          return {
            data: {
              ok: true,
              job: {
                ...verifiedJob,
                status: "running",
                stage: "packaging",
                progress_percent: 60,
                status_message: "Creating the Mawimbi ZIP, manifest and checksums."
              }
            },
            error: null
          };
        }
        return { data: { ok: true, job: verifiedJob }, error: null };
      }
      if (body.action === "download") {
        assert.equal(body.job_id, verifiedJob.id);
        return {
          data: {
            ok: true,
            signed_url: "https://example.test/private.zip",
            file_name: "mawimbi-backup.zip",
            bytes: 2048
          },
          error: null
        };
      }
      throw new Error(`Unexpected action: ${body.action}`);
    }
  }
};

const document = {
  body: new FakeElement("body"),
  addEventListener() {},
  getElementById(id) {
    return elements.get(id) || null;
  },
  querySelector(selector) {
    const match = selector.match(/^\[data-backup-dataset="([^"]+)"\]$/);
    return match ? rows.get(match[1]) || null : null;
  }
};

const windowObject = {
  location: { replace() { throw new Error("Unexpected redirect"); } },
  confirm() { return true; },
  addEventListener() {},
  setTimeout(callback) { return setTimeout(callback, 0); },
  sessionStorage: {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  }
};

const context = vm.createContext({
  console,
  document,
  window: windowObject,
  navigator: { onLine: true },
  authClient,
  requireAuthenticatedAccount: async () => ({
    profile: { account_status: "active", app_role: "system_admin", is_protected_owner: false }
  }),
  readBackupAccess: (read) => read(),
  routeForProfile: () => "./home.html",
  setupAccountControls() {},
  populateAppSidebar: () => ({}),
  setupAppNavigation() {},
  Intl,
  Date,
  Math,
  Number,
  Object,
  Promise,
  String,
  Error,
  setTimeout,
  clearTimeout
});

let source = fs.readFileSync(new URL("../assets/js/admin_backups_summary.js", import.meta.url), "utf8");
source = source.slice(source.indexOf("const ACTIVE_DATASET_KEYS"));
source += "\nglobalThis.__backupTest = { init, handleExportClick };\n";
vm.runInContext(source, context, { filename: "admin_backups_summary.js" });

await context.__backupTest.init();
assert.equal(elements.get("backupExportButton").disabled, false);
assert.equal(elements.get("backupExportButton").textContent, "Export backup ZIP");

await context.__backupTest.handleExportClick();
await new Promise((resolve) => setTimeout(resolve, 5));

assert.deepEqual(actions, ["create", "status", "status", "download"]);
assert.equal(elements.get("backupExportProgress").value, 100);
assert.equal(elements.get("backupExportButton").disabled, false);
assert.equal(elements.get("backupExportButton").textContent, "Export another backup ZIP");
assert.equal(elements.get("backupDownloadLink").hidden, false);
assert.equal(elements.get("backupDownloadLink").download, "mawimbi-backup.zip");
assert.equal(elements.get("backupDownloadLink").clickCount, 1);
assert.equal(storage.size, 0);
assert.equal(elements.get("backupExportStatus").dataset.status, "success");
assert.match(elements.get("backupExportStatus").textContent, /Verified backup complete/);
assert.equal(elements.get("backupScopeNote").dataset.status, "success");

console.log("Mawimbi backup browser flow passed.");

