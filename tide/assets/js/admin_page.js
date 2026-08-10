import { APP_CONFIG } from "./config.js?v=20260718-supabase-fast";
import {
  isSeaweedHarvestPlatform,
  requireTidePlatformRole,
  tideBackendContext,
  tideBackendTables
} from "./platform_backend.js?v=20260810-platform-auth-v3";

const BACKEND_TABLES = tideBackendTables();
const TABLES = {
  locations: BACKEND_TABLES.locations,
  locationAdmin: BACKEND_TABLES.locationAdmin,
  datasets: BACKEND_TABLES.datasets,
  datasetSummary: BACKEND_TABLES.datasetSummary,
  adminUsers: isSeaweedHarvestPlatform() ? null : "tide_admin_users",
  calibrationRecords: BACKEND_TABLES.calibrations,
  calibrationSummary: BACKEND_TABLES.calibrationSummary
};

const AUTH_SESSION_KEY = "seaweed_tide_planner:admin_auth_session";
const LANGUAGE_SETTINGS_KEY = "seaweed_tide_planner:admin_language_status";
const NEW_LOCATION_ID = "__new_location__";
const NEW_DATASET_ID = "__new_dataset__";
const RAW_IMPORT_BATCH_SIZE = 450;
const LOCATION_TABLE_VIEWS = {
  metadata: [
    "Location ID",
    "Name",
    "Associated tide dataset",
    "Short name",
    "Region",
    "Latitude",
    "Longitude",
    "App use",
    "Action"
  ],
  calibration: [
    "Location ID",
    "Name",
    "Associated tide dataset",
    "Calibration status",
    "Harvest threshold",
    "Low offset",
    "High offset",
    "Height ratio",
    "Height offset",
    "Evidence",
    "Action"
  ]
};
const DATASET_TABLE_VIEWS = {
  metadata: [
    "Dataset ID",
    "Name",
    "Location name",
    "Region",
    "Location coordinates",
    "Source name",
    "Verification",
    "Dataset use",
    "Action"
  ],
  importer: [
    "Dataset ID",
    "Name",
    "Imported date",
    "Coverage dates",
    "Hourly rows",
    "Event rows",
    "# Linked farms",
    "Linked data",
    "Action"
  ]
};

const DATASET_STATUSES = [
  "imported_unverified",
  "pending_review",
  "verified",
  "superseded",
  "rejected"
];
const REQUIRED_IMPORT_COLUMNS = {
  hourly: ["prediction_time_utc", "local_date", "local_time", "local_hour", "height_m"],
  events: ["event_time_utc", "local_date", "local_time", "event_type", "height_m"]
};
const RAW_IMPORT_FIELDS = {
  hourly: [
    "dataset_id",
    "dataset_key",
    "prediction_time_utc",
    "local_date",
    "local_time",
    "local_hour",
    "height_m",
    "source_record_id",
    "source_pdf_page",
    "source_row_text",
    "quality_flag",
    "notes"
  ],
  events: [
    "dataset_id",
    "dataset_key",
    "event_time_utc",
    "local_date",
    "local_time",
    "event_type",
    "height_m",
    "source_event_id",
    "source_pdf_page",
    "source_row_text",
    "derived_from_hourly",
    "quality_flag",
    "notes"
  ]
};
const RAW_NUMBER_FIELDS = new Set(["height_m", "local_hour", "source_pdf_page"]);
const RAW_BOOLEAN_FIELDS = new Set(["derived_from_hourly"]);

const state = {
  locations: [],
  datasets: [],
  calibrations: [],
  calibrationRecords: [],
  adminUsers: [],
  authSession: null,
  backend: null,
  hasLocationDraft: false,
  hasDatasetDraft: false,
  locationTableView: "metadata",
  datasetTableView: "metadata",
  editingLocationId: null,
  editingDatasetId: null,
  selectedCalibrationId: null,
  selectedDatasetId: "",
  importPreview: null,
  requestedCalibrationLocationId: ""
};

const els = {};

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("unhandledrejection", (event) => {
  setConnectionStatus("Load error", "status-muted");
  setStatus(els.locationSaveStatus, event.reason?.message || "Unexpected admin page error.", "error");
});

async function init() {
  cacheElements();
  state.requestedCalibrationLocationId = new URLSearchParams(window.location.search).get("location_id") || "";
  bindEvents();

  if (isSeaweedHarvestPlatform()) {
    configurePlatformAdminUi();
    try {
      const access = await requireTidePlatformRole("admin");
      state.authSession = access.session;
      state.backend = await tideBackendContext();
      updateAuthUi();
      await loadAll();
    } catch (error) {
      state.authSession = null;
      updateAuthUi();
      setAuthStatus(writeErrorMessage(error), "error");
    }
    return;
  }

  loadStoredAuthSession();
  updateAuthUi();
  await verifyStoredSession();
  await loadAll();
}

function configurePlatformAdminUi() {
  if (els.adminAuthForm) els.adminAuthForm.hidden = true;

  document.querySelectorAll('a[href="./admin_settings.html#admin-users"]').forEach((link) => {
    link.href = "/admin_users.html";
    link.querySelector("strong")?.replaceChildren("Application access");
    link.querySelector("span")?.replaceChildren("Manage Tide grants in Seaweed Harvest Admin Users.");
  });

  const adminUsersPanel = document.getElementById("admin-users");
  if (adminUsersPanel) {
    adminUsersPanel.innerHTML = `
      <h2>Application access</h2>
      <p class="field-hint">Tide roles are managed through the shared Seaweed Harvest user administration.</p>
      <p><a class="button-link" href="/admin_users.html">Open Seaweed Harvest Admin Users</a></p>
    `;
  }
}

function cacheElements() {
  [
    "adminConnectionStatus",
    "adminAuthStatus",
    "adminLoginModal",
    "adminAuthForm",
    "adminEmail",
    "adminPassword",
    "adminSignIn",
    "adminSignOut",
    "reloadAdminDashboard",
    "metricFarmCount",
    "metricTideSourceCount",
    "metricUnverifiedSources",
    "metricHiddenFarms",
    "metricNotVerifiedFarms",
    "metricNotCalibrated",
    "metricExpiringDatasets",
    "locationCount",
    "datasetCount",
    "locationSaveStatus",
    "datasetSaveStatus",
    "locationsTableHead",
    "locationsTableBody",
    "locationMetadataView",
    "locationCalibrationView",
    "datasetsTableHead",
    "datasetsTableBody",
    "datasetMetadataView",
    "datasetImporterView",
    "reloadLocations",
    "reloadDatasets",
    "newLocation",
    "newDataset",
    "selectedImportTarget",
    "importWriteStatusPill",
    "importPreviewForm",
    "hourlyCsvInput",
    "eventsCsvInput",
    "replaceExistingRows",
    "runSupabaseImport",
    "clearImportPreview",
    "importPreviewStatus",
    "importPreviewResults",
    "adminUserCount",
    "adminUsersStatus",
    "adminUsersTableBody",
    "reloadAdminUsers",
    "languageSettingsStatus",
    "reloadCalibration",
    "calibrationForm",
    "calibrationLocation",
    "calibrationDataset",
    "calibrationStatus",
    "calibrationConfidence",
    "lowTideOffset",
    "highTideOffset",
    "curveOffset",
    "heightRatio",
    "heightOffset",
    "harvestThreshold",
    "observationRecordNumber",
    "lastEditedBy",
    "calibrationNotes",
    "calibrationSaveStatus"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.adminAuthForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });

  els.adminSignOut.addEventListener("click", async () => {
    await signOut();
  });

  els.reloadLocations?.addEventListener("click", () => loadLocations());
  els.reloadDatasets?.addEventListener("click", () => loadDatasets());
  els.reloadAdminUsers?.addEventListener("click", () => loadAdminUsers());
  els.reloadAdminDashboard?.addEventListener("click", () => loadAll());
  els.reloadCalibration?.addEventListener("click", () => loadCalibrationPanelData());
  document.querySelectorAll("[data-location-table-view]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setLocationTableView(button.dataset.locationTableView);
    });
  });
  document.querySelectorAll("[data-dataset-table-view]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDatasetTableView(button.dataset.datasetTableView);
    });
  });

  document.querySelectorAll("[data-language-status]").forEach((select) => {
    select.addEventListener("change", saveLanguageSettings);
  });

  els.newLocation?.addEventListener("click", () => {
    if (!state.authSession) {
      setStatus(els.locationSaveStatus, "Sign in before adding a location.", "error");
      return;
    }
    state.locationTableView = "metadata";
    state.hasLocationDraft = true;
    state.editingLocationId = NEW_LOCATION_ID;
    renderLocations();
    setStatus(els.locationSaveStatus, "New location row added. Click Create when ready.");
  });

  els.newDataset?.addEventListener("click", () => {
    if (!state.authSession) {
      setStatus(els.datasetSaveStatus, "Sign in before adding a dataset.", "error");
      return;
    }
    state.datasetTableView = "metadata";
    state.hasDatasetDraft = true;
    state.editingDatasetId = NEW_DATASET_ID;
    renderDatasets();
    setStatus(els.datasetSaveStatus, "New dataset row added. Click Create when ready.");
  });

  els.locationsTableBody?.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-location]");
    if (editButton) {
      if (!state.authSession) {
        setStatus(els.locationSaveStatus, "Sign in before editing a location.", "error");
        return;
      }
      state.editingLocationId = editButton.closest("tr").dataset.rowId;
      renderLocations();
      setStatus(els.locationSaveStatus, "Editing row. Click Save to commit changes.");
      return;
    }

    const calibrationButton = event.target.closest("[data-edit-calibration]");
    if (calibrationButton) {
      if (!state.authSession) {
        setStatus(els.locationSaveStatus, "Sign in before editing calibration.", "error");
        return;
      }
      loadCalibrationIntoForm(calibrationButton.dataset.editCalibration);
      els.calibrationForm?.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus(els.locationSaveStatus, "Calibration row loaded below. Save from the Calibration Inputs card.");
      return;
    }

    const button = event.target.closest("[data-save-location]");
    if (!button) return;
    await saveLocationRow(button.closest("tr"));
  });

  els.datasetsTableBody?.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-dataset]");
    if (editButton) {
      if (!state.authSession) {
        setStatus(els.datasetSaveStatus, "Sign in before editing a dataset.", "error");
        return;
      }
      state.editingDatasetId = editButton.closest("tr").dataset.rowId;
      renderDatasets();
      setStatus(els.datasetSaveStatus, "Editing row. Click Save to commit changes.");
      return;
    }

    const button = event.target.closest("[data-save-dataset]");
    if (button) {
      await saveDatasetRow(button.closest("tr"));
      return;
    }

    const importButton = event.target.closest("[data-select-import-dataset]");
    if (importButton) {
      selectDatasetForImport(importButton.dataset.selectImportDataset, { scroll: true });
    }
  });

  els.selectedImportTarget?.addEventListener("change", (event) => {
    if (event.target.id !== "selectedImportDatasetSelect") return;
    selectDatasetForImport(event.target.value);
  });

  els.importPreviewForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await previewCsvFiles();
  });

  els.runSupabaseImport?.addEventListener("click", async () => {
    await importPreviewToSupabase();
  });

  els.clearImportPreview?.addEventListener("click", () => clearImportPreview(true));

  els.adminUsersTableBody?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-admin-user]");
    if (!button) return;
    await saveAdminUserRow(button.closest("tr"));
  });

  els.calibrationLocation?.addEventListener("change", () => {
    loadCalibrationIntoForm(els.calibrationLocation.value);
  });

  els.calibrationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCalibration();
  });

}

