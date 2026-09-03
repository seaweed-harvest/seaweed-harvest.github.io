import { authClient } from "./auth_client.js?v=25";

const PHOTO_BUCKET = "reef-nursery-photos";
const PHOTO_MAX_COUNT = 8;
const PHOTO_MAX_BYTES = 1024 * 1024;
const PHOTO_TARGET_BYTES = 850 * 1024;
const PHOTO_MAX_EDGE = 2200;
const COMPETENCY_LEVELS = Object.freeze([
  "needs_support",
  "with_supervision",
  "independent"
]);
const SUBMISSION_KEY = "seaweed-harvest:reef-training-submission";

const state = {
  busy: false,
  sessionId: null,
  existingPhotos: [],
  pendingPhotos: [],
  activeViewerUrl: null,
  activeViewerObjectUrl: false,
  rendering: false,
  photosLoadedFor: null
};

document.addEventListener("click", handleDocumentClick, true);
document.addEventListener("change", handleDocumentChange, true);
document.addEventListener("submit", handleDocumentSubmit, true);
window.addEventListener("popstate", syncRecordFromUrl);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseBridge, { once: true });
} else {
  initialiseBridge();
}

function initialiseBridge() {
  if (isReviewMode()) return;
  state.sessionId = recordIdFromUrl();
  for (const delay of [0, 150, 500, 1200]) {
    window.setTimeout(() => {
      syncPhotoControls();
      renderPhotos();
      void syncRecordFromUrl();
    }, delay);
  }

  const photoPanel = document.getElementById("reefPhotosPanel");
  if (photoPanel) {
    const observer = new MutationObserver(() => {
      queueMicrotask(() => {
        syncPhotoControls();
        renderPhotos();
      });
    });
    observer.observe(photoPanel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"]
    });
  }

  const recordNumber = document.getElementById("reefRecordNumber");
  if (recordNumber) {
    new MutationObserver(() => { void syncRecordFromUrl(); })
      .observe(recordNumber, { childList: true, characterData: true, subtree: true });
  }
}

function handleDocumentClick(event) {
  if (isReviewMode()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest("#reefTakePhoto")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const input = document.getElementById("reefCameraPhoto");
    if (input && !state.busy) {
      input.value = "";
      input.click();
    }
    return;
  }
  if (target.closest("#reefChoosePhotos")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const input = document.getElementById("reefGalleryPhotos");
    if (input && !state.busy) {
      input.value = "";
      input.click();
    }
    return;
  }

  const remove = target.closest("[data-reef-bridge-remove-photo]");
  if (remove) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.pendingPhotos.splice(Number(remove.dataset.reefBridgeRemovePhoto), 1);
    renderPhotos();
    return;
  }

  const pendingView = target.closest("[data-reef-bridge-view-pending]");
  if (pendingView) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPendingPhoto(Number(pendingView.dataset.reefBridgeViewPending));
    return;
  }

  const existingView = target.closest("[data-reef-bridge-view-existing]");
  if (existingView) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openExistingPhoto(Number(existingView.dataset.reefBridgeViewExisting));
    return;
  }

  if (target.closest("#reefClosePhotoViewer")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePhotoViewer();
    return;
  }

  if (target.closest("#saveReefNursery")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void saveTrainingInPlace();
    return;
  }

  if (target.closest("#clearReefNursery")) {
    queueMicrotask(resetBridgeForNewRecord);
  }
}

function handleDocumentChange(event) {
  if (isReviewMode()) return;
  if (!["reefCameraPhoto", "reefGalleryPhotos"].includes(event.target?.id)) return;
  event.stopImmediatePropagation();
  const input = event.target;
  addPendingPhotos([...(input.files || [])]);
  input.value = "";
}

function handleDocumentSubmit(event) {
  if (isReviewMode() || event.target?.id !== "reefNurseryForm") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void submitTrainingAndStartNew();
}

function addPendingPhotos(files) {
  const available = Math.max(
    0,
    PHOTO_MAX_COUNT - state.existingPhotos.length - state.pendingPhotos.length
  );
  if (files.length > available) {
    setPhotoStatus(`Only ${PHOTO_MAX_COUNT} photos can be attached.`, "error");
  }
  for (const file of files.slice(0, available)) {
    if (!isImageFile(file)) {
      setPhotoStatus("Only image files can be added.", "error");
      continue;
    }
    state.pendingPhotos.push(file);
  }
  renderPhotos();
}

