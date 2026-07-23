import { authClient, requireAdminAccess } from "./auth_client.js";
import { selectRows } from "./supabase_client.js";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 5000;

const COLUMNS = {
  process: [
    ["record_date", "Date"],
    ["record_number", "Record"],
    ["start_time", "Start"],
    ["end_time", "End"],
    ["species", "Species"],
    ["received_seaweed_kg", "Received kg"],
    ["blended_seaweed_kg", "Blended kg"],
    ["wet_pulp_kg", "Wet pulp kg"],
    ["pressed_liquid_l", "Liquid L"],
    ["dry_pulp_kg", "Dry pulp kg"],
    ["lost_seaweed_kg", "Lost kg"],
    ["number_of_presses", "Presses"],
    ["press_average_batch_kg", "Average press kg"],
    ["wet_dry_ratio_percent", "Wet/dry %"],
    ["stock_product_ratio_percent", "Stock/product %"],
    ["recorded_by_name", "Recorded by"],
    ["has_photo", "Photo"],
    ["notes", "Notes"]
  ],
  site_sample: [
    ["recorded_at", "Date and time"],
    ["community_name_snapshot", "Community"],
    ["tide_stage", "Tide"],
    ["temperature_c", "Temperature C"],
    ["salinity_value", "Salinity"],
    ["tds_value", "TDS"],
    ["electrical_conductivity_ms_cm", "EC mS/cm"],
    ["e_coli_sample_taken", "E. coli sample"],
    ["recorded_by_name", "Recorded by"],
    ["notes", "Notes"]
  ],
  stock: [
    ["record_date", "Date"],
    ["record_number", "Container"],
    ["record_type", "Entry"],
    ["species", "Species"],
    ["weight_value", "Volume"],
    ["stabilizer_added", "Stabiliser"],
    ["chemical_dose_value", "Dose g/container"],
    ["salinity_value", "Salinity"],
    ["ph_value", "pH"],
    ["electrical_conductivity_ms_cm", "EC mS/cm"],
    ["recorded_by_name", "Recorded by"],
    ["notes", "Notes"]
  ]
};

const state = {
  category: "process",
  mode: "all",
  rows: [],
  total: 0,
  page: 0,
  sort: "recorded_at",
  direction: "desc",
  loading: false
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "formLedgerCount", "formLedgerCategories", "formLedgerViews",
    "formLedgerFromField", "formLedgerToField", "formLedgerMonthField",
    "formLedgerCommunityField", "formLedgerFrom", "formLedgerTo",
    "formLedgerMonth", "formLedgerCommunity", "formLedgerSearch",
    "loadFormLedger", "exportFormLedger", "formLedgerCommunityNote",
    "previousFormLedgerPage", "formLedgerPageStatus", "nextFormLedgerPage",
    "formLedgerHead", "formLedgerRows", "formLedgerStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  if (!els.formLedgerRows) return;

  const access = await requireAdminAccess("can_view_data");
  if (!access) return;

  setDateDefaults();
  readUrlState();
  bindEvents();
  try {
    const communities = await selectRows(
      "ag_secure_communities",
      "select=community_id,community_name&order=community_name.asc"
    );
    communities.forEach((community) => {
      els.formLedgerCommunity.append(new Option(
        `${community.community_id} - ${community.community_name}`,
        community.community_id
      ));
    });
    const requestedCommunity = new URLSearchParams(window.location.search).get("community");
    if (requestedCommunity) els.formLedgerCommunity.value = requestedCommunity;
    updateControls();
    await loadLedger();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function bindEvents() {
  els.formLedgerCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ledger-category]");
    if (!button || state.loading) return;
    state.category = button.dataset.ledgerCategory;
    state.page = 0;
    state.sort = "recorded_at";
    state.direction = "desc";
    updateControls();
    syncUrl();
    void loadLedger();
  });
  els.formLedgerViews.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ledger-mode]");
    if (!button || state.loading) return;
    state.mode = button.dataset.ledgerMode;
    state.page = 0;
    updateControls();
    syncUrl();
    void loadLedger();
  });
  els.loadFormLedger.addEventListener("click", () => {
    state.page = 0;
    syncUrl();
    void loadLedger();
  });
  els.formLedgerSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      state.page = 0;
      syncUrl();
      void loadLedger();
    }
  });
  els.previousFormLedgerPage.addEventListener("click", () => changePage(-1));
  els.nextFormLedgerPage.addEventListener("click", () => changePage(1));
  els.formLedgerHead.addEventListener("click", (event) => {
    const button = event.target.closest("[data-form-ledger-sort]");
    if (!button) return;
    const field = button.dataset.formLedgerSort;
    if (state.sort === field) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.sort = field;
      state.direction = field.includes("date") || field.includes("time") ? "desc" : "asc";
    }
    sortRows();
    renderRows();
  });
  els.exportFormLedger.addEventListener("click", exportCsv);
}

