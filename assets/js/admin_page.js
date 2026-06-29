import { APP_CONFIG } from "./config.js";
import { dataModeLabel, selectRows } from "./supabase_client.js";

const TABLES = {
  overview: "ag_admin_overview",
  communityDashboard: "ag_community_dashboard",
  memberSummary: "ag_member_registry_summary"
};

const RPC = {
  monthly: "ag_admin_monthly_summary",
  communityPeriod: "ag_admin_community_period_summary",
  communityGrades: "ag_admin_community_grade_summary",
  ledger: "ag_admin_collection_ledger_page",
  todayIntake: "ag_admin_today_intake",
  updateTodayIntake: "ag_admin_update_intake_batch"
};

const LEDGER_PAGE_SIZE = 50;
const EXPORT_MAX_ROWS = 5000;
const KENYA_COAST_VIEW = {
  center: [-4.55, 39.42],
  zoom: 9
};

const state = {
  overview: {},
  communities: [],
  members: [],
  monthlyRows: [],
  communitySummary: null,
  communityGradeRows: [],
  communityMonthlyRows: [],
  ledgerRows: [],
  ledgerTotal: 0,
  ledgerPage: 0,
  ledgerSort: "collected_at",
  ledgerDirection: "desc",
  todayIntakeRows: [],
  todaySort: "collected_at",
  todayDirection: "desc",
  selectedTodayIntakeIds: new Set(),
  map: null,
  markersByKey: new Map()
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  setupAdminSidebar();
  if (!hasAdminDataView()) return;
  setDefaultControls();
  bindEvents();
  await loadAdminData();
}

function cacheElements() {
  [
    "adminConnectionStatus",
    "reloadAdminDashboard",
    "metricTotalKg",
    "metricAcceptedKg",
    "metricRejectedKg",
    "metricEstimatedKsh",
    "metricGradeAKg",
    "metricGradeBKg",
    "metricGradeCKg",
    "metricUngradedKg",
    "metricCollectionCount",
    "metricCollectionsThisMonth",
    "metricActiveMembers",
    "metricActiveCommunities",
    "metricLastCollection",
    "metricMissingMemberId",
    "metricMissingSackId",
    "communityTotalsCount",
    "communityTotalsRows",
    "memberRegistryCount",
    "memberRegistryRows",
    "memberSearch",
    "communityRegistryCount",
    "communityRegistryRows",
    "communitySearch",
    "mapStatus",
    "adminCommunityMap",
    "adminMapFallback",
    "mappedCommunityCount",
    "mappedCommunityList",
    "missingGpsCount",
    "missingGpsList",
    "monthlyCount",
    "monthlyYear",
    "monthlyCommunity",
    "monthlyGrade",
    "reloadMonthly",
    "monthlyRows",
    "communitySummaryStatus",
    "communitySummarySelect",
    "communityPeriodPreset",
    "communityMonth",
    "communityStartDate",
    "communityEndDate",
    "reloadCommunitySummary",
    "communitySummaryMetrics",
    "communityGradeRows",
    "communityMonthlyRows",
    "todayIntakeCount",
    "todayIntakeDate",
    "reloadTodayIntake",
    "todayIntakeStatus",
    "todaySelectedCount",
    "todayBatchFarmer",
    "todayBatchCommunity",
    "todayWeightAdjustment",
    "todayBatchSeaweedType",
    "todayBatchGrade",
    "todayBatchPrice",
    "todayBatchNotes",
    "applyTodayBatch",
    "clearTodayBatch",
    "todaySelectAll",
    "todayIntakeRows",
    "ledgerCount",
    "ledgerPeriodPreset",
    "ledgerMonth",
    "ledgerStartDate",
    "ledgerEndDate",
    "ledgerCommunity",
    "ledgerGrade",
    "ledgerSearch",
    "reloadLedger",
    "exportLedgerCsv",
    "ledgerPrevPage",
    "ledgerNextPage",
    "ledgerPageStatus",
    "ledgerRows"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function hasAdminDataView() {
  return Boolean(els.adminConnectionStatus);
}

function setDefaultControls() {
  const now = new Date();
  const currentYear = now.getFullYear();

  if (els.monthlyYear) els.monthlyYear.value = String(currentYear);
  if (els.communityMonth) els.communityMonth.value = "";
  if (els.ledgerMonth) els.ledgerMonth.value = "";
  if (els.communityStartDate) els.communityStartDate.value = "";
  if (els.communityEndDate) els.communityEndDate.value = "";
  if (els.ledgerStartDate) els.ledgerStartDate.value = "";
  if (els.ledgerEndDate) els.ledgerEndDate.value = "";
  if (els.todayIntakeDate) els.todayIntakeDate.value = kenyaDateInputValue(now);
}

function bindEvents() {
  els.reloadAdminDashboard?.addEventListener("click", loadAdminData);
  els.memberSearch?.addEventListener("input", renderMemberRegistry);
  els.communitySearch?.addEventListener("input", renderCommunityRegistry);
  els.mappedCommunityList?.addEventListener("click", focusMapMarkerFromEvent);
  els.mappedCommunityList?.addEventListener("keydown", focusMapMarkerFromEvent);
  els.reloadMonthly?.addEventListener("click", () => loadMonthly());
  els.reloadCommunitySummary?.addEventListener("click", () => loadCommunitySummary());
  els.communitySummarySelect?.addEventListener("change", () => loadCommunitySummary());
  els.reloadTodayIntake?.addEventListener("click", () => loadTodayIntake());
  els.todayIntakeDate?.addEventListener("change", () => loadTodayIntake());
  els.todayIntakeRows?.addEventListener("change", handleTodayIntakeSelectionChange);
  els.todaySelectAll?.addEventListener("change", toggleAllTodayIntakeRows);
  els.applyTodayBatch?.addEventListener("click", applyTodayBatchEdit);
  els.clearTodayBatch?.addEventListener("click", clearTodayBatchForm);
  els.reloadLedger?.addEventListener("click", () => {
    state.ledgerPage = 0;
    loadLedger();
  });
  els.ledgerPrevPage?.addEventListener("click", () => {
    if (state.ledgerPage <= 0) return;
    state.ledgerPage -= 1;
    loadLedger();
  });
  els.ledgerNextPage?.addEventListener("click", () => {
    if ((state.ledgerPage + 1) * LEDGER_PAGE_SIZE >= state.ledgerTotal) return;
    state.ledgerPage += 1;
    loadLedger();
  });
  els.exportLedgerCsv?.addEventListener("click", exportLedgerCsv);

  document.querySelectorAll("[data-ledger-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSort = button.dataset.ledgerSort;
      if (state.ledgerSort === nextSort) {
        state.ledgerDirection = state.ledgerDirection === "asc" ? "desc" : "asc";
      } else {
        state.ledgerSort = nextSort;
        state.ledgerDirection = nextSort === "collected_at" || nextSort === "created_at" ? "desc" : "asc";
      }
      state.ledgerPage = 0;
      loadLedger();
    });
  });

  document.querySelectorAll("[data-today-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSort = button.dataset.todaySort;
      if (state.todaySort === nextSort) {
        state.todayDirection = state.todayDirection === "asc" ? "desc" : "asc";
      } else {
        state.todaySort = nextSort;
        state.todayDirection = nextSort === "collected_at" ? "desc" : "asc";
      }
      renderTodayIntake();
    });
  });
}

