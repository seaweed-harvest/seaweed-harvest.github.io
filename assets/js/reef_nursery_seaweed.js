import { authClient } from "./auth_client.js?v=25";
import { formatWeightPerLine } from "./reef_nursery_seaweed_math.js?v=1";

const PHOTO_BUCKET = "reef-seaweed-record-photos";
const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_STORED_PHOTO_BYTES = 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;

const UNIT_LABELS = Object.freeze({
  raft_1: "Raft #1",
  raft_2: "Raft #2",
  raft_3: "Raft #3",
  raft_4: "Raft #4",
  raft_5: "Raft #5",
  mkwiro_farm: "Mkwiro Farm",
  tumbe_farm: "Tumbe Farm"
});

const els = {};
const unitDrafts = new Map();
const state = {
  accessMode: "denied",
  editingRecordId: null,
  publicEditUntil: null,
  submissionId: createUuid(),
  selectedPhoto: null,
  savedPhoto: null,
  photoObjectUrl: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reefSeaweedForm", "reefSeaweedRecordNumber", "reefSeaweedRecordState",
    "reefSeaweedDate", "reefSeaweedLocation", "reefSeaweedRecordedBy",
    "reefSeaweedUnitSelector", "reefSeaweedUnitCards",
    "reefSeaweedTakePhoto", "reefSeaweedChoosePhoto", "reefSeaweedCameraInput",
    "reefSeaweedGalleryInput", "reefSeaweedPhotoStatus", "reefSeaweedPhotoPreview",
    "reefSeaweedPhotoImage", "reefSeaweedPhotoName", "reefSeaweedPhotoMeta",
    "submitReefSeaweed", "saveReefSeaweedChanges", "clearReefSeaweed",
    "reefSeaweedStatus", "reefTrainingWorkspace"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!els.reefSeaweedForm) return;
  bindEvents();

  try {
    const context = await rpc("ag_reef_seaweed_workspace_context");
    if (!context?.allowed) return;
    state.accessMode = context.access_mode || "public";
    initializeNewSeaweedRecord();

    const params = new URLSearchParams(window.location.search);
    const requestedRecord = params.get("seaweed_record");
    if (params.get("tab") === "seaweed" || requestedRecord) {
      await waitForTrainingWorkspace();
      openSeaweedTab();
      if (requestedRecord) await loadSeaweedRecord(requestedRecord);
    }
  } catch (error) {
    setStatus(error.message || "The Seaweed Record workspace could not be opened.", "error");
  }
}

function bindEvents() {
  els.reefSeaweedLocation.addEventListener("change", () => {
    captureUnitDrafts();
    applyLocationUnitOptions();
    renderUnitCards();
  });

  els.reefSeaweedUnitSelector.addEventListener("change", () => {
    captureUnitDrafts();
    renderUnitCards();
  });

  els.reefSeaweedUnitCards.addEventListener("input", handleUnitInput);
  els.reefSeaweedUnitCards.addEventListener("change", handleUnitInput);

  els.reefSeaweedTakePhoto.addEventListener("click", () => {
    els.reefSeaweedCameraInput.value = "";
    els.reefSeaweedCameraInput.click();
  });
  els.reefSeaweedChoosePhoto.addEventListener("click", () => {
    els.reefSeaweedGalleryInput.value = "";
    els.reefSeaweedGalleryInput.click();
  });
  els.reefSeaweedCameraInput.addEventListener("change", () => {
    selectPhoto(els.reefSeaweedCameraInput.files?.[0]);
  });
  els.reefSeaweedGalleryInput.addEventListener("change", () => {
    selectPhoto(els.reefSeaweedGalleryInput.files?.[0]);
  });

  els.reefSeaweedForm.addEventListener("submit", submitSeaweedRecord);
  els.saveReefSeaweedChanges.addEventListener("click", saveSeaweedChanges);
  els.clearReefSeaweed.addEventListener("click", () => {
    initializeNewSeaweedRecord();
    history.replaceState({}, "", "./reef_nursery.html?tab=seaweed");
    setStatus("");
  });
}

function initializeNewSeaweedRecord() {
  state.editingRecordId = null;
  state.publicEditUntil = null;
  state.submissionId = createUuid();
  state.selectedPhoto = null;
  state.savedPhoto = null;
  unitDrafts.clear();
  releasePhotoObjectUrl();
  els.reefSeaweedForm.reset();
  els.reefSeaweedDate.value = kenyaDate();
  els.reefSeaweedRecordNumber.textContent = "New record";
  els.reefSeaweedRecordState.textContent = "Unsaved";
  applyLocationUnitOptions();
  renderUnitCards();
  renderPhoto();
  updateEditActions();
}

