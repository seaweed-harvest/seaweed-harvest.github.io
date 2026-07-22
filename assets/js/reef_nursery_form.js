import { APP_CONFIG } from "./config.js";
import { authClient, requireAdminAccess } from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js";

const els = {};
const PHOTO_BUCKET = "reef-nursery-photos";
const PHOTO_MAX_COUNT = 8;
const PHOTO_MAX_BYTES = 1024 * 1024;
const PHOTO_TARGET_BYTES = 850 * 1024;
const PHOTO_MAX_EDGE = 2200;
const photoState = {
  files: [],
  userId: null,
  activePhotoUrl: null
};
let submissionId = crypto.randomUUID();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reefNurseryForm", "reefNurseryTabs", "reefRecordedBy", "reefTrainingDate",
    "reefLocation", "reefStartTime", "reefFinishTime", "reefTrainerName",
    "reefTrainerOrganisation", "reefSupportingStaff", "reefSessionTypes",
    "reefConditions", "reefNurseryReference", "reefParticipantRows",
    "reefParticipantCount", "addReefParticipant", "reefSeaweedHealth",
    "reefSeedWeight", "reefSeedWeightUnit", "reefHarvestWeight",
    "reefHarvestWeightUnit", "reefEquipmentReplaced", "saveReefNursery",
    "reefTakePhoto", "reefChoosePhotos", "reefCameraPhoto", "reefGalleryPhotos",
    "reefPhotoStatus", "reefPhotoPreview", "reefDropboxLink", "reefDropboxPending",
    "reefPhotoViewer", "reefPhotoViewerImage", "reefPhotoViewerName",
    "reefClosePhotoViewer", "clearReefNursery", "favoriteReefNurseryForm",
    "reefNurseryStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupTabs();
  configureDropboxLink();
  els.addReefParticipant.addEventListener("click", () => addParticipantRow({ focus: true }));
  els.reefParticipantRows.addEventListener("click", handleParticipantAction);
  els.reefTakePhoto.addEventListener("click", () => els.reefCameraPhoto.click());
  els.reefChoosePhotos.addEventListener("click", () => els.reefGalleryPhotos.click());
  els.reefCameraPhoto.addEventListener("change", addSelectedPhotos);
  els.reefGalleryPhotos.addEventListener("change", addSelectedPhotos);
  els.reefPhotoPreview.addEventListener("click", handlePhotoAction);
  els.reefClosePhotoViewer.addEventListener("click", closePhotoViewer);
  els.reefPhotoViewer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePhotoViewer();
  });
  els.reefPhotoViewer.addEventListener("close", releasePhotoViewerUrl);
  els.reefNurseryForm.addEventListener("submit", submitSession);
  els.clearReefNursery.addEventListener("click", clearForm);
  els.reefNurseryForm.addEventListener("input", updateFieldHighlights);
  els.reefNurseryForm.addEventListener("change", updateFieldHighlights);

  const access = await requireAdminAccess("can_submit_collection");
  if (!access) return;
  photoState.userId = access.session?.user?.id || null;

  setupFavoriteFormButton({
    button: els.favoriteReefNurseryForm,
    formKey: "reef_nursery",
    profile: access.profile,
    client: authClient,
    returnPage: "reef_nursery.html"
  });

  els.reefRecordedBy.value = access.profile?.display_name
    || access.profile?.email
    || access.profile?.phone
    || "Signed-in user";
  els.reefTrainingDate.value = kenyaDate();
  addParticipantRow();
  updateFieldHighlights();
}

function setupTabs() {
  const tabs = [...document.querySelectorAll("[data-reef-tab]")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showTab(tab.dataset.reefTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      tabs[next].focus();
      showTab(tabs[next].dataset.reefTab);
    });
  });
}

function showTab(name) {
  document.querySelectorAll("[data-reef-tab]").forEach((tab) => {
    const active = tab.dataset.reefTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-reef-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.reefPanel !== name;
  });
}

