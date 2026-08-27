import { authClient } from "./auth_client.js?v=25";

const PAGE_SIZE = 40;
const TRAINING_SECTION_KEYS = [
  "general_in_water_training",
  "seeding",
  "harvesting",
  "line_inspection_maintenance",
  "mooring_inspection_maintenance",
  "nursery_deployment_recovery"
];
const COMPETENCY_LEVELS = [
  { value: "needs_support", label: "Needs support" },
  { value: "with_supervision", label: "Can complete supervised" },
  { value: "independent", label: "Can complete independently" }
];
const LOCATION_LABELS = {
  mkwiro: "Mkwiro",
  offshore_nursery: "Offshore nursery site",
  shoreline_preparation: "Shoreline preparation area"
};
const SESSION_TYPE_LABELS = {
  general_in_water_training: "General in-water training",
  seeding: "Seeding",
  harvesting: "Harvesting",
  line_inspection_maintenance: "Line inspection and maintenance",
  mooring_inspection_maintenance: "Mooring inspection and maintenance",
  nursery_deployment_recovery: "Nursery deployment / recovery",
  other: "Other"
};

const els = {};
const trainingDrafts = new Map();
const competencyDrafts = new Map();
const state = {
  accessMode: "denied",
  profileName: "",
  entryAccess: "private",
  trainingMatrix: [],
  editingSessionId: null,
  publicEditUntil: null,
  submissionId: crypto.randomUUID(),
  recordsPage: 0,
  recordsTotal: 0,
  recordsSearch: ""
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reefAccessStatus", "reefSignIn", "reefHome", "reefAccessGate", "reefAccessGateMessage",
    "reefGateSignIn", "reefTrainingWorkspace", "reefPublicNotice", "reefTrainingTabs",
    "reefTrainingForm", "reefTrainingFormActions", "reefRecordNumber", "reefRecordState",
    "reefTrainingDate", "reefLocation", "reefStartTime", "reefFinishTime", "reefTrainerName",
    "reefSupportingStaff", "reefSessionTypes", "reefOtherSessionTypeField", "reefOtherSessionType",
    "reefConditions", "reefNurseryReference", "addReefParticipant", "reefParticipantRows",
    "reefParticipantTemplate", "reefTrainingEmpty", "reefTrainingSections", "reefCompetencyEmpty",
    "reefCompetencySections", "reefRecordsRefresh", "reefRecordsAccessHelp", "reefRecordsSearch",
    "reefRecordsSearchButton", "reefRecordsStatus", "reefRecordsBody", "reefRecordsPrevious",
    "reefRecordsPage", "reefRecordsNext", "submitReefTraining", "saveReefTrainingChanges",
    "clearReefTraining", "reefTrainingStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  bindEvents();
  try {
    const context = await rpc("ag_reef_training_workspace_context");
    if (!context?.allowed) {
      showAccessGate(context?.reason || "Sign in with an authorised COSME Reef account to continue.");
      return;
    }

    state.accessMode = context.access_mode || "public";
    state.profileName = context.profile_name || "";
    state.entryAccess = context.entry_access || "private";
    state.trainingMatrix = normalizeTrainingMatrix(context.training_matrix);
    if (state.trainingMatrix.length !== TRAINING_SECTION_KEYS.length) {
      throw new Error("The Reef Nursery training matrix is incomplete.");
    }

    configureAccessDisplay();
    els.reefTrainingWorkspace.hidden = false;
    initializeNewRecord();

    const requestedRecord = new URLSearchParams(window.location.search).get("record");
    if (requestedRecord) await loadRecord(requestedRecord);
  } catch (error) {
    showAccessGate(error.message || "The Reef Nursery Training record could not be opened.");
  } finally {
    document.body.removeAttribute("data-auth-pending");
  }
}