async function loadAll() {
  setConnectionStatus("Loading", "status-muted");
  try {
    loadLanguageSettings();
    await loadDatasets({ quiet: true });
    await loadCalibrations({ quiet: true });
    await loadLocations({ quiet: true });
    if (state.authSession && !isSeaweedHarvestPlatform()) await loadAdminUsers({ quiet: true });
    renderCalibrationPanel();
    renderDashboardMetrics();
    setConnectionStatus(state.authSession ? "Admin connected" : "Public connected", "");
    setSignedOutHints();
  } catch (error) {
    setConnectionStatus("Supabase error", "status-muted");
    setStatus(els.locationSaveStatus, error.message, "error");
    setStatus(els.datasetSaveStatus, error.message, "error");
  }
}

async function loadAdminUsers(options = {}) {
  if (isSeaweedHarvestPlatform()) return;
  if (!els.adminUsersTableBody) return;
  if (!state.authSession) {
    state.adminUsers = [];
    renderAdminUsers();
    setStatus(els.adminUsersStatus, "Sign in to list admin users.");
    return;
  }

  if (!options.quiet) setStatus(els.adminUsersStatus, "Loading admin users...");
  state.adminUsers = await supabaseSelect(TABLES.adminUsers, "select=*&order=email.asc");
  renderAdminUsers();
  if (!options.quiet) setStatus(els.adminUsersStatus, `Loaded ${state.adminUsers.length} admin user(s).`);
}

async function loadLocations(options = {}) {
  if (!options.quiet) setStatus(els.locationSaveStatus, "Loading locations...");
  const orderField = isSeaweedHarvestPlatform() ? "location_name" : "farm_name";
  const rows = await supabaseSelect(TABLES.locations, `select=*&order=${orderField}.asc`);
  state.locations = rows.map(normalizeLocationRow);
  state.hasLocationDraft = false;
  state.editingLocationId = null;
  renderLocations();
  renderCalibrationPanel();
  renderDashboardMetrics();
  if (!options.quiet) setStatus(els.locationSaveStatus, `Loaded ${state.locations.length} location row(s).`);
}

function normalizeLocationRow(row) {
  return {
    ...row,
    farm_location_key: row.farm_location_key || row.location_key || "",
    farm_name: row.farm_name || row.location_name || row.community_name || ""
  };
}

async function loadDatasets(options = {}) {
  if (!options.quiet) setStatus(els.datasetSaveStatus, "Loading tide datasets...");
  state.datasets = await loadDatasetRows();
  state.hasDatasetDraft = false;
  state.editingDatasetId = null;
  if (state.selectedDatasetId && !state.datasets.some((dataset) => dataset.id === state.selectedDatasetId)) {
    state.selectedDatasetId = "";
  }
  renderDatasets();
  renderSelectedImportTarget();
  renderCalibrationPanel();
  renderDashboardMetrics();
  if (!options.quiet) setStatus(els.datasetSaveStatus, datasetLoadMessage());
}

async function loadDatasetRows() {
  try {
    const rows = await supabaseSelect(TABLES.datasetSummary, "select=*&order=dataset_name.asc");
    return rows.map((row) => normalizeDatasetRow(row, true));
  } catch {
    const rows = await supabaseSelect(TABLES.datasets, "select=*&order=dataset_key.asc");
    return rows.map((row) => normalizeDatasetRow(row, false));
  }
}

function normalizeDatasetRow(row, summaryAvailable) {
  const id = row.id || row.dataset_id;
  const hourlyRowCount = Number(row.hourly_row_count || 0);
  const eventRowCount = Number(row.event_row_count || 0);
  const hasHourly = row.has_hourly_predictions === true || hourlyRowCount > 0;
  const hasEvents = row.has_tide_events === true || eventRowCount > 0;
  return {
    ...row,
    id,
    dataset_id: id,
    hourly_row_count: hourlyRowCount,
    event_row_count: eventRowCount,
    linked_farm_count: Number(row.linked_farm_count || 0),
    has_hourly_predictions: hasHourly,
    has_tide_events: hasEvents,
    has_raw_data: row.has_raw_data === true || hasHourly || hasEvents,
    raw_data_status: row.raw_data_status || rawDataStatusFromFlags(hasHourly, hasEvents),
    summaryAvailable
  };
}

async function loadCalibrations(options = {}) {
  try {
    state.calibrations = await supabaseSelect(TABLES.calibrationSummary, "select=*&order=location_name.asc");
  } catch (error) {
    state.calibrations = [];
    if (!options.quiet) {
      setStatus(els.locationSaveStatus, `Calibration summary unavailable. Apply the observation/calibration SQL first. ${error.message}`, "error");
    }
  }

  if (!hasCalibrationPanel()) {
    state.calibrationRecords = [];
    return;
  }

  try {
    state.calibrationRecords = await supabaseSelect(TABLES.calibrationRecords, "select=*&order=updated_at.desc");
  } catch (error) {
    state.calibrationRecords = [];
    if (!options.quiet) {
      setStatus(els.calibrationSaveStatus, `Calibration records unavailable. ${writeErrorMessage(error)}`, "error");
    }
  }

  renderCalibrationPanel();
}

async function loadCalibrationPanelData() {
  if (!hasCalibrationPanel()) return;
  setStatus(els.calibrationSaveStatus, "Loading calibration data...");
  try {
    await loadDatasets({ quiet: true });
    await loadLocations({ quiet: true });
    await loadCalibrations({ quiet: true });
    renderCalibrationPanel();
    setStatus(els.calibrationSaveStatus, `Loaded ${state.calibrations.length} calibration row(s).`);
  } catch (error) {
    setStatus(els.calibrationSaveStatus, writeErrorMessage(error), "error");
  }
}

function renderDashboardMetrics() {
  const farms = state.locations.filter((location) => location.active !== false);
  const tideSources = state.datasets;
  const unverifiedSources = tideSources.filter((dataset) => {
    return !["verified", "complete"].includes(String(dataset.verification_status || "").toLowerCase());
  });
  const hiddenFarms = farms.filter((location) => location.public_visible === false || location.active === false);
  const notVerifiedFarms = farms.filter((location) => {
    const status = String(location.status || "").toLowerCase();
    return status && !["active", "verified"].includes(status);
  });
  const notCalibrated = farms.filter((location) => {
    return calibrationStatusForLocation(location).value !== "complete";
  });
  const expiringDatasets = tideSources.filter((dataset) => {
    return datasetExpiresWithinMonths(dataset, 3);
  });

  setMetric("metricFarmCount", farms.length);
  setMetric("metricTideSourceCount", tideSources.length);
  setMetric("metricUnverifiedSources", unverifiedSources.length);
  setMetric("metricHiddenFarms", hiddenFarms.length);
  setMetric("metricNotVerifiedFarms", notVerifiedFarms.length);
  setMetric("metricNotCalibrated", notCalibrated.length);
  setMetric("metricExpiringDatasets", expiringDatasets.length);
}

function setMetric(id, value) {
  if (els[id]) els[id].textContent = String(value);
}

function datasetExpiresWithinMonths(dataset, monthCount) {
  if (!dataset.valid_to) return false;
  const validTo = new Date(`${dataset.valid_to}T00:00:00Z`);
  if (Number.isNaN(validTo.getTime())) return false;
  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() + monthCount);
  return validTo <= threshold;
}

function renderLocations() {
  const rows = state.hasLocationDraft ? [defaultLocation(), ...state.locations] : state.locations;
  if (!els.locationCount || !els.locationsTableBody) return;
  renderLocationTableHead();
  updateLocationTableViewButtons();
  els.locationCount.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    els.locationsTableBody.innerHTML = emptyRow(locationTableColumnCount(), "No visible locations returned from Supabase.");
    return;
  }

  els.locationsTableBody.innerHTML = rows.map((row, index) => renderLocationRow(row, index)).join("");
}

function renderLocationTableHead() {
  if (!els.locationsTableHead) return;
  const headings = LOCATION_TABLE_VIEWS[state.locationTableView] || LOCATION_TABLE_VIEWS.metadata;
  els.locationsTableHead.innerHTML = `
    <tr>
      ${headings.map((heading, index) => `<th${index === headings.length - 1 ? " data-admin-only" : ""}>${escapeHtml(heading)}</th>`).join("")}
    </tr>
  `;
  els.locationsTableHead.closest("table")?.setAttribute("data-view", state.locationTableView);
}

function locationTableColumnCount() {
  return (LOCATION_TABLE_VIEWS[state.locationTableView] || LOCATION_TABLE_VIEWS.metadata).length;
}

function updateLocationTableViewButtons() {
  document.querySelectorAll("[data-location-table-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.locationTableView === state.locationTableView));
  });
}

