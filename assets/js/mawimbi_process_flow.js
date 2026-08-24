import { authClient } from "./auth_client.js?v=25";

const RESOURCE_ROWS = [
  ["material_state", "Material state"],
  ["equipment_list", "Equipment"]
];

const STANDARD_OPERATIONAL_INPUTS = [
  ["Reference quantity", ""],
  ["People", "people"],
  ["Touch time", "min"],
  ["Elapsed time", "min"],
  ["Waiting time", "min"],
  ["Equipment time", "min"]
];

const state = {
  workspace: emptyWorkspace(),
  activeFlowId: null,
  activeStageLinkId: null,
  viewedStageRevisionId: null,
  resourcesVisible: false,
  draggedStageId: null
};
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  try {
    await loadWorkspace(true);
    document.body.removeAttribute("data-auth-pending");
  } catch (error) {
    if (/owner access|required|permission|row-level security/i.test(error.message)) {
      window.location.replace("./access_pending.html");
      return;
    }
    showPageStatus(error.message, true);
  }
}

function cacheElements() {
  [
    "mawimbiCaptureSelect", "mawimbiEditCapture", "mawimbiDuplicateCapture", "mawimbiOpenHistory",
    "mawimbiCaptureReference", "mawimbiCaptureName", "mawimbiCaptureVersion", "mawimbiCaptureStatus",
    "mawimbiCaptureSummary", "mawimbiToggleResources", "mawimbiAddStage", "mawimbiMatrixHead",
    "mawimbiMatrixBody", "mawimbiPageStatus", "mawimbiCaptureDialog", "mawimbiCaptureForm",
    "mawimbiDuplicateDialog", "mawimbiDuplicateForm", "mawimbiAddStageDialog", "mawimbiAddStageForm",
    "mawimbiStageDialog", "mawimbiStageForm", "mawimbiStageNumber", "mawimbiStageTitle",
    "mawimbiStageRevisionSelect", "mawimbiVariableRows", "mawimbiAddVariableRow",
    "mawimbiEquipmentRows", "mawimbiAddEquipmentRow", "mawimbiRemoveStage",
    "mawimbiStageStatus", "mawimbiVariableDialog", "mawimbiVariableForm", "mawimbiVariableTitle",
    "mawimbiVariableUsage", "mawimbiHistoryDialog", "mawimbiHistoryList"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.mawimbiCaptureSelect.addEventListener("change", () => {
    state.activeFlowId = els.mawimbiCaptureSelect.value;
    render();
  });
  els.mawimbiEditCapture.addEventListener("click", openCaptureEditor);
  els.mawimbiDuplicateCapture.addEventListener("click", openDuplicateEditor);
  els.mawimbiOpenHistory.addEventListener("click", openHistory);
  els.mawimbiToggleResources.addEventListener("click", () => {
    state.resourcesVisible = !state.resourcesVisible;
    renderMatrix();
  });
  els.mawimbiAddStage.addEventListener("click", () => openDialog(els.mawimbiAddStageDialog));
  els.mawimbiCaptureForm.addEventListener("submit", saveCapture);
  els.mawimbiDuplicateForm.addEventListener("submit", duplicateCapture);
  els.mawimbiAddStageForm.addEventListener("submit", addStage);
  els.mawimbiStageForm.addEventListener("submit", saveStageRevision);
  els.mawimbiStageRevisionSelect.addEventListener("change", () => renderStageRevision(els.mawimbiStageRevisionSelect.value));
  els.mawimbiAddVariableRow.addEventListener("click", () => addVariableRow());
  els.mawimbiAddEquipmentRow.addEventListener("click", () => addEquipmentRow());
  els.mawimbiRemoveStage.addEventListener("click", removeStage);
  els.mawimbiVariableForm.addEventListener("submit", saveVariable);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  });
}

