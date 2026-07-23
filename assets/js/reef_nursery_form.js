import { APP_CONFIG } from "./config.js";
import { authClient, requireAggregatorAccess } from "./auth_client.js?v=23";
import { setupFavoriteFormButton } from "./favorite_forms.js";
import { initReefNurseryRecords } from "./reef_nursery_records.js?v=3";

const els = {};
const PHOTO_BUCKET = "reef-nursery-photos";
const PHOTO_MAX_COUNT = 8;
const PHOTO_MAX_BYTES = 1024 * 1024;
const PHOTO_TARGET_BYTES = 850 * 1024;
const PHOTO_MAX_EDGE = 2200;
const TRAINING_SECTION_KEYS = [
  "general_in_water_training",
  "seeding",
  "harvesting",
  "line_inspection_maintenance",
  "mooring_inspection_maintenance",
  "nursery_deployment_recovery"
];
const photoState = {
  files: [],
  existing: [],
  userId: null,
  activePhotoUrl: null,
  activePhotoIsObjectUrl: false
};
const trainingDrafts = new Map();
let trainingMatrix = [];
let trainingMatrixEditor = [];
let submissionId = crypto.randomUUID();
let editingSessionId = null;
let recordsController = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reefNurseryForm", "reefNurseryTabs", "reefRecordNumber", "reefTrainingDate",
    "reefLocation", "reefStartTime", "reefFinishTime", "reefTrainerName",
    "reefSupportingStaff", "reefSessionTypes", "reefOtherSessionTypeField",
    "reefOtherSessionType",
    "reefConditions", "reefNurseryReference", "reefTrainingSections",
    "reefTrainingEmpty", "openReefTrainingMatrix", "reefTrainingMatrixDialog",
    "reefTrainingMatrixForm", "reefTrainingMatrixEditor", "reefTrainingMatrixStatus",
    "closeReefTrainingMatrix", "cancelReefTrainingMatrix", "saveReefTrainingMatrix",
    "reefParticipantRows",
    "reefParticipantCount", "addReefParticipant", "reefSeaweedHealth",
    "reefSeedWeight", "reefSeedWeightUnit", "reefHarvestWeight",
    "reefHarvestWeightUnit", "reefEquipmentReplaced", "saveReefNursery",
    "reefTakePhoto", "reefChoosePhotos", "reefCameraPhoto", "reefGalleryPhotos",
    "reefPhotoStatus", "reefPhotoPreview", "reefDropboxLink", "reefDropboxPending",
    "reefPhotoViewer", "reefPhotoViewerImage", "reefPhotoViewerName",
    "reefClosePhotoViewer", "clearReefNursery", "favoriteReefNurseryForm",
    "reefNurseryStatus", "reefRecordsPanel", "reefStartNewRecord"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupTabs();
  configureDropboxLink();
  els.addReefParticipant.addEventListener("click", () => addParticipantRow({ focus: true }));
  els.reefParticipantRows.addEventListener("click", handleParticipantAction);
  els.reefSessionTypes.addEventListener("change", handleSessionTypesChange);
  els.reefTrainingSections.addEventListener("change", updateTrainingDraft);
  els.reefTrainingSections.addEventListener("input", updateTrainingDraft);
  els.openReefTrainingMatrix.addEventListener("click", openTrainingMatrixEditor);
  els.closeReefTrainingMatrix.addEventListener("click", closeTrainingMatrixEditor);
  els.cancelReefTrainingMatrix.addEventListener("click", closeTrainingMatrixEditor);
  els.reefTrainingMatrixDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTrainingMatrixEditor();
  });
  els.reefTrainingMatrixEditor.addEventListener("click", handleTrainingMatrixAction);
  els.reefTrainingMatrixForm.addEventListener("submit", saveTrainingMatrix);
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
  els.reefStartNewRecord.addEventListener("click", () => clearForm());
  els.reefNurseryForm.addEventListener("input", updateFieldHighlights);
  els.reefNurseryForm.addEventListener("change", updateFieldHighlights);

  const access = await requireAggregatorAccess(
    "COSME",
    "can_access_reef_nursery",
    "reef_nursery.html"
  );
  if (!access) return;
  photoState.userId = access.session?.user?.id || null;
  await loadTrainingMatrix();
  recordsController = await initReefNurseryRecords({
    root: els.reefRecordsPanel,
    access,
    onEdit: async (sessionId) => {
      history.replaceState({}, "", `./reef_nursery.html?record=${encodeURIComponent(sessionId)}`);
      await loadRecord(sessionId);
    }
  });

  setupFavoriteFormButton({
    button: els.favoriteReefNurseryForm,
    formKey: "reef_nursery",
    profile: access.profile,
    client: authClient,
    returnPage: "reef_nursery.html"
  });

  const requestedRecord = new URLSearchParams(window.location.search).get("record");
  if (requestedRecord) await loadRecord(requestedRecord);
  else initializeNewRecord();
}