function setLocationTableView(view) {
  if (!LOCATION_TABLE_VIEWS[view]) return;
  state.locationTableView = view;
  if (view === "calibration" && state.editingLocationId === NEW_LOCATION_ID) {
    state.hasLocationDraft = false;
  }
  state.editingLocationId = null;
  renderLocations();
  setStatus(
    els.locationSaveStatus,
    view === "calibration"
      ? "Showing calibration data. Click Edit to load a location into the Calibration Inputs card."
      : "Showing site location metadata."
  );
}

function renderAdminUsers() {
  if (!els.adminUsersTableBody) return;
  if (els.adminUserCount) {
    els.adminUserCount.textContent = `${state.adminUsers.length} user${state.adminUsers.length === 1 ? "" : "s"}`;
  }

  if (!state.authSession) {
    els.adminUsersTableBody.innerHTML = emptyRow(7, "Sign in to load admin users.");
    return;
  }

  if (!state.adminUsers.length) {
    els.adminUsersTableBody.innerHTML = emptyRow(7, "No admin users returned from Supabase.");
    return;
  }

  els.adminUsersTableBody.innerHTML = state.adminUsers.map(renderAdminUserRow).join("");
}

function renderAdminUserRow(row) {
  const role = row.role || "operator";
  const activeValue = row.active === false ? "inactive" : "active";

  return `
    <tr data-user-id="${escapeAttribute(row.user_id)}">
      <td>${readOnlyCell(row.email)}</td>
      <td class="id-cell">${readOnlyCell(shortId(row.user_id))}</td>
      <td>${selectInput("role", role, adminRoleOptions(role))}</td>
      <td>${selectInput("active", activeValue, [["active", "Active"], ["inactive", "Inactive"]])}</td>
      <td>${textInput("notes", row.notes, "notes")}</td>
      <td>${readOnlyCell(formatDateTime(row.updated_at))}</td>
      <td class="save-cell" data-admin-only>
        <button type="button" data-save-admin-user ${state.authSession ? "" : "disabled"}>Save</button>
      </td>
    </tr>
  `;
}

function renderLocationRow(row, index) {
  const isNew = !row.id;
  const rowId = isNew ? NEW_LOCATION_ID : row.id;
  const isEditing = rowId === state.editingLocationId;
  const rowClass = [isNew ? "draft-row" : "", isEditing ? "editing-row" : ""].filter(Boolean).join(" ");
  if (state.locationTableView === "calibration") {
    return renderLocationCalibrationRow(row, index, rowId, rowClass);
  }
  return renderLocationMetadataRow(row, index, rowId, rowClass, isEditing);
}

function renderLocationMetadataRow(row, index, rowId, rowClass, isEditing) {
  const isNew = !row.id;
  const usesCanonicalCommunity = isSeaweedHarvestPlatform() && Boolean(row.community_record_id);
  const datasetOptions = [
    ["", "Not linked"],
    ...state.datasets.map((dataset) => [dataset.id, dataset.dataset_name])
  ];
  const selectedDatasetId = row.default_tide_dataset_id || datasetIdForKey(row.default_tide_dataset_key);

  if (!isEditing) {
    return `
      <tr data-row-id="${escapeAttribute(rowId)}" data-row-kind="location" class="${rowClass}">
        <td class="id-cell">${locationIdCell(row, index)}</td>
        <td>${readOnlyCell(row.farm_name)}</td>
        <td>${readOnlyCell(datasetLabel(row.default_tide_dataset_id || row.default_tide_dataset_key))}</td>
        <td>${readOnlyCell(row.short_name)}</td>
        <td>${readOnlyCell(row.region)}</td>
        <td>${readOnlyCell(formatCoordinate(row.latitude))}</td>
        <td>${readOnlyCell(formatCoordinate(row.longitude))}</td>
        <td>${readOnlyCell(recordUseLabel(row, "Shown in app"))}</td>
        <td class="save-cell" data-admin-only>
          <div class="row-action-stack">
            <button type="button" data-edit-location ${state.authSession ? "" : "disabled"}>Edit</button>
          </div>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-row-id="${escapeAttribute(rowId)}" data-row-kind="location" class="${rowClass}">
      <td class="id-cell">${locationIdCell(row, index)}</td>
      <td>${usesCanonicalCommunity
        ? `${readOnlyCell(row.farm_name)}${hiddenInput("farm_name", row.farm_name)}<small>Managed in Seaweed Harvest</small>`
        : textInput("farm_name", row.farm_name, "name")}</td>
      <td>${selectInput("default_tide_dataset_id", selectedDatasetId, datasetOptions)}</td>
      <td>${textInput("short_name", row.short_name, "short name")}</td>
      <td>${textInput("region", row.region, "region")}</td>
      <td>${usesCanonicalCommunity
        ? `${readOnlyCell(formatCoordinate(row.latitude))}${hiddenInput("latitude", row.latitude)}`
        : numberInput("latitude", row.latitude, "latitude", "-90", "90", "0.000001")}</td>
      <td>${usesCanonicalCommunity
        ? `${readOnlyCell(formatCoordinate(row.longitude))}${hiddenInput("longitude", row.longitude)}`
        : numberInput("longitude", row.longitude, "longitude", "-180", "180", "0.000001")}</td>
      <td>${selectInput("app_use", locationUseValue(row), locationUseOptions())}</td>
      <td class="save-cell" data-admin-only>
        <div class="row-action-stack">
          <button type="button" data-save-location ${state.authSession ? "" : "disabled"}>${isNew ? "Create" : "Save"}</button>
        </div>
      </td>
    </tr>
  `;
}

function renderLocationCalibrationRow(row, index, rowId, rowClass) {
  const summary = calibrationSummaryForLocation(row);
  const evidence = calibrationEvidence(summary);
  const harvestThreshold = summary.harvest_threshold_m ?? row.default_harvest_threshold_m;
  const selectedClass = row.id && row.id === els.calibrationLocation?.value ? "editing-row" : "";
  const classes = [rowClass, selectedClass].filter(Boolean).join(" ");

  return `
    <tr data-row-id="${escapeAttribute(rowId)}" data-row-kind="location" class="${classes}">
      <td class="id-cell">${locationIdCell(row, index)}</td>
      <td>${readOnlyCell(row.farm_name)}</td>
      <td>${readOnlyCell(datasetLabel(summary.reference_dataset_id || row.default_tide_dataset_id || row.default_tide_dataset_key) || summary.reference_dataset_name || "Location default")}</td>
      <td>${calibrationStatusCell(row)}</td>
      <td>${readOnlyCell(formatMetres(harvestThreshold))}</td>
      <td>${readOnlyCell(formatMinutes(summary.low_tide_time_offset_minutes))}</td>
      <td>${readOnlyCell(formatMinutes(summary.high_tide_time_offset_minutes))}</td>
      <td>${readOnlyCell(formatNumber(summary.height_ratio))}</td>
      <td>${readOnlyCell(formatMetres(summary.height_offset_m))}</td>
      <td>${readOnlyCell(evidence)}</td>
      <td class="save-cell" data-admin-only>
        <div class="row-action-stack">
          ${row.id ? `<button type="button" data-edit-calibration="${escapeAttribute(row.id)}" ${state.authSession ? "" : "disabled"}>Edit</button>` : `<button type="button" disabled>Edit</button>`}
        </div>
      </td>
    </tr>
  `;
}

function renderDatasets() {
  const rows = state.hasDatasetDraft ? [defaultDataset(), ...state.datasets] : state.datasets;
  if (!els.datasetCount || !els.datasetsTableBody) return;
  renderDatasetTableHead();
  updateDatasetTableViewButtons();
  els.datasetCount.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    els.datasetsTableBody.innerHTML = emptyRow(datasetTableColumnCount(), "No visible tide datasets returned from Supabase.");
    return;
  }

  let displayIndex = 0;
  els.datasetsTableBody.innerHTML = rows.map((row) => renderDatasetRow(row, row.id ? displayIndex++ : -1)).join("");
}

function renderDatasetTableHead() {
  if (!els.datasetsTableHead) return;
  const headings = DATASET_TABLE_VIEWS[state.datasetTableView] || DATASET_TABLE_VIEWS.metadata;
  els.datasetsTableHead.innerHTML = `
    <tr>
      ${headings.map((heading, index) => `<th${index === headings.length - 1 && state.datasetTableView === "metadata" ? " data-admin-only" : ""}>${escapeHtml(heading)}</th>`).join("")}
    </tr>
  `;
  els.datasetsTableHead.closest("table")?.setAttribute("data-view", state.datasetTableView);
}

function datasetTableColumnCount() {
  return (DATASET_TABLE_VIEWS[state.datasetTableView] || DATASET_TABLE_VIEWS.metadata).length;
}

function updateDatasetTableViewButtons() {
  document.querySelectorAll("[data-dataset-table-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.datasetTableView === state.datasetTableView));
  });
}

function setDatasetTableView(view) {
  if (!DATASET_TABLE_VIEWS[view]) return;
  state.datasetTableView = view;
  if (view === "importer" && state.editingDatasetId === NEW_DATASET_ID) {
    state.hasDatasetDraft = false;
  }
  state.editingDatasetId = null;
  renderDatasets();
  setStatus(
    els.datasetSaveStatus,
    view === "importer"
      ? "Showing importer data from the dataset summary view."
      : "Showing tide dataset metadata."
  );
}

function renderCalibrationPanel() {
  if (!hasCalibrationPanel()) return;
  renderCalibrationSelects();

  if (!els.calibrationLocation?.value && state.locations.length) {
    openInitialCalibrationLocation();
  }
}

function hasCalibrationPanel() {
  return !!els.calibrationForm;
}

