import { APP_CONFIG } from "./config.js";
import { callPublicRpc, selectRows } from "./supabase_client.js";
import { currentProfile, currentSession, setupAccountControls } from "./auth_client.js";

const COLLECTOR_NAME_STORAGE_KEY = "seaweed_harvest:collector_name";
const state = {
  rows: [],
  communities: [],
  seaweedTypes: [],
  grades: [],
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
    "publicTodayCount",
    "reloadPublicToday",
    "publicTodayEditActions",
    "publicTodaySelectedCount",
    "publicTodayStartEdit",
    "publicTodaySaveEdits",
    "publicTodayDiscardEdits",
    "publicTodaySelectAll",
    "publicTodayRows",
    "publicTodayStatus"
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

  await setupOptionalAccount();
  await loadToday();
}

async function setupOptionalAccount() {
  try {
    const session = await currentSession();
    if (!session) return;
    const profile = await currentProfile(true);
    if (!profile) return;

    els.todaySignInLink.hidden = true;
    els.todayAdminLink.hidden = !(profile.account_status === "active"
      && (profile.app_role === "system_admin" || profile.can_access_admin));
    setupAccountControls(profile, {
      returnPage: "today.html",
      signOutReturn: "./today.html",
      showAggregator: false
    });
  } catch {
    // Today's Intake remains public when an old or invalid session is stored.
  }
}

async function loadToday() {
  els.reloadPublicToday.disabled = true;
  setStatus("Loading...");
  resetEditState();
  try {
    const [rows, communities, seaweedTypes, grades] = await Promise.all([
      callPublicRpc("ag_public_mawimbi_today_intake"),
      callPublicRpc("ag_public_mawimbi_communities"),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc")
    ]);
    state.rows = Array.isArray(rows) ? rows : [];
    state.communities = Array.isArray(communities) ? communities : [];
    state.seaweedTypes = Array.isArray(seaweedTypes) ? seaweedTypes : [];
    state.grades = Array.isArray(grades) ? grades : [];
    renderRows();
    els.todayConnectionStatus.textContent = "Live";
    els.todayConnectionStatus.className = "status-pill";
    setStatus("Loaded.");
  } catch (error) {
    state.rows = [];
    renderRows();
    els.todayConnectionStatus.textContent = "Error";
    els.todayConnectionStatus.className = "status-pill status-muted";
    setStatus(error.message, "error");
  } finally {
    els.reloadPublicToday.disabled = false;
  }
}

function renderRows() {
  els.publicTodayCount.textContent = `${state.rows.length} row${state.rows.length === 1 ? "" : "s"}`;
  if (!state.rows.length) {
    els.publicTodayRows.innerHTML = '<tr><td colspan="9" class="empty-state">No Mawimbi intake has been recorded today.</td></tr>';
    updateSelectionUi();
    return;
  }

  els.publicTodayRows.innerHTML = state.rows.map((row) => {
    const id = String(row.id || "");
    const editing = state.editingIds.has(id);
    const dirty = state.dirtyIds.has(id);
    const draft = state.drafts.get(id) || rowDraft(row);
    return `
      <tr data-public-today-row="${escapeAttribute(id)}" class="${dirty ? "today-row-dirty" : ""}">
        <td class="selection-cell"><input type="checkbox" data-public-today-select="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "intake row")}"${state.selectedIds.has(id) ? " checked" : ""}${state.editingIds.size ? " disabled" : ""}></td>
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
    state.rows.forEach((row) => state.selectedIds.add(String(row.id)));
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
  els.publicTodaySelectAll.checked = state.rows.length > 0 && selected === state.rows.length;
  els.publicTodaySelectAll.indeterminate = selected > 0 && selected < state.rows.length;
  els.publicTodaySelectAll.disabled = editing || state.rows.length === 0;
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
