import {
  deleteProjectPhoto,
  loadLedger,
  loadProjectPhotos,
  loadProjects,
  publicPhotoUrl,
  setProjectCover,
  submitGreenSpaceRecord,
  uploadProjectPhoto
} from "./green_space_api.js";

const LAST_PROJECT_KEY = "girls:last-project-id";
const CLIENT_TOKEN_KEY = "girls:client-token";
const PHOTO_TARGET_BYTES = 550 * 1024;
const PHOTO_MAX_BYTES = 700 * 1024;
const PHOTO_MAX_EDGE = 1920;
const PHOTO_MAX_COUNT = 10;

const state = {
  mode: "project",
  projects: [],
  ledger: null,
  observationRows: [],
  finalReviewRows: [],
  pendingPhotos: [],
  savedPhotos: [],
  activePhotoUrl: null,
  activePhotoIsObjectUrl: false,
  gps: null,
  submitting: false
};

const els = {};

document.addEventListener("DOMContentLoaded", initialise, { once: true });

async function initialise() {
  [
    "girlsReflectionForm", "girlsProjectPicker",
    "girlsParticipantName", "girlsGreenSpaceName", "girlsIntentions", "girlsLocationDescription",
    "girlsVisitSchedule", "girlsObservationWeek", "girlsObservationDateTime", "girlsObservationNotes",
    "girlsReflectionWeek", "girlsWeeklyReflection",
    "girlsWeeklyHaiku", "girlsFinalReviewStatus", "girlsFinalReviewList", "girlsFavouriteHaiku",
    "girlsSynthesis", "girlsKeyLearnings", "girlsOverallReflection", "girlsFinalWordCount",
    "girlsLocationTools", "girlsCaptureGps", "girlsCaptureGpsLabel", "girlsGpsReadout", "girlsLatitude", "girlsLongitude",
    "girlsPhotoTools", "girlsTakePhoto", "girlsChoosePhoto", "girlsCameraPhoto", "girlsGalleryPhoto",
    "girlsPhotoCount", "girlsPhotoStatus", "girlsPhotoPreview", "girlsPhotoViewer", "girlsPhotoViewerImage",
    "girlsPhotoViewerName", "girlsClosePhotoViewer",
    "girlsWebsite", "girlsSubmit", "girlsFormStatus", "girlsObservationHistory",
    "girlsObservationHistoryStatus", "girlsObservationLog", "girlsObservationCalendars",
    "girlsSuccessDialog", "girlsCloseSuccess", "girlsSuccessMessage", "girlsSuccessCode", "girlsAddAnother"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  document.querySelectorAll("[data-entry-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.entryMode));
  });
  els.girlsCaptureGps.addEventListener("click", captureGps);
  els.girlsTakePhoto.addEventListener("click", () => els.girlsCameraPhoto.click());
  els.girlsChoosePhoto.addEventListener("click", () => els.girlsGalleryPhoto.click());
  els.girlsCameraPhoto.addEventListener("change", selectPhotos);
  els.girlsGalleryPhoto.addEventListener("change", selectPhotos);
  els.girlsPhotoPreview.addEventListener("click", handlePhotoAction);
  els.girlsClosePhotoViewer.addEventListener("click", closePhotoViewer);
  els.girlsPhotoViewer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePhotoViewer();
  });
  els.girlsPhotoViewer.addEventListener("close", releasePhotoViewerUrl);
  els.girlsObservationCalendars.addEventListener("click", focusObservationDate);
  els.girlsFinalReviewList.addEventListener("click", selectFavouriteHaiku);
  els.girlsReflectionForm.addEventListener("submit", submitForm);
  els.girlsCloseSuccess.addEventListener("click", closeSuccessDialog);
  els.girlsAddAnother.addEventListener("click", addAnotherEntry);
  [els.girlsSynthesis, els.girlsKeyLearnings, els.girlsOverallReflection]
    .forEach((field) => field.addEventListener("input", renderWordCount));

  els.girlsObservationDateTime.value = localDateTimeValue(new Date());
  setMode("project");
  renderWordCount();
  await refreshProjects();
}