function initializeNewRecord() {
  editingSessionId = null;
  submissionId = crypto.randomUUID();
  els.reefRecordNumber.textContent = "New record";
  els.reefTrainingDate.value = kenyaDate();
  els.reefParticipantRows.replaceChildren();
  addParticipantRow();
  handleSessionTypesChange();
  updateFieldHighlights();
}

async function loadRecord(sessionId) {
  setStatus("Loading Reef Nursery record...");
  els.saveReefNursery.disabled = true;
  const { data, error } = await authClient.rpc("ag_reef_nursery_session_detail", {
    p_session_id: sessionId
  });
  if (error || !data) {
    setStatus(error?.message || "The Reef Nursery record could not be loaded.", "error");
    return;
  }

  editingSessionId = data.session_id;
  submissionId = data.submission_id;
  els.reefRecordNumber.textContent = data.record_number || "Existing record";
  els.reefTrainingDate.value = String(data.training_date || "").slice(0, 10);
  els.reefLocation.value = data.location || "";
  els.reefStartTime.value = String(data.start_time || "").slice(0, 5);
  els.reefFinishTime.value = String(data.finish_time || "").slice(0, 5);
  els.reefTrainerName.value = data.trainer_name || "";
  els.reefSupportingStaff.value = data.supporting_staff || "";
  els.reefConditions.value = data.weather_sea_conditions || "";
  els.reefNurseryReference.value = data.nursery_reference || "";

  const sessionTypes = new Set(Array.isArray(data.session_types) ? data.session_types : []);
  els.reefNurseryForm.querySelectorAll('[name="reefSessionType"]').forEach((control) => {
    control.checked = sessionTypes.has(control.value);
  });
  els.reefOtherSessionType.value = data.other_session_type || "";
  trainingDrafts.clear();
  (Array.isArray(data.training_delivered) ? data.training_delivered : []).forEach((section) => {
    trainingDrafts.set(section.section_key, {
      activityIds: new Set((Array.isArray(section.activity_ids) ? section.activity_ids : []).map(String)),
      otherText: String(section.other_text || "")
    });
  });
  handleSessionTypesChange();

  els.reefParticipantRows.replaceChildren();
  (Array.isArray(data.participants) ? data.participants : []).forEach((participant) => {
    addParticipantRow({ participant });
  });
  if (!els.reefParticipantRows.rows.length) addParticipantRow();

  const seaweed = data.seaweed || {};
  els.reefSeaweedHealth.value = seaweed.seaweed_health || "";
  els.reefSeedWeight.value = seaweed.seed_weight_value ?? "";
  els.reefSeedWeightUnit.value = seaweed.seed_weight_unit || "kg";
  els.reefHarvestWeight.value = seaweed.harvest_weight_value ?? "";
  els.reefHarvestWeightUnit.value = seaweed.harvest_weight_unit || "kg";
  els.reefEquipmentReplaced.value = seaweed.equipment_replaced || "";

  photoState.files = [];
  photoState.existing = await Promise.all((Array.isArray(data.photos) ? data.photos : []).map(async (photo) => {
    const { data: signed } = await authClient.storage.from(PHOTO_BUCKET)
      .createSignedUrl(photo.storage_path, 3600);
    return { ...photo, signedUrl: signed?.signedUrl || "" };
  }));
  renderPhotoPreview();

  els.saveReefNursery.textContent = "Save changes";
  els.clearReefNursery.textContent = "Cancel edit";
  document.title = `${data.record_number || "Reef Nursery"} - Seaweed Harvest`;
  showTab("session");
  updateParticipantCount();
  updateFieldHighlights();
  els.saveReefNursery.disabled = false;
  setStatus(`${data.record_number} loaded for editing.`);
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
  els.reefNurseryForm.classList.toggle("showing-records", name === "records");
  document.querySelectorAll("[data-reef-tab]").forEach((tab) => {
    const active = tab.dataset.reefTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-reef-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.reefPanel !== name;
  });
  if (name === "records") void recordsController?.reload();
}

