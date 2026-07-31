import { authClient } from "./auth_client.js?v=25";

const RESULT_LIMIT = 2000;
const state = {
  rows: [],
  recordCount: 0,
  containerCount: 0,
  truncated: false,
  sortField: "container",
  direction: "asc",
  groupDirection: "asc",
  expandedContainers: new Set(),
  loading: false
};
const els = {};
let initialized = false;

export async function initializeContainerLookup({ load = false } = {}) {
  cacheElements();
  if (!els.containerLookupRows) return false;
  if (!initialized) {
    readUrlFilters();
    bindEvents();
    initialized = true;
  }
  if (load) await loadContainerLookupRecords();
  return true;
}

export async function loadContainerLookupRecords() {
  if (!initialized) await initializeContainerLookup();
  if (!els.containerLookupRows) return;
  await loadRecords();
}

function cacheElements() {
  [
    "containerLookupContainerCount", "containerLookupRecordCount",
    "containerLookupSearch", "containerLookupFrom", "containerLookupTo",
    "applyContainerLookup", "clearContainerLookup", "containerLookupRows",
    "containerLookupStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.applyContainerLookup.addEventListener("click", loadRecords);
  els.clearContainerLookup.addEventListener("click", () => {
    els.containerLookupSearch.value = "";
    els.containerLookupFrom.value = "";
    els.containerLookupTo.value = "";
    void loadRecords();
  });
  els.containerLookupSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loadRecords();
  });
  document.querySelector(".container-lookup-table thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-container-sort]");
    if (!button || state.loading) return;
    const field = button.dataset.containerSort;
    if (state.sortField === field) {
      state.direction = state.direction === "asc" ? "desc" : "asc";
    } else {
      state.sortField = field;
      state.direction = "asc";
    }
    if (field === "container") state.groupDirection = state.direction;
    render();
  });
  els.containerLookupRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-container-group-toggle]");
    if (!button) return;
    const key = button.dataset.containerGroupToggle;
    if (state.expandedContainers.has(key)) state.expandedContainers.delete(key);
    else state.expandedContainers.add(key);
    render();
    els.containerLookupRows.querySelector(
      `[data-container-group-toggle="${cssEscape(key)}"]`
    )?.focus();
  });
}