async function refreshProjects(selectedId = localStorage.getItem(LAST_PROJECT_KEY)) {
  try {
    state.projects = await loadProjects();
    renderProjectOptions(selectedId);
  } catch (error) {
    state.projects = [];
    renderProjectOptions(null);
    setStatus(error.message || "The project could not be loaded.", true);
  }
}

function renderProjectOptions(selectedId) {
  const rememberedId = selectedId || localStorage.getItem(LAST_PROJECT_KEY) || "";
  const projects = [...state.projects].sort((a, b) => {
    if (a.id === rememberedId) return -1;
    if (b.id === rememberedId) return 1;
    return String(a.green_space_name).localeCompare(String(b.green_space_name));
  });
  els.girlsProjectPicker.innerHTML = [
    '<option value="">No project started</option>',
    ...projects.map((project) => (
      `<option value="${escapeAttribute(project.id)}">${escapeHtml(project.participant_name)} - ${escapeHtml(project.green_space_name)} (${escapeHtml(project.public_code)})</option>`
    ))
  ].join("");
  const activeId = projects.some((project) => project.id === rememberedId)
    ? rememberedId
    : projects[0]?.id || "";
  els.girlsProjectPicker.value = activeId;
  if (activeId) {
    localStorage.setItem(LAST_PROJECT_KEY, activeId);
  }
}

function setMode(mode) {
  if (!["project", "observation", "photos", "weekly_reflection", "final_reflection"].includes(mode)) return;
  state.mode = mode;
  document.querySelectorAll("[data-entry-mode]").forEach((button) => {
    const active = button.dataset.entryMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-mode-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.modePanel !== mode;
  });
  els.girlsLocationTools.hidden = mode !== "project";
  els.girlsObservationHistory.hidden = mode !== "observation";
  els.girlsSubmit.textContent = {
    project: "Start my log",
    observation: "Add observation",
    photos: "Save new photos",
    weekly_reflection: "Save distillation + haiku",
    final_reflection: "Save final reflection"
  }[mode];
  if (mode === "observation") renderObservationHistory();
  if (mode === "photos") loadPhotoGallery();
  if (mode === "final_reflection") renderFinalReview();
  setStatus("");
}