function addParticipantRow({ focus = false, participant = {} } = {}) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td data-label="Participant name"><input type="text" data-participant-field="name" maxlength="160" autocomplete="name"></td>
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
  row.querySelector('[data-participant-field="name"]').value = participant.participant_name || "";
  row.querySelector('[data-participant-field="reference"]').value = participant.farmer_reference_phone || "";
  row.querySelector('[data-participant-field="gender"]').value = participant.gender || "";
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

async function loadTrainingMatrix() {
  const { data, error } = await authClient.rpc("ag_get_reef_training_matrix");
  if (error) {
    els.saveReefNursery.disabled = true;
    els.openReefTrainingMatrix.disabled = true;
    els.reefTrainingEmpty.textContent = "Training matrix unavailable. Reload the page to try again.";
    setStatus(error.message || "The training matrix could not be loaded.", "error");
    return;
  }
  trainingMatrix = normalizeTrainingMatrix(data);
  if (trainingMatrix.length !== TRAINING_SECTION_KEYS.length) {
    els.saveReefNursery.disabled = true;
    els.reefTrainingEmpty.textContent = "Training matrix incomplete. Ask an administrator to review it.";
    setStatus("The training matrix is incomplete.", "error");
  }
}

function normalizeTrainingMatrix(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter((section) => TRAINING_SECTION_KEYS.includes(section?.section_key))
    .map((section) => ({
      section_key: section.section_key,
      section_label: String(section.section_label || section.section_key),
      section_order: Number(section.section_order || 0),
      activities: (Array.isArray(section.activities) ? section.activities : [])
        .map((activity) => ({
          id: String(activity.id || ""),
          label: String(activity.label || ""),
          activity_order: Number(activity.activity_order || 0)
        }))
        .filter((activity) => activity.id && activity.label)
        .sort((left, right) => left.activity_order - right.activity_order)
    }))
    .sort((left, right) => left.section_order - right.section_order);
}

function selectedTrainingKeys() {
  return [...els.reefNurseryForm.querySelectorAll('[name="reefSessionType"]:checked')]
    .map((control) => control.value);
}

function handleSessionTypesChange() {
  const otherSelected = Boolean(els.reefNurseryForm.querySelector('[name="reefSessionType"][value="other"]:checked'));
  els.reefOtherSessionTypeField.hidden = !otherSelected;
  els.reefOtherSessionType.required = otherSelected;
  if (!otherSelected) {
    els.reefOtherSessionType.value = "";
    els.reefOtherSessionType.classList.remove("empty-value-control");
  }
  renderTrainingSections();
  updateFieldHighlights();
}

function trainingDraft(sectionKey) {
  if (!trainingDrafts.has(sectionKey)) {
    trainingDrafts.set(sectionKey, { activityIds: new Set(), otherText: "" });
  }
  return trainingDrafts.get(sectionKey);
}

