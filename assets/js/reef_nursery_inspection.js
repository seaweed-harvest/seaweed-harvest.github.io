import { authClient } from "./auth_client.js?v=25";

const RAFT_NUMBERS = Object.freeze([1, 2, 3, 4, 5]);
const FIELD_KEYS = Object.freeze([
  "overall_position_condition",
  "seaweed_lines_attachments",
  "hdpe_floating_frame",
  "rigging_harness",
  "mooring_components",
  "mooring_anchors",
  "mooring_attachment_points"
]);

const els = {};
const inspectionDrafts = new Map();
const state = {
  accessMode: "denied",
  editingRecordId: null,
  publicEditUntil: null,
  submissionId: createUuid()
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  [
    "reefInspectionForm", "reefInspectionRecordNumber", "reefInspectionRecordState",
    "reefInspectionDate", "reefInspectionLocation", "reefInspectionRecordedBy",
    "reefInspectionRaftSelector", "reefInspectionRaftCards", "reefInspectionGeneralNotes",
    "submitReefInspection", "saveReefInspectionChanges", "clearReefInspection",
    "reefInspectionStatus", "reefTrainingWorkspace"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!els.reefInspectionForm) return;
  bindEvents();

  try {
    const context = await rpc("ag_reef_inspection_workspace_context");
    if (!context?.allowed) return;
    state.accessMode = context.access_mode || "public";
    initializeNewInspection();

    const params = new URLSearchParams(window.location.search);
    const requestedRecord = params.get("inspection_record");
    if (params.get("tab") === "inspection" || requestedRecord) {
      await waitForTrainingWorkspace();
      openInspectionTab();
      if (requestedRecord) await loadInspectionRecord(requestedRecord);
    }
  } catch (error) {
    setStatus(error.message || "The Raft and Mooring Inspection workspace could not be opened.", "error");
  }
}

function bindEvents() {
  els.reefInspectionRaftSelector.addEventListener("change", () => {
    captureInspectionDrafts();
    renderInspectionCards();
  });
  els.reefInspectionRaftCards.addEventListener("input", captureInspectionDrafts);
  els.reefInspectionRaftCards.addEventListener("change", captureInspectionDrafts);
  els.reefInspectionForm.addEventListener("submit", submitInspectionRecord);
  els.saveReefInspectionChanges.addEventListener("click", saveInspectionChanges);
  els.clearReefInspection.addEventListener("click", () => {
    initializeNewInspection();
    history.replaceState({}, "", "./reef_nursery.html?tab=inspection");
    setStatus("");
  });
}

function initializeNewInspection() {
  state.editingRecordId = null;
  state.publicEditUntil = null;
  state.submissionId = createUuid();
  inspectionDrafts.clear();
  els.reefInspectionForm.reset();
  els.reefInspectionDate.value = kenyaDate();
  els.reefInspectionRecordNumber.textContent = "New record";
  els.reefInspectionRecordState.textContent = "Unsaved";
  renderInspectionCards();
  updateEditActions();
}

function updateEditActions() {
  const editing = Boolean(state.editingRecordId);
  els.submitReefInspection.hidden = editing;
  els.saveReefInspectionChanges.hidden = !editing;
  els.clearReefInspection.textContent = editing
    ? "Start new inspection"
    : "Clear inspection";
}

function openInspectionTab() {
  document.querySelector('[data-reef-training-tab="inspection"]')?.click();
}

async function waitForTrainingWorkspace() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!els.reefTrainingWorkspace.hidden) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function selectedRaftNumbers() {
  return [...els.reefInspectionRaftSelector.querySelectorAll("[data-inspection-raft]:checked")]
    .map((control) => Number(control.dataset.inspectionRaft))
    .filter((value) => RAFT_NUMBERS.includes(value));
}

function inspectionDraft(raftNumber) {
  const key = String(raftNumber);
  if (!inspectionDrafts.has(key)) {
    inspectionDrafts.set(key, Object.fromEntries(FIELD_KEYS.map((field) => [field, ""])));
  }
  return inspectionDrafts.get(key);
}

function captureInspectionDrafts() {
  els.reefInspectionRaftCards.querySelectorAll("[data-inspection-raft-card]").forEach((card) => {
    const draft = inspectionDraft(card.dataset.inspectionRaftCard);
    FIELD_KEYS.forEach((field) => {
      const control = card.querySelector(`[data-inspection-field="${field}"]`);
      if (control) draft[field] = control.value;
    });
  });
}

