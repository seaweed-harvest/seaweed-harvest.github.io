import { APP_CONFIG } from "./config.js";
import { callPublicRpc, selectRows } from "./supabase_client.js";
import {
  createPendingBackup,
  initialiseOfflineStore,
  listOutboxItems,
  restorePendingBackup
} from "./offline_store.js";
import { syncPendingCollections } from "./offline_sync.js";

const COLLECTOR_NAME_STORAGE_KEY = "seaweed_harvest:collector_name";
const state = {
  rows: [],
  serverRows: [],
  localRows: [],
  communities: [],
  seaweedTypes: [],
  grades: [],
  localReady: false,
  online: navigator.onLine,
  networkVerified: false,
  syncing: false,
  pendingCount: 0,
  showSyncStatus: false,
  selectedIds: new Set(),
  editingIds: new Set(),
  dirtyIds: new Set(),
  drafts: new Map()
};
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "todayAdminLink",
    "todaySignInLink",
    "todayConnectionStatus",
    "todayIntakeDate",
    "todayEditorName",
    "todayPendingRecordsBand",
    "todayPendingRecordsLabel",
    "todayPendingRecordsText",
    "todayPendingRecordsSync",
    "todaySyncAll",
    "publicTodaySyncHeader",
    "publicTodayCount",
    "reloadPublicToday",
    "publicTodayEditActions",
    "publicTodaySelectedCount",
    "publicTodayStartEdit",
    "publicTodaySaveEdits",
    "publicTodayDiscardEdits",
    "publicTodaySelectAll",
    "publicTodayRows",
    "publicTodayStatus",
    "todayDownloadBackup",
    "todayRestoreBackup",
    "todayRestoreInput",
    "todayRecoveryStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  els.todayIntakeDate.textContent = new Intl.DateTimeFormat("en-KE", {
    dateStyle: "long",
    timeZone: "Africa/Nairobi"
  }).format(new Date());
  els.todayEditorName.value = String(localStorage.getItem(COLLECTOR_NAME_STORAGE_KEY) || "").trim();
  els.todayEditorName.addEventListener("change", rememberEditorName);
  els.reloadPublicToday.addEventListener("click", loadToday);
  els.publicTodayRows.addEventListener("change", handleTableChange);
  els.publicTodayRows.addEventListener("input", handleDraftInput);
  els.publicTodaySelectAll.addEventListener("change", toggleAllRows);
  els.publicTodayStartEdit.addEventListener("click", startEdit);
  els.publicTodaySaveEdits.addEventListener("click", saveEdits);
  els.publicTodayDiscardEdits.addEventListener("click", discardEdits);
  els.todayPendingRecordsSync.addEventListener("click", syncAllLocalRecords);
  els.todaySyncAll.addEventListener("click", syncAllLocalRecords);
  els.todayDownloadBackup.addEventListener("click", downloadPendingBackup);
  els.todayRestoreBackup.addEventListener("click", () => els.todayRestoreInput.click());
  els.todayRestoreInput.addEventListener("change", restorePendingBackupFile);

  await initialiseLocalIntake();
  await initialiseNativeNetwork();
  window.addEventListener("online", () => {
    state.online = true;
    state.networkVerified = false;
    void loadToday();
  });
  window.addEventListener("offline", () => {
    state.online = false;
    state.networkVerified = true;
    void refreshLocalRows();
  });

  await setupOptionalAccount();
  await loadToday();
}

async function initialiseLocalIntake() {
  try {
    await initialiseOfflineStore();
    state.localReady = true;
    await refreshLocalRows();
  } catch (error) {
    state.localReady = false;
    setStatus(error.message || "Local records are unavailable on this device.", "error");
  }
}

async function initialiseNativeNetwork() {
  const network = globalThis.SeaweedNative?.Network;
  if (!globalThis.SeaweedNative?.isNative || !network) return;
  try {
    const status = await network.getStatus();
    state.online = Boolean(status.connected);
    state.networkVerified = true;
    await network.addListener("networkStatusChange", (nextStatus) => {
      state.online = Boolean(nextStatus.connected);
      state.networkVerified = true;
      if (state.online) void loadToday();
      else void refreshLocalRows();
    });
  } catch {
    state.online = navigator.onLine;
  }
}