function updateEditActions() {
  const editing = Boolean(state.editingRecordId);
  els.submitReefSeaweed.hidden = editing;
  els.saveReefSeaweedChanges.hidden = !editing;
  els.clearReefSeaweed.textContent = editing ? "Start new record" : "Clear Seaweed Record";
}

function openSeaweedTab() {
  document.querySelector('[data-reef-training-tab="seaweed"]')?.click();
}

async function waitForTrainingWorkspace() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!els.reefTrainingWorkspace.hidden) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function validUnitsForLocation(location) {
  if (location === "tumbe_offshore" || location === "mkwiro_offshore") {
    return ["raft_1", "raft_2", "raft_3", "raft_4", "raft_5"];
  }
  if (location === "mkwiro_shore") return ["mkwiro_farm"];
  if (location === "tumbe_shore") return ["tumbe_farm"];
  return [];
}

function applyLocationUnitOptions() {
  const valid = new Set(validUnitsForLocation(els.reefSeaweedLocation.value));
  els.reefSeaweedUnitSelector.querySelectorAll("[data-seaweed-unit-option]").forEach((label) => {
    const code = label.dataset.seaweedUnitOption;
    const control = label.querySelector("[data-seaweed-unit]");
    const allowed = valid.has(code);
    label.hidden = !allowed;
    control.disabled = !allowed;
    if (!allowed) control.checked = false;
  });
}

function selectedUnitCodes() {
  return [...els.reefSeaweedUnitSelector.querySelectorAll("[data-seaweed-unit]:checked")]
    .map((control) => control.dataset.seaweedUnit);
}

function unitDraft(code) {
  if (!unitDrafts.has(code)) {
    unitDrafts.set(code, {
      species: "",
      line_count: "",
      seaweed_health: "",
      seed_weight_value: "",
      seed_weight_unit: "kg",
      harvest_weight_value: "",
      harvest_weight_unit: "kg",
      notes_equipment_replaced: ""
    });
  }
  return unitDrafts.get(code);
}

function captureUnitDrafts() {
  els.reefSeaweedUnitCards.querySelectorAll("[data-seaweed-unit-card]").forEach((card) => {
    const draft = unitDraft(card.dataset.seaweedUnitCard);
    for (const field of [
      "species", "line_count", "seaweed_health", "seed_weight_value", "seed_weight_unit",
      "harvest_weight_value", "harvest_weight_unit", "notes_equipment_replaced"
    ]) {
      const control = card.querySelector(`[data-seaweed-field="${field}"]`);
      if (control) draft[field] = control.value;
    }
  });
}

function renderUnitCards() {
  captureUnitDrafts();
  const codes = selectedUnitCodes();
  if (!codes.length) {
    els.reefSeaweedUnitCards.innerHTML = '<p class="reef-help">Select at least one raft or shore farm.</p>';
    return;
  }
  els.reefSeaweedUnitCards.innerHTML = codes.map(renderUnitCard).join("");
  els.reefSeaweedUnitCards.querySelectorAll("[data-seaweed-unit-card]").forEach(updatePerLineDisplays);
}

function renderUnitCard(code) {
  const draft = unitDraft(code);
  return `
    <article class="reef-seaweed-unit-card" data-seaweed-unit-card="${escapeHtml(code)}">
      <div class="reef-panel-heading"><div><h3>${escapeHtml(UNIT_LABELS[code] || code)}</h3></div></div>
      <div class="reef-form-grid">
        <label>Species
          <select data-seaweed-field="species" required>
            <option value="">Select species</option>
            <option value="spinosum" ${draft.species === "spinosum" ? "selected" : ""}>Spinosum</option>
            <option value="cottonii" ${draft.species === "cottonii" ? "selected" : ""}>Cottonii</option>
          </select>
        </label>
        <label>Number of lines
          <input type="number" min="1" max="10000" step="1" inputmode="numeric" data-seaweed-field="line_count" value="${escapeHtml(draft.line_count)}" required>
        </label>
        <label class="reef-span-two">Seaweed health
          <input type="text" maxlength="500" data-seaweed-field="seaweed_health" value="${escapeHtml(draft.seaweed_health)}" placeholder="Optional">
        </label>
      </div>

      ${renderWeightGroup("seed", "Seed", draft)}
      ${renderWeightGroup("harvest", "Harvest", draft)}

      <label>Notes / Equipment Replaced
        <textarea rows="3" maxlength="1000" data-seaweed-field="notes_equipment_replaced">${escapeHtml(draft.notes_equipment_replaced)}</textarea>
      </label>
    </article>`;
}

