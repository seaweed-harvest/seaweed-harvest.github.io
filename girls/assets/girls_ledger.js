import { loadLedger, publicPhotoUrl } from "./girls_api.js";

const state = {
  rows: [],
  filtered: []
};

const els = {
  search: document.getElementById("girlsLedgerSearch"),
  type: document.getElementById("girlsLedgerType"),
  week: document.getElementById("girlsLedgerWeek"),
  export: document.getElementById("girlsExportLedger"),
  count: document.getElementById("girlsLedgerCount"),
  rows: document.getElementById("girlsLedgerRows"),
  status: document.getElementById("girlsLedgerStatus"),
  dialog: document.getElementById("girlsEntryDialog"),
  close: document.getElementById("girlsCloseEntry"),
  entryType: document.getElementById("girlsEntryType"),
  title: document.getElementById("girlsEntryTitle"),
  meta: document.getElementById("girlsEntryMeta"),
  photo: document.getElementById("girlsEntryPhoto"),
  content: document.getElementById("girlsEntryContent")
};

document.addEventListener("DOMContentLoaded", initialise, { once: true });

async function initialise() {
  [els.search, els.type, els.week].forEach((control) => control.addEventListener("input", applyFilters));
  els.export.addEventListener("click", exportCsv);
  els.rows.addEventListener("click", openFromRow);
  els.rows.addEventListener("keydown", openFromRow);
  els.close.addEventListener("click", closeDialog);
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) closeDialog();
  });

  try {
    state.rows = await loadLedger();
    applyFilters();
  } catch (error) {
    els.rows.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
    els.status.textContent = error.message;
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
  });
  renderRows();
}

function renderRows() {
  els.count.textContent = `${state.filtered.length} ${state.filtered.length === 1 ? "entry" : "entries"}`;
  els.export.disabled = !state.filtered.length;
  els.rows.innerHTML = state.filtered.map((row, index) => `
    <tr tabindex="0" data-row-index="${index}" aria-label="Open ${escapeAttribute(entryLabel(row.entry_type))} for ${escapeAttribute(row.green_space_name)}">
      <td>${escapeHtml(formatDate(row.observed_on || row.created_at))}</td>
      <td>${escapeHtml(row.participant_name)}</td>
      <td><strong>${escapeHtml(row.green_space_name)}</strong></td>
      <td>${escapeHtml(entryLabel(row.entry_type))}</td>
      <td>${row.week_number ? `Week ${escapeHtml(row.week_number)}` : "-"}</td>
      <td>${escapeHtml(timeRange(row))}</td>
      <td>${row.photo_path ? photoIndicator() : "-"}</td>
      <td>${escapeHtml(previewText(row))}</td>
    </tr>
  `).join("") || '<tr><td colspan="8">No entries match these filters.</td></tr>';
  els.status.textContent = state.filtered.length
    ? "Select a row to read the complete entry."
    : "No entries to display.";
}

function openFromRow(event) {
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const rowElement = event.target.closest("[data-row-index]");
  if (!rowElement) return;
  event.preventDefault();
  const row = state.filtered[Number(rowElement.dataset.rowIndex)];
  if (row) openDialog(row);
}

function openDialog(row) {
  els.entryType.textContent = entryLabel(row.entry_type);
  els.title.textContent = `${row.green_space_name} - ${row.participant_name}`;
  els.meta.innerHTML = [
    ["Project code", row.public_code],
    ["Date", formatDate(row.observed_on || row.created_at)],
    ["Week", row.week_number ? `Week ${row.week_number}` : "-"],
    ["Time", timeRange(row)],
    ["GPS", coordinatePair(row)],
    ["Recorded", formatDateTime(row.created_at)]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd></div>`).join("");

  if (row.photo_path) {
    els.photo.src = publicPhotoUrl(row.photo_path);
    els.photo.alt = `${row.green_space_name} observation`;
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
  if (row.entry_type === "observation") {
    return [{ label: "Observations", value: row.observations }];
  }
  if (row.entry_type === "weekly_reflection") {
    return [{ label: "Weekly distillation", value: row.weekly_reflection }];
  }
  return [
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
        ? row.weekly_reflection
        : row.synthesis;
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text || "-";
}

function exportCsv() {
  if (!state.filtered.length) return;
  const headers = [
    "Date", "Student", "Green space", "Project code", "Entry type", "Week",
    "Start time", "Finish time", "GPS", "Intentions", "Location description",
    "Visit schedule", "Observations", "Weekly reflection", "Synthesis",
    "Key learnings", "Overall reflection", "Photo URL"
  ];
  const rows = state.filtered.map((row) => [
    row.observed_on || row.created_at,
    row.participant_name,
    row.green_space_name,
    row.public_code,
    entryLabel(row.entry_type),
    row.week_number || "",
    row.start_time || "",
    row.end_time || "",
    coordinatePair(row),
    row.intentions || "",
    row.location_description || "",
    row.visit_schedule || "",
    row.observations || "",
    row.weekly_reflection || "",
    row.synthesis || "",
    row.key_learnings || "",
    row.overall_reflection || "",
    row.photo_path ? publicPhotoUrl(row.photo_path) : ""
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `girls-reflection-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function photoIndicator() {
  return '<span class="girls-photo-indicator" title="Photo attached" aria-label="Photo attached"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-5-5L5 21"></path></svg></span>';
}

function entryLabel(type) {
  return {
    project: "Project setup",
    observation: "Observation",
    weekly_reflection: "Weekly reflection",
    final_reflection: "Final reflection"
  }[type] || type || "-";
}

function timeRange(row) {
  if (!row.start_time && !row.end_time) return "-";
  return [formatTime(row.start_time), formatTime(row.end_time)].filter(Boolean).join("-");
}

function coordinatePair(row) {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "-";
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
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
  const date = new Date(2000, 0, 1, parts[0], parts[1]);
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(date);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
