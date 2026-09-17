import { authClient } from "./auth_client.js?v=25";
import { formatWeightPerLine } from "./reef_nursery_seaweed_math.js?v=1";

const PHOTO_BUCKET = "reef-seaweed-record-photos";
const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_STORED_PHOTO_BYTES = 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const LAST_PEOPLE_KEY = "reef-site-capture-last-people-v1";
const SAMPLE_ROPE_NUMBERS = Object.freeze([1, 2, 5, 6, 9, 10]);

const CONDITION_ROWS = Object.freeze([
  ["healthy_colour", "Healthy colour"],
  ["uniform_growth", "Uniform growth"],
  ["strong_attachment", "Strong attachment to rope"],
  ["good_branching", "Good branching"],
  ["suitable_transplanting", "Suitable for transplanting"]
]);

const HEALTH_OBSERVATIONS = Object.freeze([
  ["bleaching", "Bleaching"],
  ["ice_ice", "Ice-Ice disease"],
  ["grazing", "Grazing damage"],
  ["broken_thalli", "Broken thalli"],
  ["biofouling", "Biofouling"],
  ["sediment", "Sediment build-up"],
  ["pest", "Pest damage"],
  ["other", "Other"]
]);

const els = {};
const state = {
  context: null,
  sites: [],
  submissionId: createUuid(),
  selectedPhoto: null,
  photoObjectUrl: null,
  sampleRegisterSiteCode: null,
  sampleRegisterDirty: false,
  sampleRegisterLoading: false,
  currentLocation: "",
  saving: false
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  const form = document.getElementById("reefSeaweedForm");
  if (!form || form.dataset.siteCaptureProduction === "true") return;

  try {
    const context = await rpc("ag_reef_site_capture_workspace_context");
    if (!context?.allowed) return;
    state.context = context;
    state.sites = Array.isArray(context.sites) ? context.sites : [];
    renderForm(form);
    cacheElements();
    bindEvents();
    initializeNewCapture({ preservePeople: true, useStoredPeople: true });

    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "seaweed") {
      await waitForTrainingWorkspace();
      openSeaweedWorkspace();
    }
  } catch (error) {
    const status = document.getElementById("reefSiteCaptureStatus") || document.getElementById("reefSeaweedStatus");
    if (status) {
      status.textContent = error.message || "Seaweed Data Collection could not be opened.";
      status.dataset.status = "error";
    }
  }
}

