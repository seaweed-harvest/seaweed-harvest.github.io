import { APP_CONFIG } from "./config.js";

const AUTH_SESSION_KEY = "seaweed_tide_planner:admin_auth_session";
const NEW_DATASET_ID = "__new_dataset__";
const RAW_IMPORT_BATCH_SIZE = 450;

const REQUIRED_COLUMNS = {
  hourly: ["prediction_time_utc", "local_date", "local_time", "local_hour", "height_m"],
  events: ["event_time_utc", "local_date", "local_time", "event_type", "height_m"]
};

const DATASET_STATUSES = [
  "imported_unverified",
  "pending_review",
  "verified",
  "superseded",
  "rejected"
];

const RAW_FIELDS = {
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

const NUMBER_FIELDS = new Set([
  "height_m",
  "local_hour",
  "source_pdf_page",
  "tide_location_latitude",
  "tide_location_longitude"
]);

const BOOLEAN_FIELDS = new Set(["derived_from_hourly"]);

const state = {
  authSession: null,
  isAdmin: false,
  datasets: [],
  hasDatasetDraft: false,
  editingDatasetId: null,
  selectedDatasetId: "",
  preview: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("unhandledrejection", (event) => {
  setStatus(els.importPreviewStatus, event.reason?.message || "Unexpected importer page error.", "error");
});

async function init() {
  cacheElements();
  bindEvents();
  loadStoredAuthSession();
  updateAuthUi();
  await verifyStoredSession();
  if (state.isAdmin) await loadDatasets();
}

function cacheElements() {
  [
    "importerConnectionStatus",
    "importerAuthStatus",
    "importerAuthForm",
    "importerEmail",
    "importerPassword",
    "importerSignIn",
    "importerSignOut",
    "importerLocked",
    "importerWorkspace",
    "importDatasetCount",
    "reloadDatasets",
    "newDataset",
    "datasetSaveStatus",
    "datasetsTableBody",
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
    "importCommand"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.importerAuthForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });

  els.importerSignOut.addEventListener("click", async () => {
    await signOut();
  });

  els.reloadDatasets.addEventListener("click", () => loadDatasets());

  els.newDataset.addEventListener("click", () => {
    if (!state.isAdmin) {
      setStatus(els.datasetSaveStatus, "Sign in as an active admin before adding a dataset.", "error");
      return;
    }
    state.hasDatasetDraft = true;
    state.editingDatasetId = NEW_DATASET_ID;
    renderDatasetRows();
    setStatus(els.datasetSaveStatus, "New dataset metadata row added. Click Create when ready.");
  });

  els.datasetsTableBody.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-dataset]");
    if (editButton) {
      state.editingDatasetId = editButton.closest("tr").dataset.rowId;
      renderDatasetRows();
      setStatus(els.datasetSaveStatus, "Editing dataset metadata. Click Save to commit changes.");
      return;
    }

    const saveButton = event.target.closest("[data-save-dataset]");
    if (saveButton) {
      await saveDatasetRow(saveButton.closest("tr"));
      return;
    }

    const importButton = event.target.closest("[data-import-dataset]");
    if (importButton) {
      selectDatasetForImport(importButton.dataset.importDataset, { scroll: true });
    }
  });

  els.selectedImportTarget.addEventListener("change", (event) => {
    if (event.target.id !== "selectedImportDatasetSelect") return;
    selectDatasetForImport(event.target.value);
  });

  els.importPreviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await previewCsvFiles();
  });

  els.runSupabaseImport.addEventListener("click", async () => {
    await importPreviewToSupabase();
  });

  els.clearImportPreview.addEventListener("click", () => clearPreview(true));
}

async function signIn() {
  const email = requiredText(els.importerEmail.value, "Email");
  const password = requiredText(els.importerPassword.value, "Password");

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

    if (!response.ok) throw new Error(await authErrorMessage(response));

    const session = await response.json();
    state.authSession = normalizeSession(session);
    writeStoredAuthSession(state.authSession);
    els.importerPassword.value = "";
    await verifyStoredSession();
    if (state.isAdmin) await loadDatasets();
  } catch (error) {
    clearStoredAuthSession();
    state.authSession = null;
    state.isAdmin = false;
    updateAuthUi();
    setAuthStatus(error.message, "error");
  }
}

async function signOut() {
  const token = state.authSession?.access_token;
  clearStoredAuthSession();
  state.authSession = null;
  state.isAdmin = false;
  state.datasets = [];
  state.hasDatasetDraft = false;
  state.editingDatasetId = null;
  state.selectedDatasetId = "";
  state.preview = null;
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
}

