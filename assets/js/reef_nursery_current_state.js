import { authClient } from "./auth_client.js?v=25";

const LOCATION_OPTIONS = Object.freeze([
  ["tumbe_shore", "Tumbe - Shore / Farm"],
  ["tumbe_offshore", "Tumbe - Offshore Nursery"],
  ["mkwiro_shore", "Mkwiro - Shore / Farm"],
  ["mkwiro_offshore", "Mkwiro - Offshore Nursery"]
]);
const LEGACY_LOCATION_OPTIONS = Object.freeze([
  ["mkwiro", "Mkwiro (existing record)"],
  ["offshore_nursery", "Offshore nursery site (existing record)"],
  ["shoreline_preparation", "Shoreline preparation area (existing record)"]
]);
const LOCATION_DISPLAY_REPLACEMENTS = Object.freeze({
  tumbe_shore: "Tumbe - Shore / Farm",
  tumbe_offshore: "Tumbe - Offshore Nursery",
  mkwiro_shore: "Mkwiro - Shore / Farm",
  mkwiro_offshore: "Mkwiro - Offshore Nursery",
  "Tumbe – Shore": "Tumbe - Shore / Farm",
  "Tumbe – Offshore Nursery Site": "Tumbe - Offshore Nursery",
  "Mkwiro – Shore": "Mkwiro - Shore / Farm",
  "Mkwiro – Offshore Nursery Site": "Mkwiro - Offshore Nursery"
});
const GENDER_OPTIONS = Object.freeze([
  ["", "No Entry"],
  ["male", "Male"],
  ["female", "Female"]
]);
const LEGACY_GENDER_OPTIONS = Object.freeze([
  ["other", "Other (existing record)"],
  ["prefer_not_to_say", "Prefer not to say (existing record)"]
]);
const COMPETENCY_LEVELS = Object.freeze([
  "needs_support",
  "with_supervision",
  "independent"
]);
const PHOTO_BUCKET = "reef-seaweed-record-photos";
const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_STORED_PHOTO_BYTES = 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const SEAWEED_DRAFT_PHOTO_DATABASE = "seaweed-harvest-reef-drafts";
const SEAWEED_DRAFT_PHOTO_STORE = "seaweed-photos";
const FLASH_KEY = "reef-current-state-flash";

const FORMS = Object.freeze({
  training: {
    formId: "reefNurseryForm",
    saveId: "saveReefNursery",
    submitId: "submitReefNursery",
    clearId: "clearReefNursery",
    statusId: "reefNurseryStatus",
    stateId: "reefRecordStatus",
    recordParam: "record",
    tab: "session"
  },
  seaweed: {
    formId: "reefSeaweedForm",
    saveId: "saveReefSeaweedChanges",
    submitId: "submitReefSeaweed",
    clearId: "clearReefSeaweed",
    statusId: "reefSeaweedStatus",
    stateId: "reefSeaweedRecordState",
    recordParam: "seaweed_record",
    tab: "seaweed"
  },
  inspection: {
    formId: "reefInspectionForm",
    saveId: "saveReefInspectionChanges",
    submitId: "submitReefInspection",
    clearId: "clearReefInspection",
    statusId: "reefInspectionStatus",
    stateId: "reefInspectionRecordState",
    recordParam: "inspection_record",
    tab: "inspection"
  }
});

const state = {
  syncScheduled: false,
  collectingCompetencies: false,
  selectedSeaweedPhoto: null,
  localPhotoObjectUrl: null,
  recordStates: new Map(),
  flashApplied: false
};

const previousRpc = authClient.rpc.bind(authClient);
authClient.rpc = async (name, args = {}) => {
  if (name === "ag_reef_records_workspace_records") {
    return previousRpc("ag_reef_records_workspace_records_v2", args);
  }
  return previousRpc(name, args);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseCurrentStateSupport, { once: true });
} else {
  initialiseCurrentStateSupport();
}

function initialiseCurrentStateSupport() {
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("submit", handleDocumentSubmit, true);
  document.addEventListener("change", handleDocumentChange, true);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-pressed", "aria-expanded"]
  });

  scheduleSync();
  void loadVisibleRecordStates();
  window.setTimeout(() => { void loadVisibleRecordStates(); }, 800);
  window.setTimeout(() => { void loadVisibleRecordStates(); }, 1700);
  window.setTimeout(applyFlashMessage, 700);
  window.setTimeout(applyFlashMessage, 1600);
}

