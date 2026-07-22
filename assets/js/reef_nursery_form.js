import { authClient, requireAdminAccess } from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js";

const els = {};
let submissionId = crypto.randomUUID();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reefNurseryForm", "reefNurseryTabs", "reefRecordedBy", "reefTrainingDate",
    "reefLocation", "reefStartTime", "reefFinishTime", "reefTrainerName",
    "reefTrainerOrganisation", "reefSupportingStaff", "reefSessionTypes",
    "reefConditions", "reefNurseryReference", "reefParticipantRows",
    "reefParticipantCount", "addReefParticipant", "reefSeaweedHealth",
    "reefSeedWeight", "reefSeedWeightUnit", "reefHarvestWeight",
    "reefHarvestWeightUnit", "reefEquipmentReplaced", "saveReefNursery",
    "clearReefNursery", "favoriteReefNurseryForm", "reefNurseryStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupTabs();
  els.addReefParticipant.addEventListener("click", () => addParticipantRow({ focus: true }));
  els.reefParticipantRows.addEventListener("click", handleParticipantAction);
  els.reefNurseryForm.addEventListener("submit", submitSession);
  els.clearReefNursery.addEventListener("click", clearForm);
  els.reefNurseryForm.addEventListener("input", updateFieldHighlights);
  els.reefNurseryForm.addEventListener("change", updateFieldHighlights);

  const access = await requireAdminAccess("can_submit_collection");
  if (!access) return;

  setupFavoriteFormButton({
    button: els.favoriteReefNurseryForm,
    formKey: "reef_nursery",
    profile: access.profile,
    client: authClient,
    returnPage: "reef_nursery.html"
  });

  els.reefRecordedBy.value = access.profile?.display_name
    || access.profile?.email
    || access.profile?.phone
    || "Signed-in user";
  els.reefTrainingDate.value = kenyaDate();
  addParticipantRow();
  updateFieldHighlights();
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
  document.querySelectorAll("[data-reef-tab]").forEach((tab) => {
    const active = tab.dataset.reefTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-reef-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.reefPanel !== name;
  });
}

function addParticipantRow({ focus = false } = {}) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td data-label="Participant name"><input type="text" data-participant-field="name" maxlength="160" autocomplete="name" required></td>
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

async function submitSession(event) {
  event.preventDefault();
  const record = validatedRecord();
  if (!record) return;

  els.saveReefNursery.disabled = true;
  setStatus("Saving...");
  try {
    const { data, error } = await authClient.rpc("ag_submit_reef_nursery_session", {
      p_submission_id: submissionId,
      p_session: record.session,
      p_participants: record.participants,
      p_seaweed_record: record.seaweed
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const participantCount = Number(saved?.participant_count ?? record.participants.length);
    clearForm({ preserveStatus: true });
    setStatus(`Reef Nursery session saved with ${participantCount} ${participantCount === 1 ? "participant" : "participants"}.`);
  } catch (error) {
    setStatus(error.message || "The Reef Nursery session could not be saved.", "error");
  } finally {
    els.saveReefNursery.disabled = false;
  }
}

function validatedRecord() {
  const required = [
    [els.reefRecordedBy, "Recorded by", "session"],
    [els.reefTrainingDate, "Training date", "session"],
    [els.reefLocation, "Location", "session"],
    [els.reefStartTime, "Start time", "session"],
    [els.reefFinishTime, "Finish time", "session"],
    [els.reefTrainerName, "Trainer's name", "session"],
    [els.reefTrainerOrganisation, "Trainer's organisation", "session"]
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

  const participants = [...els.reefParticipantRows.rows].map((row) => ({
    participant_name: row.querySelector('[data-participant-field="name"]').value.trim(),
    farmer_reference_phone: textOrNull(row.querySelector('[data-participant-field="reference"]').value),
    gender: textOrNull(row.querySelector('[data-participant-field="gender"]').value)
  }));
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
      trainer_organisation: els.reefTrainerOrganisation.value.trim(),
      supporting_staff: textOrNull(els.reefSupportingStaff.value),
      session_types: sessionTypes,
      weather_sea_conditions: textOrNull(els.reefConditions.value),
      nursery_reference: textOrNull(els.reefNurseryReference.value),
      recorded_by_name: els.reefRecordedBy.value.trim()
    },
    participants,
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
  const recordedBy = els.reefRecordedBy.value;
  els.reefNurseryForm.reset();
  els.reefRecordedBy.value = recordedBy;
  els.reefTrainingDate.value = kenyaDate();
  els.reefParticipantRows.replaceChildren();
  addParticipantRow();
  submissionId = crypto.randomUUID();
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