async function verifyStoredSession() {
  if (!state.authSession?.access_token) {
    state.isAdmin = false;
    updateAuthUi();
    return;
  }

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
    state.isAdmin = await checkAdminRole();
    writeStoredAuthSession(state.authSession);
    updateAuthUi();
  } catch (error) {
    clearStoredAuthSession();
    state.authSession = null;
    state.isAdmin = false;
    updateAuthUi();
    if (error.message) setAuthStatus(error.message, "error");
  }
}

async function checkAdminRole() {
  const response = await fetch(`${APP_CONFIG.supabase.restUrl}/rpc/tide_is_admin`, {
    method: "POST",
    headers: {
      apikey: APP_CONFIG.supabase.anonKey,
      Authorization: `Bearer ${state.authSession.access_token}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  if (!response.ok) {
    throw new Error(`Could not verify admin role: ${response.status} ${response.statusText}${await responseDetail(response)}`);
  }

  return response.json();
}

function updateAuthUi() {
  const signedIn = !!state.authSession?.access_token;
  const unlocked = signedIn && state.isAdmin;
  const email = state.authSession?.user?.email || "signed-in user";

  document.body.classList.toggle("admin-signed-in", unlocked);
  els.importerSignIn.disabled = signedIn;
  els.importerSignOut.disabled = !signedIn;
  els.importerLocked.hidden = unlocked;
  els.importerWorkspace.hidden = !unlocked;

  if (unlocked) {
    setConnectionStatus("Admin connected", "");
    setAuthStatus(`Signed in as ${email}. Edit dataset metadata, then import raw tide rows.`);
    renderSelectedImportTarget();
    return;
  }

  els.runSupabaseImport.disabled = true;
  if (signedIn) {
    setConnectionStatus("Not admin", "status-muted");
    setAuthStatus(`Signed in as ${email}, but this account is not marked as an active Tide Planner admin.`, "error");
  } else {
    setConnectionStatus("Locked", "status-muted");
    setAuthStatus("Sign in with an approved Supabase admin account.");
  }
}

async function loadDatasets(options = {}) {
  if (!state.isAdmin) return;
  if (!options.quiet) setStatus(els.datasetSaveStatus, "Loading tide datasets...");
  renderDatasetLoadingState();

  try {
    state.datasets = await loadDatasetRows();
    state.hasDatasetDraft = false;
    state.editingDatasetId = null;

    if (!state.selectedDatasetId || !state.datasets.some((dataset) => dataset.id === state.selectedDatasetId)) {
      state.selectedDatasetId = state.datasets[0]?.id || "";
    }

    renderDatasetRows();
    renderSelectedImportTarget();
    setStatus(els.datasetSaveStatus, datasetLoadMessage());
  } catch (error) {
    state.datasets = [];
    state.selectedDatasetId = "";
    renderDatasetRows();
    renderSelectedImportTarget();
    setStatus(els.datasetSaveStatus, error.message, "error");
  }
}

async function loadDatasetRows() {
  try {
    const rows = await supabaseRequest("tide_dataset_summary?select=*&order=dataset_name.asc", { requireAuth: true });
    return rows.map((row) => normalizeDatasetRow(row, true));
  } catch {
    const rows = await supabaseRequest("tide_datasets?select=*&order=dataset_name.asc", { requireAuth: true });
    return rows.map((row) => normalizeDatasetRow(row, false));
  }
}

function normalizeDatasetRow(row, summaryAvailable) {
  const id = row.id || row.dataset_id;
  return {
    ...row,
    id,
    dataset_id: id,
    hourly_row_count: Number(row.hourly_row_count || 0),
    event_row_count: Number(row.event_row_count || 0),
    linked_farm_count: Number(row.linked_farm_count || 0),
    summaryAvailable
  };
}

function renderDatasetLoadingState() {
  if (!els.datasetsTableBody) return;
  els.importDatasetCount.textContent = "Loading";
  els.datasetsTableBody.innerHTML = emptyRow(10, "Loading tide datasets from Supabase...");
}

function renderDatasetRows() {
  const rows = state.hasDatasetDraft ? [defaultDataset(), ...state.datasets] : state.datasets;
  els.importDatasetCount.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    els.datasetsTableBody.innerHTML = emptyRow(10, "No tide datasets returned from Supabase.");
    return;
  }

  let displayIndex = 0;
  els.datasetsTableBody.innerHTML = rows.map((row) => renderDatasetRow(row, row.id ? displayIndex++ : -1)).join("");
}

function renderDatasetRow(row, index) {
  const isNew = !row.id;
  const rowId = isNew ? NEW_DATASET_ID : row.id;
  const isEditing = rowId === state.editingDatasetId;
  const isSelected = row.id && row.id === state.selectedDatasetId;
  const rowClass = [isNew ? "draft-row" : "", isEditing || isSelected ? "editing-row" : ""].filter(Boolean).join(" ");
  const region = datasetRegionValue(row);

  if (!isEditing) {
    return `
      <tr data-row-id="${escapeAttribute(rowId)}" class="${rowClass}">
        <td class="id-cell">${datasetIdCell(row, index)}</td>
        <td>${readOnlyCell(row.dataset_name)}</td>
        <td>${readOnlyCell(row.tide_location_name)}</td>
        <td>${readOnlyCell(region)}</td>
        <td>${readOnlyCell(formatCoordinatePair(row.tide_location_latitude, row.tide_location_longitude))}</td>
        <td>${readOnlyCell(row.source_organization || row.source_title)}</td>
        <td>${readOnlyCell(formatStatus(row.verification_status))}</td>
        <td>${readOnlyCell(recordUseLabel(row))}</td>
        <td>${datasetPropertiesCell(row)}</td>
        <td class="save-cell">
          <div class="row-action-stack">
            <button type="button" data-edit-dataset ${state.isAdmin ? "" : "disabled"}>Edit</button>
            <button type="button" data-import-dataset="${escapeAttribute(row.id)}" ${state.isAdmin ? "" : "disabled"}>${row.has_raw_data ? "Import/replace" : "Import data"}</button>
          </div>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-row-id="${escapeAttribute(rowId)}" class="${rowClass}">
      <td class="id-cell">${datasetIdCell(row, index)}</td>
      <td>${textInput("dataset_name", row.dataset_name, "dataset name")}</td>
      <td>${textInput("tide_location_name", row.tide_location_name, "location name")}</td>
      <td>${selectInput("tide_location_region", region, tideRegionOptions(region))}</td>
      <td><div class="inline-editor-pair">
        ${numberInput("tide_location_latitude", row.tide_location_latitude, "latitude", "-90", "90", "0.000001")}
        ${numberInput("tide_location_longitude", row.tide_location_longitude, "longitude", "-180", "180", "0.000001")}
      </div></td>
      <td>${textInput("source_organization", row.source_organization, "source name")}</td>
      <td>${selectInput("verification_status", row.verification_status || "imported_unverified", DATASET_STATUSES.map((value) => [value, formatStatus(value)]))}</td>
      <td>${selectInput("dataset_use", recordUseValue(row), recordUseOptions())}</td>
      <td>${datasetPropertiesCell(row)}</td>
      <td class="save-cell">
        <button type="button" data-save-dataset ${state.isAdmin ? "" : "disabled"}>${isNew ? "Create" : "Save"}</button>
      </td>
    </tr>
  `;
}

async function saveDatasetRow(rowElement) {
  try {
    requireAdmin();
    const id = rowElement.dataset.rowId === NEW_DATASET_ID ? null : rowElement.dataset.rowId;
    const current = id ? state.datasets.find((row) => row.id === id) || {} : {};
    const datasetName = requiredText(rowValue(rowElement, "dataset_name"), "Dataset name");
    const tideLocationName = requiredText(rowValue(rowElement, "tide_location_name"), "Location name");
    const tideLocationRegion = requiredText(rowValue(rowElement, "tide_location_region") || datasetRegionValue(current), "Location region");
    const datasetUse = rowValue(rowElement, "dataset_use");
    const year = yearFromDate(current.valid_from) || new Date().getFullYear();
    const payload = {
      dataset_key: current.dataset_key || normalizeDatasetKey(datasetName),
      dataset_name: datasetName,
      source_organization: nullableText(rowValue(rowElement, "source_organization")),
      source_title: current.source_title || null,
      source_file_name: current.source_file_name || null,
      source_url: current.source_url || null,
      tide_location_key: current.tide_location_key || normalizeDatasetKey(tideLocationName),
      tide_location_name: tideLocationName,
      tide_location_country: countryForRegion(tideLocationRegion),
      tide_location_latitude: nullableNumber(rowValue(rowElement, "tide_location_latitude")),
      tide_location_longitude: nullableNumber(rowValue(rowElement, "tide_location_longitude")),
      timezone: current.timezone || "Africa/Nairobi",
      datum_label: current.datum_label || "Metres above lowest astronomical tide",
      prediction_year: current.prediction_year || year,
      valid_from: current.valid_from || `${year}-01-01`,
      valid_to: current.valid_to || `${year}-12-31`,
      verification_status: rowValue(rowElement, "verification_status") || "imported_unverified",
      has_hourly_predictions: current.has_hourly_predictions === true,
      has_tide_events: current.has_tide_events === true,
      public_visible: datasetUse === "public",
      active: datasetUse !== "inactive"
    };

    if (supportsDatasetRegionField()) {
      payload.tide_location_region = tideLocationRegion;
    }

    setStatus(els.datasetSaveStatus, "Saving dataset metadata...");
    const savedRows = id
      ? await supabaseRequest(`tide_datasets?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: payload,
          prefer: "return=representation",
          requireAuth: true
        })
      : await supabaseRequest("tide_datasets", {
          method: "POST",
          body: payload,
          prefer: "return=representation",
          requireAuth: true
        });

    const saved = savedRows[0] || {};
    state.selectedDatasetId = saved.id || id || state.selectedDatasetId;
    state.hasDatasetDraft = false;
    state.editingDatasetId = null;
    await loadDatasets({ quiet: true });
    setStatus(els.datasetSaveStatus, `${saved.dataset_name || payload.dataset_name} saved.`);
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
  clearPreview(false);
  renderDatasetRows();
  renderSelectedImportTarget();
  setStatus(els.importPreviewStatus, `${dataset.dataset_name} selected for raw CSV import.`);
  if (options.scroll) {
    els.selectedImportTarget.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => els.hourlyCsvInput.focus(), 250);
  }
}