function setDateDefaults() {
  const end = kenyaDate();
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  els.formLedgerFrom.value = isoDate(startDate);
  els.formLedgerTo.value = end;
  els.formLedgerMonth.value = end.slice(0, 7);
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (["process", "site_sample", "stock"].includes(params.get("category"))) {
    state.category = params.get("category");
  }
  if (["all", "monthly", "community"].includes(params.get("view"))) {
    state.mode = params.get("view");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "")) {
    els.formLedgerFrom.value = params.get("from");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "")) {
    els.formLedgerTo.value = params.get("to");
  }
  if (/^\d{4}-\d{2}$/.test(params.get("month") || "")) {
    els.formLedgerMonth.value = params.get("month");
  }
  els.formLedgerSearch.value = params.get("search") || "";
}

function updateControls() {
  els.formLedgerCategories.querySelectorAll("[data-ledger-category]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.ledgerCategory === state.category));
  });
  els.formLedgerViews.querySelectorAll("[data-ledger-mode]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.ledgerMode === state.mode));
  });

  const monthly = state.mode === "monthly";
  const community = state.mode === "community";
  els.formLedgerFromField.hidden = monthly;
  els.formLedgerToField.hidden = monthly;
  els.formLedgerMonthField.hidden = !monthly;
  els.formLedgerCommunityField.hidden = !community || state.category !== "site_sample";
  els.formLedgerCommunityNote.hidden = !community || state.category === "site_sample";
  els.loadFormLedger.disabled = community && state.category !== "site_sample";
  els.exportFormLedger.disabled = community && state.category !== "site_sample";
}

