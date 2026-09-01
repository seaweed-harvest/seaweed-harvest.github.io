import { currentAccessToken, requireAggregatorAccess, setupAccountControls } from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=15";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";

const RPC_NAME = "list_authenticated_seaweed_drying_ledger";
const KENYA_TIME_ZONE = "Africa/Nairobi";

const state = {
  profile: null,
  bayRows: [],
  observations: [],
  activeTab: "all",
  expandedGroups: new Set()
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();

  try {
    const access = await requireAggregatorAccess(
      "COSME",
      "can_view_data",
      "dryer_table_records.html",
      "form_dryer_table"
    );
    if (!access) return;
    if (access.profile?.is_protected_owner !== true) {
      window.location.replace("./access_pending.html");
      return;
    }

    state.profile = access.profile;
    const sidebar = populateAppSidebar(els.sidebar, {
      profile: state.profile,
      dashboardHref: "./home.html"
    });
    setupAccountControls(state.profile);
    setupAppNavigation({
      profile: state.profile,
      sidebar,
      dashboardHref: "./home.html"
    });
    document.body.removeAttribute("data-auth-pending");
    setTab(new URLSearchParams(window.location.search).get("tab") || "all", { syncUrl: false });
    await loadRecords();
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error?.message || String(error))}`);
  }
}

function cacheElements() {
  [
    "dryerTableRecordsSidebar",
    "reloadDryerRecords",
    "dryerRecordTabs",
    "dryerAllPanel",
    "dryerObservationsPanel",
    "dryerPaymentsPanel",
    "dryerTableFilter",
    "dryerFromDate",
    "dryerToDate",
    "dryerStatusFilter",
    "dryerGroupBy",
    "applyDryerFilters",
    "clearDryerFilters",
    "dryerSummaryMetrics",
    "dryerRecordRows",
    "dryerRecordsStatus",
    "dryerObservationTableFilter",
    "dryerObservationFromDate",
    "dryerObservationToDate",
    "applyDryerObservationFilters",
    "clearDryerObservationFilters",
    "dryerObservationRows",
    "dryerObservationsStatus"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.sidebar = els.dryerTableRecordsSidebar;
}

function bindEvents() {
  els.reloadDryerRecords?.addEventListener("click", loadRecords);
  els.dryerRecordTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dryer-tab]");
    if (button) setTab(button.dataset.dryerTab);
  });
  els.dryerRecordTabs?.addEventListener("keydown", handleTabKeydown);
  els.applyDryerFilters?.addEventListener("click", renderAllRecords);
  els.clearDryerFilters?.addEventListener("click", () => {
    els.dryerTableFilter.value = "";
    els.dryerFromDate.value = "";
    els.dryerToDate.value = "";
    els.dryerStatusFilter.value = "";
    els.dryerGroupBy.value = "event";
    state.expandedGroups.clear();
    renderAllRecords();
  });
  els.dryerGroupBy?.addEventListener("change", () => {
    state.expandedGroups.clear();
    renderAllRecords();
  });
  els.dryerRecordRows?.addEventListener("click", handleGroupToggle);
  els.applyDryerObservationFilters?.addEventListener("click", renderObservations);
  els.clearDryerObservationFilters?.addEventListener("click", () => {
    els.dryerObservationTableFilter.value = "";
    els.dryerObservationFromDate.value = "";
    els.dryerObservationToDate.value = "";
    renderObservations();
  });
}

function handleTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...els.dryerRecordTabs.querySelectorAll("[data-dryer-tab]")];
  const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
  else next = Math.min(tabs.length - 1, current + 1);
  const button = tabs[next];
  if (!button) return;
  setTab(button.dataset.dryerTab);
  button.focus();
}

function setTab(tab, { syncUrl = true } = {}) {
  const allowed = new Set(["all", "observations", "payments"]);
  state.activeTab = allowed.has(tab) ? tab : "all";
  const panelByTab = {
    all: els.dryerAllPanel,
    observations: els.dryerObservationsPanel,
    payments: els.dryerPaymentsPanel
  };
  [...els.dryerRecordTabs.querySelectorAll("[data-dryer-tab]")].forEach((button) => {
    const active = button.dataset.dryerTab === state.activeTab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  Object.entries(panelByTab).forEach(([key, panel]) => {
    panel.hidden = key !== state.activeTab;
  });
  if (syncUrl) {
    const url = new URL(window.location.href);
    if (state.activeTab === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", state.activeTab);
    window.history.replaceState({}, "", url);
  }
}

async function loadRecords() {
  setStatus(els.dryerRecordsStatus, "Loading dryer table records...");
  setStatus(els.dryerObservationsStatus, "Loading observations...");
  els.reloadDryerRecords.disabled = true;
  try {
    const accountToken = await currentAccessToken();
    const response = await fetch(`${DRYING_FORM_CONFIG.supabaseUrl}/rest/v1/rpc/${RPC_NAME}`, {
      method: "POST",
      headers: {
        apikey: DRYING_FORM_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${DRYING_FORM_CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_account_access_token: accountToken,
        p_limit: 5000
      })
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
    }
    const data = await response.json();
    state.bayRows = Array.isArray(data?.bay_rows) ? data.bay_rows : [];
    state.observations = Array.isArray(data?.observations) ? data.observations : [];
    populateTableFilters();
    renderAllRecords();
    renderObservations();
  } catch (error) {
    const message = error?.message || String(error);
    els.dryerRecordRows.innerHTML = emptyRow(10, `Unable to load dryer records. ${message}`);
    els.dryerObservationRows.innerHTML = emptyRow(5, `Unable to load observations. ${message}`);
    setStatus(els.dryerRecordsStatus, message, "error");
    setStatus(els.dryerObservationsStatus, message, "error");
  } finally {
    els.reloadDryerRecords.disabled = false;
  }
}

function populateTableFilters() {
  const configured = DRYING_FORM_CONFIG.locations.map((location) => location.label).filter(Boolean);
  const recorded = [
    ...state.bayRows.map((row) => row.table_location),
    ...state.observations.map((row) => row.table_location)
  ].filter(Boolean);
  const labels = [...new Set([...configured, ...recorded])].sort(naturalCompare);
  const previousAll = els.dryerTableFilter.value;
  const previousObservations = els.dryerObservationTableFilter.value;
  const options = `<option value="">All tables</option>${labels.map((label) => `<option value="${escapeAttribute(label)}">${escapeHtml(label)}</option>`).join("")}`;
  els.dryerTableFilter.innerHTML = options;
  els.dryerObservationTableFilter.innerHTML = options;
  if (labels.includes(previousAll)) els.dryerTableFilter.value = previousAll;
  if (labels.includes(previousObservations)) els.dryerObservationTableFilter.value = previousObservations;
}

function renderAllRecords() {
  const rows = filteredBayRows();
  renderSummary(rows);
  if (!rows.length) {
    els.dryerRecordRows.innerHTML = emptyRow(10, "No dryer bay records match these filters.");
    setStatus(els.dryerRecordsStatus, "0 rows");
    return;
  }

  const mode = els.dryerGroupBy.value || "event";
  const groups = groupedBayRows(rows, mode);
  const html = [];
  groups.forEach((group) => {
    const expanded = state.expandedGroups.has(group.storageKey);
    html.push(groupHeaderRow(group, expanded));
    group.rows.forEach((row) => html.push(bayRowMarkup(row, group.storageKey, expanded)));
  });
  els.dryerRecordRows.innerHTML = html.join("");
  const groupLabel = mode === "event" ? (groups.length === 1 ? "event" : "events") : (groups.length === 1 ? "group" : "groups");
  setStatus(
    els.dryerRecordsStatus,
    `${rows.length} ${rows.length === 1 ? "bay record" : "bay records"} · ${groups.length} ${groupLabel}`
  );
}

function filteredBayRows() {
  const table = els.dryerTableFilter.value;
  const from = els.dryerFromDate.value;
  const to = els.dryerToDate.value;
  const status = els.dryerStatusFilter.value;
  return state.bayRows.filter((row) => {
    if (table && row.table_location !== table) return false;
    if (status && row.status !== status) return false;
    const date = kenyaDateKey(row.loading_at || row.unloading_at || row.recorded_at);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return true;
  });
}

function groupedBayRows(rows, mode) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = groupKeyForRow(row, mode);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const sortedRows = sortGroupRows(groupRows, mode);
      return {
        key,
        storageKey: `${mode}:${key}`,
        mode,
        label: groupLabel(sortedRows, mode, key),
        rows: sortedRows,
        sortTime: groupSortTime(sortedRows, mode)
      };
    })
    .sort((first, second) => {
      if (mode === "table") return naturalCompare(first.label, second.label);
      return second.sortTime - first.sortTime || naturalCompare(first.label, second.label);
    });
}

function groupKeyForRow(row, mode) {
  if (mode === "event") {
    return String(
      row.submission_id
      || row.receipt_number
      || `${row.table_location || "unknown"}:${row.loading_at || row.recorded_at || row.unloading_at || "unknown"}`
    );
  }
  if (mode === "load_date") {
    return kenyaDateKey(row.loading_at || row.unloading_at || row.recorded_at) || "unknown";
  }
  return row.table_location || "Unknown table";
}

function groupLabel(rows, mode, key) {
  if (mode === "load_date") return formatDateKey(key);
  if (mode === "table") return key;

  const table = rows.find((row) => row.table_location)?.table_location || "Unknown table";
  const loadedAt = earliestTimestamp(rows, "loading_at");
  const eventAt = loadedAt
    || earliestTimestamp(rows, "recorded_at")
    || earliestTimestamp(rows, "unloading_at");
  return `${table} — ${formatDateTime(eventAt)}`;
}

function sortGroupRows(rows, mode) {
  return [...rows].sort((first, second) => {
    if (mode === "event") {
      return Number(first.bay_number || 0) - Number(second.bay_number || 0);
    }
    const timeDifference = recordTime(second) - recordTime(first);
    if (timeDifference) return timeDifference;
    return naturalCompare(first.table_location, second.table_location)
      || Number(first.bay_number || 0) - Number(second.bay_number || 0);
  });
}

function groupSortTime(rows, mode) {
  if (mode === "load_date") {
    const date = kenyaDateKey(rows[0]?.loading_at || rows[0]?.unloading_at || rows[0]?.recorded_at);
    return Date.parse(date ? `${date}T12:00:00+03:00` : "") || 0;
  }
  const eventAt = earliestTimestamp(rows, "loading_at")
    || earliestTimestamp(rows, "recorded_at")
    || earliestTimestamp(rows, "unloading_at");
  return Date.parse(eventAt || "") || 0;
}

function earliestTimestamp(rows, field) {
  let earliestValue = "";
  let earliestTime = Number.POSITIVE_INFINITY;
  rows.forEach((row) => {
    const value = row?.[field];
    const time = Date.parse(value || "");
    if (!Number.isFinite(time) || time >= earliestTime) return;
    earliestTime = time;
    earliestValue = value;
  });
  return earliestValue;
}

function groupHeaderRow(group, expanded) {
  const wet = sumNumbers(group.rows, "loading_weight_kg");
  const dry = sumNumbers(group.rows, "unloading_weight_kg");
  const drying = group.rows.filter((row) => row.status === "drying").length;
  const complete = group.rows.filter((row) => row.status === "complete").length;
  const toggleLabel = `${expanded ? "Collapse" : "Expand"} ${group.label}`;
  return `<tr class="table-total-row dryer-group-header" data-dryer-group-header>
    <th colspan="10" scope="rowgroup">
      <button class="icon-button" type="button" data-dryer-group-toggle data-dryer-group-key="${escapeAttribute(group.storageKey)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${escapeAttribute(toggleLabel)}" title="${escapeAttribute(toggleLabel)}"><span data-dryer-group-marker aria-hidden="true">${expanded ? "▾" : "▸"}</span></button>
      <strong>${escapeHtml(group.label)}</strong> — ${escapeHtml(formatInteger(group.rows.length))} bays · ${escapeHtml(formatKg(wet))} kg loaded · ${escapeHtml(formatKg(dry))} kg unloaded · ${escapeHtml(formatInteger(drying))} drying · ${escapeHtml(formatInteger(complete))} complete
    </th>
  </tr>`;
}

function bayRowMarkup(row, groupKey, expanded) {
  return `<tr data-dryer-group-row="${escapeAttribute(groupKey)}"${expanded ? "" : " hidden"}>
    <td><strong>${escapeHtml(row.table_location || "-")}</strong></td>
    <td>${escapeHtml(row.bay_number ?? "-")}</td>
    <td>${statusPill(row.status)}</td>
    <td>${escapeHtml(formatDateTime(row.loading_at))}</td>
    <td>${escapeHtml(formatOptionalKg(row.loading_weight_kg))}</td>
    <td>${escapeHtml(formatDateTime(row.unloading_at))}</td>
    <td>${escapeHtml(formatOptionalKg(row.unloading_weight_kg))}</td>
    <td>${escapeHtml(formatWeightLoss(row.weight_loss_pct))}</td>
    <td>${escapeHtml(formatDryingMinutes(row.drying_minutes))}</td>
    <td>${escapeHtml(formatInteger(row.photo_count))}</td>
  </tr>`;
}

function handleGroupToggle(event) {
  const button = event.target.closest("[data-dryer-group-toggle]");
  if (!button) return;
  const groupKey = button.dataset.dryerGroupKey;
  if (!groupKey) return;

  const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  const marker = button.querySelector("[data-dryer-group-marker]");
  if (marker) marker.textContent = expanded ? "▾" : "▸";
  const label = button.closest("th")?.querySelector("strong")?.textContent || "group";
  button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${label}`);
  button.title = `${expanded ? "Collapse" : "Expand"} ${label}`;

  if (expanded) state.expandedGroups.add(groupKey);
  else state.expandedGroups.delete(groupKey);

  let row = button.closest("tr")?.nextElementSibling || null;
  while (row && !row.hasAttribute("data-dryer-group-header")) {
    row.hidden = !expanded;
    row = row.nextElementSibling;
  }
}