function renderWeightGroup(kind, label, draft) {
  const value = draft[`${kind}_weight_value`];
  const unit = draft[`${kind}_weight_unit`] || "kg";
  return `
    <div class="reef-seaweed-weight-group">
      <label>${label} total weight
        <input type="number" min="0" max="100000" step="0.001" inputmode="decimal" data-seaweed-field="${kind}_weight_value" value="${escapeHtml(value)}">
      </label>
      <label>Unit
        <select data-seaweed-field="${kind}_weight_unit">
          <option value="kg" ${unit !== "g" ? "selected" : ""}>kg</option>
          <option value="g" ${unit === "g" ? "selected" : ""}>g</option>
        </select>
      </label>
      <div>
        <span class="standard-field-label">${label} weight per line</span>
        <div class="reef-per-line" data-seaweed-per-line="${kind}">—</div>
      </div>
    </div>`;
}

function handleUnitInput(event) {
  const card = event.target.closest("[data-seaweed-unit-card]");
  if (!card) return;
  captureUnitDrafts();
  updatePerLineDisplays(card);
}

function updatePerLineDisplays(card) {
  const lines = card.querySelector('[data-seaweed-field="line_count"]')?.value;
  for (const kind of ["seed", "harvest"]) {
    const total = card.querySelector(`[data-seaweed-field="${kind}_weight_value"]`)?.value;
    const unit = card.querySelector(`[data-seaweed-field="${kind}_weight_unit"]`)?.value || "kg";
    const output = card.querySelector(`[data-seaweed-per-line="${kind}"]`);
    if (output) output.textContent = formatWeightPerLine(total, unit, Number(lines));
  }
}

function selectPhoto(file) {
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    return setPhotoStatus("Select an image file.", "error");
  }
  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    return setPhotoStatus("The selected photo is larger than 25 MB.", "error");
  }
  state.selectedPhoto = file;
  renderPhoto();
}

function renderPhoto() {
  releasePhotoObjectUrl();

  if (state.selectedPhoto) {
    state.photoObjectUrl = URL.createObjectURL(state.selectedPhoto);
    els.reefSeaweedPhotoImage.src = state.photoObjectUrl;
    els.reefSeaweedPhotoName.textContent = state.selectedPhoto.name || "Selected photo";
    els.reefSeaweedPhotoMeta.textContent =
      `${formatBytes(state.selectedPhoto.size)} — will be compressed to JPEG before upload`;
    els.reefSeaweedPhotoPreview.hidden = false;
    return setPhotoStatus("Photo selected.");
  }

  if (state.savedPhoto?.objectUrl) {
    state.photoObjectUrl = state.savedPhoto.objectUrl;
    state.savedPhoto.objectUrl = null;
    els.reefSeaweedPhotoImage.src = state.photoObjectUrl;
    els.reefSeaweedPhotoName.textContent = state.savedPhoto.original_name || "Saved photo";
    els.reefSeaweedPhotoMeta.textContent =
      `${formatBytes(state.savedPhoto.byte_size || 0)} — saved privately`;
    els.reefSeaweedPhotoPreview.hidden = false;
    return setPhotoStatus("Saved photo.");
  }

  els.reefSeaweedPhotoImage.removeAttribute("src");
  els.reefSeaweedPhotoName.textContent = "";
  els.reefSeaweedPhotoMeta.textContent = "";
  els.reefSeaweedPhotoPreview.hidden = true;
  setPhotoStatus("No photo selected.");
}

function releasePhotoObjectUrl() {
  if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
  state.photoObjectUrl = null;
}

function setPhotoStatus(message, kind = "") {
  els.reefSeaweedPhotoStatus.textContent = message;
  if (kind) els.reefSeaweedPhotoStatus.dataset.status = kind;
  else delete els.reefSeaweedPhotoStatus.dataset.status;
}

