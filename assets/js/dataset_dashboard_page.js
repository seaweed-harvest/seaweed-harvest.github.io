import {
  authClient,
  requireOrganisationCapability,
  setupAccountControls
} from "./auth_client.js?v=25";
import { dataModeLabel } from "./supabase_client.js";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=12";

const FARMER_PAGE_SIZE = 50;

const state = {
  profile: null,
  sourceMode: "operational",
  farmerPage: 0,
  farmerTotal: 0,
  farmerLoading: false,
  searchTimer: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  try {
    const access = await requireOrganisationCapability(
      "form_intake_collection",
      "can_view_dashboard",
      "dataset_dashboard.html"
    );
    if (!access) return;
    state.profile = access.profile;
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error.message)}`);
    return;
  }

  const sidebar = populateAppSidebar(els.datasetSidebar, {
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
  bindEvents();
  await loadAll();
}

function cacheElements() {
  [
    "datasetConnectionStatus",
    "datasetSidebar",
    "datasetOrganisationName",
    "datasetOrganisationMeta",
    "reloadDatasetDashboard",
    "datasetTotalKg",
    "datasetCollectionCount",
    "datasetFarmerCount",
    "datasetCommunityCount",
    "datasetSeaweedTypeCount",
    "datasetCollectionRange",
    "datasetScopeNote",
    "datasetDashboardStatus",
    "datasetQualityPanel",
    "datasetDayPrecisionCount",
    "datasetMonthPrecisionCount",
    "datasetYearPrecisionCount",
    "datasetDateReviewCount",
    "datasetCommunityReviewCount",
    "datasetUnverifiedCount",
    "datasetNonpositiveCount",
    "datasetAmountVarianceCount",
    "datasetSeaweedTypesCount",
    "datasetSeaweedTypeRows",
    "datasetCommunitiesCount",
    "datasetCommunityRows",
    "datasetImportBatchCount",
    "datasetImportBatchRows",
    "datasetFarmersCount",
    "datasetFarmersHeading",
    "datasetFarmerHint",
    "datasetFarmerRegistryLink",
    "datasetMemberIdHeading",
    "datasetMemberNameHeading",
    "datasetFarmerSearch",
    "loadDatasetFarmers",
    "datasetFarmerPrevPage",
    "datasetFarmerPageStatus",
    "datasetFarmerNextPage",
    "datasetFarmerRows",
    "datasetFarmerStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.reloadDatasetDashboard?.addEventListener("click", loadAll);
  els.loadDatasetFarmers?.addEventListener("click", () => {
    state.farmerPage = 0;
    void loadFarmers();
  });
  els.datasetFarmerSearch?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.farmerPage = 0;
    void loadFarmers();
  });
  els.datasetFarmerSearch?.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.farmerPage = 0;
      void loadFarmers();
    }, 350);
  });
  els.datasetFarmerPrevPage?.addEventListener("click", () => changeFarmerPage(-1));
  els.datasetFarmerNextPage?.addEventListener("click", () => changeFarmerPage(1));
}

async function loadAll() {
  setConnectionStatus("Loading", "status-muted");
  setDashboardStatus("Loading dataset...");
  els.reloadDatasetDashboard.disabled = true;
  try {
    const data = await loadDashboardData();
    state.sourceMode = data?.source_mode || "operational";
    state.farmerPage = 0;
    renderDashboard(data || {});
    await loadFarmers();
    setDashboardStatus("");
    const mode = dataModeLabel();
    setConnectionStatus(mode, mode === "Preview" ? "status-muted" : "");
  } catch (error) {
    setConnectionStatus("Setup needed", "status-muted");
    setDashboardStatus(error.message || "The dataset dashboard could not be loaded.", "error");
    renderDashboardError(error.message || "Dataset reporting is unavailable.");
  } finally {
    els.reloadDatasetDashboard.disabled = false;
  }
}

async function loadDashboardData() {
  const historical = await authClient.rpc("ag_sec_historical_dataset_dashboard");
  if (!historical.error && historical.data?.available) return historical.data;

  const operational = await authClient.rpc("ag_sec_dataset_dashboard");
  if (operational.error) {
    if (historical.error) throw historical.error;
    throw operational.error;
  }
  return {
    ...(operational.data || {}),
    source_mode: "operational"
  };
}

async function loadFarmers() {
  if (state.farmerLoading) return;
  state.farmerLoading = true;
  updateFarmerPagination();
  setFarmerStatus("Loading farmers...");
  try {
    const rpcName = state.sourceMode === "historical_staging"
      ? "ag_sec_historical_dataset_member_page"
      : "ag_sec_dataset_farmer_page";
    const { data, error } = await authClient.rpc(rpcName, {
      p_search: els.datasetFarmerSearch.value.trim() || null,
      p_page_limit: FARMER_PAGE_SIZE,
      p_page_offset: state.farmerPage * FARMER_PAGE_SIZE
    });
    if (error) throw error;
    const result = data || {};
    state.farmerTotal = Number(result.total_count || 0);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (state.farmerPage > 0 && !rows.length && state.farmerTotal > 0) {
      state.farmerPage = Math.max(0, Math.ceil(state.farmerTotal / FARMER_PAGE_SIZE) - 1);
      state.farmerLoading = false;
      await loadFarmers();
      return;
    }
    renderFarmers(rows);
    setFarmerStatus("");
  } catch (error) {
    state.farmerTotal = 0;
    els.datasetFarmerRows.innerHTML = emptyRow(9, error.message || "Farmers could not be loaded.");
    setFarmerStatus(error.message || "Farmers could not be loaded.", "error");
  } finally {
    state.farmerLoading = false;
    updateFarmerPagination();
  }
}

function renderDashboard(data) {
  const aggregator = data.aggregator || {};
  const summary = data.summary || {};
  const seaweedTypes = Array.isArray(data.seaweed_types) ? data.seaweed_types : [];
  const communities = Array.isArray(data.communities) ? data.communities : [];
  const importBatches = Array.isArray(data.import_batches) ? data.import_batches : [];
  const isHistorical = data.source_mode === "historical_staging";

  els.datasetOrganisationName.textContent = aggregator.name || "Dataset";
  els.datasetOrganisationMeta.textContent = [
    aggregator.code ? `Aggregator ${aggregator.code}` : "Active sandbox aggregator",
    isHistorical ? `Dataset ${data.dataset_id || "historical staging"}` : null,
    isHistorical ? "Immutable staging" : null,
    aggregator.currency ? `Currency ${aggregator.currency}` : null,
    data.generated_at ? `Updated ${formatDateTime(data.generated_at)}` : null
  ].filter(Boolean).join(" | ");

  els.datasetTotalKg.textContent = formatNumber(summary.total_weight_kg);
  els.datasetCollectionCount.textContent = formatInteger(summary.collection_count);
  els.datasetFarmerCount.textContent = formatInteger(summary.registered_farmer_count);
  els.datasetCommunityCount.textContent = formatInteger(summary.registered_community_count);
  els.datasetSeaweedTypeCount.textContent = formatInteger(summary.seaweed_type_count);
  els.datasetCollectionRange.textContent = dateRange(summary.first_collection_at, summary.last_collection_at);
  els.datasetScopeNote.textContent = isHistorical
    ? "Historical transcription view focused on quantity, source identities, communities and explicit seaweed type. Dates retain day, month or year precision; grade is unassigned."
    : "Dataset view focused on quantity, seaweed type, communities and farmers. Grade is intentionally not used.";
  renderQuality(summary, isHistorical);
  renderMemberLabels(isHistorical);

  els.datasetSeaweedTypesCount.textContent = `${seaweedTypes.length} type${seaweedTypes.length === 1 ? "" : "s"}`;
  els.datasetSeaweedTypeRows.innerHTML = seaweedTypes.map((row) => `
    <tr>
      <td><strong>${escapeHtml(titleCase(row.seaweed_type))}</strong></td>
      <td>${escapeHtml(formatNumber(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatInteger(row.farmer_count))}</td>
      <td>${escapeHtml(formatInteger(row.community_count))}</td>
      <td>${escapeHtml(formatDate(row.first_collection_at))}</td>
      <td>${escapeHtml(formatDate(row.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(7, "No seaweed quantities are recorded for this aggregator.");

  els.datasetCommunitiesCount.textContent = `${communities.length} communit${communities.length === 1 ? "y" : "ies"}`;
  els.datasetCommunityRows.innerHTML = communities.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.community_id || "-")}</strong></td>
      <td>${communityCell(row, isHistorical)}</td>
      <td>${escapeHtml(formatNumber(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatInteger(row.registered_farmer_count))}</td>
      <td>${escapeHtml(formatInteger(row.collecting_farmer_count))}</td>
      <td>${escapeHtml(formatInteger(row.seaweed_type_count))}</td>
      <td>${escapeHtml(formatDate(row.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(8, "No communities are linked to this aggregator.");

  els.datasetImportBatchCount.textContent = `${importBatches.length} batch${importBatches.length === 1 ? "" : "es"}`;
  els.datasetImportBatchRows.innerHTML = importBatches.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.import_batch_id || "-")}</strong></td>
      <td>${escapeHtml(formatNumber(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatInteger(row.farmer_count))}</td>
      <td>${escapeHtml(formatInteger(row.community_count))}</td>
      <td>${escapeHtml(formatInteger(row.seaweed_type_count))}</td>
      <td>${escapeHtml(dateRange(row.first_collection_at, row.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(7, "No import-batch identifier is recorded. The operational dataset remains available above.");
}

function renderQuality(summary, isHistorical) {
  els.datasetQualityPanel.hidden = !isHistorical;
  if (!isHistorical) return;
  els.datasetDayPrecisionCount.textContent = formatInteger(summary.day_precision_count);
  els.datasetMonthPrecisionCount.textContent = formatInteger(summary.month_precision_count);
  els.datasetYearPrecisionCount.textContent = formatInteger(summary.year_precision_count);
  els.datasetDateReviewCount.textContent = formatInteger(summary.date_review_count);
  els.datasetCommunityReviewCount.textContent = formatInteger(summary.community_review_count);
  els.datasetUnverifiedCount.textContent = formatInteger(summary.unverified_count);
  els.datasetNonpositiveCount.textContent = formatInteger(summary.nonpositive_quantity_row_count);
  els.datasetAmountVarianceCount.textContent = formatInteger(summary.amount_variance_count);
}

function renderMemberLabels(isHistorical) {
  els.datasetFarmersHeading.textContent = isHistorical ? "Source Identities" : "Farmers";
  els.datasetFarmerHint.textContent = isHistorical
    ? "Names are grouped only within their source community. They are not verified farmer-registry matches, and no contact details are exposed."
    : "Searchable farmer dataset with quantity and seaweed-type history. Contact details remain in the Farmer Registry.";
  els.datasetMemberIdHeading.textContent = isHistorical ? "Source ID" : "Farmer ID";
  els.datasetMemberNameHeading.textContent = isHistorical ? "Source name" : "Farmer";
  els.datasetFarmerRegistryLink.hidden = isHistorical;
}

function renderFarmers(rows) {
  els.datasetFarmersCount.textContent = state.sourceMode === "historical_staging"
    ? `${state.farmerTotal} source identit${state.farmerTotal === 1 ? "y" : "ies"}`
    : `${state.farmerTotal} farmer${state.farmerTotal === 1 ? "" : "s"}`;
  els.datasetFarmerRows.innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${escapeHtml(row.farmer_id || "-")}</strong></td>
      <td>${escapeHtml(row.name || "-")}</td>
      <td>${escapeHtml([row.community_id, row.community_name].filter(Boolean).join(" - ") || "-")}</td>
      <td>${escapeHtml(formatNumber(row.total_weight_kg))}</td>
      <td>${escapeHtml(formatInteger(row.collection_count))}</td>
      <td>${escapeHtml(formatSeaweedTypes(row.seaweed_types))}</td>
      <td>${escapeHtml(formatFarmSize(row))}</td>
      <td>${escapeHtml(formatDate(row.first_collection_at))}</td>
      <td>${escapeHtml(formatDate(row.last_collection_at))}</td>
    </tr>
  `).join("") || emptyRow(9, "No farmers match the current search.");
}

function renderDashboardError(message) {
  els.datasetSeaweedTypeRows.innerHTML = emptyRow(7, message);
  els.datasetCommunityRows.innerHTML = emptyRow(8, message);
  els.datasetImportBatchRows.innerHTML = emptyRow(7, message);
}

function changeFarmerPage(direction) {
  const nextPage = state.farmerPage + direction;
  if (nextPage < 0 || nextPage * FARMER_PAGE_SIZE >= state.farmerTotal || state.farmerLoading) return;
  state.farmerPage = nextPage;
  void loadFarmers();
}

function updateFarmerPagination() {
  const start = state.farmerTotal ? state.farmerPage * FARMER_PAGE_SIZE + 1 : 0;
  const end = Math.min((state.farmerPage + 1) * FARMER_PAGE_SIZE, state.farmerTotal);
  const noun = state.sourceMode === "historical_staging" ? "Source identities" : "Farmers";
  els.datasetFarmerPageStatus.textContent = state.farmerTotal
    ? `${noun} ${start}-${end} of ${state.farmerTotal}`
    : `No ${noun.toLowerCase()}`;
  els.datasetFarmerPrevPage.disabled = state.farmerLoading || state.farmerPage === 0;
  els.datasetFarmerNextPage.disabled = state.farmerLoading || end >= state.farmerTotal;
  els.loadDatasetFarmers.disabled = state.farmerLoading;
}

function communityLedgerUrl(communityId) {
  const params = new URLSearchParams({ category: "intake", period: "all", view: "all" });
  if (communityId) params.set("community", communityId);
  return `./records.html?${params}`;
}

function communityCell(row, isHistorical) {
  const label = escapeHtml(row.community_name || "-");
  if (isHistorical) return label;
  return `<a href="${escapeAttribute(communityLedgerUrl(row.community_id))}">${label}</a>`;
}

function formatSeaweedTypes(types) {
  return Array.isArray(types) && types.length
    ? types.map(titleCase).join(", ")
    : "-";
}

function formatFarmSize(row) {
  if (row.farm_size_value === null || row.farm_size_value === undefined || row.farm_size_value === "") return "-";
  return `${formatNumber(row.farm_size_value)}${row.farm_size_unit ? ` ${row.farm_size_unit}` : ""}`;
}

function dateRange(first, last) {
  if (!first && !last) return "-";
  const firstLabel = formatDate(first);
  const lastLabel = formatDate(last);
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} to ${lastLabel}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 2 })
    : "0";
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

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function setConnectionStatus(message, className = "") {
  els.datasetConnectionStatus.textContent = message;
  els.datasetConnectionStatus.className = `status-pill ${className}`.trim();
}

function setDashboardStatus(message, type = "") {
  els.datasetDashboardStatus.textContent = message || "";
  if (type) els.datasetDashboardStatus.dataset.status = type;
  else delete els.datasetDashboardStatus.dataset.status;
}

function setFarmerStatus(message, type = "") {
  els.datasetFarmerStatus.textContent = message || "";
  if (type) els.datasetFarmerStatus.dataset.status = type;
  else delete els.datasetFarmerStatus.dataset.status;
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