async function loadWorkspace(initialize = false) {
  let { data, error } = await authClient.rpc("ag_mawimbi_workspace");
  if (error) throw error;
  if (initialize && !(data?.flows || []).length) {
    const initialized = await authClient.rpc("ag_mawimbi_initialize_workspace");
    if (initialized.error) throw initialized.error;
    ({ data, error } = await authClient.rpc("ag_mawimbi_workspace"));
    if (error) throw error;
  }
  state.workspace = normalizeWorkspace(data);
  if (!state.workspace.flows.some((flow) => flow.id === state.activeFlowId)) {
    state.activeFlowId = state.workspace.flows[0]?.id || null;
  }
  render();
}

function render() {
  renderCapture();
  renderMatrix();
}

function renderCapture() {
  const flows = [...state.workspace.flows].sort(compareFlowVersions);
  const options = flows.map((flow) => option(
    flow.id,
    `v${flow.version_major}.${flow.version_minor} · ${flow.name} · ${monthLabel(flow.reference_month)}`,
    flow.id === state.activeFlowId
  ));
  els.mawimbiCaptureSelect.replaceChildren(...options);
  const flow = activeFlow();
  if (!flow) return;
  els.mawimbiCaptureName.textContent = flow.name;
  els.mawimbiCaptureReference.textContent = monthLabel(flow.reference_month);
  els.mawimbiCaptureVersion.textContent = `v${flow.version_major}.${flow.version_minor}`;
  els.mawimbiCaptureStatus.textContent = flow.status;
  els.mawimbiCaptureStatus.className = `mawimbi-status-badge is-${flow.status}`;
  els.mawimbiCaptureSummary.textContent = flow.summary || "";
  const editable = flow.status === "draft";
  els.mawimbiEditCapture.disabled = !editable;
  els.mawimbiAddStage.disabled = !editable;
}

function renderMatrix() {
  const links = activeStageLinks();
  const corner = tableCell("th", "Process detail", "mawimbi-row-label");
  corner.scope = "col";
  const headers = links.map((link, index) => stageHeader(link, index, links.length));
  els.mawimbiMatrixHead.replaceChildren(corner, ...headers);
  const rows = [
    renderMatrixRow("Number", links, (_, index) => String(index + 1), "mawimbi-number-row"),
    renderMatrixRow("Process", links, (link, index) => processButton(link, index)),
    renderMatrixRow("Inputs / settings", links, (link) => variableBadges(link, "input_setting")),
    renderMatrixRow("Measured variables", links, (link) => variableBadges(link, "measured")),
    ...RESOURCE_ROWS.map(([key, label]) => renderMatrixRow(label, links, (link) => resourceValue(stageRevision(link), key), "mawimbi-resource-row"))
  ];
  els.mawimbiMatrixBody.replaceChildren(...rows);
  els.mawimbiMatrixBody.querySelectorAll(".mawimbi-resource-row").forEach((row) => {
    row.hidden = !state.resourcesVisible;
  });
  els.mawimbiToggleResources.textContent = state.resourcesVisible ? "Hide material & equipment" : "Show material & equipment";
  els.mawimbiToggleResources.setAttribute("aria-expanded", String(state.resourcesVisible));
}

function stageHeader(link, index, total) {
  const th = document.createElement("th");
  th.className = "mawimbi-stage-heading";
  th.draggable = activeFlow()?.status === "draft";
  th.dataset.flowStageId = link.id;
  const controls = element("div", "mawimbi-stage-order-controls");
  controls.append(
    orderButton("←", "Move stage left", index === 0, () => moveStage(index, index - 1)),
    element("span", "mawimbi-drag-handle", "⋮⋮"),
    orderButton("→", "Move stage right", index === total - 1, () => moveStage(index, index + 1))
  );
  th.append(controls);
  th.addEventListener("dragstart", () => { state.draggedStageId = link.id; th.classList.add("is-dragging"); });
  th.addEventListener("dragend", () => { state.draggedStageId = null; th.classList.remove("is-dragging"); });
  th.addEventListener("dragover", (event) => { if (state.draggedStageId) event.preventDefault(); });
  th.addEventListener("drop", (event) => {
    event.preventDefault();
    void dropStage(link.id);
  });
  return th;
}