async function submitSeaweedRecord(event) {
  event.preventDefault();
  if (state.editingRecordId) return;
  const payload = validatedSeaweedRecord();
  if (!payload) return;

  setSaving(true);
  setStatus("Submitting Seaweed Record…");
  try {
    const saved = await rpc("ag_reef_seaweed_workspace_submit", {
      p_submission_id: state.submissionId,
      p_record: payload.record,
      p_units: payload.units
    });
    const attachedPhoto = await saveSelectedPhoto(saved.record_id);

    state.editingRecordId = saved.record_id;
    state.publicEditUntil = saved.public_edit_until || null;
    els.reefSeaweedRecordNumber.textContent = saved.record_number || "Seaweed Record";
    els.reefSeaweedRecordState.textContent = recordStateLabel(state.publicEditUntil);
    updateEditActions();
    history.replaceState(
      {},
      "",
      `./reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(saved.record_id)}`
    );
    if (attachedPhoto) await loadSavedPhoto(attachedPhoto);
    setStatus(`${saved.record_number || "Seaweed Record"} submitted.`, "success");
  } catch (error) {
    setStatus(error.message || "The Seaweed Record could not be submitted.", "error");
  } finally {
    setSaving(false);
  }
}

async function saveSeaweedChanges() {
  if (!state.editingRecordId) return;
  const payload = validatedSeaweedRecord();
  if (!payload) return;

  setSaving(true);
  setStatus("Saving Seaweed Record changes…");
  try {
    const saved = await rpc("ag_reef_seaweed_workspace_update", {
      p_record_id: state.editingRecordId,
      p_record: payload.record,
      p_units: payload.units
    });
    const attachedPhoto = state.selectedPhoto
      ? await saveSelectedPhoto(state.editingRecordId)
      : null;
    if (attachedPhoto) await loadSavedPhoto(attachedPhoto);
    state.publicEditUntil = saved.public_edit_until || state.publicEditUntil;
    els.reefSeaweedRecordState.textContent = recordStateLabel(state.publicEditUntil);
    setStatus(
      `${saved.record_number || els.reefSeaweedRecordNumber.textContent} changes saved. The original 168-hour deadline is unchanged.`,
      "success"
    );
  } catch (error) {
    if (shouldRequireLogin(error)) return routeToLoginForSeaweed(state.editingRecordId);
    setStatus(error.message || "The Seaweed Record changes could not be saved.", "error");
  } finally {
    setSaving(false);
  }
}

function validatedSeaweedRecord() {
  const required = [
    [els.reefSeaweedDate, "Date"],
    [els.reefSeaweedLocation, "Location"],
    [els.reefSeaweedRecordedBy, "Person filling the form"]
  ];
  for (const [control, label] of required) {
    if (String(control.value || "").trim()) continue;
    return validationError(`${label} is required.`, control);
  }

  captureUnitDrafts();
  const codes = selectedUnitCodes();
  if (!codes.length) {
    return validationError("Select at least one raft or shore farm.", els.reefSeaweedUnitSelector);
  }

  const units = [];
  for (const code of codes) {
    const draft = unitDraft(code);
    const lineCount = Number(draft.line_count);
    const seedWeight = nullablePositiveNumber(draft.seed_weight_value);
    const harvestWeight = nullablePositiveNumber(draft.harvest_weight_value);

    if (!draft.species) return validationError(`Select species for ${UNIT_LABELS[code]}.`);
    if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 10000) {
      return validationError(`Enter a valid number of lines for ${UNIT_LABELS[code]}.`);
    }
    if (seedWeight === null && harvestWeight === null) {
      return validationError(`Enter a seed or harvest total weight for ${UNIT_LABELS[code]}.`);
    }

    units.push({
      unit_code: code,
      species: draft.species,
      line_count: lineCount,
      seaweed_health: textOrNull(draft.seaweed_health),
      seed_weight_value: seedWeight,
      seed_weight_unit: draft.seed_weight_unit || "kg",
      harvest_weight_value: harvestWeight,
      harvest_weight_unit: draft.harvest_weight_unit || "kg",
      notes_equipment_replaced: textOrNull(draft.notes_equipment_replaced)
    });
  }

  return {
    record: {
      record_date: els.reefSeaweedDate.value,
      location: els.reefSeaweedLocation.value,
      recorded_by_name: els.reefSeaweedRecordedBy.value.trim()
    },
    units
  };
}

function validationError(message, control = null) {
  setStatus(message, "error");
  control?.focus?.();
  return null;
}