function renderForm(form) {
  form.dataset.siteCaptureProduction = "true";
  form.innerHTML = `
    <fieldset>
      <legend>Seaweed Data Collection</legend>
      <div class="reef-record-meta" aria-label="Record number">
        <span>Record number</span>
        <strong id="reefSiteCaptureRecordNumber">New record</strong>
        <span class="status-pill reef-record-state">Unsaved</span>
      </div>

      <div class="reef-two-column-grid">
        <label>Date
          <input id="reefSiteCaptureDate" type="date" required>
        </label>
        <label>Time
          <input id="reefSiteCaptureTime" type="time" required>
        </label>
      </div>

      <label>Recorder
        <input id="reefSiteCaptureRecorder" type="text" maxlength="160" autocomplete="name" required>
      </label>

      <div class="reef-two-column-grid">
        <label>Monitoring Team
          <select id="reefSiteCaptureTeam" required>
            <option value="">Select monitoring team</option>
            <option value="reefolution">Reefolution</option>
            <option value="pik">PIK</option>
            <option value="community">Community</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label id="reefSiteCaptureOtherTeamField" hidden>Other monitoring team
          <input id="reefSiteCaptureOtherTeam" type="text" maxlength="160" placeholder="Enter team or organisation">
        </label>
      </div>

      <div class="reef-two-column-grid">
        <label>Select Location
          <select id="reefSiteCaptureLocation" required>
            <option value="">Select location</option>
            <option value="mkwiro">Mkwiro</option>
            <option value="tumbe">Tumbe</option>
          </select>
        </label>
        <label>Select Site
          <select id="reefSiteCaptureSite" required disabled>
            <option value="">Select location first</option>
          </select>
        </label>
      </div>

      <section id="reefSiteCaptureWorkspace" class="reef-seaweed-preview-measurements" hidden>
        <div class="reef-panel-heading">
          <div>
            <p class="eyebrow">Selected site</p>
            <h3 id="reefSiteCaptureSiteHeading">Site</h3>
          </div>
        </div>

        <nav id="reefSiteModeTabs" class="reef-site-mode-tabs standard-tabs" role="tablist" aria-label="Selected site data view">
          <button id="reefSiteCaptureTab" class="standard-tab" type="button" role="tab" aria-selected="true">Site Capture</button>
          <button id="reefSampleRopeTab" class="standard-tab" type="button" role="tab" aria-selected="false">Sample Rope Register</button>
        </nav>

        <section id="reefSiteCapturePanel" role="tabpanel" aria-labelledby="reefSiteCaptureTab">
          <div class="reef-form-grid">
            <label>Species
              <select id="reefSiteCaptureSpecies" required>
                <option value="">Select species</option>
                <option value="spinosum">Spinosum</option>
                <option value="cottonii">Cottonii</option>
              </select>
            </label>
            <label>Number of lines
              <input id="reefSiteCaptureLines" type="number" min="1" max="10000" step="1" inputmode="numeric" required>
            </label>
          </div>

          <div class="reef-seaweed-weight-group">
            <label>Seed total weight
              <input id="reefSiteCaptureSeedWeight" type="number" min="0" max="100000" step="0.001" inputmode="decimal">
            </label>
            <label>Unit
              <select id="reefSiteCaptureSeedUnit">
                <option value="kg">kg</option>
                <option value="g">g</option>
              </select>
            </label>
            <div>
              <span class="standard-field-label">Seed weight per line</span>
              <div id="reefSiteCaptureSeedPerLine" class="reef-per-line">—</div>
            </div>
          </div>

          <div class="reef-seaweed-weight-group">
            <label>Harvest total weight
              <input id="reefSiteCaptureHarvestWeight" type="number" min="0" max="100000" step="0.001" inputmode="decimal">
            </label>
            <label>Unit
              <select id="reefSiteCaptureHarvestUnit">
                <option value="kg">kg</option>
                <option value="g">g</option>
              </select>
            </label>
            <div>
              <span class="standard-field-label">Harvest weight per line</span>
              <div id="reefSiteCaptureHarvestPerLine" class="reef-per-line">—</div>
            </div>
          </div>
        </section>

        <section id="reefSampleRopePanel" class="reef-sample-rope-panel" role="tabpanel" aria-labelledby="reefSampleRopeTab" hidden>
          <div class="reef-sample-rope-toolbar">
            <div>
              <h4>Sample Rope Register</h4>
              <p id="reefSampleRopeSiteLabel" class="reef-help"></p>
            </div>
            <div class="reef-sample-rope-save-wrap">
              <button id="reefSampleRopeSave" type="button">Save</button>
              <span id="reefSampleRopeStatus" class="reef-help" aria-live="polite"></span>
            </div>
          </div>
          <div class="reef-sample-rope-table-wrap">
            <table class="reef-sample-rope-table">
              <thead>
                <tr>
                  <th rowspan="2">Sample Rope</th>
                  <th rowspan="2">Species</th>
                  <th rowspan="2">Date Seeded</th>
                  <th rowspan="2">Rope Weight (kg)</th>
                  <th rowspan="2">Initial Weight<br>(seeded rope) (kg)</th>
                  <th colspan="3">Current Weight (kg)</th>
                  <th rowspan="2"></th>
                </tr>
                <tr><th>Wk2</th><th>Wk4</th><th>Wk6</th></tr>
              </thead>
              <tbody>${SAMPLE_ROPE_NUMBERS.map(sampleRopeRowMarkup).join("")}</tbody>
            </table>
          </div>
        </section>

        <details id="reefSiteCaptureHealthEnvironment" class="reef-health-environment">
          <summary>Seaweed Health and Environment Observations</summary>
          <div class="reef-health-environment-body">
            <section class="reef-health-block">
              <h4>Seaweed condition</h4>
              <div class="reef-condition-matrix" role="table" aria-label="Seaweed condition assessment">
                <div class="reef-condition-header" role="row">
                  <div role="columnheader">Indicator</div>
                  <div role="columnheader">Excellent</div>
                  <div role="columnheader">Good</div>
                  <div role="columnheader">Fair</div>
                  <div role="columnheader">Poor</div>
                  <div role="columnheader">Remarks</div>
                </div>
                ${CONDITION_ROWS.map(conditionRowMarkup).join("")}
              </div>
            </section>

            <section class="reef-health-block">
              <h4>Health observations</h4>
              <div class="reef-health-observation-box" role="group" aria-label="Seaweed health observations">
                ${HEALTH_OBSERVATIONS.map(healthObservationMarkup).join("")}
              </div>
            </section>

            <section class="reef-health-block">
              <h4>Environment</h4>
              <div class="reef-observation-rows">
                <label class="reef-observation-row">
                  <span>Water temperature (°C)</span>
                  <input id="reefEnvironmentWaterTemperature" type="number" step="0.1" inputmode="decimal">
                </label>
                <label class="reef-observation-row">
                  <span>Water clarity</span>
                  <select id="reefEnvironmentWaterClarity">
                    <option value="">—</option><option value="clear">Clear</option><option value="moderate">Moderate</option><option value="poor">Poor</option>
                  </select>
                </label>
                <label class="reef-observation-row">
                  <span>Tide</span>
                  <select id="reefEnvironmentTide">
                    <option value="">—</option><option value="low">Low</option><option value="rising">Rising</option><option value="high">High</option><option value="falling">Falling</option>
                  </select>
                </label>
                <label class="reef-observation-row">
                  <span>Weather</span>
                  <select id="reefEnvironmentWeather">
                    <option value="">—</option><option value="clear">Clear</option><option value="cloudy">Cloudy</option><option value="rain">Rain</option><option value="windy">Windy</option>
                  </select>
                </label>
                <label class="reef-observation-row">
                  <span>Current strength</span>
                  <select id="reefEnvironmentCurrentStrength">
                    <option value="">—</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="strong">Strong</option>
                  </select>
                </label>
              </div>
            </section>
          </div>
        </details>

        <label class="reef-seaweed-general-notes">General notes
          <textarea id="reefSiteCaptureGeneralNotes" rows="3" maxlength="3000"></textarea>
        </label>

        <fieldset class="reef-inspection-subgroup reef-seaweed-photo-fieldset">
          <legend>Photo</legend>
          <div class="reef-seaweed-photo-actions">
            <button id="reefSiteCaptureTakePhoto" class="secondary-action" type="button">Take photo</button>
            <button id="reefSiteCaptureChoosePhoto" class="secondary-action" type="button">Choose photo</button>
          </div>
          <input id="reefSiteCaptureCameraInput" class="reef-hidden-file" type="file" accept="image/*" capture="environment">
          <input id="reefSiteCaptureGalleryInput" class="reef-hidden-file" type="file" accept="image/*">
          <p id="reefSiteCapturePhotoStatus" class="reef-photo-status">No photo selected.</p>
          <div id="reefSiteCapturePhotoPreview" class="reef-seaweed-photo-preview" hidden>
            <img id="reefSiteCapturePhotoImage" alt="Seaweed record photo preview">
            <div>
              <strong id="reefSiteCapturePhotoName"></strong>
              <span id="reefSiteCapturePhotoMeta"></span>
            </div>
          </div>
        </fieldset>
      </section>
    </fieldset>

    <div class="button-row reef-seaweed-actions standard-form-actions">
      <button id="submitReefSiteCapture" type="submit">Submit Record</button>
      <button id="clearReefSiteCapture" type="button">Clear</button>
      <p id="reefSiteCaptureStatus" class="admin-status reef-status" aria-live="polite"></p>
    </div>
  `;

  if (!document.getElementById("reefSiteCaptureProductionStyle")) {
    const style = document.createElement("style");
    style.id = "reefSiteCaptureProductionStyle";
    style.textContent = productionStyles();
    document.head.appendChild(style);
  }
}