async function captureGps() {
  if (!navigator.geolocation) {
    setStatus("GPS is not available in this browser.", true);
    return;
  }
  els.girlsCaptureGps.disabled = true;
  els.girlsCaptureGpsLabel.textContent = "Locating...";
  setStatus("Getting the green-space location...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.gps = {
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracy: Math.round(position.coords.accuracy)
      };
      els.girlsLatitude.value = String(state.gps.latitude);
      els.girlsLongitude.value = String(state.gps.longitude);
      els.girlsGpsReadout.value = `${state.gps.latitude.toFixed(6)}, ${state.gps.longitude.toFixed(6)} (+/- ${state.gps.accuracy} m)`;
      els.girlsCaptureGps.disabled = false;
      els.girlsCaptureGpsLabel.textContent = "Use GPS again";
      setStatus("Location captured.");
    },
    (error) => {
      els.girlsCaptureGps.disabled = false;
      els.girlsCaptureGpsLabel.textContent = "Use GPS";
      const detail = error.code === 1
        ? "Location permission was not allowed."
        : "The location could not be captured. Move into an open area and try again.";
      setStatus(detail, true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

function selectPhotos(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  const available = Math.max(
    0,
    PHOTO_MAX_COUNT - state.savedPhotos.length - state.pendingPhotos.length
  );
  if (!available) {
    setPhotoStatus("This project already has 10 photos.", true);
    return;
  }
  let rejected = false;
  files.slice(0, available).forEach((file) => {
    if (isImageFile(file)) state.pendingPhotos.push(file);
    else rejected = true;
  });
  if (files.length > available) {
    setPhotoStatus(`Only ${available} more ${available === 1 ? "photo can" : "photos can"} be added.`, true);
  } else if (rejected) {
    setPhotoStatus("Only image files can be added.", true);
  }
  renderPhotoPreview();
}

function isImageFile(file) {
  return String(file?.type || "").startsWith("image/")
    || /\.(jpe?g|png|webp|heic|heif)$/i.test(String(file?.name || ""));
}

function renderPhotoPreview() {
  els.girlsPhotoPreview.replaceChildren();
  const total = state.savedPhotos.length + state.pendingPhotos.length;
  els.girlsPhotoCount.textContent = `${total} of ${PHOTO_MAX_COUNT}`;

  if (!total) {
    setPhotoStatus("No photos yet. Take a photo or choose one from this device.");
    return;
  }

  state.savedPhotos.forEach((photo, index) => {
    const card = document.createElement("article");
    card.className = `girls-photo-card girls-photo-card-saved${photo.is_cover ? " is-cover" : ""}`;
    card.innerHTML = `
      <button type="button" class="girls-photo-view" data-view-saved-photo="${index}" aria-label="View saved photo ${index + 1}">
        <img src="${escapeAttribute(publicPhotoUrl(photo.storage_path))}" alt="Saved green-space photo ${index + 1}" loading="lazy">
        <span>${escapeHtml(photo.original_name || `Saved photo ${index + 1}`)}</span>
      </button>
      ${photo.is_cover
        ? '<span class="girls-cover-badge">Cover</span>'
        : `<button type="button" class="girls-photo-cover" data-set-cover-photo="${escapeAttribute(photo.id)}" title="Use as cover" aria-label="Use saved photo ${index + 1} as the cover">${coverIcon()}<span>Cover</span></button>`}
      <button type="button" class="girls-photo-remove" data-delete-photo="${escapeAttribute(photo.id)}" aria-label="Delete saved photo ${index + 1}" title="Delete photo">${deleteIcon()}</button>
    `;
    els.girlsPhotoPreview.append(card);
  });

  state.pendingPhotos.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "girls-photo-card is-pending";
    const view = document.createElement("button");
    view.type = "button";
    view.className = "girls-photo-view";
    view.dataset.viewPendingPhoto = String(index);
    view.setAttribute("aria-label", `View new photo ${index + 1}`);
    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.alt = `New green-space photo ${index + 1}`;
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
    image.addEventListener("error", () => URL.revokeObjectURL(objectUrl), { once: true });
    const caption = document.createElement("span");
    caption.textContent = file.name || `New photo ${index + 1}`;
    view.append(image, caption);
    const pending = document.createElement("span");
    pending.className = "girls-pending-badge";
    pending.textContent = "Not saved";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "girls-photo-remove";
    remove.dataset.removePendingPhoto = String(index);
    remove.setAttribute("aria-label", `Remove new photo ${index + 1}`);
    remove.title = "Remove photo";
    remove.innerHTML = deleteIcon();
    card.append(view, pending, remove);
    els.girlsPhotoPreview.append(card);
  });
  setPhotoStatus(state.pendingPhotos.length
    ? `${state.pendingPhotos.length} new ${state.pendingPhotos.length === 1 ? "photo is" : "photos are"} ready to save.`
    : "Select a photo to view it, change the cover, or delete it.");
}

async function handlePhotoAction(event) {
  const removePending = event.target.closest("[data-remove-pending-photo]");
  if (removePending) {
    state.pendingPhotos.splice(Number(removePending.dataset.removePendingPhoto), 1);
    renderPhotoPreview();
    return;
  }
  const viewPending = event.target.closest("[data-view-pending-photo]");
  if (viewPending) {
    openPhotoViewer("pending", Number(viewPending.dataset.viewPendingPhoto));
    return;
  }
  const viewSaved = event.target.closest("[data-view-saved-photo]");
  if (viewSaved) {
    openPhotoViewer("saved", Number(viewSaved.dataset.viewSavedPhoto));
    return;
  }
  const cover = event.target.closest("[data-set-cover-photo]");
  if (cover) await chooseCoverPhoto(cover.dataset.setCoverPhoto);
  const removeSaved = event.target.closest("[data-delete-photo]");
  if (removeSaved) await removeSavedPhoto(removeSaved.dataset.deletePhoto);
}