async function saveSelectedPhoto(recordId) {
  if (!state.selectedPhoto) return null;

  setStatus("Compressing photo…");
  const sourceName = state.selectedPhoto.name || "photo.jpg";
  const blob = await preparePhoto(state.selectedPhoto);
  if (blob.size > MAX_STORED_PHOTO_BYTES) {
    throw new Error("The photo could not be compressed below 1 MB.");
  }

  const path = `${recordId}/photo.jpg`;
  const { error: uploadError } = await authClient.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, {
      cacheControl: "3600",
      contentType: "image/jpeg",
      upsert: true
    });
  if (uploadError) throw uploadError;

  const attached = await rpc("ag_reef_seaweed_workspace_attach_photo", {
    p_record_id: recordId,
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

async function loadSeaweedRecord(recordId) {
  setSaving(true);
  setStatus("Loading Seaweed Record…");
  try {
    const data = await rpc("ag_reef_seaweed_workspace_detail", { p_record_id: recordId });
    hydrateSeaweedRecord(data);
    state.editingRecordId = data.record_id;
    state.publicEditUntil = data.public_edit_until || null;
    els.reefSeaweedRecordNumber.textContent = data.record_number || "Seaweed Record";
    els.reefSeaweedRecordState.textContent = recordStateLabel(state.publicEditUntil);
    updateEditActions();
    history.replaceState(
      {},
      "",
      `./reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(recordId)}`
    );
    openSeaweedTab();
    setStatus(`${data.record_number || "Seaweed Record"} loaded.`);
  } catch (error) {
    if (shouldRequireLogin(error)) return routeToLoginForSeaweed(recordId);
    setStatus(error.message || "The Seaweed Record could not be opened.", "error");
  } finally {
    setSaving(false);
  }
}

function hydrateSeaweedRecord(data) {
  state.selectedPhoto = null;
  state.savedPhoto = null;
  unitDrafts.clear();

  els.reefSeaweedDate.value = String(data.record_date || "").slice(0, 10);
  els.reefSeaweedLocation.value = data.location || "";
  els.reefSeaweedRecordedBy.value = data.recorded_by_name || "";
  applyLocationUnitOptions();

  const units = Array.isArray(data.units) ? data.units : [];
  const unitCodes = new Set(units.map((unit) => String(unit.unit_code)));
  els.reefSeaweedUnitSelector.querySelectorAll("[data-seaweed-unit]").forEach((control) => {
    control.checked = unitCodes.has(control.dataset.seaweedUnit);
  });

  units.forEach((unit) => {
    unitDrafts.set(String(unit.unit_code), {
      species: String(unit.species || ""),
      line_count: unit.line_count ?? "",
      seaweed_health: String(unit.seaweed_health || ""),
      seed_weight_value: unit.seed_weight_value ?? "",
      seed_weight_unit: String(unit.seed_weight_unit || "kg"),
      harvest_weight_value: unit.harvest_weight_value ?? "",
      harvest_weight_unit: String(unit.harvest_weight_unit || "kg"),
      notes_equipment_replaced: String(unit.notes_equipment_replaced || "")
    });
  });

  renderUnitCards();
  void loadSavedPhoto(data.photo || null);
}

async function loadSavedPhoto(photo) {
  releasePhotoObjectUrl();
  state.savedPhoto = photo ? { ...photo } : null;
  if (!photo?.storage_path) return renderPhoto();

  const { data, error } = await authClient.storage
    .from(PHOTO_BUCKET)
    .download(photo.storage_path);
  if (error) {
    renderPhoto();
    return setPhotoStatus("Photo metadata loaded, but the image could not be reopened.", "error");
  }

  state.savedPhoto.objectUrl = URL.createObjectURL(data);
  renderPhoto();
}

function setSaving(disabled) {
  els.submitReefSeaweed.disabled = disabled;
  els.saveReefSeaweedChanges.disabled = disabled;
  els.clearReefSeaweed.disabled = disabled;
  els.reefSeaweedTakePhoto.disabled = disabled;
  els.reefSeaweedChoosePhoto.disabled = disabled;
}

function setStatus(message, kind = "") {
  els.reefSeaweedStatus.textContent = message || "";
  if (kind) els.reefSeaweedStatus.dataset.status = kind;
  else delete els.reefSeaweedStatus.dataset.status;
}

function recordStateLabel(publicEditUntil) {
  if (state.accessMode === "authenticated") return "Submitted";
  return publicEditUntil ? `Open until ${formatDateTime(publicEditUntil)}` : "Submitted";
}

function shouldRequireLogin(error) {
  return state.accessMode !== "authenticated"
    && (String(error?.code || "") === "42501"
      || /older than 7 days|sign in|authorised cosme reef|expired/i.test(String(error?.message || "")));
}

function routeToLoginForSeaweed(recordId) {
  const returnPage = `reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(recordId)}`;
  window.location.assign(`./login.html?return=${encodeURIComponent(returnPage)}`);
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || {} : data;
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function nullablePositiveNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null;
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
