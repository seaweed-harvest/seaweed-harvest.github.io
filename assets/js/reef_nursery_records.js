import { authClient, requireAggregatorAccess } from "./auth_client.js?v=23";

const PAGE_SIZE = 50;
const state = {
  rows: [],
  selected: new Set(),
  search: "",
  sort: "training_date",
  direction: "desc",
  page: 0,
  total: 0
};
const els = {};
let recordsRoot = document;
let editHandler = null;
let initialized = false;

const LOCATION_LABELS = {
  mkwiro: "Mkwiro",
  offshore_nursery: "Offshore nursery site",
  shoreline_preparation: "Shoreline preparation area"
};
const SESSION_TYPE_LABELS = {
  general_in_water_training: "General in-water training",
  seeding: "Seeding",
  harvesting: "Harvesting",
  line_inspection_maintenance: "Line inspection and maintenance",
  mooring_inspection_maintenance: "Mooring inspection and maintenance",
  nursery_deployment_recovery: "Nursery deployment / recovery",
  other: "Other",
  nursery_deployment: "Nursery deployment",
  boat_water_safety: "Boat and water safety",
  refresher_training: "Refresher training"
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("reef-nursery-records-page")) {
    initReefNurseryRecords().catch((error) => setStatus(error.message, "error"));
  }
});

export async function initReefNurseryRecords(options = {}) {
  if (initialized) return { reload: loadRecords };
  initialized = true;
  recordsRoot = options.root || document;
  editHandler = typeof options.onEdit === "function" ? options.onEdit : null;
  [
    "reefRecordsCount", "reefRecordsSearch", "reefRecordsLoad",
    "reefRecordsSelectionActions", "reefRecordsSelectedCount", "editReefRecord",
    "deleteReefRecords", "reefRecordsStatus", "selectAllReefRecords",
    "reefRecordsRows", "previousReefRecords", "reefRecordsPage", "nextReefRecords"
  ].forEach((id) => { els[id] = recordsRoot.querySelector(`#${id}`); });

  if (!els.reefRecordsRows) {
    initialized = false;
    return null;
  }

  els.reefRecordsLoad.addEventListener("click", searchRecords);
  els.reefRecordsSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchRecords();
  });
  els.selectAllReefRecords.addEventListener("change", selectAllVisible);
  els.reefRecordsRows.addEventListener("change", changeSelection);
  els.editReefRecord.addEventListener("click", editSelectedRecord);
  els.deleteReefRecords.addEventListener("click", deleteSelectedRecords);
  els.previousReefRecords.addEventListener("click", () => changePage(-1));
  els.nextReefRecords.addEventListener("click", () => changePage(1));
  recordsRoot.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => changeSort(button.dataset.sort));
  });

  const access = options.access || await requireAggregatorAccess(
      "COSME",
      "can_access_reef_nursery",
      "reef_nursery_records.html"
    );
  if (!access) return;
  await loadRecords();
  return { reload: loadRecords };
}

async function loadRecords() {
  setStatus("Loading records...");
  setLoading(true);
  const { data, error } = await authClient.rpc("ag_reef_nursery_records", {
    p_search: state.search || null,
    p_sort: state.sort,
    p_direction: state.direction,
    p_limit: PAGE_SIZE,
    p_offset: state.page * PAGE_SIZE
  });
  setLoading(false);
  if (error) {
    state.rows = [];
    state.total = 0;
    renderRows();
    setStatus(error.message || "Reef Nursery records could not be loaded.", "error");
    return;
  }
  state.rows = Array.isArray(data) ? data : [];
  state.total = Number(state.rows[0]?.total_count || 0);
  if (state.page > 0 && !state.rows.length && state.total > 0) {
    state.page = Math.max(0, Math.ceil(state.total / PAGE_SIZE) - 1);
    await loadRecords();
    return;
  }
  state.selected.clear();
  renderRows();
  setStatus("");
}

function renderRows() {
  els.reefRecordsRows.replaceChildren();
  if (!state.rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="reef-records-empty" colspan="6">No Reef Nursery records found.</td>';
    els.reefRecordsRows.append(row);
  } else {
    state.rows.forEach((record) => {
      const row = document.createElement("tr");
      row.dataset.sessionId = record.session_id;
      row.innerHTML = `
        <td class="reef-select-column"><input type="checkbox" data-select-record value="${escapeHtml(record.session_id)}" aria-label="Select ${escapeHtml(record.record_number)}"></td>
        <td data-label="Record"><strong>${escapeHtml(record.record_number)}</strong></td>
        <td data-label="Date">${escapeHtml(formatDate(record.training_date))}</td>
        <td data-label="Trainer">${escapeHtml(record.trainer_name || "-")}</td>
        <td data-label="Location">${escapeHtml(LOCATION_LABELS[record.location] || record.location || "-")}</td>
        <td data-label="Session">${escapeHtml(formatSessionTypes(record.session_types))}</td>`;
      els.reefRecordsRows.append(row);
    });
  }
  updateSelectionActions();
  updateSortIndicators();
  const start = state.total ? state.page * PAGE_SIZE + 1 : 0;
  const end = Math.min((state.page + 1) * PAGE_SIZE, state.total);
  els.reefRecordsCount.textContent = `${state.total} ${state.total === 1 ? "record" : "records"}`;
  els.reefRecordsPage.textContent = state.total ? `${start}-${end} of ${state.total}` : "0 records";
  els.previousReefRecords.disabled = state.page === 0;
  els.nextReefRecords.disabled = end >= state.total;
}