function cacheElements() {
  [
    "reefSeaweedForm", "reefSiteCaptureRecordNumber", "reefSiteCaptureDate", "reefSiteCaptureTime",
    "reefSiteCaptureRecorder", "reefSiteCaptureTeam", "reefSiteCaptureOtherTeamField", "reefSiteCaptureOtherTeam",
    "reefSiteCaptureLocation", "reefSiteCaptureSite", "reefSiteCaptureWorkspace", "reefSiteCaptureSiteHeading",
    "reefSiteCaptureTab", "reefSampleRopeTab", "reefSiteCapturePanel", "reefSampleRopePanel",
    "reefSiteCaptureSpecies", "reefSiteCaptureLines", "reefSiteCaptureSeedWeight", "reefSiteCaptureSeedUnit",
    "reefSiteCaptureSeedPerLine", "reefSiteCaptureHarvestWeight", "reefSiteCaptureHarvestUnit", "reefSiteCaptureHarvestPerLine",
    "reefSampleRopeSave", "reefSampleRopeStatus", "reefSampleRopeSiteLabel",
    "reefSiteCaptureHealthEnvironment", "reefEnvironmentWaterTemperature", "reefEnvironmentWaterClarity",
    "reefEnvironmentTide", "reefEnvironmentWeather", "reefEnvironmentCurrentStrength", "reefSiteCaptureGeneralNotes",
    "reefSiteCaptureTakePhoto", "reefSiteCaptureChoosePhoto", "reefSiteCaptureCameraInput", "reefSiteCaptureGalleryInput",
    "reefSiteCapturePhotoStatus", "reefSiteCapturePhotoPreview", "reefSiteCapturePhotoImage", "reefSiteCapturePhotoName",
    "reefSiteCapturePhotoMeta", "submitReefSiteCapture", "clearReefSiteCapture", "reefSiteCaptureStatus",
    "reefTrainingWorkspace"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.reefSiteCaptureTeam.addEventListener("change", syncOtherTeam);
  els.reefSiteCaptureLocation.addEventListener("change", () => void handleLocationChange());
  els.reefSiteCaptureSite.addEventListener("change", () => void handleSiteChange());
  els.reefSiteCaptureTab.addEventListener("click", () => setSiteMode("capture"));
  els.reefSampleRopeTab.addEventListener("click", () => setSiteMode("sample"));

  [
    els.reefSiteCaptureLines,
    els.reefSiteCaptureSeedWeight,
    els.reefSiteCaptureSeedUnit,
    els.reefSiteCaptureHarvestWeight,
    els.reefSiteCaptureHarvestUnit
  ].forEach((control) => {
    control.addEventListener("input", syncWeights);
    control.addEventListener("change", syncWeights);
  });

  els.reefSampleRopePanel.addEventListener("input", markSampleRegisterDirty);
  els.reefSampleRopePanel.addEventListener("change", markSampleRegisterDirty);
  els.reefSampleRopePanel.addEventListener("click", handleSampleRopeClick);
  els.reefSampleRopeSave.addEventListener("click", () => void saveSampleRopeRegister());

  els.reefSiteCaptureTakePhoto.addEventListener("click", () => {
    els.reefSiteCaptureCameraInput.value = "";
    els.reefSiteCaptureCameraInput.click();
  });
  els.reefSiteCaptureChoosePhoto.addEventListener("click", () => {
    els.reefSiteCaptureGalleryInput.value = "";
    els.reefSiteCaptureGalleryInput.click();
  });
  els.reefSiteCaptureCameraInput.addEventListener("change", () => selectPhoto(els.reefSiteCaptureCameraInput.files?.[0]));
  els.reefSiteCaptureGalleryInput.addEventListener("change", () => selectPhoto(els.reefSiteCaptureGalleryInput.files?.[0]));

  els.reefSeaweedForm.addEventListener("submit", submitSiteCapture);
  els.clearReefSiteCapture.addEventListener("click", () => void clearCapture());
  window.addEventListener("beforeunload", (event) => {
    if (!state.sampleRegisterDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function handleLocationChange() {
  const requestedLocation = els.reefSiteCaptureLocation.value;
  if (!await saveDirtyRegisterBeforeLeaving()) {
    els.reefSiteCaptureLocation.value = state.currentLocation;
    return;
  }

  state.currentLocation = requestedLocation;
  populateSites(requestedLocation);
  clearSelectedSiteWorkspace();
}

async function handleSiteChange() {
  const requestedSite = els.reefSiteCaptureSite.value;
  if (!await saveDirtyRegisterBeforeLeaving()) {
    els.reefSiteCaptureSite.value = state.sampleRegisterSiteCode || "";
    return;
  }

  if (!requestedSite) {
    clearSelectedSiteWorkspace();
    return;
  }

  const selected = siteByCode(requestedSite);
  if (!selected) {
    clearSelectedSiteWorkspace();
    return setStatus("Selected site is unavailable.", "error");
  }

  setSiteMode("capture");
  els.reefSiteCaptureWorkspace.hidden = false;
  els.reefSiteCaptureSiteHeading.textContent = siteLabel(selected);
  els.reefSampleRopeSiteLabel.textContent = `Selected site: ${siteLabel(selected)}`;
  clearSiteCaptureMeasurements();
  clearHealthEnvironment();
  clearPhoto();
  try {
    await loadSampleRopeRegister(requestedSite);
  } catch (error) {
    setStatus(error.message || "Sample Rope Register could not be loaded for this site.", "error");
  }
}

async function saveDirtyRegisterBeforeLeaving() {
  if (!state.sampleRegisterDirty || !state.sampleRegisterSiteCode) return true;
  try {
    await saveSampleRopeRegister({ siteCode: state.sampleRegisterSiteCode, silent: true });
    return true;
  } catch (error) {
    setSampleStatus(error.message || "Sample Rope changes could not be saved.", "error");
    setStatus("Sample Rope changes were not saved. The site was not changed.", "error");
    return false;
  }
}

function populateSites(location) {
  const sites = state.sites.filter((item) => item.location === location);
  els.reefSiteCaptureSite.innerHTML = sites.length
    ? `<option value="">Select site</option>${sites.map((item) => `<option value="${escapeHtml(item.site_code)}">${escapeHtml(siteLabel(item))}</option>`).join("")}`
    : '<option value="">Select location first</option>';
  els.reefSiteCaptureSite.disabled = !sites.length;
}

function clearSelectedSiteWorkspace() {
  els.reefSiteCaptureWorkspace.hidden = true;
  els.reefSiteCaptureSiteHeading.textContent = "Site";
  els.reefSampleRopeSiteLabel.textContent = "";
  applySampleRegister({ rows: [] });
  state.sampleRegisterSiteCode = null;
  state.sampleRegisterDirty = false;
  setSampleStatus("");
  setSiteMode("capture");
}

function setSiteMode(mode) {
  const sample = mode === "sample";
  els.reefSiteCaptureTab.setAttribute("aria-selected", String(!sample));
  els.reefSampleRopeTab.setAttribute("aria-selected", String(sample));
  els.reefSiteCapturePanel.hidden = sample;
  els.reefSampleRopePanel.hidden = !sample;
}

async function loadSampleRopeRegister(siteCode) {
  state.sampleRegisterLoading = true;
  setSampleControlsDisabled(true);
  setSampleStatus("Loading…");
  try {
    const register = await rpc("ag_reef_sample_rope_register", { p_site_code: siteCode });
    if (els.reefSiteCaptureSite.value !== siteCode) return;
    applySampleRegister(register);
    state.sampleRegisterSiteCode = siteCode;
    state.sampleRegisterDirty = false;
    setSampleStatus("Saved data loaded.");
  } catch (error) {
    state.sampleRegisterSiteCode = null;
    state.sampleRegisterDirty = false;
    applySampleRegister({ rows: [] });
    setSampleStatus(error.message || "Sample Rope Register could not be loaded.", "error");
    throw error;
  } finally {
    state.sampleRegisterLoading = false;
    setSampleControlsDisabled(false);
  }
}

async function saveSampleRopeRegister({ siteCode = null, silent = false } = {}) {
  const targetSite = siteCode || els.reefSiteCaptureSite.value;
  if (!targetSite) throw new Error("Select a site before saving the Sample Rope Register.");
  if (state.sampleRegisterLoading) throw new Error("Wait for the Sample Rope Register to finish loading.");

  const rows = collectSampleRopeRows();
  if (!silent) setSampleStatus("Saving…");
  els.reefSampleRopeSave.disabled = true;
  try {
    const register = await rpc("ag_reef_sample_rope_register_save", {
      p_site_code: targetSite,
      p_rows: rows
    });
    if (els.reefSiteCaptureSite.value === targetSite) {
      applySampleRegister(register);
      state.sampleRegisterSiteCode = targetSite;
      state.sampleRegisterDirty = false;
      setSampleStatus("Saved to Supabase.", "success");
    }
    return register;
  } catch (error) {
    if (!silent) setSampleStatus(error.message || "Sample Rope Register could not be saved.", "error");
    throw error;
  } finally {
    els.reefSampleRopeSave.disabled = false;
  }
}

async function handleSampleRopeClick(event) {
  const button = event.target.closest("[data-start-new-rope]");
  if (!button) return;
  const ropeNumber = Number(button.dataset.startNewRope);
  const siteCode = els.reefSiteCaptureSite.value;
  if (!siteCode || !SAMPLE_ROPE_NUMBERS.includes(ropeNumber)) return;

  const confirmed = window.confirm(
    `Start a new record for Rope ${ropeNumber}? The current cycle will be retained in history and a new blank cycle will be created.`
  );
  if (!confirmed) return;

  setSampleControlsDisabled(true);
  setSampleStatus(`Starting a new cycle for Rope ${ropeNumber}…`);
  try {
    if (state.sampleRegisterDirty) {
      await saveSampleRopeRegister({ siteCode, silent: true });
    }
    const result = await rpc("ag_reef_sample_rope_start_new", {
      p_site_code: siteCode,
      p_rope_number: ropeNumber
    });
    applySampleRegister(result.register || { rows: [] });
    state.sampleRegisterSiteCode = siteCode;
    state.sampleRegisterDirty = false;
    setSampleStatus(`Rope ${ropeNumber} started as Cycle ${result.new_cycle_number}. Previous cycle retained.`, "success");
  } catch (error) {
    setSampleStatus(error.message || `Rope ${ropeNumber} could not be started.`, "error");
  } finally {
    setSampleControlsDisabled(false);
  }
}

function collectSampleRopeRows() {
  return [...els.reefSampleRopePanel.querySelectorAll("[data-sample-rope-row]")].map((row) => {
    const value = (field) => row.querySelector(`[data-rope-field="${field}"]`)?.value || "";
    return {
      rope_number: Number(row.dataset.ropeNumber),
      species: value("species") || null,
      date_seeded: value("date_seeded") || null,
      rope_weight_kg: value("rope_weight_kg") || null,
      initial_weight_kg: value("initial_weight_kg") || null,
      week_2_kg: value("week_2_kg") || null,
      week_4_kg: value("week_4_kg") || null,
      week_6_kg: value("week_6_kg") || null
    };
  });
}

function applySampleRegister(register) {
  const rows = new Map((Array.isArray(register?.rows) ? register.rows : []).map((row) => [Number(row.rope_number), row]));
  els.reefSampleRopePanel.querySelectorAll("[data-sample-rope-row]").forEach((row) => {
    const ropeNumber = Number(row.dataset.ropeNumber);
    const data = rows.get(ropeNumber) || {};
    for (const field of ["species", "date_seeded", "rope_weight_kg", "initial_weight_kg", "week_2_kg", "week_4_kg", "week_6_kg"]) {
      const control = row.querySelector(`[data-rope-field="${field}"]`);
      if (control) control.value = data[field] ?? "";
    }
    row.dataset.cycleNumber = data.cycle_number ?? "";
    row.dataset.historyCount = data.history_count ?? 0;
  });
}

function markSampleRegisterDirty(event) {
  if (!event.target.closest("[data-sample-rope-row]")) return;
  state.sampleRegisterDirty = true;
  setSampleStatus("Unsaved changes");
}

function setSampleControlsDisabled(disabled) {
  els.reefSampleRopeSave.disabled = disabled;
  els.reefSampleRopePanel.querySelectorAll("input, select, button").forEach((control) => {
    if (control === els.reefSampleRopeSave) return;
    control.disabled = disabled;
  });
}

async function submitSiteCapture(event) {
  event.preventDefault();
  if (state.saving) return;

  const capture = validatedCapture();
  if (!capture) return;

  setSaving(true);
  setStatus("Submitting Site Capture…");
  let saved = null;
  try {
    if (state.sampleRegisterSiteCode !== capture.site_code) {
      await loadSampleRopeRegister(capture.site_code);
    }

    const sampleRows = collectSampleRopeRows();
    saved = await rpc("ag_reef_site_capture_workspace_submit", {
      p_submission_id: state.submissionId,
      p_capture: capture,
      p_sample_rope_rows: sampleRows
    });

    state.sampleRegisterDirty = false;
    if (state.selectedPhoto) await saveSelectedPhoto(saved.capture_id);

    rememberPeople();
    const recordNumber = saved.record_number || "Site Capture";
    initializeNewCapture({ preservePeople: true, useStoredPeople: false });
    setStatus(`${recordNumber} submitted. Sample Rope entries for ${saved.site_code} are saved.`, "success");
  } catch (error) {
    if (saved?.capture_id && state.selectedPhoto) {
      setStatus(
        `${saved.record_number || "Site Capture"} is saved, but the photo could not be uploaded. Click Submit Record again to retry the photo. ${error.message || ""}`.trim(),
        "error"
      );
    } else {
      setStatus(error.message || "The Site Capture could not be submitted.", "error");
    }
  } finally {
    setSaving(false);
  }
}

function validatedCapture() {
  const required = [
    [els.reefSiteCaptureDate, "Date"],
    [els.reefSiteCaptureTime, "Time"],
    [els.reefSiteCaptureRecorder, "Recorder"],
    [els.reefSiteCaptureTeam, "Monitoring Team"],
    [els.reefSiteCaptureLocation, "Location"],
    [els.reefSiteCaptureSite, "Site"],
    [els.reefSiteCaptureSpecies, "Species"],
    [els.reefSiteCaptureLines, "Number of lines"]
  ];
  for (const [control, label] of required) {
    if (String(control.value || "").trim()) continue;
    return validationError(`${label} is required.`, control);
  }

  if (els.reefSiteCaptureTeam.value === "other" && !els.reefSiteCaptureOtherTeam.value.trim()) {
    return validationError("Enter the Other monitoring team.", els.reefSiteCaptureOtherTeam);
  }

  const lineCount = Number(els.reefSiteCaptureLines.value);
  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 10000) {
    return validationError("Number of lines must be between 1 and 10000.", els.reefSiteCaptureLines);
  }

  const seedWeight = nullablePositiveNumber(els.reefSiteCaptureSeedWeight.value);
  const harvestWeight = nullablePositiveNumber(els.reefSiteCaptureHarvestWeight.value);
  if (els.reefSiteCaptureSeedWeight.value !== "" && seedWeight === null) {
    return validationError("Enter a valid seed total weight.", els.reefSiteCaptureSeedWeight);
  }
  if (els.reefSiteCaptureHarvestWeight.value !== "" && harvestWeight === null) {
    return validationError("Enter a valid harvest total weight.", els.reefSiteCaptureHarvestWeight);
  }
  if (seedWeight === null && harvestWeight === null) {
    return validationError("Enter a seed or harvest total weight.", els.reefSiteCaptureSeedWeight);
  }

  const selected = siteByCode(els.reefSiteCaptureSite.value);
  if (!selected || selected.location !== els.reefSiteCaptureLocation.value) {
    return validationError("Select a site that belongs to the selected location.", els.reefSiteCaptureSite);
  }

  return {
    observed_at: `${els.reefSiteCaptureDate.value}T${els.reefSiteCaptureTime.value}:00+03:00`,
    recorded_by_name: els.reefSiteCaptureRecorder.value.trim(),
    monitoring_team: els.reefSiteCaptureTeam.value,
    monitoring_team_other: els.reefSiteCaptureTeam.value === "other" ? els.reefSiteCaptureOtherTeam.value.trim() : null,
    location: els.reefSiteCaptureLocation.value,
    site_code: els.reefSiteCaptureSite.value,
    species: els.reefSiteCaptureSpecies.value,
    line_count: lineCount,
    seed_weight_value: seedWeight,
    seed_weight_unit: els.reefSiteCaptureSeedUnit.value || "kg",
    harvest_weight_value: harvestWeight,
    harvest_weight_unit: els.reefSiteCaptureHarvestUnit.value || "kg",
    health_environment: collectHealthEnvironment(),
    general_notes: textOrNull(els.reefSiteCaptureGeneralNotes.value)
  };
}

function collectHealthEnvironment() {
  const condition = {};
  for (const [key] of CONDITION_ROWS) {
    const rating = document.querySelector(`input[name="quality_${key}"]:checked`)?.value || null;
    const note = textOrNull(document.querySelector(`[name="quality_${key}_note"]`)?.value);
    if (rating || note) condition[key] = { rating, note };
  }

  const observations = HEALTH_OBSERVATIONS
    .filter(([key]) => document.querySelector(`[name="health_${key}"]`)?.checked)
    .map(([key]) => key);

  const environment = {
    water_temperature_c: nullableNumber(els.reefEnvironmentWaterTemperature.value),
    water_clarity: textOrNull(els.reefEnvironmentWaterClarity.value),
    tide: textOrNull(els.reefEnvironmentTide.value),
    weather: textOrNull(els.reefEnvironmentWeather.value),
    current_strength: textOrNull(els.reefEnvironmentCurrentStrength.value)
  };

  const hasEnvironment = Object.values(environment).some((value) => value !== null);
  const result = {};
  if (Object.keys(condition).length) result.condition = condition;
  if (observations.length) result.health_observations = observations;
  if (hasEnvironment) result.environment = environment;
  return result;
}

async function clearCapture() {
  if (!await saveDirtyRegisterBeforeLeaving()) return;
  initializeNewCapture({ preservePeople: false, useStoredPeople: false });
  setStatus("");
}

function initializeNewCapture({ preservePeople = false, useStoredPeople = false } = {}) {
  const people = preservePeople
    ? {
        recorder: els.reefSiteCaptureRecorder?.value || "",
        team: els.reefSiteCaptureTeam?.value || "",
        otherTeam: els.reefSiteCaptureOtherTeam?.value || ""
      }
    : useStoredPeople
      ? readRememberedPeople()
      : { recorder: "", team: "", otherTeam: "" };

  if (!people.recorder && useStoredPeople && state.context?.profile_name) {
    people.recorder = state.context.profile_name;
  }

  state.submissionId = createUuid();
  state.sampleRegisterSiteCode = null;
  state.sampleRegisterDirty = false;
  state.sampleRegisterLoading = false;
  state.currentLocation = "";
  clearPhoto();

  const now = kenyaNow();
  els.reefSiteCaptureRecordNumber.textContent = "New record";
  els.reefSiteCaptureDate.value = now.date;
  els.reefSiteCaptureTime.value = now.time;
  els.reefSiteCaptureRecorder.value = people.recorder || "";
  els.reefSiteCaptureTeam.value = people.team || "";
  els.reefSiteCaptureOtherTeam.value = people.otherTeam || "";
  syncOtherTeam();
  els.reefSiteCaptureLocation.value = "";
  populateSites("");
  clearSelectedSiteWorkspace();
  clearSiteCaptureMeasurements();
  clearHealthEnvironment();
  syncWeights();
}

function clearSiteCaptureMeasurements() {
  els.reefSiteCaptureSpecies.value = "";
  els.reefSiteCaptureLines.value = "";
  els.reefSiteCaptureSeedWeight.value = "";
  els.reefSiteCaptureSeedUnit.value = "kg";
  els.reefSiteCaptureHarvestWeight.value = "";
  els.reefSiteCaptureHarvestUnit.value = "kg";
  els.reefSiteCaptureGeneralNotes.value = "";
  syncWeights();
}

function clearHealthEnvironment() {
  els.reefSiteCaptureHealthEnvironment.open = false;
  document.querySelectorAll('#reefSiteCaptureHealthEnvironment input[type="radio"], #reefSiteCaptureHealthEnvironment input[type="checkbox"]').forEach((input) => {
    input.checked = false;
  });
  document.querySelectorAll('#reefSiteCaptureHealthEnvironment input[type="text"], #reefSiteCaptureHealthEnvironment input[type="number"], #reefSiteCaptureHealthEnvironment select').forEach((control) => {
    control.value = "";
  });
}

function syncOtherTeam() {
  const show = els.reefSiteCaptureTeam.value === "other";
  els.reefSiteCaptureOtherTeamField.hidden = !show;
  els.reefSiteCaptureOtherTeam.required = show;
  if (!show) els.reefSiteCaptureOtherTeam.value = "";
}

function syncWeights() {
  const lines = Number(els.reefSiteCaptureLines.value);
  els.reefSiteCaptureSeedPerLine.textContent = formatWeightPerLine(
    els.reefSiteCaptureSeedWeight.value,
    els.reefSiteCaptureSeedUnit.value,
    lines
  );
  els.reefSiteCaptureHarvestPerLine.textContent = formatWeightPerLine(
    els.reefSiteCaptureHarvestWeight.value,
    els.reefSiteCaptureHarvestUnit.value,
    lines
  );
}

function selectPhoto(file) {
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) return setPhotoStatus("Select an image file.", "error");
  if (file.size > MAX_SOURCE_PHOTO_BYTES) return setPhotoStatus("The selected photo is larger than 25 MB.", "error");
  state.selectedPhoto = file;
  renderPhoto();
}

function renderPhoto() {
  releasePhotoObjectUrl();
  if (!state.selectedPhoto) {
    els.reefSiteCapturePhotoImage.removeAttribute("src");
    els.reefSiteCapturePhotoName.textContent = "";
    els.reefSiteCapturePhotoMeta.textContent = "";
    els.reefSiteCapturePhotoPreview.hidden = true;
    return setPhotoStatus("No photo selected.");
  }

  state.photoObjectUrl = URL.createObjectURL(state.selectedPhoto);
  els.reefSiteCapturePhotoImage.src = state.photoObjectUrl;
  els.reefSiteCapturePhotoName.textContent = state.selectedPhoto.name || "Selected photo";
  els.reefSiteCapturePhotoMeta.textContent = `${formatBytes(state.selectedPhoto.size)} — will be compressed to JPEG before upload`;
  els.reefSiteCapturePhotoPreview.hidden = false;
  setPhotoStatus("Photo selected.");
}

function clearPhoto() {
  state.selectedPhoto = null;
  if (els.reefSiteCaptureCameraInput) els.reefSiteCaptureCameraInput.value = "";
  if (els.reefSiteCaptureGalleryInput) els.reefSiteCaptureGalleryInput.value = "";
  if (els.reefSiteCapturePhotoPreview) renderPhoto();
}

function releasePhotoObjectUrl() {
  if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
  state.photoObjectUrl = null;
}

async function saveSelectedPhoto(captureId) {
  if (!state.selectedPhoto) return null;
  setStatus("Compressing photo…");
  const sourceName = state.selectedPhoto.name || "photo.jpg";
  const blob = await preparePhoto(state.selectedPhoto);
  if (blob.size > MAX_STORED_PHOTO_BYTES) throw new Error("The photo could not be compressed below 1 MB.");

  const path = `site-captures/${captureId}/photo.jpg`;
  const { error: uploadError } = await authClient.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { cacheControl: "3600", contentType: "image/jpeg", upsert: true });
  if (uploadError) throw uploadError;

  const attached = await rpc("ag_reef_site_capture_workspace_attach_photo", {
    p_capture_id: captureId,
    p_storage_path: path,
    p_original_name: sourceName,
    p_byte_size: blob.size,
    p_content_type: "image/jpeg"
  });
  state.selectedPhoto = null;
  return attached;
}

async function preparePhoto(file) {
  const source = await decodeImage(file);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("The selected photo could not be decoded.");

  let scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(sourceWidth, sourceHeight));
  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(source, 0, 0, width, height);

    for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
      const blob = await canvasToJpeg(canvas, quality);
      if (blob.size <= MAX_STORED_PHOTO_BYTES) {
        source.close?.();
        return blob;
      }
    }
    scale *= 0.78;
  }
  source.close?.();
  throw new Error("The selected photo could not be compressed below 1 MB.");
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Photo compression failed."));
    }, "image/jpeg", quality);
  });
}