function selectedDataset() {
  return state.datasets.find((dataset) => dataset.id === state.selectedDatasetId) || null;
}

function renderSelectedImportTarget() {
  const dataset = selectedDataset();
  updateImportCommand(dataset);
  els.runSupabaseImport.disabled = true;
  state.preview = null;

  if (!dataset) {
    els.importWriteStatusPill.textContent = "Select dataset";
    els.importWriteStatusPill.className = "status-pill status-muted";
    els.selectedImportTarget.className = "selected-import-target empty-state";
    els.selectedImportTarget.innerHTML = renderDatasetSelectControl("");
    return;
  }

  const rawStatus = rawDataStatusLabel(dataset.raw_data_status);
  els.importWriteStatusPill.textContent = rawStatus;
  els.importWriteStatusPill.className = `status-pill ${dataset.has_raw_data ? "" : "status-muted"}`.trim();
  els.selectedImportTarget.className = "selected-import-target";
  els.selectedImportTarget.innerHTML = `
    ${renderDatasetSelectControl(dataset.id)}
    <span class="selected-import-note">The table Import/replace action also sets this target dataset.</span>
  `;
}

function renderDatasetSelectControl(selectedId) {
  return `
    <label class="selected-import-select">
      Selected dataset
      <select id="selectedImportDatasetSelect" ${state.datasets.length ? "" : "disabled"}>
        ${state.datasets.length
          ? state.datasets.map((dataset) => `
            <option value="${escapeAttribute(dataset.id)}"${dataset.id === selectedId ? " selected" : ""}>
              ${escapeHtml(datasetSelectLabel(dataset))}
            </option>
          `).join("")
          : `<option value="">No datasets loaded</option>`}
      </select>
    </label>
  `;
}

