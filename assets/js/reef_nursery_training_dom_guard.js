const TRAINING_PHOTO_MESSAGE =
  "Training photo upload is unavailable in the shared Public/authenticated Training workspace. The Photos tab and existing private Storage boundary remain unchanged.";
const PARTICIPANT_REFERENCE_MAX_LENGTH = 100;
let syncScheduled = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseDomGuards, { once: true });
} else {
  initialiseDomGuards();
}

function initialiseDomGuards() {
  document.addEventListener("keydown", protectParticipantKeyboardContract, true);
  document.addEventListener("click", protectTrainingPhotoActions, true);
  document.addEventListener("change", protectTrainingPhotoInputs, true);

  const observer = new MutationObserver(scheduleDomSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "disabled", "maxlength"]
  });
  scheduleDomSync();
}

function scheduleDomSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    syncDomContracts();
  });
}

function syncDomContracts() {
  document.querySelectorAll('[data-participant-field="reference"]').forEach((control) => {
    if (control.maxLength !== PARTICIPANT_REFERENCE_MAX_LENGTH) {
      control.maxLength = PARTICIPANT_REFERENCE_MAX_LENGTH;
    }
  });

  // Keep one clear signed-out Sign in path: Public uses the explicit toolbar
  // action; Review hides sign-in; denied access uses the gate action. Hide the
  // generic navigation profile fallback on this page.
  const reviewMode = isReviewMode();
  const accessGate = document.getElementById("reefAccessGate");
  const deniedMode = Boolean(accessGate && !accessGate.hidden);
  const publicNotice = document.getElementById("reefPublicNotice");
  const publicMode = Boolean(publicNotice && !publicNotice.hidden && !reviewMode && !deniedMode);
  const toolbarSignIn = document.getElementById("reefSignInAction");
  const hideToolbarSignIn = !publicMode;
  if (toolbarSignIn && toolbarSignIn.hidden !== hideToolbarSignIn) {
    toolbarSignIn.hidden = hideToolbarSignIn;
  }
  document.querySelectorAll(".mobile-profile-link").forEach((fallback) => {
    if (!fallback.hidden) fallback.hidden = true;
  });

  // Public Reef entry is intentionally form-only. Keep the signed-in sidebar
  // contract unchanged, but remove the Public desktop sidebar and its mobile
  // Menu entry point so unrelated Intake navigation is not exposed here.
  if (publicMode) {
    const publicSidebar = document.getElementById("reefNurserySidebar");
    const publicLayout = publicSidebar?.closest(".admin-layout");
    if (publicSidebar && !publicSidebar.hidden) publicSidebar.hidden = true;
    if (publicLayout && !publicLayout.classList.contains("admin-sidebar-unpinned")) {
      publicLayout.classList.add("admin-sidebar-unpinned");
    }
    document.querySelectorAll(".admin-sidebar-reveal, .mobile-menu-toggle").forEach((control) => {
      if (!control.hidden) control.hidden = true;
    });
  }

  if (!reviewMode) lockTrainingPhotos();

  const saveButton = document.getElementById("saveReefNursery");
  if (saveButton && !reviewMode) {
    const editing = Boolean(currentTrainingRecordId());
    const hideSaveButton = !editing;
    if (saveButton.hidden !== hideSaveButton) {
      saveButton.hidden = hideSaveButton;
    }
    if (editing && saveButton.textContent !== "Save changes") {
      saveButton.textContent = "Save changes";
    }
  }
}

function lockTrainingPhotos() {
  for (const id of ["reefTakePhoto", "reefChoosePhotos", "reefCameraPhoto", "reefGalleryPhotos"]) {
    const control = document.getElementById(id);
    if (control && !control.disabled) control.disabled = true;
  }
  const status = document.getElementById("reefPhotoStatus");
  if (status && status.textContent !== TRAINING_PHOTO_MESSAGE) {
    status.textContent = TRAINING_PHOTO_MESSAGE;
    delete status.dataset.status;
  }
}

function protectTrainingPhotoActions(event) {
  if (isReviewMode()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("#reefTakePhoto, #reefChoosePhotos")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  lockTrainingPhotos();
}

function protectTrainingPhotoInputs(event) {
  if (isReviewMode()) return;
  if (!["reefCameraPhoto", "reefGalleryPhotos"].includes(event.target?.id)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  event.target.value = "";
  lockTrainingPhotos();
}

function protectParticipantKeyboardContract(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.matches("[data-participant-field]")) return;

  // Remove only the replacement Enter-to-add behaviour on the last text-input
  // row. Preserve normal Enter behaviour elsewhere, including Gender.
  if (event.key === "Enter" && !event.shiftKey && target.tagName !== "SELECT") {
    const row = target.closest("tr");
    const rows = [...document.querySelectorAll("#reefParticipantRows tr")];
    if (row && row === rows.at(-1)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }

  if (
    event.key !== "Tab"
    || event.shiftKey
    || event.ctrlKey
    || event.altKey
    || event.metaKey
    || !target.matches('[data-participant-field="gender"]')
  ) return;

  const row = target.closest("tr");
  const rows = [...document.querySelectorAll("#reefParticipantRows tr")];
  if (!row || row !== rows.at(-1) || !participantRowHasValue(row)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  document.getElementById("addReefParticipant")?.click();
  requestAnimationFrame(() => {
    document.querySelector("#reefParticipantRows tr:last-child")
      ?.querySelector('[data-participant-field="name"]')
      ?.focus();
  });
}

function participantRowHasValue(row) {
  return [...row.querySelectorAll("[data-participant-field]")]
    .some((control) => String(control.value || "").trim());
}

function currentTrainingRecordId() {
  return new URLSearchParams(window.location.search).get("record");
}

function isReviewMode() {
  const parameters = new URLSearchParams(window.location.search);
  return Boolean(parameters.get("share") && parameters.get("org"));
}

export const REEF_TRAINING_DOM_GUARD_CONTRACT = Object.freeze({
  participantReferenceMaxLength: PARTICIPANT_REFERENCE_MAX_LENGTH,
  originalParticipantTabBehaviour: true,
  duplicateSignInRemoved: true,
  publicSidebarHidden: true,
  trainingPhotoStorageBoundaryPreserved: true
});