function renderMatrixRow(label, links, renderer, className = "") {
  const row = document.createElement("tr");
  row.className = className;
  const heading = tableCell("th", label, "mawimbi-row-label");
  heading.scope = "row";
  row.append(heading);
  links.forEach((link, index) => {
    const td = document.createElement("td");
    const content = renderer(link, index);
    td.append(content instanceof Node ? content : textValue(content));
    row.append(td);
  });
  return row;
}

function processButton(link, index) {
  const revision = stageRevision(link);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mawimbi-stage-button";
  button.append(element("strong", "", revision?.stage_name || "Untitled stage"));
  button.append(element("small", "", revision ? `stage v${revision.version_major}.${revision.version_minor}` : ""));
  button.setAttribute("aria-label", `Edit stage ${index + 1}, ${revision?.stage_name || "untitled"}`);
  button.addEventListener("click", () => openStage(link.id));
  return button;
}

function variableBadges(link, kind) {
  const wrap = element("div", "mawimbi-variable-list");
  const revision = stageRevision(link);
  const rows = state.workspace.stage_variables.filter((item) => item.stage_revision_id === revision?.id);
  const kindsByVariable = new Map();
  rows.forEach((item) => {
    if (!kindsByVariable.has(item.variable_id)) kindsByVariable.set(item.variable_id, new Set());
    kindsByVariable.get(item.variable_id).add(item.variable_kind);
  });
  rows.filter((item) => item.variable_kind === kind).forEach((item) => {
    const variable = variableById(item.variable_id);
    if (!variable) return;
    const both = kindsByVariable.get(item.variable_id)?.size > 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mawimbi-variable is-${both ? "both" : kind === "measured" ? "measured" : "input"}`;
    button.textContent = item.defined_value ? `${variable.name}: ${item.defined_value}${item.unit ? ` ${item.unit}` : ""}` : variable.name;
    button.addEventListener("click", () => openVariable(variable.id));
    wrap.append(button);
  });
  if (!wrap.childElementCount) wrap.append(textValue("—", true));
  return wrap;
}

function resourceValue(revision, key) {
  if (!revision) return "—";
  if (key === "equipment_list") {
    return state.workspace.stage_equipment
      .filter((item) => item.stage_revision_id === revision.id)
      .sort((a, b) => a.position - b.position)
      .map((item) => item.equipment_name)
      .join(", ") || "—";
  }
  return revision[key] || "—";
}

async function moveStage(fromIndex, toIndex) {
  if (toIndex < 0) return;
  const links = activeStageLinks();
  const [moved] = links.splice(fromIndex, 1);
  links.splice(toIndex, 0, moved);
  await saveStageOrder(links);
}

async function dropStage(targetId) {
  if (!state.draggedStageId || state.draggedStageId === targetId) return;
  const links = activeStageLinks();
  const from = links.findIndex((item) => item.id === state.draggedStageId);
  const to = links.findIndex((item) => item.id === targetId);
  const [moved] = links.splice(from, 1);
  links.splice(to, 0, moved);
  await saveStageOrder(links);
}

async function saveStageOrder(links) {
  try {
    showPageStatus("Saving order…");
    const { error } = await authClient.rpc("ag_mawimbi_reorder_stages", {
      p_flow_id: state.activeFlowId,
      p_flow_stage_ids: links.map((item) => item.id)
    });
    if (error) throw error;
    await loadWorkspace();
    showPageStatus("Order saved");
  } catch (error) { showPageStatus(error.message, true); }
}

function openCaptureEditor() {
  const flow = activeFlow();
  if (!flow || flow.status !== "draft") return;
  setForm(els.mawimbiCaptureForm, {
    name: flow.name,
    reference_month: String(flow.reference_month).slice(0, 7),
    status: flow.status,
    summary: flow.summary,
    notes: flow.notes
  });
  openDialog(els.mawimbiCaptureDialog);
}

async function saveCapture(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setDialogStatus(form, "Saving…");
    const values = formValues(form);
    const { error } = await authClient.rpc("ag_mawimbi_save_flow", {
      p_flow_id: state.activeFlowId,
      p_name: values.name,
      p_reference_month: `${values.reference_month}-01`,
      p_status: values.status,
      p_summary: values.summary || null,
      p_notes: values.notes || null
    });
    if (error) throw error;
    await loadWorkspace();
    els.mawimbiCaptureDialog.close();
  } catch (error) { setDialogStatus(form, error.message, true); }
}

function openDuplicateEditor() {
  const flow = activeFlow();
  if (!flow) return;
  setForm(els.mawimbiDuplicateForm, {
    name: flow.name,
    reference_month: new Date().toISOString().slice(0, 7),
    version_change: "minor"
  });
  openDialog(els.mawimbiDuplicateDialog);
}

async function duplicateCapture(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setDialogStatus(form, "Creating…");
    const values = formValues(form);
    const { data, error } = await authClient.rpc("ag_mawimbi_duplicate_flow", {
      p_source_flow_id: state.activeFlowId,
      p_version_change: values.version_change,
      p_name: values.name,
      p_reference_month: `${values.reference_month}-01`
    });
    if (error) throw error;
    state.activeFlowId = data;
    await loadWorkspace();
    els.mawimbiDuplicateDialog.close();
  } catch (error) { setDialogStatus(form, error.message, true); }
}

async function addStage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setDialogStatus(form, "Adding…");
    const { error } = await authClient.rpc("ag_mawimbi_add_stage", {
      p_flow_id: state.activeFlowId,
      p_stage_name: form.elements.stage_name.value.trim()
    });
    if (error) throw error;
    form.reset();
    await loadWorkspace();
    els.mawimbiAddStageDialog.close();
  } catch (error) { setDialogStatus(form, error.message, true); }
}

function openStage(linkId) {
  const link = state.workspace.flow_stages.find((item) => item.id === linkId);
  const revision = stageRevision(link);
  if (!link || !revision) return;
  state.activeStageLinkId = linkId;
  state.viewedStageRevisionId = revision.id;
  const stageNumber = activeStageLinks().findIndex((item) => item.id === linkId) + 1;
  els.mawimbiStageNumber.textContent = `Stage ${stageNumber}`;
  els.mawimbiStageTitle.textContent = revision.stage_name;
  const revisions = state.workspace.stage_revisions
    .filter((item) => item.stage_family_id === link.stage_family_id)
    .sort((a, b) => b.version_major - a.version_major || b.version_minor - a.version_minor);
  els.mawimbiStageRevisionSelect.replaceChildren(...revisions.map((item) => option(
    item.id,
    `v${item.version_major}.${item.version_minor}${item.id === revision.id ? " · current" : ""}`,
    item.id === revision.id
  )));
  renderStageRevision(revision.id);
  setDialogStatus(els.mawimbiStageForm, "");
  openDialog(els.mawimbiStageDialog);
}

function renderStageRevision(revisionId) {
  const link = state.workspace.flow_stages.find((item) => item.id === state.activeStageLinkId);
  const current = stageRevision(link);
  const revision = state.workspace.stage_revisions.find((item) => item.id === revisionId);
  if (!link || !current || !revision || revision.stage_family_id !== link.stage_family_id) return;
  state.viewedStageRevisionId = revision.id;
  els.mawimbiStageTitle.textContent = revision.stage_name;
  els.mawimbiStageRevisionSelect.value = revision.id;
  setForm(els.mawimbiStageForm, revision);
  const rows = operationalInputRows(state.workspace.stage_variables
    .filter((item) => item.stage_revision_id === revision.id)
    .sort((a, b) => a.position - b.position));
  els.mawimbiVariableRows.replaceChildren(...rows.map((row) => variableEditorRow(row)));
  if (!rows.length) addVariableRow();
  const equipmentRows = state.workspace.stage_equipment
    .filter((item) => item.stage_revision_id === revision.id)
    .sort((a, b) => a.position - b.position);
  els.mawimbiEquipmentRows.replaceChildren(...equipmentRows.map((row) => equipmentEditorRow(row)));
  if (!equipmentRows.length) addEquipmentRow();
  const editable = activeFlow()?.status === "draft" && revision.id === current.id;
  els.mawimbiStageForm.querySelectorAll("input, textarea, select, button")
    .forEach((control) => { control.disabled = !editable; });
  els.mawimbiStageRevisionSelect.disabled = false;
  els.mawimbiStageForm.querySelectorAll("[data-close-dialog]").forEach((control) => { control.disabled = false; });
  els.mawimbiRemoveStage.disabled = !editable;
  setDialogStatus(els.mawimbiStageForm, editable ? "" : "Viewing historical revision");
}

function addVariableRow(data = null) {
  els.mawimbiVariableRows.append(variableEditorRow(data));
}

function operationalInputRows(rows) {
  const remaining = [...rows];
  const standardRows = STANDARD_OPERATIONAL_INPUTS.flatMap(([name, defaultUnit]) => {
    const variable = state.workspace.variables.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!variable) return [];
    const existingIndex = remaining.findIndex((item) => (
      item.variable_id === variable.id && item.variable_kind === "input_setting"
    ));
    if (existingIndex >= 0) return remaining.splice(existingIndex, 1);
    return [{
      variable_kind: "input_setting",
      variable_id: variable.id,
      unit: variable.default_unit || defaultUnit,
      defined_value: "",
      notes: ""
    }];
  });
  return [...standardRows, ...remaining];
}

function variableUnitOptions(variableId, currentUnit = "") {
  const variable = variableById(variableId);
  const units = [
    variable?.default_unit,
    ...state.workspace.stage_variables
      .filter((item) => item.variable_id === variableId)
      .map((item) => item.unit),
    currentUnit
  ].map((unit) => String(unit || "").trim()).filter(Boolean);
  return [...new Set(units)];
}

function variableEditorRow(item = null) {
  const row = document.createElement("tr");
  const type = selectControl([
    ["input_setting", "Input / setting"],
    ["measured", "Measured variable"]
  ], item?.variable_kind || "measured", "Variable type");
  type.dataset.field = "variable_kind";

  const variableSelect = selectControl([
    ["", "Select…"],
    ...state.workspace.variables.map((variable) => [variable.id, variable.name]),
    ["__new__", "+ Add new variable"]
  ], item?.variable_id || "", "Variable");
  variableSelect.dataset.field = "variable_id";
  const newName = inputControl("text", "New variable name", "name");
  newName.className = "mawimbi-new-variable-name";
  newName.hidden = true;
  const variableWrap = element("div", "mawimbi-variable-select-wrap");
  variableWrap.append(variableSelect, newName);

  const unitSelect = selectControl([], "", "Unit");
  unitSelect.dataset.field = "unit";
  const newUnit = inputControl("text", "New unit", "unit_new");
  newUnit.placeholder = "Enter new unit";
  newUnit.hidden = true;
  const unitWrap = element("div", "mawimbi-variable-select-wrap");
  unitWrap.append(unitSelect, newUnit);

  function syncNewUnit() {
    const isNew = unitSelect.value === "__new__";
    newUnit.hidden = !isNew;
    if (isNew) newUnit.focus();
  }

  function refreshUnitOptions(variableId, preferredUnit = "") {
    const selectedVariable = variableById(variableId);
    const units = variableUnitOptions(variableId, preferredUnit);
    unitSelect.replaceChildren(
      option("", "No unit"),
      ...units.map((unit) => option(unit, unit)),
      option("__new__", "+ Add new unit")
    );
    const nextUnit = preferredUnit || selectedVariable?.default_unit || "";
    unitSelect.value = units.includes(nextUnit) ? nextUnit : nextUnit ? "__new__" : "";
    newUnit.value = unitSelect.value === "__new__" ? nextUnit : "";
    syncNewUnit();
  }

  refreshUnitOptions(item?.variable_id, item?.unit || "");
  unitSelect.addEventListener("change", syncNewUnit);
  const value = inputControl("text", "Defined value", "defined_value");
  value.value = item?.defined_value || "";
  const notes = inputControl("text", "Notes", "notes");
  notes.value = item?.notes || "";
  const controls = element("div", "mawimbi-row-controls");
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "↑";
  up.setAttribute("aria-label", "Move variable row up");
  up.addEventListener("click", () => row.previousElementSibling?.before(row));
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "↓";
  down.setAttribute("aria-label", "Move variable row down");
  down.addEventListener("click", () => row.nextElementSibling?.after(row));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button mawimbi-row-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove variable row");
  remove.addEventListener("click", () => row.remove());
  controls.append(up, down, remove);
  variableSelect.addEventListener("change", () => {
    const isNew = variableSelect.value === "__new__";
    newName.hidden = !isNew;
    if (isNew) newName.focus();
    const selected = variableById(variableSelect.value);
    refreshUnitOptions(variableSelect.value, selected?.default_unit || "");
  });
  type.addEventListener("change", () => syncVariableRowType(row, type.value, value));

  [type, variableWrap, unitWrap, value, notes, controls].forEach((control) => {
    const td = document.createElement("td");
    td.append(control);
    row.append(td);
  });
  syncVariableRowType(row, type.value, value);
  return row;
}

function syncVariableRowType(row, kind, valueControl) {
  row.className = `mawimbi-variable-edit-row ${kind === "measured" ? "is-measured" : "is-input"}`;
  valueControl.closest("td").classList.toggle("is-value-optional", kind === "measured");
}

function addEquipmentRow(data = null) {
  els.mawimbiEquipmentRows.append(equipmentEditorRow(data));
}

function equipmentEditorRow(item = null) {
  const row = document.createElement("tr");
  row.className = "mawimbi-equipment-edit-row";
  const name = inputControl("text", "Equipment name", "equipment_name");
  name.maxLength = 160;
  name.value = item?.equipment_name || "";
  const note = textareaControl("Equipment note", "equipment_note", 2);
  note.maxLength = 2000;
  note.value = item?.equipment_note || "";
  const commissioningDate = inputControl("date", "Commissioning date", "commissioning_date");
  commissioningDate.value = item?.commissioning_date || "";
  const controls = element("div", "mawimbi-row-controls");
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "↑";
  up.setAttribute("aria-label", "Move equipment row up");
  up.addEventListener("click", () => row.previousElementSibling?.before(row));
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "↓";
  down.setAttribute("aria-label", "Move equipment row down");
  down.addEventListener("click", () => row.nextElementSibling?.after(row));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button mawimbi-row-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove equipment row");
  remove.addEventListener("click", () => row.remove());
  controls.append(up, down, remove);

  [name, note, commissioningDate, controls].forEach((control) => {
    const td = document.createElement("td");
    td.append(control);
    row.append(td);
  });
  return row;
}

async function saveStageRevision(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const stage = formValues(form);
    const variables = collectVariableRows();
    stage.equipment_rows = collectEquipmentRows();
    if (!variables.length && !window.confirm("Save this stage with no inputs or measured variables?")) return;
    setDialogStatus(form, "Saving revision…");
    const { error } = await authClient.rpc("ag_mawimbi_save_stage_revision", {
      p_flow_stage_id: state.activeStageLinkId,
      p_version_change: event.submitter?.value || "minor",
      p_stage: stage,
      p_variables: variables
    });
    if (error) throw error;
    await loadWorkspace();
    els.mawimbiStageDialog.close();
  } catch (error) { setDialogStatus(form, error.message, true); }
}

function collectVariableRows() {
  return [...els.mawimbiVariableRows.querySelectorAll("tr")].map((row) => {
    const variableId = row.querySelector('[data-field="variable_id"]').value;
    const name = row.querySelector('[data-field="name"]').value.trim();
    if (!variableId) throw new Error("Select a variable for every row.");
    if (variableId === "__new__" && !name) throw new Error("Enter the new variable name.");
    return {
      variable_kind: row.querySelector('[data-field="variable_kind"]').value,
      variable_id: variableId === "__new__" ? null : variableId,
      name: variableId === "__new__" ? name : null,
      unit: (() => {
        const selectedUnit = row.querySelector('[data-field="unit"]').value;
        const unit = selectedUnit === "__new__"
          ? row.querySelector('[data-field="unit_new"]').value
          : selectedUnit;
        return unit.trim() || null;
      })(),
      defined_value: row.querySelector('[data-field="defined_value"]').value.trim() || null,
      notes: row.querySelector('[data-field="notes"]').value.trim() || null
    };
  });
}

function collectEquipmentRows() {
  return [...els.mawimbiEquipmentRows.querySelectorAll("tr")].flatMap((row) => {
    const equipmentName = row.querySelector('[data-field="equipment_name"]').value.trim();
    const equipmentNote = row.querySelector('[data-field="equipment_note"]').value.trim();
    const commissioningDate = row.querySelector('[data-field="commissioning_date"]').value;
    if (!equipmentName && !equipmentNote && !commissioningDate) return [];
    if (!equipmentName) throw new Error("Enter an equipment name for every equipment row.");
    return [{
      equipment_name: equipmentName,
      equipment_note: equipmentNote || null,
      commissioning_date: commissioningDate || null
    }];
  });
}

async function removeStage() {
  const link = state.workspace.flow_stages.find((item) => item.id === state.activeStageLinkId);
  const name = stageRevision(link)?.stage_name || "this stage";
  if (!window.confirm(`Remove ${name} from this process capture? Historical captures are unchanged.`)) return;
  try {
    setDialogStatus(els.mawimbiStageForm, "Removing…");
    const { error } = await authClient.rpc("ag_mawimbi_remove_stage", { p_flow_stage_id: state.activeStageLinkId });
    if (error) throw error;
    await loadWorkspace();
    els.mawimbiStageDialog.close();
  } catch (error) { setDialogStatus(els.mawimbiStageForm, error.message, true); }
}

function openVariable(variableId) {
  const variable = variableById(variableId);
  if (!variable) return;
  els.mawimbiVariableTitle.textContent = variable.name;
  setForm(els.mawimbiVariableForm, { ...variable, variable_id: variable.id });
  const usage = variableUsage(variable.id);
  els.mawimbiVariableUsage.replaceChildren(...usage.map((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.stageNumber}. ${item.stageName} · ${item.kinds.join(" + ")}`;
    return li;
  }));
  if (!usage.length) els.mawimbiVariableUsage.append(element("li", "", "Not used in this capture"));
  openDialog(els.mawimbiVariableDialog);
}