function openPhotoViewer(kind, index) {
  releasePhotoViewerUrl();
  if (kind === "pending") {
    const file = state.pendingPhotos[index];
    if (!file) return;
    state.activePhotoUrl = URL.createObjectURL(file);
    state.activePhotoIsObjectUrl = true;
    els.girlsPhotoViewerName.textContent = file.name || `New photo ${index + 1}`;
  } else {
    const photo = state.savedPhotos[index];
    if (!photo) return;
    state.activePhotoUrl = publicPhotoUrl(photo.storage_path);
    state.activePhotoIsObjectUrl = false;
    els.girlsPhotoViewerName.textContent = photo.original_name || `Saved photo ${index + 1}`;
  }
  els.girlsPhotoViewerImage.src = state.activePhotoUrl;
  if (typeof els.girlsPhotoViewer.showModal === "function") els.girlsPhotoViewer.showModal();
  else els.girlsPhotoViewer.setAttribute("open", "");
}

function closePhotoViewer() {
  if (typeof els.girlsPhotoViewer.close === "function" && els.girlsPhotoViewer.open) {
    els.girlsPhotoViewer.close();
  } else {
    els.girlsPhotoViewer.removeAttribute("open");
    releasePhotoViewerUrl();
  }
}

function releasePhotoViewerUrl() {
  if (state.activePhotoUrl && state.activePhotoIsObjectUrl) URL.revokeObjectURL(state.activePhotoUrl);
  state.activePhotoUrl = null;
  state.activePhotoIsObjectUrl = false;
  els.girlsPhotoViewerImage.removeAttribute("src");
  els.girlsPhotoViewerName.textContent = "";
}

function clearPendingPhotos() {
  state.pendingPhotos = [];
  els.girlsCameraPhoto.value = "";
  els.girlsGalleryPhoto.value = "";
  closePhotoViewer();
  renderPhotoPreview();
}

async function loadPhotoGallery() {
  const projectId = clean(els.girlsProjectPicker.value);
  state.savedPhotos = [];
  clearPendingPhotos();
  if (!projectId) {
    setPhotoStatus("Complete Project Start before adding photos.", true);
    return;
  }
  setPhotoStatus("Loading photos...");
  try {
    state.savedPhotos = await loadProjectPhotos(projectId);
    renderPhotoPreview();
  } catch (error) {
    setPhotoStatus(error.message || "The project photos could not be loaded.", true);
  }
}

async function chooseCoverPhoto(photoId) {
  const projectId = clean(els.girlsProjectPicker.value);
  if (!projectId || !photoId || state.submitting) return;
  state.submitting = true;
  setPhotoControlsDisabled(true);
  setPhotoStatus("Changing cover...");
  try {
    await setProjectCover({
      greenSpaceId: projectId,
      clientToken: clientToken(),
      photoId
    });
    state.savedPhotos = state.savedPhotos.map((photo) => ({
      ...photo,
      is_cover: photo.id === photoId
    }));
    renderPhotoPreview();
    setPhotoStatus("Cover photo updated.");
  } catch (error) {
    setPhotoStatus(error.message || "The cover photo could not be changed.", true);
  } finally {
    state.submitting = false;
    setPhotoControlsDisabled(false);
  }
}

async function removeSavedPhoto(photoId) {
  const photo = state.savedPhotos.find((item) => item.id === photoId);
  const projectId = clean(els.girlsProjectPicker.value);
  if (!photo || !projectId || state.submitting) return;
  if (!window.confirm("Delete this photo from the project?")) return;
  state.submitting = true;
  setPhotoControlsDisabled(true);
  setPhotoStatus("Deleting photo...");
  try {
    await deleteProjectPhoto({
      greenSpaceId: projectId,
      clientToken: clientToken(),
      photoId
    });
    state.savedPhotos = await loadProjectPhotos(projectId);
    renderPhotoPreview();
    setPhotoStatus("Photo deleted.");
  } catch (error) {
    setPhotoStatus(error.message || "The photo could not be deleted.", true);
  } finally {
    state.submitting = false;
    setPhotoControlsDisabled(false);
  }
}

