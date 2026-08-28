import { authClient } from "./auth_client.js?v=25";
import { callPublicRpc } from "./supabase_client.js";

let emptySubmissionInFlight = false;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseOptionalParticipants, { once: true });
} else {
  initialiseOptionalParticipants();
}

function initialiseOptionalParticipants() {
  document.addEventListener("click", protectSaveAction, true);
  document.addEventListener("submit", protectFormSubmission, true);
}

function protectSaveAction(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (
    !target?.closest("#saveReefNursery")
    || participantEntries().length > 0
    || emptySubmissionInFlight
  ) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void submitEmptyParticipantRecord({ startNew: false });
}

function protectFormSubmission(event) {
  if (
    event.target?.id !== "reefNurseryForm"
    || participantEntries().length > 0
    || emptySubmissionInFlight
  ) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void submitEmptyParticipantRecord({ startNew: true });
}

function participantEntries() {
  return [...document.querySelectorAll("#reefParticipantRows tr")]
    .map((row) => ({
      participant_name: row.querySelector('[data-participant-field="name"]')?.value.trim() || "",
      farmer_reference_phone: textOrNull(
        row.querySelector('[data-participant-field="reference"]')?.value
      ),
      gender: textOrNull(row.querySelector('[data-participant-field="gender"]')?.value)
    }))
    .filter((participant) => (
      participant.participant_name
      || participant.farmer_reference_phone
      || participant.gender
    ));
}

async function submitEmptyParticipantRecord({ startNew }) {
  const record = collectTrainingRecord();
  if (!record) return;

  emptySubmissionInFlight = true;
  setTrainingActionsDisabled(true);
  setStatus(currentTrainingRecordId() ? "Saving Training changes…" : "Submitting Training record…");
  try {
    if (isReviewMode()) await submitReviewRecord(record);
    else await submitWorkspaceRecord(record);

    if (startNew) window.location.assign(newTrainingRoute());
    else window.location.reload();
  } catch (error) {
    setStatus(error.message || "The Training record could not be saved.", "error");
    setTrainingActionsDisabled(false);
    emptySubmissionInFlight = false;
  }
}

function collectTrainingRecord() {
  const required = [
    ["reefTrainingDate", "Training date"],
    ["reefStartTime", "Start time"],
    ["reefFinishTime", "Finish time"]
  ];
  for (const [id, label] of required) {
    const control = document.getElementById(id);
    if (String(control?.value || "").trim()) continue;
    setStatus(`${label} is required before submission.`, "error");
    control?.focus();
    return null;
  }

  const startTime = document.getElementById("reefStartTime").value;
  const finishTime = document.getElementById("reefFinishTime").value;
  if (finishTime <= startTime) {
    setStatus("Finish time must be after start time.", "error");
    document.getElementById("reefFinishTime")?.focus();
    return null;
  }

  const sessionTypes = [...document.querySelectorAll('[name="reefSessionType"]:checked')]
    .map((control) => control.value);
  if (!sessionTypes.length) {
    setStatus("Select at least one type of session before submission.", "error");
    document.getElementById("reefSessionTypes")?.focus?.();
    return null;
  }

  const other = document.getElementById("reefOtherSessionType");
  if (sessionTypes.includes("other") && !other?.value.trim()) {
    setStatus("Enter the other session type before submission.", "error");
    other?.focus();
    return null;
  }

  return {
    session: {
      training_date: document.getElementById("reefTrainingDate").value,
      location: document.getElementById("reefLocation").value,
      start_time: startTime,
      finish_time: finishTime,
      trainer_name: document.getElementById("reefTrainerName").value.trim(),
      supporting_staff: textOrNull(document.getElementById("reefSupportingStaff").value),
      session_types: sessionTypes,
      other_session_type: sessionTypes.includes("other") ? other.value.trim() : null,
      weather_sea_conditions: textOrNull(document.getElementById("reefConditions").value),
      nursery_reference: textOrNull(document.getElementById("reefNurseryReference").value)
    },
    participants: [],
    trainingDelivered: collectTrainingDelivered(),
    practicalCompetencies: collectGroupCompetencies()
  };
}

