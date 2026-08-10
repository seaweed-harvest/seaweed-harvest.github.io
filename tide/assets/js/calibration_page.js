import { APP_CONFIG } from "./config.js?v=20260718-supabase-fast";
import {
  isSeaweedHarvestPlatform,
  requireTidePlatformRole,
  tideBackendContext,
  tideBackendTables
} from "./platform_backend.js?v=20260810-platform-auth-v3";

const AUTH_SESSION_KEY = "seaweed_tide_planner:admin_auth_session";
const TABLES = tideBackendTables();

const state = {
  authSession: null,
  backend: null,
  locations: [],
  datasets: [],
  calibrations: [],
  summary: [],
  selectedCalibrationId: null,
  requestedLocationId: ""
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  state.requestedLocationId = new URLSearchParams(window.location.search).get("location_id") || "";

  if (isSeaweedHarvestPlatform()) {
    els.calibrationAuthForm.hidden = true;
    try {
      const access = await requireTidePlatformRole("admin");
      state.authSession = access.session;
      state.backend = await tideBackendContext();
      updateAuthUi();
      await loadCalibrationData();
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
  if (state.authSession) await loadCalibrationData();
}

function cacheElements() {
  [
    "calibrationConnectionStatus",
    "calibrationAuthStatus",
    "calibrationAuthForm",
    "calibrationEmail",
    "calibrationPassword",
    "calibrationSignIn",
    "calibrationSignOut",
    "calibrationLocked",
    "calibrationWorkspace",
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
    "calibrationSaveStatus",
    "calibrationRowCount",
    "calibrationTableBody"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.calibrationAuthForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });

  els.calibrationSignOut.addEventListener("click", async () => {
    await signOut();
  });

  els.reloadCalibration.addEventListener("click", () => loadCalibrationData());

  els.calibrationLocation.addEventListener("change", () => {
    loadCalibrationIntoForm(els.calibrationLocation.value);
  });

  els.calibrationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCalibration();
  });

  els.calibrationTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-calibration]");
    if (!button) return;
    loadCalibrationIntoForm(button.dataset.editCalibration);
    els.calibrationForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function loadCalibrationData() {
  setConnectionStatus("Loading", "status-muted");
  setStatus("Loading calibration data...");

  try {
    const [locations, datasets, calibrations, summary] = await Promise.all([
      supabaseSelect(TABLES.locations, `select=*&order=${isSeaweedHarvestPlatform() ? "location_name" : "farm_name"}.asc`),
      supabaseSelect(TABLES.datasets, "select=*&order=dataset_name.asc"),
      supabaseSelect(TABLES.calibrations, "select=*&order=updated_at.desc"),
      supabaseSelect(TABLES.calibrationSummary, "select=*&order=location_name.asc")
    ]);

    state.locations = locations;
    state.datasets = datasets;
    state.calibrations = calibrations;
    state.summary = summary;
    renderSelects();
    renderTable();
    openInitialLocation();
    setConnectionStatus("Admin connected", "");
    setStatus("");
  } catch (error) {
    setConnectionStatus("Supabase error", "status-muted");
    setStatus(writeErrorMessage(error), "error");
  }
}

function renderSelects() {
  els.calibrationLocation.innerHTML = [
    `<option value="">Select location</option>`,
    ...state.locations.map((location) => {
      return `<option value="${escapeAttribute(location.id)}">${escapeHtml(locationLabel(location))}</option>`;
    })
  ].join("");

  els.calibrationDataset.innerHTML = [
    `<option value="">Use location default / not set</option>`,
    ...state.datasets.map((dataset) => {
      return `<option value="${escapeAttribute(dataset.id)}">${escapeHtml(dataset.dataset_name || dataset.dataset_key || dataset.id)}</option>`;
    })
  ].join("");
}

function renderTable() {
  els.calibrationRowCount.textContent = `${state.summary.length} row${state.summary.length === 1 ? "" : "s"}`;
  els.calibrationTableBody.innerHTML = state.summary.length
    ? state.summary.map(renderCalibrationRow).join("")
    : `<tr><td colspan="10" class="empty-state">No farm locations found.</td></tr>`;
}

function renderCalibrationRow(row) {
  const status = calibrationStatus(row.calibration_status);
  const evidence = [
    row.observation_record_number ? `record: ${row.observation_record_number}` : "",
    row.confidence ? `confidence: ${row.confidence}` : "",
    row.last_edited_by ? `edited: ${row.last_edited_by}` : ""
  ].filter(Boolean).join("; ");
  const selectedClass = row.location_id === els.calibrationLocation?.value ? "editing-row" : "";

  return `
    <tr class="${selectedClass}">
      <td>${escapeHtml(row.location_code || shortId(row.location_id))}</td>
      <td><strong>${escapeHtml(row.location_name || "")}</strong></td>
      <td><span class="status-pill calibration-status-pill" data-status="${escapeAttribute(status.value)}">${escapeHtml(status.label)}</span></td>
      <td>${escapeHtml(row.reference_dataset_name || "Location default")}</td>
      <td>${formatMinutes(row.low_tide_time_offset_minutes)}</td>
      <td>${formatMinutes(row.high_tide_time_offset_minutes)}</td>
      <td>${formatNumber(row.height_ratio)}</td>
      <td>${formatMetres(row.height_offset_m)}</td>
      <td>${escapeHtml(evidence || "-")}</td>
      <td><button type="button" data-edit-calibration="${escapeAttribute(row.location_id)}">Edit</button></td>
    </tr>
  `;
}

