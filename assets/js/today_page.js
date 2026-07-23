import { APP_CONFIG } from "./config.js";
import { callPublicRpc, callRpc, selectRows } from "./supabase_client.js";
import {
  deleteOutboxItem,
  getOutboxItem,
  initialiseOfflineStore,
  listOutboxItems,
  updateOutboxItem
} from "./offline_store.js";
import { syncPendingCollections } from "./offline_sync.js";
import { createOperationFeedback } from "./operation_feedback.js";
import { setupAppNavigation } from "./app_navigation.js?v=7";

const COLLECTOR_NAME_STORAGE_KEY = "seaweed_harvest:collector_name";
const state = {
  rows: [],
  serverRows: [],
  localRows: [],
  olderLocalRows: [],
  communities: [],
  seaweedTypes: [],
  grades: [],
  localReady: false,
  authenticated: false,
  canEditCollections: false,
  accessToken: null,
  online: navigator.onLine,
  networkVerified: false,
  syncing: false,
  pendingCount: 0,
  selectedIds: new Set(),
  editingIds: new Set(),
  dirtyIds: new Set(),
  drafts: new Map(),
  profile: null
};
const els = {};
let operationFeedback = null;

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
    "publicTodayDeleteSelected",
    "publicTodaySaveEdits",
    "publicTodayDiscardEdits",
    "publicTodaySelectAll",
    "publicTodayRows",
    "olderPendingPanel",
    "olderPendingCount",
    "olderPendingSync",
    "olderPendingActions",
    "olderPendingSelectedCount",
    "olderPendingDelete",
    "olderPendingSelectAll",
    "olderPendingRows",
    "publicTodayStatus",
    "todayOperationFeedback"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  operationFeedback = createOperationFeedback(els.todayOperationFeedback);

  els.todayIntakeDate.textContent = new Intl.DateTimeFormat("en-KE", {
    dateStyle: "long",
    timeZone: "Africa/Nairobi"
  }).format(new Date());
  els.todayEditorName.value = String(localStorage.getItem(COLLECTOR_NAME_STORAGE_KEY) || "").trim();
  els.todayEditorName.addEventListener("change", rememberEditorName);
  els.reloadPublicToday.addEventListener("click", loadToday);
  els.publicTodayRows.addEventListener("change", handleTableChange);
  els.publicTodayRows.addEventListener("input", handleDraftInput);
  els.olderPendingRows.addEventListener("change", handleTableChange);
  els.publicTodaySelectAll.addEventListener("change", toggleAllRows);
  els.olderPendingSelectAll.addEventListener("change", toggleOlderRows);
  els.publicTodayStartEdit.addEventListener("click", startEdit);
  els.publicTodayDeleteSelected.addEventListener("click", deleteSelectedRecords);
  els.publicTodaySaveEdits.addEventListener("click", saveEdits);
  els.publicTodayDiscardEdits.addEventListener("click", discardEdits);
  els.todayPendingRecordsSync.addEventListener("click", syncAllLocalRecords);
  els.todaySyncAll.addEventListener("click", syncAllLocalRecords);
  els.olderPendingSync.addEventListener("click", syncAllLocalRecords);
  els.olderPendingDelete.addEventListener("click", deleteSelectedRecords);

  await initialiseLocalIntake();
  await initialiseNativeNetwork();
  window.addEventListener("online", () => {
    state.online = true;
    state.networkVerified = false;
    void loadToday().then(autoSyncLocalRecords);
  });
  window.addEventListener("offline", () => {
    state.online = false;
    state.networkVerified = true;
    void refreshLocalRows();
  });

  await setupOptionalAccount();
  setupAppNavigation({ profile: state.profile });
  await loadToday();
  void autoSyncLocalRecords();
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
      if (state.online) {
        void loadToday().then(autoSyncLocalRecords);
      }
      else void refreshLocalRows();
    });
  } catch {
    state.online = navigator.onLine;
  }
}

async function autoSyncLocalRecords() {
  if (!globalThis.SeaweedNative?.isNative || !state.online || !state.localReady || state.syncing) return;
  await refreshLocalRows();
  if (state.pendingCount > 0) await syncAllLocalRecords();
}

