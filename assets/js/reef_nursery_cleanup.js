import { authClient } from "./auth_client.js?v=25";

const SAVE_TIMEOUT_MS = 25000;
const DELETE_TYPES = new Set(["training", "seaweed", "inspection"]);
const FORM_CONFIG = Object.freeze({
  training: {
    formId: "reefNurseryForm",
    saveId: "saveReefNursery",
    submitId: "submitReefNursery",
    clearId: "clearReefNursery",
    newId: "newReefNursery",
    statusId: "reefNurseryStatus",
    label: "Training record"
  },
  seaweed: {
    formId: "reefSeaweedForm",
    saveId: "saveReefSeaweedChanges",
    submitId: "submitReefSeaweed",
    clearId: "clearReefSeaweed",
    newId: "newReefSeaweed",
    statusId: "reefSeaweedStatus",
    label: "Seaweed Record"
  },
  inspection: {
    formId: "reefInspectionForm",
    saveId: "saveReefInspectionChanges",
    submitId: "submitReefInspection",
    clearId: "clearReefInspection",
    newId: "newReefInspection",
    statusId: "reefInspectionStatus",
    label: "Raft and Mooring Inspection"
  }
});

const dirty = new Map(Object.keys(FORM_CONFIG).map((type) => [type, false]));
const lastStatus = new Map();
const actionWasBusy = new Map(Object.keys(FORM_CONFIG).map((type) => [type, false]));

let syncScheduled = false;
let newRecordType = null;
let deleteTarget = null;
let saveThenNew = null;
let canDeleteRecords = false;
let deletingRecord = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseCleanup, { once: true });
} else {
  initialiseCleanup();
}

function initialiseCleanup() {
  injectStyles();
  ensureDialogs();

  document.addEventListener("input", markDirtyFromField, true);
  document.addEventListener("change", markDirtyFromField, true);
  document.addEventListener("click", handleDocumentClick, true);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "disabled", "data-status", "aria-selected"]
  });

  scheduleSync();
  for (const delay of [0, 700, 1800]) {
    window.setTimeout(() => { void loadOwnerContext(); }, delay);
  }
}

function injectStyles() {
  if (document.getElementById("reefNurseryCleanupStyles")) return;
  const style = document.createElement("style");
  style.id = "reefNurseryCleanupStyles";
  style.textContent = `
    .reef-original-clear-action { display: none !important; }
    .reef-owner-row-actions { display: flex; gap: 0.4rem; justify-content: flex-end; flex-wrap: wrap; }
    .reef-cleanup-dialog { border: 0; border-radius: 0.75rem; padding: 0; width: min(34rem, calc(100vw - 2rem)); box-shadow: 0 1rem 3rem rgba(15, 23, 42, 0.25); }
    .reef-cleanup-dialog::backdrop { background: rgba(15, 23, 42, 0.45); }
    .reef-cleanup-dialog-panel { padding: 1.25rem; }
    .reef-cleanup-dialog-panel h2 { margin: 0 0 0.65rem; font-size: 1.1rem; }
    .reef-cleanup-dialog-panel p { margin: 0; line-height: 1.45; }
    .reef-cleanup-dialog-actions { display: flex; justify-content: flex-end; gap: 0.55rem; flex-wrap: wrap; margin-top: 1.1rem; }
  `;
  document.head.append(style);
}

