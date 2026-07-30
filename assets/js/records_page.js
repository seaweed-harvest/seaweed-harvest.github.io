import {
  authClient,
  hasOrganisationCapability,
  requireAdminAccess
} from "./auth_client.js";
import { moonEvents } from "./moon_calendar.js";
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
    ["wet_pulp_kg", "Wet pulp kg"],
    ["pressed_liquid_l", "Liquid L"],
    ["dry_pulp_kg", "Dry pulp kg"],
    ["lost_seaweed_kg", "Lost kg"],
    ["number_of_presses", "Presses"],
    ["press_average_batch_kg", "Avg wet pulp/press kg"],
    ["wet_dry_ratio_percent", "Wet/dry %"],
    ["stock_product_ratio_percent", "Dry pulp/received %"],
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

const REPORTS = {
  process: {
    title: "Process records",
    monthlyColumns: [
      ["month_label", "Month", "month"],
      ["record_count", "Records", "integer"],
      ["species_count", "Species", "integer"],
      ["received_kg", "Received kg", "number"],
      ["wet_pulp_kg", "Wet pulp kg", "number"],
      ["liquid_l", "Liquid L", "number"],
      ["dry_pulp_kg", "Dry pulp kg", "number"],
      ["lost_kg", "Lost kg", "number"],
      ["press_count", "Presses", "integer"],
      ["avg_wet_dry_percent", "Avg wet/dry %", "number"],
      ["avg_stock_product_percent", "Avg dry pulp/received %", "number"],
      ["first_record_date", "First date", "date"],
      ["last_record_date", "Last date", "date"]
    ],
    metrics: [
      ["record_count", "Records", "integer"],
      ["received_kg", "Received", "kg"],
      ["liquid_l", "Liquid", "L"],
      ["dry_pulp_kg", "Dry pulp", "kg"],
      ["avg_wet_dry_percent", "Avg wet/dry", "%"]
    ]
  },
  site_sample: {
    title: "Site water samples",
    monthlyColumns: [
      ["month_label", "Month", "month"],
      ["record_count", "Samples", "integer"],
      ["community_count", "Communities", "integer"],
      ["avg_temperature_c", "Avg temp C", "number"],
      ["avg_salinity", "Avg salinity", "number"],
      ["avg_tds_mg_l", "Avg TDS mg/L", "number"],
      ["avg_ec_ms_cm", "Avg EC mS/cm", "number"],
      ["e_coli_sample_count", "E. coli samples", "integer"],
      ["first_record_date", "First sample", "date"],
      ["last_record_date", "Last sample", "date"]
    ],
    metrics: [
      ["record_count", "Samples", "integer"],
      ["community_count", "Communities", "integer"],
      ["avg_temperature_c", "Avg temperature", "C"],
      ["avg_salinity", "Avg salinity", ""],
      ["avg_tds_mg_l", "Avg TDS", "mg/L"],
      ["avg_ec_ms_cm", "Avg EC", "mS/cm"]
    ]
  },
  stock: {
    title: "Stock records",
    monthlyColumns: [
      ["month_label", "Month", "month"],
      ["record_count", "Records", "integer"],
      ["container_count", "Containers", "integer"],
      ["new_count", "New", "integer"],
      ["retest_count", "Retests", "integer"],
      ["total_volume_l", "Volume L", "number"],
      ["stabilised_count", "Stabilised", "integer"],
      ["avg_salinity", "Avg salinity", "number"],
      ["avg_ph", "Avg pH", "number"],
      ["avg_ec_ms_cm", "Avg EC mS/cm", "number"],
      ["first_record_date", "First date", "date"],
      ["last_record_date", "Last date", "date"]
    ],
    metrics: [
      ["record_count", "Records", "integer"],
      ["container_count", "Containers", "integer"],
      ["total_volume_l", "Volume", "L"],
      ["new_count", "New", "integer"],
      ["retest_count", "Retests", "integer"],
      ["stabilised_count", "Stabilised", "integer"]
    ]
  }
};

const CATEGORY_CAPABILITIES = {
  site_sample: "form_site_water_samples",
  intake: "form_intake_collection",
  stock: "form_stock_record",
  process: "form_process_record"
};

