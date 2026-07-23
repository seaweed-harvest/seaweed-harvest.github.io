import { authClient, requireAdminAccess } from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js";
import { selectRows } from "./supabase_client.js";
import { installSuggestedInput } from "./suggested_input.js";

const PHOTO_BUCKET = "process-record-photos";
const PHOTO_MAX_BYTES = 700 * 1024;
const PHOTO_TARGET_BYTES = 550 * 1024;
const PHOTO_MAX_EDGE = 1920;

const els = {};
const state = {
  access: null,
  submissionId: crypto.randomUUID(),
  photo: null,
  photoUrl: null,
  dailyTotalKg: null,
  receivedSuggestion: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "processRecordForm", "processRecordNumber", "processRecordedBy", "processDate",
    "processStartTime", "processEndTime", "processSpecies", "processReceivedKg",
    "processReceivedHint", "useDailyCollectionTotal", "processBlendedKg",
    "processWetPulpKg", "processPressedLiquidL", "processDryPulpKg",
    "processLostSeaweedKg", "processPressCount", "processAveragePress",
    "processWetDryRatio", "processStockProductRatio", "processPhoto",
    "processPhotoHint", "processPhotoPreview", "processPhotoImage", "processPhotoName",
    "deleteProcessPhoto", "processNotes", "saveProcessRecord",
    "clearProcessRecord", "processRecordStatus", "favoriteProcessForm"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  state.receivedSuggestion = installSuggestedInput(els.processReceivedKg);
  state.access = await requireAdminAccess("can_submit_collection");
  if (!state.access) return;

  setupFavoriteFormButton({
    button: els.favoriteProcessForm,
    formKey: "process_record",
    profile: state.access.profile,
    client: authClient,
    returnPage: "process_record.html"
  });

  setDefaults();
  bindEvents();
  try {
    await Promise.all([loadSpecies(), loadFormContext()]);
    updateFieldHighlights();
    updateCalculations();
    els.processRecordForm.dataset.formReady = "true";
    els.processStartTime.focus();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function bindEvents() {
  els.processRecordForm.addEventListener("submit", submitProcessRecord);
  els.clearProcessRecord.addEventListener("click", clearForm);
  els.processDate.addEventListener("change", () => loadFormContext({ applySuggestion: true }));
  els.useDailyCollectionTotal.addEventListener("click", applyDailyTotalSuggestion);
  els.processPhoto.addEventListener("change", selectPhoto);
  els.deleteProcessPhoto.addEventListener("click", clearPhoto);
  els.processRecordForm.addEventListener("input", () => {
    updateCalculations();
    updateFieldHighlights();
  });
  els.processRecordForm.addEventListener("change", updateFieldHighlights);
}

function setDefaults() {
  els.processRecordedBy.value = state.access.profile?.display_name
    || state.access.profile?.email
    || "Signed-in user";
  els.processDate.value = kenyaDate();
  els.processStartTime.value = kenyaTime();
  els.processEndTime.value = "";
}

async function loadSpecies() {
  const rows = await selectRows(
    "ag_public_seaweed_type_settings",
    "select=type_key,label,common_name,is_default&order=display_order.asc"
  );
  if (!rows.length) return;
  els.processSpecies.replaceChildren();
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.type_key;
    option.textContent = row.common_name ? `${row.label} (${row.common_name})` : row.label;
    option.selected = Boolean(row.is_default);
    els.processSpecies.append(option);
  });
}

async function loadFormContext(options = {}) {
  const { data, error } = await authClient.rpc("ag_process_record_form_context", {
    p_process_date: els.processDate.value || null
  });
  if (error) throw error;
  const context = Array.isArray(data) ? data[0] : data;
  state.dailyTotalKg = positiveNumber(context?.received_seaweed_total_kg);
  els.processRecordNumber.textContent = context?.next_record_number
    ? `Next record PR-${String(context.next_record_number).padStart(5, "0")}`
    : "Record number assigned on save";

  if (state.dailyTotalKg !== null) {
    els.processReceivedHint.textContent = `${formatNumber(state.dailyTotalKg)} kg recorded in Collection for this date.`;
    els.useDailyCollectionTotal.hidden = false;
    if (options.applySuggestion !== false && (!els.processReceivedKg.value || state.receivedSuggestion.suggested)) {
      applyDailyTotalSuggestion();
    }
  } else {
    els.processReceivedHint.textContent = "No collection total available for this date.";
    els.useDailyCollectionTotal.hidden = true;
    if (state.receivedSuggestion.suggested) state.receivedSuggestion.set("");
  }
}

function applyDailyTotalSuggestion() {
  if (state.dailyTotalKg === null) return;
  state.receivedSuggestion.set(String(state.dailyTotalKg));
  updateCalculations();
}

async function selectPhoto() {
  const file = els.processPhoto.files?.[0];
  if (!file) return;
  setStatus("Preparing photo...");
  try {
    const blob = await compressPhoto(file);
    clearPhotoPreviewUrl();
    state.photo = {
      blob,
      originalName: String(file.name || "process-sample.jpg").slice(0, 255)
    };
    state.photoUrl = URL.createObjectURL(blob);
    els.processPhotoImage.src = state.photoUrl;
    els.processPhotoName.textContent = `${state.photo.originalName} - ${formatFileSize(blob.size)}`;
    els.processPhotoPreview.hidden = false;
    els.processPhotoHint.textContent = "Photo ready.";
    setStatus("");
  } catch (error) {
    clearPhoto();
    setStatus(error.message, "error");
  }
}

