import {
  isSeaweedHarvestPlatform,
  requireTidePlatformRole,
  tideBackendContext,
  tideBackendTables
} from "./platform_backend.js?v=20260810-platform-auth-v3";
const PHOTO_BUCKET = "tide-observation-photos";

const state = {
  locations: [],
  datasets: [],
  platformAccess: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  setDefaultDate();

  if (isSeaweedHarvestPlatform()) {
    try {
      state.platformAccess = await requireTidePlatformRole("operator");
      setAuthStatus(`Signed in with ${state.platformAccess.grant.role} observation access.`);
    } catch (error) {
      setAuthStatus(error.message, "error");
      setConnectionStatus("Access required", "status-muted");
      setFormDisabled(true);
      return;
    }
  } else {
    setAuthStatus("Public observation form. No admin sign-in required.");
  }

  await loadFormData();
}

function cacheElements() {
  [
    "observationConnectionStatus",
    "observationAuthStatus",
    "observationWorkspace",
    "observationForm",
    "observationLocation",
    "observationDataset",
    "observerName",
    "observerContact",
    "villageOrGroup",
    "observationDate",
    "startTimeLocal",
    "endTimeLocal",
    "observationFocus",
    "tideStateAtStart",
    "observedLowTimeLocal",
    "observedHighTimeLocal",
    "bedsExposedTimeLocal",
    "bedsCoveredTimeLocal",
    "fixedMeasuringPointUsed",
    "measuringPointDescription",
    "waterHeight",
    "waterHeightUnit",
    "waterMarkRelation",
    "seaweedLinesExposed",
    "farmAccessibleOnFoot",
    "currentStrength",
    "windStrength",
    "seaState",
    "rain",
    "observationPhotos",
    "observationNotes",
    "observationConfidence",
    "clearObservationForm",
    "observationSaveStatus"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.observationLocation.addEventListener("change", syncDatasetToLocation);

  els.clearObservationForm.addEventListener("click", () => {
    els.observationForm.reset();
    setDefaultDate();
    syncDatasetToLocation();
    setStatus("");
  });

  els.observationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitObservation();
  });
}

async function loadFormData() {
  setConnectionStatus("Loading", "status-muted");
  try {
    const tables = tideBackendTables();
    const locationOrder = isSeaweedHarvestPlatform() ? "location_name.asc" : "farm_name.asc";
    const [locations, datasets] = await Promise.all([
      supabaseSelect(tables.locations, `select=*&order=${locationOrder}`),
      supabaseSelect(tables.datasets, "select=*&order=dataset_name.asc")
    ]);
    state.locations = locations;
    state.datasets = datasets;
    renderSelects();
    setConnectionStatus("Form ready", "");
  } catch (error) {
    setConnectionStatus("Supabase error", "status-muted");
    setStatus(error.message, "error");
  }
}

function renderSelects() {
  els.observationLocation.innerHTML = [
    `<option value="">Select farm/location</option>`,
    ...state.locations.map((location) => {
      return `<option value="${escapeAttribute(location.id)}">${escapeHtml(locationLabel(location))}</option>`;
    })
  ].join("");

  els.observationDataset.innerHTML = [
    `<option value="">Use location default / not recorded</option>`,
    ...state.datasets.map((dataset) => {
      return `<option value="${escapeAttribute(dataset.id)}">${escapeHtml(dataset.dataset_name || dataset.dataset_key || dataset.id)}</option>`;
    })
  ].join("");

  syncDatasetToLocation();
}

function syncDatasetToLocation() {
  const location = selectedLocation();
  if (!location) return;
  const datasetId = location.default_tide_dataset_id || datasetIdForKey(location.default_tide_dataset_key);
  if (datasetId) els.observationDataset.value = datasetId;
}

async function submitObservation() {
  try {
    if (isSeaweedHarvestPlatform()) {
      state.platformAccess = await requireTidePlatformRole("operator", true);
    }
    setStatus("Saving observation...");

    const observationId = window.crypto?.randomUUID?.() || fallbackId();
    const files = Array.from(els.observationPhotos.files || []);
    let photoPaths = [];
    let photoUploadError = null;

    if (files.length) {
      try {
        setStatus("Uploading photo evidence...");
        photoPaths = await uploadPhotos(observationId, files);
      } catch (error) {
        photoUploadError = error;
      }
    }

    const payload = buildObservationPayload(files, observationId, photoPaths);
    const savedRows = await supabaseInsert(tideBackendTables().observations, payload);
    const saved = savedRows[0];

    if (photoUploadError) {
      setStatus(`Observation saved, but photo upload failed: ${photoUploadError.message}`, "error");
    } else if (saved?.id && photoPaths.length) {
      setStatus(`Observation saved with ${photoPaths.length} photo(s).`);
    } else {
      setStatus("Observation saved.");
    }

    els.observationForm.reset();
    setDefaultDate();
    syncDatasetToLocation();
  } catch (error) {
    setStatus(writeErrorMessage(error), "error");
  }
}