function setupAdminSidebar() {
  const sidebar = document.querySelector(".admin-sidebar");
  const layout = document.querySelector(".admin-layout");
  if (!sidebar || !layout || sidebar.dataset.sidebarReady === "true") return;

  const title = sidebar.querySelector("h2");
  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "admin-sidebar-top";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "admin-sidebar-toggle";

  if (title) {
    title.replaceWith(sidebarHeader);
    sidebarHeader.append(title, toggle);
  } else {
    sidebar.prepend(sidebarHeader);
    sidebarHeader.append(toggle);
  }

  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "admin-sidebar-reveal";
  reveal.textContent = "Admin menu";
  layout.insertBefore(reveal, sidebar);

  const applyPinnedState = (isPinned) => {
    localStorage.setItem("seaweed_ag:admin_sidebar_pinned", String(isPinned));
    layout.classList.toggle("admin-sidebar-unpinned", !isPinned);
    toggle.textContent = isPinned ? "Unpin" : "Pin";
    toggle.setAttribute("aria-pressed", String(isPinned));
    reveal.hidden = isPinned;
  };

  const savedValue = localStorage.getItem("seaweed_ag:admin_sidebar_pinned");
  applyPinnedState(savedValue === null ? true : savedValue !== "false");
  toggle.addEventListener("click", () => applyPinnedState(false));
  reveal.addEventListener("click", () => applyPinnedState(true));
  sidebar.dataset.sidebarReady = "true";
}

async function loadAdminData() {
  setConnectionStatus("Loading", "status-muted");

  try {
    const [overviewRows, communities, members] = await Promise.all([
      selectRows(TABLES.overview, "select=*"),
      selectRows(TABLES.communityDashboard, "select=*&order=community_id.asc"),
      selectRows(TABLES.memberSummary, "select=*&order=farmer_id.asc")
    ]);

    state.overview = overviewRows[0] || {};
    state.communities = communities;
    state.members = members;

    renderSelectors();
    renderDashboard();
    renderMemberRegistry();
    renderCommunityRegistry();
    renderMapSection();
    await loadMonthly({ quiet: true });
    await loadCommunitySummary({ quiet: true });
    await loadTodayIntake({ quiet: true });
    await loadLedger({ quiet: true });

    const mode = dataModeLabel();
    setConnectionStatus(mode, mode === "Preview" ? "status-muted" : "");
  } catch (error) {
    setConnectionStatus("Setup needed", "status-muted");
    renderSetupError(error);
  }
}

function renderSetupError(error) {
  const message = `Admin reporting SQL is not available yet. ${error.message}`;
  if (els.communityTotalsRows) els.communityTotalsRows.innerHTML = emptyRow(8, message);
  if (els.memberRegistryRows) els.memberRegistryRows.innerHTML = emptyRow(9, message);
  if (els.communityRegistryRows) els.communityRegistryRows.innerHTML = emptyRow(11, message);
  if (els.monthlyRows) els.monthlyRows.innerHTML = emptyRow(13, message);
  if (els.communityGradeRows) els.communityGradeRows.innerHTML = emptyRow(5, message);
  if (els.communityMonthlyRows) els.communityMonthlyRows.innerHTML = emptyRow(6, message);
  if (els.todayIntakeRows) els.todayIntakeRows.innerHTML = emptyRow(12, message);
  if (els.ledgerRows) els.ledgerRows.innerHTML = emptyRow(14, message);
  if (els.mapStatus) {
    els.mapStatus.textContent = "Setup needed";
    els.mapStatus.className = "status-pill status-muted";
  }
  if (els.adminMapFallback) showMapFallback(message);
}