function clearPhoto() {
  clearPhotoPreviewUrl();
  state.photo = null;
  els.processPhoto.value = "";
  els.processPhotoImage.removeAttribute("src");
  els.processPhotoName.textContent = "";
  els.processPhotoPreview.hidden = true;
  els.processPhotoHint.textContent = "One photo, compressed before upload.";
}

function clearPhotoPreviewUrl() {
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = null;
}

async function submitProcessRecord(event) {
  event.preventDefault();
  if (!els.processRecordForm.reportValidity()) return;
  if (els.processEndTime.value <= els.processStartTime.value) {
    setStatus("Enter an end time after the start time.", "error");
    els.processEndTime.focus();
    return;
  }

  els.saveProcessRecord.disabled = true;
  setStatus("Saving...");
  let uploadedPath = null;
  try {
    const photo = await uploadPhoto();
    uploadedPath = photo?.storage_path || null;
    const { data, error } = await authClient.rpc("ag_submit_process_record", {
      p_submission_id: state.submissionId,
      p_record: {
        process_date: els.processDate.value,
        start_time: els.processStartTime.value,
        end_time: els.processEndTime.value,
        species: els.processSpecies.value,
        recorded_by_name: textOrNull(els.processRecordedBy.value),
        received_seaweed_kg: numberOrNull(els.processReceivedKg.value),
        blended_seaweed_kg: numberOrNull(els.processBlendedKg.value),
        wet_pulp_kg: numberOrNull(els.processWetPulpKg.value),
        pressed_liquid_l: numberOrNull(els.processPressedLiquidL.value),
        dry_pulp_kg: numberOrNull(els.processDryPulpKg.value),
        lost_seaweed_kg: numberOrNull(els.processLostSeaweedKg.value),
        number_of_presses: integerOrNull(els.processPressCount.value),
        photo,
        notes: textOrNull(els.processNotes.value)
      }
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const number = `PR-${String(saved?.record_number || "").padStart(5, "0")}`;
    setStatus(`${number} saved.`);
    resetAfterSave();
  } catch (error) {
    console.error("Process Record save failed", error);
    if (uploadedPath) await authClient.storage.from(PHOTO_BUCKET).remove([uploadedPath]);
    setStatus(error.message, "error");
  } finally {
    els.saveProcessRecord.disabled = false;
  }
}

async function uploadPhoto() {
  if (!state.photo) return null;
  const userId = state.access.session?.user?.id;
  if (!userId) throw new Error("Sign in again before uploading the photo.");
  const storagePath = `${userId}/${state.submissionId}/01-${crypto.randomUUID()}.jpg`;
  const { error } = await authClient.storage.from(PHOTO_BUCKET).upload(
    storagePath,
    state.photo.blob,
    { contentType: "image/jpeg", cacheControl: "3600", upsert: false }
  );
  if (error) throw error;
  return {
    storage_path: storagePath,
    original_name: state.photo.originalName,
    byte_size: state.photo.blob.size,
    content_type: "image/jpeg"
  };
}

function updateCalculations() {
  const wet = positiveNumber(els.processWetPulpKg.value);
  const dry = positiveNumber(els.processDryPulpKg.value);
  const received = positiveNumber(els.processReceivedKg.value);
  const presses = positiveNumber(els.processPressCount.value);
  els.processAveragePress.textContent = wet !== null && presses !== null
    ? `${formatNumber(wet / presses)} kg`
    : "-";
  els.processWetDryRatio.textContent = dry !== null && wet !== null
    ? `${formatNumber((dry / wet) * 100)}%`
    : "-";
  els.processStockProductRatio.textContent = dry !== null && received !== null
    ? `${formatNumber((dry / received) * 100)}%`
    : "-";
}

function updateFieldHighlights() {
  els.processRecordForm.querySelectorAll("input, select, textarea").forEach((control) => {
    if (control.type === "file" || control.disabled || control.closest("[hidden]")) return;
    control.classList.toggle("empty-value-control", control.required && !String(control.value || "").trim());
  });
}

function clearForm() {
  const recorder = els.processRecordedBy.value;
  els.processRecordForm.reset();
  clearPhoto();
  state.submissionId = crypto.randomUUID();
  state.receivedSuggestion.clear();
  setDefaults();
  els.processRecordedBy.value = recorder;
  setStatus("");
  updateCalculations();
  void loadFormContext({ applySuggestion: true });
}

function resetAfterSave() {
  const recorder = els.processRecordedBy.value;
  els.processRecordForm.reset();
  clearPhoto();
  state.submissionId = crypto.randomUUID();
  setDefaults();
  els.processRecordedBy.value = recorder;
  updateCalculations();
  void loadFormContext({ applySuggestion: true });
}

async function compressPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const source = await loadPhotoSource(file);
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  source.close();

  let low = 0.4;
  let high = 0.92;
  let best = null;
  let smallest = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(canvas, quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= PHOTO_TARGET_BYTES) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }
  const result = best || smallest;
  if (!result || result.size > PHOTO_MAX_BYTES) {
    throw new Error("Photo is still larger than 700 KB after compression. Choose a smaller image.");
  }
  return result;
}

async function loadPhotoSource(file) {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.()
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url)
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Photo could not be compressed."));
    }, "image/jpeg", quality);
  });
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Nairobi"
  }).format(new Date());
}

function kenyaTime() {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi"
  }).format(new Date());
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function numberOrNull(value) {
  if (String(value || "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.trunc(number);
}

function textOrNull(value) {
  return String(value || "").trim() || null;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-KE", { maximumFractionDigits: 3 });
}

function formatFileSize(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function setStatus(message, type = "") {
  els.processRecordStatus.textContent = message || "";
  els.processRecordStatus.dataset.status = type;
}