function setPhotoControlsDisabled(disabled) {
  els.girlsTakePhoto.disabled = disabled;
  els.girlsChoosePhoto.disabled = disabled;
  els.girlsSubmit.disabled = disabled;
  els.girlsPhotoPreview.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
}

function coverIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></svg>';
}

function deleteIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>';
}

async function submitForm(event) {
  event.preventDefault();
  if (state.submitting) return;
  if (state.mode === "photos") {
    await savePendingPhotos();
    return;
  }
  try {
    const payload = buildPayload();
    state.submitting = true;
    els.girlsSubmit.disabled = true;
    setStatus("Saving...");
    const result = await submitGreenSpaceRecord(payload);
    const savedMode = state.mode;
    if (savedMode !== "project") state.ledger = null;
    if (state.mode === "project" && result.project?.id) {
      localStorage.setItem(LAST_PROJECT_KEY, result.project.id);
      await refreshProjects(result.project.id);
    }
    showSuccess(result);
    resetAfterSave();
    if (savedMode === "observation") await renderObservationHistory();
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message || "The entry could not be saved.", true);
  } finally {
    state.submitting = false;
    els.girlsSubmit.disabled = false;
  }
}

async function savePendingPhotos() {
  const projectId = clean(els.girlsProjectPicker.value);
  if (!projectId) {
    setStatus("Complete Project Start before adding photos.", true);
    return;
  }
  if (!state.pendingPhotos.length) {
    setStatus("Take a photo or choose one from this device.", true);
    return;
  }
  state.submitting = true;
  setPhotoControlsDisabled(true);
  try {
    const files = [...state.pendingPhotos];
    for (let index = 0; index < files.length; index += 1) {
      setStatus(`Preparing photo ${index + 1} of ${files.length}...`);
      setPhotoStatus(`Compressing photo ${index + 1} of ${files.length}...`);
      const blob = await compressGreenSpacePhoto(files[index]);
      setPhotoStatus(`Uploading photo ${index + 1} of ${files.length}...`);
      await uploadProjectPhoto({
        greenSpaceId: projectId,
        clientToken: clientToken(),
        fileName: String(files[index].name || `green-space-photo-${index + 1}.jpg`).slice(0, 255),
        photoDataUrl: await blobToDataUrl(blob)
      });
    }
    state.pendingPhotos = [];
    state.savedPhotos = await loadProjectPhotos(projectId);
    renderPhotoPreview();
    setStatus(`${files.length} ${files.length === 1 ? "photo" : "photos"} saved.`);
  } catch (error) {
    state.savedPhotos = await loadProjectPhotos(projectId).catch(() => state.savedPhotos);
    renderPhotoPreview();
    setStatus(error.message || "The photos could not be saved.", true);
  } finally {
    state.submitting = false;
    setPhotoControlsDisabled(false);
  }
}

