import { authClient, requireAdminAccess } from "./auth_client.js";

const FIELD_TYPES = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  currency: "Currency",
  single_select: "Dropdown",
  multi_select: "Multi-select",
  checkbox: "Checkbox",
  date: "Date",
  time: "Time",
  datetime: "Date & time",
  email: "Email",
  phone: "Phone",
  calculation: "Calculation"
};

const CORE_FIELD_TYPES = {
  qr_text: "Text + QR",
  datetime: "Date & time",
  gps: "GPS",
  decimal: "Number",
  single_select: "Dropdown",
  currency: "Currency",
  long_text: "Long text",
  read_only: "Generated text",
  file: "Photo upload"
};

const TEMPLATES = {
  blank: { label: "New field", field_type: "short_text", placeholder: "Enter value" },
  moisture_percent: { field_key: "moisture_percent", label: "Moisture %", field_type: "number", unit: "%", min_value: 0, max_value: 100, show_in_ledger: true },
  dry_weight_kg: { field_key: "dry_weight_kg", label: "Dry weight", field_type: "calculation", formula: "sack_weight_kg * (1 - moisture_percent / 100)", unit: "kg", show_in_ledger: true },
  payment_status: { field_key: "payment_status", label: "Payment status", field_type: "single_select", options: ["Pending", "Part paid", "Paid"], default_value: "Pending", show_in_ledger: true },
  buyer_batch: { field_key: "buyer_batch", label: "Buyer batch", field_type: "short_text", placeholder: "Batch reference", show_in_ledger: true },
  harvest_method: { field_key: "harvest_method", label: "Harvest method", field_type: "single_select", options: ["Off-bottom", "Raft", "Long-line", "Other"] },
  quality_result: { field_key: "quality_result", label: "Quality result", field_type: "single_select", options: ["Accepted", "Hold", "Rejected"], show_in_ledger: true }
};

const state = { settings: null, customFields: [] };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reloadBuilderSettings", "builderStatus", "builderActiveFieldCount", "builderLedgerFieldCount",
    "builderTotalFieldCount", "builderFieldRows",
    "builderFieldTemplate", "addCustomField", "saveFormFields", "builderCustomFieldRows",
    "builderFormPreview", "builderPreviewStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!await requireAdminAccess("can_manage_settings")) return;
  bindEvents();
  await loadSettings();
}

function bindEvents() {
  els.reloadBuilderSettings.addEventListener("click", loadSettings);
  els.saveFormFields.addEventListener("click", saveFormFields);
  els.addCustomField.addEventListener("click", addCustomField);
  els.builderCustomFieldRows.addEventListener("input", handleCustomFieldInput);
  els.builderCustomFieldRows.addEventListener("change", handleCustomFieldInput);
  els.builderCustomFieldRows.addEventListener("click", handleCustomFieldClick);
  els.builderFieldRows.addEventListener("input", handleCoreFieldInput);
  els.builderFieldRows.addEventListener("change", handleCoreFieldInput);
}

async function loadSettings() {
  setStatus("Loading...");
  const [settingsResponse, customResponse] = await Promise.all([
    authClient.rpc("ag_admin_builder_settings"),
    authClient.rpc("ag_admin_custom_field_settings", { p_entity_type: "collection" })
  ]);
  if (settingsResponse.error || customResponse.error) {
    setStatus(settingsResponse.error?.message || customResponse.error?.message, "error");
    return;
  }
  state.settings = settingsResponse.data;
  state.customFields = customResponse.data || [];
  renderAll();
  setStatus("");
}

async function saveSettingsSection(section, rows) {
  const { data, error } = await authClient.rpc("ag_admin_save_builder_settings", {
    p_section: section,
    p_rows: rows
  });
  if (error) throw error;
  state.settings = data;
}

