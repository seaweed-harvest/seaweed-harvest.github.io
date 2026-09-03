import { authClient } from "./auth_client.js?v=25";

const DELETE_TYPES = new Set(["training", "seaweed", "inspection"]);
const DELETE_TIMEOUT_MS = 15000;

let deleteTarget = null;
let deleting = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseDeleteHotfix, { once: true });
} else {
  initialiseDeleteHotfix();
}

function initialiseDeleteHotfix() {
  ensureDeleteDialog();
  // This module is imported before reef_nursery_cleanup.js, so this capture
  // listener owns the delete action and avoids the older disabled-button loop.
  document.addEventListener("click", handleDeleteClick, true);
}

function ensureDeleteDialog() {
  if (document.getElementById("reefDeleteRecordSafeDialog")) return;

  const dialog = document.createElement("dialog");
  dialog.id = "reefDeleteRecordSafeDialog";
  dialog.className = "reef-cleanup-dialog";
  dialog.innerHTML = `
    <div class="reef-cleanup-dialog-panel">
      <h2 id="reefDeleteRecordSafeTitle">Delete record?</h2>
      <p>This record will be removed from active Reef records. It can be recovered administratively if deleted by mistake.</p>
      <div class="reef-cleanup-dialog-actions">
        <button type="button" class="secondary-action" data-safe-delete-cancel>Cancel</button>
        <button type="button" class="danger" data-safe-delete-confirm>Delete record</button>
      </div>
    </div>`;

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDeleteDialog();
  });
  dialog.querySelector("[data-safe-delete-cancel]")
    .addEventListener("click", closeDeleteDialog);
  dialog.querySelector("[data-safe-delete-confirm]")
    .addEventListener("click", () => { void deleteRecord(); });
  document.body.append(dialog);
}

function handleDeleteClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-delete-unified-record]");
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const recordType = String(button.dataset.recordType || "");
  const recordId = String(button.dataset.recordId || "");
  if (!DELETE_TYPES.has(recordType) || !recordId) return;

  deleteTarget = {
    type: recordType,
    id: recordId,
    number: String(button.dataset.recordNumber || "this record")
  };

  const title = document.getElementById("reefDeleteRecordSafeTitle");
  if (title) title.textContent = `Delete ${deleteTarget.number}?`;
  const dialog = document.getElementById("reefDeleteRecordSafeDialog");
  if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  else if (window.confirm(`Delete ${deleteTarget.number}? This removes it from active Reef records.`)) {
    void deleteRecord();
  }
}

function closeDeleteDialog() {
  const dialog = document.getElementById("reefDeleteRecordSafeDialog");
  if (dialog?.open && typeof dialog.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  if (!deleting) deleteTarget = null;
}

async function deleteRecord() {
  if (!deleteTarget || deleting) return;
  const target = { ...deleteTarget };
  deleting = true;

  // Close immediately so a successful network request can never leave the
  // interface looking frozen behind the confirmation dialog.
  closeDeleteDialog();
  setRecordsStatus(`Deleting ${target.number}…`);

  try {
    await withTimeout(
      rpc("ag_reef_records_workspace_delete", {
        p_record_type: target.type,
        p_record_id: target.id
      }),
      DELETE_TIMEOUT_MS
    );
    deleteTarget = null;
    setRecordsStatus(`${target.number} deleted.`, "success");
    removeRecordRow(target);
    window.setTimeout(openFreshRecordsList, 120);
  } catch (error) {
    const message = String(error?.message || "");
    if (/already been deleted|not found/i.test(message)) {
      deleteTarget = null;
      openFreshRecordsList();
      return;
    }
    setRecordsStatus(message || `${target.number} could not be deleted.`, "error");
  } finally {
    deleting = false;
  }
}

function removeRecordRow(target) {
  const selector = `[data-open-unified-record][data-record-type="${selectorEscape(target.type)}"][data-record-id="${selectorEscape(target.id)}"]`;
  document.querySelector(selector)?.closest("tr")?.remove();
}

function openFreshRecordsList() {
  const url = new URL(window.location.href);
  url.search = "?tab=records";
  url.hash = "";
  window.location.replace(url.href);
}

function setRecordsStatus(message, kind = "") {
  const status = document.getElementById("reefUnifiedRecordsStatus");
  if (!status) return;
  status.textContent = message || "";
  if (kind) status.dataset.status = kind;
  else delete status.dataset.status;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("The delete request took too long. Reload Previous Records to check whether it completed.")),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || {} : data;
}

function selectorEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

export const REEF_NURSERY_DELETE_HOTFIX_CONTRACT = Object.freeze({
  closesDialogBeforeRequest: true,
  preventsLegacyDeleteHandler: true,
  boundedDeleteRequest: true,
  refreshesRecordsAfterDelete: true
});