function addParticipantRow({ focus = false } = {}) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td data-label="Participant name"><input type="text" data-participant-field="name" maxlength="160" autocomplete="name" required></td>
    <td data-label="Farmer ID / phone"><input type="text" data-participant-field="reference" maxlength="100" autocomplete="tel"></td>
    <td data-label="Gender">
      <select data-participant-field="gender" aria-label="Participant gender">
        <option value="">Not recorded</option>
        <option value="female">Female</option>
        <option value="male">Male</option>
        <option value="other">Other</option>
        <option value="prefer_not_to_say">Prefer not to say</option>
      </select>
    </td>
    <td data-label="Actions">
      <button class="reef-remove-participant" type="button" data-remove-participant aria-label="Remove participant" title="Remove participant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>
      </button>
    </td>`;
  els.reefParticipantRows.append(row);
  updateParticipantCount();
  updateFieldHighlights();
  if (focus) row.querySelector('[data-participant-field="name"]').focus();
}

function handleParticipantAction(event) {
  const button = event.target.closest("[data-remove-participant]");
  if (!button) return;
  const rows = [...els.reefParticipantRows.rows];
  if (rows.length === 1) {
    rows[0].querySelectorAll("input").forEach((input) => { input.value = ""; });
    rows[0].querySelector("select").value = "";
  } else {
    button.closest("tr").remove();
  }
  updateParticipantCount();
  updateFieldHighlights();
}

function updateParticipantCount() {
  const count = els.reefParticipantRows.rows.length;
  els.reefParticipantCount.textContent = `${count} ${count === 1 ? "participant" : "participants"}`;
}

async function submitSession(event) {
  event.preventDefault();
  const record = validatedRecord();
  if (!record) return;

  els.saveReefNursery.disabled = true;
  let uploadedPhotos = [];
  setStatus(photoState.files.length ? "Preparing photos..." : "Saving...");
  try {
    uploadedPhotos = await prepareAndUploadPhotos();
    setStatus("Saving Reef Nursery session...");
    const { data, error } = await authClient.rpc("ag_submit_reef_nursery_session", {
      p_submission_id: submissionId,
      p_session: record.session,
      p_participants: record.participants,
      p_seaweed_record: record.seaweed,
      p_photos: uploadedPhotos.map((photo) => photo.manifest)
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const participantCount = Number(saved?.participant_count ?? record.participants.length);
    const photoCount = Number(saved?.photo_count ?? uploadedPhotos.length);
    clearForm({ preserveStatus: true });
    const photoSummary = photoCount
      ? ` and ${photoCount} ${photoCount === 1 ? "photo" : "photos"}`
      : "";
    setStatus(`Reef Nursery session saved with ${participantCount} ${participantCount === 1 ? "participant" : "participants"}${photoSummary}.`);
  } catch (error) {
    await removeUploadedPhotos(uploadedPhotos.map((photo) => photo.manifest.storage_path));
    setStatus(error.message || "The Reef Nursery session could not be saved.", "error");
  } finally {
    els.saveReefNursery.disabled = false;
  }
}

function validatedRecord() {
  const required = [
    [els.reefRecordedBy, "Recorded by", "session"],
    [els.reefTrainingDate, "Training date", "session"],
    [els.reefLocation, "Location", "session"],
    [els.reefStartTime, "Start time", "session"],
    [els.reefFinishTime, "Finish time", "session"],
    [els.reefTrainerName, "Trainer's name", "session"],
    [els.reefTrainerOrganisation, "Trainer's organisation", "session"]
  ];
  for (const [control, label, tab] of required) {
    if (String(control.value || "").trim()) continue;
    return validationError(`${label} is required.`, tab, control);
  }

  if (els.reefFinishTime.value <= els.reefStartTime.value) {
    return validationError("Finish time must be after start time.", "session", els.reefFinishTime);
  }

  const sessionTypes = [...els.reefNurseryForm.querySelectorAll('[name="reefSessionType"]:checked')]
    .map((control) => control.value);
  if (!sessionTypes.length) {
    els.reefSessionTypes.classList.add("missing-selection");
    return validationError("Select at least one type of session.", "session", els.reefSessionTypes);
  }

  const participants = [...els.reefParticipantRows.rows].map((row) => ({
    participant_name: row.querySelector('[data-participant-field="name"]').value.trim(),
    farmer_reference_phone: textOrNull(row.querySelector('[data-participant-field="reference"]').value),
    gender: textOrNull(row.querySelector('[data-participant-field="gender"]').value)
  }));
  const firstMissingParticipant = participants.findIndex((participant) => !participant.participant_name);
  if (firstMissingParticipant >= 0) {
    const input = els.reefParticipantRows.rows[firstMissingParticipant]
      .querySelector('[data-participant-field="name"]');
    return validationError("Participant name is required for every row.", "participants", input);
  }

  return {
    session: {
      training_date: els.reefTrainingDate.value,
      location: els.reefLocation.value,
      start_time: els.reefStartTime.value,
      finish_time: els.reefFinishTime.value,
      trainer_name: els.reefTrainerName.value.trim(),
      trainer_organisation: els.reefTrainerOrganisation.value.trim(),
      supporting_staff: textOrNull(els.reefSupportingStaff.value),
      session_types: sessionTypes,
      weather_sea_conditions: textOrNull(els.reefConditions.value),
      nursery_reference: textOrNull(els.reefNurseryReference.value),
      recorded_by_name: els.reefRecordedBy.value.trim()
    },
    participants,
    seaweed: {
      seaweed_health: textOrNull(els.reefSeaweedHealth.value),
      seed_weight_value: numberOrNull(els.reefSeedWeight.value),
      seed_weight_unit: els.reefSeedWeightUnit.value,
      harvest_weight_value: numberOrNull(els.reefHarvestWeight.value),
      harvest_weight_unit: els.reefHarvestWeightUnit.value,
      equipment_replaced: textOrNull(els.reefEquipmentReplaced.value)
    }
  };
}

function validationError(message, tab, control) {
  showTab(tab);
  setStatus(message, "error");
  control.classList?.add("empty-value-control");
  control.focus?.();
  return null;
}

function clearForm({ preserveStatus = false } = {}) {
  const recordedBy = els.reefRecordedBy.value;
  els.reefNurseryForm.reset();
  els.reefRecordedBy.value = recordedBy;
  els.reefTrainingDate.value = kenyaDate();
  els.reefParticipantRows.replaceChildren();
  photoState.files = [];
  els.reefCameraPhoto.value = "";
  els.reefGalleryPhotos.value = "";
  closePhotoViewer();
  renderPhotoPreview();
  addParticipantRow();
  submissionId = crypto.randomUUID();
  showTab("session");
  els.reefSessionTypes.classList.remove("missing-selection");
  updateFieldHighlights();
  if (!preserveStatus) setStatus("");
}

function updateFieldHighlights() {
  els.reefNurseryForm.querySelectorAll("input, select, textarea").forEach((control) => {
    const type = String(control.type || "").toLowerCase();
    const excluded = ["hidden", "checkbox", "radio", "button", "submit", "reset"].includes(type)
      || control.disabled
      || control.readOnly;
    control.classList.toggle(
      "empty-value-control",
      !excluded && control.required && String(control.value ?? "").trim() === ""
    );
  });
  const hasSessionType = Boolean(els.reefNurseryForm.querySelector('[name="reefSessionType"]:checked'));
  els.reefSessionTypes.classList.toggle("missing-selection", !hasSessionType);
}

function textOrNull(value) {
  return String(value || "").trim() || null;
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function configureDropboxLink() {
  const configured = String(APP_CONFIG.externalLinks?.reefNurseryDropbox || "").trim();
  let valid = false;
  try {
    const url = new URL(configured);
    valid = ["http:", "https:"].includes(url.protocol);
  } catch (_error) {
    valid = false;
  }
  els.reefDropboxLink.hidden = !valid;
  els.reefDropboxPending.hidden = valid;
  if (valid) els.reefDropboxLink.href = configured;
  else els.reefDropboxLink.removeAttribute("href");
}

function addSelectedPhotos(event) {
  const input = event.currentTarget;
  const candidates = [...(input.files || [])];
  const available = Math.max(0, PHOTO_MAX_COUNT - photoState.files.length);
  if (candidates.length > available) {
    setPhotoStatus(`Only ${PHOTO_MAX_COUNT} photos can be added.`, "error");
  }
  candidates.slice(0, available).forEach((file) => {
    if (isImageFile(file)) photoState.files.push(file);
    else setPhotoStatus("Only image files can be added.", "error");
  });
  input.value = "";
  renderPhotoPreview();
}

function isImageFile(file) {
  return String(file?.type || "").startsWith("image/")
    || /\.(jpe?g|png|webp|heic|heif)$/i.test(String(file?.name || ""));
}

function renderPhotoPreview() {
  els.reefPhotoPreview.replaceChildren();
  photoState.files.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "reef-photo-card";

    const view = document.createElement("button");
    view.type = "button";
    view.className = "reef-photo-view";
    view.dataset.viewPhoto = String(index);
    view.setAttribute("aria-label", `View photo ${index + 1}`);

    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.alt = `Selected Reef Nursery photo ${index + 1}`;
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
    image.addEventListener("error", () => URL.revokeObjectURL(objectUrl), { once: true });

    const caption = document.createElement("span");
    caption.textContent = file.name || `Photo ${index + 1}`;
    view.append(image, caption);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "reef-photo-remove";
    remove.dataset.removePhoto = String(index);
    remove.setAttribute("aria-label", `Remove photo ${index + 1}`);
    remove.title = "Remove photo";
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>';

    card.append(view, remove);
    els.reefPhotoPreview.append(card);
  });
  setPhotoStatus(photoState.files.length
    ? `${photoState.files.length} of ${PHOTO_MAX_COUNT} photos ready.`
    : `Up to ${PHOTO_MAX_COUNT} photos. Compressed before upload.`);
}

function handlePhotoAction(event) {
  const remove = event.target.closest("[data-remove-photo]");
  if (remove) {
    photoState.files.splice(Number(remove.dataset.removePhoto), 1);
    renderPhotoPreview();
    return;
  }
  const view = event.target.closest("[data-view-photo]");
  if (view) openPhotoViewer(Number(view.dataset.viewPhoto));
}

function openPhotoViewer(index) {
  const file = photoState.files[index];
  if (!file) return;
  releasePhotoViewerUrl();
  photoState.activePhotoUrl = URL.createObjectURL(file);
  els.reefPhotoViewerImage.src = photoState.activePhotoUrl;
  els.reefPhotoViewerName.textContent = file.name || `Photo ${index + 1}`;
  if (typeof els.reefPhotoViewer.showModal === "function") els.reefPhotoViewer.showModal();
  else els.reefPhotoViewer.setAttribute("open", "");
}

function closePhotoViewer() {
  if (typeof els.reefPhotoViewer.close === "function" && els.reefPhotoViewer.open) {
    els.reefPhotoViewer.close();
  } else {
    els.reefPhotoViewer.removeAttribute("open");
    releasePhotoViewerUrl();
  }
}

function releasePhotoViewerUrl() {
  if (photoState.activePhotoUrl) URL.revokeObjectURL(photoState.activePhotoUrl);
  photoState.activePhotoUrl = null;
  els.reefPhotoViewerImage.removeAttribute("src");
  els.reefPhotoViewerName.textContent = "";
}

async function prepareAndUploadPhotos() {
  if (!photoState.files.length) return [];
  if (!photoState.userId) throw new Error("Sign in again before uploading photos.");
  const uploaded = [];
  for (let index = 0; index < photoState.files.length; index += 1) {
    const file = photoState.files[index];
    setPhotoStatus(`Compressing photo ${index + 1} of ${photoState.files.length}...`);
    const blob = await compressReefPhoto(file);
    if (blob.size > PHOTO_MAX_BYTES) throw new Error("A photo could not be reduced below 1 MB.");
    const objectPath = `${photoState.userId}/${submissionId}/${String(index + 1).padStart(2, "0")}-${crypto.randomUUID()}.jpg`;
    setPhotoStatus(`Uploading photo ${index + 1} of ${photoState.files.length}...`);
    const { error } = await authClient.storage.from(PHOTO_BUCKET).upload(objectPath, blob, {
      cacheControl: "31536000",
      contentType: "image/jpeg",
      upsert: false
    });
    if (error) {
      await removeUploadedPhotos(uploaded.map((photo) => photo.manifest.storage_path));
      throw error;
    }
    uploaded.push({
      manifest: {
        storage_path: objectPath,
        original_name: String(file.name || `photo-${index + 1}.jpg`).slice(0, 255),
        byte_size: blob.size,
        content_type: "image/jpeg"
      }
    });
  }
  return uploaded;
}

async function removeUploadedPhotos(paths) {
  const uniquePaths = [...new Set((paths || []).filter(Boolean))];
  if (!uniquePaths.length) return;
  await authClient.storage.from(PHOTO_BUCKET).remove(uniquePaths).catch(() => {});
}

async function compressReefPhoto(file) {
  const image = await loadReefImage(file);
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("A selected photo could not be opened.");
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not prepare the selected photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    const blob = await jpegBlobNearTarget(canvas);
    if (blob.size <= PHOTO_MAX_BYTES) return blob;
    const reduction = Math.min(0.9, Math.sqrt(PHOTO_TARGET_BYTES / blob.size) * 0.96);
    width = Math.max(1, Math.round(width * reduction));
    height = Math.max(1, Math.round(height * reduction));
  }
  throw new Error("A photo could not be reduced below 1 MB.");
}

function loadReefImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("A selected photo could not be opened. Try a JPEG image."));
    };
    image.src = objectUrl;
  });
}

async function jpegBlobNearTarget(canvas) {
  let low = 0.38;
  let high = 0.92;
  let best = null;
  let smallest = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToJpegBlob(canvas, quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= PHOTO_TARGET_BYTES) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }
  return best || smallest;
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("This browser could not compress the selected photo."));
    }, "image/jpeg", quality);
  });
}

function setPhotoStatus(message, status = "") {
  els.reefPhotoStatus.textContent = message;
  if (status) els.reefPhotoStatus.dataset.status = status;
  else delete els.reefPhotoStatus.dataset.status;
}

function kenyaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function setStatus(message, status = "") {
  els.reefNurseryStatus.textContent = message;
  if (status) els.reefNurseryStatus.dataset.status = status;
  else delete els.reefNurseryStatus.dataset.status;
}