const state = {
  profile: null,
  category: "intake",
  mode: "all",
  rows: [],
  total: 0,
  page: 0,
  sort: "recorded_at",
  direction: "desc",
  loading: false,
  monthlyRows: [],
  monthlyTotals: {},
  dailyRows: [],
  selectedDay: "",
  dayRows: [],
  dayTotal: 0,
  dayPage: 0,
  communityRows: [],
  communityTotals: {},
  selectedCommunity: "",
  selectedCommunityName: "",
  communityRecordRows: [],
  communityRecordTotal: 0,
  communityRecordPage: 0,
  communities: [],
  species: [],
  selectedFormRecordIds: new Set(),
  editingFormRecordIds: new Set(),
  dirtyFormRecordIds: new Set(),
  formRecordDrafts: new Map(),
  formRecordOriginals: new Map(),
  operationalSummaryRows: [],
  operationalSummaryTotals: {}
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "operationalSummaryWorkspace", "operationalSummaryCount",
    "operationalSummaryGrouping", "operationalSummaryFrom", "operationalSummaryTo",
    "operationalSummaryCommunity", "loadOperationalSummary",
    "operationalSummaryScopeNote", "operationalSummaryTotals",
    "operationalSummaryRows", "operationalSummaryStatus",
    "collectionLedgerWorkspace", "formLedgerWorkspace",
    "formLedgerCount", "formLedgerCategories", "formLedgerViews", "formLedgerCommunityTab",
    "formLedgerAllPanel", "formLedgerMonthlyPanel", "formLedgerCommunityPanel",
    "formLedgerFrom", "formLedgerTo", "formLedgerSearch", "loadFormLedger",
    "exportFormLedger", "previousFormLedgerPage", "formLedgerPageStatus",
    "nextFormLedgerPage", "formLedgerHead", "formLedgerRows", "formLedgerStatus",
    "formLedgerEditActions", "formLedgerSelectedCount", "formLedgerStartEdit",
    "formLedgerSaveEdits", "formLedgerDiscardEdits", "formLedgerDeleteSelected",
    "formLedgerActionStatus",
    "formLedgerYear", "formLedgerMonthlyCommunityField", "formLedgerMonthlyCommunity",
    "loadFormLedgerMonthly", "formLedgerMonthlyTitle", "formLedgerMonthlyMetrics",
    "formLedgerMonthlyHead", "formLedgerMonthlyRows", "formLedgerCalendarStatus",
    "formLedgerCalendar", "formLedgerDayRecords", "formLedgerDayTitle",
    "formLedgerDayStatus", "formLedgerDayCount", "previousFormLedgerDayPage",
    "formLedgerDayPageStatus", "nextFormLedgerDayPage", "formLedgerDayHead",
    "formLedgerDayRows", "formLedgerCommunityFrom", "formLedgerCommunityTo",
    "loadFormLedgerCommunity", "formLedgerCommunityMetrics", "formLedgerCommunityRows",
    "formLedgerCommunityRecords", "formLedgerCommunityRecordsTitle",
    "formLedgerCommunityRecordsStatus", "formLedgerCommunityRecordsCount",
    "previousFormLedgerCommunityPage", "formLedgerCommunityPageStatus",
    "nextFormLedgerCommunityPage", "formLedgerCommunityRecordsHead",
    "formLedgerCommunityRecordRows"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  if (!els.formLedgerRows) return;

  const access = await requireAdminAccess("can_view_data");
  if (!access) return;
  state.profile = access.profile;

  setDateDefaults();
  readUrlState();
  if (!configureAvailableCategories(access.profile)) {
    window.location.replace("./access_pending.html");
    return;
  }
  bindEvents();
  try {
    const [communities, species] = await Promise.all([
      selectRows(
        "ag_secure_communities",
        "select=id,community_id,community_name&order=community_name.asc"
      ),
      selectRows(
        "ag_public_seaweed_type_settings",
        "select=type_key,label,common_name&order=display_order.asc"
      )
    ]);
    state.communities = communities;
    state.species = species;
    state.communities.forEach((community) => {
      const label = `${community.community_id} - ${community.community_name}`;
      els.formLedgerMonthlyCommunity.append(new Option(label, community.community_id));
      els.operationalSummaryCommunity.append(new Option(label, community.community_id));
    });
    const requestedCommunity = new URLSearchParams(window.location.search).get("community");
    if (requestedCommunity) els.formLedgerMonthlyCommunity.value = requestedCommunity;
    if (requestedCommunity) els.operationalSummaryCommunity.value = requestedCommunity;
    updateControls();
    await loadCurrentView();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function configureAvailableCategories(profile) {
  const available = ["summary", ...Object.entries(CATEGORY_CAPABILITIES)
    .filter(([, capability]) => hasOrganisationCapability(profile, capability))
    .map(([category]) => category)];

  els.formLedgerCategories.querySelectorAll("[data-ledger-category]").forEach((button) => {
    button.hidden = !available.includes(button.dataset.ledgerCategory);
  });
  if (!available.includes(state.category)) state.category = available[0] || "";
  return Boolean(state.category);
}

function bindEvents() {
  els.formLedgerCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ledger-category]");
    if (!button || state.loading || state.editingFormRecordIds.size) return;
    if (state.category === "intake") {
      const currentView = new URLSearchParams(window.location.search).get("view");
      if (["all", "monthly", "community"].includes(currentView)) state.mode = currentView;
    }
    state.category = button.dataset.ledgerCategory;
    resetFormRecordEditState();
    if (!["site_sample", "summary"].includes(state.category) && state.mode === "community") state.mode = "all";
    resetPages();
    updateControls();
    if (state.category === "intake") {
      activateIntakeView();
      return;
    }
    syncUrl();
    void loadCurrentView();
  });
  els.formLedgerViews.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ledger-mode]");
    if (!button || button.hidden || state.loading || state.editingFormRecordIds.size) return;
    state.mode = button.dataset.ledgerMode;
    resetFormRecordEditState();
    resetPages();
    updateControls();
    syncUrl();
    void loadCurrentView();
  });
  els.loadFormLedger.addEventListener("click", () => {
    resetFormRecordEditState();
    state.page = 0;
    syncUrl();
    void loadAllRecords();
  });
  els.loadFormLedgerMonthly.addEventListener("click", () => {
    state.selectedDay = "";
    state.dayPage = 0;
    syncUrl();
    void loadMonthlyReport();
  });
  els.loadFormLedgerCommunity.addEventListener("click", () => {
    state.selectedCommunity = "";
    state.communityRecordPage = 0;
    syncUrl();
    void loadCommunityReport();
  });
  els.formLedgerSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    resetFormRecordEditState();
    state.page = 0;
    syncUrl();
    void loadAllRecords();
  });
  els.previousFormLedgerPage.addEventListener("click", () => changeAllPage(-1));
  els.nextFormLedgerPage.addEventListener("click", () => changeAllPage(1));
  els.previousFormLedgerDayPage.addEventListener("click", () => changeDayPage(-1));
  els.nextFormLedgerDayPage.addEventListener("click", () => changeDayPage(1));
  els.previousFormLedgerCommunityPage.addEventListener("click", () => changeCommunityPage(-1));
  els.nextFormLedgerCommunityPage.addEventListener("click", () => changeCommunityPage(1));
  els.formLedgerCalendar.addEventListener("click", selectCalendarDay);
  els.formLedgerCommunityRows.addEventListener("click", selectCommunity);
  els.formLedgerHead.addEventListener("click", (event) => {
    const button = event.target.closest("[data-form-ledger-sort]");
    if (!button || state.editingFormRecordIds.size) return;
    const field = button.dataset.formLedgerSort;
    if (state.sort === field) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.sort = field;
      state.direction = field.includes("date") || field.includes("time") ? "desc" : "asc";
    }
    sortRows();
    renderAllRows();
  });
  els.formLedgerRows.addEventListener("change", handleFormRecordTableChange);
  els.formLedgerRows.addEventListener("input", handleFormRecordDraftInput);
  els.formLedgerStartEdit.addEventListener("click", startFormRecordEdit);
  els.formLedgerSaveEdits.addEventListener("click", saveFormRecordEdits);
  els.formLedgerDiscardEdits.addEventListener("click", discardFormRecordEdits);
  els.formLedgerDeleteSelected.addEventListener("click", deleteSelectedFormRecords);
  els.exportFormLedger.addEventListener("click", exportCsv);
  els.loadOperationalSummary.addEventListener("click", () => {
    syncUrl();
    void loadOperationalSummary();
  });
}

function setDateDefaults() {
  const end = kenyaDate();
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  const start = isoDate(startDate);
  els.formLedgerFrom.value = start;
  els.formLedgerTo.value = end;
  els.formLedgerCommunityFrom.value = start;
  els.formLedgerCommunityTo.value = end;
  els.formLedgerYear.value = end.slice(0, 4);
  els.operationalSummaryFrom.value = `${end.slice(0, 4)}-01-01`;
  els.operationalSummaryTo.value = end;
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (["summary", "intake", "process", "site_sample", "stock"].includes(params.get("category"))) {
    state.category = params.get("category");
  }
  if (["all", "monthly", "community"].includes(params.get("view"))) {
    state.mode = params.get("view");
  }
  if (state.category !== "site_sample" && state.mode === "community") state.mode = "all";
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "")) {
    els.formLedgerFrom.value = params.get("from");
    els.formLedgerCommunityFrom.value = params.get("from");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "")) {
    els.formLedgerTo.value = params.get("to");
    els.formLedgerCommunityTo.value = params.get("to");
  }
  if (/^\d{4}$/.test(params.get("year") || "")) els.formLedgerYear.value = params.get("year");
  els.formLedgerSearch.value = params.get("search") || "";
  if (["week", "month", "year"].includes(params.get("grouping"))) {
    els.operationalSummaryGrouping.value = params.get("grouping");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("summary_from") || "")) {
    els.operationalSummaryFrom.value = params.get("summary_from");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("summary_to") || "")) {
    els.operationalSummaryTo.value = params.get("summary_to");
  }
}

function updateControls() {
  els.formLedgerCategories.querySelectorAll("[data-ledger-category]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.ledgerCategory === state.category));
  });
  const summarySelected = state.category === "summary";
  const intakeSelected = state.category === "intake";
  els.operationalSummaryWorkspace.hidden = !summarySelected;
  els.collectionLedgerWorkspace.hidden = !intakeSelected;
  els.formLedgerWorkspace.hidden = summarySelected || intakeSelected;
  if (summarySelected || intakeSelected) return;

  els.formLedgerViews.querySelectorAll("[data-ledger-mode]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.ledgerMode === state.mode));
  });
  const communityAvailable = state.category === "site_sample";
  els.formLedgerCommunityTab.hidden = !communityAvailable;
  els.formLedgerAllPanel.hidden = state.mode !== "all";
  els.formLedgerMonthlyPanel.hidden = state.mode !== "monthly";
  els.formLedgerCommunityPanel.hidden = state.mode !== "community";
  els.formLedgerMonthlyCommunityField.hidden = !communityAvailable;
  els.formLedgerMonthlyTitle.textContent = `${REPORTS[state.category].title} by month`;
  els.formLedgerCount.textContent = "Loading";
}

async function loadCurrentView() {
  if (state.category === "summary") {
    await loadOperationalSummary();
    return;
  }
  if (state.category === "intake") return;
  if (state.mode === "monthly") await loadMonthlyReport();
  else if (state.mode === "community") await loadCommunityReport();
  else await loadAllRecords();
}