function bindEvents() {
  els.reefTrainingTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-reef-training-tab]");
    if (tab) showTab(tab.dataset.reefTrainingTab);
  });
  els.reefTrainingTabs.addEventListener("keydown", handleTabKeydown);
  els.reefSessionTypes.addEventListener("change", handleSessionTypeChange);
  els.addReefParticipant.addEventListener("click", () => addParticipant({ focus: true }));
  els.reefParticipantRows.addEventListener("click", handleParticipantAction);
  els.reefParticipantRows.addEventListener("input", () => renderCompetency());
  els.reefParticipantRows.addEventListener("change", () => renderCompetency());
  els.reefTrainingSections.addEventListener("change", handleTrainingChange);
  els.reefTrainingSections.addEventListener("input", captureTrainingDrafts);
  els.reefCompetencySections.addEventListener("change", handleCompetencyChange);
  els.reefTrainingForm.addEventListener("submit", submitNewRecord);
  els.saveReefTrainingChanges.addEventListener("click", saveRecordChanges);
  els.clearReefTraining.addEventListener("click", () => clearRecord());
  els.reefRecordsRefresh.addEventListener("click", () => loadRecords());
  els.reefRecordsSearchButton.addEventListener("click", searchRecords);
  els.reefRecordsSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchRecords();
    }
  });
  els.reefRecordsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-record]");
    if (button) void openRecord(button.dataset.openRecord);
  });
  els.reefRecordsPrevious.addEventListener("click", () => changeRecordsPage(-1));
  els.reefRecordsNext.addEventListener("click", () => changeRecordsPage(1));
}

function configureAccessDisplay() {
  const authenticated = state.accessMode === "authenticated";
  els.reefAccessStatus.textContent = authenticated
    ? `Signed in${state.profileName ? ` as ${state.profileName}` : ""}`
    : "Public entry — no login required";
  els.reefSignIn.hidden = authenticated;
  els.reefHome.hidden = !authenticated;
  els.reefPublicNotice.hidden = authenticated;
  els.reefRecordsAccessHelp.textContent = authenticated
    ? "Signed-in COSME Reef access shows the full Training record history, including records older than 7 days."
    : "Records created in the last 7 days are openly listed and editable. Records disappear from public access at 168 hours and then require an authorised COSME Reef login.";
}

function showAccessGate(message) {
  const requestedRecord = new URLSearchParams(window.location.search).get("record");
  const returnPage = requestedRecord
    ? `reef_nursery.html?record=${encodeURIComponent(requestedRecord)}`
    : "reef_nursery.html";
  const signInHref = `./login.html?return=${encodeURIComponent(returnPage)}`;
  els.reefSignIn.href = signInHref;
  els.reefGateSignIn.href = signInHref;
  els.reefAccessStatus.textContent = "Sign-in required";
  els.reefAccessGateMessage.textContent = message;
  els.reefAccessGate.hidden = false;
  els.reefTrainingWorkspace.hidden = true;
  document.body.removeAttribute("data-auth-pending");
}

function handleTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...els.reefTrainingTabs.querySelectorAll("[data-reef-training-tab]")];
  const current = tabs.indexOf(event.target.closest("[data-reef-training-tab]"));
  if (current < 0) return;
  event.preventDefault();
  let next = current;
  if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = tabs.length - 1;
  tabs[next].focus();
  showTab(tabs[next].dataset.reefTrainingTab);
}

function showTab(name) {
  els.reefTrainingTabs.querySelectorAll("[data-reef-training-tab]").forEach((tab) => {
    const active = tab.dataset.reefTrainingTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-reef-training-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.reefTrainingPanel !== name;
  });
  els.reefTrainingFormActions.hidden = name === "records";
  if (name === "records") void loadRecords();
}

function initializeNewRecord() {
  state.editingSessionId = null;
  state.publicEditUntil = null;
  state.submissionId = crypto.randomUUID();
  trainingDrafts.clear();
  competencyDrafts.clear();
  els.reefTrainingForm.reset();
  els.reefRecordNumber.textContent = "New record";
  els.reefRecordState.textContent = "Unsaved";
  els.reefTrainingDate.value = kenyaDate();
  els.reefParticipantRows.replaceChildren();
  addParticipant();
  els.reefOtherSessionTypeField.hidden = true;
  renderTrainingSections();
  renderCompetency();
  updateEditActions();
  showTab("session");
}