function datasetSelectLabel(dataset) {
  return `${datasetDisplayId(dataset, datasetIndex(dataset))} - ${dataset.dataset_name || "Unnamed dataset"}`;
}

async function previewCsvFiles() {
  if (!state.isAdmin) {
    setStatus(els.importPreviewStatus, "Sign in as an active admin before previewing imports.", "error");
    return;
  }

  const dataset = selectedDataset();
  if (!dataset) {
    setStatus(els.importPreviewStatus, "Choose Import from a dataset row before previewing CSVs.", "error");
    return;
  }

  try {
    setStatus(els.importPreviewStatus, "Reading CSV files...");
    els.runSupabaseImport.disabled = true;
    state.preview = null;

    const hourly = els.hourlyCsvInput.files[0]
      ? await readCsvFile(els.hourlyCsvInput.files[0], "hourly", REQUIRED_COLUMNS.hourly)
      : null;
    const events = els.eventsCsvInput.files[0]
      ? await readCsvFile(els.eventsCsvInput.files[0], "events", REQUIRED_COLUMNS.events)
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

    state.preview = {
      datasetId: dataset.id,
      datasetKey: dataset.dataset_key,
      hourlyRows,
      eventRows,
      issues
    };
    els.runSupabaseImport.disabled = !!issues.length;

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
    els.importPreviewResults.innerHTML = "";
    els.runSupabaseImport.disabled = true;
    state.preview = null;
    setStatus(els.importPreviewStatus, error.message, "error");
  }
}