function renderTrainingSections() {
  const selected = new Set(selectedTrainingKeys().filter((key) => TRAINING_SECTION_KEYS.includes(key)));
  els.reefTrainingSections.replaceChildren();
  els.reefTrainingEmpty.hidden = selected.size > 0;
  if (!selected.size) {
    els.reefTrainingEmpty.textContent = "No standard training activities selected.";
    return;
  }

  trainingMatrix.filter((section) => selected.has(section.section_key)).forEach((section) => {
    const draft = trainingDraft(section.section_key);
    const block = document.createElement("section");
    block.className = "reef-training-section";
    block.dataset.trainingSection = section.section_key;
    block.innerHTML = `
      <div class="reef-training-section-head">
        <h3>${escapeHtml(section.section_label)}</h3>
        <span class="status-pill" data-training-count>0 selected</span>
      </div>
      <div class="reef-training-activity-list">
        ${section.activities.map((activity) => `
          <label>
            <input type="checkbox" data-training-activity="${escapeHtml(activity.id)}" ${draft.activityIds.has(activity.id) ? "checked" : ""}>
            <span>${escapeHtml(activity.label)}</span>
          </label>`).join("")}
      </div>
      <label class="reef-training-other">Other
        <input type="text" data-training-other maxlength="500" value="${escapeHtml(draft.otherText)}" placeholder="Add another activity">
      </label>`;
    els.reefTrainingSections.append(block);
    updateTrainingSectionCount(block);
  });
}

function updateTrainingDraft(event) {
  const section = event.target.closest("[data-training-section]");
  if (!section) return;
  const draft = trainingDraft(section.dataset.trainingSection);
  if (event.target.matches("[data-training-activity]")) {
    const activityId = event.target.dataset.trainingActivity;
    if (event.target.checked) draft.activityIds.add(activityId);
    else draft.activityIds.delete(activityId);
  }
  if (event.target.matches("[data-training-other]")) draft.otherText = event.target.value;
  section.classList.remove("missing-training-selection");
  updateTrainingSectionCount(section);
}

function updateTrainingSectionCount(section) {
  const count = section.querySelectorAll("[data-training-activity]:checked").length
    + (String(section.querySelector("[data-training-other]")?.value || "").trim() ? 1 : 0);
  const pill = section.querySelector("[data-training-count]");
  if (pill) pill.textContent = `${count} selected`;
}

function openTrainingMatrixEditor() {
  trainingMatrixEditor = trainingMatrix.map((section) => ({
    ...section,
    activities: section.activities.map((activity) => ({ ...activity }))
  }));
  setTrainingMatrixStatus("");
  renderTrainingMatrixEditor();
  if (typeof els.reefTrainingMatrixDialog.showModal === "function") {
    els.reefTrainingMatrixDialog.showModal();
  } else {
    els.reefTrainingMatrixDialog.setAttribute("open", "");
  }
}

function closeTrainingMatrixEditor() {
  if (typeof els.reefTrainingMatrixDialog.close === "function" && els.reefTrainingMatrixDialog.open) {
    els.reefTrainingMatrixDialog.close();
  } else {
    els.reefTrainingMatrixDialog.removeAttribute("open");
  }
}