function scheduleSync() {
  if (state.syncScheduled) return;
  state.syncScheduled = true;
  queueMicrotask(() => {
    state.syncScheduled = false;
    syncCurrentStateUi();
  });
}

function syncCurrentStateUi() {
  syncLocationSelect(document.getElementById("reefLocation"));
  syncLocationSelect(document.getElementById("reefSeaweedLocation"));
  syncLocationSelect(document.getElementById("reefInspectionLocation"));

  document.querySelectorAll('[data-participant-field="gender"]').forEach(syncGenderSelect);
  syncActionButtons();
  syncLocationDisplayText();
  syncRecordStatePills();
  syncLocalSeaweedPhotoPreview();
}

function syncLocationSelect(select) {
  if (!select) return;
  const current = String(select.value || "");
  const allKnown = new Set([
    "",
    ...LOCATION_OPTIONS.map(([value]) => value),
    ...LEGACY_LOCATION_OPTIONS.map(([value]) => value)
  ]);
  const unknown = current && !allKnown.has(current) ? [[current, `${current} (existing record)`]] : [];
  const signature = JSON.stringify([...LOCATION_OPTIONS, ...LEGACY_LOCATION_OPTIONS, ...unknown]);
  if (select.dataset.reefLocationSignature === signature) return;

  const placeholder = optionElement("", "Select location");
  const options = LOCATION_OPTIONS.map(([value, label]) => optionElement(value, label));
  const legacy = [...LEGACY_LOCATION_OPTIONS, ...unknown].map(([value, label]) => {
    const option = optionElement(value, label);
    option.hidden = value !== current;
    option.dataset.legacyValue = "true";
    return option;
  });
  select.replaceChildren(placeholder, ...options, ...legacy);
  select.value = current;
  select.dataset.reefLocationSignature = signature;
}

function syncGenderSelect(select) {
  const current = String(select.value || "");
  const known = new Set([...GENDER_OPTIONS, ...LEGACY_GENDER_OPTIONS].map(([value]) => value));
  const unknown = current && !known.has(current) ? [[current, `${current} (existing record)`]] : [];
  const signature = JSON.stringify([...GENDER_OPTIONS, ...LEGACY_GENDER_OPTIONS, ...unknown]);
  if (select.dataset.reefGenderSignature === signature) return;

  const visible = GENDER_OPTIONS.map(([value, label]) => optionElement(value, label));
  const legacy = [...LEGACY_GENDER_OPTIONS, ...unknown].map(([value, label]) => {
    const option = optionElement(value, label);
    option.hidden = value !== current;
    option.dataset.legacyValue = "true";
    return option;
  });
  select.replaceChildren(...visible, ...legacy);
  select.value = current;
  select.dataset.reefGenderSignature = signature;
}

function optionElement(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function syncActionButtons() {
  const reviewMode = isReviewMode();
  for (const [type, config] of Object.entries(FORMS)) {
    const save = document.getElementById(config.saveId);
    const submit = document.getElementById(config.submitId);
    const clear = document.getElementById(config.clearId);

    if (save) {
      const hideSave = reviewMode && type === "training";
      if (save.hidden !== hideSave) save.hidden = hideSave;
      if (!save.hidden && save.textContent !== "Save") save.textContent = "Save";
    }
    if (submit && !(reviewMode && type === "training")) {
      if (submit.hidden) submit.hidden = false;
      if (submit.textContent !== "Submit and start new") {
        submit.textContent = "Submit and start new";
      }
    }
    if (clear) {
      if (clear.hidden) clear.hidden = false;
      if (clear.textContent !== "Clear") clear.textContent = "Clear";
    }
  }
}

function syncLocationDisplayText() {
  document.querySelectorAll('td[data-label="Location"], .reef-legacy-summary-grid strong').forEach((element) => {
    const replacement = LOCATION_DISPLAY_REPLACEMENTS[String(element.textContent || "").trim()];
    if (replacement) element.textContent = replacement;
  });
}

function syncRecordStatePills() {
  for (const [type, recordState] of state.recordStates.entries()) {
    if (recordState !== "draft") continue;
    const pill = document.getElementById(FORMS[type]?.stateId);
    if (!pill) continue;
    pill.textContent = "Draft";
    pill.dataset.recordStatus = "draft";
  }
}

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const saveEntry = Object.entries(FORMS)
    .find(([, config]) => target.closest(`#${config.saveId}`));
  if (saveEntry && !(isReviewMode() && saveEntry[0] === "training")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void saveCurrentState(saveEntry[0]);
    return;
  }

  const clearEntry = Object.entries(FORMS)
    .find(([, config]) => target.closest(`#${config.clearId}`));
  if (clearEntry) {
    clearSubmissionId(clearEntry[0]);
    if (clearEntry[0] === "seaweed") {
      const recordId = currentRecordId("seaweed");
      state.selectedSeaweedPhoto = null;
      releaseLocalPhotoObjectUrl();
      if (recordId) void deleteSeaweedDraftPhotoLocal(recordId);
    }
    queueMicrotask(scheduleSync);
  }
}

