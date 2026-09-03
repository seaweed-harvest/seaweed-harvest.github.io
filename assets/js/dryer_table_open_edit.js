const OPEN_EDIT_SENTINEL = "open-edit";

const recordsRaId = document.getElementById("recordsRaId");
const recordsAccess = recordsRaId?.closest(".records-access");
const recordsList = document.getElementById("recordsList");
const refreshRecords = document.getElementById("refreshRecords");

if (recordsRaId) {
  // Keep the existing form contract satisfied while removing RA / ID as an edit gate.
  recordsRaId.value = OPEN_EDIT_SENTINEL;
  recordsRaId.type = "hidden";
  recordsRaId.setAttribute("aria-hidden", "true");
}

if (recordsAccess) recordsAccess.hidden = true;

function editRecordLabel() {
  return document.body.dataset.language === "sw" ? "Hariri rekodi" : "Edit record";
}

function normalizeRecordActions() {
  if (!recordsList) return;
  const label = editRecordLabel();
  recordsList.querySelectorAll("button[data-edit-receipt]").forEach((button) => {
    if (button.textContent !== label) button.textContent = label;
    if (button.title !== label) button.title = label;
  });
}

function scheduleRecordActionLabels() {
  // Use a short, finite set of checks instead of observing every table mutation.
  [0, 250, 750, 1500, 3000].forEach((delay) => {
    window.setTimeout(normalizeRecordActions, delay);
  });
}

refreshRecords?.addEventListener("click", scheduleRecordActionLabels);
document.addEventListener("seaweed-drying-language-change", scheduleRecordActionLabels);
scheduleRecordActionLabels();