function renderDashboard() {
  if (!els.metricTotalKg) return;

  const row = state.overview || {};
  setMetric("metricTotalKg", formatKg(row.total_weight_kg));
  setMetric("metricAcceptedKg", formatKg(row.accepted_weight_kg));
  setMetric("metricRejectedKg", formatKg(row.rejected_weight_kg));
  setMetric("metricEstimatedKsh", formatMoney(row.estimated_value_ksh));
  setMetric("metricGradeAKg", formatKg(row.grade_a_weight_kg));
  setMetric("metricGradeBKg", formatKg(row.grade_b_weight_kg));
  setMetric("metricGradeCKg", formatKg(row.grade_c_weight_kg));
  setMetric("metricUngradedKg", formatKg(row.ungraded_weight_kg));
  setMetric("metricCollectionCount", formatInteger(row.collection_count));
  setMetric("metricCollectionsThisMonth", formatInteger(row.collections_this_month));
  setMetric("metricActiveMembers", formatInteger(row.active_member_count));
  setMetric("metricActiveCommunities", formatInteger(row.active_community_count));
  setMetric("metricLastCollection", formatDate(row.last_collection_at));
  setMetric("metricMissingMemberId", formatInteger(row.missing_member_id_count));
  setMetric("metricMissingSackId", formatInteger(row.missing_sack_id_count));
  renderCommunityTotals();
}

