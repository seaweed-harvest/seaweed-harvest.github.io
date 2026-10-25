import { APP_CONFIG } from "./config.js";
import { authClient, requireOrganisationCapability } from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js?v=3";
import { setPrintValue, setupPdfWorksheet } from "./print_worksheet.js";
import { selectRows } from "./supabase_client.js";
import { uploadRecordPhotos, removeRecordPhotos, validateRecordPhotoFiles, renderPhotoPreviews } from "./stock_photo_upload.js";

const els = {};
let submissionId = crypto.randomUUID();
let gpsAccuracyMeters = null;
let communities = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "siteSampleForm", "siteSampledAt",
    "siteSampleCommunity", "siteSampleGps", "siteSampleGpsHint", "captureSiteSampleGps",
    "siteSampleRecordedBy", "siteSampleTemperature", "siteSampleSalinity", "siteSampleSalinityUnit", "siteSamplePh", "siteSampleDissolvedOxygen",
    "siteSampleTds", "siteSampleTdsUnit", "siteSampleEc", "siteSampleNotes", "saveSiteSample",
    "siteSamplePhotoFiles", "siteSampleCamera", "siteSampleTakePhoto", "siteSampleChoosePhotos",
    "siteSamplePhotoPreview", "siteSamplePhotoStatus", "siteSampleSavedPhotoLink",
    "clearSiteSample", "favoriteSiteSampleForm", "printSiteSampleWorksheet", "siteSampleStatus",
    "siteSamplePrintWorksheet", "printSiteSampleCommunity", "printSiteSampleDate",
    "printSiteSampleTide", "printSiteSampleRecordedBy"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupPdfWorksheet({
    button: els.printSiteSampleWorksheet,
    worksheet: els.siteSamplePrintWorksheet,
    rowCount: 10,
    columnCount: 12,
    prepare: prepareSiteSampleWorksheet
  });

  const access = await requireOrganisationCapability(
    "form_site_water_samples",
    "can_submit_collection",
    "site_water_sample.html"
  );
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
  els.siteSampleTakePhoto.addEventListener("click", () => els.siteSampleCamera.click());
  els.siteSampleChoosePhotos.addEventListener("click", () => els.siteSamplePhotoFiles.click());
  for (const control of [els.siteSampleCamera, els.siteSamplePhotoFiles]) {
    control.addEventListener("change", () => {
      try {
        const files = pendingSamplePhotos();
        renderPhotoPreviews(els.siteSamplePhotoPreview, files);
        els.siteSamplePhotoStatus.textContent = files.length + " photo(s) ready.";
      } catch (error) {
        control.value = "";
        renderPhotoPreviews(els.siteSamplePhotoPreview, pendingSamplePhotos());
        els.siteSamplePhotoStatus.textContent = error.message;
      }
    });
  }
  els.clearSiteSample.addEventListener("click", clearForm);
  els.captureSiteSampleGps.addEventListener("click", captureGps);
  els.siteSampleGps.addEventListener("input", () => { gpsAccuracyMeters = null; });
  els.siteSampleForm.addEventListener("input", updateFieldHighlights);
  els.siteSampleForm.addEventListener("change", updateFieldHighlights);

  try {
    const communityRows = await selectRows(
      APP_CONFIG.tables.communities,
      "select=id,community_id,community_name&order=community_name.asc"
    );
    communities = communityRows;
    renderCommunities(communityRows);
    updateFieldHighlights();
    els.siteSampleCommunity.focus();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function pendingSamplePhotos() {
  return validateRecordPhotoFiles(
    [...(els.siteSampleCamera.files || []), ...(els.siteSamplePhotoFiles.files || [])], 4
  );
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
  const community = communities.find((row) => row.id === els.siteSampleCommunity.value);
  if (!community) {
    setStatus("Select a community.", "error");
    return;
  }

  els.saveSiteSample.disabled = true;
  let storedSampleId = null;
  setStatus("Saving...");
  try {
    const photos = pendingSamplePhotos();
    const { data, error } = await authClient.rpc("ag_submit_site_water_sample_record_v6", {
      p_submission_id: submissionId,
      p_record: {
        auto_sample_number: true,
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
        ph_value: numberOrNull(els.siteSamplePh.value),
        dissolved_oxygen_mg_l: numberOrNull(els.siteSampleDissolvedOxygen.value),
        tds_value: numberOrNull(els.siteSampleTds.value),
        tds_unit: els.siteSampleTdsUnit.value,
        electrical_conductivity_ms_cm: numberOrNull(els.siteSampleEc.value),
        e_coli_sample_taken: selectedEColiSampleTaken(),
        notes: textOrNull(els.siteSampleNotes.value)
      }
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    storedSampleId = saved?.record_id || null;
    if (!storedSampleId) throw new Error("Sample saved but its record link is missing. Open Records to add photos.");
    els.siteSampleSavedPhotoLink.href = "./site_water_sample_photos.html?id=" + encodeURIComponent(storedSampleId);
    els.siteSampleSavedPhotoLink.hidden = false;
    resetInputs();
    if (photos.length) {
      let uploaded = [];
      try {
        const person = (await authClient.auth.getUser()).data?.user?.id;
        const uploadId = crypto.randomUUID();
        setStatus("Sample saved. Attaching photos...");
        uploaded = await uploadRecordPhotos(photos, uploadId, person, "site-water-sample-photos");
        const attached = await authClient.rpc("ag_add_site_water_sample_photos", {
          p_record_id: storedSampleId, p_upload_id: uploadId, p_photos: uploaded
        });
        if (attached.error) throw attached.error;
        uploaded = [];
      } catch (photoError) {
        await removeRecordPhotos(uploaded, "site-water-sample-photos");
        setStatus("Sample saved. Photo attachment failed: " + photoError.message +
          ". Use the View / add photos link to attach later.", "error");
        return;
      }
    }
    setStatus("Site sample saved" + (photos.length ? " with photos." : ". Add lab-result photos later via Records."));
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

function selectedTideStage() {
  return els.siteSampleForm.querySelector('[name="siteSampleTide"]:checked')?.value || null;
}

function selectedEColiSampleTaken() {
  const choice = els.siteSampleForm.querySelector('[name="siteSampleEColiTaken"]:checked')?.value;
  return choice === "yes" ? true : choice === "no" ? false : null;
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
  els.siteSampleSavedPhotoLink.hidden = true;
  resetInputs();
  setStatus("");
}

function resetInputs() {
  const recordedBy = els.siteSampleRecordedBy.value;
  const community = els.siteSampleCommunity.value;
  els.siteSampleForm.reset();
  els.siteSampleCamera.value = "";
  els.siteSamplePhotoFiles.value = "";
  els.siteSamplePhotoPreview.replaceChildren();
  els.siteSamplePhotoStatus.textContent = "";
  els.siteSampleRecordedBy.value = recordedBy;
  els.siteSampleCommunity.value = community;
  els.siteSampledAt.value = kenyaDateTime();
  els.siteSampleGpsHint.textContent = "Optional latitude, longitude";
  gpsAccuracyMeters = null;
  submissionId = crypto.randomUUID();
  updateFieldHighlights();
  els.siteSampledAt.focus();
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
