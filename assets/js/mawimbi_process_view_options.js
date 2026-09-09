import { authClient } from "./auth_client.js?v=25";

const STORAGE_KEY = "seaweed_ag:mawimbi_process_flow:detail_fields";
const LEGACY_STORAGE_KEY = "seaweed_ag:mawimbi_process_flow:detail_view";
const FIELD_OPTIONS = [
  ["method_description", "Current method"],
  ["material_state", "Material state"],
  ["equipment", "Equipment"],
  ["notes", "Notes"]
];
const VALID_FIELDS = new Set(FIELD_OPTIONS.map(([key]) => key));

const state = {
  workspace: null,
  observer: null,
  loadingWorkspace: false,
  applying: false,
  selectedFields: new Set()
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.legacySelect = document.getElementById("mawimbiViewSelect");
  els.body = document.getElementById("mawimbiMatrixBody");
  els.head = document.getElementById("mawimbiMatrixHead");
  els.captureSelect = document.getElementById("mawimbiCaptureSelect");
  if (!els.legacySelect || !els.body || !els.head || !els.captureSelect) return;

  state.selectedFields = storedFields();
  buildMultiSelect();
  els.captureSelect.addEventListener("change", () => requestAnimationFrame(applyView));
  ["mawimbiStageDialog", "mawimbiAddStageDialog", "mawimbiDuplicateDialog"].forEach((id) => {
    document.getElementById(id)?.addEventListener("close", refreshWorkspace);
  });

  state.observer = new MutationObserver(() => {
    if (state.applying) return;
    if (!state.workspace) {
      void refreshWorkspace();
      return;
    }
    requestAnimationFrame(applyView);
  });
  observeMatrix();

  if (els.body.children.length) void refreshWorkspace();
  else applyView();
}

function buildMultiSelect() {
  const legacyPicker = els.legacySelect.closest(".mawimbi-view-picker");
  if (!legacyPicker) return;

  const picker = document.createElement("details");
  picker.className = "mawimbi-view-picker mawimbi-view-multiselect";
  picker.id = "mawimbiViewPicker";

  const summary = document.createElement("summary");
  summary.className = "mawimbi-view-summary";
  summary.setAttribute("aria-label", "Choose process flow details to show");
  const summaryLabel = document.createElement("span");
  summaryLabel.textContent = "Show details";
  els.summaryValue = document.createElement("span");
  els.summaryValue.className = "mawimbi-view-summary-value";
  summary.append(summaryLabel, els.summaryValue);

  const menu = document.createElement("div");
  menu.className = "mawimbi-view-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Process flow details");

  FIELD_OPTIONS.forEach(([key, label]) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "mawimbi-view-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = key;
    input.checked = state.selectedFields.has(key);
    input.dataset.viewField = key;
    input.addEventListener("change", () => {
      if (input.checked) state.selectedFields.add(key);
      else state.selectedFields.delete(key);
      storeFields(state.selectedFields);
      applyView();
    });
    const text = document.createElement("span");
    text.textContent = label;
    optionLabel.append(input, text);
    menu.append(optionLabel);
  });

  picker.append(summary, menu);
  legacyPicker.replaceWith(picker);
  els.picker = picker;

  document.addEventListener("click", (event) => {
    if (picker.open && !picker.contains(event.target)) picker.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picker.open) {
      picker.open = false;
      summary.focus();
    }
  });
  updateSummary();
}

async function refreshWorkspace() {
  if (state.loadingWorkspace) return;
  state.loadingWorkspace = true;
  try {
    const { data, error } = await authClient.rpc("ag_mawimbi_workspace");
    if (error) throw error;
    state.workspace = normalizeWorkspace(data);
    applyView();
  } catch (error) {
    console.warn("Unable to refresh Mawimbi process view options", error);
  } finally {
    state.loadingWorkspace = false;
  }
}

