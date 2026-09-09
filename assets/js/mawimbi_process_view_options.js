import { authClient } from "./auth_client.js?v=25";

const STORAGE_KEY = "seaweed_ag:mawimbi_process_flow:detail_view";
const VALID_MODES = new Set(["standard", "resources", "notes", "all"]);

const state = {
  workspace: null,
  observer: null,
  loadingWorkspace: false,
  applying: false
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.select = document.getElementById("mawimbiViewSelect");
  els.body = document.getElementById("mawimbiMatrixBody");
  els.head = document.getElementById("mawimbiMatrixHead");
  els.captureSelect = document.getElementById("mawimbiCaptureSelect");
  if (!els.select || !els.body || !els.head || !els.captureSelect) return;

  els.select.value = storedMode();
  els.select.addEventListener("change", () => {
    const mode = validMode(els.select.value);
    els.select.value = mode;
    storeMode(mode);
    applyView();
  });

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
    const mode = validMode(els.select.value);
    const showResources = mode === "resources" || mode === "all";
    const showNotes = mode === "notes" || mode === "all";

    els.body.querySelectorAll(".mawimbi-resource-row").forEach((row) => {
      row.hidden = !showResources;
    });

    renderNotesRow(showNotes);
  } finally {
    state.applying = false;
    observeMatrix();
  }
}

function renderNotesRow(showNotes) {
  els.body.querySelector(".mawimbi-notes-row")?.remove();
  if (!showNotes) return;

  const row = document.createElement("tr");
  row.className = "mawimbi-notes-row";
  const heading = document.createElement("th");
  heading.className = "mawimbi-row-label";
  heading.scope = "row";
  heading.textContent = "Notes";
  row.append(heading);

  const stageIds = [...els.head.querySelectorAll(".mawimbi-stage-heading")]
    .map((headingCell) => headingCell.dataset.flowStageId)
    .filter(Boolean);

  stageIds.forEach((flowStageId) => {
    const cell = document.createElement("td");
    cell.className = "mawimbi-notes-cell";
    const note = stageNote(flowStageId);
    const value = document.createElement("span");
    value.textContent = note || "—";
    if (!note) value.className = "mawimbi-cell-muted";
    cell.append(value);
    row.append(cell);
  });

  els.body.append(row);
}

function stageNote(flowStageId) {
  if (!state.workspace) return "";
  const link = state.workspace.flow_stages.find((item) => item.id === flowStageId);
  if (!link) return "";
  const revision = state.workspace.stage_revisions.find((item) => item.id === link.stage_revision_id);
  return String(revision?.notes || "").trim();
}

function normalizeWorkspace(value) {
  return {
    flow_stages: Array.isArray(value?.flow_stages) ? value.flow_stages : [],
    stage_revisions: Array.isArray(value?.stage_revisions) ? value.stage_revisions : []
  };
}

function observeMatrix() {
  state.observer?.observe(els.body, { childList: true });
}

function storedMode() {
  try {
    return validMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "standard";
  }
}

function storeMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // The selector still works for the current session when storage is unavailable.
  }
}

function validMode(value) {
  return VALID_MODES.has(value) ? value : "standard";
}