function clearRecord({ preserveStatus = false } = {}) {
  initializeNewRecord();
  history.replaceState({}, "", "./reef_nursery.html");
  document.title = "Reef Nursery - Seaweed Harvest";
  if (!preserveStatus) setStatus("");
}

function updateEditActions() {
  const editing = Boolean(state.editingSessionId);
  els.submitReefTraining.hidden = editing;
  els.saveReefTrainingChanges.hidden = !editing;
  els.clearReefTraining.textContent = editing ? "Cancel edit" : "Clear";
}

function handleSessionTypeChange() {
  captureTrainingDrafts();
  const selected = selectedSessionTypes();
  els.reefOtherSessionTypeField.hidden = !selected.includes("other");
  if (!selected.includes("other")) els.reefOtherSessionType.value = "";
  renderTrainingSections();
  renderCompetency();
}

function selectedSessionTypes() {
  return [...els.reefSessionTypes.querySelectorAll('input[type="checkbox"]:checked')]
    .map((control) => control.value);
}

function normalizeTrainingMatrix(value) {
  return (Array.isArray(value) ? value : [])
    .filter((section) => TRAINING_SECTION_KEYS.includes(String(section?.section_key || "")))
    .map((section) => ({
      section_key: String(section.section_key),
      section_label: String(section.section_label || SESSION_TYPE_LABELS[section.section_key] || section.section_key),
      section_order: Number(section.section_order || 0),
      activities: (Array.isArray(section.activities) ? section.activities : []).map((activity) => ({
        id: String(activity.id || ""),
        label: String(activity.label || activity.activity_label || ""),
        activity_order: Number(activity.activity_order || 0)
      })).filter((activity) => activity.id && activity.label)
    }))
    .sort((left, right) => left.section_order - right.section_order);
}

function trainingDraft(sectionKey) {
  if (!trainingDrafts.has(sectionKey)) {
    trainingDrafts.set(sectionKey, { activityIds: new Set(), otherText: "" });
  }
  return trainingDrafts.get(sectionKey);
}

function captureTrainingDrafts() {
  els.reefTrainingSections.querySelectorAll("[data-training-section]").forEach((section) => {
    const sectionKey = section.dataset.trainingSection;
    const draft = trainingDraft(sectionKey);
    draft.activityIds = new Set(
      [...section.querySelectorAll("[data-training-activity]:checked")]
        .map((control) => control.value)
    );
    draft.otherText = section.querySelector("[data-training-other]")?.value || "";
  });
}

function renderTrainingSections() {
  const selected = new Set(selectedSessionTypes());
  const sections = state.trainingMatrix.filter((section) => selected.has(section.section_key));
  els.reefTrainingEmpty.hidden = sections.length > 0;
  els.reefTrainingSections.innerHTML = sections.map((section) => {
    const draft = trainingDraft(section.section_key);
    return `
      <section class="reef-training-section" data-training-section="${escapeHtml(section.section_key)}">
        <div class="reef-training-section-head"><h3>${escapeHtml(section.section_label)}</h3></div>
        <div class="reef-activity-list">
          ${section.activities.map((activity) => `
            <label class="reef-activity-option">
              <input type="checkbox" data-training-activity value="${escapeHtml(activity.id)}" ${draft.activityIds.has(activity.id) ? "checked" : ""}>
              <span>${escapeHtml(activity.label)}</span>
            </label>`).join("")}
        </div>
        <label class="reef-other-activity">Other training delivered
          <input type="text" data-training-other maxlength="500" value="${escapeHtml(draft.otherText)}" placeholder="Optional">
        </label>
      </section>`;
  }).join("");
}

function handleTrainingChange(event) {
  captureTrainingDrafts();
  if (event.target.matches("[data-training-activity]")) renderCompetency();
}