function renderCalibrationSelects() {
  if (els.calibrationLocation) {
    const selectedLocation = els.calibrationLocation.value || state.requestedCalibrationLocationId;
    els.calibrationLocation.innerHTML = [
      `<option value="">Select location</option>`,
      ...state.locations.map((location) => {
        const selected = location.id === selectedLocation ? " selected" : "";
        return `<option value="${escapeAttribute(location.id)}"${selected}>${escapeHtml(locationLabel(location))}</option>`;
      })
    ].join("");
  }

  if (els.calibrationDataset) {
    const selectedDataset = els.calibrationDataset.value;
    els.calibrationDataset.innerHTML = [
      `<option value="">Use location default / not set</option>`,
      ...state.datasets.map((dataset) => {
        const label = dataset.dataset_name || dataset.dataset_key || dataset.id;
        const selected = dataset.id === selectedDataset ? " selected" : "";
        return `<option value="${escapeAttribute(dataset.id)}"${selected}>${escapeHtml(label)}</option>`;
      })
    ].join("");
  }
}

function openInitialCalibrationLocation() {
  const locationId = state.requestedCalibrationLocationId || els.calibrationLocation?.value || state.locations[0]?.id || "";
  if (!locationId) return;
  loadCalibrationIntoForm(locationId);
}

function loadCalibrationIntoForm(locationId) {
  if (!els.calibrationForm || !els.calibrationLocation) return;
  els.calibrationLocation.value = locationId || "";
  const location = state.locations.find((item) => item.id === locationId);
  const calibration = activeCalibrationForLocation(locationId);
  state.selectedCalibrationId = calibration?.id || null;
  state.requestedCalibrationLocationId = locationId || "";

  els.calibrationDataset.value = calibration?.reference_dataset_id || location?.default_tide_dataset_id || datasetIdForKey(location?.default_tide_dataset_key) || "";
  els.calibrationStatus.value = calibration?.status || "none";
  els.calibrationConfidence.value = calibration?.confidence || "low";
  els.lowTideOffset.value = valueOrEmpty(calibration?.low_tide_time_offset_minutes);
  els.highTideOffset.value = valueOrEmpty(calibration?.high_tide_time_offset_minutes);
  els.curveOffset.value = valueOrEmpty(calibration?.curve_time_offset_minutes);
  els.heightRatio.value = valueOrEmpty(calibration?.height_ratio);
  els.heightOffset.value = valueOrEmpty(calibration?.height_offset_m);
  els.harvestThreshold.value = valueOrEmpty(calibration?.harvest_threshold_m ?? location?.default_harvest_threshold_m);
  els.observationRecordNumber.value = valueOrEmpty(calibration?.observation_record_number);
  els.lastEditedBy.value = valueOrEmpty(calibration?.last_edited_by || currentUserEmail());
  els.calibrationNotes.value = valueOrEmpty(calibration?.notes);
  renderLocations();
}

async function saveCalibration() {
  try {
    requireSignedIn();
    const locationId = requiredText(els.calibrationLocation.value, "Location");
    const status = els.calibrationStatus.value || "none";
    const payload = {
      location_id: locationId,
      reference_dataset_id: nullableText(els.calibrationDataset.value),
      status,
      active: status !== "none",
      low_tide_time_offset_minutes: nullableInteger(els.lowTideOffset.value),
      high_tide_time_offset_minutes: nullableInteger(els.highTideOffset.value),
      curve_time_offset_minutes: nullableInteger(els.curveOffset.value),
      height_ratio: nullableNumber(els.heightRatio.value),
      height_offset_m: nullableNumber(els.heightOffset.value),
      harvest_threshold_m: nullableNumber(els.harvestThreshold.value),
      observation_record_number: nullableText(els.observationRecordNumber.value),
      notes: nullableText(els.calibrationNotes.value),
      confidence: els.calibrationConfidence.value || "low",
      last_edited_by: currentUserEmail(),
      last_edited_at: new Date().toISOString()
    };

    if (status === "none" && !state.selectedCalibrationId) {
      setStatus(els.calibrationSaveStatus, "No calibration record saved because status is None.");
      return;
    }

    setStatus(els.calibrationSaveStatus, "Saving calibration...");
    if (state.selectedCalibrationId) {
      await supabasePatch(TABLES.calibrationRecords, state.selectedCalibrationId, payload);
    } else {
      await supabaseInsert(TABLES.calibrationRecords, payload);
    }

    await loadCalibrations({ quiet: true });
    loadCalibrationIntoForm(locationId);
    renderLocations();
    setStatus(els.calibrationSaveStatus, "Calibration saved.");
  } catch (error) {
    setStatus(els.calibrationSaveStatus, writeErrorMessage(error), "error");
  }
}

function renderDatasetRow(row, index) {
  const isNew = !row.id;
  const rowId = isNew ? NEW_DATASET_ID : row.id;
  const isEditing = rowId === state.editingDatasetId;
  const isSelected = row.id && row.id === state.selectedDatasetId;
  const rowClass = [isNew ? "draft-row" : "", isEditing || isSelected ? "editing-row" : ""].filter(Boolean).join(" ");
  if (state.datasetTableView === "importer") {
    return renderDatasetImporterRow(row, index, rowId, rowClass);
  }
  return renderDatasetMetadataRow(row, index, rowId, rowClass, isEditing);
}

function renderDatasetMetadataRow(row, index, rowId, rowClass, isEditing) {
  const isNew = !row.id;
  const region = datasetRegionValue(row);

  if (!isEditing) {
    return `
      <tr data-row-id="${escapeAttribute(rowId)}" data-row-kind="dataset" class="${rowClass}">
        <td class="id-cell">${datasetIdCell(row, index)}</td>
        <td>${readOnlyCell(row.dataset_name)}</td>
        <td>${readOnlyCell(row.tide_location_name)}</td>
        <td>${readOnlyCell(region)}</td>
        <td>${readOnlyCell(formatCoordinatePair(row.tide_location_latitude, row.tide_location_longitude))}</td>
        <td>${readOnlyCell(row.source_organization || row.source_title)}</td>
        <td>${readOnlyCell(formatStatus(row.verification_status))}</td>
        <td>${readOnlyCell(recordUseLabel(row))}</td>
        <td class="save-cell" data-admin-only>
          <button type="button" data-edit-dataset ${state.authSession ? "" : "disabled"}>Edit</button>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-row-id="${escapeAttribute(rowId)}" data-row-kind="dataset" class="${rowClass}">
      <td class="id-cell">${datasetIdCell(row, index)}</td>
      <td>${textInput("dataset_name", row.dataset_name, "dataset name")}</td>
      <td>${textInput("tide_location_name", row.tide_location_name, "tide location name")}</td>
      <td>${selectInput("tide_location_region", region, tideRegionOptions(region))}</td>
      <td><div class="inline-editor-pair">
        ${numberInput("tide_location_latitude", row.tide_location_latitude, "latitude", "-90", "90", "0.000001")}
        ${numberInput("tide_location_longitude", row.tide_location_longitude, "longitude", "-180", "180", "0.000001")}
      </div></td>
      <td>${textInput("source_organization", row.source_organization, "source name")}</td>
      <td>${selectInput("verification_status", row.verification_status || "imported_unverified", DATASET_STATUSES.map((value) => [value, formatStatus(value)]))}</td>
      <td>${selectInput("dataset_use", recordUseValue(row), recordUseOptions())}</td>
      <td class="save-cell" data-admin-only>
        <button type="button" data-save-dataset ${state.authSession ? "" : "disabled"}>${isNew ? "Create" : "Save"}</button>
      </td>
    </tr>
  `;
}

function renderDatasetImporterRow(row, index, rowId, rowClass) {
  return `
    <tr data-row-id="${escapeAttribute(rowId)}" data-row-kind="dataset" class="${rowClass}">
      <td class="id-cell">${datasetIdCell(row, index)}</td>
      <td>${readOnlyCell(row.dataset_name)}</td>
      <td>${readOnlyCell(formatDateTime(row.imported_at))}</td>
      <td>${readOnlyCell(dataCoverageLabel(row))}</td>
      <td>${readOnlyCell(formatInteger(row.hourly_row_count))}</td>
      <td>${readOnlyCell(formatInteger(row.event_row_count))}</td>
      <td>${readOnlyCell(formatInteger(row.linked_farm_count))}</td>
      <td>${readOnlyCell(rawDataStatusLabel(row.raw_data_status))}</td>
      <td class="save-cell">
        <button type="button" data-select-import-dataset="${escapeAttribute(row.id || "")}" ${row.id && state.authSession ? "" : "disabled"}>Import</button>
      </td>
    </tr>
  `;
}

async function saveLocationRow(rowElement) {
  try {
    requireSignedIn();
    const id = rowElement.dataset.rowId === NEW_LOCATION_ID ? null : rowElement.dataset.rowId;
    const current = id ? state.locations.find((row) => row.id === id) || {} : {};
    const appUse = rowValue(rowElement, "app_use");
    const farmName = requiredText(rowValue(rowElement, "farm_name"), "Location name");
    const shortName = nullableText(rowValue(rowElement, "short_name"));
    const hasDatasetField = rowHasField(rowElement, "default_tide_dataset_id");
    const selectedDatasetId = hasDatasetField
      ? nullableText(rowValue(rowElement, "default_tide_dataset_id"))
      : current.default_tide_dataset_id || datasetIdForKey(current.default_tide_dataset_key) || null;
    const selectedDataset = datasetById(selectedDatasetId);
    const legacyPayload = {
      farm_location_key: normalizeKey(shortName || farmName),
      farm_name: farmName,
      short_name: shortName,
      region: requiredText(rowValue(rowElement, "region") || current.region || "Kwale County", "Region"),
      latitude: nullableNumber(rowValue(rowElement, "latitude")),
      longitude: nullableNumber(rowValue(rowElement, "longitude")),
      default_tide_dataset_key: selectedDataset?.dataset_key || current.default_tide_dataset_key || null,
      status: locationStatusForUse(appUse, current.status),
      public_visible: appUse === "public",
      active: appUse !== "inactive",
      country: current.country || "Kenya"
    };
    const payload = isSeaweedHarvestPlatform()
      ? {
          location_key: current.location_key || current.farm_location_key || normalizeKey(shortName || farmName),
          location_name: farmName,
          short_name: shortName,
          region: legacyPayload.region,
          latitude: legacyPayload.latitude,
          longitude: legacyPayload.longitude,
          default_tide_dataset_key: legacyPayload.default_tide_dataset_key,
          status: legacyPayload.status,
          public_visible: legacyPayload.public_visible,
          active: legacyPayload.active,
          country: legacyPayload.country
        }
      : legacyPayload;

    // Linked communities keep their canonical name and GPS in Seaweed Harvest.
    // Tide only edits its own location-specific metadata for those rows.
    if (isSeaweedHarvestPlatform() && current.community_record_id) {
      delete payload.location_name;
      delete payload.latitude;
      delete payload.longitude;
    }

    if (supportsLocationDatasetIdField()) {
      payload.default_tide_dataset_id = selectedDatasetId;
    }

    setStatus(els.locationSaveStatus, "Saving location...");
    const savedRows = id
      ? await supabasePatch(TABLES.locationAdmin, id, payload)
      : await supabaseInsert(TABLES.locationAdmin, payload);
    state.hasLocationDraft = false;
    await loadLocations({ quiet: true });
    setStatus(els.locationSaveStatus, `${savedRows[0]?.location_name || savedRows[0]?.farm_name || farmName} saved.`);
  } catch (error) {
    setStatus(els.locationSaveStatus, writeErrorMessage(error), "error");
  }
}

async function saveDatasetRow(rowElement) {
  try {
    requireSignedIn();
    const id = rowElement.dataset.rowId === NEW_DATASET_ID ? null : rowElement.dataset.rowId;
    const current = id ? state.datasets.find((row) => row.id === id) || {} : {};
    const datasetName = requiredText(rowValue(rowElement, "dataset_name"), "Dataset name");
    const tideLocationName = requiredText(rowValue(rowElement, "tide_location_name"), "Tide location name");
    const tideLocationRegion = requiredText(rowValue(rowElement, "tide_location_region") || datasetRegionValue(current), "Location region");
    const datasetUse = rowValue(rowElement, "dataset_use");
    const year = yearFromDate(current.valid_from) || new Date().getFullYear();
    const validFrom = rowHasField(rowElement, "valid_from") ? requiredText(rowValue(rowElement, "valid_from"), "Valid from") : current.valid_from || `${year}-01-01`;
    const validTo = rowHasField(rowElement, "valid_to") ? requiredText(rowValue(rowElement, "valid_to"), "Valid to") : current.valid_to || `${year}-12-31`;
    const payload = {
      dataset_key: current.dataset_key || normalizeDatasetKey(datasetName),
      dataset_name: datasetName,
      source_organization: nullableText(rowValue(rowElement, "source_organization")),
      source_file_name: current.source_file_name || null,
      source_url: current.source_url || null,
      tide_location_key: current.tide_location_key || normalizeDatasetKey(tideLocationName),
      tide_location_name: tideLocationName,
      tide_location_country: countryForRegion(tideLocationRegion),
      tide_location_latitude: nullableNumber(rowValue(rowElement, "tide_location_latitude")),
      tide_location_longitude: nullableNumber(rowValue(rowElement, "tide_location_longitude")),
      timezone: current.timezone || "Africa/Nairobi",
      datum_label: current.datum_label || "Metres above lowest astronomical tide",
      prediction_year: current.prediction_year || yearFromDate(validFrom),
      valid_from: validFrom,
      valid_to: validTo,
      verification_status: rowValue(rowElement, "verification_status") || "imported_unverified",
      has_hourly_predictions: current.has_hourly_predictions === true,
      has_tide_events: current.has_tide_events === true,
      public_visible: datasetUse === "public",
      active: datasetUse !== "inactive"
    };

    if (supportsDatasetRegionField()) {
      payload.tide_location_region = tideLocationRegion;
    }

    setStatus(els.datasetSaveStatus, "Saving dataset...");
    const savedRows = id
      ? await supabasePatch(TABLES.datasets, id, payload)
      : await supabaseInsert(TABLES.datasets, payload);
    state.hasDatasetDraft = false;
    await loadDatasets({ quiet: true });
    await loadLocations({ quiet: true });
    setStatus(els.datasetSaveStatus, `${savedRows[0]?.dataset_name || payload.dataset_name} saved.`);
  } catch (error) {
    setStatus(els.datasetSaveStatus, writeErrorMessage(error), "error");
  }
}

function selectDatasetForImport(datasetId, options = {}) {
  const dataset = state.datasets.find((row) => row.id === datasetId);
  if (!dataset) {
    setStatus(els.importPreviewStatus, "Could not select dataset for import.", "error");
    return;
  }

  state.selectedDatasetId = dataset.id;
  clearImportPreview(false);
  renderDatasets();
  renderSelectedImportTarget();
  setStatus(els.importPreviewStatus, `${dataset.dataset_name} selected for raw CSV import.`);
  if (options.scroll) {
    els.selectedImportTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => els.hourlyCsvInput?.focus(), 250);
  }
}