function handleDocumentSubmit(event) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form) return;
  const type = form.id === FORMS.seaweed.formId
    ? "seaweed"
    : (form.id === FORMS.inspection.formId ? "inspection" : null);
  if (!type) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  void submitAndStartNew(type);
}

function handleDocumentChange(event) {
  if (!["reefSeaweedCameraInput", "reefSeaweedGalleryInput"].includes(event.target?.id)) return;
  state.selectedSeaweedPhoto = event.target.files?.[0] || null;
}

async function saveCurrentState(type) {
  setBusy(type, true);
  setStatus(type, `Saving ${formLabel(type)} in its current state…`);
  try {
    if (type === "training") await saveTrainingCurrentState();
    if (type === "seaweed") await saveSeaweedCurrentState();
    if (type === "inspection") await saveInspectionCurrentState();
  } catch (error) {
    setStatus(type, error?.message || `${formLabel(type)} could not be saved.`, "error");
    setBusy(type, false);
  }
}

async function submitAndStartNew(type) {
  setBusy(type, true);
  setStatus(type, `Submitting ${formLabel(type)}…`);
  try {
    if (type === "seaweed") await submitSeaweedAndStartNew();
    if (type === "inspection") await submitInspectionAndStartNew();
  } catch (error) {
    setStatus(type, error?.message || `${formLabel(type)} could not be submitted.`, "error");
    setBusy(type, false);
  }
}

async function saveTrainingCurrentState() {
  const recordId = currentRecordId("training");
  const payload = await collectTrainingPayload();
  const saved = await rpc("ag_reef_training_workspace_save", {
    p_session_id: recordId,
    p_submission_id: recordId ? null : submissionId("training"),
    p_session: payload.session,
    p_participants: payload.participants,
    p_training_delivered: payload.trainingDelivered,
    p_practical_competencies: payload.practicalCompetencies
  });
  const savedId = saved?.session_id || recordId;
  if (!savedId) throw new Error("The saved Training record could not be identified.");
  clearSubmissionId("training");
  setFlash("training", `${saved?.record_number || "Training record"} saved as a draft.`);
  window.location.assign(`./reef_nursery.html?record=${encodeURIComponent(savedId)}`);
}

async function saveSeaweedCurrentState() {
  const recordId = currentRecordId("seaweed");
  const payload = collectSeaweedPayload();
  const saved = await rpc("ag_reef_seaweed_workspace_save", {
    p_record_id: recordId,
    p_submission_id: recordId ? null : submissionId("seaweed"),
    p_record: payload.record,
    p_units: payload.units
  });
  const savedId = saved?.record_id || recordId;
  if (!savedId) throw new Error("The saved Seaweed Record could not be identified.");
  let photoSavedLocally = true;
  try {
    await saveSeaweedDraftPhotoLocal(savedId);
  } catch (error) {
    photoSavedLocally = false;
    console.warn("The Seaweed draft fields were saved, but its photo was not stored locally.", error);
  }
  clearSubmissionId("seaweed");
  setFlash(
    "seaweed",
    photoSavedLocally
      ? `${saved?.record_number || "Seaweed Record"} saved as a draft.`
      : `${saved?.record_number || "Seaweed Record"} fields saved, but choose the photo again before submission.`
  );
  window.location.assign(
    `./reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(savedId)}`
  );
}