function buildPayload() {
  const base = {
    action: state.mode === "project" ? "project" : "entry",
    entry_type: state.mode,
    submission_id: randomUuid(),
    client_token: clientToken(),
    website: clean(els.girlsWebsite.value),
    photo_data_url: null,
    latitude: state.gps?.latitude ?? null,
    longitude: state.gps?.longitude ?? null,
    user_agent: navigator.userAgent
  };

  if (state.mode === "project") {
    const participantName = required(els.girlsParticipantName, "Enter a name or initials.");
    const greenSpaceName = required(els.girlsGreenSpaceName, "Enter a name for the green space.");
    const intentions = required(els.girlsIntentions, "Write the project intentions.");
    const locationDescription = required(els.girlsLocationDescription, "Describe the location and why it was selected.");
    const visitSchedule = required(els.girlsVisitSchedule, "Enter the preliminary visit schedule.");
    if (!state.gps) throw focusError("Capture the green-space GPS location.", els.girlsCaptureGps);
    return {
      ...base,
      participant_name: participantName,
      green_space_name: greenSpaceName,
      intentions,
      location_description: locationDescription,
      visit_schedule: visitSchedule
    };
  }

  const greenSpaceId = clean(els.girlsProjectPicker.value);
  if (!greenSpaceId) {
    throw new Error("Complete Project Start before adding observations or reflections.");
  }
  const payload = { ...base, green_space_id: greenSpaceId };
  if (state.mode === "observation") {
    const observedAt = required(
      els.girlsObservationDateTime,
      "Enter the observation date and time."
    );
    const [observedOn, startTime] = observedAt.split("T");
    if (!observedOn || !startTime) {
      throw focusError("Enter the observation date and time.", els.girlsObservationDateTime);
    }
    return {
      ...payload,
      week_number: Number(els.girlsObservationWeek.value),
      observed_on: observedOn,
      start_time: startTime.slice(0, 5),
      end_time: null,
      observations: required(els.girlsObservationNotes, "Record what you noticed.")
    };
  }
  if (state.mode === "weekly_reflection") {
    return {
      ...payload,
      week_number: Number(els.girlsReflectionWeek.value),
      weekly_reflection: required(els.girlsWeeklyReflection, "Write the weekly distillation."),
      haiku: required(els.girlsWeeklyHaiku, "Draft a haiku from this week's observations.")
    };
  }
  return {
    ...payload,
    week_number: 8,
    favourite_haiku: required(els.girlsFavouriteHaiku, "Choose or enter a favourite haiku."),
    final_format: null,
    synthesis: required(els.girlsSynthesis, "Write the synthesis of observations."),
    key_learnings: required(els.girlsKeyLearnings, "Write the key learnings and examples."),
    overall_reflection: required(els.girlsOverallReflection, "Write the overall reflection.")
  };
}

function resetAfterSave() {
  els.girlsWebsite.value = "";
  clearPendingPhotos();
  state.gps = null;
  els.girlsLatitude.value = "";
  els.girlsLongitude.value = "";
  els.girlsGpsReadout.value = "No location captured";
  els.girlsCaptureGpsLabel.textContent = "Use GPS";
  if (state.mode === "project") {
    [
      els.girlsParticipantName, els.girlsGreenSpaceName, els.girlsIntentions,
      els.girlsLocationDescription, els.girlsVisitSchedule
    ].forEach((field) => { field.value = ""; });
  } else if (state.mode === "observation") {
    els.girlsObservationNotes.value = "";
    els.girlsObservationDateTime.value = localDateTimeValue(new Date());
  } else if (state.mode === "weekly_reflection") {
    els.girlsWeeklyReflection.value = "";
    els.girlsWeeklyHaiku.value = "";
  } else {
    els.girlsFavouriteHaiku.value = "";
    els.girlsSynthesis.value = "";
    els.girlsKeyLearnings.value = "";
    els.girlsOverallReflection.value = "";
    renderWordCount();
  }
}

async function renderObservationHistory() {
  const projectId = clean(els.girlsProjectPicker.value);
  state.observationRows = [];
  els.girlsObservationLog.innerHTML = "";
  els.girlsObservationCalendars.innerHTML = "";
  if (!projectId) {
    els.girlsObservationHistoryStatus.textContent = "Project Start required";
    els.girlsObservationLog.innerHTML = '<p class="girls-empty-copy">Complete Project Start before adding observations.</p>';
    return;
  }

  els.girlsObservationHistoryStatus.textContent = "Loading...";
  try {
    if (!state.ledger) state.ledger = await loadLedger();
    if (state.mode !== "observation" || clean(els.girlsProjectPicker.value) !== projectId) return;
    state.observationRows = state.ledger
      .filter((row) => row.green_space_id === projectId && row.entry_type === "observation")
      .sort(compareObservationRows);
    const count = state.observationRows.length;
    els.girlsObservationHistoryStatus.textContent = `${count} ${count === 1 ? "observation" : "observations"}`;
    renderObservationLog();
    renderObservationCalendars();
  } catch (error) {
    els.girlsObservationHistoryStatus.textContent = "Could not load";
    els.girlsObservationLog.innerHTML = `<p class="girls-empty-copy">${escapeHtml(error.message || "The observation log could not be loaded.")}</p>`;
  }
}

