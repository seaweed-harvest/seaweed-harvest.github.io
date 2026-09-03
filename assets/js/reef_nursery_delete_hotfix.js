import { authClient } from "./auth_client.js?v=25";

const DELETE_TYPES = new Set(["training", "seaweed", "inspection"]);
const DELETE_TIMEOUT_MS = 15000;
let deleting = false;

// Imported before reef_nursery_cleanup.js so this small handler owns Delete
// and avoids the older disabled-button MutationObserver loop.
document.addEventListener("click", handleDeleteClick, true);

async function handleDeleteClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-delete-unified-record]");
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (deleting) return;

  const type = String(button.dataset.recordType || "");
  const id = String(button.dataset.recordId || "");
  const number = String(button.dataset.recordNumber || "this record");
  if (!DELETE_TYPES.has(type) || !id) return;

  const confirmed = window.confirm(
    `Delete ${number}?\n\nThis record will be removed from active Reef records. It can be recovered administratively if deleted by mistake.`
  );
  if (!confirmed) return;

  deleting = true;
  setRecordsStatus(`Deleting ${number}…`);
  try {
    await withTimeout(
      rpc("ag_reef_records_workspace_delete", {
        p_record_type: type,
        p_record_id: id
      }),
      DELETE_TIMEOUT_MS
    );
    setRecordsStatus(`${number} deleted.`, "success");
    button.closest("tr")?.remove();
    window.setTimeout(openFreshRecordsList, 100);
  } catch (error) {
    const message = String(error?.message || "");
    if (/already been deleted|not found/i.test(message)) {
      openFreshRecordsList();
      return;
    }
    setRecordsStatus(message || `${number} could not be deleted.`, "error");
  } finally {
    deleting = false;
  }
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

export const REEF_NURSERY_DELETE_HOTFIX_CONTRACT = Object.freeze({
  nativeConfirmation: true,
  preventsLegacyDeleteHandler: true,
  boundedDeleteRequest: true,
  refreshesRecordsAfterDelete: true
});
