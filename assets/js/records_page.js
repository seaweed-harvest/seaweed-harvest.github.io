import { authClient, requireAdminAccess } from "./auth_client.js";
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

const REPORTS = {
  process: {
    title: "Process records",
    monthlyColumns: [
      ["month_label", "Month", "month"],
      ["record_count", "Records", "integer"],
      ["species_count", "Species", "integer"],
      ["received_kg", "Received kg", "number"],
      ["blended_kg", "Blended kg", "number"],
      ["wet_pulp_kg", "Wet pulp kg", "number"],
      ["liquid_l", "Liquid L", "number"],
      ["dry_pulp_kg", "Dry pulp kg", "number"],
      ["lost_kg", "Lost kg", "number"],
      ["press_count", "Presses", "integer"],
      ["avg_wet_dry_percent", "Avg wet/dry %", "number"],
      ["avg_stock_product_percent", "Avg stock/product %", "number"],
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

const state = {
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
  communityRecordPage: 0
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "collectionLedgerWorkspace", "formLedgerWorkspace",
    "formLedgerCount", "formLedgerCategories", "formLedgerViews", "formLedgerCommunityTab",
    "formLedgerAllPanel", "formLedgerMonthlyPanel", "formLedgerCommunityPanel",
    "formLedgerFrom", "formLedgerTo", "formLedgerSearch", "loadFormLedger",
    "exportFormLedger", "previousFormLedgerPage", "formLedgerPageStatus",
    "nextFormLedgerPage", "formLedgerHead", "formLedgerRows", "formLedgerStatus",
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

  setDateDefaults();
  readUrlState();
  bindEvents();
  try {
    const communities = await selectRows(
      "ag_secure_communities",
      "select=community_id,community_name&order=community_name.asc"
    );
    communities.forEach((community) => {
      els.formLedgerMonthlyCommunity.append(new Option(
        `${community.community_id} - ${community.community_name}`,
        community.community_id
      ));
    });
    const requestedCommunity = new URLSearchParams(window.location.search).get("community");
    if (requestedCommunity) els.formLedgerMonthlyCommunity.value = requestedCommunity;
    updateControls();
    await loadCurrentView();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function bindEvents() {
  els.formLedgerCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ledger-category]");
    if (!button || state.loading) return;
    if (state.category === "intake") {
      const currentView = new URLSearchParams(window.location.search).get("view");
      if (["all", "monthly", "community"].includes(currentView)) state.mode = currentView;
    }
    state.category = button.dataset.ledgerCategory;
    if (state.category !== "site_sample" && state.mode === "community") state.mode = "all";
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
    if (!button || button.hidden || state.loading) return;
    state.mode = button.dataset.ledgerMode;
    resetPages();
    updateControls();
    syncUrl();
    void loadCurrentView();
  });
  els.loadFormLedger.addEventListener("click", () => {
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
    if (!button) return;
    const field = button.dataset.formLedgerSort;
    if (state.sort === field) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.sort = field;
      state.direction = field.includes("date") || field.includes("time") ? "desc" : "asc";
    }
    sortRows();
    renderAllRows();
  });
  els.exportFormLedger.addEventListener("click", exportCsv);
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
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (["intake", "process", "site_sample", "stock"].includes(params.get("category"))) {
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
}

function updateControls() {
  els.formLedgerCategories.querySelectorAll("[data-ledger-category]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.ledgerCategory === state.category));
  });
  const intakeSelected = state.category === "intake";
  els.collectionLedgerWorkspace.hidden = !intakeSelected;
  els.formLedgerWorkspace.hidden = intakeSelected;
  if (intakeSelected) return;

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
  target.innerHTML = `<tr>${COLUMNS[state.category].map(([field, label]) => `
    <th aria-sort="${state.sort === field ? (state.direction === "asc" ? "ascending" : "descending") : "none"}">
      <button type="button" data-form-ledger-sort="${escapeAttribute(field)}">${escapeHtml(label)}${state.sort === field ? ` ${state.direction === "asc" ? "up" : "down"}` : ""}</button>
    </th>`).join("")}</tr>`;
}

function renderAllRows(errorMessage = "") {
  const columns = COLUMNS[state.category];
  els.formLedgerCount.textContent = rowCount(state.total);
  if (errorMessage || !state.rows.length) {
    els.formLedgerRows.innerHTML = emptyRow(columns.length, errorMessage || "No records match the current filters.");
  } else {
    els.formLedgerRows.innerHTML = recordRowsHtml(state.rows);
  }
  renderPageStatus(
    state.page,
    state.total,
    els.formLedgerPageStatus,
    els.previousFormLedgerPage,
    els.nextFormLedgerPage
  );
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

function recordRowsHtml(rows) {
  const columns = COLUMNS[state.category];
  return rows.map((row) => `
    <tr>${columns.map(([field]) => `<td>${escapeHtml(cellValue(row, field))}</td>`).join("")}</tr>
  `).join("");
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
  if (next < 0 || next * PAGE_SIZE >= state.total || state.loading) return;
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
    els.loadFormLedgerCommunity
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
