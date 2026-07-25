import {
  deleteProjectPhoto,
  loadLedger,
  loadProjectPhotos,
  loadProjects,
  publicPhotoUrl,
  setProjectCover,
  submitGreenSpaceRecord,
  uploadProjectPhoto
} from "./green_space_api.js?v=6";

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
  observationDateFilter: null,
  observationPhoto: null,
  observationPhotoUrl: null,
  observationExistingPhotoPath: null,
  editingObservationId: null,
  projectEditing: false,
  finalReviewRows: [],
  pendingPhotos: [],
  savedPhotos: [],
  activePhotoUrl: null,
  activePhotoIsObjectUrl: false,
  gps: null,
  finalAction: "draft",
  finalLocked: false,
  submitting: false
};

const els = {};

document.addEventListener("DOMContentLoaded", initialise, { once: true });

async function initialise() {
  [
    "girlsReflectionForm", "girlsProjectPicker",
    "girlsEditProject", "girlsParticipantName", "girlsGreenSpaceName", "girlsIntentions", "girlsLocationDescription",
    "girlsVisitSchedule", "girlsShowOnMap", "girlsShowParticipantName", "girlsShowParticipantNameOption",
    "girlsProgramDetails", "girlsObservationWeek", "girlsObservationDateTime", "girlsObservationNotes",
    "girlsObservationHeading", "girlsCancelObservationEdit",
    "girlsTakeObservationPhoto", "girlsChooseObservationPhoto", "girlsObservationCameraPhoto",
    "girlsObservationGalleryPhoto", "girlsObservationPhotoPreview",
    "girlsReflectionWeek", "girlsWeeklyReflection",
    "girlsWeeklyReferenceStatus", "girlsWeeklyReferenceList",
    "girlsWeeklyHaiku", "girlsFinalReviewStatus", "girlsFinalReviewList", "girlsFavouriteHaiku",
    "girlsSynthesis", "girlsKeyLearnings", "girlsOverallReflection", "girlsFinalWordCount",
    "girlsFinalSubmissionStatus", "girlsFinalSubmit",
    "girlsLocationTools", "girlsCaptureGps", "girlsCaptureGpsLabel", "girlsGpsReadout", "girlsLatitude", "girlsLongitude",
    "girlsPhotoTools", "girlsTakePhoto", "girlsChoosePhoto", "girlsCameraPhoto", "girlsGalleryPhoto",
    "girlsPhotoCount", "girlsPhotoStatus", "girlsPhotoPreview", "girlsPhotoViewer", "girlsPhotoViewerImage",
    "girlsPhotoViewerName", "girlsClosePhotoViewer",
    "girlsWebsite", "girlsSubmit", "girlsFormStatus", "girlsObservationHistory",
    "girlsObservationHistoryStatus", "girlsShowAllObservations", "girlsObservationLog", "girlsObservationCalendars",
    "girlsSuccessDialog", "girlsCloseSuccess", "girlsSuccessMessage", "girlsAddAnother"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  document.querySelectorAll("[data-entry-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.entryMode));
  });
  els.girlsEditProject.addEventListener("click", editProjectStart);
  els.girlsShowOnMap.addEventListener("change", syncMapSharingControls);
  els.girlsCaptureGps.addEventListener("click", captureGps);
  els.girlsTakePhoto.addEventListener("click", () => els.girlsCameraPhoto.click());
  els.girlsChoosePhoto.addEventListener("click", () => els.girlsGalleryPhoto.click());
  els.girlsTakeObservationPhoto.addEventListener("click", () => els.girlsObservationCameraPhoto.click());
  els.girlsChooseObservationPhoto.addEventListener("click", () => els.girlsObservationGalleryPhoto.click());
  els.girlsCameraPhoto.addEventListener("change", selectPhotos);
  els.girlsGalleryPhoto.addEventListener("change", selectPhotos);
  els.girlsObservationCameraPhoto.addEventListener("change", selectObservationPhoto);
  els.girlsObservationGalleryPhoto.addEventListener("change", selectObservationPhoto);
  els.girlsObservationPhotoPreview.addEventListener("click", handleObservationPhotoPreview);
  els.girlsPhotoPreview.addEventListener("click", handlePhotoAction);
  els.girlsClosePhotoViewer.addEventListener("click", closePhotoViewer);
  els.girlsPhotoViewer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePhotoViewer();
  });
  els.girlsPhotoViewer.addEventListener("close", releasePhotoViewerUrl);
  els.girlsObservationCalendars.addEventListener("click", focusObservationDate);
  els.girlsObservationLog.addEventListener("click", handleObservationLogAction);
  els.girlsShowAllObservations.addEventListener("click", clearObservationDateFilter);
  els.girlsCancelObservationEdit.addEventListener("click", cancelObservationEdit);
  els.girlsFinalReviewList.addEventListener("click", selectFavouriteHaiku);
  els.girlsReflectionForm.addEventListener("submit", submitForm);
  els.girlsFinalSubmit.addEventListener("click", submitFinalReflection);
  els.girlsCloseSuccess.addEventListener("click", closeSuccessDialog);
  els.girlsAddAnother.addEventListener("click", addAnotherEntry);
  [els.girlsSynthesis, els.girlsKeyLearnings, els.girlsOverallReflection]
    .forEach((field) => field.addEventListener("input", renderWordCount));
  els.girlsObservationDateTime.addEventListener("change", selectSuggestedObservationWeek);
  els.girlsReflectionWeek.addEventListener("change", renderWeeklyReference);

  els.girlsObservationDateTime.value = localDateTimeValue(new Date());
  setMode("project");
  renderWordCount();
  await refreshProjects();
}