function selectedImportDataset() {
  return state.datasets.find((dataset) => dataset.id === state.selectedDatasetId) || null;
}

function renderSelectedImportTarget() {
  if (!els.selectedImportTarget) return;
  const dataset = selectedImportDataset();
  if (els.runSupabaseImport) els.runSupabaseImport.disabled = true;
  state.importPreview = null;

  if (!dataset) {
    if (els.importWriteStatusPill) {
      els.importWriteStatusPill.textContent = "Select dataset";
      els.importWriteStatusPill.className = "status-pill status-muted";
    }
    els.selectedImportTarget.className = "selected-import-target empty-state";
    els.selectedImportTarget.innerHTML = renderDatasetSelectControl("");
    return;
  }

  const rawStatus = rawDataStatusLabel(dataset.raw_data_status);
  if (els.importWriteStatusPill) {
    els.importWriteStatusPill.textContent = rawStatus;
    els.importWriteStatusPill.className = `status-pill ${dataset.has_raw_data ? "" : "status-muted"}`.trim();
  }
  els.selectedImportTarget.className = "selected-import-target";
  els.selectedImportTarget.innerHTML = renderDatasetSelectControl(dataset.id);
}

function renderDatasetSelectControl(selectedId) {
  return `
    <label class="selected-import-select">
      Selected dataset
      <select id="selectedImportDatasetSelect" ${state.datasets.length ? "" : "disabled"}>
        ${state.datasets.length
          ? [
              `<option value=""${selectedId ? "" : " selected"}>Select dataset</option>`,
              ...state.datasets.map((dataset) => `
            <option value="${escapeAttribute(dataset.id)}"${dataset.id === selectedId ? " selected" : ""}>
              ${escapeHtml(datasetSelectLabel(dataset))}
            </option>
          `)
            ].join("")
          : `<option value="">No datasets loaded</option>`}
      </select>
    </label>
  `;
}

function datasetSelectLabel(dataset) {
  return `${datasetDisplayId(dataset, datasetIndex(dataset))} - ${dataset.dataset_name || "Unnamed dataset"}`;
}

async function previewCsvFiles() {
  if (!state.authSession) {
    setStatus(els.importPreviewStatus, "Sign in as an active admin before previewing imports.", "error");
    return;
  }

  const dataset = selectedImportDataset();
  if (!dataset) {
    setStatus(els.importPreviewStatus, "Select a dataset before previewing CSVs.", "error");
    return;
  }

  try {
    setStatus(els.importPreviewStatus, "Reading CSV files...");
    if (els.runSupabaseImport) els.runSupabaseImport.disabled = true;
    state.importPreview = null;

    const hourly = els.hourlyCsvInput?.files[0]
      ? await readCsvFile(els.hourlyCsvInput.files[0], "hourly", REQUIRED_IMPORT_COLUMNS.hourly)
      : null;
    const events = els.eventsCsvInput?.files[0]
      ? await readCsvFile(els.eventsCsvInput.files[0], "events", REQUIRED_IMPORT_COLUMNS.events)
      : null;

    if (!hourly && !events) {
      throw new Error("Select at least one raw tide CSV: hourly predictions, tide events, or both.");
    }

    const issues = [];
    const notes = [];
    const blocks = [];
    let hourlyRows = [];
    let eventRows = [];

    if (hourly) {
      const split = splitRowsForDataset(hourly.rows, dataset);
      hourlyRows = split.rows;
      if (split.skipped) notes.push(`Hourly predictions: ${formatInteger(split.skipped)} row(s) for other dataset IDs/keys will be skipped.`);
      if (!split.rows.length) issues.push(`Hourly predictions: no rows match ${dataset.dataset_name || dataset.id}.`);
      issues.push(...validateRawPreview("Hourly predictions", split.rows, dataset, ["prediction_time_utc"]));
      issues.push(...validateHeights("Hourly predictions", split.rows));
      blocks.push(renderPreviewBlock("Hourly predictions", hourly, summarizeRawRows(split.rows, "prediction_time_utc", dataset), split.skipped));
    }

    if (events) {
      const split = splitRowsForDataset(events.rows, dataset);
      eventRows = split.rows;
      if (split.skipped) notes.push(`Tide events: ${formatInteger(split.skipped)} row(s) for other dataset IDs/keys will be skipped.`);
      if (!split.rows.length) issues.push(`Tide events: no rows match ${dataset.dataset_name || dataset.id}.`);
      issues.push(...validateRawPreview("Tide events", split.rows, dataset, ["event_time_utc", "event_type"]));
      issues.push(...validateHeights("Tide events", split.rows));
      issues.push(...validateEventTypes(split.rows));
      blocks.push(renderPreviewBlock("Tide events", events, summarizeRawRows(split.rows, "event_time_utc", dataset), split.skipped));
    }

    state.importPreview = {
      datasetId: dataset.id,
      datasetKey: dataset.dataset_key,
      hourlyRows,
      eventRows,
      issues
    };
    if (els.runSupabaseImport) els.runSupabaseImport.disabled = !!issues.length;

    els.importPreviewResults.innerHTML = `
      ${issues.length ? renderIssueList(issues) : `<div class="empty-state success-state">Preview checks passed for ${escapeHtml(dataset.dataset_name || dataset.id)}. Click Import to Supabase when ready.</div>`}
      ${notes.length ? renderNoteList(notes) : ""}
      <div class="import-preview-grid">${blocks.join("")}</div>
    `;

    setStatus(
      els.importPreviewStatus,
      issues.length ? `${issues.length} issue(s) found. Fix the CSVs before import.` : "Preview complete. CSVs are ready to import.",
      issues.length ? "error" : ""
    );
  } catch (error) {
    if (els.importPreviewResults) els.importPreviewResults.innerHTML = "";
    if (els.runSupabaseImport) els.runSupabaseImport.disabled = true;
    state.importPreview = null;
    setStatus(els.importPreviewStatus, error.message, "error");
  }
}