function addParticipant({ participant = {}, focus = false } = {}) {
  const fragment = els.reefParticipantTemplate.content.cloneNode(true);
  const row = fragment.querySelector("[data-participant-row]");
  row.dataset.participantKey = crypto.randomUUID();
  row.querySelector("[data-participant-name]").value = participant.participant_name || "";
  row.querySelector("[data-participant-reference]").value = participant.farmer_reference_phone || "";
  row.querySelector("[data-participant-gender]").value = participant.gender || "";
  els.reefParticipantRows.append(fragment);
  updateParticipantTitles();
  renderCompetency();
  if (focus) row.querySelector("[data-participant-name]").focus();
  return row;
}

function handleParticipantAction(event) {
  const remove = event.target.closest("[data-remove-participant]");
  if (!remove) return;
  captureCompetencyDrafts();
  const row = remove.closest("[data-participant-row]");
  const key = row?.dataset.participantKey;
  if (els.reefParticipantRows.querySelectorAll("[data-participant-row]").length === 1) {
    row.querySelectorAll("input").forEach((input) => { input.value = ""; });
    row.querySelector("select").value = "";
  } else {
    row.remove();
  }
  if (key) competencyDrafts.forEach((draft) => draft.overrides.delete(key));
  updateParticipantTitles();
  renderCompetency();
}

function updateParticipantTitles() {
  [...els.reefParticipantRows.querySelectorAll("[data-participant-row]")].forEach((row, index) => {
    row.querySelector("[data-participant-title]").textContent = `Participant ${index + 1}`;
  });
}

function participantRows({ includeBlank = false } = {}) {
  return [...els.reefParticipantRows.querySelectorAll("[data-participant-row]")]
    .map((row) => ({
      row,
      key: row.dataset.participantKey,
      participant_name: row.querySelector("[data-participant-name]").value.trim(),
      farmer_reference_phone: textOrNull(row.querySelector("[data-participant-reference]").value),
      gender: textOrNull(row.querySelector("[data-participant-gender]").value)
    }))
    .filter((participant) => includeBlank
      || participant.participant_name
      || participant.farmer_reference_phone
      || participant.gender);
}

function deliveredActivities() {
  const matrixBySection = new Map(state.trainingMatrix.map((section) => [section.section_key, section]));
  const activities = [];
  for (const sectionKey of selectedSessionTypes().filter((key) => TRAINING_SECTION_KEYS.includes(key))) {
    const section = matrixBySection.get(sectionKey);
    const draft = trainingDraft(sectionKey);
    if (!section) continue;
    section.activities.forEach((activity) => {
      if (draft.activityIds.has(activity.id)) {
        activities.push({ ...activity, section_key: sectionKey, section_label: section.section_label });
      }
    });
  }
  return activities;
}

function competencyDraft(activityId) {
  if (!competencyDrafts.has(activityId)) {
    competencyDrafts.set(activityId, { groupLevel: "", overrides: new Map() });
  }
  return competencyDrafts.get(activityId);
}

function captureCompetencyDrafts() {
  els.reefCompetencySections.querySelectorAll("[data-competency-activity]").forEach((activity) => {
    const draft = competencyDraft(activity.dataset.competencyActivity);
    draft.groupLevel = activity.querySelector("[data-competency-group]")?.value || "";
    draft.overrides.clear();
    activity.querySelectorAll("[data-competency-participant]").forEach((control) => {
      if (control.value) draft.overrides.set(control.dataset.competencyParticipant, control.value);
    });
  });
}

function renderCompetency() {
  captureCompetencyDrafts();
  const activities = deliveredActivities();
  const participants = participantRows();
  els.reefCompetencyEmpty.hidden = activities.length > 0;
  if (!activities.length) {
    els.reefCompetencySections.replaceChildren();
    return;
  }

  const bySection = new Map();
  activities.forEach((activity) => {
    if (!bySection.has(activity.section_key)) bySection.set(activity.section_key, []);
    bySection.get(activity.section_key).push(activity);
  });

  els.reefCompetencySections.innerHTML = [...bySection.entries()].map(([sectionKey, sectionActivities]) => {
    const sectionLabel = sectionActivities[0]?.section_label || SESSION_TYPE_LABELS[sectionKey] || sectionKey;
    return `
      <section class="reef-competency-section">
        <h3>${escapeHtml(sectionLabel)}</h3>
        <div class="reef-competency-activity-list">
          ${sectionActivities.map((activity) => renderCompetencyActivity(activity, participants)).join("")}
        </div>
      </section>`;
  }).join("");
}