function renderSummary(rows) {
  const wet = sumNumbers(rows, "loading_weight_kg");
  const dry = sumNumbers(rows, "unloading_weight_kg");
  const drying = rows.filter((row) => row.status === "drying").length;
  const complete = rows.filter((row) => row.status === "complete").length;
  els.dryerSummaryMetrics.innerHTML = [
    `Wet loaded: ${formatKg(wet)} kg`,
    `Dry unloaded: ${formatKg(dry)} kg`,
    `Currently drying: ${formatInteger(drying)}`,
    `Completed cycles: ${formatInteger(complete)}`
  ].map((label) => `<span class="status-pill">${escapeHtml(label)}</span>`).join("");
}

function renderObservations() {
  const table = els.dryerObservationTableFilter.value;
  const from = els.dryerObservationFromDate.value;
  const to = els.dryerObservationToDate.value;
  const rows = state.observations.filter((row) => {
    if (table && row.table_location !== table) return false;
    const date = kenyaDateKey(row.observation_at || row.recorded_at);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return true;
  }).sort((first, second) => (
    recordTime({ loading_at: second.observation_at || second.recorded_at })
      - recordTime({ loading_at: first.observation_at || first.recorded_at })
  ));

  els.dryerObservationRows.innerHTML = rows.length
    ? rows.map((row) => `<tr>
        <td>${escapeHtml(formatDate(row.observation_at || row.recorded_at))}</td>
        <td><strong>${escapeHtml(row.table_location || "-")}</strong></td>
        <td>${textCell(row.general_observations)}</td>
        <td>${textCell(row.working_well)}</td>
        <td>${textCell(row.not_working)}</td>
      </tr>`).join("")
    : emptyRow(5, "No observations match these filters.");
  setStatus(els.dryerObservationsStatus, `${rows.length} ${rows.length === 1 ? "observation" : "observations"}`);
}