function isImageFile(file) {
  return String(file?.type || "").startsWith("image/")
    || /\.(jpe?g|png|webp|heic|heif)$/i.test(String(file?.name || ""));
}

async function saveTrainingInPlace() {
  if (state.busy) return;
  const place = capturePlace();
  setBusy(true);
  setStatus("Saving Training record…");

  try {
    const payload = await collectTrainingPayload();
    const recordId = state.sessionId || recordIdFromUrl();
    const submitted = isSubmittedRecord();
    const complete = !submissionValidationError(payload);
    let saved;

    if (recordId && submitted && complete) {
      saved = await rpc("ag_reef_training_workspace_update", {
        p_session_id: recordId,
        p_session: payload.session,
        p_participants: payload.participants,
        p_training_delivered: payload.trainingDelivered,
        p_practical_competencies: payload.practicalCompetencies
      });
    } else {
      saved = await rpc("ag_reef_training_workspace_save", {
        p_session_id: recordId || null,
        p_submission_id: recordId ? null : submissionId(),
        p_session: payload.session,
        p_participants: payload.participants,
        p_training_delivered: payload.trainingDelivered,
        p_practical_competencies: payload.practicalCompetencies
      });
    }

    const savedId = saved?.session_id || recordId;
    if (!savedId) throw new Error("The saved Training record could not be identified.");
    state.sessionId = savedId;
    clearSubmissionId();
    updateRecordUrl(savedId, place.tab);
    updateRecordMeta(saved, submitted && complete ? "submitted" : "draft");

    let photoError = null;
    try {
      await uploadPendingPhotos(savedId);
      await loadExistingPhotos(savedId, { force: true });
    } catch (error) {
      photoError = error;
    }

    const number = saved?.record_number || recordNumber();
    if (photoError) {
      setStatus(`${number} saved, but the selected photos could not be uploaded: ${photoError.message}`, "error");
    } else {
      setStatus(`${number} saved.`, "success");
    }
  } catch (error) {
    setStatus(error?.message || "The Training record could not be saved.", "error");
  } finally {
    setBusy(false);
    restorePlace(place);
  }
}

async function submitTrainingAndStartNew() {
  if (state.busy) return;
  const payload = await collectTrainingPayload();
  const validation = submissionValidationError(payload);
  if (validation) {
    showValidationError(validation);
    return;
  }

  setBusy(true);
  setStatus("Submitting Training record…");
  try {
    const recordId = state.sessionId || recordIdFromUrl();
    const saved = recordId
      ? await rpc("ag_reef_training_workspace_update", {
          p_session_id: recordId,
          p_session: payload.session,
          p_participants: payload.participants,
          p_training_delivered: payload.trainingDelivered,
          p_practical_competencies: payload.practicalCompetencies
        })
      : await rpc("ag_reef_training_workspace_submit", {
          p_submission_id: submissionId(),
          p_session: payload.session,
          p_participants: payload.participants,
          p_training_delivered: payload.trainingDelivered,
          p_practical_competencies: payload.practicalCompetencies
        });

    const savedId = saved?.session_id || recordId;
    if (!savedId) throw new Error("The submitted Training record could not be identified.");
    state.sessionId = savedId;
    clearSubmissionId();
    updateRecordUrl(savedId, activeTab());
    updateRecordMeta(saved, "submitted");

    try {
      await uploadPendingPhotos(savedId);
    } catch (error) {
      setStatus(
        `${saved?.record_number || recordNumber()} was submitted, but the selected photos could not be uploaded. The record remains open so the photos can be retried: ${error.message}`,
        "error"
      );
      return;
    }

    const number = saved?.record_number || recordNumber();
    setBusy(false);
    document.getElementById("clearReefNursery")?.click();
    queueMicrotask(() => setStatus(`${number} submitted. A new Training record is ready.`, "success"));
  } catch (error) {
    setStatus(error?.message || "The Training record could not be submitted.", "error");
  } finally {
    setBusy(false);
  }
}