async function importPreviewToSupabase() {
  const dataset = selectedImportDataset();
  const preview = state.importPreview;

  if (!state.authSession) {
    setStatus(els.importPreviewStatus, "Sign in as an active admin before importing.", "error");
    return;
  }
  if (!dataset || !preview || preview.datasetId !== dataset.id) {
    setStatus(els.importPreviewStatus, "Preview the CSVs for the selected dataset before importing.", "error");
    return;
  }
  if (preview.issues.length) {
    setStatus(els.importPreviewStatus, "Fix preview issues before importing.", "error");
    return;
  }
  if (!preview.hourlyRows.length && !preview.eventRows.length) {
    setStatus(els.importPreviewStatus, "There are no previewed rows to import.", "error");
    return;
  }

  try {
    if (els.runSupabaseImport) els.runSupabaseImport.disabled = true;
    setStatus(els.importPreviewStatus, "Importing raw tide rows to Supabase...");

    if (els.replaceExistingRows?.checked) {
      if (preview.hourlyRows.length) await deleteExistingRawRows("tide_hourly_predictions", dataset);
      if (preview.eventRows.length) await deleteExistingRawRows("tide_events", dataset);
    }

    if (preview.hourlyRows.length) {
      const rows = prepareRowsForImport(preview.hourlyRows, dataset, "hourly");
      await upsertRawRows("tide_hourly_predictions", rows, "dataset_id,prediction_time_utc", "dataset_key,prediction_time_utc");
    }

    if (preview.eventRows.length) {
      const rows = prepareRowsForImport(preview.eventRows, dataset, "events");
      await upsertRawRows("tide_events", rows, "dataset_id,event_time_utc,event_type", "dataset_key,event_time_utc,event_type");
    }

    await markDatasetImportFlags(dataset, {
      hourly: preview.hourlyRows.length > 0,
      events: preview.eventRows.length > 0
    });

    await loadDatasets({ quiet: true });
    setStatus(
      els.importPreviewStatus,
      `Imported ${formatInteger(preview.hourlyRows.length)} hourly row(s) and ${formatInteger(preview.eventRows.length)} event row(s). Dataset summary refreshed.`
    );
    els.importPreviewResults.insertAdjacentHTML(
      "afterbegin",
      `<div class="empty-state success-state">Import complete. The Tide datasets table now reflects the Supabase summary view where available.</div>`
    );
  } catch (error) {
    if (els.runSupabaseImport) els.runSupabaseImport.disabled = false;
    setStatus(els.importPreviewStatus, writeErrorMessage(error), "error");
  }
}

async function readCsvFile(file, label, requiredColumns) {
  if (!file) throw new Error(`${label} CSV is required.`);
  const text = await file.text();
  const parsed = parseCsv(text);
  if (!parsed.length) throw new Error(`${label} CSV is empty.`);
  const headers = parsed[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw new Error(`${label} CSV is missing required columns: ${missing.join(", ")}`);
  }

  const rows = parsed.slice(1)
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values, index) => {
      const row = { _csvRow: index + 2 };
      headers.forEach((header, columnIndex) => {
        row[header] = values[columnIndex] === undefined ? "" : String(values[columnIndex]).trim();
      });
      return row;
    });

  return {
    label,
    fileName: file.name,
    headers,
    rows
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function splitRowsForDataset(rows, dataset) {
  const selectedRows = [];
  let skipped = 0;

  rows.forEach((row) => {
    if (row.dataset_id && row.dataset_id !== dataset.id) {
      skipped += 1;
      return;
    }
    if (row.dataset_key && row.dataset_key !== dataset.dataset_key) {
      skipped += 1;
      return;
    }
    selectedRows.push(row);
  });

  return { rows: selectedRows, skipped };
}

function validateRawPreview(label, rows, dataset, uniqueFields) {
  const issues = [];
  const seen = new Set();

  rows.forEach((row) => {
    const uniqueKey = [dataset.id, ...uniqueFields.map((field) => row[field])].join("|");
    if (seen.has(uniqueKey)) {
      issues.push(`${label} duplicate row key: ${uniqueKey}`);
    }
    seen.add(uniqueKey);
  });

  return issues;
}

function validateHeights(label, rows) {
  return rows
    .filter((row) => row.height_m !== "" && !Number.isFinite(Number(row.height_m)))
    .map((row) => `${label} row ${row._csvRow} has invalid height_m: ${row.height_m}`);
}

function validateEventTypes(rows) {
  return rows
    .filter((row) => !["high", "low"].includes(String(row.event_type || "").toLowerCase()))
    .map((row) => `Tide events row ${row._csvRow} has invalid event_type: ${row.event_type || "(blank)"}`);
}

function summarizeRawRows(rows, timeField, dataset) {
  const dates = [];
  const heights = [];

  rows.forEach((row) => {
    if (row.local_date) dates.push(row.local_date);
    if (row.height_m !== "") heights.push(Number(row.height_m));
  });

  const finiteHeights = heights.filter(Number.isFinite);
  const sortedDates = dates.slice().sort();
  const firstDate = sortedDates.length ? sortedDates[0] : "";
  const lastDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : "";

  return [{
    key: dataset.id,
    count: rows.length,
    range: formatDateRange(firstDate, lastDate),
    detail: finiteHeights.length
      ? `${Math.min(...finiteHeights).toFixed(3)} to ${Math.max(...finiteHeights).toFixed(3)} m`
      : "height range unavailable",
    timeField
  }];
}

function renderPreviewBlock(title, fileResult, summaryRows, skippedCount) {
  return `
    <article class="import-preview-card">
      <h3>${escapeHtml(title)}</h3>
      <p class="field-hint">${escapeHtml(fileResult.fileName)} - ${formatInteger(fileResult.rows.length)} source row(s)${skippedCount ? `, ${formatInteger(skippedCount)} skipped` : ""}</p>
      <table class="mini-table">
        <thead>
          <tr>
            <th>Dataset ID</th>
            <th>Rows</th>
            <th>Range</th>
            <th>Height range</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows.map((row) => `
            <tr>
              <td>${escapeHtml(shortId(row.key))}</td>
              <td>${escapeHtml(formatInteger(row.count))}</td>
              <td>${escapeHtml(row.range)}</td>
              <td>${escapeHtml(row.detail)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderIssueList(issues) {
  return `
    <div class="empty-state error-state">
      <strong>Fix before import</strong>
      <ul class="check-list">
        ${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderNoteList(notes) {
  return `
    <div class="empty-state">
      <strong>Import notes</strong>
      <ul class="check-list">
        ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function prepareRowsForImport(rows, dataset, rowType) {
  const fields = RAW_IMPORT_FIELDS[rowType];
  return rows.map((row) => {
    const prepared = {
      dataset_id: dataset.id,
      dataset_key: dataset.dataset_key
    };

    fields.forEach((field) => {
      if (field === "dataset_id" || field === "dataset_key") return;
      if (!Object.prototype.hasOwnProperty.call(row, field)) return;
      prepared[field] = cleanImportValue(row[field], field);
    });

    return prepared;
  });
}

function cleanImportValue(value, field) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  if (RAW_BOOLEAN_FIELDS.has(field)) return parseBoolean(text);
  if (RAW_NUMBER_FIELDS.has(field)) return Number(text);
  if (field === "event_type") return text.toLowerCase();
  return text;
}

function parseBoolean(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(text)) return true;
  if (["false", "f", "no", "n", "0"].includes(text)) return false;
  return null;
}

async function deleteExistingRawRows(table, dataset) {
  try {
    await supabaseRequest(`${table}?dataset_id=eq.${encodeURIComponent(dataset.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
      requireAuth: true
    });
  } catch (error) {
    if (!shouldRetryWithoutDatasetId(error)) throw error;
    await supabaseRequest(`${table}?dataset_key=eq.${encodeURIComponent(dataset.dataset_key)}`, {
      method: "DELETE",
      prefer: "return=minimal",
      requireAuth: true
    });
  }
}

async function upsertRawRows(table, rows, uuidConflict, legacyConflict) {
  try {
    await postRowsInBatches(table, rows, uuidConflict);
  } catch (error) {
    if (!shouldRetryWithoutDatasetId(error)) throw error;
    const legacyRows = rows.map(({ dataset_id, ...row }) => row);
    await postRowsInBatches(table, legacyRows, legacyConflict);
  }
}

async function postRowsInBatches(table, rows, conflictColumns) {
  for (let index = 0; index < rows.length; index += RAW_IMPORT_BATCH_SIZE) {
    const batch = rows.slice(index, index + RAW_IMPORT_BATCH_SIZE);
    const rangeLabel = `${formatInteger(index + 1)}-${formatInteger(index + batch.length)} of ${formatInteger(rows.length)}`;
    setStatus(els.importPreviewStatus, `Uploading ${table}: ${rangeLabel}...`);
    await supabaseRequest(`${table}?on_conflict=${conflictColumns}`, {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=minimal",
      requireAuth: true
    });
  }
}

async function markDatasetImportFlags(dataset, imported) {
  const payload = {
    has_hourly_predictions: imported.hourly || dataset.has_hourly_predictions === true,
    has_tide_events: imported.events || dataset.has_tide_events === true,
    imported_at: new Date().toISOString()
  };

  await supabaseRequest(`${TABLES.datasets}?id=eq.${encodeURIComponent(dataset.id)}`, {
    method: "PATCH",
    body: payload,
    prefer: "return=minimal",
    requireAuth: true
  });
}

function clearImportPreview(clearFiles) {
  if (clearFiles) els.importPreviewForm?.reset();
  state.importPreview = null;
  if (els.runSupabaseImport) els.runSupabaseImport.disabled = true;
  if (els.importPreviewResults) els.importPreviewResults.innerHTML = "";
  setStatus(els.importPreviewStatus, "");
}

function shouldRetryWithoutDatasetId(error) {
  return /dataset_id|on_conflict|schema cache|unique or exclusion/i.test(error?.message || "");
}

async function saveAdminUserRow(rowElement) {
  try {
    if (isSeaweedHarvestPlatform()) {
      throw new Error("Manage Tide application access in Seaweed Harvest Admin Users.");
    }
    requireSignedIn();
    const userId = requiredText(rowElement.dataset.userId, "User ID");
    const payload = {
      role: rowValue(rowElement, "role") || "operator",
      active: rowValue(rowElement, "active") === "active",
      notes: nullableText(rowValue(rowElement, "notes"))
    };

    setStatus(els.adminUsersStatus, "Saving admin user...");
    await supabasePatchBy(TABLES.adminUsers, "user_id", userId, payload);
    await loadAdminUsers({ quiet: true });
    setStatus(els.adminUsersStatus, "Admin user saved.");
  } catch (error) {
    setStatus(els.adminUsersStatus, writeErrorMessage(error), "error");
  }
}

async function supabaseSelect(table, query) {
  return supabaseRequest(`${table}?${query}`);
}

async function supabaseInsert(table, payload) {
  return supabaseRequest(table, {
    method: "POST",
    body: payload,
    prefer: "return=representation",
    requireAuth: true
  });
}

async function supabasePatch(table, id, payload) {
  return supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
    prefer: "return=representation",
    requireAuth: true
  });
}

async function supabasePatchBy(table, field, value, payload) {
  return supabaseRequest(`${table}?${encodeURIComponent(field)}=eq.${encodeURIComponent(value)}`, {
    method: "PATCH",
    body: payload,
    prefer: "return=representation",
    requireAuth: true
  });
}

async function supabaseRequest(path, options = {}) {
  if (options.requireAuth) requireSignedIn();

  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs || (method === "GET" ? 12000 : 45000);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const backend = state.backend || {
    restUrl: APP_CONFIG.supabase.restUrl,
    anonKey: APP_CONFIG.supabase.anonKey
  };
  const token = state.authSession?.access_token || backend.anonKey;
  const headers = {
    apikey: backend.anonKey,
    Authorization: `Bearer ${token}`
  };

  if (options.body) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  try {
    const response = await fetch(`${backend.restUrl}/${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
    }

    if (response.status === 204) return [];
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${Math.round(timeoutMs / 1000)} seconds. Reload the page or check the connection.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function signIn() {
  if (isSeaweedHarvestPlatform()) return;
  const email = requiredText(els.adminEmail.value, "Email");
  const password = requiredText(els.adminPassword.value, "Password");

  try {
    setAuthStatus("Signing in...");
    const response = await fetch(`${APP_CONFIG.supabase.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: APP_CONFIG.supabase.anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error(await authErrorMessage(response));
    }

    const session = await response.json();
    state.authSession = normalizeSession(session);
    writeStoredAuthSession(state.authSession);
    els.adminPassword.value = "";
    updateAuthUi();
    await loadAll();
  } catch (error) {
    clearStoredAuthSession();
    state.authSession = null;
    updateAuthUi();
    setAuthStatus(error.message, "error");
  }
}

async function signOut() {
  if (isSeaweedHarvestPlatform()) return;
  const token = state.authSession?.access_token;
  clearStoredAuthSession();
  state.authSession = null;
  updateAuthUi();

  if (token) {
    try {
      await fetch(`${APP_CONFIG.supabase.url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: APP_CONFIG.supabase.anonKey,
          Authorization: `Bearer ${token}`
        }
      });
    } catch {
      // Local sign-out still succeeds if the network request fails.
    }
  }

  await loadAll();
}

async function verifyStoredSession() {
  if (isSeaweedHarvestPlatform()) return;
  if (!state.authSession?.access_token) return;

  try {
    const response = await fetch(`${APP_CONFIG.supabase.url}/auth/v1/user`, {
      headers: {
        apikey: APP_CONFIG.supabase.anonKey,
        Authorization: `Bearer ${state.authSession.access_token}`
      }
    });

    if (!response.ok) throw new Error("Stored admin session has expired.");

    const user = await response.json();
    state.authSession.user = user;
    writeStoredAuthSession(state.authSession);
    updateAuthUi();
  } catch {
    clearStoredAuthSession();
    state.authSession = null;
    updateAuthUi();
  }
}

function normalizeSession(session) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at || (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : null),
    user: session.user || null
  };
}

function loadStoredAuthSession() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    state.authSession = raw ? JSON.parse(raw) : null;
  } catch {
    state.authSession = null;
  }
}