function renderCompetencyActivity(activity, participants) {
  const draft = competencyDraft(activity.id);
  return `
    <article class="reef-competency-activity" data-competency-activity="${escapeHtml(activity.id)}" data-section-key="${escapeHtml(activity.section_key)}">
      <div class="reef-competency-activity-head"><strong>${escapeHtml(activity.label)}</strong></div>
      <div class="reef-competency-controls">
        <label>All participants
          <select data-competency-group>
            <option value="">Not assessed as a group</option>
            ${COMPETENCY_LEVELS.map((level) => `<option value="${level.value}" ${draft.groupLevel === level.value ? "selected" : ""}>${escapeHtml(level.label)}</option>`).join("")}
          </select>
        </label>
        ${participants.length ? `
          <div class="reef-participant-override-list">
            ${participants.map((participant) => {
              const value = draft.overrides.get(participant.key) || "";
              return `
                <label class="reef-participant-override">
                  <span>${escapeHtml(participant.participant_name || "Unnamed participant")}</span>
                  <select data-competency-participant="${escapeHtml(participant.key)}" aria-label="Individual result for ${escapeHtml(participant.participant_name || "participant")}">
                    <option value="">Use group result</option>
                    ${COMPETENCY_LEVELS.map((level) => `<option value="${level.value}" ${value === level.value ? "selected" : ""}>${escapeHtml(level.label)}</option>`).join("")}
                  </select>
                </label>`;
            }).join("")}
          </div>` : '<p class="reef-help">Add participant names to set individual results.</p>'}
      </div>
    </article>`;
}

function handleCompetencyChange() {
  captureCompetencyDrafts();
}

async function submitNewRecord(event) {
  event.preventDefault();
  if (state.editingSessionId) return;
  const record = validatedRecord();
  if (!record) return;
  setSaveDisabled(true);
  setStatus("Submitting Training record...");
  try {
    const saved = await rpc("ag_reef_training_workspace_submit", {
      p_submission_id: state.submissionId,
      p_session: record.session,
      p_participants: record.participants,
      p_training_delivered: record.trainingDelivered,
      p_practical_competencies: record.practicalCompetencies
    });
    const recordNumber = saved?.record_number || "Training record";
    const participantCount = Number(saved?.participant_count || record.participants.length);
    const trainingCount = Number(saved?.training_activity_count || 0);
    const competencyCount = Number(saved?.competency_count || 0);
    clearRecord({ preserveStatus: true });
    setStatus(`${recordNumber} submitted with ${participantCount} ${participantCount === 1 ? "participant" : "participants"}, ${trainingCount} training ${trainingCount === 1 ? "activity" : "activities"} and ${competencyCount} practical ${competencyCount === 1 ? "assessment" : "assessments"}.`, "success");
  } catch (error) {
    setStatus(error.message || "The Training record could not be submitted.", "error");
  } finally {
    setSaveDisabled(false);
  }
}