async function setupOptionalAccount() {
  if (!state.online || !localStorage.getItem("seaweed-ag-auth")) return;
  try {
    const authApi = await import("./auth_client.js");
    const session = await authApi.currentSession();
    if (!session) return;
    const profile = await authApi.currentProfile(true);
    if (!profile || profile.account_status !== "active") return;

    state.profile = profile;
    state.authenticated = true;
    state.accessToken = session.access_token;
    state.canEditCollections = profile.app_role === "system_admin" || Boolean(profile.can_edit_collections);

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
    operationFeedback.show({
      state: "stored",
      title: "Device offline",
      message: `${state.pendingCount} record${state.pendingCount === 1 ? " is" : "s are"} safely stored on this device.`,
      actionLabel: "Done",
      onAction: () => operationFeedback.hide()
    });
    return;
  }

  state.syncing = true;
  updateLocalSyncUi();
  setStatus("Syncing local records...");
  operationFeedback.show({
    state: "progress",
    title: "Syncing...",
    message: `0/${state.pendingCount} records checked.`
  });
  try {
    const result = await syncPendingCollections({
      online: state.online,
      currentUserId: state.profile?.id || null,
      onProgress: async (_submissionId, progress) => {
        operationFeedback.update({
          message: `${progress.processedCount}/${progress.totalCount} records checked.`
        });
        await refreshLocalRows();
      }
    });
    await loadToday();
    if (result.failedCount) {
      const rejected = result.errors.filter((error) => error.type === "server_rejected").length;
      setStatus(rejected
        ? `${rejected} record${rejected === 1 ? " was" : "s were"} rejected by Supabase. Select the local row to delete it after checking the reason.`
        : `${result.failedCount} record${result.failedCount === 1 ? "" : "s"} could not be synced.`, "error");
      operationFeedback.show({
        state: "error",
        title: rejected ? "Supabase rejected a record" : "Sync needs attention",
        message: rejected
          ? `${result.syncedCount}/${result.totalCount} synced. Select a rejected local row to view its reason or delete it.`
          : `${result.syncedCount}/${result.totalCount} synced. ${result.failedCount} could not be synced.`,
        actionLabel: "Close",
        onAction: () => operationFeedback.hide()
      });
    } else {
      setStatus(`Synced ${result.syncedCount} local record${result.syncedCount === 1 ? "" : "s"}.`);
      operationFeedback.show({
        state: "success",
        title: "Sync complete",
        message: `${result.syncedCount}/${result.totalCount} synced successfully.`,
        actionLabel: "Done",
        onAction: () => operationFeedback.hide()
      });
    }
  } catch (error) {
    await refreshLocalRows();
    setStatus(error.message || "Local records could not be synced.", "error");
    operationFeedback.show({
      state: "error",
      title: "Sync could not finish",
      message: error.message || "Local records remain safely stored on this device.",
      actionLabel: "Close",
      onAction: () => operationFeedback.hide()
    });
  } finally {
    state.syncing = false;
    updateLocalSyncUi();
  }
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
    setStatus(state.pendingCount
      ? "Offline. Showing records stored on this device."
      : "Offline. No local intake records are waiting.");
    els.reloadPublicToday.disabled = false;
    return;
  }

  setStatus("Loading...");
  try {
    const [rows, communities, seaweedTypes, grades] = await Promise.all([
      state.authenticated ? callRpc("ag_public_mawimbi_today_intake") : Promise.resolve([]),
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
    els.todayConnectionStatus.textContent = state.authenticated ? "Live" : "Online";
    els.todayConnectionStatus.className = "status-pill";
    setStatus(state.authenticated
      ? "Loaded."
      : "Showing records saved on this device today.");
  } catch (error) {
    const stillOnline = navigator.onLine;
    state.online = stillOnline;
    state.networkVerified = true;
    state.serverRows = [];
    combineTodayRows();
    renderRows();
    updateLocalSyncUi();
    els.todayConnectionStatus.textContent = stillOnline ? "Server error" : "Offline";
    els.todayConnectionStatus.className = "status-pill status-muted";
    setStatus(stillOnline
      ? `Internet is available, but live intake could not be loaded. ${error.message || "Try again shortly."}`
      : (state.pendingCount
        ? `Offline. Showing ${state.pendingCount} local record(s).`
        : "Device offline. No local intake records are waiting."), "error");
  } finally {
    els.reloadPublicToday.disabled = false;
  }
}

async function refreshLocalRows() {
  if (!state.localReady) return;
  const items = await listOutboxItems();
  const pendingItems = items.filter((item) => item.status !== "synced");
  state.pendingCount = pendingItems.length;
  const visibleTodayItems = state.authenticated ? pendingItems : items;
  state.localRows = visibleTodayItems.map(localItemToRow)
    .filter((row) => isTodayInNairobi(row.collected_at));
  const pendingRows = pendingItems.map(localItemToRow);
  state.olderLocalRows = pendingRows.filter((row) => !isTodayInNairobi(row.collected_at));
  combineTodayRows();
  renderRows();
  updateLocalSyncUi();
}

function localItemToRow(item) {
  const payload = item.payload || {};
  const result = item.result || {};
  const synced = item.status === "synced" && Boolean(result.collection_id);
  return {
    id: synced ? result.collection_id : `local:${item.submissionId}`,
    collected_at: payload.collected_at || item.createdAt,
    farmer_name_snapshot: payload.farmer_name_snapshot || item.summary?.farmer || null,
    sack_weight_kg: payload.sack_weight_kg ?? item.summary?.weightKg ?? null,
    seaweed_type: payload.seaweed_type || null,
    grade_code: payload.grade_code || payload.seaweed_grade || item.summary?.grade || null,
    community_id: payload.community_id || null,
    community_name_snapshot: payload.community_name_snapshot || item.summary?.community || null,
    recorded_by_name: payload.collector_name || item.collectorName || null,
    transaction_id: result.transaction_id || payload.transaction_id || item.summary?.transactionId || null,
    updated_at: result.updated_at || null,
    _localRecord: !synced,
    _deviceRecord: true,
    _submissionId: item.submissionId,
    _syncStatus: item.status || "pending",
    _lastError: item.lastError || null,
    _failureType: item.failureType || null,
    _lastHttpStatus: item.lastHttpStatus || null
  };
}

function combineTodayRows() {
  const serverTransactions = new Set(state.serverRows.map((row) => String(row.transaction_id || "")));
  const localRows = state.localRows.filter((row) => !serverTransactions.has(String(row.transaction_id || "")));
  state.rows = [...localRows, ...state.serverRows]
    .sort((left, right) => String(right.collected_at || "").localeCompare(String(left.collected_at || "")));
}

function updateLocalSyncUi() {
  const count = state.pendingCount;
  const offline = !state.online || !state.networkVerified;
  const syncDisabled = state.syncing || offline || count === 0;
  els.todayPendingRecordsBand.hidden = count === 0;
  els.todaySyncAll.hidden = count === 0;
  els.todaySyncAll.disabled = syncDisabled;
  els.olderPendingSync.disabled = syncDisabled;
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
    const label = row._failureType === "server_rejected" ? "Server rejected" : "Needs attention";
    return `<span class="status-pill offline-status-failed" title="${escapeAttribute(row._lastError || "Sync needs attention")}">${label}</span>`;
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
  if (!state.rows.length) {
    els.publicTodayRows.innerHTML = `<tr><td colspan="10" class="empty-state">${state.authenticated
      ? "No Mawimbi intake has been recorded today."
      : "No collection records have been saved on this device today."}</td></tr>`;
    renderOlderRows();
    updateSelectionUi();
    return;
  }

  els.publicTodayRows.innerHTML = state.rows.map((row) => {
    const id = String(row.id || "");
    const editing = state.editingIds.has(id);
    const dirty = state.dirtyIds.has(id);
    const draft = state.drafts.get(id) || rowDraft(row);
    const local = Boolean(row._localRecord);
    const manageable = canManageRow(row);
    return `
      <tr data-public-today-row="${escapeAttribute(id)}" class="${dirty ? "today-row-dirty" : ""}${local ? " today-row-local" : ""}">
        <td class="today-sync-status-cell">${syncStatusHtml(row)}</td>
        <td class="selection-cell">${manageable ? `<input type="checkbox" data-public-today-select="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "intake row")}"${state.selectedIds.has(id) ? " checked" : ""}${state.editingIds.size ? " disabled" : ""}>` : ""}</td>
        <td>${escapeHtml(formatTime(row.collected_at))}</td>
        <td>${editing ? textControl(id, "farmer_name_snapshot", draft.farmer_name_snapshot, "today-farmer-editor", 150) : escapeHtml(row.farmer_name_snapshot || "-")}</td>
        <td>${editing ? numberControl(id, "sack_weight_kg", draft.sack_weight_kg, 0.01, 0.01) : escapeHtml(formatNumber(row.sack_weight_kg))}</td>
        <td>${editing ? selectControl(id, "seaweed_type", draft.seaweed_type, seaweedTypeOptions(row)) : escapeHtml(titleCase(row.seaweed_type))}</td>
        <td>${editing ? selectControl(id, "grade_code", draft.grade_code, gradeOptions(row)) : escapeHtml(displayGrade(row.grade_code))}</td>
        <td>${editing ? selectControl(id, "community_id", draft.community_id, communityOptions(row)) : escapeHtml(joinValues(row.community_id, row.community_name_snapshot))}</td>
        <td>${editing ? textControl(id, "recorded_by_name", draft.recorded_by_name, "today-collector-editor", 100) : escapeHtml(row.recorded_by_name || "-")}</td>
        <td class="transaction-id-column"><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
      </tr>
    `;
  }).join("");
  renderOlderRows();
  updateSelectionUi();
}

function renderOlderRows() {
  const rows = state.olderLocalRows
    .sort((left, right) => String(right.collected_at || "").localeCompare(String(left.collected_at || "")));
  els.olderPendingPanel.hidden = rows.length === 0;
  els.olderPendingCount.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    els.olderPendingRows.innerHTML = "";
    return;
  }

  els.olderPendingRows.innerHTML = rows.map((row) => {
    const id = String(row.id || "");
    return `
      <tr data-public-today-row="${escapeAttribute(id)}" class="today-row-local">
        <td class="today-sync-status-cell">${syncStatusHtml(row)}</td>
        <td class="selection-cell"><input type="checkbox" data-public-today-select="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "older local record")}"${state.selectedIds.has(id) ? " checked" : ""}${state.editingIds.size ? " disabled" : ""}></td>
        <td>${escapeHtml(formatDateTime(row.collected_at))}</td>
        <td>${escapeHtml(row.farmer_name_snapshot || "-")}</td>
        <td>${escapeHtml(formatNumber(row.sack_weight_kg))}</td>
        <td>${escapeHtml(titleCase(row.seaweed_type))}</td>
        <td>${escapeHtml(displayGrade(row.grade_code))}</td>
        <td>${escapeHtml(joinValues(row.community_id, row.community_name_snapshot))}</td>
        <td>${escapeHtml(row.recorded_by_name || "-")}</td>
        <td class="transaction-id-column"><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
      </tr>
    `;
  }).join("");
}