function searchRecords() {
  state.search = els.reefRecordsSearch.value.trim();
  state.page = 0;
  loadRecords();
}

function changeSort(sort) {
  if (state.sort === sort) state.direction = state.direction === "asc" ? "desc" : "asc";
  else {
    state.sort = sort;
    state.direction = sort === "training_date" || sort === "record_number" ? "desc" : "asc";
  }
  state.page = 0;
  loadRecords();
}

function updateSortIndicators() {
  recordsRoot.querySelectorAll("[data-sort]").forEach((button) => {
    const active = button.dataset.sort === state.sort;
    button.parentElement.setAttribute("aria-sort", active
      ? (state.direction === "asc" ? "ascending" : "descending")
      : "none");
    const indicator = button.querySelector("span");
    if (indicator) indicator.textContent = active ? (state.direction === "asc" ? "▲" : "▼") : "";
  });
}

function selectAllVisible() {
  state.rows.forEach((record) => {
    if (els.selectAllReefRecords.checked) state.selected.add(record.session_id);
    else state.selected.delete(record.session_id);
  });
  els.reefRecordsRows.querySelectorAll("[data-select-record]").forEach((checkbox) => {
    checkbox.checked = els.selectAllReefRecords.checked;
  });
  updateSelectionActions();
}

function changeSelection(event) {
  const checkbox = event.target.closest("[data-select-record]");
  if (!checkbox) return;
  if (checkbox.checked) state.selected.add(checkbox.value);
  else state.selected.delete(checkbox.value);
  updateSelectionActions();
}

function updateSelectionActions() {
  const count = state.selected.size;
  els.reefRecordsSelectionActions.hidden = count === 0;
  els.reefRecordsSelectedCount.textContent = `${count} selected`;
  els.editReefRecord.disabled = count !== 1;
  const visibleIds = state.rows.map((record) => record.session_id);
  const selectedVisible = visibleIds.filter((id) => state.selected.has(id)).length;
  els.selectAllReefRecords.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  els.selectAllReefRecords.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
}

async function editSelectedRecord() {
  if (state.selected.size !== 1) return;
  const [sessionId] = state.selected;
  if (editHandler) {
    await editHandler(sessionId);
    return;
  }
  window.location.href = `./reef_nursery.html?record=${encodeURIComponent(sessionId)}`;
}

async function deleteSelectedRecords() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const label = ids.length === 1 ? "this Reef Nursery record" : `these ${ids.length} Reef Nursery records`;
  if (!window.confirm(`Delete ${label}? This action will be recorded.`)) return;
  els.deleteReefRecords.disabled = true;
  els.editReefRecord.disabled = true;
  setStatus("Deleting selected records...");
  const { data, error } = await authClient.rpc("ag_delete_reef_nursery_sessions", { p_session_ids: ids });
  els.deleteReefRecords.disabled = false;
  if (error) {
    setStatus(error.message || "The selected records could not be deleted.", "error");
    updateSelectionActions();
    return;
  }
  const deleted = Number(data?.deleted_count || ids.length);
  state.selected.clear();
  await loadRecords();
  setStatus(`${deleted} ${deleted === 1 ? "record" : "records"} deleted.`);
}

function changePage(direction) {
  const nextPage = state.page + direction;
  if (nextPage < 0 || nextPage * PAGE_SIZE >= state.total) return;
  state.page = nextPage;
  loadRecords();
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function formatSessionTypes(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (String(value).startsWith("other:")) return `Other: ${String(value).slice(6)}`;
      return SESSION_TYPE_LABELS[value] || value;
    })
    .join(", ");
}

function setLoading(loading) {
  els.reefRecordsLoad.disabled = loading;
  els.previousReefRecords.disabled = loading || state.page === 0;
  els.nextReefRecords.disabled = loading || (state.page + 1) * PAGE_SIZE >= state.total;
}

function setStatus(message, kind = "") {
  els.reefRecordsStatus.textContent = message;
  if (kind) els.reefRecordsStatus.dataset.status = kind;
  else delete els.reefRecordsStatus.dataset.status;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
