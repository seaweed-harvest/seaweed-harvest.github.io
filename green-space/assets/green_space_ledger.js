import {
  loadAdminLedger,
  manageLedgerRecord,
  publicPhotoUrl
} from "./green_space_api.js?v=5";
import {
  authClient,
  currentProfile,
  currentSession,
  signOut
} from "../../assets/js/auth_client.js?v=25";

const state = {
  rows: [],
  filtered: [],
  selected: new Set(),
  currentEdit: null,
  page: 1,
  pageSize: 50,
  sortKey: "date",
  sortDirection: "desc",
  busy: false,
  accessToken: null,
  profile: null
};

const els = {
  search: document.getElementById("girlsLedgerSearch"),
  type: document.getElementById("girlsLedgerType"),
  week: document.getElementById("girlsLedgerWeek"),
  export: document.getElementById("girlsExportLedger"),
  count: document.getElementById("girlsLedgerCount"),
  rows: document.getElementById("girlsLedgerRows"),
  status: document.getElementById("girlsLedgerStatus"),
  previous: document.getElementById("girlsLedgerPrevious"),
  next: document.getElementById("girlsLedgerNext"),
  pageStatus: document.getElementById("girlsLedgerPageStatus"),
  selectVisible: document.getElementById("girlsSelectVisible"),
  selectionToolbar: document.getElementById("girlsLedgerSelectionToolbar"),
  selectionCount: document.getElementById("girlsLedgerSelectionCount"),
  editSelected: document.getElementById("girlsEditSelected"),
  publishSelected: document.getElementById("girlsPublishSelected"),
  unpublishSelected: document.getElementById("girlsUnpublishSelected"),
  deleteSelected: document.getElementById("girlsDeleteSelected"),
  dialog: document.getElementById("girlsEntryDialog"),
  close: document.getElementById("girlsCloseEntry"),
  entryType: document.getElementById("girlsEntryType"),
  title: document.getElementById("girlsEntryTitle"),
  meta: document.getElementById("girlsEntryMeta"),
  photo: document.getElementById("girlsEntryPhoto"),
  content: document.getElementById("girlsEntryContent"),
  editDialog: document.getElementById("girlsEditDialog"),
  editForm: document.getElementById("girlsEditForm"),
  editTitle: document.getElementById("girlsEditTitle"),
  editFields: document.getElementById("girlsEditFields"),
  editStatus: document.getElementById("girlsEditStatus"),
  closeEdit: document.getElementById("girlsCloseEdit"),
  cancelEdit: document.getElementById("girlsCancelEdit"),
  account: document.getElementById("girlsLedgerAccount"),
  accountName: document.getElementById("girlsLedgerAccountName"),
  signOut: document.getElementById("girlsLedgerSignOut")
};

document.addEventListener("DOMContentLoaded", initialise, { once: true });

async function initialise() {
  if (window.matchMedia("(max-width: 760px)").matches) {
    window.location.replace("./");
    return;
  }
  const access = await requireLedgerAccess();
  if (!access) return;
  state.accessToken = access.session.access_token;
  state.profile = access.profile;
  els.accountName.textContent = access.profile.display_name || access.profile.email || "Teacher";
  els.account.hidden = false;
  els.signOut.addEventListener("click", signOutOfLedger);
  document.body.removeAttribute("data-auth-pending");
  [els.search, els.type, els.week].forEach((control) => control.addEventListener("input", applyFilters));
  els.export.addEventListener("click", exportCsv);
  els.previous.addEventListener("click", () => changePage(-1));
  els.next.addEventListener("click", () => changePage(1));
  els.selectVisible.addEventListener("change", selectVisibleRows);
  els.editSelected.addEventListener("click", editSelectedRow);
  els.publishSelected.addEventListener("click", () => setSelectedPublication(true));
  els.unpublishSelected.addEventListener("click", () => setSelectedPublication(false));
  els.deleteSelected.addEventListener("click", deleteSelectedRows);
  document.querySelectorAll("[data-ledger-sort]").forEach((button) => {
    button.addEventListener("click", () => changeSort(button.dataset.ledgerSort));
  });
  els.rows.addEventListener("click", handleRowAction);
  els.rows.addEventListener("keydown", handleRowAction);
  els.close.addEventListener("click", closeDialog);
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) closeDialog();
  });
  els.closeEdit.addEventListener("click", closeEditDialog);
  els.cancelEdit.addEventListener("click", closeEditDialog);
  els.editDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeEditDialog();
  });
  els.editForm.addEventListener("submit", saveEditedRow);
  await reloadLedger();
}