function renderObservationLog() {
  if (!state.observationRows.length) {
    els.girlsObservationLog.innerHTML = '<p class="girls-empty-copy">No observations have been added yet.</p>';
    return;
  }
  els.girlsObservationLog.innerHTML = state.observationRows.map((row) => `
    <article class="girls-observation-row" data-observation-date="${escapeAttribute(row.observed_on || "")}" tabindex="-1">
      <header>
        <div>
          <strong>${escapeHtml(formatObservationDate(row.observed_on))}</strong>
          <span>${row.week_number ? `Week ${escapeHtml(row.week_number)}` : ""}</span>
        </div>
        <time>${escapeHtml(formatObservationTime(row.start_time))}</time>
      </header>
      <div class="girls-observation-body">
        <p>${escapeHtml(row.observations || "")}</p>
        ${row.photo_path ? `<img src="${escapeAttribute(publicPhotoUrl(row.photo_path))}" alt="Observation photo from ${escapeAttribute(formatObservationDate(row.observed_on))}" loading="lazy">` : ""}
      </div>
    </article>
  `).join("");
}

function renderObservationCalendars() {
  const rowsByMonth = new Map();
  state.observationRows.forEach((row) => {
    const date = clean(row.observed_on);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const month = date.slice(0, 7);
    if (!rowsByMonth.has(month)) rowsByMonth.set(month, []);
    rowsByMonth.get(month).push(row);
  });
  if (!rowsByMonth.size) {
    els.girlsObservationCalendars.innerHTML = '<p class="girls-empty-copy">Months will appear after the first observation.</p>';
    return;
  }
  els.girlsObservationCalendars.innerHTML = [...rowsByMonth.entries()]
    .sort(([first], [second]) => second.localeCompare(first))
    .map(([month, rows]) => renderCalendarMonth(month, rows))
    .join("");
}

function renderCalendarMonth(month, rows) {
  const [year, monthNumber] = month.split("-").map(Number);
  const counts = new Map();
  rows.forEach((row) => {
    const date = clean(row.observed_on);
    counts.set(date, (counts.get(date) || 0) + 1);
  });
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const cells = Array.from({ length: firstWeekday }, () => '<span class="is-empty" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const count = counts.get(date) || 0;
    cells.push(count
      ? `<button type="button" data-calendar-date="${date}" title="${count} ${count === 1 ? "observation" : "observations"}"><span>${day}</span><strong>${count}</strong></button>`
      : `<span><span>${day}</span></span>`);
  }
  const title = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" })
    .format(new Date(year, monthNumber - 1, 1));
  return `
    <section class="girls-calendar-month">
      <h4>${escapeHtml(title)}</h4>
      <div class="girls-calendar-weekdays" aria-hidden="true">
        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
      </div>
      <div class="girls-calendar-grid">${cells.join("")}</div>
    </section>
  `;
}

function focusObservationDate(event) {
  const button = event.target.closest("[data-calendar-date]");
  if (!button) return;
  const row = els.girlsObservationLog.querySelector(
    `[data-observation-date="${CSS.escape(button.dataset.calendarDate)}"]`
  );
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.focus?.({ preventScroll: true });
}

function compareObservationRows(first, second) {
  const firstValue = `${first.observed_on || ""}T${first.start_time || "00:00"}`;
  const secondValue = `${second.observed_on || ""}T${second.start_time || "00:00"}`;
  return secondValue.localeCompare(firstValue);
}

function formatObservationDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatObservationTime(value) {
  if (!value) return "";
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return "";
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(2000, 0, 1, hours, minutes));
}