function variableUsage(variableId) {
  return activeStageLinks().flatMap((link, index) => {
    const revision = stageRevision(link);
    const rows = state.workspace.stage_variables.filter((item) => item.stage_revision_id === revision?.id && item.variable_id === variableId);
    if (!rows.length) return [];
    return [{
      stageNumber: index + 1,
      stageName: revision.stage_name,
      kinds: rows.map((item) => item.variable_kind === "measured" ? "Measured" : "Input / setting")
    }];
  });
}

async function saveVariable(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setDialogStatus(form, "Saving…");
    const values = formValues(form);
    const { error } = await authClient.rpc("ag_mawimbi_save_variable", {
      p_variable_id: values.variable_id,
      p_name: values.name,
      p_default_unit: values.default_unit || null,
      p_description: values.description || null,
      p_measurement_equipment: values.measurement_equipment || null,
      p_notes: values.notes || null
    });
    if (error) throw error;
    await loadWorkspace();
    els.mawimbiVariableDialog.close();
  } catch (error) { setDialogStatus(form, error.message, true); }
}

function openHistory() {
  const events = state.workspace.events.filter((event) => event.flow_id === state.activeFlowId);
  els.mawimbiHistoryList.replaceChildren(...events.map((event) => {
    const item = document.createElement("li");
    item.append(element("strong", "", event.summary), element("time", "", dateTimeLabel(event.created_at)));
    return item;
  }));
  if (!events.length) els.mawimbiHistoryList.append(element("li", "", "No changes recorded"));
  openDialog(els.mawimbiHistoryDialog);
}