async function loadAllRecords() {
  const range = selectedDateRange(els.formLedgerFrom, els.formLedgerTo);
  if (!range) return;
  state.loading = true;
  setLoading(true);
  setStatus("Loading records...");
  try {
    const result = await ledgerRpc(range, null, els.formLedgerSearch.value.trim() || null, state.page);
    state.rows = result.rows;
    state.total = result.total;
    if (state.page > 0 && !state.rows.length && state.total > 0) {
      state.page = Math.max(0, Math.ceil(state.total / PAGE_SIZE) - 1);
      state.loading = false;
      await loadAllRecords();
      return;
    }
    sortRows();
    renderAllHead();
    renderAllRows();
    setStatus("");
  } catch (error) {
    state.rows = [];
    state.total = 0;
    renderAllHead();
    renderAllRows(error.message || "Records could not be loaded.");
    setStatus(error.message, "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

async function loadMonthlyReport() {
  const year = Number(els.formLedgerYear.value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    setStatus("Enter a valid reporting year.", "error");
    return;
  }
  state.loading = true;
  setLoading(true);
  setStatus("Loading monthly report...");
  els.formLedgerCount.textContent = "Loading";
  try {
    const activityRange = calendarRange(new Date());
    const communityId = state.category === "site_sample"
      ? (els.formLedgerMonthlyCommunity.value || null)
      : null;
    const [yearReport, activityReport] = await Promise.all([
      summaryRpc(`${year}-01-01`, `${year}-12-31`, communityId),
      summaryRpc(activityRange.start, activityRange.end, communityId)
    ]);
    state.monthlyRows = yearReport.monthlyRows;
    state.monthlyTotals = yearReport.totals;
    state.dailyRows = activityReport.dailyRows;
    renderMonthlyMetrics();
    renderMonthlyTable();
    renderCalendar();
    if (state.selectedDay) await loadDayRecords({ quiet: true });
    setStatus("");
  } catch (error) {
    state.monthlyRows = [];
    state.monthlyTotals = {};
    state.dailyRows = [];
    renderMonthlyMetrics();
    renderMonthlyTable(error.message);
    renderCalendar();
    setStatus(error.message, "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

async function loadCommunityReport() {
  const range = selectedDateRange(els.formLedgerCommunityFrom, els.formLedgerCommunityTo);
  if (!range) return;
  state.loading = true;
  setLoading(true);
  setStatus("Loading community report...");
  els.formLedgerCount.textContent = "Loading";
  try {
    const report = await summaryRpc(range.start, range.end, null);
    state.communityRows = report.communityRows;
    state.communityTotals = report.totals;
    renderCommunityMetrics();
    renderCommunityRows();
    if (state.selectedCommunity) await loadCommunityRecords({ quiet: true });
    setStatus("");
  } catch (error) {
    state.communityRows = [];
    state.communityTotals = {};
    renderCommunityMetrics();
    renderCommunityRows(error.message);
    setStatus(error.message, "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

async function ledgerRpc(range, communityId, search, page) {
  const { data, error } = await authClient.rpc("ag_form_record_ledger", {
    p_record_type: state.category,
    p_start_date: range.start,
    p_end_date: range.end,
    p_community_id: communityId,
    p_search: search,
    p_page_limit: PAGE_SIZE,
    p_page_offset: page * PAGE_SIZE
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    rows: Array.isArray(result?.rows) ? result.rows : [],
    total: Number(result?.total_count || 0)
  };
}

async function summaryRpc(start, end, communityId) {
  const { data, error } = await authClient.rpc("ag_form_record_summary", {
    p_record_type: state.category,
    p_start_date: start,
    p_end_date: end,
    p_community_id: communityId
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    totals: result?.totals || {},
    monthlyRows: Array.isArray(result?.monthly_rows) ? result.monthly_rows : [],
    dailyRows: Array.isArray(result?.daily_rows) ? result.daily_rows : [],
    communityRows: Array.isArray(result?.community_rows) ? result.community_rows : []
  };
}

function renderAllHead(target = els.formLedgerHead) {
  const managed = target === els.formLedgerHead && canManageFormRecords();
  target.innerHTML = `<tr>${managed ? `
    <th class="selection-cell">
      <input id="formLedgerSelectAll" type="checkbox" aria-label="Select all editable records on this page">
    </th>` : ""}${COLUMNS[state.category].map(([field, label]) => `
    <th aria-sort="${state.sort === field ? (state.direction === "asc" ? "ascending" : "descending") : "none"}">
      <button type="button" data-form-ledger-sort="${escapeAttribute(field)}">${escapeHtml(label)}${state.sort === field ? ` ${state.direction === "asc" ? "up" : "down"}` : ""}</button>
    </th>`).join("")}</tr>`;
  if (managed) {
    document.getElementById("formLedgerSelectAll")?.addEventListener("change", toggleAllFormRecords);
  }
}

async function loadOperationalSummary() {
  const range = selectedDateRange(els.operationalSummaryFrom, els.operationalSummaryTo);
  if (!range) return;
  state.loading = true;
  setLoading(true);
  setOperationalSummaryStatus("Loading summary...");
  els.operationalSummaryCount.textContent = "Loading";
  try {
    const communityId = els.operationalSummaryCommunity.value || null;
    const { data, error } = await authClient.rpc("ag_sec_operational_summary", {
      p_start_date: range.start,
      p_end_date: range.end,
      p_grouping: els.operationalSummaryGrouping.value,
      p_community_id: communityId
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    state.operationalSummaryRows = Array.isArray(result?.rows) ? result.rows : [];
    state.operationalSummaryTotals = result?.totals || {};
    renderOperationalSummary();
    setOperationalSummaryStatus("");
  } catch (error) {
    state.operationalSummaryRows = [];
    state.operationalSummaryTotals = {};
    renderOperationalSummary(error.message || "Summary could not be loaded.");
    setOperationalSummaryStatus(error.message || "Summary could not be loaded.", "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

function renderOperationalSummary(errorMessage = "") {
  const rows = state.operationalSummaryRows;
  els.operationalSummaryCount.textContent = `${rows.length} period${rows.length === 1 ? "" : "s"}`;
  els.operationalSummaryScopeNote.hidden = !els.operationalSummaryCommunity.value;
  renderOperationalSummaryTotals();
  if (errorMessage || !rows.length) {
    els.operationalSummaryRows.innerHTML = emptyRow(
      21,
      errorMessage || "No records were found in this period."
    );
    return;
  }
  els.operationalSummaryRows.innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(summaryPeriodLabel(row))}</strong></td>
      <td>${escapeHtml(formatNumber(row.intake_weight_kg))}</td>
      <td>${escapeHtml(formatNumber(row.intake_value_ksh))}</td>
      <td>${escapeHtml(formatNumber(row.grade_a_kg))}</td>
      <td>${escapeHtml(formatNumber(row.grade_b_kg))}</td>
      <td>${escapeHtml(formatNumber(row.grade_c_kg))}</td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatInteger(row.farmer_count))}</td>
      <td title="${escapeAttribute(row.intake_community_names || "")}">${escapeHtml(formatInteger(row.community_count))}</td>
      <td>${escapeHtml(formatInteger(row.site_sample_count))}</td>
      <td title="${escapeAttribute(row.site_locations || "")}">${escapeHtml(row.site_locations || "-")}</td>
      <td>${escapeHtml(formatNumber(row.stock_volume_l))}</td>
      <td>${escapeHtml(formatInteger(row.stock_container_count))}</td>
      <td>${escapeHtml(formatInteger(row.stock_qc_container_count))}</td>
      <td>${escapeHtml(formatNumber(row.process_received_kg))}</td>
      <td>${escapeHtml(formatNumber(row.process_pressed_liquid_l))}</td>
      <td>${escapeHtml(formatNumber(row.process_lost_kg))}</td>
      <td>${escapeHtml(formatDuration(row.process_minutes))}</td>
      <td>${escapeHtml(formatInteger(row.process_press_count))}</td>
      <td>${escapeHtml(formatNumber(row.process_avg_wet_pulp_per_press))}</td>
      <td>${escapeHtml(formatRatio(row.stock_l_per_intake_kg))}</td>
    </tr>`).join("");
}

function renderOperationalSummaryTotals() {
  const total = state.operationalSummaryTotals;
  const metrics = [
    ["Intake", total.intake_weight_kg, "kg"],
    ["Value", total.intake_value_ksh, "KSH"],
    ["Site samples", total.site_sample_count, ""],
    ["Stock", total.stock_volume_l, "L"],
    ["Processed", total.process_received_kg, "kg"],
    ["Processing time", formatDuration(total.process_minutes), ""]
  ];
  els.operationalSummaryTotals.innerHTML = metrics.map(([label, value, unit]) => `
    <div class="form-ledger-metric">
      <span>${escapeHtml(label)}</span>
      <div class="form-ledger-value">
        <strong>${typeof value === "string" ? escapeHtml(value) : escapeHtml(formatNumber(value))}</strong>
        ${unit ? `<small>${escapeHtml(unit)}</small>` : ""}
      </div>
    </div>`).join("");
}

function summaryPeriodLabel(row) {
  const grouping = els.operationalSummaryGrouping.value;
  if (grouping === "year") return String(row.period_start || "").slice(0, 4);
  if (grouping === "month") {
    const [year, month] = String(row.period_start || "").split("-").map(Number);
    if (year && month) {
      return new Intl.DateTimeFormat("en-GB", {
        month: "short", year: "numeric"
      }).format(new Date(Date.UTC(year, month - 1, 1)));
    }
  }
  return `${formatDate(row.period_start)} - ${formatDate(row.period_end)}`;
}

function renderAllRows(errorMessage = "") {
  const columns = COLUMNS[state.category];
  const managed = canManageFormRecords();
  els.formLedgerCount.textContent = rowCount(state.total);
  if (errorMessage || !state.rows.length) {
    els.formLedgerRows.innerHTML = emptyRow(
      columns.length + (managed ? 1 : 0),
      errorMessage || "No records match the current filters."
    );
  } else {
    els.formLedgerRows.innerHTML = recordRowsHtml(state.rows, { managed });
  }
  renderPageStatus(
    state.page,
    state.total,
    els.formLedgerPageStatus,
    els.previousFormLedgerPage,
    els.nextFormLedgerPage
  );
  updateFormRecordSelectionUi();
}

function renderMonthlyMetrics() {
  els.formLedgerMonthlyMetrics.innerHTML = metricsHtml(
    REPORTS[state.category].metrics,
    state.monthlyTotals
  );
}

function renderMonthlyTable(errorMessage = "") {
  const columns = REPORTS[state.category].monthlyColumns;
  const total = Number(state.monthlyTotals.record_count || 0);
  els.formLedgerCount.textContent = rowCount(total);
  els.formLedgerMonthlyHead.innerHTML = `<tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>`;
  if (errorMessage || !state.monthlyRows.length) {
    els.formLedgerMonthlyRows.innerHTML = emptyRow(columns.length, errorMessage || "No monthly records for this year.");
    return;
  }
  els.formLedgerMonthlyRows.innerHTML = state.monthlyRows.map((row) => `
    <tr>${columns.map(([field, , type]) => `<td>${escapeHtml(reportValue(row[field], type))}</td>`).join("")}</tr>
  `).join("");
}

function renderCalendar() {
  const now = new Date();
  const today = kenyaDate();
  const months = calendarMonthKeys(now);
  const range = calendarRange(now);
  const counts = new Map(state.dailyRows.map((row) => [
    String(row.record_date),
    Number(row.record_count || 0)
  ]));
  const moons = new Map(moonEvents(
    new Date(`${range.start}T00:00:00Z`),
    new Date(`${range.end}T00:00:00Z`)
  ).map((event) => [isoDate(event.date), event]));

  els.formLedgerCalendar.innerHTML = months.map((monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mondayOffset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const cells = Array.from(
      { length: mondayOffset },
      () => '<span class="collection-calendar-day empty" aria-hidden="true"></span>'
    );
    for (let day = 1; day <= days; day += 1) {
      const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
      const count = counts.get(dateKey) || 0;
      const moon = moons.get(dateKey);
      const detail = [
        formatDate(dateKey),
        count ? `${count} ${count === 1 ? "record" : "records"}` : "No records",
        moon?.label || ""
      ].filter(Boolean).join(". ");
      const classes = [
        "collection-calendar-day",
        count ? "has-collections" : "",
        dateKey === today ? "today" : "",
        dateKey === state.selectedDay ? "selected" : ""
      ].filter(Boolean).join(" ");
      cells.push(`
        <button class="${classes}" type="button" data-form-record-date="${dateKey}" title="${escapeAttribute(detail)}" aria-label="${escapeAttribute(detail)}" aria-pressed="${dateKey === state.selectedDay}">
          <span class="collection-calendar-date">${day}</span>
          ${count ? `<strong class="collection-calendar-count">${formatInteger(count)}</strong>` : ""}
          ${moon ? `<i class="collection-calendar-moon ${escapeAttribute(moon.type)}" aria-hidden="true">${moon.type === "full" ? "&#127765;" : "&#127761;"}</i>` : ""}
        </button>
      `);
    }
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
      month: "long", year: "numeric", timeZone: "UTC"
    });
    return `
      <section class="collection-calendar-month" aria-label="${escapeAttribute(label)}">
        <h4>${escapeHtml(label)}</h4>
        <div class="collection-calendar-weekdays" aria-hidden="true">
          <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
        </div>
        <div class="collection-calendar-days">${cells.join("")}</div>
      </section>
    `;
  }).join("");
  const total = state.dailyRows.reduce((sum, row) => sum + Number(row.record_count || 0), 0);
  els.formLedgerCalendarStatus.textContent = total
    ? `${formatInteger(total)} records across ${formatInteger(state.dailyRows.length)} record days.`
    : "No records in the latest four months for these filters.";
}

function selectCalendarDay(event) {
  const button = event.target.closest("[data-form-record-date]");
  if (!button) return;
  state.selectedDay = button.dataset.formRecordDate;
  state.dayPage = 0;
  renderCalendar();
  void loadDayRecords();
}

async function loadDayRecords(options = {}) {
  if (!state.selectedDay) return;
  els.formLedgerDayRecords.hidden = false;
  els.formLedgerDayTitle.textContent = `${REPORTS[state.category].title} for ${formatDate(state.selectedDay)}`;
  if (!options.quiet) els.formLedgerDayStatus.textContent = "Loading records...";
  try {
    const result = await ledgerRpc(
      { start: state.selectedDay, end: state.selectedDay },
      state.category === "site_sample" ? (els.formLedgerMonthlyCommunity.value || null) : null,
      null,
      state.dayPage
    );
    state.dayRows = result.rows;
    state.dayTotal = result.total;
    renderAllHead(els.formLedgerDayHead);
    els.formLedgerDayRows.innerHTML = state.dayRows.length
      ? recordRowsHtml(state.dayRows)
      : emptyRow(COLUMNS[state.category].length, "No records were saved on this day.");
    els.formLedgerDayCount.textContent = rowCount(state.dayTotal);
    renderPageStatus(
      state.dayPage,
      state.dayTotal,
      els.formLedgerDayPageStatus,
      els.previousFormLedgerDayPage,
      els.nextFormLedgerDayPage
    );
    els.formLedgerDayStatus.textContent = state.dayTotal
      ? "Select another calendar day to replace these records."
      : "No records for this date.";
  } catch (error) {
    state.dayRows = [];
    state.dayTotal = 0;
    renderAllHead(els.formLedgerDayHead);
    els.formLedgerDayRows.innerHTML = emptyRow(COLUMNS[state.category].length, error.message);
    els.formLedgerDayCount.textContent = "Error";
    els.formLedgerDayStatus.textContent = error.message;
  }
}

function renderCommunityMetrics() {
  els.formLedgerCommunityMetrics.innerHTML = metricsHtml(
    REPORTS.site_sample.metrics,
    state.communityTotals
  );
}

function renderCommunityRows(errorMessage = "") {
  els.formLedgerCount.textContent = `${state.communityRows.length} ${state.communityRows.length === 1 ? "community" : "communities"}`;
  if (errorMessage || !state.communityRows.length) {
    els.formLedgerCommunityRows.innerHTML = emptyRow(9, errorMessage || "No community samples match this period.");
    return;
  }
  els.formLedgerCommunityRows.innerHTML = state.communityRows.map((row) => `
    <tr>
      <td><button class="ledger-summary-link" type="button" data-form-community="${escapeAttribute(row.community_id || "")}" data-form-community-name="${escapeAttribute(row.community_name || "")}">${escapeHtml([row.community_id, row.community_name].filter(Boolean).join(" - ") || "Unknown")}</button></td>
      <td>${escapeHtml(formatInteger(row.record_count))}</td>
      <td>${escapeHtml(formatNumber(row.avg_temperature_c))}</td>
      <td>${escapeHtml(formatNumber(row.avg_salinity))}</td>
      <td>${escapeHtml(formatNumber(row.avg_tds_mg_l))}</td>
      <td>${escapeHtml(formatNumber(row.avg_ec_ms_cm))}</td>
      <td>${escapeHtml(formatInteger(row.e_coli_sample_count))}</td>
      <td>${escapeHtml(formatDate(row.first_record_date))}</td>
      <td>${escapeHtml(formatDate(row.last_record_date))}</td>
    </tr>
  `).join("");
}

function selectCommunity(event) {
  const button = event.target.closest("[data-form-community]");
  if (!button) return;
  state.selectedCommunity = button.dataset.formCommunity;
  state.selectedCommunityName = button.dataset.formCommunityName;
  state.communityRecordPage = 0;
  void loadCommunityRecords();
}

async function loadCommunityRecords(options = {}) {
  if (!state.selectedCommunity) return;
  const range = selectedDateRange(els.formLedgerCommunityFrom, els.formLedgerCommunityTo);
  if (!range) return;
  els.formLedgerCommunityRecords.hidden = false;
  els.formLedgerCommunityRecordsTitle.textContent = `${state.selectedCommunityName || state.selectedCommunity} samples`;
  if (!options.quiet) els.formLedgerCommunityRecordsStatus.textContent = "Loading records...";
  try {
    const result = await ledgerRpc(range, state.selectedCommunity, null, state.communityRecordPage);
    state.communityRecordRows = result.rows;
    state.communityRecordTotal = result.total;
    renderAllHead(els.formLedgerCommunityRecordsHead);
    els.formLedgerCommunityRecordRows.innerHTML = state.communityRecordRows.length
      ? recordRowsHtml(state.communityRecordRows)
      : emptyRow(COLUMNS.site_sample.length, "No samples match this community and period.");
    els.formLedgerCommunityRecordsCount.textContent = rowCount(state.communityRecordTotal);
    renderPageStatus(
      state.communityRecordPage,
      state.communityRecordTotal,
      els.formLedgerCommunityPageStatus,
      els.previousFormLedgerCommunityPage,
      els.nextFormLedgerCommunityPage
    );
    els.formLedgerCommunityRecordsStatus.textContent = "Select another community to replace these records.";
  } catch (error) {
    state.communityRecordRows = [];
    state.communityRecordTotal = 0;
    renderAllHead(els.formLedgerCommunityRecordsHead);
    els.formLedgerCommunityRecordRows.innerHTML = emptyRow(COLUMNS.site_sample.length, error.message);
    els.formLedgerCommunityRecordsCount.textContent = "Error";
    els.formLedgerCommunityRecordsStatus.textContent = error.message;
  }
}

function recordRowsHtml(rows, options = {}) {
  const columns = COLUMNS[state.category];
  return rows.map((row) => {
    const id = String(row.id || "");
    const editing = options.managed && state.editingFormRecordIds.has(id);
    const dirty = options.managed && state.dirtyFormRecordIds.has(id);
    const draft = state.formRecordDrafts.get(id) || formRecordDraft(row);
    const classes = [
      editing ? "today-row-editing" : "",
      dirty ? "today-row-dirty" : ""
    ].filter(Boolean).join(" ");
    const selection = options.managed
      ? `<td class="selection-cell"><input type="checkbox" data-form-ledger-select="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(recordReference(row))}"${state.selectedFormRecordIds.has(id) ? " checked" : ""}${editing ? " disabled" : ""}></td>`
      : "";
    return `
      <tr data-form-ledger-row="${escapeAttribute(id)}" class="${classes}">
        ${selection}
        ${columns.map(([field, label]) => `<td>${editing
          ? formRecordEditor(row, field, label, draft)
          : escapeHtml(cellValue(row, field))}</td>`).join("")}
      </tr>`;
  }).join("");
}

function handleFormRecordTableChange(event) {
  const checkbox = event.target.closest("[data-form-ledger-select]");
  if (checkbox) {
    if (state.editingFormRecordIds.size) return;
    const id = checkbox.dataset.formLedgerSelect;
    if (checkbox.checked) state.selectedFormRecordIds.add(id);
    else state.selectedFormRecordIds.delete(id);
    updateFormRecordSelectionUi();
    return;
  }
  handleFormRecordDraftInput(event);
}

function handleFormRecordDraftInput(event) {
  const control = event.target.closest("[data-form-ledger-field]");
  if (!control) return;
  const id = control.dataset.formLedgerId;
  const draft = state.formRecordDrafts.get(id);
  if (!draft || !state.editingFormRecordIds.has(id)) return;
  draft[control.dataset.formLedgerField] = control.value;
  const original = state.formRecordOriginals.get(id);
  const dirty = !draftsEqual(draft, original);
  if (dirty) state.dirtyFormRecordIds.add(id);
  else state.dirtyFormRecordIds.delete(id);
  const row = els.formLedgerRows.querySelector(
    `[data-form-ledger-row="${cssEscape(id)}"]`
  );
  row?.classList.toggle("today-row-dirty", dirty);
  updateFormRecordSelectionUi();
}

function toggleAllFormRecords(event) {
  if (state.editingFormRecordIds.size || !canManageFormRecords()) return;
  state.selectedFormRecordIds.clear();
  if (event.currentTarget.checked) {
    state.rows.forEach((row) => {
      if (row.id) state.selectedFormRecordIds.add(String(row.id));
    });
  }
  renderAllRows();
}

function updateFormRecordSelectionUi() {
  if (!els.formLedgerEditActions) return;
  const canManage = canManageFormRecords();
  const selected = state.selectedFormRecordIds.size;
  const editing = state.editingFormRecordIds.size > 0;
  const dirty = state.dirtyFormRecordIds.size;
  els.formLedgerEditActions.hidden = !canManage || (!selected && !editing);
  els.formLedgerSelectedCount.textContent = `${selected} selected`;
  els.formLedgerStartEdit.hidden = editing;
  els.formLedgerStartEdit.disabled = !selected;
  els.formLedgerStartEdit.textContent = selected > 1 ? `Edit ${selected}` : "Edit";
  els.formLedgerSaveEdits.hidden = !editing;
  els.formLedgerSaveEdits.disabled = !dirty;
  els.formLedgerSaveEdits.textContent = dirty > 1 ? `Save ${dirty}` : "Save";
  els.formLedgerDiscardEdits.hidden = !editing;
  els.formLedgerDeleteSelected.hidden = editing;
  els.formLedgerDeleteSelected.disabled = !selected;
  els.formLedgerDeleteSelected.textContent = selected > 1 ? `Delete ${selected}` : "Delete";

  const selectAll = document.getElementById("formLedgerSelectAll");
  if (selectAll) {
    const eligible = state.rows.filter((row) => row.id);
    const selectedEligible = eligible.filter((row) => (
      state.selectedFormRecordIds.has(String(row.id))
    )).length;
    selectAll.checked = eligible.length > 0 && selectedEligible === eligible.length;
    selectAll.indeterminate = selectedEligible > 0 && selectedEligible < eligible.length;
    selectAll.disabled = editing || !eligible.length;
  }

  [
    els.formLedgerFrom, els.formLedgerTo, els.formLedgerSearch, els.loadFormLedger,
    els.exportFormLedger, els.previousFormLedgerPage, els.nextFormLedgerPage
  ].forEach((control) => {
    if (control) control.disabled = editing;
  });
  els.formLedgerCategories.querySelectorAll("[data-ledger-category]").forEach((button) => {
    button.disabled = editing;
  });
  els.formLedgerViews.querySelectorAll("[data-ledger-mode]").forEach((button) => {
    button.disabled = editing;
  });
  els.formLedgerHead.querySelectorAll("[data-form-ledger-sort]").forEach((button) => {
    button.disabled = editing;
  });
}

function startFormRecordEdit() {
  if (!canManageFormRecords() || !state.selectedFormRecordIds.size) return;
  state.editingFormRecordIds = new Set(state.selectedFormRecordIds);
  state.dirtyFormRecordIds.clear();
  state.formRecordDrafts.clear();
  state.formRecordOriginals.clear();
  state.rows.forEach((row) => {
    const id = String(row.id || "");
    if (!state.editingFormRecordIds.has(id)) return;
    const draft = formRecordDraft(row);
    state.formRecordDrafts.set(id, structuredClone(draft));
    state.formRecordOriginals.set(id, structuredClone(draft));
  });
  renderAllRows();
  setFormRecordActionStatus(
    `Editing ${state.editingFormRecordIds.size} selected record${state.editingFormRecordIds.size === 1 ? "" : "s"}.`
  );
  els.formLedgerRows.querySelector("[data-form-ledger-field]")?.focus();
}

function discardFormRecordEdits() {
  resetFormRecordEditState();
  renderAllHead();
  renderAllRows();
  setFormRecordActionStatus("Changes discarded. Nothing was saved.");
}

async function saveFormRecordEdits() {
  const invalid = [...els.formLedgerRows.querySelectorAll("[data-form-ledger-field]")]
    .find((control) => !control.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return;
  }
  const updates = state.rows
    .filter((row) => state.dirtyFormRecordIds.has(String(row.id)))
    .map((row) => serializeFormRecordDraft(
      row,
      state.formRecordDrafts.get(String(row.id))
    ));
  if (!updates.length) return;

  els.formLedgerSaveEdits.disabled = true;
  els.formLedgerDiscardEdits.disabled = true;
  setFormRecordActionStatus(`Saving ${updates.length} record${updates.length === 1 ? "" : "s"}...`);
  const { data, error } = await authClient.rpc("ag_update_daily_form_records", {
    p_record_type: state.category,
    p_updates: updates
  });
  if (error) {
    setFormRecordActionStatus(error.message || "Changes could not be saved.", "error");
    els.formLedgerSaveEdits.disabled = false;
    els.formLedgerDiscardEdits.disabled = false;
    return;
  }

  const updated = Number(data?.updated_count || updates.length);
  resetFormRecordEditState();
  await loadAllRecords();
  setFormRecordActionStatus(`${updated} record${updated === 1 ? "" : "s"} saved.`);
}

async function deleteSelectedFormRecords() {
  if (!canManageFormRecords() || state.editingFormRecordIds.size) return;
  const ids = state.rows
    .filter((row) => state.selectedFormRecordIds.has(String(row.id)))
    .map((row) => row.id);
  if (!ids.length) return;
  const label = `${ids.length} record${ids.length === 1 ? "" : "s"}`;
  if (!window.confirm(`Delete ${label}? ${ids.length === 1 ? "It" : "They"} will remain in Deleted Records for 30 days.`)) return;

  els.formLedgerDeleteSelected.disabled = true;
  setFormRecordActionStatus(`Deleting ${label}...`);
  const { data, error } = await authClient.rpc("ag_delete_daily_form_records", {
    p_record_type: state.category,
    p_record_ids: ids
  });
  if (error) {
    setFormRecordActionStatus(error.message || "Selected records could not be deleted.", "error");
    els.formLedgerDeleteSelected.disabled = false;
    return;
  }

  const deleted = Number(data?.deleted_count || ids.length);
  if (state.page > 0 && deleted === state.rows.length) state.page -= 1;
  resetFormRecordEditState();
  await loadAllRecords();
  setFormRecordActionStatus(
    `${deleted} record${deleted === 1 ? "" : "s"} moved to Deleted Records.`
  );
}

function formRecordDraft(row) {
  if (state.category === "process") {
    return {
      process_date: row.record_date || "",
      start_time: shortTime(row.start_time),
      end_time: shortTime(row.end_time),
      species: row.species || "",
      received_seaweed_kg: nullableValue(row.received_seaweed_kg),
      wet_pulp_kg: nullableValue(row.wet_pulp_kg),
      pressed_liquid_l: nullableValue(row.pressed_liquid_l),
      dry_pulp_kg: nullableValue(row.dry_pulp_kg),
      lost_seaweed_kg: nullableValue(row.lost_seaweed_kg),
      number_of_presses: nullableValue(row.number_of_presses),
      recorded_by_name: row.recorded_by_name || "",
      notes: row.notes || ""
    };
  }
  if (state.category === "site_sample") {
    return {
      sampled_at: dateTimeInputValue(row.recorded_at),
      tide_stage: row.tide_stage || "",
      temperature_c: nullableValue(row.temperature_c),
      salinity_value: nullableValue(row.salinity_value),
      salinity_unit: row.salinity_unit || "PSU",
      tds_value: nullableValue(row.tds_value),
      tds_unit: row.tds_unit || "mg/L",
      electrical_conductivity_ms_cm: nullableValue(row.electrical_conductivity_ms_cm),
      e_coli_sample_taken: row.e_coli_sample_taken === null
        || row.e_coli_sample_taken === undefined
        ? ""
        : String(Boolean(row.e_coli_sample_taken)),
      recorded_by_name: row.recorded_by_name || "",
      notes: row.notes || ""
    };
  }
  return {
    packed_on: row.record_date || "",
    carton_serial: row.record_number || "",
    species: row.species || "",
    weight_value: nullableValue(row.weight_value),
    weight_unit: row.weight_unit || "L",
    stabilizer_added: row.stabilizer_added === null
      || row.stabilizer_added === undefined
      ? ""
      : String(Boolean(row.stabilizer_added)),
    chemical_dose_value: nullableValue(row.chemical_dose_value),
    chemical_dose_unit: row.chemical_dose_unit || "g/container",
    salinity_value: nullableValue(row.salinity_value),
    salinity_unit: row.salinity_unit || "PSU",
    ph_value: nullableValue(row.ph_value),
    electrical_conductivity_ms_cm: nullableValue(row.electrical_conductivity_ms_cm),
    recorded_by_name: row.recorded_by_name || "",
    notes: row.notes || ""
  };
}

function serializeFormRecordDraft(row, draft) {
  const base = { id: row.id, expected_updated_at: row.updated_at };
  if (state.category === "process") {
    return {
      ...base,
      process_date: draft.process_date,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      species: draft.species,
      received_seaweed_kg: numberOrNull(draft.received_seaweed_kg),
      wet_pulp_kg: numberOrNull(draft.wet_pulp_kg),
      pressed_liquid_l: numberOrNull(draft.pressed_liquid_l),
      dry_pulp_kg: numberOrNull(draft.dry_pulp_kg),
      lost_seaweed_kg: numberOrNull(draft.lost_seaweed_kg),
      number_of_presses: integerOrNull(draft.number_of_presses),
      recorded_by_name: draft.recorded_by_name.trim(),
      notes: textOrNull(draft.notes)
    };
  }
  if (state.category === "site_sample") {
    return {
      ...base,
      sampled_at: nairobiDateTime(draft.sampled_at),
      tide_stage: textOrNull(draft.tide_stage),
      temperature_c: numberOrNull(draft.temperature_c),
      salinity_value: numberOrNull(draft.salinity_value),
      salinity_unit: draft.salinity_unit,
      tds_value: numberOrNull(draft.tds_value),
      tds_unit: draft.tds_unit,
      electrical_conductivity_ms_cm: numberOrNull(draft.electrical_conductivity_ms_cm),
      e_coli_sample_taken: booleanOrNull(draft.e_coli_sample_taken),
      recorded_by_name: draft.recorded_by_name.trim(),
      notes: textOrNull(draft.notes)
    };
  }
  return {
    ...base,
    packed_on: draft.packed_on,
    carton_serial: draft.carton_serial.trim(),
    species: draft.species,
    weight_value: numberOrNull(draft.weight_value),
    weight_unit: draft.weight_unit,
    stabilizer_added: booleanOrNull(draft.stabilizer_added),
    chemical_dose_value: numberOrNull(draft.chemical_dose_value),
    chemical_dose_unit: draft.chemical_dose_unit,
    salinity_value: numberOrNull(draft.salinity_value),
    salinity_unit: draft.salinity_unit,
    ph_value: numberOrNull(draft.ph_value),
    electrical_conductivity_ms_cm: numberOrNull(draft.electrical_conductivity_ms_cm),
    recorded_by_name: draft.recorded_by_name.trim(),
    notes: textOrNull(draft.notes)
  };
}

function formRecordEditor(row, field, label, draft) {
  const id = String(row.id || "");
  if (state.category === "process") {
    if (field === "record_date") return formRecordInput(id, "process_date", draft.process_date, "date", label, { required: true });
    if (field === "start_time" || field === "end_time") return formRecordInput(id, field, draft[field], "time", label);
    if (field === "species") return formRecordSpeciesSelect(id, draft.species, label);
    if (["received_seaweed_kg", "wet_pulp_kg", "pressed_liquid_l", "dry_pulp_kg", "lost_seaweed_kg"].includes(field)) {
      return formRecordNumberInput(id, field, draft[field], label);
    }
    if (field === "number_of_presses") return formRecordInput(id, field, draft[field], "number", label, { min: 0, step: 1 });
    if (field === "recorded_by_name") return formRecordInput(id, field, draft[field], "text", label, { required: true, maxlength: 160 });
    if (field === "notes") return formRecordInput(id, field, draft[field], "text", label, { maxlength: 1000 });
  } else if (state.category === "site_sample") {
    if (field === "recorded_at") return formRecordInput(id, "sampled_at", draft.sampled_at, "datetime-local", label, { required: true });
    if (field === "tide_stage") {
      return formRecordSelect(id, field, draft[field], label, [
        ["", "Not set"], ["spring_low", "Spring low"], ["spring_high", "Spring high"]
      ]);
    }
    if (field === "temperature_c" || field === "electrical_conductivity_ms_cm") {
      return formRecordNumberInput(id, field, draft[field], label);
    }
    if (field === "salinity_value") {
      return formRecordMeasurement(id, "salinity_value", draft.salinity_value, "salinity_unit", draft.salinity_unit, ["PSU", "ppt"], label);
    }
    if (field === "tds_value") {
      return formRecordMeasurement(id, "tds_value", draft.tds_value, "tds_unit", draft.tds_unit, ["mg/L", "g/L", "ppt"], label);
    }
    if (field === "e_coli_sample_taken") return formRecordBooleanSelect(id, field, draft[field], label);
    if (field === "recorded_by_name") return formRecordInput(id, field, draft[field], "text", label, { required: true, maxlength: 160 });
    if (field === "notes") return formRecordInput(id, field, draft[field], "text", label, { maxlength: 1000 });
  } else {
    if (field === "record_date") return formRecordInput(id, "packed_on", draft.packed_on, "date", label, { required: true });
    if (field === "record_number") {
      return formRecordInput(id, "carton_serial", draft.carton_serial, "text", label, {
        required: true, maxlength: 30, pattern: "[0-9]+"
      });
    }
    if (field === "species") return formRecordSpeciesSelect(id, draft.species, label);
    if (field === "weight_value") {
      return formRecordMeasurement(id, "weight_value", draft.weight_value, "weight_unit", draft.weight_unit, ["L", "mL"], label, true);
    }
    if (field === "stabilizer_added") return formRecordBooleanSelect(id, field, draft[field], label, true);
    if (field === "chemical_dose_value") {
      return formRecordMeasurement(id, "chemical_dose_value", draft.chemical_dose_value, "chemical_dose_unit", draft.chemical_dose_unit, ["g/container"], label);
    }
    if (field === "salinity_value") {
      return formRecordMeasurement(id, "salinity_value", draft.salinity_value, "salinity_unit", draft.salinity_unit, ["PSU", "ppt"], label);
    }
    if (field === "ph_value" || field === "electrical_conductivity_ms_cm") {
      return formRecordNumberInput(id, field, draft[field], label);
    }
    if (field === "recorded_by_name") return formRecordInput(id, field, draft[field], "text", label, { required: true, maxlength: 160 });
    if (field === "notes") return formRecordInput(id, field, draft[field], "text", label, { maxlength: 1000 });
  }
  return escapeHtml(cellValue(row, field));
}

function formRecordInput(id, field, value, type, label, options = {}) {
  const attributes = [
    `type="${type}"`,
    `value="${escapeAttribute(value)}"`,
    `aria-label="${escapeAttribute(label)}"`,
    `data-form-ledger-id="${escapeAttribute(id)}"`,
    `data-form-ledger-field="${escapeAttribute(field)}"`,
    options.required ? "required" : "",
    options.min !== undefined ? `min="${options.min}"` : "",
    options.max !== undefined ? `max="${options.max}"` : "",
    options.step !== undefined ? `step="${options.step}"` : "",
    options.maxlength ? `maxlength="${options.maxlength}"` : "",
    options.pattern ? `pattern="${escapeAttribute(options.pattern)}"` : ""
  ].filter(Boolean).join(" ");
  return `<input class="today-inline-editor form-record-inline-editor" ${attributes}>`;
}

function formRecordNumberInput(id, field, value, label) {
  return formRecordInput(id, field, value, "number", label, { min: 0, step: 0.001 });
}

function formRecordSelect(id, field, value, label, options) {
  const current = String(value ?? "");
  const available = [...options];
  if (current && !available.some(([optionValue]) => String(optionValue) === current)) {
    available.push([current, current]);
  }
  return `<select class="today-inline-editor form-record-inline-editor" aria-label="${escapeAttribute(label)}" data-form-ledger-id="${escapeAttribute(id)}" data-form-ledger-field="${escapeAttribute(field)}">${available.map(([optionValue, optionLabel]) => `<option value="${escapeAttribute(optionValue)}"${String(optionValue) === current ? " selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select>`;
}

function formRecordSpeciesSelect(id, value, label) {
  const options = state.species.map((species) => [
    species.type_key,
    species.common_name ? `${species.label} (${species.common_name})` : species.label
  ]);
  return formRecordSelect(id, "species", value, label, options);
}

function formRecordBooleanSelect(id, field, value, label, required = false) {
  const options = required
    ? [["true", "Yes"], ["false", "No"]]
    : [["", "Not set"], ["true", "Yes"], ["false", "No"]];
  return formRecordSelect(id, field, value, label, options);
}

function formRecordMeasurement(id, valueField, value, unitField, unit, units, label, required = false) {
  return `<span class="form-record-measure-editor">${formRecordInput(
    id,
    valueField,
    value,
    "number",
    label,
    { min: required ? 0.001 : 0, step: 0.001, required }
  )}${formRecordSelect(id, unitField, unit, `${label} unit`, units.map((item) => [item, item]))}</span>`;
}

function resetFormRecordEditState() {
  state.selectedFormRecordIds.clear();
  state.editingFormRecordIds.clear();
  state.dirtyFormRecordIds.clear();
  state.formRecordDrafts.clear();
  state.formRecordOriginals.clear();
}

function canManageFormRecords() {
  return state.profile?.app_role === "system_admin"
    || Boolean(state.profile?.can_edit_collections);
}

function setFormRecordActionStatus(message, type = "") {
  els.formLedgerActionStatus.textContent = message || "";
  if (type) els.formLedgerActionStatus.dataset.status = type;
  else delete els.formLedgerActionStatus.dataset.status;
}

function recordReference(row) {
  return row.record_number || row.transaction_id || "record";
}

function metricsHtml(metrics, values) {
  return metrics.map(([field, label, unit]) => `
    <div class="form-ledger-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(metricValue(values[field], unit))}${unit && !["integer"].includes(unit) ? ` <small>${escapeHtml(unit)}</small>` : ""}</strong>
    </div>
  `).join("");
}

function metricValue(value, unit) {
  return unit === "integer" ? formatInteger(value) : formatNumber(value);
}

function reportValue(value, type) {
  if (type === "integer") return formatInteger(value);
  if (type === "number") return formatNumber(value);
  if (type === "date") return formatDate(value);
  return value === null || value === undefined || value === "" ? "-" : String(value);
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
  if (field === "chemical_dose_value") return stockChemicalSummary(row);
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
  const range = selectedDateRange(els.formLedgerFrom, els.formLedgerTo);
  if (!range) return;
  els.exportFormLedger.disabled = true;
  setStatus("Preparing CSV...");
  try {
    const rows = [];
    for (let offset = 0; offset < EXPORT_LIMIT; offset += PAGE_SIZE) {
      const result = await ledgerRpc(range, null, els.formLedgerSearch.value.trim() || null, offset / PAGE_SIZE);
      rows.push(...result.rows);
      if (result.rows.length < PAGE_SIZE || rows.length >= result.total) break;
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

function changeAllPage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total || state.loading || state.editingFormRecordIds.size) return;
  resetFormRecordEditState();
  state.page = next;
  void loadAllRecords();
}

function changeDayPage(direction) {
  const next = state.dayPage + direction;
  if (next < 0 || next * PAGE_SIZE >= state.dayTotal || state.loading) return;
  state.dayPage = next;
  void loadDayRecords();
}

function changeCommunityPage(direction) {
  const next = state.communityRecordPage + direction;
  if (next < 0 || next * PAGE_SIZE >= state.communityRecordTotal || state.loading) return;
  state.communityRecordPage = next;
  void loadCommunityRecords();
}

function selectedDateRange(from, to) {
  if (!from.value || !to.value) {
    setStatus("Select both From and To dates.", "error");
    return null;
  }
  if (to.value < from.value) {
    setStatus("To date must be on or after From date.", "error");
    return null;
  }
  return { start: from.value, end: to.value };
}

function calendarMonthKeys(now) {
  const [year, month] = kenyaDate().slice(0, 7).split("-").map(Number);
  return Array.from({ length: 4 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function calendarRange(now) {
  const months = calendarMonthKeys(now);
  const oldest = months[months.length - 1];
  const newest = months[0];
  const [year, month] = newest.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${oldest}-01`, end: `${newest}-${String(lastDay).padStart(2, "0")}` };
}

function resetPages() {
  state.page = 0;
  state.dayPage = 0;
  state.communityRecordPage = 0;
  state.selectedDay = "";
  state.selectedCommunity = "";
  state.sort = "recorded_at";
  state.direction = "desc";
  els.formLedgerDayRecords.hidden = true;
  els.formLedgerCommunityRecords.hidden = true;
}

function renderPageStatus(page, total, status, previous, next) {
  const first = total ? page * PAGE_SIZE + 1 : 0;
  const last = Math.min((page + 1) * PAGE_SIZE, total);
  status.textContent = total ? `Rows ${first}-${last} of ${total}` : "No rows";
  previous.disabled = state.loading || page === 0;
  next.disabled = state.loading || last >= total;
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("category", state.category);
  if (state.category === "summary") {
    url.searchParams.delete("view");
    url.searchParams.delete("year");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("search");
    url.searchParams.set("grouping", els.operationalSummaryGrouping.value);
    url.searchParams.set("summary_from", els.operationalSummaryFrom.value);
    url.searchParams.set("summary_to", els.operationalSummaryTo.value);
    if (els.operationalSummaryCommunity.value) {
      url.searchParams.set("community", els.operationalSummaryCommunity.value);
    } else {
      url.searchParams.delete("community");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    return;
  }
  if (state.category === "intake") {
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    return;
  }
  url.searchParams.set("view", state.mode);
  if (state.mode === "monthly") url.searchParams.set("year", els.formLedgerYear.value);
  else url.searchParams.delete("year");
  const from = state.mode === "community" ? els.formLedgerCommunityFrom.value : els.formLedgerFrom.value;
  const to = state.mode === "community" ? els.formLedgerCommunityTo.value : els.formLedgerTo.value;
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  if (state.mode === "monthly" && state.category === "site_sample" && els.formLedgerMonthlyCommunity.value) {
    url.searchParams.set("community", els.formLedgerMonthlyCommunity.value);
  } else {
    url.searchParams.delete("community");
  }
  if (state.mode === "all" && els.formLedgerSearch.value.trim()) {
    url.searchParams.set("search", els.formLedgerSearch.value.trim());
  } else {
    url.searchParams.delete("search");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function activateIntakeView() {
  const view = ["all", "monthly", "community"].includes(state.mode) ? state.mode : "all";
  const url = new URL(window.location.href);
  url.searchParams.set("category", "intake");
  url.searchParams.set("view", view);
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  els.collectionLedgerWorkspace
    .querySelector(`[data-ledger-view="${view}"]`)
    ?.click();
}

function setLoading(loading) {
  [
    els.loadFormLedger, els.exportFormLedger, els.loadFormLedgerMonthly,
    els.loadFormLedgerCommunity, els.loadOperationalSummary
  ].forEach((button) => { button.disabled = loading; });
  els.previousFormLedgerPage.disabled = loading || state.page === 0;
  els.nextFormLedgerPage.disabled = loading || (state.page + 1) * PAGE_SIZE >= state.total;
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function rowCount(total) {
  return `${formatInteger(total)} ${Number(total) === 1 ? "record" : "records"}`;
}

function measurement(value, unit) {
  const number = formatNumber(value);
  return number === "-" ? "-" : `${number}${unit ? ` ${unit}` : ""}`;
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number).toLocaleString("en-KE")
    : "0";
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 2 })
    : String(value);
}

function formatRatio(value) {
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

function formatDuration(value) {
  const number = Number(value);
  const minutes = Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!hours) return `${remaining} min`;
  return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
}

function shortTime(value) {
  return String(value || "").slice(0, 5);
}

function dateTimeInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Nairobi"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function nairobiDateTime(value) {
  const input = String(value || "").trim();
  return input ? new Date(`${input}:00+03:00`).toISOString() : null;
}

function nullableValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function numberOrNull(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.trunc(number);
}

function booleanOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  return String(value) === "true";
}

function textOrNull(value) {
  return String(value || "").trim() || null;
}

function draftsEqual(first, second) {
  return JSON.stringify(first || {}) === JSON.stringify(second || {});
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

function setOperationalSummaryStatus(message, type = "") {
  els.operationalSummaryStatus.textContent = message || "";
  if (type) els.operationalSummaryStatus.dataset.status = type;
  else delete els.operationalSummaryStatus.dataset.status;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