function renderInspectionCards() {
  captureInspectionDrafts();
  const raftNumbers = selectedRaftNumbers();
  if (!raftNumbers.length) {
    els.reefInspectionRaftCards.innerHTML = '<p class="reef-help">Select at least one raft to inspect.</p>';
    return;
  }
  els.reefInspectionRaftCards.innerHTML = raftNumbers.map(renderInspectionCard).join("");
}

function renderInspectionCard(raftNumber) {
  const draft = inspectionDraft(raftNumber);
  return `
    <article class="reef-inspection-raft-card" data-inspection-raft-card="${raftNumber}">
      <div class="reef-panel-heading">
        <div><h3>Raft #${raftNumber}</h3></div>
      </div>

      ${renderTextArea(
        "Overall position and operating condition",
        "overall_position_condition",
        draft.overall_position_condition,
        "Position, orientation, flotation and general operating condition"
      )}

      ${renderTextArea(
        "Seaweed lines and attachments",
        "seaweed_lines_attachments",
        draft.seaweed_lines_attachments,
        "Lines, ties, clips and attachment condition"
      )}

      <fieldset class="reef-inspection-subgroup">
        <legend>HDPE floating frame &amp; Rigging harness</legend>
        <div class="reef-inspection-subgroup-grid">
          ${renderTextArea(
            "HDPE floating frame",
            "hdpe_floating_frame",
            draft.hdpe_floating_frame,
            "Pipe, joints, flotation and visible damage"
          )}
          ${renderTextArea(
            "Rigging harness",
            "rigging_harness",
            draft.rigging_harness,
            "Harness, bridles, knots, chafe and load distribution"
          )}
        </div>
      </fieldset>

      <fieldset class="reef-inspection-subgroup">
        <legend>Mooring</legend>
        <div class="reef-inspection-subgroup-grid reef-inspection-mooring-grid">
          ${renderTextArea(
            "Components",
            "mooring_components",
            draft.mooring_components,
            "Rope, chain, swivels, shackles, floats and wear"
          )}
          ${renderTextArea(
            "Anchors",
            "mooring_anchors",
            draft.mooring_anchors,
            "Anchor position, holding and visible condition"
          )}
          ${renderTextArea(
            "Attachment points to raft",
            "mooring_attachment_points",
            draft.mooring_attachment_points,
            "Connection points, chafe protection and security"
          )}
        </div>
      </fieldset>
    </article>`;
}

function renderTextArea(label, field, value, placeholder) {
  return `
    <label>${escapeHtml(label)}
      <textarea rows="3" maxlength="3000" data-inspection-field="${escapeHtml(field)}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
    </label>`;
}

async function submitInspectionRecord(event) {
  event.preventDefault();
  if (state.editingRecordId) return;
  const payload = validatedInspection();
  if (!payload) return;

  setSaving(true);
  setStatus("Submitting Raft and Mooring Inspection…");
  try {
    const saved = await rpc("ag_reef_inspection_workspace_submit", {
      p_submission_id: state.submissionId,
      p_record: payload.record,
      p_rafts: payload.rafts
    });
    state.editingRecordId = saved.record_id;
    state.publicEditUntil = saved.public_edit_until || null;
    els.reefInspectionRecordNumber.textContent = saved.record_number || "Inspection";
    els.reefInspectionRecordState.textContent = recordStateLabel(state.publicEditUntil);
    updateEditActions();
    history.replaceState(
      {},
      "",
      `./reef_nursery.html?tab=inspection&inspection_record=${encodeURIComponent(saved.record_id)}`
    );
    setStatus(`${saved.record_number || "Raft and Mooring Inspection"} submitted.`, "success");
  } catch (error) {
    setStatus(error.message || "The Raft and Mooring Inspection could not be submitted.", "error");
  } finally {
    setSaving(false);
  }
}

async function saveInspectionChanges() {
  if (!state.editingRecordId) return;
  const payload = validatedInspection();
  if (!payload) return;

  setSaving(true);
  setStatus("Saving inspection changes…");
  try {
    const saved = await rpc("ag_reef_inspection_workspace_update", {
      p_record_id: state.editingRecordId,
      p_record: payload.record,
      p_rafts: payload.rafts
    });
    state.publicEditUntil = saved.public_edit_until || state.publicEditUntil;
    els.reefInspectionRecordState.textContent = recordStateLabel(state.publicEditUntil);
    setStatus(
      `${saved.record_number || els.reefInspectionRecordNumber.textContent} changes saved. The original 168-hour deadline is unchanged.`,
      "success"
    );
  } catch (error) {
    if (shouldRequireLogin(error)) return routeToLoginForInspection(state.editingRecordId);
    setStatus(error.message || "The inspection changes could not be saved.", "error");
  } finally {
    setSaving(false);
  }
}