async function reloadLedger(message = "") {
  setBusy(true);
  els.status.textContent = message || "Loading entries...";
  try {
    const rows = await loadAdminLedger(state.accessToken);
    state.rows = rows.map((row) => ({
      ...row,
      cover_photo_path: row.cover_photo_path || null
    }));
    state.selected.clear();
    applyFilters();
    els.status.textContent = message || "Select a row to read it, or use the checkbox to manage it.";
  } catch (error) {
    els.rows.innerHTML = `<tr><td colspan="10">${escapeHtml(error.message)}</td></tr>`;
    els.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function applyFilters() {
  const query = clean(els.search.value).toLowerCase();
  const type = els.type.value;
  const week = els.week.value;
  state.filtered = state.rows.filter((row) => {
    if (type && row.entry_type !== type) return false;
    if (week && String(row.week_number || "") !== week) return false;
    if (!query) return true;
    return [
      row.participant_name,
      row.green_space_name,
      row.public_code,
      previewText(row),
      row.location_description
    ].some((value) => clean(value).toLowerCase().includes(query));
  }).sort(compareRows);
  state.page = 1;
  renderRows();
}

function renderRows() {
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = state.filtered.slice(start, start + state.pageSize);
  els.count.textContent = `${state.filtered.length} ${state.filtered.length === 1 ? "entry" : "entries"}`;
  els.export.disabled = !state.filtered.length;
  els.previous.disabled = state.page <= 1;
  els.next.disabled = state.page >= pageCount;
  els.pageStatus.textContent = state.filtered.length
    ? `Rows ${start + 1}-${Math.min(start + state.pageSize, state.filtered.length)} of ${state.filtered.length}`
    : "No rows";
  els.rows.innerHTML = pageRows.map((row, index) => {
    const selected = state.selected.has(row.id);
    return `
      <tr class="${selected ? "is-selected" : ""}" tabindex="0" data-row-index="${start + index}" data-record-id="${escapeAttribute(row.id)}" aria-label="Open ${escapeAttribute(entryLabel(row.entry_type))} for ${escapeAttribute(row.green_space_name)}">
        <td class="girls-select-column">
          <input type="checkbox" data-select-record="${escapeAttribute(row.id)}" aria-label="Select ${escapeAttribute(entryLabel(row.entry_type))} for ${escapeAttribute(row.green_space_name)}" ${selected ? "checked" : ""} ${row.can_manage ? "" : "disabled"}>
        </td>
        <td>${escapeHtml(formatDate(row.observed_on || row.created_at))}</td>
        <td>${escapeHtml(row.participant_name)}</td>
        <td><strong>${escapeHtml(row.green_space_name)}</strong></td>
        <td>${escapeHtml(entryLabel(row.entry_type))}</td>
        <td>${row.week_number ? `Week ${escapeHtml(row.week_number)}` : "-"}</td>
        <td>${escapeHtml(timeRange(row))}</td>
        <td>${displayPhotoPath(row) ? photoIndicator() : "-"}</td>
        <td><span class="girls-publication-status ${row.is_published ? "" : "is-unpublished"}">${row.is_published ? "Published" : "Unpublished"}</span></td>
        <td>${escapeHtml(previewText(row))}</td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="10">No entries match these filters.</td></tr>';
  syncSelectVisible(pageRows);
  renderSelectionToolbar();
  renderSortState();
}

function currentPageRows() {
  const start = (state.page - 1) * state.pageSize;
  return state.filtered.slice(start, start + state.pageSize);
}

function selectVisibleRows() {
  const rows = currentPageRows().filter((row) => row.can_manage);
  rows.forEach((row) => {
    if (els.selectVisible.checked) state.selected.add(row.id);
    else state.selected.delete(row.id);
  });
  renderRows();
}

function syncSelectVisible(pageRows) {
  const manageable = pageRows.filter((row) => row.can_manage);
  const selectedCount = manageable.filter((row) => state.selected.has(row.id)).length;
  els.selectVisible.disabled = !manageable.length || state.busy;
  els.selectVisible.checked = Boolean(manageable.length) && selectedCount === manageable.length;
  els.selectVisible.indeterminate = selectedCount > 0 && selectedCount < manageable.length;
}

function handleRowAction(event) {
  const checkbox = event.target.closest("[data-select-record]");
  if (checkbox) {
    if (event.type === "keydown") return;
    event.stopPropagation();
    if (checkbox.checked) state.selected.add(checkbox.dataset.selectRecord);
    else state.selected.delete(checkbox.dataset.selectRecord);
    renderRows();
    return;
  }
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const rowElement = event.target.closest("[data-row-index]");
  if (!rowElement) return;
  event.preventDefault();
  const row = state.filtered[Number(rowElement.dataset.rowIndex)];
  if (row) openDialog(row);
}

function selectedRows() {
  return state.rows.filter((row) => state.selected.has(row.id) && row.can_manage);
}

function renderSelectionToolbar() {
  const rows = selectedRows();
  els.selectionToolbar.hidden = !rows.length;
  els.selectionCount.textContent = `${rows.length} selected`;
  const editable = rows.length === 1;
  els.editSelected.disabled = !editable || state.busy;
  els.publishSelected.disabled = state.busy || rows.every((row) => row.is_published);
  els.unpublishSelected.disabled = state.busy || rows.every((row) => !row.is_published);
  els.deleteSelected.disabled = state.busy;
}

function editSelectedRow() {
  const rows = selectedRows();
  if (rows.length !== 1) return;
  openEditDialog(rows[0]);
}

function openEditDialog(row) {
  state.currentEdit = row;
  els.editTitle.textContent = `${entryLabel(row.entry_type)} - ${row.green_space_name}`;
  els.editStatus.textContent = "";
  els.editFields.innerHTML = editFields(row).map(fieldHtml).join("");
  if (typeof els.editDialog.showModal === "function") els.editDialog.showModal();
  else els.editDialog.setAttribute("open", "");
}

function editFields(row) {
  if (row.entry_type === "project") {
    return [
      field("participant_name", "Name or initials", row.participant_name),
      field("green_space_name", "Green-space name", row.green_space_name),
      field("intentions", "Intentions", row.intentions, "textarea", true),
      field("location_description", "Location and description", row.location_description, "textarea", true),
      field("visit_schedule", "Visit schedule", row.visit_schedule, "text", true),
      field("gps", "GPS coordinates", coordinatePair(row), "text", true)
    ];
  }
  if (row.entry_type === "observation") {
    return [
      field("week_number", "Week", row.week_number, "week"),
      field("observed_on", "Date", row.observed_on, "date"),
      field("start_time", "Time", String(row.start_time || "").slice(0, 5), "time"),
      field("observations", "Observation", row.observations, "textarea", true)
    ];
  }
  if (row.entry_type === "weekly_reflection") {
    return [
      field("week_number", "Week", row.week_number, "week"),
      field("weekly_reflection", "Weekly distillation", row.weekly_reflection, "textarea", true),
      field("haiku", "Haiku", row.haiku, "textarea", true)
    ];
  }
  return [
    field("favourite_haiku", "Favourite haiku", row.favourite_haiku, "textarea", true),
    field("synthesis", "Synthesis of observations", row.synthesis, "textarea", true),
    field("key_learnings", "Key learnings", row.key_learnings, "textarea", true),
    field("overall_reflection", "Overall reflection", row.overall_reflection, "textarea", true)
  ];
}

function field(name, label, value, type = "text", wide = false) {
  return { name, label, value: value ?? "", type, wide };
}

function fieldHtml(item) {
  const classes = `girls-field${item.wide ? " is-wide" : ""}`;
  if (item.type === "textarea") {
    return `<label class="${classes}"><span>${escapeHtml(item.label)}</span><textarea name="${escapeAttribute(item.name)}" rows="4">${escapeHtml(item.value)}</textarea></label>`;
  }
  if (item.type === "week") {
    const options = Array.from({ length: 7 }, (_, index) => index + 1)
      .map((week) => `<option value="${week}" ${Number(item.value) === week ? "selected" : ""}>Week ${week}</option>`)
      .join("");
    return `<label class="${classes}"><span>${escapeHtml(item.label)}</span><select name="${escapeAttribute(item.name)}">${options}</select></label>`;
  }
  return `<label class="${classes}"><span>${escapeHtml(item.label)}</span><input name="${escapeAttribute(item.name)}" type="${escapeAttribute(item.type)}" value="${escapeAttribute(item.value)}"></label>`;
}

async function saveEditedRow(event) {
  event.preventDefault();
  const row = state.currentEdit;
  if (!row || state.busy) return;
  const data = Object.fromEntries(new FormData(els.editForm).entries());
  if (row.entry_type === "project") {
    const coordinates = parseCoordinates(data.gps);
    data.latitude = coordinates.latitude;
    data.longitude = coordinates.longitude;
    delete data.gps;
  }
  setBusy(true);
  els.editStatus.textContent = "Saving changes...";
  try {
    await manageLedgerRecord({
      action: "record_update",
      accessToken: state.accessToken,
      greenSpaceId: row.green_space_id,
      recordId: row.id,
      recordType: row.entry_type,
      changes: data
    });
    closeEditDialog();
    await reloadLedger("Changes saved.");
  } catch (error) {
    els.editStatus.textContent = error.message || "The changes could not be saved.";
    els.editStatus.classList.add("is-error");
  } finally {
    setBusy(false);
  }
}

async function setSelectedPublication(isPublished) {
  const rows = selectedRows().filter((row) => row.is_published !== isPublished);
  if (!rows.length || state.busy) return;
  setBusy(true);
  els.status.textContent = isPublished ? "Publishing selected records..." : "Unpublishing selected records...";
  try {
    for (const row of rows) {
      await manageLedgerRecord({
        action: "record_publish",
        accessToken: state.accessToken,
        greenSpaceId: row.green_space_id,
        recordId: row.id,
        recordType: row.entry_type,
        isPublished
      });
    }
    await reloadLedger(isPublished ? "Selected records published." : "Selected records unpublished.");
  } catch (error) {
    els.status.textContent = error.message || "The publication status could not be changed.";
  } finally {
    setBusy(false);
  }
}

async function deleteSelectedRows() {
  const rows = selectedRows();
  if (!rows.length || state.busy) return;
  const projects = rows.filter((row) => row.entry_type === "project").length;
  const warning = projects
    ? `Delete ${rows.length} selected record${rows.length === 1 ? "" : "s"}?\n\nDeleting a Project Start also deletes all of that project's observations, reflections and photos.`
    : `Delete ${rows.length} selected record${rows.length === 1 ? "" : "s"}? This cannot be undone.`;
  if (!window.confirm(warning)) return;
  setBusy(true);
  els.status.textContent = "Deleting selected records...";
  try {
    const ordered = [...rows].sort((first, second) => (
      Number(first.entry_type === "project") - Number(second.entry_type === "project")
    ));
    const deletedProjects = new Set();
    for (const row of ordered) {
      if (deletedProjects.has(row.green_space_id)) continue;
      await manageLedgerRecord({
        action: "record_delete",
        accessToken: state.accessToken,
        greenSpaceId: row.green_space_id,
        recordId: row.id,
        recordType: row.entry_type
      });
      if (row.entry_type === "project") deletedProjects.add(row.green_space_id);
    }
    await reloadLedger("Selected records deleted.");
  } catch (error) {
    els.status.textContent = error.message || "The selected records could not be deleted.";
  } finally {
    setBusy(false);
  }
}

function parseCoordinates(value) {
  const parts = clean(value).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("Enter GPS as latitude, longitude.");
  }
  return { latitude: parts[0], longitude: parts[1] };
}

function setBusy(busy) {
  state.busy = busy;
  [
    els.editSelected,
    els.publishSelected,
    els.unpublishSelected,
    els.deleteSelected
  ].forEach((button) => {
    button.disabled = busy;
  });
}

function closeEditDialog() {
  state.currentEdit = null;
  els.editStatus.textContent = "";
  els.editStatus.classList.remove("is-error");
  if (typeof els.editDialog.close === "function") els.editDialog.close();
  else els.editDialog.removeAttribute("open");
}

function changePage(delta) {
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.max(1, Math.min(pageCount, state.page + delta));
  renderRows();
}

function changeSort(key) {
  if (!key) return;
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = key === "date" ? "desc" : "asc";
  }
  state.filtered.sort(compareRows);
  state.page = 1;
  renderRows();
}

function compareRows(first, second) {
  const firstValue = sortValue(first, state.sortKey);
  const secondValue = sortValue(second, state.sortKey);
  let result;
  if (typeof firstValue === "number" && typeof secondValue === "number") {
    result = firstValue - secondValue;
  } else {
    result = String(firstValue).localeCompare(String(secondValue), "en", {
      numeric: true,
      sensitivity: "base"
    });
  }
  if (!result) result = String(first.created_at || "").localeCompare(String(second.created_at || ""));
  return state.sortDirection === "asc" ? result : -result;
}

function sortValue(row, key) {
  if (key === "date") return Date.parse(row.observed_on || row.created_at || "") || 0;
  if (key === "week_number") return Number(row.week_number || 0);
  if (key === "photo_path") return displayPhotoPath(row) ? 1 : 0;
  if (key === "is_published") return row.is_published ? 1 : 0;
  if (key === "entry_type") return entryLabel(row.entry_type);
  return clean(row[key]);
}

function renderSortState() {
  document.querySelectorAll("[data-ledger-sort]").forEach((button) => {
    const active = button.dataset.ledgerSort === state.sortKey;
    const header = button.closest("th");
    button.classList.toggle("is-sorted", active);
    button.dataset.direction = active ? state.sortDirection : "";
    if (active) header?.setAttribute("aria-sort", state.sortDirection === "asc" ? "ascending" : "descending");
    else header?.removeAttribute("aria-sort");
  });
}

function openDialog(row) {
  els.entryType.textContent = entryLabel(row.entry_type);
  els.title.textContent = `${row.green_space_name} - ${row.participant_name}`;
  els.meta.innerHTML = [
    ["Project code", row.public_code],
    ["Date", formatDate(row.observed_on || row.created_at)],
    ["Week", row.week_number ? `Week ${row.week_number}` : "-"],
    ["Time", timeRange(row)],
    ["Status", row.is_published ? "Published" : "Unpublished"],
    ["GPS", coordinatePair(row)],
    ["Recorded", formatDateTime(row.created_at)]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd></div>`).join("");
  const photoPath = displayPhotoPath(row);
  if (photoPath) {
    els.photo.src = publicPhotoUrl(photoPath);
    els.photo.alt = `${row.green_space_name} project photo`;
    els.photo.hidden = false;
  } else {
    els.photo.hidden = true;
    els.photo.removeAttribute("src");
  }
  els.content.innerHTML = contentSections(row)
    .filter((section) => clean(section.value))
    .map((section) => `<section><h3>${escapeHtml(section.label)}</h3><p>${escapeHtml(section.value)}</p></section>`)
    .join("");
  if (typeof els.dialog.showModal === "function") els.dialog.showModal();
  else els.dialog.setAttribute("open", "");
}

function closeDialog() {
  if (typeof els.dialog.close === "function") els.dialog.close();
  else els.dialog.removeAttribute("open");
}

function contentSections(row) {
  if (row.entry_type === "project") {
    return [
      { label: "Intentions", value: row.intentions },
      { label: "Location and description", value: row.location_description },
      { label: "Visit schedule", value: row.visit_schedule }
    ];
  }
  if (row.entry_type === "observation") return [{ label: "Observations", value: row.observations }];
  if (row.entry_type === "weekly_reflection") {
    return [
      { label: "Weekly distillation", value: row.weekly_reflection },
      { label: "Haiku", value: row.haiku }
    ];
  }
  return [
    { label: "Favourite haiku", value: row.favourite_haiku },
    { label: "Synthesis of observations", value: row.synthesis },
    { label: "Key learnings", value: row.key_learnings },
    { label: "Overall reflection", value: row.overall_reflection }
  ];
}

function previewText(row) {
  const value = row.entry_type === "project"
    ? row.location_description
    : row.entry_type === "observation"
      ? row.observations
      : row.entry_type === "weekly_reflection"
        ? row.haiku || row.weekly_reflection
        : row.favourite_haiku || row.synthesis;
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text || "-";
}

function exportCsv() {
  if (!state.filtered.length) return;
  const headers = [
    "Date", "Student", "Green space", "Project code", "Entry type", "Week",
    "Time", "Status", "GPS", "Intentions", "Location description",
    "Visit schedule", "Observations", "Weekly distillation", "Haiku",
    "Favourite haiku", "Synthesis", "Key learnings", "Overall reflection", "Photo URL"
  ];
  const rows = state.filtered.map((row) => [
    row.observed_on || row.created_at,
    row.participant_name,
    row.green_space_name,
    row.public_code,
    entryLabel(row.entry_type),
    row.week_number || "",
    row.start_time || "",
    row.is_published ? "Published" : "Unpublished",
    coordinatePair(row),
    row.intentions || "",
    row.location_description || "",
    row.visit_schedule || "",
    row.observations || "",
    row.weekly_reflection || "",
    row.haiku || "",
    row.favourite_haiku || "",
    row.synthesis || "",
    row.key_learnings || "",
    row.overall_reflection || "",
    displayPhotoPath(row) ? publicPhotoUrl(displayPhotoPath(row)) : ""
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `green-space-reflection-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function photoIndicator() {
  return '<span class="girls-photo-indicator" title="Photo attached" aria-label="Photo attached"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-5-5L5 21"></path></svg></span>';
}

function displayPhotoPath(row) {
  if (row.photo_path) return row.photo_path;
  return row.entry_type === "final_reflection" ? row.cover_photo_path : null;
}

function entryLabel(type) {
  return {
    project: "Project Start",
    observation: "Observation",
    weekly_reflection: "Distillation + haiku",
    final_reflection: "Final reflection"
  }[type] || type || "-";
}

function timeRange(row) {
  return formatTime(row.start_time) || "-";
}

function coordinatePair(row) {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "-";
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit"
  }).format(date);
}

function formatTime(value) {
  if (!value) return "";
  const parts = String(value).slice(0, 5).split(":").map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) return value;
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, parts[0], parts[1]));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function requireLedgerAccess() {
  try {
    const session = await currentSession();
    if (!session) {
      redirectToLogin();
      return null;
    }
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      redirectToLogin();
      return null;
    }
    if (userData.user.user_metadata?.must_change_password) {
      window.location.replace(
        "../login.html?mode=change&return=green-space%2Fledger.html"
      );
      return null;
    }
    const profile = await currentProfile(true);
    const allowed = profile?.account_status === "active"
      && (
        profile.app_role === "system_admin"
        || profile.app_role === "green_space_teacher"
        || profile.is_protected_owner
        || profile.can_manage_green_space
      );
    if (!allowed) {
      window.location.replace("../access_pending.html");
      return null;
    }
    return { session, profile };
  } catch {
    redirectToLogin();
    return null;
  }
}

function redirectToLogin() {
  window.location.replace("../login.html?return=green-space%2Fledger.html");
}

async function signOutOfLedger() {
  els.signOut.disabled = true;
  try {
    await signOut();
  } finally {
    redirectToLogin();
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