async function refreshProjects(selectedId = localStorage.getItem(LAST_PROJECT_KEY)) {
  try {
    state.projects = await loadProjects(clientToken());
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
    : "";
  els.girlsProjectPicker.value = activeId;
  if (activeId) {
    localStorage.setItem(LAST_PROJECT_KEY, activeId);
  }
  populateProjectForm();
  selectSuggestedObservationWeek();
  selectSuggestedReflectionWeek();
}

function setMode(mode) {
  if (!["project", "observation", "photos", "weekly_reflection", "final_reflection"].includes(mode)) return;
  const previousMode = state.mode;
  if (previousMode === "observation" && mode !== "observation") {
    resetObservationEditor();
  }
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
  els.girlsProgramDetails.hidden = mode !== "project";
  els.girlsFinalSubmit.hidden = mode !== "final_reflection" || state.finalLocked;
  els.girlsSubmit.hidden = mode === "final_reflection" && state.finalLocked;
  els.girlsSubmit.textContent = {
    project: activeProject() ? "Save Project Start" : "Start my log",
    observation: "Add observation",
    photos: "Save new photos",
    weekly_reflection: "Save distillation + haiku",
    final_reflection: "Save draft"
  }[mode];
  if (mode === "project") populateProjectForm();
  if (mode === "observation") {
    state.observationDateFilter = null;
    if (previousMode !== "observation") resetObservationEditor();
    renderObservationHistory();
  }
  if (mode === "photos") loadPhotoGallery();
  if (mode === "weekly_reflection") {
    selectSuggestedReflectionWeek();
    renderWeeklyReference();
  }
  if (mode === "final_reflection") renderFinalReview();
  setStatus("");
}

function activeProject() {
  const projectId = clean(els.girlsProjectPicker.value);
  return state.projects.find((project) => project.id === projectId) || null;
}

function populateProjectForm() {
  const project = activeProject();
  els.girlsSubmit.textContent = project ? "Save Project Start" : "Start my log";
  if (!project) {
    els.girlsShowOnMap.checked = true;
    els.girlsShowParticipantName.checked = false;
    setProjectEditing(true);
    syncMapSharingControls();
    return;
  }
  els.girlsParticipantName.value = project.participant_name || "";
  els.girlsGreenSpaceName.value = project.green_space_name || "";
  els.girlsIntentions.value = project.intentions || "";
  els.girlsLocationDescription.value = project.location_description || "";
  els.girlsVisitSchedule.value = project.visit_schedule || "";
  els.girlsShowOnMap.checked = project.show_on_map !== false;
  els.girlsShowParticipantName.checked = project.show_participant_name === true;
  const latitude = Number(project.latitude);
  const longitude = Number(project.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    state.gps = { latitude, longitude, accuracy: null };
    els.girlsLatitude.value = String(latitude);
    els.girlsLongitude.value = String(longitude);
    els.girlsGpsReadout.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  }
  setProjectEditing(false);
}

function editProjectStart() {
  if (!activeProject()) return;
  setProjectEditing(true);
  els.girlsParticipantName.focus();
  setStatus("Edit the Project Start details, then save.");
}

function setProjectEditing(editing) {
  const project = activeProject();
  state.projectEditing = Boolean(editing);
  [
    els.girlsParticipantName,
    els.girlsGreenSpaceName,
    els.girlsIntentions,
    els.girlsLocationDescription,
    els.girlsVisitSchedule
  ].forEach((field) => {
    field.readOnly = Boolean(project) && !state.projectEditing;
    field.setAttribute("aria-readonly", String(field.readOnly));
  });
  els.girlsCaptureGps.disabled = Boolean(project) && !state.projectEditing;
  els.girlsShowOnMap.disabled = Boolean(project) && !state.projectEditing;
  syncMapSharingControls();
  els.girlsEditProject.hidden = !project || state.projectEditing || !project.can_manage;
  if (state.mode === "project") {
    els.girlsSubmit.hidden = Boolean(project) && !state.projectEditing;
  }
}

function syncMapSharingControls() {
  const project = activeProject();
  const projectLocked = Boolean(project) && !state.projectEditing;
  const nameUnavailable = !els.girlsShowOnMap.checked;
  els.girlsShowParticipantName.disabled = projectLocked || nameUnavailable;
  els.girlsShowParticipantNameOption.classList.toggle("is-unavailable", nameUnavailable);
}

function suggestedWeek(targetDate = new Date()) {
  const created = new Date(activeProject()?.created_at || "");
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
  if (Number.isNaN(created.getTime()) || Number.isNaN(target.getTime())) return 1;
  const elapsedDays = Math.floor((startOfDay(target) - startOfDay(created)) / 86400000);
  return Math.min(7, Math.max(1, Math.floor(elapsedDays / 7) + 1));
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function selectSuggestedObservationWeek() {
  const value = els.girlsObservationDateTime.value;
  const observedAt = value ? new Date(value) : new Date();
  els.girlsObservationWeek.value = String(suggestedWeek(observedAt));
}

function selectSuggestedReflectionWeek() {
  els.girlsReflectionWeek.value = String(suggestedWeek(new Date()));
}

async function captureGps() {
  if (!navigator.geolocation) {
    setStatus("GPS is not available in this browser.", true);
    return;
  }
  els.girlsCaptureGps.disabled = true;
  els.girlsCaptureGpsLabel.textContent = "Capturing...";
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
      els.girlsCaptureGpsLabel.textContent = "Capture GPS";
      setStatus("Location captured.");
    },
    (error) => {
      els.girlsCaptureGps.disabled = false;
      els.girlsCaptureGpsLabel.textContent = "Capture GPS";
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

function selectObservationPhoto(event) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    setStatus("Choose an image for the observation photo.", true);
    return;
  }
  clearObservationPhoto();
  state.observationPhoto = file;
  state.observationPhotoUrl = URL.createObjectURL(file);
  els.girlsObservationPhotoPreview.hidden = false;
  els.girlsObservationPhotoPreview.innerHTML = `
    <img src="${escapeAttribute(state.observationPhotoUrl)}" alt="Selected observation photo">
    <button type="button" data-clear-observation-photo>Remove</button>
  `;
  setStatus("Observation photo ready.");
}

function handleObservationPhotoPreview(event) {
  if (event.target.closest("[data-clear-observation-photo]")) {
    clearObservationPhoto();
    if (state.observationExistingPhotoPath) {
      renderExistingObservationPhoto();
    }
  }
}

function renderExistingObservationPhoto() {
  if (!state.observationExistingPhotoPath) return;
  els.girlsObservationPhotoPreview.hidden = false;
  els.girlsObservationPhotoPreview.innerHTML = `
    <img src="${escapeAttribute(publicPhotoUrl(state.observationExistingPhotoPath))}" alt="Current observation photo">
    <span>Current photo</span>
  `;
}

function clearObservationPhoto() {
  if (state.observationPhotoUrl) URL.revokeObjectURL(state.observationPhotoUrl);
  state.observationPhoto = null;
  state.observationPhotoUrl = null;
  if (els.girlsObservationCameraPhoto) els.girlsObservationCameraPhoto.value = "";
  if (els.girlsObservationGalleryPhoto) els.girlsObservationGalleryPhoto.value = "";
  if (els.girlsObservationPhotoPreview) {
    els.girlsObservationPhotoPreview.hidden = true;
    els.girlsObservationPhotoPreview.replaceChildren();
  }
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
  if (state.mode === "project" && activeProject() && !state.projectEditing) {
    setStatus("Use the pencil to edit Project Start.");
    return;
  }
  if (state.mode === "photos") {
    await savePendingPhotos();
    return;
  }
  try {
    let photoDataUrl = null;
    if (state.mode === "observation" && state.observationPhoto) {
      setStatus("Preparing observation photo...");
      photoDataUrl = await blobToDataUrl(await compressGreenSpacePhoto(state.observationPhoto));
    }
    const payload = buildPayload(photoDataUrl);
    state.submitting = true;
    els.girlsSubmit.disabled = true;
    els.girlsFinalSubmit.disabled = true;
    setStatus("Saving...");
    const result = await submitGreenSpaceRecord(payload);
    const savedMode = state.mode;
    if (savedMode !== "project") state.ledger = null;
    if (savedMode === "project" && result.project?.id) {
      localStorage.setItem(LAST_PROJECT_KEY, result.project.id);
      await refreshProjects(result.project.id);
    }
    if (savedMode === "final_reflection") {
      await refreshProjects(els.girlsProjectPicker.value);
    }
    showSuccess(result);
    resetAfterSave();
    if (savedMode === "observation") await renderObservationHistory();
    if (savedMode === "weekly_reflection") await renderWeeklyReference();
    if (savedMode === "final_reflection") await renderFinalReview();
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message || "The entry could not be saved.", true);
  } finally {
    state.submitting = false;
    els.girlsSubmit.disabled = false;
    els.girlsFinalSubmit.disabled = false;
    state.finalAction = "draft";
  }
}