function statusPill(status) {
  const labels = {
    drying: "Drying",
    complete: "Complete",
    needs_review: "Needs review"
  };
  const extraClass = status === "drying" ? " status-muted" : "";
  return `<span class="status-pill${extraClass}">${escapeHtml(labels[status] || "Needs review")}</span>`;
}

function textCell(value) {
  const text = String(value || "").trim();
  return text ? escapeHtml(text) : '<span class="muted-cell">-</span>';
}

function sumNumbers(rows, key) {
  return rows.reduce((sum, row) => {
    const value = row[key];
    if (value === null || value === undefined || value === "") return sum;
    const number = Number(value);
    return Number.isFinite(number) ? sum + number : sum;
  }, 0);
}

function recordTime(row) {
  const value = row.loading_at || row.unloading_at || row.recorded_at;
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function kenyaDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KENYA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Unknown date";
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: KENYA_TIME_ZONE
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: KENYA_TIME_ZONE
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KENYA_TIME_ZONE
  });
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatOptionalKg(value) {
  const number = optionalNumber(value);
  return number === null
    ? "-"
    : number.toLocaleString("en-GB", { minimumFractionDigits: number % 1 === 0 ? 0 : 1, maximumFractionDigits: 2 });
}

function formatKg(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-GB", { minimumFractionDigits: number % 1 === 0 ? 0 : 1, maximumFractionDigits: 2 });
}

function formatWeightLoss(value) {
  const number = optionalNumber(value);
  return number === null ? "-" : `${number.toFixed(1)}%`;
}

function formatDryingMinutes(value) {
  const number = optionalNumber(value);
  if (number === null) return "-";
  const minutes = Math.round(number);
  if (minutes < 0) return "-";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return parts.join(" ");
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Math.round(number).toLocaleString("en-GB");
}

function naturalCompare(first, second) {
  return String(first || "").localeCompare(String(second || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  if (type) element.dataset.status = type;
  else delete element.dataset.status;
}

async function responseDetail(response) {
  try {
    const payload = await response.json();
    const detail = payload?.message || payload?.details || payload?.hint || payload?.error || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