function activeFlow() {
  return state.workspace.flows.find((flow) => flow.id === state.activeFlowId) || null;
}

function activeStageLinks() {
  return state.workspace.flow_stages
    .filter((link) => link.flow_id === state.activeFlowId)
    .sort((a, b) => a.position - b.position);
}

function stageRevision(link) {
  return state.workspace.stage_revisions.find((revision) => revision.id === link?.stage_revision_id) || null;
}

function variableById(id) {
  return state.workspace.variables.find((variable) => variable.id === id) || null;
}

function emptyWorkspace() {
  return {
    flows: [],
    flow_stages: [],
    stage_families: [],
    stage_revisions: [],
    variables: [],
    stage_variables: [],
    stage_equipment: [],
    events: []
  };
}

function normalizeWorkspace(value) {
  const output = emptyWorkspace();
  Object.keys(output).forEach((key) => { output[key] = Array.isArray(value?.[key]) ? value[key] : []; });
  return output;
}

function compareFlowVersions(a, b) {
  return b.version_major - a.version_major || b.version_minor - a.version_minor;
}

function setForm(form, values) {
  Object.entries(values || {}).forEach(([name, value]) => {
    const field = form.elements[name];
    if (field) field.value = value ?? "";
  });
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function openDialog(dialog) {
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector("input:not([type='hidden']), textarea, select, button")?.focus());
}