function renderCommunityTotals() {
  if (!els.communityTotalsRows) return;

  els.communityTotalsCount.textContent = `${state.communities.length} rows`;
  els.communityTotalsRows.innerHTML = state.communities.map((community) => `
    <tr>
      <td><strong>${escapeHtml(community.community_id)}</strong></td>
      <td>${escapeHtml(community.community_name)}</td>
      <td>${escapeHtml(formatKg(community.total_weight_kg))}</td>
      <td>${escapeHtml(formatKg(community.grade_a_weight_kg))}</td>
      <td>${escapeHtml(formatKg(community.grade_b_weight_kg))}</td>
      <td>${escapeHtml(formatKg(community.grade_c_weight_kg))}</td>
      <td>${escapeHtml(formatInteger(community.active_member_count))}</td>
      <td>${escapeHtml(formatDate(community.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(8, "No community totals found.");
}

function renderMemberRegistry() {
  if (!els.memberRegistryRows) return;

  const rows = filteredMembers();
  els.memberRegistryCount.textContent = `${rows.length} rows`;
  els.memberRegistryRows.innerHTML = rows.map((member) => `
    <tr>
      <td><strong>${escapeHtml(member.farmer_id || "-")}</strong></td>
      <td>${escapeHtml(member.name || "-")}</td>
      <td>${escapeHtml(member.phone || "-")}</td>
      <td>${escapeHtml(member.community_id || "-")}</td>
      <td>${escapeHtml(member.community_name || "-")}</td>
      <td>${escapeHtml(member.active === false ? "Inactive" : "Active")}</td>
      <td>${escapeHtml(formatDate(member.last_collection_at))}</td>
      <td>${escapeHtml(formatKg(member.total_weight_kg))}</td>
      <td>${escapeHtml(member.notes || "-")}</td>
    </tr>
  `).join("") || emptyRow(9, "No member registry rows found.");
}

function renderCommunityRegistry() {
  if (!els.communityRegistryRows) return;

  const rows = filteredCommunities();
  els.communityRegistryCount.textContent = `${rows.length} rows`;
  els.communityRegistryRows.innerHTML = rows.map((community) => `
    <tr>
      <td><strong>${escapeHtml(community.community_id || "-")}</strong></td>
      <td>${escapeHtml(community.community_name || "-")}</td>
      <td>${escapeHtml(formatCoordinatePair(community.gps_latitude, community.gps_longitude))}</td>
      <td>${escapeHtml(community.chair_person || "-")}</td>
      <td>${escapeHtml(community.chair_person_contact || "-")}</td>
      <td>${escapeHtml(formatInteger(community.active_member_count))}</td>
      <td>${escapeHtml(formatKg(community.total_weight_kg))}</td>
      <td>${escapeHtml(formatDate(community.last_collection_at))}</td>
      <td>${escapeHtml(hasGps(community) ? "Mapped" : "Needs GPS")}</td>
      <td>${escapeHtml(community.active === false ? "Inactive" : "Active")}</td>
      <td>${escapeHtml(community.notes || "-")}</td>
    </tr>
  `).join("") || emptyRow(11, "No community registry rows found.");
}

function renderSelectors() {
  const communityOptions = [
    ["", "All communities"],
    ...state.communities.map((community) => [
      community.community_id,
      communityLabel(community)
    ])
  ];

  if (els.monthlyCommunity) setSelectOptions(els.monthlyCommunity, communityOptions, els.monthlyCommunity.value);
  if (els.ledgerCommunity) setSelectOptions(els.ledgerCommunity, communityOptions, els.ledgerCommunity.value);
  if (els.communitySummarySelect) setSelectOptions(els.communitySummarySelect, communityOptions, selectedCommunityValue());
  if (els.todayBatchCommunity) {
    const batchCommunityOptions = [
      ["", "No change"],
      ...state.communities.map((community) => [
        community.community_id,
        communityLabel(community)
      ])
    ];
    setSelectOptions(els.todayBatchCommunity, batchCommunityOptions, els.todayBatchCommunity.value);
  }
  if (els.todayBatchFarmer) {
    const farmerOptions = [
      ["", "No change"],
      ...state.members.map((member) => [
        member.farmer_id || "",
        [member.farmer_id, member.name, member.community_name].filter(Boolean).join(" - ")
      ])
    ];
    setSelectOptions(els.todayBatchFarmer, farmerOptions, els.todayBatchFarmer.value);
  }
}

function selectedCommunityValue() {
  if (els.communitySummarySelect?.value) return els.communitySummarySelect.value;
  return state.communities[0]?.community_id || "";
}

async function loadMonthly(options = {}) {
  if (!els.monthlyRows) return;
  if (!options.quiet) els.monthlyCount.textContent = "Loading";

  try {
    state.monthlyRows = await supabaseRpc(RPC.monthly, {
      p_year: numberOrNull(els.monthlyYear.value),
      p_community_id: nullableText(els.monthlyCommunity.value),
      p_grade: nullableText(els.monthlyGrade.value)
    });
    renderMonthly();
  } catch (error) {
    state.monthlyRows = [];
    els.monthlyCount.textContent = "Error";
    els.monthlyRows.innerHTML = emptyRow(13, error.message);
  }
}

function renderMonthly() {
  if (!els.monthlyRows) return;

  els.monthlyCount.textContent = `${state.monthlyRows.length} rows`;
  els.monthlyRows.innerHTML = state.monthlyRows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.month_label || formatMonth(row.month_start))}</strong></td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatInteger(row.active_collecting_members))}</td>
      <td>${escapeHtml(formatInteger(row.communities_collected))}</td>
      <td>${escapeHtml(formatKg(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.grade_a_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.grade_b_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.grade_c_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.ungraded_weight_kg))}</td>
      <td>${escapeHtml(formatMoney(row.estimated_value_ksh))}</td>
      <td>${escapeHtml(formatKg(row.average_collection_kg))}</td>
      <td>${escapeHtml(formatDate(row.first_collection_at))}</td>
      <td>${escapeHtml(formatDate(row.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(13, "No monthly rows for the selected filters.");
}

async function loadCommunitySummary(options = {}) {
  if (!els.communityGradeRows) return;
  if (!options.quiet) els.communitySummaryStatus.textContent = "Loading";

  const range = dateRangeFromControls(
    els.communityPeriodPreset.value,
    els.communityMonth.value,
    els.communityStartDate.value,
    els.communityEndDate.value
  );
  const communityId = nullableText(els.communitySummarySelect.value);

  try {
    const [summaryRows, gradeRows, monthlyRows] = await Promise.all([
      supabaseRpc(RPC.communityPeriod, {
        p_community_id: communityId,
        p_start_at: range.start,
        p_end_at: range.end
      }),
      supabaseRpc(RPC.communityGrades, {
        p_community_id: communityId,
        p_start_at: range.start,
        p_end_at: range.end
      }),
      supabaseRpc(RPC.monthly, {
        p_year: monthlyYearForRange(range),
        p_community_id: communityId,
        p_grade: null
      })
    ]);

    state.communitySummary = summaryRows[0] || null;
    state.communityGradeRows = gradeRows;
    state.communityMonthlyRows = monthlyRows;
    renderCommunitySummary(range);
    els.communitySummaryStatus.textContent = range.label;
    els.communitySummaryStatus.className = "status-pill";
  } catch (error) {
    els.communitySummaryStatus.textContent = "Error";
    els.communitySummaryStatus.className = "status-pill status-muted";
    els.communitySummaryMetrics.innerHTML = "";
    els.communityGradeRows.innerHTML = emptyRow(5, error.message);
    els.communityMonthlyRows.innerHTML = emptyRow(6, error.message);
  }
}

function renderCommunitySummary(range) {
  if (!els.communitySummaryMetrics) return;

  const summary = state.communitySummary || {};
  const metricRows = [
    ["Total kg", formatKg(summary.total_weight_kg)],
    ["Accepted kg", formatKg(summary.accepted_weight_kg)],
    ["Rejected kg", formatKg(summary.rejected_weight_kg)],
    ["Grade A kg", formatKg(summary.grade_a_weight_kg)],
    ["Grade B kg", formatKg(summary.grade_b_weight_kg)],
    ["Grade C kg", formatKg(summary.grade_c_weight_kg)],
    ["Ungraded kg", formatKg(summary.ungraded_weight_kg)],
    ["Collections", formatInteger(summary.collection_count)],
    ["Active members", formatInteger(summary.active_member_count)],
    ["Collecting members", formatInteger(summary.active_collecting_members)],
    ["Estimated KSH", formatMoney(summary.estimated_value_ksh)],
    ["Avg kg", formatKg(summary.average_collection_kg)],
    ["First collection", formatDate(summary.first_collection_at)],
    ["Last collection", formatDate(summary.last_collection_at)]
  ];

  els.communitySummaryMetrics.innerHTML = metricRows.map(([label, value]) => `
    <article class="admin-metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join("");

  els.communityGradeRows.innerHTML = state.communityGradeRows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.grade || "-")}</strong></td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatKg(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatMoney(row.estimated_value_ksh))}</td>
      <td>${escapeHtml(formatKg(row.average_collection_kg))}</td>
    </tr>
  `).join("") || emptyRow(5, `No grade rows for ${range.label}.`);

  els.communityMonthlyRows.innerHTML = state.communityMonthlyRows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.month_label || formatMonth(row.month_start))}</strong></td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatKg(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.grade_a_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.grade_b_weight_kg))}</td>
      <td>${escapeHtml(formatKg(row.grade_c_weight_kg))}</td>
    </tr>
  `).join("") || emptyRow(6, "No monthly breakdown rows for this community.");
}

function renderMapSection() {
  if (!els.adminCommunityMap) return;

  const mapped = state.communities.filter(hasGps);
  const missing = state.communities.filter((community) => !hasGps(community));
  const latestHarvestMs = latestHarvestTime(state.communities);

  els.mappedCommunityCount.textContent = String(mapped.length);
  els.missingGpsCount.textContent = String(missing.length);
  renderMapLists(mapped, missing, latestHarvestMs);
  renderLeafletMap(mapped, latestHarvestMs);

  if (mapped.length) {
    els.mapStatus.textContent = `${mapped.length} mapped`;
    els.mapStatus.className = "status-pill";
  } else {
    els.mapStatus.textContent = "Needs GPS";
    els.mapStatus.className = "status-pill status-muted";
  }
}