function collectTrainingDelivered() {
  return [...document.querySelectorAll("#reefTrainingSections [data-training-section]")]
    .map((section) => ({
      section_key: section.dataset.trainingSection,
      activity_ids: [...section.querySelectorAll("[data-training-activity]:checked")]
        .map((control) => control.dataset.trainingActivity),
      other_text: textOrNull(section.querySelector("[data-training-other]")?.value)
    }))
    .filter((section) => section.activity_ids.length || section.other_text);
}

function collectGroupCompetencies() {
  return [...document.querySelectorAll("#reefCompetencySections [data-competency-activity]")]
    .flatMap((task) => {
      const group = task.querySelector("[data-competency-group-level]:checked")?.value || "";
      if (!group) return [];
      const activityId = task.dataset.competencyActivity;
      const delivered = [...document.querySelectorAll(
        "#reefTrainingSections [data-training-activity]"
      )].find((control) => control.dataset.trainingActivity === activityId);
      const sectionKey = delivered?.closest("[data-training-section]")?.dataset.trainingSection;
      return sectionKey ? [{
        section_key: sectionKey,
        activity_id: activityId,
        group_level: group,
        participant_overrides: []
      }] : [];
    });
}

async function submitWorkspaceRecord(record) {
  const sessionId = currentTrainingRecordId();
  const args = {
    p_session: record.session,
    p_participants: [],
    p_training_delivered: record.trainingDelivered,
    p_practical_competencies: record.practicalCompetencies
  };
  const { error } = sessionId
    ? await authClient.rpc("ag_reef_training_workspace_update", {
      p_session_id: sessionId,
      ...args
    })
    : await authClient.rpc("ag_reef_training_workspace_submit", {
      p_submission_id: createUuid(),
      ...args
    });
  if (error) throw error;
}

async function submitReviewRecord(record) {
  const parameters = new URLSearchParams(window.location.search);
  const trainerName = String(record.session.trainer_name || "").trim();
  const result = await callPublicRpc("ag_public_shared_form_submission", {
    p_share_token: parameters.get("share"),
    p_submission_id: createUuid(),
    p_payload: {
      form: "reef_nursery",
      record,
      photos: [],
      review_page: window.location.pathname
    },
    p_submitter_name: trainerName.length >= 2 ? trainerName : null,
    p_client_key: stableReviewClientKey(),
    p_user_agent: navigator.userAgent
  });
  if (!result?.ok) throw new Error("The test submission was not accepted.");
}

function currentTrainingRecordId() {
  return new URLSearchParams(window.location.search).get("record");
}

function newTrainingRoute() {
  if (!isReviewMode()) return "./reef_nursery.html";
  const source = new URLSearchParams(window.location.search);
  const route = new URLSearchParams({
    share: source.get("share"),
    org: source.get("org")
  });
  return `./reef_nursery.html?${route}`;
}

function isReviewMode() {
  const parameters = new URLSearchParams(window.location.search);
  return Boolean(parameters.get("share") && parameters.get("org"));
}

function setTrainingActionsDisabled(disabled) {
  for (const id of ["saveReefNursery", "submitReefNursery", "clearReefNursery"]) {
    const control = document.getElementById(id);
    if (control) control.disabled = disabled;
  }
}

function setStatus(message, kind = "") {
  const status = document.getElementById("reefNurseryStatus");
  if (!status) return;
  status.textContent = message || "";
  if (kind) status.dataset.status = kind;
  else delete status.dataset.status;
}

function stableReviewClientKey() {
  const key = "seaweed-harvest:form-review-client";
  try {
    const existing = localStorage.getItem(key);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const value = createUuid();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return createUuid();
  }
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function createUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const REEF_TRAINING_OPTIONAL_PARTICIPANTS_CONTRACT = Object.freeze({
  optionalParticipants: true
});