async function saveInspectionCurrentState() {
  const recordId = currentRecordId("inspection");
  const payload = collectInspectionPayload();
  const saved = await rpc("ag_reef_inspection_workspace_save", {
    p_record_id: recordId,
    p_submission_id: recordId ? null : submissionId("inspection"),
    p_record: payload.record,
    p_rafts: payload.rafts
  });
  const savedId = saved?.record_id || recordId;
  if (!savedId) throw new Error("The saved Inspection could not be identified.");
  clearSubmissionId("inspection");
  setFlash("inspection", `${saved?.record_number || "Inspection"} saved as a draft.`);
  window.location.assign(
    `./reef_nursery.html?tab=inspection&inspection_record=${encodeURIComponent(savedId)}`
  );
}

async function submitSeaweedAndStartNew() {
  const recordId = currentRecordId("seaweed");
  const payload = collectSeaweedPayload();
  const saved = await rpc("ag_reef_seaweed_workspace_submit_current", {
    p_record_id: recordId,
    p_submission_id: recordId ? null : submissionId("seaweed"),
    p_record: payload.record,
    p_units: payload.units
  });
  const savedId = saved?.record_id || recordId;
  if (!savedId) throw new Error("The submitted Seaweed Record could not be identified.");
  if (state.selectedSeaweedPhoto) await persistSeaweedPhoto(savedId, state.selectedSeaweedPhoto);
  await deleteSeaweedDraftPhotoLocal(savedId);
  state.selectedSeaweedPhoto = null;
  releaseLocalPhotoObjectUrl();
  clearSubmissionId("seaweed");
  setFlash("seaweed", `${saved?.record_number || "Seaweed Record"} submitted. A new record is ready.`);
  window.location.assign("./reef_nursery.html?tab=seaweed");
}

async function submitInspectionAndStartNew() {
  const recordId = currentRecordId("inspection");
  const payload = collectInspectionPayload();
  const saved = await rpc("ag_reef_inspection_workspace_submit_current", {
    p_record_id: recordId,
    p_submission_id: recordId ? null : submissionId("inspection"),
    p_record: payload.record,
    p_rafts: payload.rafts
  });
  clearSubmissionId("inspection");
  setFlash("inspection", `${saved?.record_number || "Inspection"} submitted. A new inspection is ready.`);
  window.location.assign("./reef_nursery.html?tab=inspection");
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
  state.collectingCompetencies = true;
  try {
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
  } finally {
    state.collectingCompetencies = false;
  }
  return result;
}

function competencyTask(activityId) {
  return document.querySelector(
    `[data-competency-activity="${selectorEscape(activityId)}"]`
  );
}

function collectSeaweedPayload() {
  const units = [...document.querySelectorAll("[data-seaweed-unit]:checked")]
    .map((control) => {
      const code = control.dataset.seaweedUnit;
      const card = document.querySelector(
        `[data-seaweed-unit-card="${selectorEscape(code)}"]`
      );
      return {
        unit_code: code,
        species: fieldValue(card, "data-seaweed-field", "species"),
        line_count: fieldValue(card, "data-seaweed-field", "line_count"),
        seaweed_health: fieldValue(card, "data-seaweed-field", "seaweed_health"),
        seed_weight_value: fieldValue(card, "data-seaweed-field", "seed_weight_value"),
        seed_weight_unit: fieldValue(card, "data-seaweed-field", "seed_weight_unit") || "kg",
        harvest_weight_value: fieldValue(card, "data-seaweed-field", "harvest_weight_value"),
        harvest_weight_unit: fieldValue(card, "data-seaweed-field", "harvest_weight_unit") || "kg",
        notes_equipment_replaced: fieldValue(card, "data-seaweed-field", "notes_equipment_replaced")
      };
    });

  return {
    record: {
      record_date: valueOf("reefSeaweedDate"),
      location: valueOf("reefSeaweedLocation"),
      recorded_by_name: valueOf("reefSeaweedRecordedBy")
    },
    units
  };
}

function collectInspectionPayload() {
  const fields = [
    "overall_position_condition",
    "seaweed_lines_attachments",
    "hdpe_floating_frame",
    "rigging_harness",
    "mooring_components",
    "mooring_anchors",
    "mooring_attachment_points"
  ];
  const rafts = [...document.querySelectorAll("[data-inspection-raft]:checked")]
    .map((control) => {
      const raftNumber = Number(control.dataset.inspectionRaft);
      const card = document.querySelector(`[data-inspection-raft-card="${raftNumber}"]`);
      return {
        raft_number: raftNumber,
        ...Object.fromEntries(fields.map((field) => [
          field,
          fieldValue(card, "data-inspection-field", field)
        ]))
      };
    });

  return {
    record: {
      inspection_date: valueOf("reefInspectionDate"),
      location: valueOf("reefInspectionLocation"),
      recorded_by_name: valueOf("reefInspectionRecordedBy"),
      general_notes: valueOf("reefInspectionGeneralNotes")
    },
    rafts
  };
}