function applyView() {
  if (!els.body || state.applying) return;
  state.applying = true;
  state.observer?.disconnect();
  try {
    setResourceRowVisibility("Material state", state.selectedFields.has("material_state"));
    setResourceRowVisibility("Equipment", state.selectedFields.has("equipment"));
    renderStageDetailRow(
      "method_description",
      "Current method",
      state.selectedFields.has("method_description"),
      "after-process"
    );
    renderStageDetailRow("notes", "Notes", state.selectedFields.has("notes"), "append");
    updateSummary();
  } finally {
    state.applying = false;
    observeMatrix();
  }
}

function setResourceRowVisibility(label, visible) {
  const row = [...els.body.querySelectorAll(".mawimbi-resource-row")]
    .find((candidate) => candidate.querySelector(".mawimbi-row-label")?.textContent.trim() === label);
  if (row) row.hidden = !visible;
}

function renderStageDetailRow(field, label, visible, placement) {
  els.body.querySelector(`[data-mawimbi-detail-row="${field}"]`)?.remove();
  if (!visible) return;

  const row = document.createElement("tr");
  row.className = `mawimbi-extra-detail-row mawimbi-${field.replace(/_/g, "-")}-row`;
  row.dataset.mawimbiDetailRow = field;
  const heading = document.createElement("th");
  heading.className = "mawimbi-row-label";
  heading.scope = "row";
  heading.textContent = label;
  row.append(heading);

  stageIds().forEach((flowStageId) => {
    const cell = document.createElement("td");
    cell.className = "mawimbi-extra-detail-cell";
    const detail = stageDetail(flowStageId, field);
    const value = document.createElement("span");
    value.textContent = detail || "—";
    if (!detail) value.className = "mawimbi-cell-muted";
    cell.append(value);
    row.append(cell);
  });

  if (placement === "after-process") {
    const processRow = [...els.body.querySelectorAll("tr")]
      .find((candidate) => candidate.querySelector(".mawimbi-row-label")?.textContent.trim() === "Process");
    if (processRow) processRow.after(row);
    else els.body.prepend(row);
  } else {
    els.body.append(row);
  }
}

function stageIds() {
  return [...els.head.querySelectorAll(".mawimbi-stage-heading")]
    .map((headingCell) => headingCell.dataset.flowStageId)
    .filter(Boolean);
}

function stageDetail(flowStageId, field) {
  if (!state.workspace) return "";
  const link = state.workspace.flow_stages.find((item) => item.id === flowStageId);
  if (!link) return "";
  const revision = state.workspace.stage_revisions.find((item) => item.id === link.stage_revision_id);
  return String(revision?.[field] || "").trim();
}

function normalizeWorkspace(value) {
  return {
    flow_stages: Array.isArray(value?.flow_stages) ? value.flow_stages : [],
    stage_revisions: Array.isArray(value?.stage_revisions) ? value.stage_revisions : []
  };
}

function updateSummary() {
  if (!els.summaryValue) return;
  const selectedLabels = FIELD_OPTIONS
    .filter(([key]) => state.selectedFields.has(key))
    .map(([, label]) => label);
  if (!selectedLabels.length) {
    els.summaryValue.textContent = "None";
    return;
  }
  if (selectedLabels.length <= 2) {
    els.summaryValue.textContent = selectedLabels.join(", ");
    return;
  }
  els.summaryValue.textContent = `${selectedLabels.length} selected`;
}

function observeMatrix() {
  state.observer?.observe(els.body, { childList: true });
}

function storedFields() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved)) {
      return new Set(saved.filter((field) => VALID_FIELDS.has(field)));
    }
    const migrated = legacyFields(localStorage.getItem(LEGACY_STORAGE_KEY));
    storeFields(migrated);
    return migrated;
  } catch {
    return new Set();
  }
}

function legacyFields(mode) {
  if (mode === "resources") return new Set(["material_state", "equipment"]);
  if (mode === "notes") return new Set(["notes"]);
  if (mode === "all") return new Set(["material_state", "equipment", "notes"]);
  return new Set();
}

function storeFields(fields) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...fields].filter((field) => VALID_FIELDS.has(field))));
  } catch {
    // The selector still works for the current session when storage is unavailable.
  }
}