async function loadRecords() {
  const range = selectedDateRange();
  if (!range) return;

  state.loading = true;
  setLoading(true);
  setStatus("Loading records...");
  syncUrl();
  const { data, error } = await authClient.rpc("ag_stock_container_lookup", {
    p_containers: els.containerLookupSearch.value.trim() || null,
    p_start_date: range.start,
    p_end_date: range.end,
    p_result_limit: RESULT_LIMIT
  });
  state.loading = false;
  setLoading(false);

  if (error) {
    state.rows = [];
    state.recordCount = 0;
    state.containerCount = 0;
    state.truncated = false;
    render();
    setStatus(error.message || "Container records could not be loaded.", "error");
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;
  state.rows = Array.isArray(result?.rows) ? result.rows : [];
  state.recordCount = Number(result?.record_count || 0);
  state.containerCount = Number(result?.container_count || 0);
  state.truncated = Boolean(result?.truncated);
  render();
  setStatus(
    state.truncated
      ? `Showing the first ${formatInteger(state.rows.length)} records. Add a container or date filter to narrow the results.`
      : ""
  );
}

function render() {
  els.containerLookupContainerCount.textContent = countLabel(state.containerCount, "container");
  els.containerLookupRecordCount.textContent = countLabel(state.recordCount, "record");
  updateSortHeadings();

  if (!state.rows.length) {
    els.containerLookupRows.innerHTML = `
      <tr><td colspan="11" class="empty-state">No container records match the current filters.</td></tr>`;
    return;
  }

  const groups = groupedRows();
  const availableKeys = new Set(groups.map((group) => group.key));
  state.expandedContainers.forEach((key) => {
    if (!availableKeys.has(key)) state.expandedContainers.delete(key);
  });
  els.containerLookupRows.innerHTML = groups.map(groupRowsHtml).join("");
}

function groupedRows() {
  const groups = new Map();
  state.rows.forEach((row) => {
    const key = normalizeContainer(row.container_key || row.carton_serial);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const result = [...groups].map(([key, rows]) => ({
    key,
    rows: rows.sort(compareRows)
  }));
  const groupFactor = state.groupDirection === "asc" ? 1 : -1;
  result.sort((first, second) => compareContainerKeys(first.key, second.key) * groupFactor);
  return result;
}

function compareRows(first, second) {
  if (state.sortField !== "container") {
    const compared = compareValues(sortValue(first, state.sortField), sortValue(second, state.sortField));
    if (compared) return compared * (state.direction === "asc" ? 1 : -1);
  }
  return compareValues(first.record_date, second.record_date)
    || compareValues(Number(first.test_sequence || 0), Number(second.test_sequence || 0))
    || compareValues(first.created_at, second.created_at);
}

function sortValue(row, field) {
  if (field === "dose") {
    return Number(row.chemical_dose_value || 0) + Number(row.citric_acid_dose_value || 0);
  }
  if (field === "record_type") {
    return `${row.record_type === "retest" ? "1" : "0"}-${String(row.test_sequence || 0).padStart(4, "0")}`;
  }
  return row[field];
}

function compareValues(first, second) {
  const firstEmpty = first === null || first === undefined || first === "";
  const secondEmpty = second === null || second === undefined || second === "";
  if (firstEmpty || secondEmpty) return firstEmpty === secondEmpty ? 0 : 1;
  if (typeof first === "number" || typeof second === "number") {
    return Number(first) - Number(second);
  }
  return String(first).localeCompare(String(second), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function compareContainerKeys(first, second) {
  const firstNumeric = /^\d+$/.test(first);
  const secondNumeric = /^\d+$/.test(second);
  if (firstNumeric && secondNumeric) return Number(first) - Number(second);
  if (firstNumeric !== secondNumeric) return firstNumeric ? -1 : 1;
  return first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
}

function groupRowsHtml(group) {
  const expanded = state.expandedContainers.has(group.key);
  const summary = groupSummary(group.rows);
  const key = escapeAttribute(group.key);
  return `
    <tr class="container-lookup-group-row">
      <th scope="row">
        <button
          class="container-lookup-group-toggle"
          type="button"
          data-container-group-toggle="${key}"
          aria-expanded="${expanded}"
          aria-label="${expanded ? "Collapse" : "Expand"} Container ${escapeAttribute(displayContainer(group.key))}"
        >
          <span>Container ${escapeHtml(displayContainer(group.key))}</span>
          <small>${escapeHtml(countLabel(group.rows.length, "entry"))}</small>
        </button>
      </th>
      <td class="container-lookup-group-empty"></td>
      <td class="container-lookup-group-empty"></td>
      <td>${escapeHtml(summary.species)}</td>
      <td>${escapeHtml(summary.volume)}</td>
      <td>${escapeHtml(summary.dose)}</td>
      <td>${escapeHtml(summary.salinity)}</td>
      <td>${escapeHtml(summary.ph)}</td>
      <td>${escapeHtml(summary.ec)}</td>
      <td class="container-lookup-group-empty"></td>
      <td class="container-lookup-group-empty"></td>
    </tr>
    ${group.rows.map((row) => recordRowHtml(row, group.key, expanded)).join("")}`;
}

function groupSummary(rows) {
  return {
    species: commonGroupValue(rows, (row) => titleCase(row.species)),
    volume: commonGroupValue(rows, (row) => measurement(row.weight_value, row.weight_unit)),
    dose: commonGroupValue(rows, stockChemicalSummary),
    salinity: measurementRange(rows, "salinity_value", "salinity_unit"),
    ph: measurementRange(rows, "ph_value"),
    ec: measurementRange(rows, "electrical_conductivity_ms_cm")
  };
}

function commonGroupValue(rows, formatter) {
  const values = [...new Set(rows.map(formatter))];
  return values.length === 1 ? values[0] : "-";
}

function measurementRange(rows, field, unitField = "") {
  const values = rows
    .map((row) => Number(row[field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return "-";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = minimum === maximum
    ? formatNumber(minimum)
    : `${formatNumber(minimum)} - ${formatNumber(maximum)}`;
  if (!unitField) return range;
  const units = [...new Set(rows.map((row) => String(row[unitField] || "").trim()).filter(Boolean))];
  return units.length === 1 ? `${range} ${units[0]}` : range;
}

function recordRowHtml(row, groupKey, expanded) {
  return `
    <tr class="container-lookup-detail-row" data-container-detail="${escapeAttribute(groupKey)}"${expanded ? "" : " hidden"}>
      <td>${escapeHtml(displayContainer(normalizeContainer(row.container_key || row.carton_serial)))}</td>
      <td>${escapeHtml(formatDate(row.record_date))}</td>
      <td>${escapeHtml(entryLabel(row))}</td>
      <td>${escapeHtml(titleCase(row.species))}</td>
      <td>${escapeHtml(measurement(row.weight_value, row.weight_unit))}</td>
      <td>${escapeHtml(stockChemicalSummary(row))}</td>
      <td>${escapeHtml(measurement(row.salinity_value, row.salinity_unit))}</td>
      <td>${escapeHtml(formatNumber(row.ph_value))}</td>
      <td>${escapeHtml(formatNumber(row.electrical_conductivity_ms_cm))}</td>
      <td>${escapeHtml(row.recorded_by_name || "-")}</td>
      <td>${escapeHtml(row.notes || "-")}</td>
    </tr>`;
}

function updateSortHeadings() {
  document.querySelectorAll("[data-container-sort]").forEach((button) => {
    const field = button.dataset.containerSort;
    const heading = button.closest("th");
    const active = state.sortField === field;
    heading.setAttribute(
      "aria-sort",
      active ? (state.direction === "asc" ? "ascending" : "descending") : "none"
    );
  });
}

function selectedDateRange() {
  const from = els.containerLookupFrom.value || "";
  const to = els.containerLookupTo.value || "";
  if (from && to && to < from) {
    setStatus("To date must be on or after From date.", "error");
    return null;
  }
  return {
    start: from || to || null,
    end: to || from || null
  };
}

function readUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  els.containerLookupSearch.value = params.get("containers") || "";
  els.containerLookupFrom.value = params.get("from") || "";
  els.containerLookupTo.value = params.get("to") || "";
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("category", "stock");
  url.searchParams.set("view", "container");
  if (els.containerLookupSearch.value.trim()) {
    url.searchParams.set("containers", els.containerLookupSearch.value.trim());
  } else {
    url.searchParams.delete("containers");
  }
  if (els.containerLookupFrom.value) url.searchParams.set("from", els.containerLookupFrom.value);
  else url.searchParams.delete("from");
  if (els.containerLookupTo.value) url.searchParams.set("to", els.containerLookupTo.value);
  else url.searchParams.delete("to");
  ["records", "year", "search", "grouping", "summary_from", "summary_to", "community"]
    .forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function setLoading(loading) {
  els.applyContainerLookup.disabled = loading;
  els.clearContainerLookup.disabled = loading;
  document.querySelectorAll("[data-container-sort]").forEach((button) => {
    button.disabled = loading;
  });
}

function setStatus(message, type = "") {
  els.containerLookupStatus.textContent = message || "";
  if (type) els.containerLookupStatus.dataset.status = type;
  else delete els.containerLookupStatus.dataset.status;
}

function normalizeContainer(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, "");
  return text.toUpperCase();
}

function displayContainer(value) {
  const text = String(value || "-");
  return /^\d+$/.test(text) ? text.padStart(4, "0") : text;
}

function entryLabel(row) {
  const label = row.record_type === "retest" ? "Retest" : "New";
  return row.test_sequence ? `${label} ${row.test_sequence}` : label;
}

function stockChemicalSummary(row) {
  const chemicals = [];
  if (row.stabilizer_added) {
    chemicals.push(chemicalDoseLabel(
      row.chemical_dose_value,
      row.chemical_name || "Sodium benzoate"
    ));
  }
  if (row.citric_acid_added) {
    chemicals.push(chemicalDoseLabel(
      row.citric_acid_dose_value,
      row.citric_acid_name || "Citric acid"
    ));
  }
  return chemicals.filter(Boolean).join("; ") || "-";
}

function chemicalDoseLabel(value, chemicalName) {
  const dose = formatNumber(value);
  return dose === "-" ? chemicalName : `${dose}g ${chemicalName}`;
}

function measurement(value, unit) {
  const formatted = formatNumber(value);
  return formatted === "-" ? "-" : `${formatted}${unit ? ` ${unit}` : ""}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 3 })
    : String(value);
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function titleCase(value) {
  return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countLabel(value, noun) {
  const count = Number(value || 0);
  const plural = noun === "entry" ? "entries" : `${noun}s`;
  return `${formatInteger(count)} ${count === 1 ? noun : plural}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