function renderTrainingMatrixEditor() {
  els.reefTrainingMatrixEditor.innerHTML = trainingMatrixEditor.map((section) => `
    <section class="reef-matrix-section" data-matrix-section="${escapeHtml(section.section_key)}">
      <div class="reef-matrix-section-head">
        <h3>${escapeHtml(section.section_label)}</h3>
        <button type="button" data-add-matrix-activity="${escapeHtml(section.section_key)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
          <span>Add activity</span>
        </button>
      </div>
      <div class="reef-matrix-rows">
        ${section.activities.map((activity, index) => `
          <div class="reef-matrix-row" data-matrix-activity="${escapeHtml(activity.id)}">
            <span class="reef-matrix-row-number">${index + 1}</span>
            <input type="text" data-matrix-label maxlength="300" value="${escapeHtml(activity.label)}" aria-label="Activity ${index + 1}">
            <button class="reef-icon-action" type="button" data-move-matrix="up" aria-label="Move activity up" title="Move up" ${index === 0 ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 15 6-6 6 6"></path></svg>
            </button>
            <button class="reef-icon-action" type="button" data-move-matrix="down" aria-label="Move activity down" title="Move down" ${index === section.activities.length - 1 ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
            </button>
            <button class="reef-icon-action danger" type="button" data-remove-matrix-activity aria-label="Remove activity" title="Remove">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"></path></svg>
            </button>
          </div>`).join("")}
      </div>
    </section>`).join("");
}

function captureTrainingMatrixInputs() {
  els.reefTrainingMatrixEditor.querySelectorAll("[data-matrix-section]").forEach((sectionElement) => {
    const section = trainingMatrixEditor.find((item) => item.section_key === sectionElement.dataset.matrixSection);
    if (!section) return;
    sectionElement.querySelectorAll("[data-matrix-activity]").forEach((row) => {
      const activity = section.activities.find((item) => item.id === row.dataset.matrixActivity);
      if (activity) activity.label = row.querySelector("[data-matrix-label]").value;
    });
  });
}

function handleTrainingMatrixAction(event) {
  const add = event.target.closest("[data-add-matrix-activity]");
  const remove = event.target.closest("[data-remove-matrix-activity]");
  const move = event.target.closest("[data-move-matrix]");
  if (!add && !remove && !move) return;
  captureTrainingMatrixInputs();
  const sectionElement = event.target.closest("[data-matrix-section]");
  const section = trainingMatrixEditor.find((item) => item.section_key === sectionElement?.dataset.matrixSection);
  if (!section) return;

  if (add) {
    const activity = { id: crypto.randomUUID(), label: "", activity_order: section.activities.length + 1 };
    section.activities.push(activity);
    renderTrainingMatrixEditor();
    els.reefTrainingMatrixEditor.querySelector(`[data-matrix-activity="${activity.id}"] [data-matrix-label]`)?.focus();
    return;
  }

  const row = event.target.closest("[data-matrix-activity]");
  const index = section.activities.findIndex((activity) => activity.id === row?.dataset.matrixActivity);
  if (index < 0) return;
  if (remove) section.activities.splice(index, 1);
  if (move?.dataset.moveMatrix === "up" && index > 0) {
    [section.activities[index - 1], section.activities[index]] = [section.activities[index], section.activities[index - 1]];
  }
  if (move?.dataset.moveMatrix === "down" && index < section.activities.length - 1) {
    [section.activities[index + 1], section.activities[index]] = [section.activities[index], section.activities[index + 1]];
  }
  renderTrainingMatrixEditor();
}

async function saveTrainingMatrix(event) {
  event.preventDefault();
  captureTrainingMatrixInputs();
  for (const section of trainingMatrixEditor) {
    const labels = section.activities.map((activity) => activity.label.trim());
    if (labels.some((label) => !label)) {
      setTrainingMatrixStatus(`Every activity in ${section.section_label} needs a name.`, "error");
      return;
    }
    if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
      setTrainingMatrixStatus(`${section.section_label} contains a duplicate activity.`, "error");
      return;
    }
  }

  els.saveReefTrainingMatrix.disabled = true;
  setTrainingMatrixStatus("Saving training matrix...");
  const payload = trainingMatrixEditor.map((section) => ({
    section_key: section.section_key,
    activities: section.activities.map((activity, index) => ({
      id: activity.id,
      label: activity.label.trim(),
      activity_order: index + 1
    }))
  }));
  try {
    const { data, error } = await authClient.rpc("ag_update_reef_training_matrix", { p_matrix: payload });
    if (error) throw error;
    trainingMatrix = normalizeTrainingMatrix(data);
    const activeIds = new Set(trainingMatrix.flatMap((section) => section.activities.map((activity) => activity.id)));
    trainingDrafts.forEach((draft) => {
      draft.activityIds = new Set([...draft.activityIds].filter((id) => activeIds.has(id)));
    });
    renderTrainingSections();
    closeTrainingMatrixEditor();
    setStatus("Training matrix updated.");
  } catch (error) {
    setTrainingMatrixStatus(error.message || "The training matrix could not be saved.", "error");
  } finally {
    els.saveReefTrainingMatrix.disabled = false;
  }
}

function setTrainingMatrixStatus(message, kind = "") {
  els.reefTrainingMatrixStatus.textContent = message;
  els.reefTrainingMatrixStatus.dataset.status = kind;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
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
    const rpcName = editingSessionId
      ? "ag_update_reef_nursery_session"
      : "ag_submit_reef_nursery_session";
    const rpcPayload = {
      p_session: record.session,
      p_participants: record.participants,
      p_seaweed_record: record.seaweed,
      p_photos: uploadedPhotos.map((photo) => photo.manifest),
      p_training_delivered: record.trainingDelivered
    };
    if (editingSessionId) rpcPayload.p_session_id = editingSessionId;
    else rpcPayload.p_submission_id = submissionId;
    const { data, error } = await authClient.rpc(rpcName, rpcPayload);
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const participantCount = Number(saved?.participant_count ?? record.participants.length);
    const photoCount = Number(saved?.photo_count ?? uploadedPhotos.length);
    const trainingActivityCount = Number(saved?.training_activity_count ?? 0);
    const recordNumber = saved?.record_number || els.reefRecordNumber.textContent;
    const photoSummary = photoCount
      ? ` and ${photoCount} ${photoCount === 1 ? "photo" : "photos"}`
      : "";
    const trainingSummary = trainingActivityCount
      ? `, ${trainingActivityCount} training ${trainingActivityCount === 1 ? "activity" : "activities"}`
      : "";
    if (editingSessionId) {
      await loadRecord(editingSessionId);
      setStatus(`${recordNumber} updated with ${participantCount} ${participantCount === 1 ? "participant" : "participants"}${trainingSummary}${photoSummary}.`);
    } else {
      clearForm({ preserveStatus: true });
      setStatus(`${recordNumber} saved with ${participantCount} ${participantCount === 1 ? "participant" : "participants"}${trainingSummary}${photoSummary}.`);
    }
  } catch (error) {
    await removeUploadedPhotos(uploadedPhotos.map((photo) => photo.manifest.storage_path));
    setStatus(error.message || "The Reef Nursery session could not be saved.", "error");
  } finally {
    els.saveReefNursery.disabled = false;
  }
}