async function collectTrainingPayload() {
  const sessionTypes = [...document.querySelectorAll('[name="reefSessionType"]:checked')]
    .map((control) => control.value);
  const participants = [...document.querySelectorAll("#reefParticipantRows tr")]
    .map((row) => ({
      participant_name: textOrNull(row.querySelector('[data-participant-field="name"]')?.value),
      farmer_reference_phone: textOrNull(row.querySelector('[data-participant-field="reference"]')?.value),
      gender: textOrNull(row.querySelector('[data-participant-field="gender"]')?.value)
    }))
    .filter((participant) => Object.values(participant).some(Boolean));

  const trainingDelivered = [...document.querySelectorAll("[data-training-section]")]
    .map((section) => ({
      section_key: section.dataset.trainingSection,
      activity_ids: [...section.querySelectorAll("[data-training-activity]:checked")]
        .map((control) => control.dataset.trainingActivity),
      other_text: textOrNull(section.querySelector("[data-training-other]")?.value)
    }))
    .filter((section) => section.activity_ids.length || section.other_text);

  return {
    session: {
      training_date: valueOf("reefTrainingDate"),
      location: valueOf("reefLocation"),
      start_time: valueOf("reefStartTime"),
      finish_time: valueOf("reefFinishTime"),
      trainer_name: valueOf("reefTrainerName"),
      supporting_staff: valueOf("reefSupportingStaff"),
      session_types: sessionTypes,
      other_session_type: valueOf("reefOtherSessionType"),
      weather_sea_conditions: valueOf("reefConditions"),
      nursery_reference: valueOf("reefNurseryReference")
    },
    participants,
    trainingDelivered,
    practicalCompetencies: await collectTrainingCompetencies()
  };
}

async function collectTrainingCompetencies() {
  const activityIds = [...new Set(
    [...document.querySelectorAll("[data-competency-activity]")]
      .map((task) => task.dataset.competencyActivity)
      .filter(Boolean)
  )];
  if (!activityIds.length) return [];

  const participantOrder = new Map(
    [...document.querySelectorAll("#reefParticipantRows tr")]
      .map((row, index) => [row.dataset.participantKey, index + 1])
  );
  const sectionByActivity = new Map();
  document.querySelectorAll("[data-training-section]").forEach((section) => {
    section.querySelectorAll("[data-training-activity]:checked").forEach((control) => {
      sectionByActivity.set(control.dataset.trainingActivity, section.dataset.trainingSection);
    });
  });

  const result = [];
  for (const activityId of activityIds) {
    let task = competencyTask(activityId);
    if (!task) continue;
    const groupLevel = task.querySelector("[data-competency-group-level]:checked")?.value || null;
    const overrides = new Map();

    for (const level of COMPETENCY_LEVELS) {
      task = competencyTask(activityId);
      const trigger = task?.querySelector(`[data-open-competency-level="${level}"]`);
      if (!trigger || trigger.disabled) continue;
      const wasOpen = trigger.getAttribute("aria-expanded") === "true";
      if (!wasOpen) {
        trigger.click();
        await Promise.resolve();
      }

      task = competencyTask(activityId);
      task?.querySelectorAll(
        `[data-set-competency-participant="${level}"][aria-pressed="true"]`
      ).forEach((button) => {
        const order = participantOrder.get(button.dataset.competencyParticipant);
        if (order) overrides.set(order, level);
      });

      if (!wasOpen) {
        competencyTask(activityId)
          ?.querySelector(`[data-open-competency-level="${level}"][aria-expanded="true"]`)
          ?.click();
        await Promise.resolve();
      }
    }

    const sectionKey = sectionByActivity.get(activityId);
    if (!sectionKey || (!groupLevel && !overrides.size)) continue;
    result.push({
      section_key: sectionKey,
      activity_id: activityId,
      group_level: groupLevel,
      participant_overrides: [...overrides.entries()].map(([order, level]) => ({
        participant_order: order,
        competency_level: level
      }))
    });
  }
  return result;
}

function competencyTask(activityId) {
  return document.querySelector(`[data-competency-activity="${selectorEscape(activityId)}"]`);
}