function renderMapLists(mapped, missing, latestHarvestMs) {
  els.mappedCommunityList.innerHTML = mapped.length
    ? renderMapTable(mapped, true, latestHarvestMs)
    : `<div class="empty-state">No mapped communities found.</div>`;

  els.missingGpsList.innerHTML = missing.length
    ? renderMapTable(missing, false, latestHarvestMs)
    : `<div class="empty-state">All active communities have GPS coordinates.</div>`;
}

function renderMapTable(rows, includeMarkerFocus, latestHarvestMs) {
  return `
    <table class="map-location-table">
      <thead>
        <tr>
          <th>Community</th>
          <th>ID</th>
          <th>GPS</th>
          <th>Total kg</th>
          <th>Last collection</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((community) => {
          const focusAttr = includeMarkerFocus
            ? ` tabindex="0" role="button" data-focus-marker="${escapeAttribute(community.community_id)}"`
            : "";
          const rowClass = includeMarkerFocus ? harvestRecencyClass(community, latestHarvestMs) : "muted";
          return `
            <tr class="map-location-row ${escapeAttribute(rowClass)}"${focusAttr}>
              <td><strong>${escapeHtml(community.community_name || "-")}</strong></td>
              <td>${escapeHtml(community.community_id || "-")}</td>
              <td>${escapeHtml(formatCoordinatePair(community.gps_latitude, community.gps_longitude))}</td>
              <td>${escapeHtml(formatKg(community.total_weight_kg))}</td>
              <td>${escapeHtml(formatDate(community.last_collection_at))}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderLeafletMap(mapped, latestHarvestMs) {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.markersByKey.clear();
  els.adminMapFallback.hidden = true;
  els.adminMapFallback.textContent = "";

  if (!window.L) {
    showMapFallback("Map library could not load.");
    return;
  }

  state.map = window.L.map(els.adminCommunityMap, {
    scrollWheelZoom: true
  }).setView(KENYA_COAST_VIEW.center, KENYA_COAST_VIEW.zoom);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);

  if (!mapped.length) {
    showMapFallback("No active communities have GPS coordinates yet.");
    return;
  }

  mapped.forEach((community) => {
    const status = harvestRecencyClass(community, latestHarvestMs);
    const marker = window.L.marker(
      [Number(community.gps_latitude), Number(community.gps_longitude)],
      { icon: markerIcon(status) }
    )
      .addTo(state.map)
      .bindPopup(renderCommunityPopup(community, status));

    state.markersByKey.set(community.community_id, marker);
  });

  fitMapToCommunities(mapped);
  window.setTimeout(() => state.map?.invalidateSize(), 100);
}