function validatedRecord() {
  const required = [
    [els.reefTrainingDate, "Training date", "session"],
    [els.reefStartTime, "Start time", "session"],
    [els.reefFinishTime, "Finish time", "session"]
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

  const otherSelected = sessionTypes.includes("other");
  if (otherSelected && !els.reefOtherSessionType.value.trim()) {
    return validationError("Enter the other session type.", "session", els.reefOtherSessionType);
  }

  const trainingDelivered = [];
  for (const sectionKey of sessionTypes.filter((key) => TRAINING_SECTION_KEYS.includes(key))) {
    const draft = trainingDraft(sectionKey);
    const activityIds = [...draft.activityIds];
    const otherText = textOrNull(draft.otherText);
    if (!activityIds.length && !otherText) continue;
    trainingDelivered.push({
      section_key: sectionKey,
      activity_ids: activityIds,
      other_text: otherText
    });
  }

  const participants = [...els.reefParticipantRows.rows].map((row) => ({
    participant_name: row.querySelector('[data-participant-field="name"]').value.trim(),
    farmer_reference_phone: textOrNull(row.querySelector('[data-participant-field="reference"]').value),
    gender: textOrNull(row.querySelector('[data-participant-field="gender"]').value)
  })).filter((participant) => (
    participant.participant_name || participant.farmer_reference_phone || participant.gender
  ));
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
      supporting_staff: textOrNull(els.reefSupportingStaff.value),
      session_types: sessionTypes,
      other_session_type: otherSelected ? els.reefOtherSessionType.value.trim() : null,
      weather_sea_conditions: textOrNull(els.reefConditions.value),
      nursery_reference: textOrNull(els.reefNurseryReference.value)
    },
    participants,
    trainingDelivered,
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
  editingSessionId = null;
  history.replaceState({}, "", "./reef_nursery.html");
  els.reefNurseryForm.reset();
  els.reefRecordNumber.textContent = "New record";
  els.reefTrainingDate.value = kenyaDate();
  els.reefParticipantRows.replaceChildren();
  trainingDrafts.clear();
  photoState.files = [];
  photoState.existing = [];
  els.reefCameraPhoto.value = "";
  els.reefGalleryPhotos.value = "";
  closePhotoViewer();
  renderPhotoPreview();
  addParticipantRow();
  handleSessionTypesChange();
  submissionId = crypto.randomUUID();
  els.saveReefNursery.textContent = "Save Reef Nursery session";
  els.clearReefNursery.textContent = "Clear";
  document.title = "Reef Nursery - Seaweed Harvest";
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
  const available = Math.max(0, PHOTO_MAX_COUNT - photoState.existing.length - photoState.files.length);
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
  photoState.existing.forEach((photo, index) => {
    const card = document.createElement("article");
    card.className = "reef-photo-card reef-photo-card-existing";

    const view = document.createElement("button");
    view.type = "button";
    view.className = "reef-photo-view";
    view.dataset.viewExistingPhoto = String(index);
    view.setAttribute("aria-label", `View saved photo ${index + 1}`);

    const image = document.createElement("img");
    if (photo.signedUrl) image.src = photo.signedUrl;
    image.alt = `Saved Reef Nursery photo ${index + 1}`;
    const caption = document.createElement("span");
    caption.textContent = photo.original_name || `Saved photo ${index + 1}`;
    view.append(image, caption);
    card.append(view);
    els.reefPhotoPreview.append(card);
  });
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
  const total = photoState.existing.length + photoState.files.length;
  setPhotoStatus(total
    ? `${total} of ${PHOTO_MAX_COUNT} photos ${editingSessionId ? "attached" : "ready"}.`
    : `Up to ${PHOTO_MAX_COUNT} photos. Compressed before upload.`);
}