async function renderFinalReview() {
  const projectId = els.girlsProjectPicker.value;
  state.finalReviewRows = [];
  els.girlsFinalReviewList.innerHTML = "";
  if (!projectId) {
    els.girlsFinalReviewStatus.textContent = "Complete Project Start to review saved distillations and haiku.";
    return;
  }

  els.girlsFinalReviewStatus.textContent = "Loading your six-week review...";
  try {
    if (!state.ledger) state.ledger = await loadLedger();
    if (state.mode !== "final_reflection" || els.girlsProjectPicker.value !== projectId) return;
    state.finalReviewRows = state.ledger
      .filter((row) => row.green_space_id === projectId && row.entry_type === "weekly_reflection")
      .sort((a, b) => Number(a.week_number || 0) - Number(b.week_number || 0));
    if (!state.finalReviewRows.length) {
      els.girlsFinalReviewStatus.textContent = "No weekly distillations or haiku have been saved yet.";
      return;
    }
    els.girlsFinalReviewStatus.textContent = `${state.finalReviewRows.length} of 7 weekly entries available.`;
    els.girlsFinalReviewList.innerHTML = state.finalReviewRows.map((row, index) => `
      <article class="girls-review-row">
        <header>
          <strong>Week ${escapeHtml(row.week_number)}</strong>
          ${row.haiku ? `<button type="button" data-favourite-haiku="${index}">Use as favourite</button>` : ""}
        </header>
        <p>${escapeHtml(row.weekly_reflection || "No distillation recorded.")}</p>
        ${row.haiku ? `<blockquote>${escapeHtml(row.haiku)}</blockquote>` : ""}
      </article>
    `).join("");
  } catch (error) {
    els.girlsFinalReviewStatus.textContent = error.message || "The weekly review could not be loaded.";
  }
}

function selectFavouriteHaiku(event) {
  const button = event.target.closest("[data-favourite-haiku]");
  if (!button) return;
  const row = state.finalReviewRows[Number(button.dataset.favouriteHaiku)];
  if (!row?.haiku) return;
  els.girlsFavouriteHaiku.value = row.haiku;
  els.girlsFavouriteHaiku.focus();
}

function showSuccess(result) {
  const isProject = Boolean(result.project);
  els.girlsSuccessMessage.textContent = isProject
    ? "Your green space is ready. Use the code below when discussing the project."
    : state.mode === "observation"
      ? "Your observation has been saved."
      : "Your reflection has been saved.";
  els.girlsSuccessCode.hidden = !isProject;
  els.girlsSuccessCode.textContent = result.project?.public_code || "";
  if (typeof els.girlsSuccessDialog.showModal === "function") {
    els.girlsSuccessDialog.showModal();
  } else {
    els.girlsSuccessDialog.setAttribute("open", "");
  }
}

function closeSuccessDialog() {
  if (typeof els.girlsSuccessDialog.close === "function") els.girlsSuccessDialog.close();
  else els.girlsSuccessDialog.removeAttribute("open");
}

function addAnotherEntry() {
  closeSuccessDialog();
  setMode("observation");
  document.querySelector(".girls-mode-picker")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWordCount() {
  const count = [els.girlsSynthesis, els.girlsKeyLearnings, els.girlsOverallReflection]
    .map((field) => clean(field.value))
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  els.girlsFinalWordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
  els.girlsFinalWordCount.classList.toggle("is-low", count > 0 && count < 200);
  els.girlsFinalWordCount.classList.toggle("is-high", count > 300);
}

async function compressGreenSpacePhoto(file) {
  const image = await loadGreenSpaceImage(file);
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("The selected photo could not be opened.");
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
  throw new Error("The photo could not be reduced below 700 KB.");
}

function loadGreenSpaceImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected photo could not be opened. Try a JPEG image."));
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The photo preview could not be created."));
    reader.readAsDataURL(blob);
  });
}

function setPhotoStatus(message, error = false) {
  els.girlsPhotoStatus.textContent = message;
  els.girlsPhotoStatus.classList.toggle("is-error", error);
}

function required(element, message) {
  const value = clean(element.value);
  if (!value) throw focusError(message, element);
  return value;
}

function focusError(message, element) {
  element?.focus?.();
  return new Error(message);
}

function setStatus(message, error = false) {
  els.girlsFormStatus.textContent = message;
  els.girlsFormStatus.classList.toggle("is-error", error);
}

function clientToken() {
  let token = localStorage.getItem(CLIENT_TOKEN_KEY);
  if (!token) {
    token = randomUuid();
    localStorage.setItem(CLIENT_TOKEN_KEY, token);
  }
  return token;
}

function randomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    const value = character === "x" ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