function setDialogStatus(form, message, isError = false) {
  const status = form.querySelector(".admin-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function showPageStatus(message, isError = false) {
  els.mawimbiPageStatus.textContent = message;
  els.mawimbiPageStatus.classList.toggle("is-error", isError);
}

function option(value, label, selected = false) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
}

function selectControl(items, value, ariaLabel) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", ariaLabel);
  items.forEach(([itemValue, label]) => select.append(option(itemValue, label, itemValue === value)));
  return select;
}

function inputControl(type, ariaLabel, field) {
  const input = document.createElement("input");
  input.type = type;
  input.setAttribute("aria-label", ariaLabel);
  input.dataset.field = field;
  return input;
}

function textareaControl(ariaLabel, field, rows = 2) {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", ariaLabel);
  textarea.dataset.field = field;
  textarea.rows = rows;
  return textarea;
}

function orderButton(text, label, disabled, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.disabled = disabled || activeFlow()?.status !== "draft";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

function tableCell(tag, text, className = "") {
  return element(tag, className, text);
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function textValue(value, muted = false) {
  return element("span", muted || value === "—" ? "mawimbi-cell-muted" : "", value);
}

function monthLabel(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`));
}

function dateTimeLabel(value) {
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function plainNumber(value) {
  return Number(value).toLocaleString("en-AU", { maximumFractionDigits: 3 });
}