function handlePhotoAction(event) {
  const remove = event.target.closest("[data-remove-photo]");
  if (remove) {
    photoState.files.splice(Number(remove.dataset.removePhoto), 1);
    renderPhotoPreview();
    return;
  }
  const existingView = event.target.closest("[data-view-existing-photo]");
  if (existingView) {
    openPhotoViewer("existing", Number(existingView.dataset.viewExistingPhoto));
    return;
  }
  const view = event.target.closest("[data-view-photo]");
  if (view) openPhotoViewer("new", Number(view.dataset.viewPhoto));
}

function openPhotoViewer(kind, index) {
  releasePhotoViewerUrl();
  if (kind === "existing") {
    const photo = photoState.existing[index];
    if (!photo?.signedUrl) return;
    photoState.activePhotoUrl = photo.signedUrl;
    photoState.activePhotoIsObjectUrl = false;
    els.reefPhotoViewerName.textContent = photo.original_name || `Saved photo ${index + 1}`;
  } else {
    const file = photoState.files[index];
    if (!file) return;
    photoState.activePhotoUrl = URL.createObjectURL(file);
    photoState.activePhotoIsObjectUrl = true;
    els.reefPhotoViewerName.textContent = file.name || `Photo ${index + 1}`;
  }
  els.reefPhotoViewerImage.src = photoState.activePhotoUrl;
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
  if (photoState.activePhotoUrl && photoState.activePhotoIsObjectUrl) {
    URL.revokeObjectURL(photoState.activePhotoUrl);
  }
  photoState.activePhotoUrl = null;
  photoState.activePhotoIsObjectUrl = false;
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
