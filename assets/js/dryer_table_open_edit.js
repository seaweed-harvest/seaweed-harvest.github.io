const OPEN_EDIT_SENTINEL = "open-edit";

const recordsRaId = document.getElementById("recordsRaId");
const recordsAccess = recordsRaId?.closest(".records-access");
const recordsList = document.getElementById("recordsList");

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
    button.textContent = label;
    button.title = label;
  });
}

if (recordsList) {
  new MutationObserver(normalizeRecordActions).observe(recordsList, {
    childList: true,
    subtree: true
  });
}

document.addEventListener("seaweed-drying-language-change", normalizeRecordActions);
normalizeRecordActions();