function buildObservationPayload(files, observationId, photoPaths) {
  const location = selectedLocation();
  const datasetId = nullableText(els.observationDataset.value) || location?.default_tide_dataset_id || null;

  return {
    id: observationId,
    location_id: requiredText(els.observationLocation.value, "Farm/location"),
    dataset_id: datasetId,
    source_type: isSeaweedHarvestPlatform()
      ? "authenticated_electronic_form"
      : "public_electronic_form",
    observer_name: requiredText(els.observerName.value, "Observer name"),
    observer_contact: nullableText(els.observerContact.value),
    village_or_group: nullableText(els.villageOrGroup.value),
    observation_date: requiredText(els.observationDate.value, "Observation date"),
    timezone: location?.timezone || "Africa/Nairobi",
    observation_focus: els.observationFocus.value || "low_tide",
    start_time_local: nullableText(els.startTimeLocal.value),
    end_time_local: nullableText(els.endTimeLocal.value),
    tide_state_at_start: nullableText(els.tideStateAtStart.value),
    observed_low_time_local: nullableText(els.observedLowTimeLocal.value),
    observed_high_time_local: nullableText(els.observedHighTimeLocal.value),
    beds_exposed_time_local: nullableText(els.bedsExposedTimeLocal.value),
    beds_covered_time_local: nullableText(els.bedsCoveredTimeLocal.value),
    fixed_measuring_point_used: nullableBoolean(els.fixedMeasuringPointUsed.value),
    measuring_point_description: nullableText(els.measuringPointDescription.value),
    water_height: nullableNumber(els.waterHeight.value),
    water_height_unit: nullableText(els.waterHeightUnit.value),
    water_mark_relation: nullableText(els.waterMarkRelation.value),
    seaweed_lines_exposed: nullableText(els.seaweedLinesExposed.value),
    farm_accessible_on_foot: nullableText(els.farmAccessibleOnFoot.value),
    current_strength: nullableText(els.currentStrength.value),
    wind_strength: nullableText(els.windStrength.value),
    sea_state: nullableText(els.seaState.value),
    rain: nullableText(els.rain.value),
    photo_taken: files.length > 0,
    photo_file_names: files.map((file) => file.name),
    photo_paths: photoPaths,
    observation_confidence: els.observationConfidence.value || "approximate",
    notes: nullableText(els.observationNotes.value),
    review_status: "raw"
  };
}

async function uploadPhotos(observationId, files) {
  const backend = await tideBackendContext();
  const paths = [];
  for (const file of files) {
    const folder = backend.userId || observationId;
    const fileName = backend.userId
      ? `${observationId}-${Date.now()}-${safeFileName(file.name)}`
      : `${Date.now()}-${safeFileName(file.name)}`;
    const path = `${folder}/${fileName}`;
    const response = await fetchWithTimeout(`${backend.url}/storage/v1/object/${PHOTO_BUCKET}/${encodeURIComponentPath(path)}`, {
      method: "POST",
      headers: {
        apikey: backend.anonKey,
        Authorization: `Bearer ${backend.accessToken}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: file
    }, 60000);

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
    }

    paths.push(path);
  }
  return paths;
}

async function supabaseSelect(table, query) {
  return supabaseRequest(`${table}?${query}`);
}

async function supabaseInsert(table, payload) {
  return supabaseRequest(table, {
    method: "POST",
    body: payload,
    prefer: "return=representation"
  });
}

async function supabaseRequest(path, options = {}) {
  const backend = await tideBackendContext();
  const method = options.method || "GET";
  const timeoutMs = method === "GET" ? 12000 : 45000;
  const headers = {
    apikey: backend.anonKey,
    Authorization: `Bearer ${backend.accessToken}`
  };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetchWithTimeout(`${backend.restUrl}/${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
  }
  if (response.status === 204) return [];
  return response.json();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${Math.round(timeoutMs / 1000)} seconds. Check the connection and try again.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function selectedLocation() {
  return state.locations.find((location) => location.id === els.observationLocation.value) || null;
}

function datasetIdForKey(datasetKey) {
  return state.datasets.find((dataset) => dataset.dataset_key === datasetKey)?.id || "";
}

function locationLabel(location) {
  const parts = [
    location.location_code,
    location.location_name || location.community_name || location.farm_name || location.short_name,
    location.region
  ].filter(Boolean);
  return parts.join(" - ");
}

function setFormDisabled(disabled) {
  if (!els.observationForm) return;
  els.observationForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = disabled;
  });
}

function setDefaultDate() {
  if (!els.observationDate) return;
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  els.observationDate.value = `${year}-${month}-${day}`;
}

function setConnectionStatus(text, extraClass) {
  els.observationConnectionStatus.textContent = text;
  els.observationConnectionStatus.className = `status-pill ${extraClass || ""}`.trim();
}

function setAuthStatus(message, type = "") {
  els.observationAuthStatus.textContent = message;
  els.observationAuthStatus.dataset.status = type;
}

function setStatus(message, type = "") {
  els.observationSaveStatus.textContent = message || "";
  els.observationSaveStatus.dataset.status = type;
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
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  if (value === "") return null;
  return value === "true";
}

function safeFileName(name) {
  return String(name || "photo")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function encodeURIComponentPath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function fallbackId() {
  return `00000000-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, "0")}`;
}

async function responseDetail(response) {
  try {
    const errorBody = await response.json();
    const detail = errorBody.message || errorBody.error || errorBody.details || errorBody.hint || "";
    return detail ? ` - ${detail}` : "";
  } catch {
    const detail = await response.text();
    return detail ? ` - ${detail}` : "";
  }
}

function writeErrorMessage(error) {
  const message = error?.message || String(error);
  if (/401|403|permission|policy|row-level|JWT/i.test(message)) {
    return isSeaweedHarvestPlatform()
      ? `${message}. Confirm this account has Tide operator or administrator access.`
      : `${message}. Apply the public observation form SQL policy before using the no-login form.`;
  }
  return message;
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