function writeStoredAuthSession(session) {
  try {
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // In-memory session still works if storage is blocked.
  }
}

function clearStoredAuthSession() {
  try {
    window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // Ignore restricted storage.
  }
}

function updateAuthUi() {
  const signedIn = !!state.authSession?.access_token;
  const email = state.authSession?.user?.email || "signed-in admin";

  document.body.classList.toggle("admin-signed-in", signedIn);
  document.body.classList.toggle("admin-login-required", !signedIn);
  if (els.adminLoginModal) {
    els.adminLoginModal.hidden = signedIn;
  }
  els.adminSignIn.disabled = signedIn;
  els.adminSignOut.disabled = !signedIn;
  if (els.newLocation) els.newLocation.hidden = !signedIn;
  if (els.newDataset) els.newDataset.hidden = !signedIn;

  if (!signedIn) {
    state.hasLocationDraft = false;
    state.hasDatasetDraft = false;
    state.editingLocationId = null;
    state.editingDatasetId = null;
    state.selectedCalibrationId = null;
  }

  document.querySelectorAll("[data-edit-location], [data-save-location], [data-edit-dataset], [data-save-dataset], [data-save-admin-user], [data-edit-calibration]").forEach((button) => {
    button.disabled = !signedIn;
  });

  if (signedIn) {
    setAuthStatus(
      isSeaweedHarvestPlatform()
        ? `Seaweed Harvest account: ${email}. Tide administrator access confirmed.`
        : `Signed in as ${email}. Hidden/internal rows are available if your policy allows them.`
    );
    renderLocations();
    renderCalibrationPanel();
    renderAdminUsers();
    return;
  }

  setAuthStatus(
    isSeaweedHarvestPlatform()
      ? "Tide administrator access is required."
      : "Sign in with an approved Supabase Auth user to save changes."
  );
  renderLocations();
  renderCalibrationPanel();
  renderAdminUsers();
}

function setSignedOutHints() {
  if (state.authSession) return;
  if (isSeaweedHarvestPlatform()) return;

  setStatus(
    els.datasetSaveStatus,
    "Showing public datasets. Sign in to see hidden/internal reference datasets such as KPA where permission is pending."
  );
}

function requireSignedIn() {
  if (!state.authSession?.access_token) {
    throw new Error("Sign in as an approved admin user before saving.");
  }
}

function defaultLocation() {
  return {
    farm_location_key: "",
    farm_name: "",
    short_name: "",
    region: "Kwale County",
    country: "Kenya",
    default_harvest_threshold_m: 0.7,
    status: "prototype_placeholder",
    active: true,
    public_visible: true
  };
}

function defaultDataset() {
  const year = new Date().getFullYear();
  return {
    dataset_key: "",
    dataset_name: "",
    tide_location_key: "",
    tide_location_name: "",
    tide_location_region: "",
    tide_location_country: "Kenya",
    timezone: "Africa/Nairobi",
    prediction_year: year,
    valid_from: `${year}-01-01`,
    valid_to: `${year}-12-31`,
    verification_status: "imported_unverified",
    has_hourly_predictions: false,
    has_tide_events: false,
    active: true,
    public_visible: false
  };
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function readOnlyCell(value) {
  const text = valueOrEmpty(value).trim();
  return text ? `<span class="readonly-value">${escapeHtml(text)}</span>` : `<span class="readonly-muted">-</span>`;
}

function calibrationStatusCell(location) {
  const status = calibrationStatusForLocation(location);
  return `<span class="status-pill calibration-status-pill" data-status="${escapeAttribute(status.value)}">${escapeHtml(status.label)}</span>`;
}

function calibrationStatusForLocation(location) {
  if (!location?.id) return { value: "none", label: "None" };

  const summary = state.calibrations.find((row) => row.location_id === location.id);
  return calibrationStatusForValue(summary?.calibration_status);
}

function calibrationStatusForValue(statusValue) {
  const status = String(statusValue || "none").toLowerCase();

  if (status === "complete") return { value: "complete", label: "Complete" };
  if (status === "incomplete") return { value: "incomplete", label: "Incomplete" };
  if (status === "under_review") return { value: "under_review", label: "Under Review" };
  if (status === "retired") return { value: "none", label: "None" };
  return { value: "none", label: "None" };
}

function activeCalibrationForLocation(locationId) {
  return state.calibrationRecords.find((row) => row.location_id === locationId && row.active !== false && row.status !== "retired") || null;
}

function calibrationSummaryForLocation(location) {
  if (!location?.id) return {};
  return state.calibrations.find((row) => row.location_id === location.id) || {};
}

function calibrationEvidence(calibration) {
  return [
    calibration?.observation_record_number ? `record: ${calibration.observation_record_number}` : "",
    calibration?.confidence ? `confidence: ${calibration.confidence}` : "",
    calibration?.last_edited_by ? `edited: ${calibration.last_edited_by}` : ""
  ].filter(Boolean).join("; ");
}

function locationLabel(location) {
  const parts = [
    location.location_code,
    location.farm_name || location.location_name || location.short_name,
    location.region
  ].filter(Boolean);
  return parts.join(" - ");
}

function readOnlyStack(values) {
  const lines = values
    .map((value) => valueOrEmpty(value).trim())
    .filter(Boolean);

  if (!lines.length) return readOnlyCell("");
  return `<div class="readonly-stack">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div>`;
}

function datasetLabel(datasetRef) {
  const dataset = state.datasets.find((item) => item.id === datasetRef || item.dataset_key === datasetRef);
  return dataset?.dataset_name || datasetRef || "";
}

function datasetById(datasetId) {
  return state.datasets.find((item) => item.id === datasetId) || null;
}

function datasetIdForKey(datasetKey) {
  return state.datasets.find((item) => item.dataset_key === datasetKey)?.id || "";
}

function supportsLocationDatasetIdField() {
  return isSeaweedHarvestPlatform()
    || state.locations.some((row) => Object.prototype.hasOwnProperty.call(row, "default_tide_dataset_id"));
}

function formatThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} m` : "";
}

function formatCoordinate(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : "";
}

function formatCoordinatePair(latitude, longitude) {
  const lat = formatCoordinate(latitude);
  const lon = formatCoordinate(longitude);
  return lat && lon ? `${lat}, ${lon}` : "";
}

function formatDateRange(start, end) {
  if (start && end) return `${start} to ${end}`;
  return start || end || "";
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatMinutes(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${number} min`;
}

