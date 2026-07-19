import { APP_CONFIG } from "./config.js";
import { hasMapCoordinates as hasGps, mapCoordinates } from "./map_coordinates.js";
import { dataModeLabel, selectRows } from "./supabase_client.js";
import { currentAccessToken, requireAdminAccess, setupAccountControls } from "./auth_client.js?v=18";
import { applyDashboardPreferences } from "./dashboard_preferences.js";

const TABLES = {
  overview: "ag_secure_admin_overview",
  communityDashboard: "ag_secure_community_dashboard",
  memberSummary: "ag_secure_member_registry_summary"
};

const RPC = {
  monthly: "ag_sec_admin_monthly_summary",
  communityPeriod: "ag_sec_admin_community_period_summary",
  communityGrades: "ag_sec_admin_community_grade_summary",
  ledger: "ag_sec_admin_collection_ledger_page",
  ledgerExport: "ag_sec_admin_collection_ledger_export",
  todayIntake: "ag_sec_admin_today_intake",
  updateCollectionRows: "ag_sec_admin_update_collection_rows",
  updateMemberRegistry: "ag_sec_admin_update_member_registry",
  updateCommunityRegistry: "ag_sec_admin_update_community_registry",
  deleteMemberRegistry: "ag_sec_admin_delete_member_registry",
  deleteCommunityRegistry: "ag_sec_admin_delete_community_registry"
};

const LEDGER_PAGE_SIZE = 50;
const COMMUNITY_RECORD_PAGE_SIZE = 50;
const EXPORT_MAX_ROWS = 5000;
const KENYA_COAST_VIEW = {
  center: [-4.55, 39.42],
  zoom: 9
};