function setSaving(disabled) {
  state.saving = disabled;
  els.submitReefSiteCapture.disabled = disabled;
  els.clearReefSiteCapture.disabled = disabled;
  els.reefSiteCaptureTakePhoto.disabled = disabled;
  els.reefSiteCaptureChoosePhoto.disabled = disabled;
  els.reefSampleRopeSave.disabled = disabled || state.sampleRegisterLoading;
}

function setStatus(message, kind = "") {
  els.reefSiteCaptureStatus.textContent = message || "";
  if (kind) els.reefSiteCaptureStatus.dataset.status = kind;
  else delete els.reefSiteCaptureStatus.dataset.status;
}

function setSampleStatus(message, kind = "") {
  els.reefSampleRopeStatus.textContent = message || "";
  if (kind) els.reefSampleRopeStatus.dataset.status = kind;
  else delete els.reefSampleRopeStatus.dataset.status;
}

function setPhotoStatus(message, kind = "") {
  els.reefSiteCapturePhotoStatus.textContent = message || "";
  if (kind) els.reefSiteCapturePhotoStatus.dataset.status = kind;
  else delete els.reefSiteCapturePhotoStatus.dataset.status;
}

function validationError(message, control = null) {
  setStatus(message, "error");
  control?.focus?.();
  return null;
}