function fieldValue(root, attribute, value) {
  if (!root) return "";
  return String(root.querySelector(`[${attribute}="${value}"]`)?.value || "");
}


function syncLocalSeaweedPhotoPreview() {
  if (state.recordStates.get("seaweed") !== "draft" || !state.selectedSeaweedPhoto) return;
  const preview = document.getElementById("reefSeaweedPhotoPreview");
  const image = document.getElementById("reefSeaweedPhotoImage");
  const name = document.getElementById("reefSeaweedPhotoName");
  const meta = document.getElementById("reefSeaweedPhotoMeta");
  const status = document.getElementById("reefSeaweedPhotoStatus");
  if (!preview || !image) return;

  if (!state.localPhotoObjectUrl) {
    state.localPhotoObjectUrl = URL.createObjectURL(state.selectedSeaweedPhoto);
  }
  if (image.src !== state.localPhotoObjectUrl) image.src = state.localPhotoObjectUrl;
  if (name) name.textContent = state.selectedSeaweedPhoto.name || "Saved draft photo";
  if (meta) meta.textContent = "Saved in this browser for this draft";
  if (preview.hidden) preview.hidden = false;
  if (status && !/compressing|uploading/i.test(String(status.textContent || ""))) {
    status.textContent = "Draft photo restored from this browser.";
    status.dataset.status = "success";
  }
}

function releaseLocalPhotoObjectUrl() {
  if (state.localPhotoObjectUrl) URL.revokeObjectURL(state.localPhotoObjectUrl);
  state.localPhotoObjectUrl = null;
}

async function saveSeaweedDraftPhotoLocal(recordId) {
  const blob = state.selectedSeaweedPhoto
    ? await preparePhoto(state.selectedSeaweedPhoto)
    : null;
  const database = await openSeaweedDraftPhotoDatabase();
  const transaction = database.transaction(SEAWEED_DRAFT_PHOTO_STORE, "readwrite");
  const complete = indexedDbTransactionComplete(transaction);
  const store = transaction.objectStore(SEAWEED_DRAFT_PHOTO_STORE);
  if (!blob) {
    store.delete(recordId);
  } else {
    store.put({
      record_id: recordId,
      name: String(state.selectedSeaweedPhoto.name || "seaweed-record-photo.jpg").slice(0, 240),
      type: "image/jpeg",
      blob,
      updated_at: new Date().toISOString()
    });
  }
  await complete;
  database.close();
}

async function loadSeaweedDraftPhotoLocal(recordId) {
  try {
    const database = await openSeaweedDraftPhotoDatabase();
    const transaction = database.transaction(SEAWEED_DRAFT_PHOTO_STORE, "readonly");
    const complete = indexedDbTransactionComplete(transaction);
    const stored = await indexedDbRequest(
      transaction.objectStore(SEAWEED_DRAFT_PHOTO_STORE).get(recordId)
    );
    await complete;
    database.close();
    if (!stored?.blob) return null;
    return new File([stored.blob], stored.name || "seaweed-record-photo.jpg", {
      type: stored.type || stored.blob.type || "image/jpeg"
    });
  } catch (error) {
    console.warn("The local Seaweed draft photo could not be loaded.", error);
    return null;
  }
}

async function deleteSeaweedDraftPhotoLocal(recordId) {
  if (!recordId) return;
  try {
    const database = await openSeaweedDraftPhotoDatabase();
    const transaction = database.transaction(SEAWEED_DRAFT_PHOTO_STORE, "readwrite");
    const complete = indexedDbTransactionComplete(transaction);
    transaction.objectStore(SEAWEED_DRAFT_PHOTO_STORE).delete(recordId);
    await complete;
    database.close();
  } catch (error) {
    console.warn("The local Seaweed draft photo could not be removed.", error);
  }
}

function openSeaweedDraftPhotoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SEAWEED_DRAFT_PHOTO_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SEAWEED_DRAFT_PHOTO_STORE)) {
        database.createObjectStore(SEAWEED_DRAFT_PHOTO_STORE, { keyPath: "record_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("Local Seaweed draft photo storage could not be opened.")
    );
  });
}

function indexedDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local draft photo storage failed."));
  });
}

function indexedDbTransactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("Local draft photo storage failed.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Local draft photo storage was cancelled.")
    );
  });
}

async function persistSeaweedPhoto(recordId, file) {
  if (!file) return null;
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("Select an image file for the Seaweed Record photo.");
  }
  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    throw new Error("The selected Seaweed Record photo is larger than 25 MB.");
  }

  setStatus("seaweed", "Compressing Seaweed Record photo…");
  const blob = await preparePhoto(file);
  if (blob.size > MAX_STORED_PHOTO_BYTES) {
    throw new Error("The Seaweed Record photo could not be compressed below 1 MB.");
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

  return rpc("ag_reef_seaweed_workspace_attach_photo", {
    p_record_id: recordId,
    p_storage_path: path,
    p_original_name: String(file.name || "photo.jpg").slice(0, 255),
    p_byte_size: blob.size,
    p_content_type: "image/jpeg"
  });
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

async function loadVisibleRecordStates() {
  for (const type of ["seaweed", "inspection"]) {
    const recordId = currentRecordId(type);
    if (!recordId) continue;
    try {
      const result = await rpc("ag_reef_workspace_record_state", {
        p_record_type: type,
        p_record_id: recordId
      });
      const recordStatus = result?.record_status || "submitted";
      state.recordStates.set(type, recordStatus);
      if (type === "seaweed" && recordStatus === "draft") {
        const localPhoto = await loadSeaweedDraftPhotoLocal(recordId);
        if (localPhoto) state.selectedSeaweedPhoto = localPhoto;
      }
      scheduleSync();
    } catch (_error) {
      // The owning form module displays access and load errors.
    }
  }
}

function currentRecordId(type) {
  const value = new URLSearchParams(window.location.search).get(FORMS[type].recordParam);
  return value || null;
}

function submissionId(type) {
  const key = `reef-current-state-submission-${type}`;
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = createUuid();
    sessionStorage.setItem(key, value);
  }
  return value;
}

function clearSubmissionId(type) {
  sessionStorage.removeItem(`reef-current-state-submission-${type}`);
}

function setBusy(type, busy) {
  const config = FORMS[type];
  for (const id of [config.saveId, config.submitId, config.clearId]) {
    const control = document.getElementById(id);
    if (control) control.disabled = busy;
  }
}

function setStatus(type, message, kind = "") {
  const output = document.getElementById(FORMS[type].statusId);
  if (!output) return;
  output.textContent = message || "";
  if (kind) output.dataset.status = kind;
  else delete output.dataset.status;
}

function setFlash(type, message) {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, message }));
}

function applyFlashMessage() {
  if (state.flashApplied) return;
  const raw = sessionStorage.getItem(FLASH_KEY);
  if (!raw) return;
  try {
    const flash = JSON.parse(raw);
    const output = document.getElementById(FORMS[flash.type]?.statusId);
    if (!output) return;
    if (/loading|opening|saving|submitting/i.test(String(output.textContent || ""))) return;
    output.textContent = flash.message || "Saved.";
    output.dataset.status = "success";
    state.flashApplied = true;
    sessionStorage.removeItem(FLASH_KEY);
  } catch (_error) {
    sessionStorage.removeItem(FLASH_KEY);
  }
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || {} : data;
}

function valueOf(id) {
  return String(document.getElementById(id)?.value || "");
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function selectorEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
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

function formLabel(type) {
  if (type === "training") return "Training record";
  if (type === "seaweed") return "Seaweed Record";
  return "Raft and Mooring Inspection";
}

function isReviewMode() {
  const parameters = new URLSearchParams(window.location.search);
  return Boolean(parameters.get("share") && parameters.get("org"));
}

export const REEF_CURRENT_STATE_CONTRACT = Object.freeze({
  locations: LOCATION_OPTIONS.map(([value]) => value),
  visibleGenderValues: GENDER_OPTIONS.map(([value]) => value),
  actions: ["Save", "Submit and start new", "Clear"],
  publicAndAuthenticatedSave: true,
  legacyLocationCompatibility: true,
  legacyGenderCompatibility: true,
  seaweedDraftPhotoLocal: true,
  seaweedDraftPhotoUploadOnSubmit: true
});