const state = {
  overview: {},
  communities: [],
  members: [],
  gradeSettings: [],
  seaweedTypeSettings: [],
  monthlyRows: [],
  communitySummary: null,
  communityGradeRows: [],
  communityMonthlyRows: [],
  communityRecordRows: [],
  communityRecordTotal: 0,
  communityRecordPage: 0,
  ledgerRows: [],
  customLedgerFields: [],
  ledgerTotal: 0,
  ledgerPage: 0,
  ledgerSort: "collected_at",
  ledgerDirection: "desc",
  ledgerView: "all",
  selectedLedgerCommunityIds: new Set(),
  ledgerReloadTimer: null,
  ledgerLoadSequence: 0,
  selectedLedgerIds: new Set(),
  editingLedgerIds: new Set(),
  dirtyLedgerIds: new Set(),
  ledgerDrafts: new Map(),
  todayIntakeRows: [],
  todaySort: "collected_at",
  todayDirection: "desc",
  selectedTodayIntakeIds: new Set(),
  editingTodayIntakeIds: new Set(),
  dirtyTodayIntakeIds: new Set(),
  todayIntakeDrafts: new Map(),
  selectedMemberIds: new Set(),
  editingMemberIds: new Set(),
  selectedCommunityIds: new Set(),
  editingCommunityIds: new Set(),
  map: null,
  markersByKey: new Map(),
  profile: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  try {
    const access = await requireAdminAccess(requiredPermissionForPage());
    if (!access) return;
    state.profile = access.profile;
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error.message)}`);
    return;
  }
  setupAdminSidebar(state.profile);
  setupAccountControls(state.profile);
  applyDashboardPreferences(state.profile);
  if (!hasAdminDataView()) return;
  setDefaultControls();
  bindEvents();
  setupFixedTableScrollbar();
  await loadAdminData();
}

function cacheElements() {
  [
    "adminConnectionStatus",
    "reloadAdminDashboard",
    "metricTotalKg",
    "metricRejectedKg",
    "metricGradeAKg",
    "metricGradeBKg",
    "metricUngradedKg",
    "metricCollectionCount",
    "metricCollectionsThisMonth",
    "metricWeightThisMonth",
    "metricActiveMembers",
    "metricActiveCommunities",
    "metricLastCollection",
    "communityTotalsCount",
    "communityTotalsRows",
    "memberRegistryCount",
    "memberRegistryRows",
    "memberSearch",
    "memberRegistryEdit",
    "memberRegistrySave",
    "memberRegistryDelete",
    "memberRegistryStatus",
    "communityRegistryCount",
    "communityRegistryRows",
    "communitySearch",
    "communityRegistryEdit",
    "communityRegistrySave",
    "communityRegistryDelete",
    "communityRegistryStatus",
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
    "communityRecordCount",
    "communityRecordRows",
    "communityRecordPrevPage",
    "communityRecordNextPage",
    "communityRecordPageStatus",
    "todayIntakeCount",
    "todayIntakeDate",
    "reloadTodayIntake",
    "todayIntakeStatus",
    "todayEditActions",
    "todaySelectedCount",
    "todayStartEdit",
    "todaySaveEdits",
    "todayDiscardEdits",
    "todayDeleteSelected",
    "todaySelectionHeader",
    "todaySelectAll",
    "todayIntakeRows",
    "ledgerCount",
    "ledgerViewTabs",
    "ledgerAllView",
    "ledgerMonthlyView",
    "ledgerCommunityView",
    "ledgerCommunityCount",
    "ledgerActiveCommunityCount",
    "ledgerActiveCommunityRows",
    "ledgerInactiveCommunities",
    "ledgerInactiveCommunityCount",
    "ledgerInactiveCommunityRows",
    "ledgerPeriodPreset",
    "ledgerMonth",
    "ledgerStartDate",
    "ledgerEndDate",
    "ledgerCommunity",
    "ledgerCommunityFilter",
    "ledgerCommunitySummary",
    "ledgerCommunitySearch",
    "ledgerCommunityClear",
    "ledgerCommunityOptions",
    "ledgerGrade",
    "ledgerSearch",
    "exportLedgerCsv",
    "ledgerPrevPage",
    "ledgerNextPage",
    "ledgerPageStatus",
    "ledgerActionStatus",
    "ledgerEditActions",
    "ledgerSelectedCount",
    "ledgerStartEdit",
    "ledgerSaveEdits",
    "ledgerDiscardEdits",
    "ledgerDeleteSelected",
    "ledgerSelectionHeader",
    "ledgerSelectAll",
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
  const params = new URLSearchParams(window.location.search);

  if (els.monthlyYear) els.monthlyYear.value = String(currentYear);
  if (els.communityMonth) els.communityMonth.value = "";
  if (els.ledgerMonth) els.ledgerMonth.value = "";
  if (els.communityStartDate) els.communityStartDate.value = "";
  if (els.communityEndDate) els.communityEndDate.value = "";
  const requestedCommunityPeriod = new URLSearchParams(window.location.search).get("period");
  if (els.communityPeriodPreset && ["7", "30", "this_month", "month", "custom", "all"].includes(requestedCommunityPeriod)) {
    els.communityPeriodPreset.value = requestedCommunityPeriod;
  }
  if (els.ledgerStartDate) els.ledgerStartDate.value = "";
  if (els.ledgerEndDate) els.ledgerEndDate.value = "";
  if (els.ledgerPeriodPreset && ["7", "30", "this_month", "month", "custom", "all"].includes(params.get("period"))) {
    els.ledgerPeriodPreset.value = params.get("period");
  }
  if (els.ledgerMonth && /^\d{4}-\d{2}$/.test(params.get("month") || "")) els.ledgerMonth.value = params.get("month");
  if (els.ledgerStartDate && /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "")) els.ledgerStartDate.value = params.get("from");
  if (els.ledgerEndDate && /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "")) els.ledgerEndDate.value = params.get("to");
  if (els.ledgerSearch && params.get("search")) els.ledgerSearch.value = params.get("search");
  if (els.ledgerViewTabs) setLedgerView(params.get("view") || "all", { syncUrl: false });
  if (els.todayIntakeDate) els.todayIntakeDate.value = kenyaDateInputValue(now);
}

function bindEvents() {
  els.reloadAdminDashboard?.addEventListener("click", loadAdminData);
  els.memberSearch?.addEventListener("input", renderMemberRegistry);
  els.communitySearch?.addEventListener("input", renderCommunityRegistry);
  els.memberRegistryRows?.addEventListener("change", handleMemberRegistryChange);
  els.memberRegistryRows?.addEventListener("input", () => updateRegistryEditUi("member"));
  els.memberRegistryEdit?.addEventListener("click", startMemberRegistryEdit);
  els.memberRegistrySave?.addEventListener("click", saveMemberRegistryEdit);
  els.memberRegistryDelete?.addEventListener("click", () => deleteRegistrySelection("member"));
  els.communityRegistryRows?.addEventListener("change", handleCommunityRegistryChange);
  els.communityRegistryRows?.addEventListener("input", () => updateRegistryEditUi("community"));
  els.communityRegistryEdit?.addEventListener("click", startCommunityRegistryEdit);
  els.communityRegistrySave?.addEventListener("click", saveCommunityRegistryEdit);
  els.communityRegistryDelete?.addEventListener("click", () => deleteRegistrySelection("community"));
  els.mappedCommunityList?.addEventListener("click", focusMapMarkerFromEvent);
  els.mappedCommunityList?.addEventListener("keydown", focusMapMarkerFromEvent);
  els.reloadMonthly?.addEventListener("click", () => loadMonthly());
  els.monthlyRows?.addEventListener("click", openLedgerMonthFromEvent);
  els.ledgerCommunityView?.addEventListener("click", openLedgerCommunityFromEvent);
  els.ledgerViewTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ledger-view]");
    if (!button || state.editingLedgerIds.size) return;
    setLedgerView(button.dataset.ledgerView);
  });
  els.ledgerViewTabs?.addEventListener("keydown", handleLedgerViewKeydown);
  [
    els.ledgerPeriodPreset,
    els.ledgerMonth,
    els.ledgerStartDate,
    els.ledgerEndDate,
    els.ledgerGrade
  ].forEach((control) => control?.addEventListener("change", () => scheduleLedgerReload()));
  els.ledgerSearch?.addEventListener("input", () => scheduleLedgerReload(350));
  els.ledgerCommunitySearch?.addEventListener("input", renderLedgerCommunityOptions);
  els.ledgerCommunityOptions?.addEventListener("change", handleLedgerCommunityFilterChange);
  els.ledgerCommunityClear?.addEventListener("click", clearLedgerCommunityFilter);
  els.reloadCommunitySummary?.addEventListener("click", () => {
    state.communityRecordPage = 0;
    syncCommunitySummaryUrl();
    loadCommunitySummary();
  });
  els.communitySummarySelect?.addEventListener("change", () => {
    state.communityRecordPage = 0;
    syncCommunitySummaryUrl();
    loadCommunitySummary();
  });
  els.communityRecordPrevPage?.addEventListener("click", () => {
    if (state.communityRecordPage <= 0) return;
    state.communityRecordPage -= 1;
    loadCommunityRecordPage();
  });
  els.communityRecordNextPage?.addEventListener("click", () => {
    if ((state.communityRecordPage + 1) * COMMUNITY_RECORD_PAGE_SIZE >= state.communityRecordTotal) return;
    state.communityRecordPage += 1;
    loadCommunityRecordPage();
  });
  els.reloadTodayIntake?.addEventListener("click", () => loadTodayIntake());
  els.todayIntakeDate?.addEventListener("change", () => loadTodayIntake());
  els.todayIntakeRows?.addEventListener("change", handleTodayIntakeTableChange);
  els.todayIntakeRows?.addEventListener("input", handleTodayIntakeDraftInput);
  els.todaySelectAll?.addEventListener("change", toggleAllTodayIntakeRows);
  els.todayStartEdit?.addEventListener("click", startTodayIntakeEdit);
  els.todaySaveEdits?.addEventListener("click", saveTodayIntakeEdits);
  els.todayDiscardEdits?.addEventListener("click", discardTodayIntakeEdits);
  els.todayDeleteSelected?.addEventListener("click", deleteTodayIntakeSelection);
  els.ledgerRows?.addEventListener("change", handleLedgerTableChange);
  els.ledgerRows?.addEventListener("input", handleLedgerDraftInput);
  els.ledgerSelectAll?.addEventListener("change", toggleAllLedgerRows);
  els.ledgerStartEdit?.addEventListener("click", startLedgerEdit);
  els.ledgerSaveEdits?.addEventListener("click", saveLedgerEdits);
  els.ledgerDiscardEdits?.addEventListener("click", discardLedgerEdits);
  els.ledgerDeleteSelected?.addEventListener("click", deleteLedgerSelection);
  els.ledgerPrevPage?.addEventListener("click", () => {
    if (state.editingLedgerIds.size || state.ledgerPage <= 0) return;
    state.ledgerPage -= 1;
    loadLedger();
  });
  els.ledgerNextPage?.addEventListener("click", () => {
    if (state.editingLedgerIds.size || (state.ledgerPage + 1) * LEDGER_PAGE_SIZE >= state.ledgerTotal) return;
    state.ledgerPage += 1;
    loadLedger();
  });
  els.exportLedgerCsv?.addEventListener("click", exportLedgerCsv);

  document.querySelectorAll("[data-ledger-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.editingLedgerIds.size) return;
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
      if (state.editingTodayIntakeIds.size) return;
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

function setupFixedTableScrollbar() {
  const dock = document.createElement("div");
  const dockContent = document.createElement("div");
  dock.className = "fixed-table-scrollbar";
  dock.setAttribute("role", "region");
  dock.setAttribute("aria-label", "Horizontal table scroll control");
  dock.hidden = true;
  dockContent.className = "fixed-table-scrollbar-content";
  dock.append(dockContent);
  document.body.append(dock);

  let activeWrap = null;
  let frame = 0;
  let syncing = false;

  const refresh = () => {
    frame = 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const candidates = [...document.querySelectorAll(".responsive-table-wrap")]
      .filter((wrap) => wrap.scrollWidth > wrap.clientWidth + 2)
      .map((wrap) => {
        const rect = wrap.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return { wrap, rect, visibleHeight };
      })
      .filter(({ rect, visibleHeight }) => (
        visibleHeight > 0
        && rect.bottom > viewportHeight + 48
        && rect.right > 0
        && rect.left < viewportWidth
      ))
      .sort((first, second) => second.visibleHeight - first.visibleHeight);

    const candidate = candidates[0];
    if (!candidate) {
      activeWrap = null;
      dock.hidden = true;
      document.body.classList.remove("has-fixed-table-scrollbar");
      return;
    }

    activeWrap = candidate.wrap;
    const left = Math.max(0, candidate.rect.left);
    const right = Math.min(viewportWidth, candidate.rect.right);
    dock.style.left = `${left}px`;
    dock.style.width = `${Math.max(0, right - left)}px`;
    dockContent.style.width = `${activeWrap.scrollWidth}px`;
    dock.hidden = false;
    document.body.classList.add("has-fixed-table-scrollbar");
    if (!syncing && Math.abs(dock.scrollLeft - activeWrap.scrollLeft) > 1) {
      dock.scrollLeft = activeWrap.scrollLeft;
    }
  };

  const scheduleRefresh = () => {
    if (!frame) frame = window.requestAnimationFrame(refresh);
  };

  dock.addEventListener("scroll", () => {
    if (!activeWrap || syncing) return;
    syncing = true;
    activeWrap.scrollLeft = dock.scrollLeft;
    syncing = false;
  });
  document.addEventListener("scroll", (event) => {
    if (event.target === activeWrap && !syncing) {
      syncing = true;
      dock.scrollLeft = activeWrap.scrollLeft;
      syncing = false;
    }
    scheduleRefresh();
  }, true);
  window.addEventListener("resize", scheduleRefresh);
  if (window.ResizeObserver) new ResizeObserver(scheduleRefresh).observe(document.body);
  if (window.MutationObserver) {
    new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });
  }
  scheduleRefresh();
}

function setupAdminSidebar(profile) {
  const sidebar = document.querySelector(".admin-sidebar");
  const layout = document.querySelector(".admin-layout");
  if (!sidebar || !layout || sidebar.dataset.sidebarReady === "true") return;

  addAdminSidebarLinks(sidebar);
  applySidebarPermissions(sidebar, profile);
  groupAdminSidebarLinks(sidebar);

  const title = sidebar.querySelector("h2");
  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "admin-sidebar-top";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "admin-sidebar-toggle";

  title?.remove();
  sidebar.prepend(sidebarHeader);
  sidebarHeader.append(toggle);

  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "admin-sidebar-reveal";
  reveal.textContent = "Menu";
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

function addAdminSidebarLinks(sidebar) {
  sidebar.querySelectorAll('a[href="./admin_monthly.html"], a[href="./admin_community.html"]').forEach((link) => link.remove());

  const dashboard = sidebar.querySelector('a[href="./home.html"]');
  if (dashboard && !sidebar.querySelector('a[href="./collection.html"]')) {
    dashboard.insertAdjacentHTML(
      "afterend",
      '<p class="admin-menu-heading">Forms</p><a href="./collection.html" data-permission="can_submit_collection">Collection Form</a>'
    );
  }

  const registryHeading = [...sidebar.querySelectorAll(".admin-menu-heading")]
    .find((heading) => heading.textContent.trim().toLowerCase() === "registry");
  if (registryHeading) {
    registryHeading.textContent = "User Registry";
    if (!sidebar.querySelector('a[href="./admin_aggregators.html"]')) {
      registryHeading.insertAdjacentHTML("afterend", '<a href="./admin_aggregators.html" data-permission="can_access_admin">Aggregators</a>');
    }
    if (!sidebar.querySelector('a[href="./admin_users.html"]')) {
      registryHeading.insertAdjacentHTML("afterend", '<a href="./admin_users.html" data-permission="can_manage_users">Admin Users</a>');
    }

    const aggregators = sidebar.querySelector('a[href="./admin_aggregators.html"]');
    const communities = sidebar.querySelector('a[href="./admin_community_registry.html"]');
    const farmers = sidebar.querySelector('a[href="./admin_member_registry.html"]');
    const adminUsers = sidebar.querySelector('a[href="./admin_users.html"]');
    if (communities) communities.textContent = "Communities";
    if (farmers) farmers.textContent = "Farmers";
    if (adminUsers) adminUsers.textContent = "Admin Users";
    registryHeading.after(...[aggregators, communities, farmers, adminUsers].filter(Boolean));
  }

  const ledger = sidebar.querySelector('a[href="./admin_ledger.html"]');
  if (ledger && !sidebar.querySelector('a[href="./admin_finance.html"]')) {
    ledger.insertAdjacentHTML("afterend", '<a href="./admin_finance.html" data-permission="can_view_finance">Finance Review</a>');
  }

  const finance = sidebar.querySelector('a[href="./admin_finance.html"]') || ledger;
  if (finance && !sidebar.querySelector('a[href="./admin_receipts.html"]')) {
    finance.insertAdjacentHTML("afterend", '<a href="./admin_receipts.html" data-permission="can_view_data">Receipts</a>');
  }

  const receipts = sidebar.querySelector('a[href="./admin_receipts.html"]') || finance;
  if (receipts && !sidebar.querySelector('a[href="./admin_notifications.html"]')) {
    receipts.insertAdjacentHTML("afterend", '<a href="./admin_notifications.html" data-permission="can_view_notifications">Notifications</a>');
  }

  const tags = sidebar.querySelector('a[href="./tags.html"]');
  if (tags && !sidebar.querySelector('a[href="./admin_builder.html"]')) {
    tags.insertAdjacentHTML("afterend", '<a href="./admin_builder.html" data-permission="can_manage_settings">Settings</a>');
  }
  const settings = sidebar.querySelector('a[href="./admin_builder.html"]') || tags;
  if (settings && !sidebar.querySelector('a[href="./admin_pricing.html"]')) {
    settings.insertAdjacentHTML("afterend", '<a href="./admin_pricing.html" data-permission="can_view_finance">Pricing Matrix</a>');
  }
  const pricing = sidebar.querySelector('a[href="./admin_pricing.html"]') || settings;
  if (pricing && !sidebar.querySelector('a[href="./admin_seaweedke.html"]')) {
    pricing.insertAdjacentHTML("afterend", '<a href="./admin_seaweedke.html" data-permission="can_manage_sms_settings">SMS Settings</a>');
  }

  const currentFile = window.location.pathname.split("/").pop() || "home.html";
  sidebar.querySelectorAll("a").forEach((link) => {
    const hrefFile = new URL(link.href).pathname.split("/").pop();
    if (hrefFile === currentFile) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function groupAdminSidebarLinks(sidebar) {
  const headings = [...sidebar.querySelectorAll(".admin-menu-heading")];
  const currentFile = window.location.pathname.split("/").pop() || "home.html";

  headings.forEach((heading) => {
    const key = heading.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const details = document.createElement("details");
    details.className = "admin-menu-group";
    details.dataset.menuGroup = key;
    const summary = document.createElement("summary");
    summary.textContent = heading.textContent.trim();
    const links = document.createElement("div");
    links.className = "admin-menu-group-links";

    let sibling = heading.nextElementSibling;
    while (sibling && !sibling.classList.contains("admin-menu-heading")) {
      const next = sibling.nextElementSibling;
      links.append(sibling);
      sibling = next;
    }

    heading.replaceWith(details);
    details.append(summary, links);
    const hasCurrentPage = [...links.querySelectorAll("a")].some((link) => (
      new URL(link.href).pathname.split("/").pop() === currentFile
    ));
    const saved = localStorage.getItem(`seaweed_ag:admin_menu:${key}`);
    details.open = hasCurrentPage || saved === "true";
    details.hidden = [...links.querySelectorAll("a")].every((link) => link.hidden);
    details.addEventListener("toggle", () => {
      localStorage.setItem(`seaweed_ag:admin_menu:${key}`, String(details.open));
    });
  });

  const userRegistry = sidebar.querySelector('[data-menu-group="user-registry"]');
  const tools = sidebar.querySelector('[data-menu-group="tools"]');
  if (userRegistry && tools) tools.before(userRegistry);
}

function applySidebarPermissions(sidebar, profile) {
  const permissionByHref = {
    "./home.html": "can_view_dashboard",
    "./admin_member_registry.html": "can_view_registry",
    "./admin_community_registry.html": "can_view_registry",
    "./admin_map.html": "can_view_map",
    "./admin_today.html": "can_view_data",
    "./admin_monthly.html": "can_view_data",
    "./admin_community.html": "can_view_data",
    "./admin_ledger.html": "can_view_data",
    "./tags.html": "can_access_admin"
  };

  sidebar.querySelectorAll("a").forEach((link) => {
    const permission = link.dataset.permission || permissionByHref[link.getAttribute("href")];
    if (!permission) return;
    link.hidden = profile.app_role !== "system_admin" && !profile[permission];
  });
}

function requiredPermissionForPage() {
  const file = window.location.pathname.split("/").pop() || "home.html";
  const permissions = {
    "home.html": "can_view_dashboard",
    "admin_member_registry.html": "can_view_registry",
    "admin_community_registry.html": "can_view_registry",
    "admin_registry.html": "can_view_registry",
    "admin_map.html": "can_view_map",
    "admin_today.html": "can_view_data",
    "admin_monthly.html": "can_view_data",
    "admin_community.html": "can_view_data",
    "admin_ledger.html": "can_view_data",
    "admin_receipts.html": "can_view_data",
    "admin_notifications.html": "can_view_notifications",
    "admin_seaweedke.html": "can_manage_sms_settings",
    "admin_pricing.html": "can_view_finance",
    "admin_aggregators.html": "can_access_admin",
    "admin_finance.html": "can_view_finance",
    "admin_users.html": "can_manage_users",
    "admin_builder.html": "can_manage_settings",
    "tags.html": "can_access_admin"
  };
  return permissions[file] || "can_access_admin";
}

async function loadAdminData() {
  setConnectionStatus("Loading", "status-muted");

  try {
    const [overviewRows, communities, members, customLedgerFields, gradeSettings, seaweedTypeSettings] = await Promise.all([
      selectRows(TABLES.overview, "select=*"),
      selectRows(TABLES.communityDashboard, "select=*&order=community_id.asc"),
      selectRows(TABLES.memberSummary, "select=*&order=farmer_id.asc"),
      selectRows("ag_public_collection_custom_fields", "select=*&show_in_ledger=eq.true&order=display_order.asc"),
      selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc")
    ]);

    state.overview = overviewRows[0] || {};
    state.communities = communities;
    state.members = members;
    state.customLedgerFields = customLedgerFields;
    state.gradeSettings = gradeSettings;
    state.seaweedTypeSettings = seaweedTypeSettings;

    renderSelectors();
    renderLedgerCustomHeaders();
    renderDashboard();
    renderMemberRegistry();
    renderCommunityRegistry();
    renderMapSection();
    renderLedgerCommunityIndex();
    await Promise.all([
      loadMonthly({ quiet: true }),
      loadCommunitySummary({ quiet: true }),
      loadTodayIntake({ quiet: true }),
      loadLedger({ quiet: true })
    ]);

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
  if (els.memberRegistryRows) els.memberRegistryRows.innerHTML = emptyRow(14, message);
  if (els.communityRegistryRows) els.communityRegistryRows.innerHTML = emptyRow(12, message);
  if (els.monthlyRows) els.monthlyRows.innerHTML = emptyRow(13, message);
  if (els.communityGradeRows) els.communityGradeRows.innerHTML = emptyRow(5, message);
  if (els.communityMonthlyRows) els.communityMonthlyRows.innerHTML = emptyRow(6, message);
  if (els.communityRecordRows) els.communityRecordRows.innerHTML = emptyRow(12, message);
  if (els.todayIntakeRows) els.todayIntakeRows.innerHTML = emptyRow(12, message);
  if (els.ledgerRows) els.ledgerRows.innerHTML = emptyRow(18 + state.customLedgerFields.length, message);
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
  setMetric("metricRejectedKg", formatKg(row.rejected_weight_kg));
  setMetric("metricGradeAKg", formatKg(row.grade_a_weight_kg));
  setMetric("metricGradeBKg", formatKg(row.grade_b_weight_kg));
  setMetric("metricUngradedKg", formatKg(row.ungraded_weight_kg));
  setMetric("metricCollectionCount", formatInteger(row.collection_count));
  setMetric("metricCollectionsThisMonth", formatInteger(row.collections_this_month));
  setMetric("metricWeightThisMonth", formatKg(row.weight_this_month_kg));
  setMetric("metricActiveMembers", formatInteger(row.active_member_count));
  setMetric("metricActiveCommunities", formatInteger(activeCommunityRows().length));
  setMetric("metricLastCollection", formatDate(row.last_collection_at));
  renderCommunityTotals();
}

function renderCommunityTotals() {
  if (!els.communityTotalsRows) return;

  const communities = activeCommunityRows();
  els.communityTotalsCount.textContent = `${communities.length} ${communities.length === 1 ? "community" : "communities"}`;
  els.communityTotalsRows.innerHTML = communities.map((community) => `
    <tr>
      <td><strong>${escapeHtml(community.community_id)}</strong></td>
      <td><a class="community-record-link" href="${escapeAttribute(communityRecordsUrl(community.community_id))}">${escapeHtml(community.community_name)}</a></td>
      <td>${escapeHtml(formatKg(community.total_weight_kg))}</td>
      <td>${escapeHtml(formatKg(community.grade_a_weight_kg))}</td>
      <td>${escapeHtml(formatKg(community.grade_b_weight_kg))}</td>
      <td>${escapeHtml(formatKg(community.rejected_weight_kg))}</td>
      <td>${escapeHtml(formatInteger(community.active_member_count))}</td>
      <td>${escapeHtml(formatDate(community.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(8, "No communities have recorded weight yet.");
}

function activeCommunityRows() {
  return state.communities
    .filter((community) => Number(community.total_weight_kg) > 0)
    .sort((first, second) => (
      Number(second.total_weight_kg) - Number(first.total_weight_kg)
      || String(first.community_name || "").localeCompare(String(second.community_name || ""))
    ));
}

function renderMemberRegistry() {
  if (!els.memberRegistryRows) return;

  const rows = filteredMembers();
  pruneRegistrySelection("member", rows.map((member) => member.farmer_id));
  els.memberRegistryCount.textContent = `${rows.length} rows`;
  els.memberRegistryRows.innerHTML = rows.map((member) => {
    const memberId = String(member.farmer_id || "");
    const isSelected = state.selectedMemberIds.has(memberId);
    const isEditing = state.editingMemberIds.has(memberId);
    return `
    <tr class="${registryRowClass(isSelected, isEditing)}" data-member-id="${escapeAttribute(memberId)}">
      <td class="selection-cell"><input type="checkbox" data-member-select="${escapeAttribute(memberId)}" aria-label="Select ${escapeAttribute(memberId || "member")}"${isSelected ? " checked" : ""}></td>
      <td><strong>${escapeHtml(member.farmer_id || "-")}</strong></td>
      <td${dirtyCellAttribute(isEditing, "name")}>${isEditing ? registryTextInput("member", "name", member.name) : escapeHtml(member.name || "-")}</td>
      <td${dirtyCellAttribute(isEditing, "phone")}>${isEditing ? registryTextInput("member", "phone", member.phone) : escapeHtml(member.phone || "-")}</td>
      <td${dirtyCellAttribute(isEditing, "address")}>${isEditing ? registryTextInput("member", "address", member.address) : escapeHtml(member.address || "-")}</td>
      <td${dirtyCellAttribute(isEditing, "date_of_birth")}>${isEditing ? registryDateInput("member", "date_of_birth", member.date_of_birth) : escapeHtml(formatDate(member.date_of_birth))}</td>
      <td${dirtyCellAttribute(isEditing, "community_id")}>${isEditing ? registryCommunitySelect(member.community_id) : escapeHtml(member.community_id || "-")}</td>
      <td>${escapeHtml(member.community_name || "-")}</td>
      <td${dirtyCellAttribute(isEditing, "farm_size")}>${isEditing ? registryFarmSizeInputs(member) : escapeHtml(formatFarmSize(member))}</td>
      <td>${escapeHtml(formatDate(member.farm_size_updated_at))}</td>
      <td${dirtyCellAttribute(isEditing, "active")}>${isEditing ? registryActiveSelect("member", member.active !== false) : escapeHtml(member.active === false ? "Inactive" : "Active")}</td>
      <td>${escapeHtml(formatDate(member.last_collection_at))}</td>
      <td>${escapeHtml(formatKg(member.total_weight_kg))}</td>
      <td${dirtyCellAttribute(isEditing, "notes")}>${isEditing ? registryTextInput("member", "notes", member.notes) : escapeHtml(member.notes || "-")}</td>
    </tr>
  `;
  }).join("") || emptyRow(14, "No member registry rows found.");
  updateRegistryEditUi("member");
}

function renderCommunityRegistry() {
  if (!els.communityRegistryRows) return;

  const rows = filteredCommunities();
  pruneRegistrySelection("community", rows.map((community) => community.community_id));
  els.communityRegistryCount.textContent = `${rows.length} rows`;
  els.communityRegistryRows.innerHTML = rows.map((community) => {
    const communityId = String(community.community_id || "");
    const isSelected = state.selectedCommunityIds.has(communityId);
    const isEditing = state.editingCommunityIds.has(communityId);
    return `
    <tr class="${registryRowClass(isSelected, isEditing)}" data-community-id="${escapeAttribute(communityId)}">
      <td class="selection-cell"><input type="checkbox" data-community-select="${escapeAttribute(communityId)}" aria-label="Select ${escapeAttribute(communityId || "community")}"${isSelected ? " checked" : ""}></td>
      <td><strong>${escapeHtml(community.community_id || "-")}</strong></td>
      <td${dirtyCellAttribute(isEditing, "community_name")}>${isEditing ? registryTextInput("community", "community_name", community.community_name) : escapeHtml(community.community_name || "-")}</td>
      <td${dirtyCellAttribute(isEditing, "gps_pair")}>${isEditing ? registryGpsInput(community.gps_latitude, community.gps_longitude) : escapeHtml(formatCoordinatePair(community.gps_latitude, community.gps_longitude))}</td>
      <td${dirtyCellAttribute(isEditing, "chair_person")}>${isEditing ? registryTextInput("community", "chair_person", community.chair_person) : escapeHtml(community.chair_person || "-")}</td>
      <td${dirtyCellAttribute(isEditing, "chair_person_contact")}>${isEditing ? registryTextInput("community", "chair_person_contact", community.chair_person_contact) : escapeHtml(community.chair_person_contact || "-")}</td>
      <td>${escapeHtml(formatInteger(community.active_member_count))}</td>
      <td>${escapeHtml(formatKg(community.total_weight_kg))}</td>
      <td>${escapeHtml(formatDate(community.last_collection_at))}</td>
      <td>${escapeHtml(hasGps(community) ? "Mapped" : "Needs GPS")}</td>
      <td${dirtyCellAttribute(isEditing, "active")}>${isEditing ? registryActiveSelect("community", community.active !== false) : escapeHtml(community.active === false ? "Inactive" : "Active")}</td>
      <td${dirtyCellAttribute(isEditing, "notes")}>${isEditing ? registryTextInput("community", "notes", community.notes) : escapeHtml(community.notes || "-")}</td>
    </tr>
  `;
  }).join("") || emptyRow(12, "No community registry rows found.");
  updateRegistryEditUi("community");
}

function handleMemberRegistryChange(event) {
  if (event.target.matches("[data-member-select]")) {
    const memberId = event.target.dataset.memberSelect;
    updateRegistrySelectionSet(state.selectedMemberIds, state.editingMemberIds, memberId, event.target.checked);
    setRegistryStatus("member", "");
    renderMemberRegistry();
    return;
  }

  if (event.target.matches("[data-registry-field]")) updateRegistryEditUi("member");
}

function handleCommunityRegistryChange(event) {
  if (event.target.matches("[data-community-select]")) {
    const communityId = event.target.dataset.communitySelect;
    updateRegistrySelectionSet(state.selectedCommunityIds, state.editingCommunityIds, communityId, event.target.checked);
    setRegistryStatus("community", "");
    renderCommunityRegistry();
    return;
  }

  if (event.target.matches("[data-registry-field]")) updateRegistryEditUi("community");
}

function startMemberRegistryEdit() {
  if (!state.selectedMemberIds.size) return;
  state.editingMemberIds = new Set(state.selectedMemberIds);
  setRegistryStatus("member", "");
  renderMemberRegistry();
}

function startCommunityRegistryEdit() {
  if (!state.selectedCommunityIds.size) return;
  state.editingCommunityIds = new Set(state.selectedCommunityIds);
  setRegistryStatus("community", "");
  renderCommunityRegistry();
}

async function saveMemberRegistryEdit() {
  const dirtyRows = dirtyRegistryRows("member");
  if (!dirtyRows.length) return;

  els.memberRegistrySave.disabled = true;
  setRegistryStatus("member", `Saving ${dirtyRows.length} row${dirtyRows.length === 1 ? "" : "s"}...`);

  try {
    for (const row of dirtyRows) {
      await supabaseRpc(RPC.updateMemberRegistry, {
        p_farmer_id: row.dataset.memberId,
        p_name: registryFieldValue(row, "name"),
        p_phone: nullableText(registryFieldValue(row, "phone")),
        p_community_id: nullableText(registryFieldValue(row, "community_id")),
        p_active: registryFieldValue(row, "active") !== "false",
        p_notes: nullableText(registryFieldValue(row, "notes")),
        p_farm_size_value: optionalNumber(registryFieldValue(row, "farm_size_value")),
        p_farm_size_unit: nullableText(registryFieldValue(row, "farm_size_unit")) || "lines",
        p_address: nullableText(registryFieldValue(row, "address")),
        p_date_of_birth: nullableText(registryFieldValue(row, "date_of_birth"))
      });
    }
    clearRegistrySelection("member");
    await loadAdminData();
    setRegistryStatus("member", `Saved ${dirtyRows.length} row${dirtyRows.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setRegistryStatus("member", writeErrorMessage(error), "error");
    els.memberRegistrySave.disabled = false;
  }
}

async function saveCommunityRegistryEdit() {
  const dirtyRows = dirtyRegistryRows("community");
  if (!dirtyRows.length) return;

  els.communityRegistrySave.disabled = true;
  setRegistryStatus("community", `Saving ${dirtyRows.length} row${dirtyRows.length === 1 ? "" : "s"}...`);

  try {
    const payloads = dirtyRows.map((row) => {
      const gps = parseGpsPair(registryFieldValue(row, "gps_pair"));
      return {
        p_community_id: row.dataset.communityId,
        p_community_name: registryFieldValue(row, "community_name"),
        p_gps_latitude: gps.latitude,
        p_gps_longitude: gps.longitude,
        p_chair_person: nullableText(registryFieldValue(row, "chair_person")),
        p_chair_person_contact: nullableText(registryFieldValue(row, "chair_person_contact")),
        p_active: registryFieldValue(row, "active") !== "false",
        p_notes: nullableText(registryFieldValue(row, "notes"))
      };
    });

    for (const payload of payloads) {
      await supabaseRpc(RPC.updateCommunityRegistry, payload);
    }
    clearRegistrySelection("community");
    await loadAdminData();
    setRegistryStatus("community", `Saved ${dirtyRows.length} row${dirtyRows.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setRegistryStatus("community", writeErrorMessage(error), "error");
    els.communityRegistrySave.disabled = false;
  }
}

async function deleteRegistrySelection(type) {
  const ids = selectedRegistryIds(type);
  if (!ids.length) return;

  const label = type === "member" ? "member" : "community";
  const confirmed = window.confirm(`Delete ${ids.length} selected ${pluralize(label, ids.length)} from the active registry? Historical collections will remain.`);
  if (!confirmed) return;

  const deleteButton = type === "member" ? els.memberRegistryDelete : els.communityRegistryDelete;
  deleteButton.disabled = true;
  setRegistryStatus(type, `Deleting ${ids.length} row${ids.length === 1 ? "" : "s"}...`);

  try {
    const rpc = type === "member" ? RPC.deleteMemberRegistry : RPC.deleteCommunityRegistry;
    const payloadKey = type === "member" ? "p_farmer_ids" : "p_community_ids";
    const result = await supabaseRpc(rpc, { [payloadKey]: ids });
    const deletedCount = Number(result[0]?.updated_count || 0);
    clearRegistrySelection(type);
    await loadAdminData();
    setRegistryStatus(type, `Deleted ${deletedCount} row${deletedCount === 1 ? "" : "s"}.`);
  } catch (error) {
    setRegistryStatus(type, writeErrorMessage(error), "error");
    deleteButton.disabled = false;
  }
}

function registryRowClass(isSelected, isEditing) {
  return [
    isSelected ? "registry-row-selected" : "",
    isEditing ? "registry-row-editing" : ""
  ].filter(Boolean).join(" ");
}

function dirtyCellAttribute(isEditing, fieldName) {
  if (!isEditing) return "";
  return ` data-registry-cell="${escapeAttribute(fieldName)}"`;
}

function registryTextInput(type, fieldName, value) {
  const safeValue = String(value ?? "");
  return `
    <input class="registry-edit-control"
      data-registry-type="${escapeAttribute(type)}"
      data-registry-field="${escapeAttribute(fieldName)}"
      data-original="${escapeAttribute(safeValue)}"
      value="${escapeAttribute(safeValue)}"
      autocomplete="off">
  `;
}

function registryDateInput(type, fieldName, value) {
  const safeValue = String(value ?? "").slice(0, 10);
  return `
    <input class="registry-edit-control"
      type="date"
      data-registry-type="${escapeAttribute(type)}"
      data-registry-field="${escapeAttribute(fieldName)}"
      data-original="${escapeAttribute(safeValue)}"
      value="${escapeAttribute(safeValue)}"
      max="${dateInputValue(new Date())}">
  `;
}

function registryCommunitySelect(selectedCommunityId) {
  const selected = String(selectedCommunityId || "");
  const options = [
    ["", "-"],
    ...state.communities.map((community) => [
      community.community_id,
      communityLabel(community)
    ])
  ];
  return `
    <select class="registry-edit-control"
      data-registry-type="member"
      data-registry-field="community_id"
      data-original="${escapeAttribute(selected)}">
      ${options.map(([value, label]) => `<option value="${escapeAttribute(value)}"${String(value) === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select>
  `;
}

function registryFarmSizeInputs(member) {
  const value = valueOrEmpty(member.farm_size_value);
  const selectedUnit = String(member.farm_size_unit || "lines").trim() || "lines";
  const unitOptions = ["lines", "ropes", "plots", "acres", "hectares", "sqm", "other"];
  if (!unitOptions.includes(selectedUnit)) unitOptions.push(selectedUnit);

  return `
    <span class="registry-farm-size-fields">
      <input class="registry-edit-control registry-farm-size-value"
        type="number"
        min="0"
        step="0.01"
        inputmode="decimal"
        data-registry-type="member"
        data-registry-field="farm_size_value"
        data-original="${escapeAttribute(value)}"
        value="${escapeAttribute(value)}"
        autocomplete="off"
        aria-label="Farm size value">
      <select class="registry-edit-control registry-farm-size-unit"
        data-registry-type="member"
        data-registry-field="farm_size_unit"
        data-original="${escapeAttribute(selectedUnit)}"
        aria-label="Farm size unit">
        ${unitOptions.map((unit) => `<option value="${escapeAttribute(unit)}"${unit === selectedUnit ? " selected" : ""}>${escapeHtml(unit)}</option>`).join("")}
      </select>
    </span>
  `;
}

function registryActiveSelect(type, isActive) {
  const value = isActive ? "true" : "false";
  return `
    <select class="registry-edit-control"
      data-registry-type="${escapeAttribute(type)}"
      data-registry-field="active"
      data-original="${escapeAttribute(value)}">
      <option value="true"${value === "true" ? " selected" : ""}>Active</option>
      <option value="false"${value === "false" ? " selected" : ""}>Inactive</option>
    </select>
  `;
}

function registryGpsInput(latitude, longitude) {
  const value = formatCoordinatePair(latitude, longitude);
  const safeValue = value === "-" ? "" : value;
  return `
    <input class="registry-edit-control registry-gps-control"
      data-registry-type="community"
      data-registry-field="gps_pair"
      data-original="${escapeAttribute(safeValue)}"
      value="${escapeAttribute(safeValue)}"
      inputmode="decimal"
      autocomplete="off"
      placeholder="-4.64600, 39.38100"
      aria-label="GPS latitude and longitude">
  `;
}

function updateRegistryEditUi(type) {
  const selectedCount = selectedRegistryIds(type).length;
  const editingCount = editingRegistryIds(type).length;
  const editButton = type === "member" ? els.memberRegistryEdit : els.communityRegistryEdit;
  const saveButton = type === "member" ? els.memberRegistrySave : els.communityRegistrySave;
  const deleteButton = type === "member" ? els.memberRegistryDelete : els.communityRegistryDelete;

  if (!editButton || !saveButton || !deleteButton) return;

  editButton.hidden = !selectedCount;
  editButton.disabled = !selectedCount || Boolean(editingCount);
  editButton.textContent = editingCount ? `Editing ${editingCount}` : `Edit ${selectedCount}`;

  deleteButton.hidden = !selectedCount;
  deleteButton.textContent = `Delete selected ${selectedCount}`;

  const dirty = dirtyRegistryRows(type).length > 0;
  saveButton.hidden = !editingCount || !dirty;
  saveButton.disabled = !dirty;
}

function dirtyRegistryRows(type) {
  return editingRegistryRows(type).filter((row) => markRegistryDirtyCells(row));
}

function editingRegistryRows(type) {
  const attribute = type === "member" ? "data-member-id" : "data-community-id";
  const tbody = type === "member" ? els.memberRegistryRows : els.communityRegistryRows;
  return editingRegistryIds(type)
    .map((id) => tbody?.querySelector(`tr[${attribute}="${cssEscape(id)}"]`))
    .filter(Boolean);
}

function markRegistryDirtyCells(row) {
  let dirty = false;
  row.querySelectorAll("[data-registry-cell]").forEach((cell) => cell.classList.remove("registry-cell-dirty"));
  row.querySelectorAll("[data-registry-field]").forEach((field) => {
    const fieldDirty = normalizeRegistryValue(field.value) !== normalizeRegistryValue(field.dataset.original);
    const cell = field.closest("[data-registry-cell]") || field.closest("td");
    cell?.classList.toggle("registry-cell-dirty", fieldDirty);
    dirty = dirty || fieldDirty;
  });
  return dirty;
}

function registryFieldValue(row, fieldName) {
  return row.querySelector(`[data-registry-field="${cssEscape(fieldName)}"]`)?.value ?? "";
}

function setRegistryStatus(type, message, status = "") {
  const statusElement = type === "member" ? els.memberRegistryStatus : els.communityRegistryStatus;
  if (!statusElement) return;
  statusElement.textContent = message || "";
  statusElement.dataset.status = status;
}

function selectedRegistryIds(type) {
  return [...(type === "member" ? state.selectedMemberIds : state.selectedCommunityIds)];
}

function editingRegistryIds(type) {
  return [...(type === "member" ? state.editingMemberIds : state.editingCommunityIds)];
}

function updateRegistrySelectionSet(selectedSet, editingSet, id, isSelected) {
  if (isSelected) {
    selectedSet.add(id);
  } else {
    selectedSet.delete(id);
    editingSet.delete(id);
  }
}

function pruneRegistrySelection(type, visibleIds) {
  const visible = new Set(visibleIds.map((id) => String(id || "")));
  const selectedSet = type === "member" ? state.selectedMemberIds : state.selectedCommunityIds;
  const editingSet = type === "member" ? state.editingMemberIds : state.editingCommunityIds;
  [...selectedSet].forEach((id) => {
    if (!visible.has(id)) {
      selectedSet.delete(id);
      editingSet.delete(id);
    }
  });
  [...editingSet].forEach((id) => {
    if (!selectedSet.has(id)) editingSet.delete(id);
  });
}

function clearRegistrySelection(type) {
  if (type === "member") {
    state.selectedMemberIds.clear();
    state.editingMemberIds.clear();
  } else {
    state.selectedCommunityIds.clear();
    state.editingCommunityIds.clear();
  }
}

function parseGpsPair(value) {
  const text = String(value || "").trim();
  if (!text) return { latitude: null, longitude: null };

  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("GPS must use latitude, longitude separated by a comma.");
  }

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("GPS latitude and longitude must be numbers.");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("GPS latitude or longitude is outside the valid range.");
  }

  return { latitude, longitude };
}

function pluralize(label, count) {
  if (count === 1) return label;
  if (label === "community") return "communities";
  return `${label}s`;
}

function renderSelectors() {
  const params = new URLSearchParams(window.location.search);
  const communityOptions = [
    ["", "All communities"],
    ...state.communities.map((community) => [
      community.community_id,
      communityLabel(community)
    ])
  ];

  if (els.monthlyCommunity) setSelectOptions(els.monthlyCommunity, communityOptions, els.monthlyCommunity.value);
  if (els.ledgerCommunity) {
    const requestedCommunities = els.ledgerCommunity.value || params.get("community") || "";
    setLedgerCommunities(parseLedgerCommunityIds(requestedCommunities));
  }
  if (els.communitySummarySelect) setSelectOptions(els.communitySummarySelect, communityOptions, selectedCommunityValue());

  const gradeOptions = state.gradeSettings.map((grade) => [
    grade.grade,
    [grade.grade, grade.label && grade.label !== grade.grade ? grade.label : "", grade.rejected ? "Rejected" : ""].filter(Boolean).join(" - ")
  ]);
  if (els.monthlyGrade) setSelectOptions(els.monthlyGrade, [["", "All grades"], ...gradeOptions], els.monthlyGrade.value);
  if (els.ledgerGrade) {
    setSelectOptions(els.ledgerGrade, [["", "All grades"], ...gradeOptions], els.ledgerGrade.value || params.get("grade") || "");
  }
}

function selectedCommunityValue() {
  if (els.communitySummarySelect?.value) return els.communitySummarySelect.value;
  const requested = new URLSearchParams(window.location.search).get("community");
  const matched = state.communities.find((community) => (
    String(community.community_id || "").toLowerCase() === String(requested || "").trim().toLowerCase()
  ));
  if (matched?.community_id) return matched.community_id;
  return state.communities[0]?.community_id || "";
}

function syncCommunitySummaryUrl() {
  if (!els.communitySummarySelect) return;
  const url = new URL(window.location.href);
  const communityId = nullableText(els.communitySummarySelect.value);
  if (communityId) url.searchParams.set("community", communityId);
  else url.searchParams.delete("community");
  if (els.communityPeriodPreset?.value) url.searchParams.set("period", els.communityPeriodPreset.value);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function communityRecordsUrl(communityId) {
  const params = new URLSearchParams({
    view: "all",
    community: String(communityId || ""),
    period: "all"
  });
  return `./admin_ledger.html?${params.toString()}`;
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
      <td>${els.ledgerMonthlyView
        ? `<button class="ledger-summary-link" type="button" data-ledger-month="${escapeAttribute(ledgerMonthValue(row.month_start))}">${escapeHtml(row.month_label || formatMonth(row.month_start))}</button>`
        : `<strong>${escapeHtml(row.month_label || formatMonth(row.month_start))}</strong>`}</td>
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

function setLedgerView(requestedView, options = {}) {
  if (!els.ledgerViewTabs) return;
  const view = ["all", "monthly", "community"].includes(requestedView) ? requestedView : "all";
  state.ledgerView = view;

  const panels = {
    all: els.ledgerAllView,
    monthly: els.ledgerMonthlyView,
    community: els.ledgerCommunityView
  };
  Object.entries(panels).forEach(([key, panel]) => {
    if (panel) panel.hidden = key !== view;
  });
  els.ledgerViewTabs.querySelectorAll("[data-ledger-view]").forEach((button) => {
    const selected = button.dataset.ledgerView === view;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  if (els.ledgerCount) els.ledgerCount.hidden = view !== "all";
  if (view === "community") renderLedgerCommunityIndex();
  if (options.syncUrl !== false) syncLedgerUrl();
}

function handleLedgerViewKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...els.ledgerViewTabs.querySelectorAll("[data-ledger-view]")];
  const currentIndex = tabs.indexOf(event.target.closest("[data-ledger-view]"));
  if (currentIndex < 0) return;
  event.preventDefault();
  let nextIndex = event.key === "Home" ? 0 : tabs.length - 1;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  setLedgerView(tabs[nextIndex].dataset.ledgerView);
  tabs[nextIndex].focus();
}

function syncLedgerUrl() {
  if (!els.ledgerViewTabs) return;
  const url = new URL(window.location.href);
  setUrlFilter(url, "view", state.ledgerView === "all" ? "" : state.ledgerView);
  setUrlFilter(url, "period", els.ledgerPeriodPreset?.value === "30" ? "" : els.ledgerPeriodPreset?.value);
  setUrlFilter(url, "month", els.ledgerMonth?.value);
  setUrlFilter(url, "from", els.ledgerStartDate?.value);
  setUrlFilter(url, "to", els.ledgerEndDate?.value);
  setUrlFilter(url, "community", els.ledgerCommunity?.value);
  setUrlFilter(url, "grade", els.ledgerGrade?.value);
  setUrlFilter(url, "search", sanitizeSearchTerm(els.ledgerSearch?.value));
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function setUrlFilter(url, key, value) {
  const normalized = String(value || "").trim();
  if (normalized) url.searchParams.set(key, normalized);
  else url.searchParams.delete(key);
}

function parseLedgerCommunityIds(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((communityId) => communityId.trim().toUpperCase())
    .filter(Boolean))];
}

function setLedgerCommunities(communityIds) {
  if (!els.ledgerCommunity) return;
  const requested = new Set(parseLedgerCommunityIds(communityIds));
  state.selectedLedgerCommunityIds = new Set(state.communities
    .map((community) => String(community.community_id || ""))
    .filter((communityId) => requested.has(communityId.toUpperCase())));
  renderLedgerCommunityFilter();
}

function renderLedgerCommunityFilter() {
  if (!els.ledgerCommunityOptions || !els.ledgerCommunitySummary) return;
  renderLedgerCommunityOptions();
  syncLedgerCommunityControl();
}

function renderLedgerCommunityOptions() {
  if (!els.ledgerCommunityOptions) return;
  const query = String(els.ledgerCommunitySearch?.value || "").trim().toLowerCase();
  const communities = state.communities.filter((community) => (
    !query || communityLabel(community).toLowerCase().includes(query)
  ));
  els.ledgerCommunityOptions.innerHTML = communities.map((community) => {
    const communityId = String(community.community_id || "");
    const checked = state.selectedLedgerCommunityIds.has(communityId) ? " checked" : "";
    return `<label><input type="checkbox" value="${escapeAttribute(communityId)}" data-ledger-community-option${checked}> <span>${escapeHtml(communityLabel(community))}</span></label>`;
  }).join("") || `<p class="field-hint">${query ? "No communities match this search." : "No communities available."}</p>`;
}

function syncLedgerCommunityControl() {
  if (!els.ledgerCommunity || !els.ledgerCommunitySummary) return;
  const selectedIds = state.communities
    .map((community) => String(community.community_id || ""))
    .filter((communityId) => state.selectedLedgerCommunityIds.has(communityId));
  els.ledgerCommunity.value = selectedIds.join(",");
  const selectedCommunities = state.communities.filter((community) => (
    state.selectedLedgerCommunityIds.has(String(community.community_id || ""))
  ));
  const summary = selectedCommunities.length === 0
    ? "All communities"
    : selectedCommunities.length === 1
      ? communityLabel(selectedCommunities[0])
      : `${selectedCommunities.length} communities`;
  els.ledgerCommunitySummary.textContent = summary;
  els.ledgerCommunitySummary.title = selectedCommunities.length > 1
    ? selectedCommunities.map(communityLabel).join(", ")
    : summary;
  if (els.ledgerCommunityClear) els.ledgerCommunityClear.disabled = selectedCommunities.length === 0;
}

function handleLedgerCommunityFilterChange(event) {
  const checkbox = event.target.closest("[data-ledger-community-option]");
  if (!checkbox || state.editingLedgerIds.size) return;
  if (checkbox.checked) state.selectedLedgerCommunityIds.add(checkbox.value);
  else state.selectedLedgerCommunityIds.delete(checkbox.value);
  syncLedgerCommunityControl();
  scheduleLedgerReload(150);
}

function clearLedgerCommunityFilter() {
  if (state.editingLedgerIds.size || state.selectedLedgerCommunityIds.size === 0) return;
  state.selectedLedgerCommunityIds.clear();
  renderLedgerCommunityOptions();
  syncLedgerCommunityControl();
  scheduleLedgerReload();
}

function scheduleLedgerReload(delay = 0) {
  if (!els.ledgerRows || state.editingLedgerIds.size) return;
  window.clearTimeout(state.ledgerReloadTimer);
  state.ledgerReloadTimer = window.setTimeout(() => {
    state.ledgerPage = 0;
    syncLedgerUrl();
    loadLedger();
  }, delay);
}

function openLedgerMonthFromEvent(event) {
  const button = event.target.closest("[data-ledger-month]");
  if (!button || !els.ledgerMonthlyView || state.editingLedgerIds.size) return;
  const month = button.dataset.ledgerMonth;
  if (!/^\d{4}-\d{2}$/.test(month)) return;

  els.ledgerPeriodPreset.value = "month";
  els.ledgerMonth.value = month;
  els.ledgerStartDate.value = "";
  els.ledgerEndDate.value = "";
  setLedgerCommunities(els.monthlyCommunity?.value || "");
  els.ledgerGrade.value = els.monthlyGrade?.value || "";
  els.ledgerSearch.value = "";
  state.ledgerPage = 0;
  setLedgerView("all", { syncUrl: false });
  syncLedgerUrl();
  els.ledgerViewTabs.querySelector('[data-ledger-view="all"]')?.focus();
  setLedgerActionStatus(`Showing collection records for ${formatMonth(`${month}-01`)}.`);
  loadLedger({ quiet: true });
}

function ledgerMonthValue(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : monthInputValue(date);
}

function renderLedgerCommunityIndex() {
  if (!els.ledgerActiveCommunityRows || !els.ledgerInactiveCommunityRows) return;
  const active = state.communities.filter((community) => Number(community.collection_count || 0) > 0);
  const inactive = state.communities.filter((community) => Number(community.collection_count || 0) === 0);

  els.ledgerCommunityCount.textContent = `${state.communities.length} communit${state.communities.length === 1 ? "y" : "ies"}`;
  els.ledgerActiveCommunityCount.textContent = `${active.length} active`;
  els.ledgerInactiveCommunityCount.textContent = `${inactive.length}`;
  els.ledgerActiveCommunityRows.innerHTML = active.map((community) => `
    <tr>
      <td><button class="ledger-summary-link" type="button" data-ledger-community="${escapeAttribute(community.community_id)}">${escapeHtml(communityLabel(community))}</button></td>
      <td>${escapeHtml(formatInteger(community.collection_count))}</td>
      <td>${escapeHtml(formatInteger(community.active_collecting_members))}</td>
      <td>${escapeHtml(formatKg(community.total_weight_kg))}</td>
      <td>${escapeHtml(formatDate(community.first_collection_at))}</td>
      <td>${escapeHtml(formatDate(community.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(6, "No communities have collection records yet.");
  els.ledgerInactiveCommunityRows.innerHTML = inactive.map((community) => `
    <tr>
      <td><button class="ledger-summary-link" type="button" data-ledger-community="${escapeAttribute(community.community_id)}">${escapeHtml(communityLabel(community))}</button></td>
      <td>${escapeHtml(formatInteger(community.member_count))}</td>
      <td>0</td>
    </tr>
  `).join("") || emptyRow(3, "No inactive communities.");
}

function openLedgerCommunityFromEvent(event) {
  const button = event.target.closest("[data-ledger-community]");
  if (!button || state.editingLedgerIds.size) return;
  const communityId = button.dataset.ledgerCommunity;
  if (!communityId) return;

  els.ledgerPeriodPreset.value = "all";
  els.ledgerMonth.value = "";
  els.ledgerStartDate.value = "";
  els.ledgerEndDate.value = "";
  setLedgerCommunities(communityId);
  els.ledgerGrade.value = "";
  els.ledgerSearch.value = "";
  state.ledgerPage = 0;
  setLedgerView("all", { syncUrl: false });
  syncLedgerUrl();
  els.ledgerViewTabs.querySelector('[data-ledger-view="all"]')?.focus();
  const community = state.communities.find((row) => row.community_id === communityId);
  setLedgerActionStatus(`Showing all collection records for ${communityLabel(community || { community_id: communityId })}.`);
  loadLedger({ quiet: true });
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
    const [summaryRows, gradeRows, monthlyRows, recordPageRows] = await Promise.all([
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
      }),
      supabaseRpc(RPC.ledger, communityRecordPayload(range, communityId))
    ]);

    state.communitySummary = summaryRows[0] || null;
    state.communityGradeRows = gradeRows;
    state.communityMonthlyRows = monthlyRows;
    applyCommunityRecordResult(recordPageRows);
    renderCommunitySummary(range);
    els.communitySummaryStatus.textContent = range.label;
    els.communitySummaryStatus.className = "status-pill";
  } catch (error) {
    els.communitySummaryStatus.textContent = "Error";
    els.communitySummaryStatus.className = "status-pill status-muted";
    els.communitySummaryMetrics.innerHTML = "";
    els.communityGradeRows.innerHTML = emptyRow(5, error.message);
    els.communityMonthlyRows.innerHTML = emptyRow(6, error.message);
    state.communityRecordRows = [];
    state.communityRecordTotal = 0;
    if (els.communityRecordRows) els.communityRecordRows.innerHTML = emptyRow(12, error.message);
    if (els.communityRecordCount) els.communityRecordCount.textContent = "Error";
    if (els.communityRecordPageStatus) els.communityRecordPageStatus.textContent = "Could not load records.";
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

  renderCommunityRecords();
}

function communityRecordPayload(range, communityId) {
  return {
    p_start_at: range.start,
    p_end_at: range.end,
    p_community_id: communityId,
    p_grade: null,
    p_search: null,
    p_sort_key: "collected_at",
    p_sort_direction: "desc",
    p_page_limit: COMMUNITY_RECORD_PAGE_SIZE,
    p_page_offset: state.communityRecordPage * COMMUNITY_RECORD_PAGE_SIZE
  };
}

function applyCommunityRecordResult(resultRows) {
  const result = resultRows?.[0] || {};
  state.communityRecordRows = Array.isArray(result.rows) ? result.rows : [];
  state.communityRecordTotal = Number(result.total_count || 0);
}

async function loadCommunityRecordPage() {
  if (!els.communityRecordRows) return;
  const range = dateRangeFromControls(
    els.communityPeriodPreset.value,
    els.communityMonth.value,
    els.communityStartDate.value,
    els.communityEndDate.value
  );
  const communityId = nullableText(els.communitySummarySelect.value);
  els.communityRecordPageStatus.textContent = "Loading records...";
  els.communityRecordPrevPage.disabled = true;
  els.communityRecordNextPage.disabled = true;
  try {
    const resultRows = await supabaseRpc(RPC.ledger, communityRecordPayload(range, communityId));
    applyCommunityRecordResult(resultRows);
    renderCommunityRecords();
  } catch (error) {
    state.communityRecordRows = [];
    state.communityRecordTotal = 0;
    els.communityRecordRows.innerHTML = emptyRow(12, writeErrorMessage(error));
    els.communityRecordCount.textContent = "Error";
    els.communityRecordPageStatus.textContent = "Could not load records.";
  }
}

function renderCommunityRecords() {
  if (!els.communityRecordRows) return;
  els.communityRecordCount.textContent = `${state.communityRecordTotal} rows`;
  els.communityRecordRows.innerHTML = state.communityRecordRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.collected_at))}</td>
      <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
      <td>${row.receipt_id ? `<a class="table-action-link" href="./receipt.html?id=${encodeURIComponent(row.receipt_id)}">${escapeHtml(row.receipt_number || "View")}</a>` : "-"}</td>
      <td>${inlineCell([row.farmer_id, row.farmer_name_snapshot])}</td>
      <td>${escapeHtml(row.sack_id || "-")}</td>
      <td>${escapeHtml(formatKg(row.sack_weight_kg))}</td>
      <td>${escapeHtml(formatSeaweedType(row.seaweed_type))}</td>
      <td>${escapeHtml(formatDataLabel(row.product_form || "wet"))}</td>
      <td>${escapeHtml(row.seaweed_grade || "-")}</td>
      <td>${escapeHtml(formatMoney(row.price_per_kg))}</td>
      <td>${escapeHtml(formatMoney(row.total_price))}</td>
      <td>${escapeHtml(row.notes || "-")}</td>
    </tr>
  `).join("") || emptyRow(12, "No collection records match this community and period.");

  const first = state.communityRecordTotal
    ? state.communityRecordPage * COMMUNITY_RECORD_PAGE_SIZE + 1
    : 0;
  const last = Math.min(
    (state.communityRecordPage + 1) * COMMUNITY_RECORD_PAGE_SIZE,
    state.communityRecordTotal
  );
  els.communityRecordPageStatus.textContent = state.communityRecordTotal
    ? `Rows ${first}-${last} of ${state.communityRecordTotal}`
    : "No rows";
  els.communityRecordPrevPage.disabled = state.communityRecordPage <= 0;
  els.communityRecordNextPage.disabled = (
    (state.communityRecordPage + 1) * COMMUNITY_RECORD_PAGE_SIZE >= state.communityRecordTotal
  );
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
  const activeFarms = mapped.filter(hasCollectionRecords);
  const inactiveFarms = mapped.filter((community) => !hasCollectionRecords(community));
  els.mappedCommunityList.innerHTML = `
    ${renderFarmListGroup("Active Farms", activeFarms, true, latestHarvestMs, "No mapped farms have collection records yet.")}
    ${renderFarmListGroup("Inactive Farms", inactiveFarms, true, latestHarvestMs, "All mapped farms have collection records.")}
  `;

  els.missingGpsList.innerHTML = missing.length
    ? renderMapTable(missing, false, latestHarvestMs)
    : `<div class="empty-state">All active communities have GPS coordinates.</div>`;
}

function renderFarmListGroup(title, rows, includeMarkerFocus, latestHarvestMs, emptyMessage) {
  return `
    <section class="map-farm-list-group">
      <div class="map-farm-list-heading">
        <h3>${escapeHtml(title)}</h3>
        <span class="status-pill status-muted">${rows.length}</span>
      </div>
      ${rows.length
        ? renderMapTable(rows, includeMarkerFocus, latestHarvestMs)
        : `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`}
    </section>
  `;
}

function hasCollectionRecords(community) {
  return Number(community?.collection_count || 0) > 0;
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
              <td><a class="community-record-link" data-community-records-link href="${escapeAttribute(communityRecordsUrl(community.community_id))}"><strong>${escapeHtml(community.community_name || "-")}</strong></a></td>
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
      mapCoordinates(community),
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
      <a class="community-record-link" href="${escapeAttribute(communityRecordsUrl(community.community_id))}"><strong>${escapeHtml(community.community_name || "-")}</strong></a>
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
    state.map.setView(mapCoordinates(rows[0]), 13);
    return;
  }
  state.map.fitBounds(rows.map(mapCoordinates), {
    padding: [42, 42],
    maxZoom: 13
  });
}

function focusMapMarkerFromEvent(event) {
  if (event.target.closest("[data-community-records-link]")) return;
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
  resetTodayIntakeEditState();
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

  const canEdit = canEditTodayIntake();
  const editing = state.editingTodayIntakeIds.size > 0;
  els.todayIntakeCount.textContent = `${state.todayIntakeRows.length} rows`;
  els.todayIntakeRows.innerHTML = sortedTodayIntakeRows().map((row) => {
    const id = String(row.id || "");
    const checked = state.selectedTodayIntakeIds.has(id) ? " checked" : "";
    const isEditing = state.editingTodayIntakeIds.has(id);
    const isDirty = state.dirtyTodayIntakeIds.has(id);
    const draft = state.todayIntakeDrafts.get(id) || todayIntakeDraft(row);
    const rowClasses = [isEditing ? "today-row-editing" : "", isDirty ? "today-row-dirty" : ""]
      .filter(Boolean)
      .join(" ");
    return `
      <tr data-today-row="${escapeAttribute(id)}" class="${rowClasses}">
        <td class="selection-cell"${canEdit ? "" : " hidden"}><input type="checkbox" data-today-id="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "intake row")}"${checked}${editing ? " disabled" : ""}></td>
        <td>${escapeHtml(formatDateTime(row.collected_at))}</td>
        <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
        <td>${isEditing ? todaySelectControl(id, "community_id", draft.community_id, todayCommunityOptions(row)) : inlineCell([row.community_id, row.community_name_snapshot])}</td>
        <td>${isEditing ? todaySelectControl(id, "farmer_id", draft.farmer_id, todayMemberOptions(row)) : inlineCell([row.farmer_id, row.farmer_name_snapshot])}</td>
        <td>${isEditing ? todayTextControl(id, "sack_id", draft.sack_id, "today-sack-editor", 80) : escapeHtml(row.sack_id || "-")}</td>
        <td>${isEditing ? todayNumberControl(id, "sack_weight_kg", draft.sack_weight_kg, "today-number-editor", 0.01, 0.01) : escapeHtml(formatKg(row.sack_weight_kg))}</td>
        <td>${isEditing ? todaySelectControl(id, "seaweed_type", draft.seaweed_type, todaySeaweedTypeOptions(row)) : escapeHtml(formatSeaweedType(row.seaweed_type))}</td>
        <td>${isEditing ? todaySelectControl(id, "grade_code", draft.grade_code, todayGradeOptions(row)) : escapeHtml(row.seaweed_grade || "-")}</td>
        <td>${isEditing ? todayNumberControl(id, "price_per_kg", draft.price_per_kg, "today-number-editor", 0.01, 0) : escapeHtml(formatMoney(row.price_per_kg))}</td>
        <td data-today-total="${escapeAttribute(id)}">${escapeHtml(formatMoney(isEditing ? todayDraftTotal(draft, row.total_price) : row.total_price))}</td>
        <td>${isEditing ? todayTextControl(id, "notes", draft.notes, "today-notes-editor", 1000) : escapeHtml(row.notes || "-")}</td>
      </tr>
    `;
  }).join("") || emptyRow(12, "No intake rows recorded for this date.");

  updateTodaySelectionUi();
}

function handleTodayIntakeTableChange(event) {
  const checkbox = event.target.closest("[data-today-id]");
  if (checkbox) {
    handleTodayIntakeSelectionChange(checkbox);
    return;
  }
  handleTodayIntakeDraftInput(event);
}

function handleTodayIntakeSelectionChange(checkbox) {
  if (state.editingTodayIntakeIds.size) return;

  const id = checkbox.dataset.todayId;
  if (checkbox.checked) {
    state.selectedTodayIntakeIds.add(id);
  } else {
    state.selectedTodayIntakeIds.delete(id);
  }
  updateTodaySelectionUi();
}

function handleTodayIntakeDraftInput(event) {
  const control = event.target.closest("[data-today-field]");
  if (!control) return;
  const id = control.dataset.todayId;
  const field = control.dataset.todayField;
  const draft = state.todayIntakeDrafts.get(id);
  if (!draft || !state.editingTodayIntakeIds.has(id)) return;

  draft[field] = control.value;
  if (field === "farmer_id" && control.value) {
    const member = state.members.find((row) => row.farmer_id === control.value);
    if (member?.community_id) {
      draft.community_id = member.community_id;
      const communityControl = els.todayIntakeRows.querySelector(
        `[data-today-id="${cssEscape(id)}"][data-today-field="community_id"]`
      );
      if (communityControl) communityControl.value = member.community_id;
    }
  }
  if (field === "grade_code") {
    const grade = state.gradeSettings.find((row) => row.grade === control.value);
    if (grade) {
      draft.price_per_kg = valueOrEmpty(grade.price_per_kg);
      const priceControl = els.todayIntakeRows.querySelector(
        `[data-today-id="${cssEscape(id)}"][data-today-field="price_per_kg"]`
      );
      if (priceControl) priceControl.value = draft.price_per_kg;
    }
  }

  updateTodayDraftRow(id);
}

function toggleAllTodayIntakeRows() {
  if (!els.todaySelectAll || state.editingTodayIntakeIds.size || !canEditTodayIntake()) return;

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

  const canEdit = canEditTodayIntake();
  const selected = state.selectedTodayIntakeIds.size;
  const total = state.todayIntakeRows.length;
  const editing = state.editingTodayIntakeIds.size > 0;
  const dirty = state.dirtyTodayIntakeIds.size;
  els.todaySelectedCount.textContent = `${selected} selected`;
  els.todaySelectedCount.className = selected ? "status-pill" : "status-pill status-muted";
  if (els.todayEditActions) els.todayEditActions.hidden = !canEdit || selected === 0;
  if (els.todayStartEdit) {
    els.todayStartEdit.hidden = editing;
    els.todayStartEdit.disabled = selected === 0;
    els.todayStartEdit.textContent = `Edit${selected > 1 ? ` ${selected}` : ""}`;
  }
  if (els.todaySaveEdits) {
    els.todaySaveEdits.hidden = !editing;
    els.todaySaveEdits.disabled = dirty === 0;
    els.todaySaveEdits.textContent = dirty ? `Save ${dirty}` : "Save";
  }
  if (els.todayDiscardEdits) els.todayDiscardEdits.hidden = !editing;
  if (els.todayDeleteSelected) {
    els.todayDeleteSelected.hidden = editing;
    els.todayDeleteSelected.disabled = selected === 0;
    els.todayDeleteSelected.textContent = selected > 1 ? `Delete ${selected}` : "Delete";
  }
  if (els.todaySelectionHeader) els.todaySelectionHeader.hidden = !canEdit;
  if (els.todayIntakeDate) els.todayIntakeDate.disabled = editing;
  if (els.reloadTodayIntake) els.reloadTodayIntake.disabled = editing;
  document.querySelectorAll("[data-today-sort]").forEach((button) => { button.disabled = editing; });

  if (els.todaySelectAll) {
    els.todaySelectAll.checked = total > 0 && selected === total;
    els.todaySelectAll.indeterminate = selected > 0 && selected < total;
    els.todaySelectAll.disabled = !canEdit || editing || total === 0;
  }
}

function startTodayIntakeEdit() {
  if (!canEditTodayIntake() || !state.selectedTodayIntakeIds.size) return;
  state.editingTodayIntakeIds = new Set(state.selectedTodayIntakeIds);
  state.dirtyTodayIntakeIds.clear();
  state.todayIntakeDrafts.clear();
  state.todayIntakeRows.forEach((row) => {
    const id = String(row.id || "");
    if (state.editingTodayIntakeIds.has(id)) state.todayIntakeDrafts.set(id, todayIntakeDraft(row));
  });
  renderTodayIntake();
  setTodayIntakeStatus(`Editing ${state.editingTodayIntakeIds.size} selected row${state.editingTodayIntakeIds.size === 1 ? "" : "s"}.`);
}

function discardTodayIntakeEdits() {
  state.editingTodayIntakeIds.clear();
  state.dirtyTodayIntakeIds.clear();
  state.todayIntakeDrafts.clear();
  renderTodayIntake();
  setTodayIntakeStatus("Changes discarded. Nothing was saved.");
}

async function saveTodayIntakeEdits() {
  const updates = [...state.dirtyTodayIntakeIds]
    .map((id) => todayIntakeUpdatePayload(id))
    .filter(Boolean);
  if (!updates.length) return;

  els.todaySaveEdits.disabled = true;
  els.todayDiscardEdits.disabled = true;
  setTodayIntakeStatus("Saving edits...");

  try {
    const result = await supabaseRpc(RPC.updateCollectionRows, {
      p_updates: updates
    });
    const updatedCount = Number(result?.updated_count || result?.[0]?.updated_count || 0);
    await loadTodayIntake({ quiet: true });
    setTodayIntakeStatus(`Updated ${updatedCount} row${updatedCount === 1 ? "" : "s"}.`);
  } catch (error) {
    setTodayIntakeStatus(writeErrorMessage(error), "error");
  } finally {
    els.todaySaveEdits.disabled = state.dirtyTodayIntakeIds.size === 0;
    els.todayDiscardEdits.disabled = false;
  }
}

function todayIntakeUpdatePayload(id) {
  const row = todayIntakeRow(id);
  const draft = state.todayIntakeDrafts.get(id);
  if (!row || !draft) return null;

  const original = todayIntakeDraft(row);
  const payload = { id };
  if (row.updated_at) payload.expected_updated_at = row.updated_at;
  Object.keys(original).forEach((field) => {
    if (normalizeTodayDraftValue(field, draft[field]) === normalizeTodayDraftValue(field, original[field])) return;
    payload[field] = ["sack_weight_kg", "price_per_kg"].includes(field)
      ? optionalNumber(draft[field])
      : nullableText(draft[field]);
  });
  return Object.keys(payload).length > 1 ? payload : null;
}

function updateTodayDraftRow(id) {
  const row = todayIntakeRow(id);
  const draft = state.todayIntakeDrafts.get(id);
  const tableRow = els.todayIntakeRows.querySelector(`[data-today-row="${cssEscape(id)}"]`);
  if (!row || !draft || !tableRow) return;

  const dirty = todayDraftChanged(row, draft);
  if (dirty) state.dirtyTodayIntakeIds.add(id);
  else state.dirtyTodayIntakeIds.delete(id);
  tableRow.classList.toggle("today-row-dirty", dirty);
  const totalCell = tableRow.querySelector(`[data-today-total="${cssEscape(id)}"]`);
  if (totalCell) totalCell.textContent = formatMoney(todayDraftTotal(draft, row.total_price));
  updateTodaySelectionUi();
}

function todayDraftChanged(row, draft) {
  const original = todayIntakeDraft(row);
  return Object.keys(original).some((field) => normalizeTodayDraftValue(field, draft[field]) !== normalizeTodayDraftValue(field, original[field]));
}

function normalizeTodayDraftValue(field, value) {
  if (["sack_weight_kg", "price_per_kg"].includes(field)) return optionalNumber(value);
  return String(value ?? "").trim();
}

function todayDraftTotal(draft, fallbackTotal = null) {
  const weight = optionalNumber(draft.sack_weight_kg);
  const price = optionalNumber(draft.price_per_kg);
  return weight === null || price === null ? fallbackTotal : weight * price;
}

function todayIntakeDraft(row) {
  return {
    farmer_id: valueOrEmpty(row.farmer_id),
    community_id: valueOrEmpty(row.community_id),
    sack_id: valueOrEmpty(row.sack_id),
    sack_weight_kg: valueOrEmpty(row.sack_weight_kg),
    seaweed_type: valueOrEmpty(row.seaweed_type),
    grade_code: valueOrEmpty(row.seaweed_grade),
    price_per_kg: valueOrEmpty(row.price_per_kg),
    notes: valueOrEmpty(row.notes)
  };
}

function todayIntakeRow(id) {
  return state.todayIntakeRows.find((row) => String(row.id || "") === String(id)) || null;
}

function resetTodayIntakeEditState() {
  state.selectedTodayIntakeIds.clear();
  state.editingTodayIntakeIds.clear();
  state.dirtyTodayIntakeIds.clear();
  state.todayIntakeDrafts.clear();
}

function canEditTodayIntake() {
  return Boolean(state.profile && (state.profile.app_role === "system_admin" || state.profile.can_edit_collections));
}

function todayCommunityOptions(row) {
  const options = [["", "Unassigned"], ...state.communities.map((community) => [
    community.community_id,
    communityLabel(community)
  ])];
  return withTodayFallbackOption(options, row.community_id, inlineText([row.community_id, row.community_name_snapshot]));
}

function todayMemberOptions(row) {
  const options = [["", "Unassigned"], ...state.members.map((member) => [
    member.farmer_id || "",
    inlineText([member.farmer_id, member.name, member.community_name])
  ])];
  return withTodayFallbackOption(options, row.farmer_id, inlineText([row.farmer_id, row.farmer_name_snapshot]));
}

function todaySeaweedTypeOptions(row) {
  const options = state.seaweedTypeSettings.map((type) => [
    type.type_key,
    inlineText([type.label, type.common_name])
  ]);
  return withTodayFallbackOption(options, row.seaweed_type, formatSeaweedType(row.seaweed_type));
}

function todayGradeOptions(row) {
  const options = [["", "Ungraded"], ...state.gradeSettings.map((grade) => [
    grade.grade,
    inlineText([grade.grade, grade.label && grade.label !== grade.grade ? grade.label : "", grade.rejected ? "Rejected" : ""])
  ])];
  return withTodayFallbackOption(options, row.seaweed_grade, row.seaweed_grade);
}

function withTodayFallbackOption(options, value, label) {
  const text = String(value || "");
  if (text && !options.some(([optionValue]) => String(optionValue) === text)) options.push([text, label || text]);
  return options;
}

function todaySelectControl(id, field, selectedValue, options) {
  const selected = String(selectedValue || "");
  return `<select class="today-inline-editor" data-today-id="${escapeAttribute(id)}" data-today-field="${escapeAttribute(field)}">${options.map(([value, label]) => `<option value="${escapeAttribute(value)}"${String(value) === selected ? " selected" : ""}>${escapeHtml(label || value || "-")}</option>`).join("")}</select>`;
}

function todayTextControl(id, field, value, className, maxLength) {
  return `<input class="today-inline-editor ${escapeAttribute(className)}" type="text" data-today-id="${escapeAttribute(id)}" data-today-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}" maxlength="${maxLength}">`;
}

function todayNumberControl(id, field, value, className, step, min) {
  return `<input class="today-inline-editor ${escapeAttribute(className)}" type="number" inputmode="decimal" data-today-id="${escapeAttribute(id)}" data-today-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}" step="${step}" min="${min}">`;
}

function inlineText(values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(" - ");
}

function setTodayIntakeStatus(message, type = "") {
  if (!els.todayIntakeStatus) return;
  els.todayIntakeStatus.textContent = message || "";
  els.todayIntakeStatus.dataset.status = type;
}

async function deleteTodayIntakeSelection() {
  if (!canEditTodayIntake() || state.editingTodayIntakeIds.size || !state.selectedTodayIntakeIds.size) return;
  const rows = state.todayIntakeRows.filter((row) => state.selectedTodayIntakeIds.has(String(row.id || "")));
  if (!rows.length) return;
  const label = `${rows.length} selected intake row${rows.length === 1 ? "" : "s"}`;
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

  els.todayDeleteSelected.disabled = true;
  setTodayIntakeStatus(`Deleting ${label}...`);
  try {
    const result = await deleteCollectionRows(rows);
    const deletedCount = Number(result.deleted_count || rows.length);
    await loadTodayIntake({ quiet: true });
    const cleanupNote = result.photo_cleanup_pending ? " Photo cleanup will be retried." : "";
    setTodayIntakeStatus(`Deleted ${deletedCount} row${deletedCount === 1 ? "" : "s"}.${cleanupNote}`);
  } catch (error) {
    setTodayIntakeStatus(writeErrorMessage(error), "error");
    updateTodaySelectionUi();
  }
}

async function deleteCollectionRows(rows) {
  const deletions = rows.map((row) => ({
    id: row.id,
    ...(row.updated_at ? { expected_updated_at: row.updated_at } : {})
  }));
  const response = await fetch(`${APP_CONFIG.supabase.url}/functions/v1/admin-collections`, {
    method: "POST",
    headers: await baseHeaders(),
    body: JSON.stringify({ deletions })
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
  }
  return response.json();
}

async function loadLedger(options = {}) {
  if (!els.ledgerRows) return;
  const loadSequence = ++state.ledgerLoadSequence;
  resetLedgerEditState();
  updateLedgerSelectionUi();
  if (!options.quiet) {
    els.ledgerCount.textContent = "Loading";
    els.ledgerCount.className = "status-pill status-muted";
  }

  try {
    const payload = buildLedgerPayload(LEDGER_PAGE_SIZE, state.ledgerPage * LEDGER_PAGE_SIZE);
    const resultRows = await supabaseRpc(RPC.ledger, payload);
    if (loadSequence !== state.ledgerLoadSequence) return;
    const result = resultRows[0] || {};
    state.ledgerRows = Array.isArray(result.rows) ? result.rows : [];
    state.ledgerTotal = Number(result.total_count || 0);
    renderLedger();
  } catch (error) {
    if (loadSequence !== state.ledgerLoadSequence) return;
    state.ledgerRows = [];
    els.ledgerRows.innerHTML = emptyRow(18 + state.customLedgerFields.length, writeErrorMessage(error));
    els.ledgerCount.textContent = "Error";
    els.ledgerCount.className = "status-pill status-muted";
    els.ledgerPageStatus.textContent = "Could not load ledger.";
    setLedgerActionStatus(writeErrorMessage(error), "error");
  }
}

function renderLedger() {
  if (!els.ledgerRows) return;

  const canEdit = canEditTodayIntake();
  const editing = state.editingLedgerIds.size > 0;
  els.ledgerCount.textContent = `${state.ledgerTotal} rows`;
  els.ledgerCount.className = "status-pill";
  els.ledgerRows.innerHTML = state.ledgerRows.map((row) => {
    const id = String(row.id || "");
    const checked = state.selectedLedgerIds.has(id) ? " checked" : "";
    const isEditing = state.editingLedgerIds.has(id);
    const isDirty = state.dirtyLedgerIds.has(id);
    const draft = state.ledgerDrafts.get(id) || todayIntakeDraft(row);
    const rowClasses = [isEditing ? "today-row-editing" : "", isDirty ? "today-row-dirty" : ""]
      .filter(Boolean)
      .join(" ");
    return `
      <tr data-ledger-row="${escapeAttribute(id)}" class="${rowClasses}">
        <td class="selection-cell"${canEdit ? "" : " hidden"}><input type="checkbox" data-ledger-select-id="${escapeAttribute(id)}" aria-label="Select ${escapeAttribute(row.transaction_id || "ledger row")}"${checked}${editing ? " disabled" : ""}></td>
        <td>${escapeHtml(formatDateTime(row.collected_at))}</td>
        <td>${isEditing ? ledgerSelectControl(id, "community_id", draft.community_id, todayCommunityOptions(row)) : inlineCell([row.community_id, row.community_name_snapshot])}</td>
        <td>${isEditing ? ledgerSelectControl(id, "farmer_id", draft.farmer_id, todayMemberOptions(row)) : inlineCell([row.farmer_id, row.farmer_name_snapshot])}</td>
        <td>${isEditing ? ledgerTextControl(id, "sack_id", draft.sack_id, "today-sack-editor", 80) : escapeHtml(row.sack_id || "-")}</td>
        <td>${isEditing ? ledgerNumberControl(id, "sack_weight_kg", draft.sack_weight_kg, "today-number-editor", 0.01, 0.01) : escapeHtml(formatKg(row.sack_weight_kg))}</td>
        <td>${isEditing ? ledgerSelectControl(id, "seaweed_type", draft.seaweed_type, todaySeaweedTypeOptions(row)) : escapeHtml(formatSeaweedType(row.seaweed_type))}</td>
        <td>${escapeHtml(formatDataLabel(row.product_form || "wet"))}</td>
        <td>${isEditing ? ledgerSelectControl(id, "grade_code", draft.grade_code, todayGradeOptions(row)) : escapeHtml(row.seaweed_grade || "-")}</td>
        <td>${isEditing ? ledgerNumberControl(id, "price_per_kg", draft.price_per_kg, "today-number-editor", 0.01, 0) : escapeHtml(formatMoney(row.price_per_kg))}</td>
        <td data-ledger-total="${escapeAttribute(id)}">${escapeHtml(formatMoney(isEditing ? todayDraftTotal(draft, row.total_price) : row.total_price))}</td>
        <td>${escapeHtml(formatCoordinatePair(row.gps_latitude, row.gps_longitude))}</td>
        <td>${escapeHtml(photoCount(row.photo_urls))}</td>
        <td>${isEditing ? ledgerTextControl(id, "notes", draft.notes, "today-notes-editor", 1000) : escapeHtml(row.notes || "-")}</td>
        ${state.customLedgerFields.map((field) => `<td>${escapeHtml(formatCustomFieldValue(row.custom_fields?.[field.field_key], field))}</td>`).join("")}
        <td>${inlineCell([collectorName(row), row.recorded_by_email])}</td>
        <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
        <td>${row.receipt_id ? `<a class="table-action-link" href="./receipt.html?id=${encodeURIComponent(row.receipt_id)}">${escapeHtml(row.receipt_number || "View")}</a>` : "-"}</td>
        <td>${escapeHtml(formatDateTime(row.created_at))}</td>
      </tr>
    `;
  }).join("") || emptyRow(18 + state.customLedgerFields.length, "No ledger rows match the current filters.");

  const first = state.ledgerTotal ? state.ledgerPage * LEDGER_PAGE_SIZE + 1 : 0;
  const last = Math.min((state.ledgerPage + 1) * LEDGER_PAGE_SIZE, state.ledgerTotal);
  els.ledgerPageStatus.textContent = state.ledgerTotal
    ? `Rows ${first}-${last} of ${state.ledgerTotal}`
    : "No rows";
  els.ledgerPrevPage.disabled = editing || state.ledgerPage <= 0;
  els.ledgerNextPage.disabled = editing || (state.ledgerPage + 1) * LEDGER_PAGE_SIZE >= state.ledgerTotal;
  updateLedgerSelectionUi();
}

function handleLedgerTableChange(event) {
  const checkbox = event.target.closest("[data-ledger-select-id]");
  if (checkbox) {
    if (state.editingLedgerIds.size) return;
    if (checkbox.checked) state.selectedLedgerIds.add(checkbox.dataset.ledgerSelectId);
    else state.selectedLedgerIds.delete(checkbox.dataset.ledgerSelectId);
    updateLedgerSelectionUi();
    return;
  }
  handleLedgerDraftInput(event);
}

function handleLedgerDraftInput(event) {
  const control = event.target.closest("[data-ledger-field]");
  if (!control) return;
  const id = control.dataset.ledgerId;
  const field = control.dataset.ledgerField;
  const draft = state.ledgerDrafts.get(id);
  if (!draft || !state.editingLedgerIds.has(id)) return;

  draft[field] = control.value;
  if (field === "farmer_id" && control.value) {
    const member = state.members.find((row) => row.farmer_id === control.value);
    if (member?.community_id) {
      draft.community_id = member.community_id;
      const communityControl = els.ledgerRows.querySelector(
        `[data-ledger-id="${cssEscape(id)}"][data-ledger-field="community_id"]`
      );
      if (communityControl) communityControl.value = member.community_id;
    }
  }
  if (field === "grade_code") {
    const grade = state.gradeSettings.find((row) => row.grade === control.value);
    if (grade) {
      draft.price_per_kg = valueOrEmpty(grade.price_per_kg);
      const priceControl = els.ledgerRows.querySelector(
        `[data-ledger-id="${cssEscape(id)}"][data-ledger-field="price_per_kg"]`
      );
      if (priceControl) priceControl.value = draft.price_per_kg;
    }
  }
  updateLedgerDraftRow(id);
}

function toggleAllLedgerRows() {
  if (!els.ledgerSelectAll || state.editingLedgerIds.size || !canEditTodayIntake()) return;
  state.selectedLedgerIds.clear();
  if (els.ledgerSelectAll.checked) {
    state.ledgerRows.forEach((row) => {
      if (row.id) state.selectedLedgerIds.add(String(row.id));
    });
  }
  document.querySelectorAll("[data-ledger-select-id]").forEach((checkbox) => {
    checkbox.checked = els.ledgerSelectAll.checked;
  });
  updateLedgerSelectionUi();
}

function updateLedgerSelectionUi() {
  if (!els.ledgerSelectedCount) return;
  const canEdit = canEditTodayIntake();
  const selected = state.selectedLedgerIds.size;
  const total = state.ledgerRows.length;
  const editing = state.editingLedgerIds.size > 0;
  const dirty = state.dirtyLedgerIds.size;
  els.ledgerSelectedCount.textContent = `${selected} selected`;
  els.ledgerSelectedCount.className = selected ? "status-pill" : "status-pill status-muted";
  if (els.ledgerEditActions) els.ledgerEditActions.hidden = !canEdit || selected === 0;
  if (els.ledgerStartEdit) {
    els.ledgerStartEdit.hidden = editing;
    els.ledgerStartEdit.disabled = selected === 0;
    els.ledgerStartEdit.textContent = `Edit${selected > 1 ? ` ${selected}` : ""}`;
  }
  if (els.ledgerSaveEdits) {
    els.ledgerSaveEdits.hidden = !editing;
    els.ledgerSaveEdits.disabled = dirty === 0;
    els.ledgerSaveEdits.textContent = dirty ? `Save ${dirty}` : "Save";
  }
  if (els.ledgerDiscardEdits) els.ledgerDiscardEdits.hidden = !editing;
  if (els.ledgerDeleteSelected) {
    els.ledgerDeleteSelected.hidden = editing;
    els.ledgerDeleteSelected.disabled = selected === 0;
    els.ledgerDeleteSelected.textContent = selected > 1 ? `Delete ${selected}` : "Delete";
  }
  if (els.ledgerSelectionHeader) els.ledgerSelectionHeader.hidden = !canEdit;
  if (els.ledgerSelectAll) {
    els.ledgerSelectAll.checked = total > 0 && selected === total;
    els.ledgerSelectAll.indeterminate = selected > 0 && selected < total;
    els.ledgerSelectAll.disabled = !canEdit || editing || total === 0;
  }
  [
    els.ledgerPeriodPreset, els.ledgerMonth, els.ledgerStartDate, els.ledgerEndDate,
    els.ledgerGrade, els.ledgerSearch, els.exportLedgerCsv
  ].forEach((control) => { if (control) control.disabled = editing; });
  els.ledgerCommunityFilter?.classList.toggle("is-disabled", editing);
  els.ledgerCommunityFilter?.querySelectorAll("input, button").forEach((control) => { control.disabled = editing; });
  if (editing && els.ledgerCommunityFilter) els.ledgerCommunityFilter.open = false;
  document.querySelectorAll("[data-ledger-sort]").forEach((button) => { button.disabled = editing; });
  els.ledgerViewTabs?.querySelectorAll("[data-ledger-view]").forEach((button) => { button.disabled = editing; });
  if (els.ledgerPrevPage) els.ledgerPrevPage.disabled = editing || state.ledgerPage <= 0;
  if (els.ledgerNextPage) els.ledgerNextPage.disabled = editing || (state.ledgerPage + 1) * LEDGER_PAGE_SIZE >= state.ledgerTotal;
}

function startLedgerEdit() {
  if (!canEditTodayIntake() || !state.selectedLedgerIds.size) return;
  state.editingLedgerIds = new Set(state.selectedLedgerIds);
  state.dirtyLedgerIds.clear();
  state.ledgerDrafts.clear();
  state.ledgerRows.forEach((row) => {
    const id = String(row.id || "");
    if (state.editingLedgerIds.has(id)) state.ledgerDrafts.set(id, todayIntakeDraft(row));
  });
  renderLedger();
  setLedgerActionStatus(`Editing ${state.editingLedgerIds.size} selected row${state.editingLedgerIds.size === 1 ? "" : "s"}.`);
}

function discardLedgerEdits() {
  state.editingLedgerIds.clear();
  state.dirtyLedgerIds.clear();
  state.ledgerDrafts.clear();
  renderLedger();
  setLedgerActionStatus("Changes discarded. Nothing was saved.");
}

async function saveLedgerEdits() {
  const updates = [...state.dirtyLedgerIds].map(ledgerUpdatePayload).filter(Boolean);
  if (!updates.length) return;
  els.ledgerSaveEdits.disabled = true;
  els.ledgerDiscardEdits.disabled = true;
  setLedgerActionStatus("Saving edits...");
  try {
    const result = await supabaseRpc(RPC.updateCollectionRows, { p_updates: updates });
    const updatedCount = Number(result?.updated_count || result?.[0]?.updated_count || 0);
    await loadLedger({ quiet: true });
    setLedgerActionStatus(`Updated ${updatedCount} row${updatedCount === 1 ? "" : "s"}.`);
  } catch (error) {
    setLedgerActionStatus(writeErrorMessage(error), "error");
  } finally {
    els.ledgerSaveEdits.disabled = state.dirtyLedgerIds.size === 0;
    els.ledgerDiscardEdits.disabled = false;
  }
}

function ledgerUpdatePayload(id) {
  const row = ledgerRow(id);
  const draft = state.ledgerDrafts.get(id);
  if (!row || !draft) return null;
  const original = todayIntakeDraft(row);
  const payload = { id };
  if (row.updated_at) payload.expected_updated_at = row.updated_at;
  Object.keys(original).forEach((field) => {
    if (normalizeTodayDraftValue(field, draft[field]) === normalizeTodayDraftValue(field, original[field])) return;
    payload[field] = ["sack_weight_kg", "price_per_kg"].includes(field)
      ? optionalNumber(draft[field])
      : nullableText(draft[field]);
  });
  return Object.keys(payload).some((field) => !["id", "expected_updated_at"].includes(field)) ? payload : null;
}

function updateLedgerDraftRow(id) {
  const row = ledgerRow(id);
  const draft = state.ledgerDrafts.get(id);
  const tableRow = els.ledgerRows.querySelector(`[data-ledger-row="${cssEscape(id)}"]`);
  if (!row || !draft || !tableRow) return;
  const dirty = todayDraftChanged(row, draft);
  if (dirty) state.dirtyLedgerIds.add(id);
  else state.dirtyLedgerIds.delete(id);
  tableRow.classList.toggle("today-row-dirty", dirty);
  const totalCell = tableRow.querySelector(`[data-ledger-total="${cssEscape(id)}"]`);
  if (totalCell) totalCell.textContent = formatMoney(todayDraftTotal(draft, row.total_price));
  updateLedgerSelectionUi();
}

async function deleteLedgerSelection() {
  if (!canEditTodayIntake() || state.editingLedgerIds.size || !state.selectedLedgerIds.size) return;
  const rows = state.ledgerRows.filter((row) => state.selectedLedgerIds.has(String(row.id || "")));
  if (!rows.length) return;
  const label = `${rows.length} selected ledger row${rows.length === 1 ? "" : "s"}`;
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
  els.ledgerDeleteSelected.disabled = true;
  setLedgerActionStatus(`Deleting ${label}...`);
  try {
    const result = await deleteCollectionRows(rows);
    const deletedCount = Number(result.deleted_count || rows.length);
    if (state.ledgerPage > 0 && state.ledgerRows.length === deletedCount) state.ledgerPage -= 1;
    await loadLedger({ quiet: true });
    const cleanupNote = result.photo_cleanup_pending ? " Photo cleanup will be retried." : "";
    setLedgerActionStatus(`Deleted ${deletedCount} row${deletedCount === 1 ? "" : "s"}.${cleanupNote}`);
  } catch (error) {
    setLedgerActionStatus(writeErrorMessage(error), "error");
    updateLedgerSelectionUi();
  }
}

function ledgerRow(id) {
  return state.ledgerRows.find((row) => String(row.id || "") === String(id)) || null;
}

function resetLedgerEditState() {
  state.selectedLedgerIds.clear();
  state.editingLedgerIds.clear();
  state.dirtyLedgerIds.clear();
  state.ledgerDrafts.clear();
}

function ledgerSelectControl(id, field, selectedValue, options) {
  const selected = String(selectedValue || "");
  return `<select class="today-inline-editor" data-ledger-id="${escapeAttribute(id)}" data-ledger-field="${escapeAttribute(field)}">${options.map(([value, label]) => `<option value="${escapeAttribute(value)}"${String(value) === selected ? " selected" : ""}>${escapeHtml(label || value || "-")}</option>`).join("")}</select>`;
}

function ledgerTextControl(id, field, value, className, maxLength) {
  return `<input class="today-inline-editor ${escapeAttribute(className)}" type="text" data-ledger-id="${escapeAttribute(id)}" data-ledger-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}" maxlength="${maxLength}">`;
}

function ledgerNumberControl(id, field, value, className, step, min) {
  return `<input class="today-inline-editor ${escapeAttribute(className)}" type="number" inputmode="decimal" data-ledger-id="${escapeAttribute(id)}" data-ledger-field="${escapeAttribute(field)}" value="${escapeAttribute(value)}" step="${step}" min="${min}">`;
}

function setLedgerActionStatus(message, type = "") {
  if (!els.ledgerActionStatus) return;
  els.ledgerActionStatus.textContent = message || "";
  els.ledgerActionStatus.dataset.status = type;
}

function renderLedgerCustomHeaders() {
  const headerRow = document.querySelector(".ledger-table thead tr");
  if (!headerRow) return;
  headerRow.querySelectorAll("[data-custom-ledger-field]").forEach((header) => header.remove());
  const recordedByHeader = headerRow.querySelector('[data-ledger-sort="recorded_by_name"]')?.closest("th");
  if (!recordedByHeader) return;
  state.customLedgerFields.forEach((field) => {
    const header = document.createElement("th");
    header.dataset.customLedgerField = field.field_key;
    header.textContent = field.label;
    recordedByHeader.before(header);
  });
}

async function exportLedgerCsv() {
  if (!els.ledgerRows) return;

  try {
    const resultRows = await supabaseRpc(RPC.ledgerExport, buildLedgerPayload(EXPORT_MAX_ROWS, 0));
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
    headers: await baseHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function baseHeaders() {
  const accessToken = await currentAccessToken();
  return {
    apikey: APP_CONFIG.supabase.anonKey,
    Authorization: `Bearer ${accessToken}`,
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
      member.address,
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
  const customHeaders = state.customLedgerFields.map((field) => `custom_${field.field_key}`);
  const headers = [
    "collected_at",
    "community_id",
    "community_name",
    "farmer_id",
    "farmer_name",
    "sack_id",
    "sack_weight_kg",
    "seaweed_type",
    "product_form",
    "seaweed_grade",
    "price_per_kg",
    "total_price",
    "gps_latitude",
    "gps_longitude",
    "notes",
    ...customHeaders,
    "recorded_by_user_id",
    "recorded_by_name",
    "recorded_by_email",
    "recorded_access_type",
    "transaction_id",
    "receipt_number",
    "created_at"
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push([
      row.collected_at,
      row.community_id,
      row.community_name_snapshot,
      row.farmer_id,
      row.farmer_name_snapshot,
      row.sack_id,
      row.sack_weight_kg,
      row.seaweed_type,
      row.product_form,
      row.seaweed_grade,
      row.price_per_kg,
      row.total_price,
      row.gps_latitude,
      row.gps_longitude,
      row.notes,
      ...state.customLedgerFields.map((field) => formatCustomFieldValue(row.custom_fields?.[field.field_key], field)),
      row.recorded_by_user_id,
      row.recorded_by_name,
      row.recorded_by_email,
      row.recorded_access_type,
      row.transaction_id,
      row.receipt_number,
      row.created_at
    ].map(csvCell).join(","));
  });
  return `${lines.join("\r\n")}\r\n`;
}

function formatCustomFieldValue(value, field) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    const formatted = value.toLocaleString("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: Number(field?.decimal_places ?? 2)
    });
    return field?.unit ? `${formatted} ${field.unit}` : formatted;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function collectorName(row) {
  if (row.recorded_by_name) return row.recorded_by_name;
  return row.recorded_access_type === "anonymous" ? "Unauthenticated" : "Not recorded";
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

function valueOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeRegistryValue(value) {
  return String(value ?? "").trim();
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
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

function formatFarmSize(row) {
  const number = optionalNumber(row?.farm_size_value);
  if (number === null) return "-";
  const unit = String(row?.farm_size_unit || "lines").trim() || "lines";
  return `${formatCompactNumber(number)} ${unit}`;
}

function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
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

function formatDataLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