function submissionValidationError(payload) {
  if (!payload.session.training_date) {
    return { message: "Training date is required before submission.", tab: "session", id: "reefTrainingDate" };
  }
  if (!payload.session.start_time) {
    return { message: "Start time is required before submission.", tab: "session", id: "reefStartTime" };
  }
  if (!payload.session.finish_time) {
    return { message: "Finish time is required before submission.", tab: "session", id: "reefFinishTime" };
  }
  if (payload.session.finish_time <= payload.session.start_time) {
    return { message: "Finish time must be after start time.", tab: "session", id: "reefFinishTime" };
  }
  if (!payload.session.session_types.length) {
    return { message: "Select at least one type of session before submission.", tab: "session", id: "reefSessionTypes" };
  }
  if (payload.session.session_types.includes("other") && !payload.session.other_session_type) {
    return { message: "Enter the other session type before submission.", tab: "session", id: "reefOtherSessionType" };
  }
  if (!payload.participants.length) {
    return { message: "Add at least one participant before submission.", tab: "participants", selector: '[data-participant-field="name"]' };
  }
  if (payload.participants.some((participant) => !participant.participant_name)) {
    return { message: "Participant name is required for every entered row.", tab: "participants", selector: '[data-participant-field="name"]' };
  }
  return null;
}

function showValidationError(error) {
  document.querySelector(`#reefNurseryTabs [data-reef-tab="${selectorEscape(error.tab)}"]`)?.click();
  setStatus(error.message, "error");
  const control = error.id
    ? document.getElementById(error.id)
    : document.querySelector(`#reefParticipantRows ${error.selector || ""}`);
  control?.focus?.();
}

async function uploadPendingPhotos(sessionId) {
  if (!state.pendingPhotos.length) return;
  if (state.photosLoadedFor !== sessionId) await loadExistingPhotos(sessionId, { force: true });
  if (state.existingPhotos.length + state.pendingPhotos.length > PHOTO_MAX_COUNT) {
    throw new Error(`Only ${PHOTO_MAX_COUNT} photos can be attached.`);
  }

  while (state.pendingPhotos.length) {
    const file = state.pendingPhotos[0];
    const order = Math.max(
      0,
      ...state.existingPhotos.map((photo) => Number(photo.photo_order) || 0)
    ) + 1;
    setPhotoStatus(`Compressing photo ${order}…`);
    const blob = await compressPhoto(file);
    const path = `${sessionId}/${String(order).padStart(2, "0")}-${createUuid()}.jpg`;
    setPhotoStatus(`Uploading photo ${order}…`);

    const { error: uploadError } = await authClient.storage.from(PHOTO_BUCKET).upload(path, blob, {
      cacheControl: "31536000",
      contentType: "image/jpeg",
      upsert: false
    });
    if (uploadError) throw uploadError;

    let attached;
    try {
      attached = await rpc("ag_reef_training_workspace_attach_photo", {
        p_session_id: sessionId,
        p_storage_path: path,
        p_original_name: String(file.name || `photo-${order}.jpg`).slice(0, 255),
        p_byte_size: blob.size,
        p_content_type: "image/jpeg"
      });
    } catch (error) {
      await authClient.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
      throw error;
    }

    const signedUrl = await signedPhotoUrl(path);
    state.existingPhotos.push({ ...attached, signedUrl });
    state.pendingPhotos.shift();
    renderPhotos();
  }
}

async function syncRecordFromUrl() {
  if (isReviewMode()) return;
  const recordId = recordIdFromUrl();
  if (!recordId) return;
  state.sessionId = recordId;
  if (state.photosLoadedFor !== recordId) await loadExistingPhotos(recordId);
}

async function loadExistingPhotos(sessionId, { force = false } = {}) {
  if (!sessionId || (!force && state.photosLoadedFor === sessionId)) return;
  try {
    const data = await rpc("ag_reef_training_workspace_photos", { p_session_id: sessionId });
    const photos = Array.isArray(data) ? data : [];
    state.existingPhotos = await Promise.all(photos.map(async (photo) => ({
      ...photo,
      signedUrl: await signedPhotoUrl(photo.storage_path)
    })));
    state.photosLoadedFor = sessionId;
    renderPhotos();
  } catch (error) {
    if (force) throw error;
  }
}

async function signedPhotoUrl(path) {
  const { data, error } = await authClient.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  return error ? "" : (data?.signedUrl || "");
}