async function saveRecordChanges() {
  if (!state.editingSessionId) return;
  const record = validatedRecord();
  if (!record) return;
  setSaveDisabled(true);
  setStatus("Saving changes...");
  try {
    const saved = await rpc("ag_reef_training_workspace_update", {
      p_session_id: state.editingSessionId,
      p_session: record.session,
      p_participants: record.participants,
      p_training_delivered: record.trainingDelivered,
      p_practical_competencies: record.practicalCompetencies
    });
    state.publicEditUntil = saved?.public_edit_until || state.publicEditUntil;
    els.reefRecordState.textContent = recordStateLabel(saved?.record_status || "submitted", state.publicEditUntil);
    setStatus(`${saved?.record_number || els.reefRecordNumber.textContent} changes saved. The original 7-day public access deadline is unchanged.`, "success");
    await loadRecords({ silent: true });
  } catch (error) {
    if (shouldRequireLogin(error)) {
      routeToLoginForRecord(state.editingSessionId);
      return;
    }
    setStatus(error.message || "The Training record changes could not be saved.", "error");
  } finally {
    setSaveDisabled(false);
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
    return validationError(`${label} is required before submission.`, tab, control);
  }
  if (els.reefFinishTime.value <= els.reefStartTime.value) {
    return validationError("Finish time must be after start time.", "session", els.reefFinishTime);
  }

  const sessionTypes = selectedSessionTypes();
  if (!sessionTypes.length) {
    return validationError("Select at least one type of session before submission.", "session", els.reefSessionTypes);
  }
  if (sessionTypes.includes("other") && !els.reefOtherSessionType.value.trim()) {
    return validationError("Enter the other session type before submission.", "session", els.reefOtherSessionType);
  }

  captureTrainingDrafts();
  captureCompetencyDrafts();
  const participantEntries = participantRows();
  const missingParticipant = participantEntries.find((participant) => !participant.participant_name);
  if (missingParticipant) {
    return validationError("Participant name is required for every participant row that contains information.", "participants", missingParticipant.row.querySelector("[data-participant-name]"));
  }

  const participants = participantEntries.map((participant) => ({
    participant_name: participant.participant_name,
    farmer_reference_phone: participant.farmer_reference_phone,
    gender: participant.gender
  }));
  const trainingDelivered = selectedSessionTypes()
    .filter((sectionKey) => TRAINING_SECTION_KEYS.includes(sectionKey))
    .map((sectionKey) => {
      const draft = trainingDraft(sectionKey);
      return {
        section_key: sectionKey,
        activity_ids: [...draft.activityIds],
        other_text: textOrNull(draft.otherText)
      };
    })
    .filter((section) => section.activity_ids.length || section.other_text);

  const participantOrder = new Map(participantEntries.map((participant, index) => [participant.key, index + 1]));
  const practicalCompetencies = deliveredActivities().flatMap((activity) => {
    const draft = competencyDraft(activity.id);
    const overrides = [...draft.overrides.entries()]
      .filter(([key, level]) => participantOrder.has(key) && level)
      .map(([key, level]) => ({ participant_order: participantOrder.get(key), competency_level: level }));
    if (!draft.groupLevel && !overrides.length) return [];
    return [{
      section_key: activity.section_key,
      activity_id: activity.id,
      group_level: draft.groupLevel || null,
      participant_overrides: overrides
    }];
  });

  return {
    session: {
      training_date: els.reefTrainingDate.value,
      location: els.reefLocation.value || null,
      start_time: els.reefStartTime.value,
      finish_time: els.reefFinishTime.value,
      trainer_name: els.reefTrainerName.value.trim() || null,
      supporting_staff: textOrNull(els.reefSupportingStaff.value),
      session_types: sessionTypes,
      other_session_type: sessionTypes.includes("other") ? els.reefOtherSessionType.value.trim() : null,
      weather_sea_conditions: textOrNull(els.reefConditions.value),
      nursery_reference: textOrNull(els.reefNurseryReference.value)
    },
    participants,
    trainingDelivered,
    practicalCompetencies
  };
}

function validationError(message, tab, control) {
  showTab(tab);
  setStatus(message, "error");
  control?.focus?.();
  return null;
}

async function loadRecord(sessionId) {
  setSaveDisabled(true);
  setStatus("Loading Training record...");
  try {
    const data = await rpc("ag_reef_training_workspace_detail", { p_session_id: sessionId });
    hydrateRecord(data);
    state.editingSessionId = data.session_id;
    state.publicEditUntil = data.public_edit_until || null;
    els.reefRecordNumber.textContent = data.record_number || "Training record";
    els.reefRecordState.textContent = recordStateLabel(data.record_status, state.publicEditUntil);
    updateEditActions();
    history.replaceState({}, "", `./reef_nursery.html?record=${encodeURIComponent(sessionId)}`);
    document.title = `${data.record_number || "Reef Nursery"} - Seaweed Harvest`;
    showTab("session");
    setStatus(`${data.record_number || "Training record"} loaded.`);
  } catch (error) {
    if (shouldRequireLogin(error)) {
      routeToLoginForRecord(sessionId);
      return;
    }
    setStatus(error.message || "The Training record could not be opened.", "error");
  } finally {
    setSaveDisabled(false);
  }
}