function formatMetres(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(3)} m` : "-";
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "-";
}

function currentUserEmail() {
  return state.authSession?.user?.email || "signed-in admin";
}

function loadLanguageSettings() {
  const settings = readLanguageSettings();
  document.querySelectorAll("[data-language-status]").forEach((select) => {
    select.value = settings[select.dataset.languageStatus] || "active";
  });
}

function saveLanguageSettings() {
  const settings = readLanguageSettings();
  document.querySelectorAll("[data-language-status]").forEach((select) => {
    settings[select.dataset.languageStatus] = select.value;
  });

  try {
    window.localStorage.setItem(LANGUAGE_SETTINGS_KEY, JSON.stringify(settings));
    setStatus(els.languageSettingsStatus, "Language status saved in this browser for the prototype.");
  } catch {
    setStatus(els.languageSettingsStatus, "Language status changed for this session only. Browser storage is blocked.", "error");
  }
}

function readLanguageSettings() {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function datasetDataFlags(row) {
  const flags = [];
  if (row.has_hourly_predictions) flags.push("Hourly");
  if (row.has_tide_events) flags.push("Events");
  return flags;
}

function dataCoverageLabel(dataset) {
  return formatDateRange(dataset.first_data_local_date, dataset.last_data_local_date)
    || formatDateRange(dataset.valid_from, dataset.valid_to)
    || "No linked raw data";
}

function rawDataStatusFromFlags(hasHourly, hasEvents) {
  if (hasHourly && hasEvents) return "hourly_and_events";
  if (hasHourly) return "hourly_only";
  if (hasEvents) return "events_only";
  return "no_raw_data";
}

function rawDataStatusLabel(value) {
  const text = String(value || "summary_not_applied");
  if (text === "hourly_and_events") return "Hourly + events linked";
  if (text === "hourly_only") return "Hourly rows linked";
  if (text === "events_only") return "Event rows linked";
  if (text === "no_raw_data") return "No raw data linked";
  return formatStatus(text);
}

function datasetIndex(dataset) {
  return state.datasets.findIndex((row) => row.id === dataset.id);
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-GB") : "0";
}

function recordUseLabel(row, publicLabel = "Public") {
  const value = recordUseValue(row);
  if (value === "inactive") return "Inactive";
  if (value === "internal") return "Internal only";
  return publicLabel;
}

function locationIdCell(row, index) {
  const label = locationDisplayId(row, index);
  if (!row.id) return `<span class="muted-cell">${escapeHtml(label)}</span>`;
  return `<a href="${escapeAttribute(dashboardTableUrl(TABLES.locations))}" target="_blank" rel="noopener" title="Supabase UUID: ${escapeAttribute(row.id)}">${escapeHtml(label)}</a>`;
}

function locationDisplayId(row, index) {
  if (row.location_code) return row.location_code;
  if (!row.id) return "LID-New";
  return `LID-${String(index + 1).padStart(5, "0")}`;
}

function datasetIdCell(row, index) {
  const label = datasetDisplayId(row, index);
  if (!row.id) return `<span class="muted-cell">${escapeHtml(label)}</span>`;
  return `<a href="${escapeAttribute(dashboardTableUrl(TABLES.datasets))}" target="_blank" rel="noopener" title="Supabase UUID: ${escapeAttribute(row.id)}">${escapeHtml(label)}</a>`;
}

function datasetDisplayId(row, index) {
  if (row.dataset_code) return row.dataset_code;
  if (!row.id) return "DID-New";
  return `DID-${String(index + 1).padStart(5, "0")}`;
}

function datasetRegionValue(row) {
  return row.tide_location_region || row.tide_location_country || "";
}

function supportsDatasetRegionField() {
  return state.datasets.some((row) => Object.prototype.hasOwnProperty.call(row, "tide_location_region"));
}

function tideRegionOptions(selectedValue) {
  const baseOptions = [
    ["", "Select region"],
    ["Kwale County", "Kwale County, Kenya"],
    ["Mombasa County", "Mombasa County, Kenya"],
    ["Lamu County", "Lamu County, Kenya"],
    ["Dar es Salaam Region", "Dar es Salaam Region, Tanzania"],
    ["Regional / mixed", "Regional / mixed"]
  ];

  if (selectedValue && !baseOptions.some(([value]) => value === selectedValue)) {
    return [[selectedValue, selectedValue], ...baseOptions];
  }

  return baseOptions;
}

function countryForRegion(region) {
  const text = String(region || "").toLowerCase();
  if (text.includes("dar es salaam") || text.includes("tanzania")) return "Tanzania";
  if (text.includes("regional")) return "Regional";
  return "Kenya";
}

function locationUseValue(row) {
  return recordUseValue(row);
}

function locationUseOptions() {
  return recordUseOptions("Shown in app");
}

function recordUseValue(row) {
  if (row.active === false) return "inactive";
  if (row.public_visible === false) return "internal";
  return "public";
}

function recordUseOptions(publicLabel = "Public") {
  return [
    ["public", publicLabel],
    ["internal", "Internal only"],
    ["inactive", "Inactive"]
  ];
}

function adminRoleOptions(selectedRole) {
  const baseOptions = [
    ["admin", "Admin"],
    ["operator", "Operator"]
  ];

  if (selectedRole && !baseOptions.some(([value]) => value === selectedRole)) {
    return [[selectedRole, formatStatus(selectedRole)], ...baseOptions];
  }

  return baseOptions;
}

function locationStatusForUse(appUse) {
  if (appUse === "inactive") return "inactive";
  if (appUse === "internal") return "reference_only";
  return "active";
}

function idLink(id, tableName) {
  if (!id) return `<span class="muted-cell">New row</span>`;
  return `<a href="${escapeAttribute(dashboardTableUrl(tableName))}" target="_blank" rel="noopener" title="${escapeAttribute(id)}">${escapeHtml(shortId(id))}</a>`;
}

function dashboardTableUrl(tableName) {
  const projectRef = state.backend?.projectRef || APP_CONFIG.supabase.projectRef;
  return `https://supabase.com/dashboard/project/${projectRef}/editor?schema=public&table=${encodeURIComponent(tableName)}`;
}

function textInput(field, value, label) {
  return `<input data-field="${escapeAttribute(field)}" type="text" value="${escapeAttribute(valueOrEmpty(value))}" aria-label="${escapeAttribute(label)}">`;
}

function hiddenInput(field, value) {
  return `<input data-field="${escapeAttribute(field)}" type="hidden" value="${escapeAttribute(valueOrEmpty(value))}">`;
}

function numberInput(field, value, label, min, max, step) {
  return `<input data-field="${escapeAttribute(field)}" type="number" value="${escapeAttribute(valueOrEmpty(value))}" min="${min}" max="${max}" step="${step}" aria-label="${escapeAttribute(label)}">`;
}

function dateInput(field, value) {
  return `<input data-field="${escapeAttribute(field)}" type="date" value="${escapeAttribute(valueOrEmpty(value))}" aria-label="${escapeAttribute(formatStatus(field))}">`;
}

function selectInput(field, selectedValue, options) {
  const optionHtml = options.map(([value, label]) => {
    const selected = String(value || "") === String(selectedValue || "") ? " selected" : "";
    return `<option value="${escapeAttribute(value)}"${selected}>${escapeHtml(label)}</option>`;
  }).join("");
  return `<select data-field="${escapeAttribute(field)}" aria-label="${escapeAttribute(formatStatus(field))}">${optionHtml}</select>`;
}

function checkboxInput(field, checked, label) {
  return `
    <label>
      <input data-field="${escapeAttribute(field)}" type="checkbox"${checked ? " checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function rowValue(rowElement, field) {
  const input = rowElement.querySelector(`[data-field="${field}"]`);
  if (!input) return "";
  if (input.type === "checkbox") return input.checked;
  return input.value;
}

function rowHasField(rowElement, field) {
  return !!rowElement.querySelector(`[data-field="${field}"]`);
}

function setConnectionStatus(text, extraClass) {
  if (!els.adminConnectionStatus) return;
  els.adminConnectionStatus.textContent = text;
  els.adminConnectionStatus.className = `status-pill ${extraClass || ""}`.trim();
}

function setAuthStatus(message, type = "") {
  if (!els.adminAuthStatus) return;
  els.adminAuthStatus.textContent = message;
  els.adminAuthStatus.dataset.status = type;
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.dataset.status = type;
}

async function responseDetail(response) {
  try {
    const errorBody = await response.json();
    const detail = errorBody.message || errorBody.details || errorBody.hint || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

async function authErrorMessage(response) {
  try {
    const body = await response.json();
    return body.msg || body.message || body.error_description || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

function writeErrorMessage(error) {
  const message = error?.message || String(error);
  if (/401|403|permission|policy|row-level|JWT/i.test(message)) {
    return `${message}. Writes need an authenticated admin policy. The service-role key must not be placed in this page.`;
  }
  return message;
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function nullableInteger(value) {
  const number = nullableNumber(value);
  return number === null ? null : Math.round(number);
}

function normalizeKey(value) {
  return requiredText(value, "Location key")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDatasetKey(value) {
  return requiredText(value, "Dataset key")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function yearFromDate(value) {
  const match = String(value || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function valueOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function shortId(id) {
  if (!id) return "New";
  return `${id.slice(0, 8)}...`;
}

function formatStatus(value) {
  return String(value || "unknown").replace(/_/g, " ");
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
