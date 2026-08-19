import { callPublicRpc } from "./supabase_client.js";

const parameters = new URLSearchParams(window.location.search);
const shareToken = parameters.get("share");
const organisationCode = parameters.get("org");
const isReefReview = window.location.pathname.endsWith("/reef_nursery.html")
  && Boolean(shareToken && organisationCode);

if (isReefReview) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseReviewMatrixCollaboration, { once: true });
  } else {
    initialiseReviewMatrixCollaboration();
  }
}

function initialiseReviewMatrixCollaboration() {
  const openButton = document.getElementById("openReefTrainingMatrix");
  const matrixForm = document.getElementById("reefTrainingMatrixForm");
  if (!openButton || !matrixForm) return;

  const revealEditor = () => {
    if (openButton.hidden) openButton.hidden = false;
    openButton.textContent = "Update training matrix";
    openButton.title = "Edit the training matrix for this review copy";
  };

  revealEditor();
  const observer = new MutationObserver(revealEditor);
  observer.observe(openButton, { attributes: true, attributeFilter: ["hidden"] });

  document.addEventListener("submit", interceptReviewMatrixSave, true);
}

async function interceptReviewMatrixSave(event) {
  if (event.target?.id !== "reefTrainingMatrixForm") return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const saveButton = document.getElementById("saveReefTrainingMatrix");
  const status = document.getElementById("reefTrainingMatrixStatus");
  const payload = collectMatrixPayload();
  const validationError = validateMatrix(payload);

  if (validationError) {
    setMatrixStatus(status, validationError, "error");
    return;
  }

  if (saveButton) saveButton.disabled = true;
  setMatrixStatus(status, "Saving review training matrix...");

  try {
    await callPublicRpc("ag_public_update_reef_review_training_matrix", {
      p_share_token: shareToken,
      p_matrix: payload
    });
    setMatrixStatus(status, "Review training matrix saved. Reloading...");
    window.location.reload();
  } catch (error) {
    setMatrixStatus(
      status,
      error?.message || "The review training matrix could not be saved.",
      "error"
    );
    if (saveButton) saveButton.disabled = false;
  }
}

function collectMatrixPayload() {
  return [...document.querySelectorAll("#reefTrainingMatrixEditor [data-matrix-section]")]
    .map((section) => ({
      section_key: section.dataset.matrixSection,
      activities: [...section.querySelectorAll("[data-matrix-activity]")].map((row, index) => ({
        id: row.dataset.matrixActivity,
        label: row.querySelector("[data-matrix-label]")?.value?.trim() || "",
        activity_order: index + 1
      }))
    }));
}

function validateMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6) {
    return "The training matrix must contain all six sections.";
  }

  for (const section of matrix) {
    const labels = section.activities.map((activity) => activity.label.trim());
    if (labels.some((label) => !label)) {
      return "Every training activity needs a name.";
    }
    if (labels.some((label) => label.length > 300)) {
      return "Training activity names must be 300 characters or fewer.";
    }
    if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
      return "A training section contains a duplicate activity.";
    }
  }

  return "";
}

function setMatrixStatus(element, message, kind = "") {
  if (!element) return;
  element.textContent = message;
  element.dataset.status = kind;
}