async function setupOptionalAccount() {
  if (!state.online || !localStorage.getItem("seaweed-ag-auth")) return;
  try {
    const authApi = await import("./auth_client.js");
    const session = await authApi.currentSession();
    if (!session) return;
    const profile = await authApi.currentProfile(true);
    if (!profile) return;

    els.todaySignInLink.hidden = true;
    els.todayAdminLink.hidden = !(profile.account_status === "active"
      && (profile.app_role === "system_admin" || profile.can_access_admin));
    authApi.setupAccountControls(profile, {
      returnPage: "today.html",
      signOutReturn: "./today.html",
      showAggregator: false
    });
  } catch {
    // Today's Intake remains public when an old or invalid session is stored.
  }
}

async function syncAllLocalRecords() {
  if (!state.localReady || state.syncing) return;
  if (!state.online) {
    setStatus("Device offline. Local records will remain on this device until reception returns.");
    return;
  }

  state.syncing = true;
  updateLocalSyncUi();
  setStatus("Syncing local records...");
  try {
    const result = await syncPendingCollections({
      online: state.online,
      onProgress: refreshLocalRows
    });
    await loadToday();
    if (result.failedCount) {
      setStatus(`${result.failedCount} record${result.failedCount === 1 ? "" : "s"} could not be synced.`, "error");
    } else {
      setStatus(`Synced ${result.syncedCount} local record${result.syncedCount === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    await refreshLocalRows();
    setStatus(error.message || "Local records could not be synced.", "error");
  } finally {
    state.syncing = false;
    updateLocalSyncUi();
  }
}

async function downloadPendingBackup() {
  try {
    const backup = await createPendingBackup();
    if (!backup.pendingCount) {
      setRecoveryStatus("There are no unsynced records to back up.");
      return;
    }
    const filename = `seaweed-harvest-pending-${new Date().toISOString().slice(0, 10)}.json`;
    const contents = JSON.stringify(backup);
    if (globalThis.SeaweedNative?.isNative && globalThis.SeaweedNative?.saveBackup) {
      await globalThis.SeaweedNative.saveBackup(filename, contents);
      setRecoveryStatus("Pending-record backup saved.");
      return;
    }
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setRecoveryStatus("Pending-record backup downloaded.");
  } catch (error) {
    setRecoveryStatus(error.message || "Backup could not be created.", "error");
  }
}

async function restorePendingBackupFile() {
  const file = els.todayRestoreInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error("The backup file is too large.");
    const backup = JSON.parse(await file.text());
    const result = await restorePendingBackup(backup);
    await refreshLocalRows();
    const skipped = result.skipped ? ` ${result.skipped} already existed on this device.` : "";
    setRecoveryStatus(`Restored ${result.imported} pending record(s).${skipped}`);
  } catch (error) {
    setRecoveryStatus(error.message || "This is not a valid Seaweed Harvest pending-record backup.", "error");
  } finally {
    els.todayRestoreInput.value = "";
  }
}

function setRecoveryStatus(message, type = "") {
  els.todayRecoveryStatus.textContent = message || "";
  els.todayRecoveryStatus.dataset.status = type;
}

async function loadToday() {
  els.reloadPublicToday.disabled = true;
  resetEditState();
  await refreshLocalRows();

  if (!state.online) {
    state.serverRows = [];
    combineTodayRows();
    renderRows();
    updateLocalSyncUi();
    els.todayConnectionStatus.textContent = "Offline";
    els.todayConnectionStatus.className = "status-pill offline-status-offline";
    setStatus(state.localRows.length
      ? "Offline. Showing records stored on this device."
      : "Offline. No local intake records are waiting.");
    els.reloadPublicToday.disabled = false;
    return;
  }

  setStatus("Loading...");
  try {
    const [rows, communities, seaweedTypes, grades] = await Promise.all([
      callPublicRpc("ag_public_mawimbi_today_intake"),
      callPublicRpc("ag_public_mawimbi_communities"),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc")
    ]);
    state.serverRows = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      _syncStatus: "synced",
      _localRecord: false
    }));
    state.communities = Array.isArray(communities) ? communities : [];
    state.seaweedTypes = Array.isArray(seaweedTypes) ? seaweedTypes : [];
    state.grades = Array.isArray(grades) ? grades : [];
    state.online = true;
    state.networkVerified = true;
    combineTodayRows();
    renderRows();
    updateLocalSyncUi();
    els.todayConnectionStatus.textContent = "Live";
    els.todayConnectionStatus.className = "status-pill";
    setStatus("Loaded.");
  } catch (error) {
    state.online = false;
    state.networkVerified = true;
    state.serverRows = [];
    combineTodayRows();
    renderRows();
    updateLocalSyncUi();
    els.todayConnectionStatus.textContent = state.localRows.length ? "Local" : "Error";
    els.todayConnectionStatus.className = "status-pill status-muted";
    setStatus(state.localRows.length
      ? `Live intake could not be loaded. Showing ${state.localRows.length} local record(s).`
      : error.message, "error");
  } finally {
    els.reloadPublicToday.disabled = false;
  }
}

async function refreshLocalRows() {
  if (!state.localReady) return;
  const items = await listOutboxItems();
  const pendingItems = items.filter((item) => item.status !== "synced");
  state.pendingCount = pendingItems.length;
  state.localRows = pendingItems
    .filter((item) => isTodayInNairobi(item.payload?.collected_at || item.createdAt))
    .map(localItemToRow);
  combineTodayRows();
  renderRows();
  updateLocalSyncUi();
}

function localItemToRow(item) {
  const payload = item.payload || {};
  return {
    id: `local:${item.submissionId}`,
    collected_at: payload.collected_at || item.createdAt,
    farmer_name_snapshot: payload.farmer_name_snapshot || item.summary?.farmer || null,
    sack_weight_kg: payload.sack_weight_kg ?? item.summary?.weightKg ?? null,
    seaweed_type: payload.seaweed_type || null,
    grade_code: payload.grade_code || payload.seaweed_grade || item.summary?.grade || null,
    community_id: payload.community_id || null,
    community_name_snapshot: payload.community_name_snapshot || item.summary?.community || null,
    recorded_by_name: payload.collector_name || item.collectorName || null,
    transaction_id: payload.transaction_id || item.summary?.transactionId || null,
    updated_at: item.updatedAt,
    _localRecord: true,
    _submissionId: item.submissionId,
    _syncStatus: item.status || "pending",
    _lastError: item.lastError || null
  };
}

function combineTodayRows() {
  const serverTransactions = new Set(state.serverRows.map((row) => String(row.transaction_id || "")));
  const localRows = state.localRows.filter((row) => !serverTransactions.has(String(row.transaction_id || "")));
  state.rows = [...localRows, ...state.serverRows]
    .sort((left, right) => String(right.collected_at || "").localeCompare(String(left.collected_at || "")));
  state.showSyncStatus = state.localRows.length > 0;
}

function updateLocalSyncUi() {
  const count = state.pendingCount;
  const offline = !state.online || !state.networkVerified;
  const syncDisabled = state.syncing || offline || count === 0;
  els.todayPendingRecordsBand.hidden = count === 0;
  els.todaySyncAll.hidden = count === 0;
  els.todaySyncAll.disabled = syncDisabled;
  els.todayPendingRecordsSync.hidden = offline || count === 0;
  els.todayPendingRecordsSync.disabled = state.syncing;
  if (!count) return;

  if (offline && els.todayConnectionStatus.textContent === "Loading") {
    els.todayConnectionStatus.textContent = "Offline";
    els.todayConnectionStatus.className = "status-pill offline-status-offline";
  }
  els.todayPendingRecordsLabel.textContent = offline ? "Device offline." : "Local records waiting.";
  els.todayPendingRecordsText.textContent = `${count} record${count === 1 ? "" : "s"} stored locally.`;
}

function syncStatusHtml(row) {
  if (!row._localRecord) return '<span class="status-pill offline-status-online">Synced</span>';
  if (row._syncStatus === "failed") {
    return `<span class="status-pill offline-status-failed" title="${escapeAttribute(row._lastError || "Sync needs attention")}">Needs attention</span>`;
  }
  if (row._syncStatus === "syncing") return '<span class="status-pill status-muted">Syncing</span>';
  return '<span class="status-pill offline-status-waiting">Stored locally</span>';
}

function isTodayInNairobi(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return nairobiDateKey(date) === nairobiDateKey(new Date());
}

function nairobiDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function renderRows() {
  els.publicTodayCount.textContent = `${state.rows.length} row${state.rows.length === 1 ? "" : "s"}`;
  els.publicTodaySyncHeader.hidden = !state.showSyncStatus;
  if (!state.rows.length) {
    els.publicTodayRows.innerHTML = '<tr><td colspan="10" class="empty-state">No Mawimbi intake has been recorded today.</td></tr>';
    updateSelectionUi();
    return;
  }

  els.publicTodayRows.innerHTML = state.rows.map((row) => {
    const id = String(row.id || "");
    const editing = state.editingIds.has(id);
    const dirty = state.dirtyIds.has(id);
    const draft = state.drafts.get(id) || rowDraft(row);
    const local = Boolean(row._localRecord);
    return `
      <tr data-public-today-row="${escapeAttribute(id)}" class="${dirty ? "today-row-dirty" : ""}${local ? " today-row-local" : ""}">
        <td class="selection-cell">${local
          ? `<input type="checkbox" aria-label="Sync this local record before editing" disabled>`
          : `<input type="checkbox" data-public-today-select="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "intake row")}"${state.selectedIds.has(id) ? " checked" : ""}${state.editingIds.size ? " disabled" : ""}>`}</td>
        <td class="today-sync-status-cell"${state.showSyncStatus ? "" : " hidden"}>${syncStatusHtml(row)}</td>
        <td>${escapeHtml(formatTime(row.collected_at))}</td>
        <td>${editing ? textControl(id, "farmer_name_snapshot", draft.farmer_name_snapshot, "today-farmer-editor", 150) : escapeHtml(row.farmer_name_snapshot || "-")}</td>
        <td>${editing ? numberControl(id, "sack_weight_kg", draft.sack_weight_kg, 0.01, 0.01) : escapeHtml(formatNumber(row.sack_weight_kg))}</td>
        <td>${editing ? selectControl(id, "seaweed_type", draft.seaweed_type, seaweedTypeOptions(row)) : escapeHtml(titleCase(row.seaweed_type))}</td>
        <td>${editing ? selectControl(id, "grade_code", draft.grade_code, gradeOptions(row)) : escapeHtml(row.grade_code || "-")}</td>
        <td>${editing ? selectControl(id, "community_id", draft.community_id, communityOptions(row)) : escapeHtml(joinValues(row.community_id, row.community_name_snapshot))}</td>
        <td>${editing ? textControl(id, "recorded_by_name", draft.recorded_by_name, "today-collector-editor", 100) : escapeHtml(row.recorded_by_name || "-")}</td>
        <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
      </tr>
    `;
  }).join("");
  updateSelectionUi();
}

function handleTableChange(event) {
  const checkbox = event.target.closest("[data-public-today-select]");
  if (checkbox) {
    if (state.editingIds.size) return;
    const id = checkbox.dataset.publicTodaySelect;
    if (checkbox.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    updateSelectionUi();
    return;
  }
  handleDraftInput(event);
}

function handleDraftInput(event) {
  const control = event.target.closest("[data-public-today-field]");
  if (!control) return;
  const id = control.dataset.publicTodayId;
  const draft = state.drafts.get(id);
  if (!draft || !state.editingIds.has(id)) return;
  draft[control.dataset.publicTodayField] = control.value;
  updateDirtyState(id);
}

function toggleAllRows() {
  if (state.editingIds.size) return;
  state.selectedIds.clear();
  if (els.publicTodaySelectAll.checked) {
    state.rows.filter((row) => !row._localRecord).forEach((row) => state.selectedIds.add(String(row.id)));
  }
  renderRows();
}

function startEdit() {
  if (!state.selectedIds.size) return;
  state.editingIds = new Set(state.selectedIds);
  state.dirtyIds.clear();
  state.drafts.clear();
  state.rows.forEach((row) => {
    const id = String(row.id || "");
    if (state.editingIds.has(id)) state.drafts.set(id, rowDraft(row));
  });
  renderRows();
  setStatus(`Editing ${state.editingIds.size} selected row${state.editingIds.size === 1 ? "" : "s"}.`);
}

function discardEdits() {
  state.editingIds.clear();
  state.dirtyIds.clear();
  state.drafts.clear();
  renderRows();
  setStatus("Changes discarded. Nothing was saved.");
}

async function saveEdits() {
  const editorName = rememberEditorName();
  if (editorName.length < 2) {
    setStatus("Enter your name before saving changes.", "error");
    els.todayEditorName.focus();
    return;
  }
  const updates = [...state.dirtyIds].map(updatePayload).filter(Boolean);
  if (!updates.length) return;

  els.publicTodaySaveEdits.disabled = true;
  els.publicTodayDiscardEdits.disabled = true;
  setStatus("Saving changes...");
  try {
    const result = await submitPublicIntakeEdits(editorName, updates);
    await loadToday();
    const count = Number(result?.updated_count || 0);
    setStatus(`Updated ${count} row${count === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.publicTodaySaveEdits.disabled = state.dirtyIds.size === 0;
    els.publicTodayDiscardEdits.disabled = false;
  }
}

async function submitPublicIntakeEdits(editorName, updates) {
  const response = await fetch(`${APP_CONFIG.supabase.url}/functions/v1/public-intake`, {
    method: "POST",
    headers: {
      apikey: APP_CONFIG.supabase.anonKey,
      Authorization: `Bearer ${APP_CONFIG.supabase.anonKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ editor_name: editorName, updates })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Could not save changes (${response.status}).`);
  return payload.result || {};
}

function updatePayload(id) {
  const row = rowById(id);
  const draft = state.drafts.get(id);
  if (!row || !draft) return null;
  const original = rowDraft(row);
  const payload = { id, expected_updated_at: row.updated_at };
  Object.keys(original).forEach((field) => {
    if (normaliseValue(field, draft[field]) === normaliseValue(field, original[field])) return;
    payload[field] = field === "sack_weight_kg" ? optionalNumber(draft[field]) : nullableText(draft[field]);
  });
  return Object.keys(payload).length > 2 ? payload : null;
}

function updateDirtyState(id) {
  const row = rowById(id);
  const draft = state.drafts.get(id);
  if (!row || !draft) return;
  const original = rowDraft(row);
  const dirty = Object.keys(original).some((field) => normaliseValue(field, draft[field]) !== normaliseValue(field, original[field]));
  if (dirty) state.dirtyIds.add(id);
  else state.dirtyIds.delete(id);
  const tableRow = els.publicTodayRows.querySelector(`[data-public-today-row="${cssEscape(id)}"]`);
  if (tableRow) tableRow.classList.toggle("today-row-dirty", dirty);
  updateSelectionUi();
}

function updateSelectionUi() {
  const selected = state.selectedIds.size;
  const editing = state.editingIds.size > 0;
  const dirty = state.dirtyIds.size;
  const selectableCount = state.rows.filter((row) => !row._localRecord).length;
  els.publicTodayEditActions.hidden = selected === 0;
  els.publicTodaySelectedCount.textContent = `${selected} selected`;
  els.publicTodayStartEdit.hidden = editing;
  els.publicTodayStartEdit.textContent = selected > 1 ? `Edit ${selected}` : "Edit";
  els.publicTodaySaveEdits.hidden = !editing;
  els.publicTodaySaveEdits.disabled = dirty === 0;
  els.publicTodaySaveEdits.textContent = dirty ? `Save ${dirty}` : "Save";
  els.publicTodayDiscardEdits.hidden = !editing;
  els.reloadPublicToday.disabled = editing;
  els.todayEditorName.disabled = editing;
  els.publicTodaySelectAll.checked = selectableCount > 0 && selected === selectableCount;
  els.publicTodaySelectAll.indeterminate = selected > 0 && selected < selectableCount;
  els.publicTodaySelectAll.disabled = editing || selectableCount === 0;
}

function resetEditState() {
  state.selectedIds.clear();
  state.editingIds.clear();
  state.dirtyIds.clear();
  state.drafts.clear();
}

function rowDraft(row) {
  return {
    community_id: valueOrEmpty(row.community_id),
    farmer_name_snapshot: valueOrEmpty(row.farmer_name_snapshot),
    sack_weight_kg: valueOrEmpty(row.sack_weight_kg),
    seaweed_type: valueOrEmpty(row.seaweed_type),
    grade_code: valueOrEmpty(row.grade_code),
    recorded_by_name: valueOrEmpty(row.recorded_by_name)
  };
}

function communityOptions(row) {
  return withFallback([["", "Unassigned"], ...state.communities.map((community) => [
    community.community_id,
    joinValues(community.community_id, community.community_name)
  ])], row.community_id, joinValues(row.community_id, row.community_name_snapshot));
}

function seaweedTypeOptions(row) {
  return withFallback(state.seaweedTypes.map((type) => [
    type.type_key,
    joinValues(type.label, type.common_name)
  ]), row.seaweed_type, titleCase(row.seaweed_type));
}

function gradeOptions(row) {
  return withFallback(state.grades.map((grade) => [
    grade.grade,
    joinValues(grade.grade, grade.label && grade.label !== grade.grade ? grade.label : "", grade.rejected ? "Rejected" : "")
  ]), row.grade_code, row.grade_code);
}

function withFallback(options, value, label) {
  const text = String(value || "");
  if (text && !options.some(([optionValue]) => String(optionValue) === text)) options.push([text, label || text]);
  return options;
}

function selectControl(id, field, selectedValue, options) {
  const selected = String(selectedValue || "");
  return `<select class="today-inline-editor" data-public-today-id="${escapeAttribute(id)}" data-public-today-field="${escapeAttribute(field)}">${options.map(([value, label]) => `<option value="${escapeAttribute(value)}"${String(value) === selected ? " selected" : ""}>${escapeHtml(label || value || "-")}</option>`).join("")}</select>`;
}

function textControl(id, field, value, className, maxLength) {
  return `<input class="today-inline-editor ${escapeAttribute(className)}" type="text" data-public-today-id="${escapeAttribute(id)}" data-public-today-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}" maxlength="${maxLength}">`;
}

function numberControl(id, field, value, step, min) {
  return `<input class="today-inline-editor today-number-editor" type="number" inputmode="decimal" data-public-today-id="${escapeAttribute(id)}" data-public-today-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}" step="${step}" min="${min}">`;
}

function rememberEditorName() {
  const name = String(els.todayEditorName.value || "").trim().replace(/\s+/g, " ");
  els.todayEditorName.value = name;
  if (name) localStorage.setItem(COLLECTOR_NAME_STORAGE_KEY, name);
  return name;
}

function rowById(id) {
  return state.rows.find((row) => String(row.id || "") === String(id)) || null;
}

function normaliseValue(field, value) {
  return field === "sack_weight_kg" ? optionalNumber(value) : String(value ?? "").trim();
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function valueOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-KE", { maximumFractionDigits: 2 }) : "-";
}

function joinValues(...values) {
  return values.filter(Boolean).join(" - ") || "-";
}

function titleCase(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "-";
}

function setStatus(message, type = "") {
  els.publicTodayStatus.textContent = message || "";
  els.publicTodayStatus.dataset.status = type;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