async function saveFormFields() {
  try {
    validateTable(els.builderFieldRows);
    validateTable(els.builderCustomFieldRows);
    const customRows = readCustomRows();
    ensureUnique(customRows, "field_key", "field key");
    setStatus("Saving form fields...");
    await saveSettingsSection("collection_fields", readFieldRows());
    const { data, error } = await authClient.rpc("ag_admin_save_custom_fields", {
      p_entity_type: "collection",
      p_rows: customRows
    });
    if (error) throw error;
    state.customFields = data || [];
    renderFieldRows();
    renderCustomFields();
    setStatus("Form fields saved.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderAll() {
  renderFieldRows();
  renderCustomFields();
  renderPreview();
  renderSummary();
}

function renderFieldRows() {
  els.builderFieldRows.innerHTML = (state.settings.collection_fields || [])
    .slice()
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map(coreFieldRow)
    .join("");
}

function coreFieldRow(row) {
  const protectedField = row.field_key === "sack_weight_kg";
  return `<tr data-field-key="${attr(row.field_key)}">
    <td><input data-key="display_order" class="builder-order-input" type="number" min="0" step="1" value="${attr(row.display_order)}" aria-label="Order for ${attr(row.label)}"></td>
    <td><strong>${html(humanizeKey(row.field_key))}</strong></td>
    <td><input data-key="label" type="text" required value="${attr(row.label)}" aria-label="Label for ${attr(row.field_key)}"></td>
    <td><span class="builder-field-type">${html(CORE_FIELD_TYPES[row.field_type] || humanizeKey(row.field_type))}</span></td>
    <td><input data-key="visible" type="checkbox" ${row.visible || protectedField ? "checked" : ""} ${protectedField ? "disabled" : ""} aria-label="Show ${attr(row.label)}"></td>
    <td><input data-key="required" type="checkbox" ${row.required || protectedField ? "checked" : ""} ${protectedField ? "disabled" : ""} aria-label="Require ${attr(row.label)}"></td>
    <td><input data-key="default_value" type="text" value="${attr(row.default_value || "")}" aria-label="Default for ${attr(row.label)}"></td>
  </tr>`;
}

function addCustomField() {
  const template = structuredClone(TEMPLATES[els.builderFieldTemplate.value] || TEMPLATES.blank);
  const rows = readCustomRows();
  const baseKey = template.field_key || slugKey(template.label);
  template.field_key = uniqueKey(baseKey, new Set(rows.map((row) => row.field_key)));
  template.options = template.options || [];
  template.display_order = nextOrder(rows);
  template.decimal_places = 2;
  template.required = false;
  template.active = true;
  template.show_in_ledger = Boolean(template.show_in_ledger);
  state.customFields = [...rows, template];
  renderCustomFields();
  const added = [...els.builderCustomFieldRows.querySelectorAll("tr")].at(-1);
  if (added) added.dataset.autoKey = "true";
  added?.querySelector('[data-key="label"]')?.focus();
  setStatus("Field added. Save fields to publish it.");
}

function handleCoreFieldInput(event) {
  const row = event.target.closest("tr[data-field-key]");
  if (!row) return;
  if (event.target.dataset.key === "visible" && !event.target.checked) input(row, "required").checked = false;
  if (event.target.dataset.key === "required" && event.target.checked) input(row, "visible").checked = true;
  state.settings.collection_fields = readFieldRows();
  renderPreview();
  renderSummary();
}

function handleCustomFieldInput(event) {
  const row = event.target.closest("tr[data-field-row]");
  if (!row) return;
  if (event.target.dataset.key === "label" && row.dataset.autoKey === "true") {
    const keyInput = input(row, "field_key");
    const keys = new Set(readCustomRows().filter((item) => item.field_key !== keyInput.value).map((item) => item.field_key));
    keyInput.value = uniqueKey(slugKey(event.target.value), keys);
  }
  if (event.target.dataset.key === "field_key") row.dataset.autoKey = "false";
  if (event.target.dataset.key === "field_type") refreshConfigCell(row);
  state.customFields = readCustomRows();
  renderPreview();
  renderSummary();
}

function handleCustomFieldClick(event) {
  const remove = event.target.closest("[data-remove-field]");
  if (!remove) return;
  remove.closest("tr[data-field-row]").remove();
  state.customFields = readCustomRows();
  renderPreview();
  renderSummary();
  setStatus("Field removed. Save fields to publish the change.");
}

function renderCustomFields() {
  els.builderCustomFieldRows.innerHTML = state.customFields
    .slice()
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map(customFieldRow)
    .join("");
  renderPreview();
  renderSummary();
}

function customFieldRow(row) {
  const numeric = ["number", "currency", "calculation"].includes(row.field_type);
  return `<tr data-field-row data-auto-key="false">
    <td><input data-key="display_order" class="builder-order-input" type="number" min="0" step="1" value="${attr(row.display_order ?? 100)}" aria-label="Order"></td>
    <td><input data-key="field_key" class="builder-key-input" type="text" required value="${attr(row.field_key || "")}" pattern="[a-z][a-z0-9_]{1,49}" aria-label="Field key"></td>
    <td><input data-key="label" type="text" required value="${attr(row.label || "")}" aria-label="Label"></td>
    <td><select data-key="field_type" aria-label="Field type">${typeOptions(row.field_type)}</select></td>
    <td data-config-cell>${configControl(row)}</td>
    <td><input data-key="default_value" type="text" value="${attr(row.default_value || "")}" aria-label="Default value"></td>
    <td><input data-key="unit" class="builder-unit-input" type="text" value="${attr(row.unit || "")}" aria-label="Unit"></td>
    <td><input data-key="min_value" class="builder-number-setting" type="number" step="any" value="${attr(row.min_value ?? "")}" ${numeric ? "" : "disabled"} aria-label="Minimum value"></td>
    <td><input data-key="max_value" class="builder-number-setting" type="number" step="any" value="${attr(row.max_value ?? "")}" ${numeric ? "" : "disabled"} aria-label="Maximum value"></td>
    <td><input data-key="decimal_places" class="builder-number-setting" type="number" min="0" max="6" step="1" value="${attr(row.decimal_places ?? 2)}" ${numeric ? "" : "disabled"} aria-label="Decimal places"></td>
    <td><input data-key="required" type="checkbox" ${row.required ? "checked" : ""} aria-label="Required"></td>
    <td><input data-key="show_in_ledger" type="checkbox" ${row.show_in_ledger ? "checked" : ""} aria-label="Show in ledger"></td>
    <td><input data-key="active" type="checkbox" ${row.active !== false ? "checked" : ""} aria-label="Active"></td>
    <td><button type="button" class="builder-remove-field" data-remove-field>Remove</button></td>
  </tr>`;
}

function configControl(row) {
  const type = row.field_type || "short_text";
  if (type === "single_select" || type === "multi_select") {
    return `<input data-key="configuration" type="text" value="${attr((row.options || []).join(", "))}" placeholder="Option one, Option two" aria-label="Options">`;
  }
  if (type === "calculation") {
    return `<input data-key="configuration" type="text" value="${attr(row.formula || "")}" placeholder="sack_weight_kg * price_per_kg" aria-label="Formula">`;
  }
  return `<input data-key="configuration" type="text" value="${attr(row.placeholder || "")}" placeholder="Placeholder" aria-label="Placeholder">`;
}

function refreshConfigCell(row) {
  const current = readCustomRow(row);
  row.querySelector("[data-config-cell]").innerHTML = configControl(current);
  const numeric = ["number", "currency", "calculation"].includes(current.field_type);
  ["min_value", "max_value", "decimal_places"].forEach((key) => { input(row, key).disabled = !numeric; });
}

function renderPreview() {
  if (!state.settings) return;
  const coreRows = readFieldRows().filter((row) => row.visible).sort((a, b) => a.display_order - b.display_order);
  const customRows = readCustomRows().filter((row) => row.active).sort((a, b) => a.display_order - b.display_order);
  els.builderPreviewStatus.textContent = `${coreRows.length + customRows.length} fields`;
  els.builderFormPreview.innerHTML = [...coreRows.map(previewCoreField), ...customRows.map(previewField)].join("") || '<p class="muted-cell">No fields are visible.</p>';
}

function previewCoreField(row) {
  const title = `${html(row.label || humanizeKey(row.field_key))}${row.required ? " *" : ""}`;
  if (row.field_type === "long_text") return `<label>${title}<textarea rows="2" disabled></textarea></label>`;
  if (row.field_type === "single_select") {
    const rows = row.field_key === "seaweed_grade"
      ? (state.settings.grade_prices || []).filter((item) => item.active)
      : (state.settings.seaweed_types || []).filter((item) => item.active);
    const options = rows.map((item) => `<option>${html(item.label || item.grade || item.type_key)}</option>`).join("");
    return `<label>${title}<select disabled><option>Select</option>${options}</select></label>`;
  }
  const inputType = { datetime: "datetime-local", decimal: "number", currency: "number" }[row.field_type] || "text";
  return `<label>${title}<input type="${inputType}" disabled value="${attr(row.default_value || "")}"></label>`;
}

function previewField(row) {
  const title = `${html(row.label || row.field_key)}${row.unit ? ` (${html(row.unit)})` : ""}${row.required ? " *" : ""}`;
  if (row.field_type === "checkbox") return `<label class="check-row"><input type="checkbox" disabled ${String(row.default_value).toLowerCase() === "true" ? "checked" : ""}> ${title}</label>`;
  if (row.field_type === "long_text") return `<label>${title}<textarea rows="2" disabled placeholder="${attr(row.placeholder || "")}"></textarea></label>`;
  if (row.field_type === "single_select" || row.field_type === "multi_select") return `<label>${title}<select ${row.field_type === "multi_select" ? "multiple" : ""} disabled><option>${html(row.default_value || "Select")}</option>${row.options.map((option) => `<option>${html(option)}</option>`).join("")}</select></label>`;
  const inputType = { number: "number", currency: "number", calculation: "number", date: "date", time: "time", datetime: "datetime-local", email: "email", phone: "tel" }[row.field_type] || "text";
  return `<label>${title}<input type="${inputType}" disabled value="${attr(row.default_value || "")}" placeholder="${attr(row.placeholder || "")}" ${row.field_type === "calculation" ? "readonly" : ""}></label>`;
}

function renderSummary() {
  if (!state.settings) return;
  const coreRows = readFieldRows();
  const customRows = readCustomRows();
  els.builderTotalFieldCount.textContent = `${customRows.length} additional fields`;
  els.builderActiveFieldCount.textContent = `${coreRows.filter((row) => row.visible).length + customRows.filter((row) => row.active).length} form fields`;
  els.builderLedgerFieldCount.textContent = `${customRows.filter((row) => row.active && row.show_in_ledger).length} added ledger columns`;
}

function readCustomRows() {
  return [...els.builderCustomFieldRows.querySelectorAll("tr[data-field-row]")].map(readCustomRow);
}

function readCustomRow(row) {
  const type = value(row, "field_type") || "short_text";
  const configuration = value(row, "configuration");
  return {
    field_key: value(row, "field_key").trim().toLowerCase(),
    label: value(row, "label").trim(),
    field_type: type,
    placeholder: !["single_select", "multi_select", "calculation"].includes(type) ? configuration.trim() : "",
    options: ["single_select", "multi_select"].includes(type) ? configuration.split(",").map((item) => item.trim()).filter(Boolean) : [],
    formula: type === "calculation" ? configuration.trim() : "",
    default_value: value(row, "default_value"),
    unit: value(row, "unit").trim(),
    min_value: optionalNumberValue(row, "min_value"),
    max_value: optionalNumberValue(row, "max_value"),
    decimal_places: numberValue(row, "decimal_places"),
    required: checked(row, "required"),
    show_in_ledger: checked(row, "show_in_ledger"),
    active: checked(row, "active"),
    display_order: numberValue(row, "display_order")
  };
}

function readFieldRows() {
  return [...els.builderFieldRows.querySelectorAll("tr[data-field-key]")].map((row) => ({
    field_key: row.dataset.fieldKey,
    label: value(row, "label").trim(),
    visible: row.dataset.fieldKey === "sack_weight_kg" || checked(row, "visible"),
    required: row.dataset.fieldKey === "sack_weight_kg" || checked(row, "required"),
    default_value: value(row, "default_value"),
    display_order: numberValue(row, "display_order"),
    field_type: state.settings.collection_fields.find((item) => item.field_key === row.dataset.fieldKey)?.field_type || "short_text"
  }));
}

function validateTable(container) {
  const invalid = [...container.querySelectorAll("input, select")].find((control) => !control.disabled && !control.checkValidity());
  if (!invalid) return;
  invalid.reportValidity();
  throw new Error("Check the highlighted field.");
}

function ensureUnique(rows, key, label) {
  const values = rows.map((row) => row[key]).filter(Boolean);
  if (new Set(values).size !== values.length) throw new Error(`Each ${label} must be unique.`);
}

function nextOrder(rows) { return Math.max(0, ...rows.map((row) => Number(row.display_order) || 0)) + 10; }
function focusLast(container, key) { [...container.querySelectorAll("tr")].at(-1)?.querySelector(`[data-key="${key}"]`)?.focus(); }
function typeOptions(selected) { return Object.entries(FIELD_TYPES).map(([item, label]) => `<option value="${item}" ${item === selected ? "selected" : ""}>${label}</option>`).join(""); }
function input(row, key) { return row.querySelector(`[data-key="${key}"]`); }
function value(row, key) { return input(row, key)?.value ?? ""; }
function numberValue(row, key) { const number = Number(value(row, key)); return Number.isFinite(number) ? number : 0; }
function optionalNumberValue(row, key) { const raw = value(row, key); if (raw === "") return null; const number = Number(raw); return Number.isFinite(number) ? number : null; }
function checked(row, key) { return Boolean(input(row, key)?.checked); }
function slugKey(value) { return String(value || "field").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "") || "field"; }
function uniqueKey(base, keys) { let key = base; let index = 2; while (keys.has(key)) { key = `${base}_${index}`; index += 1; } return key.slice(0, 50); }
function humanizeKey(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function todayValue() { return new Date().toISOString().slice(0, 10); }
function setStatus(message, type = "") { els.builderStatus.textContent = message || ""; els.builderStatus.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function attr(value) { return html(value); }