function ensureDialogs() {
  if (!document.getElementById("reefNewRecordDialog")) {
    const dialog = document.createElement("dialog");
    dialog.id = "reefNewRecordDialog";
    dialog.className = "reef-cleanup-dialog";
    dialog.innerHTML = `
      <div class="reef-cleanup-dialog-panel">
        <h2 id="reefNewRecordTitle">Start a new record?</h2>
        <p>This record has unsaved changes. Save them before starting a new record?</p>
        <div class="reef-cleanup-dialog-actions">
          <button type="button" class="secondary-action" data-new-record-cancel>Cancel</button>
          <button type="button" class="secondary-action" data-new-record-discard>Discard and start new</button>
          <button type="button" data-new-record-save>Save and start new</button>
        </div>
      </div>`;
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeNewRecordDialog();
    });
    dialog.querySelector("[data-new-record-cancel]").addEventListener("click", closeNewRecordDialog);
    dialog.querySelector("[data-new-record-discard]").addEventListener("click", () => {
      const type = newRecordType;
      closeNewRecordDialog();
      if (type) resetToNewRecord(type);
    });
    dialog.querySelector("[data-new-record-save]").addEventListener("click", () => {
      const type = newRecordType;
      closeNewRecordDialog();
      if (type) beginSaveThenNew(type);
    });
    document.body.append(dialog);
  }

  if (!document.getElementById("reefDeleteRecordDialog")) {
    const dialog = document.createElement("dialog");
    dialog.id = "reefDeleteRecordDialog";
    dialog.className = "reef-cleanup-dialog";
    dialog.innerHTML = `
      <div class="reef-cleanup-dialog-panel">
        <h2 id="reefDeleteRecordTitle">Delete record?</h2>
        <p>This record will be removed from active Reef records. It can be recovered administratively if deleted by mistake.</p>
        <div class="reef-cleanup-dialog-actions">
          <button type="button" class="secondary-action" data-delete-record-cancel>Cancel</button>
          <button type="button" class="danger" data-delete-record-confirm>Delete record</button>
        </div>
      </div>`;
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDeleteDialog();
    });
    dialog.querySelector("[data-delete-record-cancel]").addEventListener("click", closeDeleteDialog);
    dialog.querySelector("[data-delete-record-confirm]").addEventListener("click", () => {
      void confirmDeleteRecord();
    });
    document.body.append(dialog);
  }
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    syncNewRecordButtons();
    syncRecordSurface();
    syncCleanStateFromActions();
  });
}

function syncNewRecordButtons() {
  const reviewMode = isReviewMode();
  for (const [type, config] of Object.entries(FORM_CONFIG)) {
    if (reviewMode && type === "training") continue;
    const original = document.getElementById(config.clearId);
    if (!original) continue;

    if (!original.classList.contains("reef-original-clear-action")) {
      original.classList.add("reef-original-clear-action");
      original.setAttribute("aria-hidden", "true");
      original.tabIndex = -1;
    }

    let button = document.getElementById(config.newId);
    if (!button) {
      button = document.createElement("button");
      button.id = config.newId;
      button.type = "button";
      button.className = original.className
        .split(/\s+/)
        .filter((name) => name && name !== "reef-original-clear-action")
        .join(" ");
      button.textContent = "New record";
      original.after(button);
    } else if (button.previousElementSibling !== original) {
      original.after(button);
    }

    if (button.textContent !== "New record") button.textContent = "New record";
    const disabled = Boolean(original.disabled);
    if (button.disabled !== disabled) button.disabled = disabled;
  }
}

function markDirtyFromField(event) {
  if (!event.isTrusted) return;
  const type = formTypeForElement(event.target);
  if (type) dirty.set(type, true);
}

function markDirtyFromAction(target, event) {
  if (!event.isTrusted) return;
  if (!target.closest(
    "#addReefParticipant, [data-remove-participant], [data-clear-competency], "
    + "[data-set-competency-participant], [data-remove-photo], "
    + "[data-reef-bridge-remove-photo]"
  )) return;
  const type = formTypeForElement(target);
  if (type) dirty.set(type, true);
}

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const newEntry = Object.entries(FORM_CONFIG)
    .find(([, config]) => target.closest(`#${config.newId}`));
  if (newEntry) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const [type] = newEntry;
    if (dirty.get(type)) openNewRecordDialog(type);
    else resetToNewRecord(type);
    return;
  }

  const deleteButton = target.closest("[data-delete-unified-record]");
  if (deleteButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openDeleteDialog({
      type: deleteButton.dataset.recordType,
      id: deleteButton.dataset.recordId,
      number: deleteButton.dataset.recordNumber || "this record"
    });
    return;
  }

  markDirtyFromAction(target, event);
}

function formTypeForElement(element) {
  if (!(element instanceof Element)) return null;
  return Object.entries(FORM_CONFIG)
    .find(([, config]) => element.closest(`#${config.formId}`))?.[0] || null;
}