async function loadLedger() {
  if (state.mode === "community" && state.category !== "site_sample") {
    state.rows = [];
    state.total = 0;
    renderHead();
    renderRows();
    setStatus("");
    return;
  }
  const range = selectedRange();
  if (!range) return;

  state.loading = true;
  setLoading(true);
  setStatus("Loading records...");
  try {
    const { data, error } = await authClient.rpc("ag_form_record_ledger", {
      p_record_type: state.category,
      p_start_date: range.start,
      p_end_date: range.end,
      p_community_id: state.mode === "community"
        ? (els.formLedgerCommunity.value || null)
        : null,
      p_search: els.formLedgerSearch.value.trim() || null,
      p_page_limit: PAGE_SIZE,
      p_page_offset: state.page * PAGE_SIZE
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    state.rows = Array.isArray(result?.rows) ? result.rows : [];
    state.total = Number(result?.total_count || 0);
    if (state.page > 0 && !state.rows.length && state.total > 0) {
      state.page = Math.max(0, Math.ceil(state.total / PAGE_SIZE) - 1);
      state.loading = false;
      await loadLedger();
      return;
    }
    sortRows();
    renderHead();
    renderRows();
    setStatus("");
  } catch (error) {
    state.rows = [];
    state.total = 0;
    renderHead();
    renderRows(error.message || "Records could not be loaded.");
    setStatus(error.message, "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

function selectedRange() {
  if (state.mode === "monthly") {
    const month = els.formLedgerMonth.value;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setStatus("Select a month.", "error");
      return null;
    }
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
  }
  if (!els.formLedgerFrom.value || !els.formLedgerTo.value) {
    setStatus("Select both From and To dates.", "error");
    return null;
  }
  if (els.formLedgerTo.value < els.formLedgerFrom.value) {
    setStatus("To date must be on or after From date.", "error");
    return null;
  }
  return { start: els.formLedgerFrom.value, end: els.formLedgerTo.value };
}

function renderHead() {
  els.formLedgerHead.innerHTML = `<tr>${COLUMNS[state.category].map(([field, label]) => `
    <th aria-sort="${state.sort === field ? (state.direction === "asc" ? "ascending" : "descending") : "none"}">
      <button type="button" data-form-ledger-sort="${escapeAttribute(field)}">${escapeHtml(label)}${state.sort === field ? ` ${state.direction === "asc" ? "up" : "down"}` : ""}</button>
    </th>`).join("")}</tr>`;
}

function renderRows(errorMessage = "") {
  const columns = COLUMNS[state.category];
  els.formLedgerCount.textContent = `${state.total} row${state.total === 1 ? "" : "s"}`;
  if (errorMessage || !state.rows.length) {
    els.formLedgerRows.innerHTML = `<tr><td colspan="${columns.length}" class="empty-state">${escapeHtml(errorMessage || emptyMessage())}</td></tr>`;
  } else {
    els.formLedgerRows.innerHTML = state.rows.map((row) => `
      <tr>${columns.map(([field]) => `<td>${escapeHtml(cellValue(row, field))}</td>`).join("")}</tr>
    `).join("");
  }
  const start = state.total ? state.page * PAGE_SIZE + 1 : 0;
  const end = Math.min((state.page + 1) * PAGE_SIZE, state.total);
  els.formLedgerPageStatus.textContent = state.total
    ? `Rows ${start}-${end} of ${state.total}`
    : "No rows";
  els.previousFormLedgerPage.disabled = state.loading || state.page === 0;
  els.nextFormLedgerPage.disabled = state.loading || end >= state.total;
}

function cellValue(row, field) {
  const value = row[field];
  if (field === "record_number" && state.category === "process") {
    if (/^PR-\d+$/.test(String(value || ""))) return String(value);
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? `PR-${String(number).padStart(5, "0")}` : "-";
  }
  if (field === "recorded_at") return formatDateTime(value);
  if (field === "record_date") return formatDate(value);
  if (field === "start_time" || field === "end_time") return String(value || "-").slice(0, 5);
  if (field === "species") return titleCase(value);
  if (field === "tide_stage") return value ? titleCase(value) : "-";
  if (field === "record_type") {
    const label = value === "retest" ? "Retest" : "New";
    return row.test_sequence ? `${label} ${row.test_sequence}` : label;
  }
  if (field === "community_name_snapshot") {
    return [row.community_id_snapshot, value].filter(Boolean).join(" - ") || "-";
  }
  if (field === "weight_value") return measurement(value, row.weight_unit);
  if (field === "chemical_dose_value") return measurement(value, row.chemical_dose_unit);
  if (field === "salinity_value") return measurement(value, row.salinity_unit);
  if (field === "tds_value") return measurement(value, row.tds_unit);
  if (field === "has_photo") return value ? "Yes" : "No";
  if (field === "stabilizer_added" || field === "e_coli_sample_taken") {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "-";
  }
  if (field.endsWith("_kg") || field.endsWith("_l") || field.endsWith("_percent")
    || ["temperature_c", "ph_value", "electrical_conductivity_ms_cm", "number_of_presses"].includes(field)) {
    return formatNumber(value);
  }
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function sortRows() {
  const direction = state.direction === "asc" ? 1 : -1;
  state.rows.sort((first, second) => {
    const a = first[state.sort];
    const b = second[state.sort];
    if (a === b) return 0;
    if (a === null || a === undefined || a === "") return 1;
    if (b === null || b === undefined || b === "") return -1;
    const aNumber = Number(a);
    const bNumber = Number(b);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return (aNumber - bNumber) * direction;
    return String(a).localeCompare(String(b), undefined, { numeric: true }) * direction;
  });
}

async function exportCsv() {
  const range = selectedRange();
  if (!range) return;
  els.exportFormLedger.disabled = true;
  setStatus("Preparing CSV...");
  try {
    const rows = [];
    for (let offset = 0; offset < EXPORT_LIMIT; offset += PAGE_SIZE) {
      const { data, error } = await authClient.rpc("ag_form_record_ledger", {
        p_record_type: state.category,
        p_start_date: range.start,
        p_end_date: range.end,
        p_community_id: state.mode === "community"
          ? (els.formLedgerCommunity.value || null)
          : null,
        p_search: els.formLedgerSearch.value.trim() || null,
        p_page_limit: PAGE_SIZE,
        p_page_offset: offset
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      const pageRows = Array.isArray(result?.rows) ? result.rows : [];
      rows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE || rows.length >= Number(result?.total_count || 0)) break;
    }
    downloadCsv(rows.slice(0, EXPORT_LIMIT));
    setStatus(`${Math.min(rows.length, EXPORT_LIMIT)} rows exported.`);
  } catch (error) {
    setStatus(error.message || "CSV could not be exported.", "error");
  } finally {
    els.exportFormLedger.disabled = false;
  }
}

function downloadCsv(rows) {
  const columns = COLUMNS[state.category];
  const lines = [
    columns.map(([, label]) => csvValue(label)).join(","),
    ...rows.map((row) => columns.map(([field]) => csvValue(cellValue(row, field))).join(","))
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `seaweed-harvest-${state.category.replace("_", "-")}-${kenyaDate()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total || state.loading) return;
  state.page = next;
  void loadLedger();
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("category", state.category);
  url.searchParams.set("view", state.mode);
  if (state.mode === "monthly") url.searchParams.set("month", els.formLedgerMonth.value);
  else url.searchParams.delete("month");
  if (state.mode !== "monthly") {
    url.searchParams.set("from", els.formLedgerFrom.value);
    url.searchParams.set("to", els.formLedgerTo.value);
  }
  if (state.mode === "community" && els.formLedgerCommunity.value) {
    url.searchParams.set("community", els.formLedgerCommunity.value);
  } else {
    url.searchParams.delete("community");
  }
  if (els.formLedgerSearch.value.trim()) url.searchParams.set("search", els.formLedgerSearch.value.trim());
  else url.searchParams.delete("search");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function setLoading(loading) {
  els.loadFormLedger.disabled = loading || (state.mode === "community" && state.category !== "site_sample");
  els.exportFormLedger.disabled = loading || (state.mode === "community" && state.category !== "site_sample");
  els.previousFormLedgerPage.disabled = loading || state.page === 0;
  els.nextFormLedgerPage.disabled = loading || (state.page + 1) * PAGE_SIZE >= state.total;
}

function emptyMessage() {
  if (state.mode === "community" && state.category !== "site_sample") {
    return "Community is not recorded on this form.";
  }
  return "No records match the current filters.";
}

function measurement(value, unit) {
  const number = formatNumber(value);
  return number === "-" ? "-" : `${number}${unit ? ` ${unit}` : ""}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 3 })
    : String(value);
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi"
  }).format(date);
}

function titleCase(value) {
  return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Nairobi"
  }).format(new Date());
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function setStatus(message, type = "") {
  els.formLedgerStatus.textContent = message || "";
  if (type) els.formLedgerStatus.dataset.status = type;
  else delete els.formLedgerStatus.dataset.status;
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