function hydrateRecord(data) {
  els.reefTrainingDate.value = String(data.training_date || "").slice(0, 10);
  els.reefLocation.value = data.location || "";
  els.reefStartTime.value = String(data.start_time || "").slice(0, 5);
  els.reefFinishTime.value = String(data.finish_time || "").slice(0, 5);
  els.reefTrainerName.value = data.trainer_name || "";
  els.reefSupportingStaff.value = data.supporting_staff || "";
  els.reefConditions.value = data.weather_sea_conditions || "";
  els.reefNurseryReference.value = data.nursery_reference || "";

  const sessionTypes = new Set(Array.isArray(data.session_types) ? data.session_types : []);
  els.reefSessionTypes.querySelectorAll('input[type="checkbox"]').forEach((control) => {
    control.checked = sessionTypes.has(control.value);
  });
  els.reefOtherSessionType.value = data.other_session_type || "";
  els.reefOtherSessionTypeField.hidden = !sessionTypes.has("other");

  els.reefParticipantRows.replaceChildren();
  const savedParticipants = Array.isArray(data.participants) ? data.participants : [];
  if (savedParticipants.length) savedParticipants.forEach((participant) => addParticipant({ participant }));
  else addParticipant();

  trainingDrafts.clear();
  (Array.isArray(data.training_delivered) ? data.training_delivered : []).forEach((section) => {
    trainingDrafts.set(String(section.section_key), {
      activityIds: new Set((Array.isArray(section.activity_ids) ? section.activity_ids : []).map(String)),
      otherText: String(section.other_text || "")
    });
  });
  renderTrainingSections();

  competencyDrafts.clear();
  const rows = [...els.reefParticipantRows.querySelectorAll("[data-participant-row]")];
  (Array.isArray(data.practical_competencies) ? data.practical_competencies : []).forEach((item) => {
    const draft = competencyDraft(String(item.activity_id || ""));
    draft.groupLevel = String(item.group_level || "");
    (Array.isArray(item.participant_overrides) ? item.participant_overrides : []).forEach((override) => {
      const row = rows[Number(override.participant_order) - 1];
      if (row && override.competency_level) {
        draft.overrides.set(row.dataset.participantKey, String(override.competency_level));
      }
    });
  });
  renderCompetency();
}

async function openRecord(sessionId) {
  await loadRecord(sessionId);
}

async function loadRecords({ silent = false } = {}) {
  if (!silent) setRecordsStatus("Loading records...");
  setRecordsLoading(true);
  try {
    const rows = await rpc("ag_reef_training_workspace_records", {
      p_search: state.recordsSearch || null,
      p_limit: PAGE_SIZE,
      p_offset: state.recordsPage * PAGE_SIZE
    });
    const records = Array.isArray(rows) ? rows : [];
    state.recordsTotal = Number(records[0]?.total_count || 0);
    if (state.recordsPage > 0 && !records.length && state.recordsTotal > 0) {
      state.recordsPage = Math.max(0, Math.ceil(state.recordsTotal / PAGE_SIZE) - 1);
      await loadRecords({ silent });
      return;
    }
    renderRecords(records);
    if (!silent) setRecordsStatus("");
  } catch (error) {
    renderRecords([]);
    setRecordsStatus(error.message || "Previous Records could not be loaded.", "error");
  } finally {
    setRecordsLoading(false);
  }
}