function validatedInspection() {
  const required = [
    [els.reefInspectionDate, "Inspection date"],
    [els.reefInspectionLocation, "Location"],
    [els.reefInspectionRecordedBy, "Person filling the form"]
  ];
  for (const [control, label] of required) {
    if (String(control.value || "").trim()) continue;
    return validationError(`${label} is required.`, control);
  }

  captureInspectionDrafts();
  const raftNumbers = selectedRaftNumbers();
  if (!raftNumbers.length) {
    return validationError("Select at least one raft to inspect.", els.reefInspectionRaftSelector);
  }

  const rafts = [];
  for (const raftNumber of raftNumbers) {
    const draft = inspectionDraft(raftNumber);
    const normalized = Object.fromEntries(
      FIELD_KEYS.map((field) => [field, textOrNull(draft[field])])
    );
    if (!FIELD_KEYS.some((field) => normalized[field])) {
      return validationError(`Enter at least one observation for Raft #${raftNumber}.`);
    }
    rafts.push({ raft_number: raftNumber, ...normalized });
  }

  return {
    record: {
      inspection_date: els.reefInspectionDate.value,
      location: els.reefInspectionLocation.value,
      recorded_by_name: els.reefInspectionRecordedBy.value.trim(),
      general_notes: textOrNull(els.reefInspectionGeneralNotes.value)
    },
    rafts
  };
}

function validationError(message, control = null) {
  setStatus(message, "error");
  control?.focus?.();
  return null;
}

async function loadInspectionRecord(recordId) {
  setSaving(true);
  setStatus("Loading Raft and Mooring Inspection…");
  try {
    const data = await rpc("ag_reef_inspection_workspace_detail", { p_record_id: recordId });
    hydrateInspection(data);
    state.editingRecordId = data.record_id;
    state.publicEditUntil = data.public_edit_until || null;
    els.reefInspectionRecordNumber.textContent = data.record_number || "Inspection";
    els.reefInspectionRecordState.textContent = recordStateLabel(state.publicEditUntil);
    updateEditActions();
    history.replaceState(
      {},
      "",
      `./reef_nursery.html?tab=inspection&inspection_record=${encodeURIComponent(recordId)}`
    );
    openInspectionTab();
    setStatus(`${data.record_number || "Raft and Mooring Inspection"} loaded.`);
  } catch (error) {
    if (shouldRequireLogin(error)) return routeToLoginForInspection(recordId);
    setStatus(error.message || "The Raft and Mooring Inspection could not be opened.", "error");
  } finally {
    setSaving(false);
  }
}

function hydrateInspection(data) {
  inspectionDrafts.clear();
  els.reefInspectionDate.value = String(data.inspection_date || "").slice(0, 10);
  els.reefInspectionLocation.value = data.location || "";
  els.reefInspectionRecordedBy.value = data.recorded_by_name || "";
  els.reefInspectionGeneralNotes.value = data.general_notes || "";

  const rafts = Array.isArray(data.rafts) ? data.rafts : [];
  const selected = new Set(rafts.map((raft) => Number(raft.raft_number)));
  els.reefInspectionRaftSelector.querySelectorAll("[data-inspection-raft]").forEach((control) => {
    control.checked = selected.has(Number(control.dataset.inspectionRaft));
  });

  rafts.forEach((raft) => {
    const draft = inspectionDraft(raft.raft_number);
    FIELD_KEYS.forEach((field) => { draft[field] = String(raft[field] || ""); });
  });
  renderInspectionCards();
}

function setSaving(disabled) {
  els.submitReefInspection.disabled = disabled;
  els.saveReefInspectionChanges.disabled = disabled;
  els.clearReefInspection.disabled = disabled;
}

function setStatus(message, kind = "") {
  els.reefInspectionStatus.textContent = message || "";
  if (kind) els.reefInspectionStatus.dataset.status = kind;
  else delete els.reefInspectionStatus.dataset.status;
}

function recordStateLabel(publicEditUntil) {
  if (state.accessMode === "authenticated") return "Submitted";
  return publicEditUntil ? `Open until ${formatDateTime(publicEditUntil)}` : "Submitted";
}

function shouldRequireLogin(error) {
  return state.accessMode !== "authenticated"
    && (String(error?.code || "") === "42501"
      || /older than 7 days|sign in|authorised cosme reef|expired/i.test(String(error?.message || "")));
}

function routeToLoginForInspection(recordId) {
  const returnPage = `reef_nursery.html?tab=inspection&inspection_record=${encodeURIComponent(recordId)}`;
  window.location.assign(`./login.html?return=${encodeURIComponent(returnPage)}`);
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || {} : data;
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
