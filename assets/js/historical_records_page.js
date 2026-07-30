import {
  authClient,
  requireAggregatorAccess,
  setupAccountControls
} from "./auth_client.js?v=25";
import { dataModeLabel } from "./supabase_client.js";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=14";

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 5000;

const state = {
  profile: null,
  view: "all",
  page: 0,
  total: 0,
  sort: "ledger_date",
  direction: "desc",
  loading: false,
  communities: [],
  periods: []
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  try {
    const access = await requireAggregatorAccess(
      "SANDBOX",
      "can_view_data",
      "historical_records.html"
    );
    if (!access) return;
    state.profile = access.profile;
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error.message)}`);
    return;
  }

  const sidebar = populateAppSidebar(els.historicalSidebar, {
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
  readUrl();
  bindEvents();
  await loadReferenceData();
  await loadCurrentView();
}

function cacheElements() {
  [
    "historicalConnectionStatus",
    "historicalSidebar",
    "historicalDatasetMeta",
    "reloadHistoricalRecords",
    "historicalTotalRows",
    "historicalTotalKg",
    "historicalIdentityCount",
    "historicalCommunityCount",
    "historicalDateRange",
    "historicalAllView",
    "historicalMonthlyView",
    "historicalCommunitiesView",
    "historicalSearch",
    "historicalPeriod",
    "historicalCommunity",
    "historicalSeaweedType",
    "loadHistoricalRows",
    "exportHistoricalCsv",
    "historicalPreviousPage",
    "historicalPageStatus",
    "historicalNextPage",
    "historicalFilteredCount",
    "historicalRows",
    "historicalMonthlyYear",
    "historicalMonthlyCommunity",
    "loadHistoricalMonthly",
    "historicalMonthlyCount",
    "historicalMonthlyRows",
    "historicalCommunitySearch",
    "loadHistoricalCommunities",
    "historicalCommunitiesCount",
    "historicalCommunityRows",
    "historicalRecordsStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  document.querySelector(".historical-view-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-historical-view]");
    if (!button || state.loading) return;
    state.view = button.dataset.historicalView;
    state.page = 0;
    updateView();
    syncUrl();
    void loadCurrentView();
  });
  els.reloadHistoricalRecords.addEventListener("click", async () => {
    await loadReferenceData();
    await loadCurrentView();
  });
  els.loadHistoricalRows.addEventListener("click", () => {
    state.page = 0;
    syncUrl();
    void loadRows();
  });
  els.historicalSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.page = 0;
    syncUrl();
    void loadRows();
  });
  [els.historicalPeriod, els.historicalCommunity, els.historicalSeaweedType].forEach((control) => {
    control.addEventListener("change", () => {
      state.page = 0;
      syncUrl();
      void loadRows();
    });
  });
  els.historicalPreviousPage.addEventListener("click", () => changePage(-1));
  els.historicalNextPage.addEventListener("click", () => changePage(1));
  els.historicalRows.closest("table").querySelector("thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-historical-sort]");
    if (!button || state.loading) return;
    const nextSort = button.dataset.historicalSort;
    if (state.sort === nextSort) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.sort = nextSort;
      state.direction = nextSort === "ledger_date" || nextSort === "source_entry" ? "desc" : "asc";
    }
    state.page = 0;
    syncUrl();
    void loadRows();
  });
  els.exportHistoricalCsv.addEventListener("click", exportCsv);
  els.loadHistoricalMonthly.addEventListener("click", () => void loadMonthly());
  els.loadHistoricalCommunities.addEventListener("click", () => void loadCommunities());
  els.historicalCommunitySearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void loadCommunities();
  });
  els.historicalCommunityRows.addEventListener("click", (event) => {
    const row = event.target.closest("[data-community-key]");
    if (!row) return;
    els.historicalCommunity.value = row.dataset.communityKey;
    state.view = "all";
    state.page = 0;
    updateView();
    syncUrl();
    void loadRows();
  });
}

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  if (["all", "monthly", "communities"].includes(params.get("view"))) state.view = params.get("view");
  els.historicalSearch.value = params.get("search") || "";
  state.sort = ["ledger_date", "community", "member", "quantity_kg", "source_entry"].includes(params.get("sort"))
    ? params.get("sort")
    : "ledger_date";
  state.direction = params.get("direction") === "asc" ? "asc" : "desc";
  updateView();
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.view === "all") {
    if (els.historicalSearch.value.trim()) params.set("search", els.historicalSearch.value.trim());
    if (els.historicalPeriod.value) params.set("period", els.historicalPeriod.value);
    if (els.historicalCommunity.value) params.set("community", els.historicalCommunity.value);
    if (els.historicalSeaweedType.value) params.set("type", els.historicalSeaweedType.value);
    if (state.sort !== "ledger_date") params.set("sort", state.sort);
    if (state.direction !== "desc") params.set("direction", state.direction);
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
}

function updateView() {
  document.querySelectorAll("[data-historical-view]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.historicalView === state.view));
  });
  els.historicalAllView.hidden = state.view !== "all";
  els.historicalMonthlyView.hidden = state.view !== "monthly";
  els.historicalCommunitiesView.hidden = state.view !== "communities";
}

async function loadReferenceData() {
  setConnectionStatus("Loading", "status-muted");
  setStatus("Loading historical dataset...");
  try {
    const [communitiesResult, periodsResult] = await Promise.all([
      authClient.rpc("ag_sec_historical_community_summary", { p_search: null }),
      authClient.rpc("ag_sec_historical_monthly_summary", { p_year: null, p_community_key: null })
    ]);
    if (communitiesResult.error) throw communitiesResult.error;
    if (periodsResult.error) throw periodsResult.error;
    state.communities = communitiesResult.data?.rows || [];
    state.periods = periodsResult.data?.rows || [];
    populateReferenceControls();
    setConnectionStatus(dataModeLabel(), dataModeLabel() === "Preview" ? "status-muted" : "");
    setStatus("");
  } catch (error) {
    setConnectionStatus("Setup needed", "status-muted");
    setStatus(error.message || "Historical dataset references could not be loaded.", "error");
  }
}

function populateReferenceControls() {
  const params = new URLSearchParams(window.location.search);
  const selectedCommunity = params.get("community") || els.historicalCommunity.value;
  const selectedPeriod = params.get("period") || els.historicalPeriod.value;
  const selectedType = params.get("type") || els.historicalSeaweedType.value;

  replaceOptions(els.historicalCommunity, "All communities", state.communities.map((row) => ({
    value: row.community_key,
    label: communityLabel(row)
  })), selectedCommunity);
  replaceOptions(els.historicalMonthlyCommunity, "All communities", state.communities.map((row) => ({
    value: row.community_key,
    label: communityLabel(row)
  })), els.historicalMonthlyCommunity.value);
  replaceOptions(els.historicalPeriod, "All periods", state.periods.map((row) => ({
    value: row.period_key,
    label: row.period_label
  })), selectedPeriod);

  const types = [...new Set(state.communities.flatMap((row) => row.seaweed_types || []))].sort();
  replaceOptions(els.historicalSeaweedType, "All types", types.map((value) => ({
    value,
    label: titleCase(value)
  })), selectedType);

  const years = [...new Set(state.periods
    .map((row) => String(row.period_key || "").slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year)))].sort().reverse();
  replaceOptions(els.historicalMonthlyYear, "All years", years.map((year) => ({
    value: year,
    label: year
  })), els.historicalMonthlyYear.value);
}

function replaceOptions(select, firstLabel, rows, selected) {
  select.replaceChildren(new Option(firstLabel, ""));
  rows.forEach((row) => select.append(new Option(row.label, row.value)));
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

async function loadCurrentView() {
  if (state.view === "monthly") return loadMonthly();
  if (state.view === "communities") return loadCommunities();
  return loadRows();
}

async function loadRows(options = {}) {
  if (state.loading) return null;
  state.loading = true;
  updateLoadingState();
  if (!options.quiet) setStatus("Loading records...");
  try {
    const { data, error } = await authClient.rpc("ag_sec_historical_ledger_page", {
      p_search: els.historicalSearch.value.trim() || null,
      p_community_key: els.historicalCommunity.value || null,
      p_period_key: els.historicalPeriod.value || null,
      p_seaweed_type: els.historicalSeaweedType.value || null,
      p_page_limit: options.limit || PAGE_SIZE,
      p_page_offset: options.offset ?? state.page * PAGE_SIZE,
      p_sort_field: state.sort,
      p_sort_direction: state.direction
    });
    if (error) throw error;
    if (!data?.available) throw new Error("No historical import is available for Sandbox.");
    if (options.returnData) return data;
    state.total = Number(data.total_count || 0);
    renderSummary(data);
    renderRows(data.rows || []);
    setStatus("");
    return data;
  } catch (error) {
    if (!options.returnData) {
      state.total = 0;
      els.historicalRows.innerHTML = emptyRow(12, error.message || "Historical records could not be loaded.");
      setStatus(error.message || "Historical records could not be loaded.", "error");
    }
    throw error;
  } finally {
    state.loading = false;
    updateLoadingState();
  }
}

function renderSummary(data) {
  const summary = data.summary || {};
  els.historicalDatasetMeta.textContent = `${data.dataset_id || "Historical dataset"} | Read-only Sandbox import`;
  els.historicalTotalRows.textContent = formatInteger(summary.collection_count);
  els.historicalTotalKg.textContent = formatNumber(summary.total_weight_kg);
  els.historicalIdentityCount.textContent = formatInteger(summary.source_identity_count);
  els.historicalCommunityCount.textContent = formatInteger(summary.community_count);
  els.historicalDateRange.textContent = dateRange(summary.first_possible_date, summary.last_possible_date);
}

function renderRows(rows) {
  els.historicalRows.innerHTML = rows.map((row) => `
    <tr>
      <td><span class="historical-date-cell">${escapeHtml(row.ledger_date_raw || "-")}<small class="historical-precision">${escapeHtml(precisionLabel(row.date_precision))}</small></span></td>
      <td title="${escapeAttribute(row.source_group_name)}">${escapeHtml(row.source_group_name || "-")}</td>
      <td title="${escapeAttribute(row.source_member_name)}"><strong>${escapeHtml(row.source_member_id || "-")}</strong> - ${escapeHtml(row.source_member_name || "-")}</td>
      <td title="${escapeAttribute(row.product_description_raw)}">${escapeHtml(row.product_description_raw || "-")}</td>
      <td>${escapeHtml(titleCase(row.seaweed_type))}</td>
      <td>${escapeHtml(titleCase(row.product_form || "unspecified"))}</td>
      <td>${escapeHtml(formatNumber(row.quantity_kg))}</td>
      <td>${escapeHtml(formatOptionalNumber(row.unit_price_kes_kg))}</td>
      <td>${escapeHtml(formatOptionalNumber(row.amount_written_kes))}</td>
      <td>${escapeHtml(formatOptionalNumber(row.amount_variance_kes))}</td>
      <td class="${row.review_flags?.length ? "historical-review" : ""}" title="${escapeAttribute((row.review_flags || []).join(", "))}">${escapeHtml(reviewLabel(row))}</td>
      <td>${escapeHtml(row.source_entry_id || "-")}</td>
    </tr>
  `).join("") || emptyRow(12, "No historical records match these filters.");
}

async function loadMonthly() {
  setStatus("Loading monthly records...");
  try {
    const { data, error } = await authClient.rpc("ag_sec_historical_monthly_summary", {
      p_year: els.historicalMonthlyYear.value ? Number(els.historicalMonthlyYear.value) : null,
      p_community_key: els.historicalMonthlyCommunity.value || null
    });
    if (error) throw error;
    const rows = data?.rows || [];
    els.historicalMonthlyCount.textContent = `${rows.length} period${rows.length === 1 ? "" : "s"}`;
    els.historicalMonthlyRows.innerHTML = rows.map((row) => `
      <tr>
        <td><button type="button" class="link-button" data-month-period="${escapeAttribute(row.period_key)}">${escapeHtml(row.period_label || "-")}</button></td>
        <td>${escapeHtml(formatInteger(row.collection_count))}</td>
        <td>${escapeHtml(formatInteger(row.positive_quantity_count))}</td>
        <td>${escapeHtml(formatInteger(row.source_identity_count))}</td>
        <td>${escapeHtml(formatInteger(row.community_count))}</td>
        <td>${escapeHtml(formatInteger(row.seaweed_type_count))}</td>
        <td>${escapeHtml(formatNumber(row.total_weight_kg))}</td>
        <td>${escapeHtml(formatInteger(row.review_row_count))}</td>
        <td>${escapeHtml(dateRange(row.first_possible_date, row.last_possible_date))}</td>
      </tr>
    `).join("") || emptyRow(9, "No historical periods match these filters.");
    els.historicalMonthlyRows.querySelectorAll("[data-month-period]").forEach((button) => {
      button.addEventListener("click", () => {
        els.historicalPeriod.value = button.dataset.monthPeriod;
        els.historicalCommunity.value = els.historicalMonthlyCommunity.value;
        state.view = "all";
        state.page = 0;
        updateView();
        syncUrl();
        void loadRows();
      });
    });
    setStatus("");
  } catch (error) {
    els.historicalMonthlyRows.innerHTML = emptyRow(9, error.message || "Monthly records could not be loaded.");
    setStatus(error.message || "Monthly records could not be loaded.", "error");
  }
}

async function loadCommunities() {
  setStatus("Loading communities...");
  try {
    const { data, error } = await authClient.rpc("ag_sec_historical_community_summary", {
      p_search: els.historicalCommunitySearch.value.trim() || null
    });
    if (error) throw error;
    const rows = data?.rows || [];
    els.historicalCommunitiesCount.textContent = `${rows.length} communit${rows.length === 1 ? "y" : "ies"}`;
    els.historicalCommunityRows.innerHTML = rows.map((row) => `
      <tr data-community-key="${escapeAttribute(row.community_key)}" tabindex="0">
        <td><strong>${escapeHtml(row.source_group_name || "-")}</strong></td>
        <td>${escapeHtml([row.community_id, row.community_name].filter(Boolean).join(" - ") || "Review needed")}</td>
        <td>${escapeHtml(formatInteger(row.collection_count))}</td>
        <td>${escapeHtml(formatInteger(row.source_identity_count))}</td>
        <td>${escapeHtml(formatNumber(row.total_weight_kg))}</td>
        <td>${escapeHtml((row.seaweed_types || []).map(titleCase).join(", ") || "-")}</td>
        <td>${escapeHtml(formatInteger(row.day_precision_count))}</td>
        <td>${escapeHtml(formatInteger(row.month_precision_count))}</td>
        <td>${escapeHtml(formatInteger(row.year_precision_count))}</td>
        <td>${escapeHtml(formatInteger(row.date_review_count))}</td>
        <td>${escapeHtml(dateRange(row.first_possible_date, row.last_possible_date))}</td>
      </tr>
    `).join("") || emptyRow(11, "No communities match this search.");
    setStatus("");
  } catch (error) {
    els.historicalCommunityRows.innerHTML = emptyRow(11, error.message || "Community records could not be loaded.");
    setStatus(error.message || "Community records could not be loaded.", "error");
  }
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total || state.loading) return;
  state.page = next;
  void loadRows();
}

function updateLoadingState() {
  const start = state.total ? state.page * PAGE_SIZE + 1 : 0;
  const end = Math.min((state.page + 1) * PAGE_SIZE, state.total);
  els.historicalPageStatus.textContent = state.total ? `Rows ${start}-${end} of ${state.total}` : "No records";
  els.historicalFilteredCount.textContent = `${formatInteger(state.total)} record${state.total === 1 ? "" : "s"}`;
  els.historicalPreviousPage.disabled = state.loading || state.page === 0;
  els.historicalNextPage.disabled = state.loading || end >= state.total;
  els.loadHistoricalRows.disabled = state.loading;
  els.exportHistoricalCsv.disabled = state.loading;
}

async function exportCsv() {
  const originalText = els.exportHistoricalCsv.textContent;
  els.exportHistoricalCsv.disabled = true;
  els.exportHistoricalCsv.textContent = "Exporting...";
  try {
    const data = await loadRows({ returnData: true, limit: EXPORT_PAGE_SIZE, offset: 0, quiet: true });
    const columns = [
      ["ledger_date_raw", "Ledger date"],
      ["date_precision", "Date precision"],
      ["source_group_name", "Community"],
      ["community_id", "Mapped community ID"],
      ["source_member_id", "Source identity ID"],
      ["source_member_name", "Source identity name"],
      ["product_description_raw", "Product description"],
      ["seaweed_type", "Seaweed type"],
      ["product_form", "Product form"],
      ["quantity_kg", "Quantity kg"],
      ["unit_price_kes_kg", "Price per kg KES"],
      ["amount_written_kes", "Written amount KES"],
      ["amount_variance_kes", "Amount difference KES"],
      ["review_flags", "Review flags"],
      ["source_entry_id", "Source entry"]
    ];
    const lines = [
      columns.map(([, label]) => csvCell(label)).join(","),
      ...(data.rows || []).map((row) => columns.map(([key]) => csvCell(
        Array.isArray(row[key]) ? row[key].join("; ") : row[key]
      )).join(","))
    ];
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ledger-transcriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`Exported ${(data.rows || []).length} filtered records.`);
  } catch (error) {
    setStatus(error.message || "The export could not be created.", "error");
  } finally {
    els.exportHistoricalCsv.textContent = originalText;
    els.exportHistoricalCsv.disabled = false;
  }
}

function communityLabel(row) {
  return row.community_name
    ? `${row.source_group_name} (${row.community_name})`
    : `${row.source_group_name} (review needed)`;
}

function reviewLabel(row) {
  if (row.review_flags?.length) return row.review_flags.join(", ").replaceAll("_", " ");
  return row.verified_by ? "Verified" : "No flags";
}

function precisionLabel(value) {
  return value === "invalid" ? "review" : value || "unknown";
}

function dateRange(first, last) {
  if (!first && !last) return "-";
  const firstLabel = formatDate(first);
  const lastLabel = formatDate(last);
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} to ${lastLabel}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 2 })
    : "0";
}

function formatOptionalNumber(value) {
  return value === null || value === undefined || value === "" ? "-" : formatNumber(value);
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number).toLocaleString("en-KE") : "0";
}

function titleCase(value) {
  return String(value || "Unspecified")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function setConnectionStatus(message, className = "") {
  els.historicalConnectionStatus.textContent = message;
  els.historicalConnectionStatus.className = `status-pill ${className}`.trim();
}

function setStatus(message, type = "") {
  els.historicalRecordsStatus.textContent = message || "";
  if (type) els.historicalRecordsStatus.dataset.status = type;
  else delete els.historicalRecordsStatus.dataset.status;
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}