function handleTableChange(event) {
  const checkbox = event.target.closest("[data-public-today-select]");
  if (checkbox) {
    if (state.editingIds.size) return;
    const id = checkbox.dataset.publicTodaySelect;
    if (checkbox.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    updateSelectionUi();
    const row = rowById(id);
    if (checkbox.checked && row?._failureType === "server_rejected") {
      setStatus(`Supabase rejected this local record: ${friendlyLocalError(row._lastError)}`, "error");
    }
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
    state.rows.filter(canManageRow).forEach((row) => state.selectedIds.add(String(row.id)));
  }
  renderRows();
}

function toggleOlderRows() {
  if (state.editingIds.size) return;
  state.olderLocalRows.forEach((row) => state.selectedIds.delete(String(row.id || "")));
  if (els.olderPendingSelectAll.checked) {
    state.olderLocalRows.forEach((row) => state.selectedIds.add(String(row.id || "")));
  }
  renderRows();
}

function startEdit() {
  const editableIds = [...state.selectedIds].filter((id) => canEditRow(rowById(id)));
  if (!editableIds.length) return;
  state.editingIds = new Set(editableIds);
  state.dirtyIds.clear();
  state.drafts.clear();
  state.rows.forEach((row) => {
    const id = String(row.id || "");
    if (state.editingIds.has(id)) state.drafts.set(id, rowDraft(row));
  });
  renderRows();
  setStatus(`Editing ${state.editingIds.size} selected row${state.editingIds.size === 1 ? "" : "s"}.`);
}

async function deleteSelectedRecords() {
  if (state.syncing || state.editingIds.size) return;
  const selectedRows = [...state.selectedIds].map(rowById).filter(Boolean);
  if (!selectedRows.length) return;
  const localRows = selectedRows.filter((row) => row._localRecord);
  const serverRows = selectedRows.filter((row) => !row._localRecord);
  const editorName = serverRows.length ? rememberEditorName() : "";
  if (serverRows.length && editorName.length < 2) {
    setStatus("Enter your name before deleting a synced record.", "error");
    els.todayEditorName.focus();
    return;
  }

  const count = selectedRows.length;
  const locations = [
    serverRows.length ? `${serverRows.length} synced` : "",
    localRows.length ? `${localRows.length} stored locally` : ""
  ].filter(Boolean).join(" and ");
  const confirmed = window.confirm(
    `Delete ${count} selected record${count === 1 ? "" : "s"} (${locations})?\n\n`
      + "This permanently removes the selected intake data and cannot be undone."
  );
  if (!confirmed) return;

  els.publicTodayDeleteSelected.disabled = true;
  setStatus(`Deleting ${count} selected record${count === 1 ? "" : "s"}...`);
  try {
    if (serverRows.length) {
      const result = await submitPublicIntakeDeletes(editorName, serverRows.map((row) => ({
        id: row.id,
        expected_updated_at: row.updated_at || undefined,
        submission_id: !state.authenticated ? row._submissionId : undefined
      })));
      if (Number(result?.deleted_count || 0) !== serverRows.length) {
        throw new Error("Supabase did not confirm every selected deletion. Reload before trying again.");
      }
    }
    for (const row of selectedRows.filter((row) => row._submissionId)) {
      await deleteOutboxItem(row._submissionId);
    }
    resetEditState();
    await loadToday();
    setStatus(`Deleted ${count} selected record${count === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(error.message || "The selected records could not be deleted.", "error");
  } finally {
    els.publicTodayDeleteSelected.disabled = false;
  }
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
    await persistDeviceEdits(updates, result);
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
  return submitPublicIntakeChange({ editor_name: editorName, updates });
}

async function submitPublicIntakeDeletes(editorName, deletions) {
  return submitPublicIntakeChange({ editor_name: editorName, deletions });
}

async function submitPublicIntakeChange(body) {
  const response = await fetch(`${APP_CONFIG.supabase.url}/functions/v1/public-intake`, {
    method: "POST",
    headers: {
      apikey: APP_CONFIG.supabase.anonKey,
      Authorization: `Bearer ${state.accessToken || APP_CONFIG.supabase.anonKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Could not save changes (${response.status}).`);
  return payload.result || {};
}

async function persistDeviceEdits(updates, result) {
  const resultRows = new Map((Array.isArray(result?.rows) ? result.rows : [])
    .map((row) => [String(row.id || ""), row]));
  for (const update of updates) {
    const row = rowById(update.id);
    if (!row?._submissionId) continue;
    const item = await getOutboxItem(row._submissionId);
    if (!item) continue;
    const payload = { ...(item.payload || {}) };
    Object.entries(update).forEach(([field, value]) => {
      if (["id", "expected_updated_at", "submission_id"].includes(field)) return;
      if (field === "recorded_by_name") payload.collector_name = value;
      else payload[field] = value;
    });
    const community = state.communities.find((candidate) => candidate.community_id === payload.community_id);
    if (community) payload.community_name_snapshot = community.community_name;
    const confirmed = resultRows.get(String(update.id || ""));
    await updateOutboxItem(row._submissionId, {
      payload,
      collectorName: payload.collector_name || item.collectorName,
      result: {
        ...(item.result || {}),
        updated_at: confirmed?.updated_at || item.result?.updated_at || null
      },
      summary: {
        ...(item.summary || {}),
        farmer: payload.farmer_name_snapshot || null,
        community: payload.community_name_snapshot || payload.community_id || null,
        weightKg: payload.sack_weight_kg ?? null,
        grade: payload.grade_code || null
      }
    });
  }
}

function canManageRow(row) {
  if (!row) return false;
  if (row._localRecord) return true;
  if (state.authenticated) return state.canEditCollections;
  return Boolean(row._deviceRecord && row._submissionId);
}

function canEditRow(row) {
  return Boolean(row && !row._localRecord && canManageRow(row));
}

function updatePayload(id) {
  const row = rowById(id);
  const draft = state.drafts.get(id);
  if (!row || !draft) return null;
  const original = rowDraft(row);
  const payload = { id, expected_updated_at: row.updated_at || undefined };
  let changed = false;
  Object.keys(original).forEach((field) => {
    if (normaliseValue(field, draft[field]) === normaliseValue(field, original[field])) return;
    payload[field] = field === "sack_weight_kg" ? optionalNumber(draft[field]) : nullableText(draft[field]);
    changed = true;
  });
  if (!changed) return null;
  if (!state.authenticated && row._submissionId) payload.submission_id = row._submissionId;
  return payload;
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
  const availableIds = new Set(
    [...state.rows, ...state.olderLocalRows].map((row) => String(row.id || ""))
  );
  [...state.selectedIds].forEach((id) => {
    if (!availableIds.has(String(id))) state.selectedIds.delete(id);
  });
  const selected = state.selectedIds.size;
  const editing = state.editingIds.size > 0;
  const dirty = state.dirtyIds.size;
  const selectedRows = [...state.selectedIds].map(rowById).filter(Boolean);
  const editableCount = selectedRows.filter(canEditRow).length;
  const selectableRows = state.rows.filter(canManageRow);
  const selectableCount = selectableRows.length;
  const currentIds = new Set(selectableRows.map((row) => String(row.id || "")));
  const currentSelected = [...state.selectedIds].filter((id) => currentIds.has(String(id))).length;
  const olderIds = new Set(state.olderLocalRows.map((row) => String(row.id || "")));
  const olderSelected = [...state.selectedIds].filter((id) => olderIds.has(String(id))).length;
  els.publicTodayEditActions.hidden = currentSelected === 0;
  els.publicTodaySelectedCount.textContent = `${selected} selected`;
  els.publicTodayStartEdit.hidden = editing || editableCount === 0;
  els.publicTodayStartEdit.textContent = editableCount > 1 ? `Edit ${editableCount}` : "Edit";
  els.publicTodayDeleteSelected.hidden = editing || selected === 0;
  els.publicTodayDeleteSelected.textContent = selected > 1 ? `Delete ${selected}` : "Delete selected";
  els.publicTodaySaveEdits.hidden = !editing;
  els.publicTodaySaveEdits.disabled = dirty === 0;
  els.publicTodaySaveEdits.textContent = dirty ? `Save ${dirty}` : "Save";
  els.publicTodayDiscardEdits.hidden = !editing;
  els.reloadPublicToday.disabled = editing;
  els.todayEditorName.disabled = editing;
  els.publicTodaySelectAll.checked = selectableCount > 0 && currentSelected === selectableCount;
  els.publicTodaySelectAll.indeterminate = currentSelected > 0 && currentSelected < selectableCount;
  els.publicTodaySelectAll.disabled = editing || selectableCount === 0;
  els.olderPendingActions.hidden = olderSelected === 0;
  els.olderPendingSelectedCount.textContent = `${olderSelected} selected`;
  els.olderPendingDelete.textContent = olderSelected > 1 ? `Delete ${olderSelected}` : "Delete selected";
  els.olderPendingDelete.disabled = editing || state.syncing;
  els.olderPendingSelectAll.checked = state.olderLocalRows.length > 0 && olderSelected === state.olderLocalRows.length;
  els.olderPendingSelectAll.indeterminate = olderSelected > 0 && olderSelected < state.olderLocalRows.length;
  els.olderPendingSelectAll.disabled = editing || state.olderLocalRows.length === 0;
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
    grade_code: valueOrEmpty(row.grade_code || "UNGRADED"),
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
  return withFallback([...state.grades.map((grade) => [
    grade.grade,
    joinValues(grade.grade, grade.label && grade.label !== grade.grade ? grade.label : "", grade.rejected ? "Rejected" : "")
  ]), ["UNGRADED", "Ungraded - no payment"]], row.grade_code, displayGrade(row.grade_code));
}

function displayGrade(value) {
  return String(value || "").toUpperCase() === "UNGRADED" || !value ? "Ungraded" : value;
}

function friendlyLocalError(message) {
  const text = String(message || "").trim();
  if (/no active price/i.test(text)) return "Select a valid grade when entering the collection again.";
  if (/select a grade|grade is required/i.test(text)) return "No grade was selected.";
  return text || "The server did not accept this record.";
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
  return [...state.rows, ...state.olderLocalRows]
    .find((row) => String(row.id || "") === String(id)) || null;
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

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
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
