import { APP_CONFIG } from "./config.js";
import { authClient, requireAdminAccess } from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js";
import { setPrintValue, setupPdfWorksheet } from "./print_worksheet.js";
import { selectRows } from "./supabase_client.js";

const els = {};
const MEASUREMENT_IDS = [
  "siteSampleTemperature", "siteSampleSalinity", "siteSampleTds", "siteSampleEc"
];

let submissionId = crypto.randomUUID();
let nextSampleNumber = "1";
let sampleNumberWasEdited = false;
let gpsAccuracyMeters = null;
let communities = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "siteSampleForm", "siteSampleNumber", "siteSampleNumberHint", "siteSampledAt",
    "siteSampleCommunity", "siteSampleGps", "siteSampleGpsHint", "captureSiteSampleGps",
    "siteSampleRecordedBy", "siteSampleTemperature", "siteSampleSalinity", "siteSampleSalinityUnit",
    "siteSampleTds", "siteSampleTdsUnit", "siteSampleEc", "siteSampleNotes", "saveSiteSample",
    "clearSiteSample", "favoriteSiteSampleForm", "printSiteSampleWorksheet", "siteSampleStatus",
    "siteSamplePrintWorksheet", "printSiteSampleCommunity", "printSiteSampleDate",
    "printSiteSampleTide", "printSiteSampleRecordedBy"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupPdfWorksheet({
    button: els.printSiteSampleWorksheet,
    worksheet: els.siteSamplePrintWorksheet,
    rowCount: 10,
    columnCount: 13,
    prepare: prepareSiteSampleWorksheet
  });

  const access = await requireAdminAccess("can_submit_collection");
  if (!access) return;

  setupFavoriteFormButton({
    button: els.favoriteSiteSampleForm,
    formKey: "site_water_sample",
    profile: access.profile,
    client: authClient,
    returnPage: "site_water_sample.html"
  });

  els.siteSampledAt.value = kenyaDateTime();
  els.siteSampleRecordedBy.value = access.profile?.display_name
    || access.profile?.email
    || access.profile?.phone
    || "Signed-in user";
  els.siteSampleForm.addEventListener("submit", submitSiteSample);
  els.clearSiteSample.addEventListener("click", clearForm);
  els.captureSiteSampleGps.addEventListener("click", captureGps);
  els.siteSampleNumber.addEventListener("input", () => { sampleNumberWasEdited = true; });
  els.siteSampleGps.addEventListener("input", () => { gpsAccuracyMeters = null; });
  els.siteSampleForm.addEventListener("input", updateFieldHighlights);
  els.siteSampleForm.addEventListener("change", updateFieldHighlights);

  try {
    const [communityRows, formContextResult] = await Promise.all([
      selectRows(APP_CONFIG.tables.communities, "select=id,community_id,community_name&order=community_name.asc"),
      authClient.rpc("ag_site_water_sample_form_context")
    ]);
    if (formContextResult.error) throw formContextResult.error;
    communities = communityRows;
    renderCommunities(communityRows);
    applyFormContext(formContextResult.data);
    updateFieldHighlights();
    els.siteSampleCommunity.focus();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function submitSiteSample(event) {
  event.preventDefault();
  if (!els.siteSampleForm.reportValidity()) return;

  const gpsText = String(els.siteSampleGps.value || "").trim();
  const gps = gpsText ? parseGps(gpsText) : null;
  if (gpsText && !gps) {
    els.siteSampleGps.setCustomValidity("Enter latitude and longitude separated by a comma.");
    els.siteSampleGps.reportValidity();
    els.siteSampleGps.setCustomValidity("");
    return;
  }
  if (!MEASUREMENT_IDS.some((id) => els[id].value !== "")) {
    els.siteSampleTemperature.focus();
    setStatus("Enter at least one site measurement.", "error");
    return;
  }

  const community = communities.find((row) => row.id === els.siteSampleCommunity.value);
  if (!community) {
    setStatus("Select a community.", "error");
    return;
  }

  els.saveSiteSample.disabled = true;
  setStatus("Saving...");
  try {
    const { data, error } = await authClient.rpc("ag_submit_site_water_sample_record_v4", {
      p_submission_id: submissionId,
      p_record: {
        auto_sample_number: !sampleNumberWasEdited,
        sample_number: Number(els.siteSampleNumber.value),
        tide_stage: selectedTideStage(),
        sampled_at: new Date(els.siteSampledAt.value).toISOString(),
        community_record_id: community.id,
        community_id: community.community_id,
        gps_latitude: gps?.latitude ?? null,
        gps_longitude: gps?.longitude ?? null,
        gps_accuracy_m: gps ? gpsAccuracyMeters : null,
        recorded_by_name: textOrNull(els.siteSampleRecordedBy.value),
        temperature_c: numberOrNull(els.siteSampleTemperature.value),
        salinity_value: numberOrNull(els.siteSampleSalinity.value),
        salinity_unit: els.siteSampleSalinityUnit.value,
        tds_value: numberOrNull(els.siteSampleTds.value),
        tds_unit: els.siteSampleTdsUnit.value,
        electrical_conductivity_ms_cm: numberOrNull(els.siteSampleEc.value),
        e_coli_sample_taken: selectedEColiSampleTaken(),
        notes: textOrNull(els.siteSampleNotes.value)
      }
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const sampleNumber = String(saved?.sample_number || els.siteSampleNumber.value);
    resetInputs(String(saved?.next_sample_number || nextNumberAfter(sampleNumber)));
    setStatus(`Sample ${sampleNumber} saved. Next sample ${nextSampleNumber} is ready.`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.saveSiteSample.disabled = false;
  }
}

function renderCommunities(rows) {
  const current = els.siteSampleCommunity.value;
  els.siteSampleCommunity.replaceChildren(new Option("Select community", ""));
  rows.forEach((row) => {
    els.siteSampleCommunity.append(new Option(`${row.community_id} - ${row.community_name}`, row.id));
  });
  if (rows.some((row) => row.id === current)) els.siteSampleCommunity.value = current;
}

function applyFormContext(value) {
  const context = Array.isArray(value) ? value[0] : value;
  nextSampleNumber = String(context?.next_sample_number || "1");
  setNextSampleNumber();
}

function setNextSampleNumber() {
  els.siteSampleNumber.value = nextSampleNumber;
  sampleNumberWasEdited = false;
  els.siteSampleNumberHint.textContent = "Next sample number. You can type over it.";
}

function selectedTideStage() {
  return els.siteSampleForm.querySelector('[name="siteSampleTide"]:checked')?.value || null;
}

function selectedEColiSampleTaken() {
  return els.siteSampleForm.querySelector('[name="siteSampleEColiTaken"]:checked')?.value === "yes";
}

function captureGps() {
  if (!navigator.geolocation) {
    setStatus("GPS is not available in this browser.", "error");
    return;
  }
  els.captureSiteSampleGps.disabled = true;
  els.siteSampleGpsHint.textContent = "Getting GPS fix...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      gpsAccuracyMeters = Number.isFinite(accuracy) ? Number(accuracy.toFixed(1)) : null;
      els.siteSampleGps.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      els.siteSampleGpsHint.textContent = gpsAccuracyMeters === null
        ? "GPS fix captured"
        : `GPS fix captured (${Math.round(gpsAccuracyMeters)} m accuracy)`;
      els.captureSiteSampleGps.disabled = false;
      updateFieldHighlights();
    },
    (error) => {
      els.captureSiteSampleGps.disabled = false;
      els.siteSampleGpsHint.textContent = "Optional latitude, longitude";
      setStatus(gpsErrorMessage(error), "error");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function gpsErrorMessage(error) {
  if (error?.code === 1) return "Allow location access to capture the GPS fix.";
  if (error?.code === 2) return "A GPS fix is not available. Try again in an open area.";
  if (error?.code === 3) return "The GPS fix timed out. Try again.";
  return error?.message || "The GPS fix could not be captured.";
}

function parseGps(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function clearForm() {
  resetInputs();
  setStatus("");
}

function resetInputs(nextNumber = nextSampleNumber) {
  const recordedBy = els.siteSampleRecordedBy.value;
  const community = els.siteSampleCommunity.value;
  nextSampleNumber = String(nextNumber || nextSampleNumber || "1");
  els.siteSampleForm.reset();
  els.siteSampleRecordedBy.value = recordedBy;
  els.siteSampleCommunity.value = community;
  els.siteSampledAt.value = kenyaDateTime();
  els.siteSampleGpsHint.textContent = "Optional latitude, longitude";
  gpsAccuracyMeters = null;
  submissionId = crypto.randomUUID();
  setNextSampleNumber();
  updateFieldHighlights();
  els.siteSampleNumber.focus();
}

function prepareSiteSampleWorksheet() {
  const community = communities.find((row) => row.id === els.siteSampleCommunity.value);
  setPrintValue(els.printSiteSampleCommunity, community ? `${community.community_id} - ${community.community_name}` : "");
  setPrintValue(els.printSiteSampleDate, paperDateTime(els.siteSampledAt.value));
  const tideLabels = { spring_low: "Low", spring_high: "High" };
  setPrintValue(els.printSiteSampleTide, tideLabels[selectedTideStage()] || "");
  setPrintValue(els.printSiteSampleRecordedBy, els.siteSampleRecordedBy.value);
}

function updateFieldHighlights() {
  els.siteSampleForm.querySelectorAll("input, select, textarea").forEach((control) => {
    const type = String(control.type || "").toLowerCase();
    const excluded = ["hidden", "checkbox", "radio", "button", "submit", "reset"].includes(type)
      || control.disabled
      || control.readOnly;
    const shouldHighlight = !excluded && (control.required || control.dataset.recommended === "true");
    control.classList.toggle("empty-value-control", shouldHighlight && String(control.value ?? "").trim() === "");
  });
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function textOrNull(value) {
  return String(value || "").trim() || null;
}

function nextNumberAfter(value) {
  return (BigInt(String(value || "0")) + 1n).toString();
}

function kenyaDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function paperDateTime(value) {
  const [date, time] = String(value || "").split("T");
  const [year, month, day] = String(date || "").split("-");
  return year && month && day ? `${day}/${month}/${year}${time ? ` ${time}` : ""}` : "";
}

function setStatus(message, status = "") {
  els.siteSampleStatus.textContent = message;
  if (status) els.siteSampleStatus.dataset.status = status;
  else delete els.siteSampleStatus.dataset.status;
}