function rememberPeople() {
  try {
    localStorage.setItem(LAST_PEOPLE_KEY, JSON.stringify({
      recorder: els.reefSiteCaptureRecorder.value.trim(),
      team: els.reefSiteCaptureTeam.value,
      otherTeam: els.reefSiteCaptureTeam.value === "other" ? els.reefSiteCaptureOtherTeam.value.trim() : ""
    }));
  } catch {
  }
}

function readRememberedPeople() {
  try {
    const data = JSON.parse(localStorage.getItem(LAST_PEOPLE_KEY) || "{}");
    return {
      recorder: String(data.recorder || ""),
      team: String(data.team || ""),
      otherTeam: String(data.otherTeam || "")
    };
  } catch {
    return { recorder: "", team: "", otherTeam: "" };
  }
}

function siteByCode(siteCode) {
  return state.sites.find((item) => item.site_code === siteCode) || null;
}

function siteLabel(site) {
  return `${site.site_code} (${site.site_name})`;
}

function sampleRopeRowMarkup(ropeNumber) {
  const label = `Rope ${ropeNumber}`;
  return `
    <tr data-sample-rope-row data-rope-number="${ropeNumber}">
      <th scope="row">${label}</th>
      <td><select data-rope-field="species" aria-label="${label} species"><option value="">Select</option><option value="spinosum">Spinosum</option><option value="cottonii">Cottonii</option></select></td>
      <td><input data-rope-field="date_seeded" type="date" aria-label="${label} date seeded"></td>
      <td><input data-rope-field="rope_weight_kg" type="number" min="0" step="0.001" inputmode="decimal" aria-label="${label} rope weight kg"></td>
      <td><input data-rope-field="initial_weight_kg" type="number" min="0" step="0.001" inputmode="decimal" aria-label="${label} initial seeded weight kg"></td>
      <td><input data-rope-field="week_2_kg" type="number" min="0" step="0.001" inputmode="decimal" aria-label="${label} week 2 weight kg"></td>
      <td><input data-rope-field="week_4_kg" type="number" min="0" step="0.001" inputmode="decimal" aria-label="${label} week 4 weight kg"></td>
      <td><input data-rope-field="week_6_kg" type="number" min="0" step="0.001" inputmode="decimal" aria-label="${label} week 6 weight kg"></td>
      <td><button class="secondary-action sample-rope-start-new" type="button" data-start-new-rope="${ropeNumber}">Start New</button></td>
    </tr>`;
}