function renderPhotos() {
  if (isReviewMode() || state.rendering) return;
  const preview = document.getElementById("reefPhotoPreview");
  if (!preview) return;
  const signature = JSON.stringify({
    existing: state.existingPhotos.map((photo) => photo.storage_path),
    pending: state.pendingPhotos.map((file) => `${file.name}:${file.size}:${file.lastModified}`)
  });
  if (preview.dataset.reefBridgeSignature === signature
      && preview.childElementCount === state.existingPhotos.length + state.pendingPhotos.length) {
    syncPhotoControls();
    return;
  }

  state.rendering = true;
  try {
    preview.replaceChildren();
    state.existingPhotos.forEach((photo, index) => {
      const card = document.createElement("article");
      card.className = "reef-photo-card reef-photo-card-existing standard-photo-card";
      const view = document.createElement("button");
      view.type = "button";
      view.className = "reef-photo-view standard-photo-view";
      view.dataset.reefBridgeViewExisting = String(index);
      view.setAttribute("aria-label", `View saved photo ${index + 1}`);
      const image = document.createElement("img");
      if (photo.signedUrl) image.src = photo.signedUrl;
      image.alt = `Saved Reef Nursery photo ${index + 1}`;
      const caption = document.createElement("span");
      caption.textContent = photo.original_name || `Saved photo ${index + 1}`;
      view.append(image, caption);
      card.append(view);
      preview.append(card);
    });

    state.pendingPhotos.forEach((file, index) => {
      const card = document.createElement("article");
      card.className = "reef-photo-card standard-photo-card";
      const view = document.createElement("button");
      view.type = "button";
      view.className = "reef-photo-view standard-photo-view";
      view.dataset.reefBridgeViewPending = String(index);
      view.setAttribute("aria-label", `View selected photo ${index + 1}`);
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
      remove.className = "reef-photo-remove standard-photo-remove";
      remove.dataset.reefBridgeRemovePhoto = String(index);
      remove.setAttribute("aria-label", `Remove selected photo ${index + 1}`);
      remove.title = "Remove photo";
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>';
      card.append(view, remove);
      preview.append(card);
    });
    preview.dataset.reefBridgeSignature = signature;
  } finally {
    state.rendering = false;
  }

  syncPhotoControls();
  if (!state.busy) {
    const total = state.existingPhotos.length + state.pendingPhotos.length;
    setPhotoStatus(total
      ? `${total} of ${PHOTO_MAX_COUNT} photos ${state.pendingPhotos.length ? "ready to save" : "attached"}.`
      : `Up to ${PHOTO_MAX_COUNT} photos. Compressed before upload.`);
  }
}

function syncPhotoControls() {
  if (isReviewMode()) return;
  for (const id of ["reefTakePhoto", "reefChoosePhotos"]) {
    const button = document.getElementById(id);
    if (button && button.disabled !== state.busy) button.disabled = state.busy;
  }
}

function openPendingPhoto(index) {
  const file = state.pendingPhotos[index];
  if (!file) return;
  openPhotoViewer(URL.createObjectURL(file), file.name || `Photo ${index + 1}`, true);
}

function openExistingPhoto(index) {
  const photo = state.existingPhotos[index];
  if (!photo?.signedUrl) return;
  openPhotoViewer(photo.signedUrl, photo.original_name || `Saved photo ${index + 1}`, false);
}