async function importPreviewToSupabase() {
  const dataset = selectedDataset();
  const preview = state.preview;

  if (!state.isAdmin) {
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
    els.runSupabaseImport.disabled = true;
    setStatus(els.importPreviewStatus, "Importing raw tide rows to Supabase...");

    if (els.replaceExistingRows.checked) {
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
      `<div class="empty-state success-state">Import complete. The Tide datasets card now reflects the Supabase summary view where available.</div>`
    );
  } catch (error) {
    els.runSupabaseImport.disabled = false;
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
              <td>${escapeHtml(shortUuid(row.key))}</td>
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
  const fields = RAW_FIELDS[rowType];
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
  if (BOOLEAN_FIELDS.has(field)) return parseBoolean(text);
  if (NUMBER_FIELDS.has(field)) return Number(text);
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

  await supabaseRequest(`tide_datasets?id=eq.${encodeURIComponent(dataset.id)}`, {
    method: "PATCH",
    body: payload,
    prefer: "return=minimal",
    requireAuth: true
  });
}

function clearPreview(clearFiles) {
  if (clearFiles) els.importPreviewForm.reset();
  state.preview = null;
  els.runSupabaseImport.disabled = true;
  els.importPreviewResults.innerHTML = "";
  setStatus(els.importPreviewStatus, "");
}

async function supabaseRequest(path, options = {}) {
  if (options.requireAuth) requireAdmin();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  const token = state.authSession?.access_token || APP_CONFIG.supabase.anonKey;
  const headers = {
    apikey: APP_CONFIG.supabase.anonKey,
    Authorization: `Bearer ${token}`
  };

  if (options.body) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  try {
    const response = await fetch(`${APP_CONFIG.supabase.restUrl}/${path}`, {
      method: options.method || "GET",
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
      throw new Error("Supabase request timed out. Try a smaller batch or check the connection.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
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

function setConnectionStatus(text, extraClass) {
  els.importerConnectionStatus.textContent = text;
  els.importerConnectionStatus.className = `status-pill ${extraClass || ""}`.trim();
}

function setAuthStatus(message, type = "") {
  els.importerAuthStatus.textContent = message;
  els.importerAuthStatus.dataset.status = type;
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.dataset.status = type;
}

async function responseDetail(response) {
  try {
    const errorBody = await response.json();
    const detail = errorBody.message || errorBody.details || errorBody.hint || errorBody.code || "";
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

function requireAdmin() {
  if (!state.authSession?.access_token || !state.isAdmin) {
    throw new Error("Sign in as an active Tide Planner admin first.");
  }
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function rowValue(rowElement, field) {
  const input = rowElement.querySelector(`[data-field="${field}"]`);
  return input ? input.value : "";
}

function textInput(field, value, placeholder = "") {
  return `<input data-field="${escapeAttribute(field)}" type="text" value="${escapeAttribute(value || "")}" placeholder="${escapeAttribute(placeholder)}">`;
}

function numberInput(field, value, placeholder = "", min = "", max = "", step = "any") {
  return `<input data-field="${escapeAttribute(field)}" type="number" value="${escapeAttribute(value ?? "")}" placeholder="${escapeAttribute(placeholder)}" min="${escapeAttribute(min)}" max="${escapeAttribute(max)}" step="${escapeAttribute(step)}">`;
}

function selectInput(field, value, options) {
  return `
    <select data-field="${escapeAttribute(field)}">
      ${options.map(([optionValue, label]) => `
        <option value="${escapeAttribute(optionValue)}"${String(optionValue) === String(value || "") ? " selected" : ""}>${escapeHtml(label)}</option>
      `).join("")}
    </select>
  `;
}

function readOnlyCell(value) {
  const text = valueOrEmpty(value).trim();
  return text ? `<span class="readonly-value">${escapeHtml(text)}</span>` : `<span class="readonly-muted">-</span>`;
}

function readOnlyStack(values) {
  const lines = values
    .map((value) => valueOrEmpty(value).trim())
    .filter(Boolean);

  if (!lines.length) return readOnlyCell("");
  return `<div class="readonly-stack">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div>`;
}

function datasetPropertiesCell(dataset) {
  if (!dataset.summaryAvailable) {
    return readOnlyStack([
      "Summary SQL not applied",
      `Metadata: ${formatDateRange(dataset.valid_from, dataset.valid_to) || "-"}`
    ]);
  }

  return readOnlyStack([
    `Coverage: ${dataCoverageLabel(dataset)}`,
    `Hourly rows: ${formatInteger(dataset.hourly_row_count)}`,
    `Event rows: ${formatInteger(dataset.event_row_count)}`,
    `Linked farms: ${dataset.linked_farm_names || "None"}`,
    rawDataStatusLabel(dataset.raw_data_status)
  ]);
}

function datasetIdCell(row, index) {
  const label = datasetDisplayId(row, index);
  if (!row.id) return `<span class="muted-cell">${escapeHtml(label)}</span>`;
  return `<a href="${escapeAttribute(dashboardTableUrl("tide_datasets"))}" target="_blank" rel="noopener" title="Supabase UUID: ${escapeAttribute(row.id)}">${escapeHtml(label)}</a>`;
}

function datasetDisplayId(row, index) {
  if (row.dataset_code) return row.dataset_code;
  if (!row.id) return "DID-New";
  return `DID-${String(index + 1).padStart(5, "0")}`;
}

function datasetIndex(dataset) {
  return state.datasets.findIndex((row) => row.id === dataset.id);
}

function datasetLoadMessage() {
  const hasSummary = state.datasets.some((dataset) => dataset.summaryAvailable);
  return hasSummary
    ? `Loaded ${state.datasets.length} dataset row(s) with calculated raw-data summaries.`
    : `Loaded ${state.datasets.length} dataset row(s). Apply the dataset summary SQL to show calculated raw-data status.`;
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
    public_visible: false,
    summaryAvailable: false
  };
}

function supportsDatasetRegionField() {
  return state.datasets.some((row) => Object.prototype.hasOwnProperty.call(row, "tide_location_region"));
}

function datasetRegionValue(row) {
  return row.tide_location_region || row.tide_location_country || "";
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

function recordUseValue(row) {
  if (row.active === false) return "inactive";
  if (row.public_visible === false) return "internal";
  return "public";
}

function recordUseLabel(row) {
  const value = recordUseValue(row);
  if (value === "inactive") return "Inactive";
  if (value === "internal") return "Internal only";
  return "Public";
}

function recordUseOptions() {
  return [
    ["public", "Public"],
    ["internal", "Internal only"],
    ["inactive", "Inactive"]
  ];
}

function dataCoverageLabel(dataset) {
  return formatDateRange(dataset.first_data_local_date, dataset.last_data_local_date) || "No linked raw data";
}

function rawDataStatusLabel(value) {
  const text = String(value || "summary_not_applied");
  if (text === "hourly_and_events") return "Hourly + events linked";
  if (text === "hourly_only") return "Hourly rows linked";
  if (text === "events_only") return "Event rows linked";
  if (text === "no_raw_data") return "No raw data linked";
  return formatStatus(text);
}

function updateImportCommand(dataset) {
  const id = dataset?.id || "<selected_dataset_id>";
  els.importCommand.textContent = `python 04_Superbase\\V0_Tide_Planner\\tools\\tide_dataset_importer.py \`
  --dataset-id ${id} \`
  --hourly-csv path\\to\\tide_hourly_predictions_import.csv \`
  --events-csv path\\to\\tide_events_import.csv \`
  --replace-existing`;
}

function shouldRetryWithoutDatasetId(error) {
  return /dataset_id|on_conflict|schema cache|unique or exclusion/i.test(error?.message || "");
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function nullableNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function yearFromDate(value) {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function normalizeDatasetKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_") || `dataset_${Date.now()}`;
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-GB") : "0";
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

function formatStatus(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function shortUuid(value) {
  return value ? `${String(value).slice(0, 8)}...` : "";
}

function valueOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function dashboardTableUrl(table) {
  const ref = APP_CONFIG.supabase.projectRef;
  return `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}/editor/${encodeURIComponent(table)}`;
}

function writeErrorMessage(error) {
  const message = error?.message || String(error);
  if (/401|403|permission|policy|row-level|JWT/i.test(message)) {
    return `${message}. Raw imports need authenticated Tide Planner admin write policies for tide_events and tide_hourly_predictions.`;
  }
  return message;
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