function markerIcon(status) {
  return window.L.divIcon({
    className: "",
    html: `<span class="map-marker-icon ${escapeAttribute(status)}">&#127807;</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -15]
  });
}

function renderCommunityPopup(community, status) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(community.community_name || "-")}</strong>
      <span>${escapeHtml(community.community_id || "-")}</span>
      <small>${escapeHtml(statusLabel(status))}</small>
      <small>${escapeHtml(formatKg(community.total_weight_kg))} total kg</small>
      <small>${escapeHtml(formatCoordinatePair(community.gps_latitude, community.gps_longitude))}</small>
    </div>
  `;
}

function fitMapToCommunities(rows) {
  if (!state.map || !rows.length) return;
  if (rows.length === 1) {
    state.map.setView([Number(rows[0].gps_latitude), Number(rows[0].gps_longitude)], 13);
    return;
  }
  state.map.fitBounds(rows.map((row) => [Number(row.gps_latitude), Number(row.gps_longitude)]), {
    padding: [42, 42],
    maxZoom: 13
  });
}

function focusMapMarkerFromEvent(event) {
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const item = event.target.closest("[data-focus-marker]");
  if (!item) return;
  event.preventDefault();
  const marker = state.markersByKey.get(item.dataset.focusMarker);
  if (!marker || !state.map) return;
  state.map.flyTo(marker.getLatLng(), Math.max(state.map.getZoom(), 13), { duration: 0.45 });
  window.setTimeout(() => marker.openPopup(), 420);
  setActiveMapListItem(item.dataset.focusMarker);
  els.adminCommunityMap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setActiveMapListItem(key) {
  document.querySelectorAll("[data-focus-marker]").forEach((item) => {
    item.classList.toggle("active", item.dataset.focusMarker === key);
  });
}

function showMapFallback(message) {
  els.adminMapFallback.hidden = false;
  els.adminMapFallback.textContent = message;
}

async function loadTodayIntake(options = {}) {
  if (!els.todayIntakeRows) return;

  if (!options.quiet) setTodayIntakeStatus("Loading...");
  state.selectedTodayIntakeIds.clear();
  updateTodaySelectionUi();

  try {
    state.todayIntakeRows = await supabaseRpc(RPC.todayIntake, {
      p_intake_date: nullableText(els.todayIntakeDate.value)
    });
    renderTodayIntake();
    if (!options.quiet) setTodayIntakeStatus("Loaded.");
  } catch (error) {
    state.todayIntakeRows = [];
    els.todayIntakeCount.textContent = "Error";
    els.todayIntakeRows.innerHTML = emptyRow(12, writeErrorMessage(error));
    setTodayIntakeStatus("Could not load intake rows.", "error");
  }
}

function renderTodayIntake() {
  if (!els.todayIntakeRows) return;

  els.todayIntakeCount.textContent = `${state.todayIntakeRows.length} rows`;
  els.todayIntakeRows.innerHTML = sortedTodayIntakeRows().map((row) => {
    const id = String(row.id || "");
    const checked = state.selectedTodayIntakeIds.has(id) ? " checked" : "";
    return `
      <tr>
        <td class="selection-cell"><input type="checkbox" data-today-id="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "intake row")}"${checked}></td>
        <td>${escapeHtml(formatDateTime(row.collected_at))}</td>
        <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
        <td>${inlineCell([row.community_id, row.community_name_snapshot])}</td>
        <td>${inlineCell([row.farmer_id, row.farmer_name_snapshot])}</td>
        <td>${escapeHtml(row.sack_id || "-")}</td>
        <td>${escapeHtml(formatKg(row.sack_weight_kg))}</td>
        <td>${escapeHtml(formatSeaweedType(row.seaweed_type))}</td>
        <td>${escapeHtml(row.seaweed_grade || "-")}</td>
        <td>${escapeHtml(formatMoney(row.price_per_kg))}</td>
        <td>${escapeHtml(formatMoney(row.total_price))}</td>
        <td>${escapeHtml(row.notes || "-")}</td>
      </tr>
    `;
  }).join("") || emptyRow(12, "No intake rows recorded for this date.");

  updateTodaySelectionUi();
}

function handleTodayIntakeSelectionChange(event) {
  const checkbox = event.target.closest("[data-today-id]");
  if (!checkbox) return;

  const id = checkbox.dataset.todayId;
  if (checkbox.checked) {
    state.selectedTodayIntakeIds.add(id);
  } else {
    state.selectedTodayIntakeIds.delete(id);
  }
  updateTodaySelectionUi();
}

function toggleAllTodayIntakeRows() {
  if (!els.todaySelectAll) return;

  state.selectedTodayIntakeIds.clear();
  if (els.todaySelectAll.checked) {
    state.todayIntakeRows.forEach((row) => {
      if (row.id) state.selectedTodayIntakeIds.add(String(row.id));
    });
  }
  document.querySelectorAll("[data-today-id]").forEach((checkbox) => {
    checkbox.checked = els.todaySelectAll.checked;
  });
  updateTodaySelectionUi();
}

function updateTodaySelectionUi() {
  if (!els.todaySelectedCount) return;

  const selected = state.selectedTodayIntakeIds.size;
  const total = state.todayIntakeRows.length;
  els.todaySelectedCount.textContent = `${selected} selected`;
  els.todaySelectedCount.className = selected ? "status-pill" : "status-pill status-muted";

  if (els.todaySelectAll) {
    els.todaySelectAll.checked = total > 0 && selected === total;
    els.todaySelectAll.indeterminate = selected > 0 && selected < total;
  }
}

async function applyTodayBatchEdit() {
  if (!els.todayIntakeRows) return;

  const payload = buildTodayBatchPayload();
  if (!payload) return;

  els.applyTodayBatch.disabled = true;
  setTodayIntakeStatus("Saving edits...");

  try {
    const result = await supabaseRpc(RPC.updateTodayIntake, payload);
    const updatedCount = Number(result[0]?.updated_count || 0);
    clearTodayBatchForm({ keepSelection: true });
    state.selectedTodayIntakeIds.clear();
    await loadTodayIntake({ quiet: true });
    setTodayIntakeStatus(`Updated ${updatedCount} row${updatedCount === 1 ? "" : "s"}.`);
  } catch (error) {
    setTodayIntakeStatus(writeErrorMessage(error), "error");
  } finally {
    els.applyTodayBatch.disabled = false;
  }
}

function buildTodayBatchPayload() {
  const selectedIds = [...state.selectedTodayIntakeIds].filter(Boolean);
  if (!selectedIds.length) {
    setTodayIntakeStatus("Select at least one row.", "error");
    return null;
  }

  const weightAdjustment = optionalNumber(els.todayWeightAdjustment.value);
  const price = optionalNumber(els.todayBatchPrice.value);
  const payload = {
    p_ids: selectedIds,
    p_intake_date: nullableText(els.todayIntakeDate.value),
    p_farmer_id: nullableText(els.todayBatchFarmer.value),
    p_community_id: nullableText(els.todayBatchCommunity.value),
    p_weight_adjustment_kg: weightAdjustment,
    p_seaweed_type: nullableText(els.todayBatchSeaweedType.value),
    p_grade: nullableText(els.todayBatchGrade.value),
    p_price_per_kg: price,
    p_notes_append: nullableText(els.todayBatchNotes.value)
  };

  const hasChange = Boolean(
    payload.p_farmer_id ||
    payload.p_community_id ||
    payload.p_seaweed_type ||
    payload.p_grade ||
    payload.p_price_per_kg !== null ||
    payload.p_notes_append ||
    (payload.p_weight_adjustment_kg !== null && payload.p_weight_adjustment_kg !== 0)
  );

  if (!hasChange) {
    setTodayIntakeStatus("Choose a field to update.", "error");
    return null;
  }

  return payload;
}

function clearTodayBatchForm(options = {}) {
  if (els.todayBatchFarmer) els.todayBatchFarmer.value = "";
  if (els.todayBatchCommunity) els.todayBatchCommunity.value = "";
  if (els.todayWeightAdjustment) els.todayWeightAdjustment.value = "";
  if (els.todayBatchSeaweedType) els.todayBatchSeaweedType.value = "";
  if (els.todayBatchGrade) els.todayBatchGrade.value = "";
  if (els.todayBatchPrice) els.todayBatchPrice.value = "";
  if (els.todayBatchNotes) els.todayBatchNotes.value = "";

  if (!options.keepSelection) setTodayIntakeStatus("");
}

function setTodayIntakeStatus(message, type = "") {
  if (!els.todayIntakeStatus) return;
  els.todayIntakeStatus.textContent = message || "";
  els.todayIntakeStatus.dataset.status = type;
}

async function loadLedger(options = {}) {
  if (!els.ledgerRows) return;
  if (!options.quiet) {
    els.ledgerCount.textContent = "Loading";
    els.ledgerCount.className = "status-pill status-muted";
  }

  try {
    const payload = buildLedgerPayload(LEDGER_PAGE_SIZE, state.ledgerPage * LEDGER_PAGE_SIZE);
    const resultRows = await supabaseRpc(RPC.ledger, payload);
    const result = resultRows[0] || {};
    state.ledgerRows = Array.isArray(result.rows) ? result.rows : [];
    state.ledgerTotal = Number(result.total_count || 0);
    renderLedger();
  } catch (error) {
    els.ledgerRows.innerHTML = emptyRow(14, writeErrorMessage(error));
    els.ledgerCount.textContent = "Error";
    els.ledgerCount.className = "status-pill status-muted";
    els.ledgerPageStatus.textContent = "Could not load ledger.";
  }
}

function renderLedger() {
  if (!els.ledgerRows) return;

  els.ledgerCount.textContent = `${state.ledgerTotal} rows`;
  els.ledgerCount.className = "status-pill";
  els.ledgerRows.innerHTML = state.ledgerRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.collected_at))}</td>
      <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
      <td>${inlineCell([row.community_id, row.community_name_snapshot])}</td>
      <td>${inlineCell([row.farmer_id, row.farmer_name_snapshot])}</td>
      <td>${escapeHtml(row.sack_id || "-")}</td>
      <td>${escapeHtml(formatKg(row.sack_weight_kg))}</td>
      <td>${escapeHtml(formatSeaweedType(row.seaweed_type))}</td>
      <td>${escapeHtml(row.seaweed_grade || "-")}</td>
      <td>${escapeHtml(formatMoney(row.price_per_kg))}</td>
      <td>${escapeHtml(formatMoney(row.total_price))}</td>
      <td>${escapeHtml(formatCoordinatePair(row.gps_latitude, row.gps_longitude))}</td>
      <td>${escapeHtml(photoCount(row.photo_urls))}</td>
      <td>${escapeHtml(row.notes || "-")}</td>
      <td>${escapeHtml(formatDateTime(row.created_at))}</td>
    </tr>
  `).join("") || emptyRow(14, "No ledger rows match the current filters.");

  const first = state.ledgerTotal ? state.ledgerPage * LEDGER_PAGE_SIZE + 1 : 0;
  const last = Math.min((state.ledgerPage + 1) * LEDGER_PAGE_SIZE, state.ledgerTotal);
  els.ledgerPageStatus.textContent = state.ledgerTotal
    ? `Rows ${first}-${last} of ${state.ledgerTotal}`
    : "No rows";
  els.ledgerPrevPage.disabled = state.ledgerPage <= 0;
  els.ledgerNextPage.disabled = (state.ledgerPage + 1) * LEDGER_PAGE_SIZE >= state.ledgerTotal;
}

async function exportLedgerCsv() {
  if (!els.ledgerRows) return;

  try {
    const resultRows = await supabaseRpc(RPC.ledger, buildLedgerPayload(EXPORT_MAX_ROWS, 0));
    const rows = Array.isArray(resultRows[0]?.rows) ? resultRows[0].rows : [];
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `seaweed-collection-ledger-${dateInputValue(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    els.ledgerPageStatus.textContent = writeErrorMessage(error);
  }
}

function buildLedgerPayload(pageLimit, pageOffset) {
  const range = dateRangeFromControls(
    els.ledgerPeriodPreset.value,
    els.ledgerMonth.value,
    els.ledgerStartDate.value,
    els.ledgerEndDate.value
  );

  return {
    p_start_at: range.start,
    p_end_at: range.end,
    p_community_id: nullableText(els.ledgerCommunity.value),
    p_grade: nullableText(els.ledgerGrade.value),
    p_search: nullableText(sanitizeSearchTerm(els.ledgerSearch.value)),
    p_sort_key: state.ledgerSort,
    p_sort_direction: state.ledgerDirection,
    p_page_limit: pageLimit,
    p_page_offset: pageOffset
  };
}

async function supabaseRpc(functionName, payload) {
  if (!APP_CONFIG.supabase.enabled) return [];

  const response = await fetch(`${APP_CONFIG.supabase.restUrl}/rpc/${functionName}`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function baseHeaders() {
  return {
    apikey: APP_CONFIG.supabase.anonKey,
    Authorization: `Bearer ${APP_CONFIG.supabase.anonKey}`,
    "Content-Type": "application/json"
  };
}

function filteredMembers() {
  const query = searchText(els.memberSearch?.value);
  if (!query) return state.members;
  return state.members.filter((member) => {
    return searchText([
      member.farmer_id,
      member.name,
      member.phone,
      member.community_id,
      member.community_name,
      member.notes
    ].join(" ")).includes(query);
  });
}

function filteredCommunities() {
  const query = searchText(els.communitySearch?.value);
  if (!query) return state.communities;
  return state.communities.filter((community) => {
    return searchText([
      community.community_id,
      community.community_name,
      community.chair_person,
      community.chair_person_contact,
      community.notes
    ].join(" ")).includes(query);
  });
}

function dateRangeFromControls(preset, monthValue, startDate, endDate) {
  const now = new Date();
  if (preset === "all") {
    return { start: null, end: null, label: "All records" };
  }

  if (preset === "7" || preset === "30") {
    const start = new Date(now);
    start.setDate(start.getDate() - Number(preset));
    return {
      start: start.toISOString(),
      end: null,
      label: `Last ${preset} days`
    };
  }

  if (preset === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: "This month"
    };
  }

  if (preset === "month") {
    const [year, month] = String(monthValue || monthInputValue(now)).split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: formatMonth(start.toISOString())
    };
  }

  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const end = endDate ? new Date(`${endDate}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);

  return {
    start: start ? start.toISOString() : null,
    end: end ? end.toISOString() : null,
    label: "Custom dates"
  };
}

function monthlyYearForRange(range) {
  if (range.start) return new Date(range.start).getFullYear();
  return new Date().getFullYear();
}

function latestHarvestTime(rows) {
  return rows.reduce((latest, community) => {
    const time = harvestTime(community.last_collection_at);
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, Number.NEGATIVE_INFINITY);
}

function harvestRecencyClass(community, latestHarvestMs) {
  const time = harvestTime(community.last_collection_at);
  if (!Number.isFinite(time)) return "never-harvested";
  if (Number.isFinite(latestHarvestMs) && time === latestHarvestMs) return "latest-harvest";

  const ageDays = (Date.now() - time) / 86400000;
  if (ageDays <= 7) return "week-harvest";
  if (ageDays <= 30) return "month-harvest";
  return "older-harvest";
}

function harvestTime(value) {
  if (!value) return Number.NaN;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function statusLabel(status) {
  if (status === "latest-harvest") return "Latest community harvest";
  if (status === "week-harvest") return "Harvested in last 7 days";
  if (status === "month-harvest") return "Harvested in last 30 days";
  if (status === "older-harvest") return "Harvested more than 30 days ago";
  return "Never harvested";
}

function hasGps(row) {
  return Number.isFinite(Number(row.gps_latitude)) && Number.isFinite(Number(row.gps_longitude));
}

function setMetric(id, value) {
  if (els[id]) els[id].textContent = value || "--";
}

function setSelectOptions(select, options, selectedValue) {
  const values = new Set(options.map(([value]) => String(value)));
  const selected = values.has(String(selectedValue || "")) ? String(selectedValue || "") : String(options[0]?.[0] || "");
  select.innerHTML = options.map(([value, label]) => {
    const isSelected = String(value) === selected ? " selected" : "";
    return `<option value="${escapeAttribute(value)}"${isSelected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function communityLabel(community) {
  return [community.community_id, community.community_name].filter(Boolean).join(" - ");
}

function rowsToCsv(rows) {
  const headers = [
    "collected_at",
    "transaction_id",
    "community_id",
    "community_name",
    "farmer_id",
    "farmer_name",
    "sack_id",
    "sack_weight_kg",
    "seaweed_type",
    "seaweed_grade",
    "price_per_kg",
    "total_price",
    "gps_latitude",
    "gps_longitude",
    "notes",
    "created_at"
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push([
      row.collected_at,
      row.transaction_id,
      row.community_id,
      row.community_name_snapshot,
      row.farmer_id,
      row.farmer_name_snapshot,
      row.sack_id,
      row.sack_weight_kg,
      row.seaweed_type,
      row.seaweed_grade,
      row.price_per_kg,
      row.total_price,
      row.gps_latitude,
      row.gps_longitude,
      row.notes,
      row.created_at
    ].map(csvCell).join(","));
  });
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function readOnlyStack(values) {
  const lines = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!lines.length) return `<span class="muted-cell">-</span>`;
  return `<div class="readonly-stack">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div>`;
}

function inlineCell(values) {
  const text = values.map((value) => String(value || "").trim()).filter(Boolean).join(" - ");
  if (!text) return `<span class="muted-cell">-</span>`;
  return escapeHtml(text);
}

function sortedTodayIntakeRows() {
  const rows = [...state.todayIntakeRows];
  const sortKey = state.todaySort;
  const direction = state.todayDirection === "asc" ? 1 : -1;
  rows.sort((a, b) => compareTableValues(a[sortKey], b[sortKey]) * direction);
  return rows;
}

function compareTableValues(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;

  const aDate = Date.parse(a);
  const bDate = Date.parse(b);
  if (Number.isFinite(aDate) && Number.isFinite(bDate)) return aDate - bDate;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function photoCount(value) {
  return Array.isArray(value) ? String(value.length) : "0";
}

function setConnectionStatus(text, extraClass = "") {
  if (!els.adminConnectionStatus) return;
  els.adminConnectionStatus.textContent = text;
  els.adminConnectionStatus.className = `status-pill ${extraClass}`.trim();
}

function writeErrorMessage(error) {
  const message = error?.message || String(error);
  if (/401|403|permission|policy|row-level|JWT/i.test(message)) {
    return `${message}. Collection Ledger is using the public reporting RPC for this prototype stage.`;
  }
  return message;
}

async function responseDetail(response) {
  try {
    const errorBody = await response.json();
    const detail = errorBody.message || errorBody.details || errorBody.hint || errorBody.error || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function sanitizeSearchTerm(value) {
  return String(value || "")
    .trim()
    .replace(/[*,()]/g, "")
    .slice(0, 80);
}

function searchText(value) {
  return String(value || "").trim().toLowerCase();
}

function dateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function kenyaDateInputValue(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 7);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatMonth(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric"
  });
}

function formatKg(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-GB", {
    minimumFractionDigits: number % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-GB", {
    maximumFractionDigits: 0
  });
}

function formatSeaweedType(value) {
  const type = String(value || "").toLowerCase();
  if (type === "spinosum") return "Spinosum";
  if (type === "cottonii") return "Cottonii";
  if (type === "other") return "Other";
  return value || "-";
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-GB", {
    maximumFractionDigits: 0
  });
}

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(5) : "";
}

function formatCoordinatePair(latitude, longitude) {
  const lat = formatCoordinate(latitude);
  const lon = formatCoordinate(longitude);
  return lat && lon ? `${lat}, ${lon}` : "-";
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="muted-cell">${escapeHtml(message)}</td></tr>`;
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