function openInitialLocation() {
  const locationId = state.requestedLocationId || els.calibrationLocation.value || state.locations[0]?.id || "";
  if (!locationId) return;
  loadCalibrationIntoForm(locationId);
}

function loadCalibrationIntoForm(locationId) {
  els.calibrationLocation.value = locationId || "";
  const location = state.locations.find((item) => item.id === locationId);
  const calibration = activeCalibrationForLocation(locationId);
  state.selectedCalibrationId = calibration?.id || null;

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
  renderTable();
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
      setStatus("No calibration record saved because status is None.");
      return;
    }

    setStatus("Saving calibration...");
    if (state.selectedCalibrationId) {
      await supabasePatch(TABLES.calibrations, state.selectedCalibrationId, payload);
    } else {
      await supabaseInsert(TABLES.calibrations, payload);
    }

    await loadCalibrationData();
    loadCalibrationIntoForm(locationId);
    setStatus("Calibration saved.");
  } catch (error) {
    setStatus(writeErrorMessage(error), "error");
  }
}

function activeCalibrationForLocation(locationId) {
  return state.calibrations.find((row) => row.location_id === locationId && row.active !== false && row.status !== "retired") || null;
}

async function signIn() {
  if (isSeaweedHarvestPlatform()) return;
  const email = requiredText(els.calibrationEmail.value, "Email");
  const password = requiredText(els.calibrationPassword.value, "Password");

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
    els.calibrationPassword.value = "";
    updateAuthUi();
    await loadCalibrationData();
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
    state.authSession.user = await response.json();
    writeStoredAuthSession(state.authSession);
    updateAuthUi();
  } catch {
    clearStoredAuthSession();
    state.authSession = null;
    updateAuthUi();
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

async function supabaseRequest(path, options = {}) {
  if (options.requireAuth) requireSignedIn();
  const method = options.method || "GET";
  const timeoutMs = method === "GET" ? 12000 : 45000;
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
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${Math.round(timeoutMs / 1000)} seconds. Check the connection and try again.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function updateAuthUi() {
  const signedIn = !!state.authSession?.access_token;
  const email = currentUserEmail();
  document.body.classList.toggle("admin-signed-in", signedIn);
  els.calibrationLocked.hidden = signedIn;
  els.calibrationWorkspace.hidden = !signedIn;
  els.calibrationSignIn.disabled = signedIn;
  els.calibrationSignOut.disabled = !signedIn;
  const platform = isSeaweedHarvestPlatform();
  setAuthStatus(
    signedIn
      ? `${platform ? "Seaweed Harvest account" : "Signed in"}: ${email}.`
      : platform
        ? "Tide administrator access is required."
        : "Sign in with an approved Supabase admin account."
  );
  setConnectionStatus(signedIn ? "Admin connected" : "Sign in required", signedIn ? "" : "status-muted");
}

function setConnectionStatus(text, extraClass) {
  els.calibrationConnectionStatus.textContent = text;
  els.calibrationConnectionStatus.className = `status-pill ${extraClass || ""}`.trim();
}

function setAuthStatus(message, type = "") {
  els.calibrationAuthStatus.textContent = message;
  els.calibrationAuthStatus.dataset.status = type;
}

function setStatus(message, type = "") {
  els.calibrationSaveStatus.textContent = message || "";
  els.calibrationSaveStatus.dataset.status = type;
}

function calibrationStatus(statusValue) {
  const value = String(statusValue || "none").toLowerCase();
  if (value === "complete") return { value, label: "Complete" };
  if (value === "incomplete") return { value, label: "Incomplete" };
  if (value === "under_review") return { value, label: "Under Review" };
  return { value: "none", label: "None" };
}

function locationLabel(location) {
  const parts = [
    location.location_code,
    location.location_name || location.farm_name || location.short_name,
    location.region
  ].filter(Boolean);
  return parts.join(" - ");
}

function datasetIdForKey(datasetKey) {
  return state.datasets.find((dataset) => dataset.dataset_key === datasetKey)?.id || "";
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

function requireSignedIn() {
  if (!state.authSession?.access_token) {
    throw new Error("Sign in as an approved admin user before saving.");
  }
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

function nullableInteger(value) {
  const number = nullableNumber(value);
  return number === null ? null : Math.round(number);
}

function valueOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
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
  if (/observation_record_number|last_edited_by|last_edited_at|schema cache/i.test(message)) {
    return `${message}. Apply the calibration direct-edit SQL amendment, then reload this page.`;
  }
  if (/404|Could not find the table/i.test(message)) {
    return `${message}. Apply the 2026-06-15 location observations/calibration SQL first.`;
  }
  if (/401|403|permission|policy|row-level|JWT/i.test(message)) {
    return `${message}. Writes need an authenticated admin policy.`;
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