function renderRecords(records) {
  els.reefRecordsBody.replaceChildren();
  if (!records.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="7">No Training records found.</td>';
    els.reefRecordsBody.append(row);
  } else {
    records.forEach((record) => {
      const row = document.createElement("tr");
      const publicUntil = record.public_edit_until || null;
      const access = state.accessMode === "authenticated"
        ? '<span class="reef-access-pill is-signed-in">Signed-in</span>'
        : `<span class="reef-access-pill">Open until ${escapeHtml(formatDateTime(publicUntil))}</span>`;
      row.innerHTML = `
        <td><strong>${escapeHtml(record.record_number || "-")}</strong></td>
        <td>${escapeHtml(formatDate(record.training_date))}</td>
        <td>${escapeHtml(record.trainer_name || "-")}</td>
        <td>${escapeHtml(LOCATION_LABELS[record.location] || record.location || "-")}</td>
        <td>${escapeHtml(formatSessionTypes(record.session_types, record.other_session_type))}</td>
        <td>${access}</td>
        <td><button class="secondary-action" type="button" data-open-record="${escapeHtml(record.session_id)}">Open</button></td>`;
      els.reefRecordsBody.append(row);
    });
  }
  const start = state.recordsTotal ? state.recordsPage * PAGE_SIZE + 1 : 0;
  const end = Math.min((state.recordsPage + 1) * PAGE_SIZE, state.recordsTotal);
  els.reefRecordsPage.textContent = state.recordsTotal ? `${start}-${end} of ${state.recordsTotal}` : "0 records";
  els.reefRecordsPrevious.disabled = state.recordsPage === 0;
  els.reefRecordsNext.disabled = end >= state.recordsTotal;
}

function searchRecords() {
  state.recordsSearch = els.reefRecordsSearch.value.trim();
  state.recordsPage = 0;
  void loadRecords();
}

function changeRecordsPage(direction) {
  const next = state.recordsPage + direction;
  if (next < 0 || next * PAGE_SIZE >= state.recordsTotal) return;
  state.recordsPage = next;
  void loadRecords();
}

function setRecordsLoading(loading) {
  els.reefRecordsRefresh.disabled = loading;
  els.reefRecordsSearchButton.disabled = loading;
  els.reefRecordsPrevious.disabled = loading || state.recordsPage === 0;
  els.reefRecordsNext.disabled = loading || (state.recordsPage + 1) * PAGE_SIZE >= state.recordsTotal;
}

function setSaveDisabled(disabled) {
  els.submitReefTraining.disabled = disabled;
  els.saveReefTrainingChanges.disabled = disabled;
  els.clearReefTraining.disabled = disabled;
}

function setStatus(message, kind = "") {
  els.reefTrainingStatus.textContent = message;
  if (kind) els.reefTrainingStatus.dataset.status = kind;
  else delete els.reefTrainingStatus.dataset.status;
}

function setRecordsStatus(message, kind = "") {
  els.reefRecordsStatus.textContent = message;
  if (kind) els.reefRecordsStatus.dataset.status = kind;
  else delete els.reefRecordsStatus.dataset.status;
}

function recordStateLabel(status, publicEditUntil) {
  if (state.accessMode === "authenticated") return status === "draft" ? "Draft" : "Submitted";
  if (!publicEditUntil) return status === "draft" ? "Draft" : "Submitted";
  return `Open until ${formatDateTime(publicEditUntil)}`;
}

function shouldRequireLogin(error) {
  return state.accessMode !== "authenticated"
    && (String(error?.code || "") === "42501"
      || /sign in|expired|authorised cosme reef/i.test(String(error?.message || "")));
}

function routeToLoginForRecord(sessionId) {
  const returnPage = `reef_nursery.html?record=${encodeURIComponent(sessionId)}`;
  window.location.assign(`./login.html?return=${encodeURIComponent(returnPage)}`);
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) && data.length === 1 && name !== "ag_reef_training_workspace_records"
    ? data[0]
    : data;
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatSessionTypes(values, otherSessionType = "") {
  return (Array.isArray(values) ? values : []).map((value) => (
    value === "other" && otherSessionType
      ? `Other: ${otherSessionType}`
      : (SESSION_TYPE_LABELS[value] || value)
  )).join(", ");
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