function openNewRecordDialog(type) {
  const dialog = document.getElementById("reefNewRecordDialog");
  if (!dialog) return;
  newRecordType = type;
  const title = document.getElementById("reefNewRecordTitle");
  if (title) title.textContent = `Start a new ${FORM_CONFIG[type].label}?`;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else if (window.confirm("This record has unsaved changes. Discard them and start a new record?")) {
    resetToNewRecord(type);
  }
}

function closeNewRecordDialog() {
  const dialog = document.getElementById("reefNewRecordDialog");
  if (dialog?.open && typeof dialog.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  newRecordType = null;
}

function resetToNewRecord(type) {
  stopSaveThenNew();
  dirty.set(type, false);
  const original = document.getElementById(FORM_CONFIG[type].clearId);
  if (!original) return;
  original.click();
  queueMicrotask(scheduleSync);
}

function beginSaveThenNew(type) {
  stopSaveThenNew();
  const config = FORM_CONFIG[type];
  const save = document.getElementById(config.saveId);
  const status = document.getElementById(config.statusId);
  if (!save) return;

  saveThenNew = {
    type,
    baselineText: String(status?.textContent || ""),
    baselineKind: String(status?.dataset.status || ""),
    sawBusy: false,
    startedAt: Date.now(),
    timer: null
  };

  saveThenNew.timer = window.setInterval(checkSaveThenNew, 90);
  save.click();
}

function checkSaveThenNew() {
  const pending = saveThenNew;
  if (!pending) return;
  const config = FORM_CONFIG[pending.type];
  const status = document.getElementById(config.statusId);
  const text = String(status?.textContent || "");
  const kind = String(status?.dataset.status || "");
  const busy = formActionButtons(pending.type).some((button) => button.disabled);
  if (busy) pending.sawBusy = true;
  const changed = pending.sawBusy
    || text !== pending.baselineText
    || kind !== pending.baselineKind;

  if (changed && !busy && kind === "error") {
    stopSaveThenNew();
    return;
  }
  if (changed && !busy && /\b(saved|updated|submitted)\b/i.test(text)) {
    const type = pending.type;
    dirty.set(type, false);
    stopSaveThenNew();
    resetToNewRecord(type);
    return;
  }
  if (Date.now() - pending.startedAt > SAVE_TIMEOUT_MS) stopSaveThenNew();
}

function stopSaveThenNew() {
  if (saveThenNew?.timer) window.clearInterval(saveThenNew.timer);
  saveThenNew = null;
}

function formActionButtons(type) {
  const config = FORM_CONFIG[type];
  return [config.saveId, config.submitId, config.clearId]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function syncCleanStateFromActions() {
  for (const [type, config] of Object.entries(FORM_CONFIG)) {
    const status = document.getElementById(config.statusId);
    if (!status) continue;
    const text = String(status.textContent || "");
    const kind = String(status.dataset.status || "");
    const signature = `${kind}|${text}`;
    const busy = formActionButtons(type).some((button) => button.disabled);

    if (busy) actionWasBusy.set(type, true);
    if (!busy && actionWasBusy.get(type)) {
      actionWasBusy.set(type, false);
      if (kind !== "error" && /\b(saved|updated|submitted|loaded)\b/i.test(text)) {
        dirty.set(type, false);
      }
    }

    if (lastStatus.get(type) === signature) continue;
    lastStatus.set(type, signature);
    if (kind !== "error" && /\b(saved|updated|submitted|loaded)\b/i.test(text)) {
      dirty.set(type, false);
    }
  }
}

async function loadOwnerContext() {
  try {
    const context = await rpc("ag_reef_records_workspace_context");
    canDeleteRecords = Boolean(context?.can_delete_records);
  } catch {
    canDeleteRecords = false;
  }
  scheduleSync();
}

function syncRecordSurface() {
  hideElement("reefUnifiedRecordsAccessHelp");
  hideElement("reefUnifiedManageAccounts");
  hideElement("reefUnifiedRecordsRefresh");
  hideElement("reefUnifiedAccountNote");

  const headingActions = document.querySelector(".reef-unified-heading-actions");
  if (headingActions && headingActions.style.display !== "none") {
    headingActions.style.display = "none";
  }

  document.querySelectorAll("#reefUnifiedRecordsBody [data-open-unified-record]")
    .forEach((openButton) => syncDeleteAction(openButton));
}

function hideElement(id) {
  const element = document.getElementById(id);
  if (!element) return;
  if (!element.hidden) element.hidden = true;
  if (element.style.display !== "none") element.style.display = "none";
}

function syncDeleteAction(openButton) {
  const cell = openButton.closest("td");
  const row = openButton.closest("tr");
  if (!cell || !row) return;

  let actions = cell.querySelector(".reef-owner-row-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "reef-owner-row-actions";
    cell.append(actions);
    actions.append(openButton);
  } else if (openButton.parentElement !== actions) {
    actions.prepend(openButton);
  }

  const type = openButton.dataset.recordType || "";
  let deleteButton = actions.querySelector("[data-delete-unified-record]");
  if (!canDeleteRecords || !DELETE_TYPES.has(type)) {
    deleteButton?.remove();
    return;
  }

  if (!deleteButton) {
    deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary-action danger";
    deleteButton.dataset.deleteUnifiedRecord = "true";
    deleteButton.textContent = "Delete";
    actions.append(deleteButton);
  }

  deleteButton.dataset.recordType = type;
  deleteButton.dataset.recordId = openButton.dataset.recordId || "";
  deleteButton.dataset.recordNumber = row.querySelector('td[data-label="Record"] strong')?.textContent?.trim() || "Record";
  deleteButton.disabled = deletingRecord;
}

function openDeleteDialog(target) {
  if (!canDeleteRecords || !DELETE_TYPES.has(target.type) || !target.id) return;
  deleteTarget = target;
  const title = document.getElementById("reefDeleteRecordTitle");
  if (title) title.textContent = `Delete ${target.number}?`;
  const dialog = document.getElementById("reefDeleteRecordDialog");
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else if (window.confirm(`Delete ${target.number}? This removes it from active Reef records.`)) {
    void confirmDeleteRecord();
  }
}

function closeDeleteDialog() {
  const dialog = document.getElementById("reefDeleteRecordDialog");
  if (dialog?.open && typeof dialog.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  if (!deletingRecord) deleteTarget = null;
}

async function confirmDeleteRecord() {
  if (!deleteTarget || deletingRecord) return;
  const target = { ...deleteTarget };
  deletingRecord = true;
  setDeleteDialogDisabled(true);
  setRecordsStatus(`Deleting ${target.number}…`);
  scheduleSync();

  try {
    await rpc("ag_reef_records_workspace_delete", {
      p_record_type: target.type,
      p_record_id: target.id
    });
    deletingRecord = false;
    closeDeleteDialog();
    deleteTarget = null;
    setDeleteDialogDisabled(false);
    document.querySelector('[data-reef-training-tab="records"]')?.click();
    window.setTimeout(() => {
      setRecordsStatus(`${target.number} deleted.`, "success");
    }, 350);
  } catch (error) {
    deletingRecord = false;
    setDeleteDialogDisabled(false);
    setRecordsStatus(error?.message || `${target.number} could not be deleted.`, "error");
    scheduleSync();
  }
}

function setDeleteDialogDisabled(disabled) {
  document.querySelectorAll("#reefDeleteRecordDialog button")
    .forEach((button) => { button.disabled = disabled; });
}

function setRecordsStatus(message, kind = "") {
  const status = document.getElementById("reefUnifiedRecordsStatus");
  if (!status) return;
  status.textContent = message || "";
  if (kind) status.dataset.status = kind;
  else delete status.dataset.status;
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || {} : data;
}

function isReviewMode() {
  const parameters = new URLSearchParams(window.location.search);
  return Boolean(parameters.get("share") && parameters.get("org"));
}

export const REEF_NURSERY_CLEANUP_CONTRACT = Object.freeze({
  previousRecordsHelpRemoved: true,
  previousRecordsRefreshRemoved: true,
  protectedOwnerSoftDelete: true,
  deleteTypes: [...DELETE_TYPES],
  clearReplacedWithNewRecord: true,
  unsavedChoices: ["Save and start new", "Discard and start new", "Cancel"]
});