function openPhotoViewer(url, name, objectUrl) {
  closePhotoViewer();
  state.activeViewerUrl = url;
  state.activeViewerObjectUrl = objectUrl;
  const image = document.getElementById("reefPhotoViewerImage");
  const label = document.getElementById("reefPhotoViewerName");
  const dialog = document.getElementById("reefPhotoViewer");
  if (!image || !dialog) return;
  image.src = url;
  if (label) label.textContent = name;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closePhotoViewer() {
  const dialog = document.getElementById("reefPhotoViewer");
  if (dialog?.open && typeof dialog.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  if (state.activeViewerObjectUrl && state.activeViewerUrl) URL.revokeObjectURL(state.activeViewerUrl);
  state.activeViewerUrl = null;
  state.activeViewerObjectUrl = false;
  document.getElementById("reefPhotoViewerImage")?.removeAttribute("src");
  const label = document.getElementById("reefPhotoViewerName");
  if (label) label.textContent = "";
}

async function compressPhoto(file) {
  const image = await loadImage(file);
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
    context.drawImage(image, 0, 0, width, height);
    const blob = await jpegBlobNearTarget(canvas);
    if (blob.size <= PHOTO_MAX_BYTES) return blob;
    const reduction = Math.min(0.9, Math.sqrt(PHOTO_TARGET_BYTES / blob.size) * 0.96);
    width = Math.max(1, Math.round(width * reduction));
    height = Math.max(1, Math.round(height * reduction));
  }
  throw new Error("A photo could not be reduced below 1 MB.");
}

function loadImage(file) {
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

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["saveReefNursery", "submitReefNursery", "clearReefNursery", "reefTakePhoto", "reefChoosePhotos"]) {
    const control = document.getElementById(id);
    if (control) control.disabled = busy;
  }
}

function capturePlace() {
  return { tab: activeTab(), left: window.scrollX, top: window.scrollY };
}

function restorePlace(place) {
  if (place.tab) document.querySelector(`#reefNurseryTabs [data-reef-tab="${selectorEscape(place.tab)}"]`)?.click();
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({
    left: place.left,
    top: place.top,
    behavior: "auto"
  })));
}

function activeTab() {
  return document.querySelector('#reefNurseryTabs [data-reef-tab][aria-selected="true"]')?.dataset.reefTab || "session";
}

function updateRecordUrl(sessionId, tab) {
  const parameters = new URLSearchParams();
  parameters.set("record", sessionId);
  if (tab && tab !== "session") parameters.set("tab", tab);
  history.replaceState({}, "", `./reef_nursery.html?${parameters}`);
}

function updateRecordMeta(saved, status) {
  const number = document.getElementById("reefRecordNumber");
  const pill = document.getElementById("reefRecordStatus");
  if (number && saved?.record_number) number.textContent = saved.record_number;
  if (pill) {
    pill.textContent = status === "submitted" ? "Submitted" : "Draft";
    pill.dataset.recordStatus = status;
  }
}

function isSubmittedRecord() {
  const pill = document.getElementById("reefRecordStatus");
  return pill?.dataset.recordStatus === "submitted"
    || /^submitted$/i.test(String(pill?.textContent || "").trim());
}

function resetBridgeForNewRecord() {
  state.sessionId = null;
  state.existingPhotos = [];
  state.pendingPhotos = [];
  state.photosLoadedFor = null;
  clearSubmissionId();
  closePhotoViewer();
  renderPhotos();
}

function recordIdFromUrl() {
  return new URLSearchParams(window.location.search).get("record");
}

function recordNumber() {
  return document.getElementById("reefRecordNumber")?.textContent?.trim() || "Training record";
}

function submissionId() {
  try {
    const current = sessionStorage.getItem(SUBMISSION_KEY);
    if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
    const value = createUuid();
    sessionStorage.setItem(SUBMISSION_KEY, value);
    return value;
  } catch {
    return createUuid();
  }
}

function clearSubmissionId() {
  try {
    sessionStorage.removeItem(SUBMISSION_KEY);
  } catch {
    // Storage is optional.
  }
}

function valueOf(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return data;
}

function setStatus(message, kind = "") {
  const status = document.getElementById("reefNurseryStatus");
  if (!status) return;
  status.textContent = message || "";
  if (kind) status.dataset.status = kind;
  else delete status.dataset.status;
}

function setPhotoStatus(message, kind = "") {
  const status = document.getElementById("reefPhotoStatus");
  if (!status) return;
  status.textContent = message || "";
  if (kind) status.dataset.status = kind;
  else delete status.dataset.status;
}

function isReviewMode() {
  const parameters = new URLSearchParams(window.location.search);
  return Boolean(parameters.get("share") && parameters.get("org"));
}

function selectorEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function createUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const REEF_TRAINING_ENTRY_BRIDGE_CONTRACT = Object.freeze({
  saveAllowsIncompleteTimes: true,
  savePreservesPlace: true,
  publicAndAuthenticatedPhotos: true,
  privatePhotoBucket: PHOTO_BUCKET,
  maximumPhotos: PHOTO_MAX_COUNT
});