function submitFinalReflection() {
  if (state.finalLocked || state.submitting) return;
  const confirmed = window.confirm(
    "Submit the final reflection?\n\n"
      + "You can save a draft instead. After final submission, this reflection cannot be edited."
  );
  if (!confirmed) return;
  state.finalAction = "submit";
  els.girlsReflectionForm.requestSubmit();
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

function buildPayload(photoDataUrl = null) {
  const project = activeProject();
  const observationUpdate = state.mode === "observation" && state.editingObservationId;
  const base = {
    action: state.mode === "project"
      ? (project ? "project_update" : "project")
      : observationUpdate
        ? "observation_update"
        : "entry",
    entry_type: state.mode,
    submission_id: randomUuid(),
    client_token: clientToken(),
    website: clean(els.girlsWebsite.value),
    photo_data_url: photoDataUrl,
    latitude: state.mode === "project" ? state.gps?.latitude ?? null : null,
    longitude: state.mode === "project" ? state.gps?.longitude ?? null : null,
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
      green_space_id: project?.id || null,
      participant_name: participantName,
      green_space_name: greenSpaceName,
      intentions,
      location_description: locationDescription,
      visit_schedule: visitSchedule,
      show_on_map: els.girlsShowOnMap.checked,
      show_participant_name: els.girlsShowOnMap.checked && els.girlsShowParticipantName.checked
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
      ...(observationUpdate ? { entry_id: state.editingObservationId } : {}),
      week_number: Number(els.girlsObservationWeek.value),
      observed_on: observedOn,
      start_time: startTime.slice(0, 5),
      end_time: null,
      observations: required(els.girlsObservationNotes, "Record what you noticed."),
      photo_name: state.observationPhoto?.name || null
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
    final_action: state.finalAction,
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
  if (state.mode === "project") {
    populateProjectForm();
  } else if (state.mode === "observation") {
    state.observationDateFilter = null;
    els.girlsShowAllObservations.hidden = true;
    resetObservationEditor();
  } else if (state.mode === "weekly_reflection") {
    selectSuggestedReflectionWeek();
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
    if (!state.ledger) state.ledger = await loadLedger(clientToken());
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
  const rows = state.observationDateFilter
    ? state.observationRows.filter((row) => row.observed_on === state.observationDateFilter)
    : state.observationRows;
  if (!rows.length) {
    els.girlsObservationLog.innerHTML = '<p class="girls-empty-copy">No observations have been added yet.</p>';
    return;
  }
  els.girlsObservationLog.innerHTML = rows.map((row) => `
    <article class="girls-observation-row" data-observation-date="${escapeAttribute(row.observed_on || "")}" tabindex="-1">
      <header>
        <div>
          <button type="button" class="girls-observation-date-action" data-observation-date-filter="${escapeAttribute(row.observed_on || "")}">${escapeHtml(formatObservationDate(row.observed_on))}</button>
          <span>${row.week_number ? `Week ${escapeHtml(row.week_number)}` : ""}</span>
        </div>
        <div class="girls-observation-row-actions">
          <time>${escapeHtml(formatObservationTime(row.start_time))}</time>
          ${row.can_manage ? `
            <button type="button" class="girls-icon-action" data-edit-observation="${escapeAttribute(row.id)}" title="Edit observation" aria-label="Edit observation from ${escapeAttribute(formatObservationDate(row.observed_on))}">
              ${editIcon()}
            </button>
          ` : ""}
        </div>
      </header>
      <div class="girls-observation-body">
        <p>${escapeHtml(row.observations || "")}</p>
        ${row.photo_path ? `<img src="${escapeAttribute(publicPhotoUrl(row.photo_path))}" alt="Observation photo from ${escapeAttribute(formatObservationDate(row.observed_on))}" loading="lazy">` : ""}
      </div>
    </article>
  `).join("");
}

function handleObservationLogAction(event) {
  const editButton = event.target.closest("[data-edit-observation]");
  if (editButton) {
    editObservation(editButton.dataset.editObservation);
    return;
  }
  const dateButton = event.target.closest("[data-observation-date-filter]");
  if (dateButton) {
    applyObservationDateFilter(dateButton.dataset.observationDateFilter);
  }
}

function editObservation(recordId) {
  const row = state.observationRows.find(
    (observation) => observation.id === recordId && observation.can_manage
  );
  if (!row) return;
  clearObservationPhoto();
  state.editingObservationId = row.id;
  state.observationExistingPhotoPath = row.photo_path || null;
  els.girlsObservationWeek.value = String(row.week_number || 1);
  els.girlsObservationDateTime.value = observationDateTimeValue(row);
  els.girlsObservationNotes.value = row.observations || "";
  els.girlsObservationHeading.textContent = "Edit observation";
  els.girlsSubmit.textContent = "Save observation";
  els.girlsCancelObservationEdit.hidden = false;
  renderExistingObservationPhoto();
  setStatus(`Editing the observation from ${formatObservationDate(row.observed_on)}.`);
  document.querySelector('[data-mode-panel="observation"]')
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  els.girlsObservationNotes.focus({ preventScroll: true });
}

function cancelObservationEdit() {
  resetObservationEditor();
  setStatus("Observation edit cancelled.");
}

function resetObservationEditor() {
  state.editingObservationId = null;
  state.observationExistingPhotoPath = null;
  clearObservationPhoto();
  els.girlsObservationHeading.textContent = "Add observation";
  els.girlsObservationNotes.value = "";
  els.girlsObservationDateTime.value = localDateTimeValue(new Date());
  selectSuggestedObservationWeek();
  els.girlsCancelObservationEdit.hidden = true;
  if (state.mode === "observation") els.girlsSubmit.textContent = "Add observation";
}

function observationDateTimeValue(row) {
  const date = clean(row.observed_on);
  const time = clean(row.start_time).slice(0, 5);
  if (!date || !time) return localDateTimeValue(new Date());
  return `${date}T${time}`;
}

function editIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>';
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
      ? `<button type="button" class="${state.observationDateFilter === date ? "is-selected" : ""}" data-calendar-date="${date}" title="${count} ${count === 1 ? "observation" : "observations"}"><span>${day}</span><strong>${count}</strong></button>`
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
  applyObservationDateFilter(button.dataset.calendarDate);
}

function applyObservationDateFilter(date) {
  state.observationDateFilter = date;
  const count = state.observationRows.filter(
    (row) => row.observed_on === state.observationDateFilter
  ).length;
  els.girlsObservationHistoryStatus.textContent = `${count} on ${formatObservationDate(state.observationDateFilter)}`;
  els.girlsShowAllObservations.hidden = false;
  renderObservationLog();
  renderObservationCalendars();
  const row = els.girlsObservationLog.querySelector(
    `[data-observation-date="${CSS.escape(date)}"]`
  );
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.focus?.({ preventScroll: true });
}

function clearObservationDateFilter() {
  state.observationDateFilter = null;
  const count = state.observationRows.length;
  els.girlsObservationHistoryStatus.textContent = `${count} ${count === 1 ? "observation" : "observations"}`;
  els.girlsShowAllObservations.hidden = true;
  renderObservationLog();
  renderObservationCalendars();
}

async function renderWeeklyReference() {
  const projectId = clean(els.girlsProjectPicker.value);
  const week = Number(els.girlsReflectionWeek.value);
  els.girlsWeeklyReferenceList.innerHTML = "";
  if (!projectId) {
    els.girlsWeeklyReferenceStatus.textContent = "Project Start required";
    return;
  }
  els.girlsWeeklyReferenceStatus.textContent = "Loading...";
  try {
    if (!state.ledger) state.ledger = await loadLedger(clientToken());
    if (state.mode !== "weekly_reflection" || clean(els.girlsProjectPicker.value) !== projectId) return;
    const rows = state.ledger
      .filter((row) => (
        row.green_space_id === projectId
        && row.entry_type === "observation"
        && Number(row.week_number) === week
      ))
      .sort(compareObservationRows);
    els.girlsWeeklyReferenceStatus.textContent = `${rows.length} ${rows.length === 1 ? "observation" : "observations"}`;
    els.girlsWeeklyReferenceList.className = "girls-week-reference-list";
    els.girlsWeeklyReferenceList.innerHTML = rows.map((row) => `
      <article class="girls-week-reference-item">
        <div>
          <small>${escapeHtml(formatObservationDate(row.observed_on))} at ${escapeHtml(formatObservationTime(row.start_time))}</small>
          <p>${escapeHtml(row.observations || "")}</p>
        </div>
        ${row.photo_path ? `<img src="${escapeAttribute(publicPhotoUrl(row.photo_path))}" alt="Observation photo from ${escapeAttribute(formatObservationDate(row.observed_on))}" loading="lazy">` : ""}
      </article>
    `).join("") || '<p class="girls-empty-copy">No observations have been saved for this week yet.</p>';
  } catch (error) {
    els.girlsWeeklyReferenceStatus.textContent = "Could not load";
    els.girlsWeeklyReferenceList.innerHTML = `<p class="girls-empty-copy">${escapeHtml(error.message || "The weekly observations could not be loaded.")}</p>`;
  }
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
    setFinalLock(false);
    els.girlsFinalSubmissionStatus.hidden = false;
    els.girlsFinalSubmissionStatus.textContent = "Complete Project Start before writing the final reflection.";
    els.girlsFinalReviewStatus.textContent = "Complete Project Start to review saved distillations and haiku.";
    return;
  }

  els.girlsFinalReviewStatus.textContent = "Loading your six-week review...";
  try {
    if (!state.ledger) state.ledger = await loadLedger(clientToken());
    if (state.mode !== "final_reflection" || els.girlsProjectPicker.value !== projectId) return;
    const finalRow = state.ledger
      .filter((row) => row.green_space_id === projectId && row.entry_type === "final_reflection")
      .sort((first, second) => String(second.created_at).localeCompare(String(first.created_at)))[0] || null;
    populateFinalDraft(finalRow);
    setFinalLock(Boolean(activeProject()?.final_submitted_at));
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
    setFinalLock(state.finalLocked);
  } catch (error) {
    els.girlsFinalReviewStatus.textContent = error.message || "The weekly review could not be loaded.";
  }
}

function populateFinalDraft(row) {
  els.girlsFavouriteHaiku.value = row?.favourite_haiku || "";
  els.girlsSynthesis.value = row?.synthesis || "";
  els.girlsKeyLearnings.value = row?.key_learnings || "";
  els.girlsOverallReflection.value = row?.overall_reflection || "";
  renderWordCount();
}

function setFinalLock(locked) {
  state.finalLocked = locked;
  [
    els.girlsFavouriteHaiku,
    els.girlsSynthesis,
    els.girlsKeyLearnings,
    els.girlsOverallReflection
  ].forEach((field) => {
    field.disabled = locked;
  });
  els.girlsFinalReviewList.querySelectorAll("[data-favourite-haiku]").forEach((button) => {
    button.disabled = locked;
  });
  els.girlsSubmit.hidden = locked;
  els.girlsFinalSubmit.hidden = locked;
  els.girlsFinalSubmissionStatus.hidden = false;
  els.girlsFinalSubmissionStatus.classList.toggle("is-submitted", locked);
  els.girlsFinalSubmissionStatus.textContent = locked
    ? "Final reflection submitted. It is now read-only."
    : "Save a draft as often as needed. Final submission is locked after confirmation.";
}

function selectFavouriteHaiku(event) {
  const button = event.target.closest("[data-favourite-haiku]");
  if (!button || state.finalLocked) return;
  const row = state.finalReviewRows[Number(button.dataset.favouriteHaiku)];
  if (!row?.haiku) return;
  els.girlsFavouriteHaiku.value = row.haiku;
  els.girlsFavouriteHaiku.focus();
}

function showSuccess(result) {
  const isProject = Boolean(result.project);
  els.girlsAddAnother.textContent = state.mode === "observation"
    ? "Add another observation"
    : "Add another entry";
  els.girlsSuccessMessage.textContent = isProject
      ? result.updated
      ? "Project Start details updated."
      : "Your green space is ready."
    : state.mode === "observation"
      ? result.updated
        ? "Your observation has been updated."
        : "Your observation has been saved."
      : state.mode === "final_reflection"
        ? result.final_submitted
          ? "Your final reflection has been submitted."
          : "Your final reflection draft has been saved."
        : "Your reflection has been saved.";
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