function conditionRowMarkup([key, label]) {
  const ratings = ["excellent", "good", "fair", "poor"];
  return `
    <div class="reef-condition-row" role="row">
      <div class="reef-condition-label" role="rowheader">${label}</div>
      ${ratings.map((rating) => `<label class="reef-condition-radio" title="${label}: ${rating}"><input type="radio" name="quality_${key}" value="${rating}" aria-label="${label}: ${rating}"></label>`).join("")}
      <input class="reef-condition-note" type="text" maxlength="240" name="quality_${key}_note" aria-label="${label} remarks" placeholder="Add note">
    </div>`;
}

function healthObservationMarkup([key, label]) {
  return `<label class="reef-health-observation-option"><input type="checkbox" name="health_${key}" value="present"><span>${label}</span></label>`;
}

function productionStyles() {
  return `
    .reef-site-mode-tabs { margin: 0 0 0.85rem; }
    .reef-site-mode-tabs .standard-tab { font-weight: 700; }
    .reef-sample-rope-toolbar { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin: 0 0 0.65rem; }
    .reef-sample-rope-toolbar h4 { margin: 0 0 0.15rem; color: #355f5b; }
    .reef-sample-rope-save-wrap { display: flex; align-items: center; gap: 0.65rem; }
    .reef-sample-rope-table-wrap { overflow-x: auto; }
    .reef-sample-rope-table { width: 100%; min-width: 980px; border-collapse: collapse; background: #fff; font-size: 0.84rem; }
    .reef-sample-rope-table th, .reef-sample-rope-table td { border: 1px solid #d9e6e4; padding: 0.38rem 0.42rem; vertical-align: middle; }
    .reef-sample-rope-table thead th { background: #f1f7f6; color: #365f5b; text-align: center; font-weight: 700; }
    .reef-sample-rope-table tbody th { white-space: nowrap; text-align: left; font-weight: 600; color: #355f5b; }
    .reef-sample-rope-table input, .reef-sample-rope-table select { width: 100%; min-width: 92px; box-sizing: border-box; padding: 0.4rem 0.45rem !important; min-height: 32px; font-size: 0.82rem; }
    .reef-sample-rope-table input[type="date"] { min-width: 132px; }
    .sample-rope-start-new { white-space: nowrap; }
    .reef-health-environment { margin: 1rem 0; border: 1px solid #cfe1de; border-radius: 9px; background: #fbfefd; overflow: hidden; }
    .reef-health-environment > summary { cursor: pointer; list-style: none; padding: 0.8rem 0.95rem; font-weight: 700; color: #285f5a; background: #f2f8f7; user-select: none; }
    .reef-health-environment > summary::-webkit-details-marker { display: none; }
    .reef-health-environment > summary::after { content: "+"; float: right; font-size: 1.15rem; line-height: 1; color: #527b76; }
    .reef-health-environment[open] > summary::after { content: "−"; }
    .reef-health-environment-body { padding: 0.65rem 0.85rem 0.9rem; }
    .reef-health-block + .reef-health-block { margin-top: 0.9rem; }
    .reef-health-block h4 { margin: 0 0 0.35rem; font-size: 0.92rem; color: #355f5b; }
    .reef-condition-matrix, .reef-health-observation-box { border: 1px solid #dce9e7; border-radius: 7px; overflow: hidden; background: #fff; }
    .reef-condition-header, .reef-condition-row { display: grid; grid-template-columns: minmax(170px, 1.55fr) 72px 64px 58px 58px minmax(150px, 1.2fr); align-items: center; min-height: 34px; }
    .reef-condition-header { background: #f1f7f6; color: #416964; font-size: 0.78rem; font-weight: 700; text-align: center; }
    .reef-condition-header > :first-child, .reef-condition-header > :last-child { text-align: left; }
    .reef-condition-header > div, .reef-condition-row > * { min-width: 0; padding: 0.34rem 0.48rem; }
    .reef-condition-row + .reef-condition-row { border-top: 1px solid #e6efed; }
    .reef-condition-label { font-size: 0.87rem; line-height: 1.2; }
    .reef-condition-radio { display: flex; align-items: center; justify-content: center; align-self: stretch; cursor: pointer; }
    .reef-condition-radio input { width: 15px; height: 15px; margin: 0; accent-color: #3f746e; cursor: pointer; }
    .reef-condition-note { width: calc(100% - 0.96rem); margin: 0.22rem 0.48rem; min-height: 30px; padding: 0.3rem 0.45rem !important; font-size: 0.84rem; }
    .reef-health-observation-box { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; padding: 0.42rem 0.55rem; }
    .reef-health-observation-option { display: flex; align-items: center; gap: 0.6rem; min-height: 36px; margin: 0; padding: 0.32rem 0.42rem; font-size: 0.88rem; font-weight: 400; cursor: pointer; }
    .reef-health-observation-option input { width: 17px; height: 17px; margin: 0; accent-color: #3f746e; flex: 0 0 auto; }
    .reef-observation-rows { border-top: 1px solid #dce9e7; }
    .reef-observation-row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(150px, 260px); align-items: center; gap: 0.8rem; min-height: 42px; padding: 0.3rem 0.1rem; border-bottom: 1px solid #e2ecea; }
    .reef-observation-row input, .reef-observation-row select { width: 100%; min-height: 34px; }
    .reef-seaweed-general-notes { display: block; margin: 0.9rem 0 1rem; }
    .reef-seaweed-general-notes textarea { width: 100%; box-sizing: border-box; margin-top: 0.35rem; }
    @media (max-width: 760px) {
      .reef-sample-rope-toolbar { align-items: flex-start; flex-direction: column; }
      .reef-condition-matrix { overflow-x: auto; }
      .reef-condition-header, .reef-condition-row { min-width: 720px; }
      .reef-health-observation-box { grid-template-columns: 1fr; }
      .reef-observation-row { grid-template-columns: 1fr; gap: 0.35rem; padding: 0.48rem 0.1rem; }
      .reef-observation-row input, .reef-observation-row select { max-width: none; }
    }
  `;
}

async function waitForTrainingWorkspace() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (els.reefTrainingWorkspace && !els.reefTrainingWorkspace.hidden) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function openSeaweedWorkspace() {
  document.getElementById("reefSeaweedTab")?.click();
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || {} : data;
}

function kenyaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function nullablePositiveNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function formatBytes(bytes) {
  const number = Number(bytes || 0);
  if (number < 1024 * 1024) return `${Math.max(1, Math.round(number / 1024))} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function createUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
