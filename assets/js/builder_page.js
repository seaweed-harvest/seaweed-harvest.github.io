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
    "builderTotalFieldCount", "saveGradePrices", "builderGradeRows", "saveSeaweedTypes",
    "builderSeaweedRows", "saveCollectionFields", "builderFieldRows", "builderFieldTemplate",
    "addCustomField", "saveCustomFields", "builderCustomFieldRows", "builderFormPreview",
    "builderPreviewStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!await requireAdminAccess("can_manage_settings")) return;
  bindEvents();
  await loadSettings();
}

function bindEvents() {
  els.reloadBuilderSettings.addEventListener("click", loadSettings);
  els.saveGradePrices.addEventListener("click", () => saveStandardSection("grade_prices", readGradeRows()));
  els.saveSeaweedTypes.addEventListener("click", () => saveStandardSection("seaweed_types", readSeaweedRows()));
  els.saveCollectionFields.addEventListener("click", () => saveStandardSection("collection_fields", readFieldRows()));
  els.addCustomField.addEventListener("click", addCustomField);
  els.saveCustomFields.addEventListener("click", saveCustomFields);
  els.builderCustomFieldRows.addEventListener("input", handleCustomFieldInput);
  els.builderCustomFieldRows.addEventListener("change", handleCustomFieldInput);
  els.builderCustomFieldRows.addEventListener("click", handleCustomFieldClick);
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
  renderStandardSettings();
  renderCustomFields();
  setStatus("");
}

async function saveStandardSection(section, rows) {
  setStatus("Saving...");
  const { data, error } = await authClient.rpc("ag_admin_save_builder_settings", { p_section: section, p_rows: rows });
  if (error) { setStatus(error.message, "error"); return; }
  state.settings = data;
  renderStandardSettings();
  setStatus("Saved.");
}

async function saveCustomFields() {
  const rows = readCustomRows();
  setStatus("Publishing collection form...");
  const { data, error } = await authClient.rpc("ag_admin_save_custom_fields", {
    p_entity_type: "collection",
    p_rows: rows
  });
  if (error) { setStatus(error.message, "error"); return; }
  state.customFields = data || [];
  renderCustomFields();
  setStatus("Collection form published.");
}

function addCustomField() {
  const template = structuredClone(TEMPLATES[els.builderFieldTemplate.value] || TEMPLATES.blank);
  const nextOrder = Math.max(0, ...readCustomRows().map((row) => Number(row.display_order) || 0)) + 10;
  const baseKey = template.field_key || slugKey(template.label);
  const keys = new Set(readCustomRows().map((row) => row.field_key));
  template.field_key = uniqueKey(baseKey, keys);
  template.options = template.options || [];
  template.display_order = nextOrder;
  template.decimal_places = 2;
  template.required = false;
  template.active = true;
  template.show_in_ledger = Boolean(template.show_in_ledger);
  state.customFields = [...readCustomRows(), template];
  renderCustomFields();
  const added = [...els.builderCustomFieldRows.querySelectorAll("tr")].at(-1);
  added?.querySelector('[data-key="label"]')?.focus();
  setStatus("Field added. Save form to publish it.");
}

function handleCustomFieldInput(event) {
  const row = event.target.closest("tr[data-field-row]");
  if (!row) return;
  if (event.target.dataset.key === "label" && row.dataset.autoKey === "true") {
    const keyInput = input(row, "field_key");
    keyInput.value = uniqueKey(slugKey(event.target.value), new Set(readCustomRows().filter((item) => item.field_key !== keyInput.value).map((item) => item.field_key)));
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
  const row = remove.closest("tr[data-field-row]");
  row.remove();
  state.customFields = readCustomRows();
  renderPreview();
  renderSummary();
  setStatus("Field removed. Save form to publish the change.");
}

function renderStandardSettings() {
  els.builderGradeRows.innerHTML = (state.settings.grade_prices || []).map((row) => `<tr data-grade="${row.grade}"><td><strong>${row.grade}</strong></td><td><input data-key="price_per_kg" type="number" min="0" step="0.01" value="${attr(row.price_per_kg)}"></td><td><input data-key="rejected" type="checkbox" ${row.rejected ? "checked" : ""}></td><td><input data-key="active" type="checkbox" ${row.active ? "checked" : ""}></td><td><input data-key="effective_from" type="date" value="${attr(row.effective_from)}"></td></tr>`).join("");
  els.builderSeaweedRows.innerHTML = (state.settings.seaweed_types || []).map((row) => `<tr data-type-key="${attr(row.type_key)}"><td><strong>${html(row.type_key)}</strong></td><td><input data-key="label" type="text" value="${attr(row.label)}"></td><td><input data-key="common_name" type="text" value="${attr(row.common_name || "")}"></td><td><input data-key="active" type="checkbox" ${row.active ? "checked" : ""}></td><td><input data-key="is_default" name="defaultSeaweedType" type="radio" ${row.is_default ? "checked" : ""}></td><td><input data-key="display_order" type="number" min="0" step="1" value="${attr(row.display_order)}"></td></tr>`).join("");
  els.builderFieldRows.innerHTML = (state.settings.collection_fields || []).map((row) => `<tr data-field-key="${attr(row.field_key)}"><td><strong>${html(row.field_key)}</strong></td><td><input data-key="label" type="text" value="${attr(row.label)}"></td><td><input data-key="visible" type="checkbox" ${row.visible ? "checked" : ""} ${row.locked ? "disabled" : ""}></td><td><input data-key="required" type="checkbox" ${row.required ? "checked" : ""} ${row.locked ? "disabled" : ""}></td><td><input data-key="default_value" type="text" value="${attr(row.default_value || "")}"></td><td><input data-key="display_order" type="number" min="0" step="1" value="${attr(row.display_order)}"></td></tr>`).join("");
}

function renderCustomFields() {
  els.builderCustomFieldRows.innerHTML = state.customFields
    .slice()
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map(customFieldRow).join("");
  renderPreview();
  renderSummary();
}

function customFieldRow(row) {
  const numeric = ["number", "currency", "calculation"].includes(row.field_type);
  return `<tr data-field-row data-auto-key="false">
    <td><input data-key="display_order" class="builder-order-input" type="number" min="0" step="1" value="${attr(row.display_order ?? 100)}" aria-label="Order"></td>
    <td><input data-key="field_key" class="builder-key-input" type="text" value="${attr(row.field_key || "")}" pattern="[a-z][a-z0-9_]{1,49}" aria-label="Field key"></td>
    <td><input data-key="label" type="text" value="${attr(row.label || "")}" aria-label="Label"></td>
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
  ["min_value", "max_value", "decimal_places"].forEach((key) => {
    input(row, key).disabled = !numeric;
  });
}

function renderPreview() {
  const activeRows = readCustomRows().filter((row) => row.active);
  els.builderPreviewStatus.textContent = `${activeRows.length} fields`;
  els.builderFormPreview.innerHTML = activeRows.length
    ? activeRows.map(previewField).join("")
    : '<p class="muted-cell">No custom fields configured.</p>';
}

function previewField(row) {
  const title = `${html(row.label || row.field_key)}${row.unit ? ` (${html(row.unit)})` : ""}`;
  if (row.field_type === "checkbox") return `<label class="check-row"><input type="checkbox" disabled ${String(row.default_value).toLowerCase() === "true" ? "checked" : ""}> ${title}</label>`;
  if (row.field_type === "long_text") return `<label>${title}<textarea rows="2" disabled placeholder="${attr(row.placeholder || "")}"></textarea></label>`;
  if (row.field_type === "single_select" || row.field_type === "multi_select") return `<label>${title}<select ${row.field_type === "multi_select" ? "multiple" : ""} disabled><option>${html(row.default_value || "Select")}</option>${row.options.map((option) => `<option>${html(option)}</option>`).join("")}</select></label>`;
  const inputType = { number: "number", currency: "number", calculation: "number", date: "date", time: "time", datetime: "datetime-local", email: "email", phone: "tel" }[row.field_type] || "text";
  return `<label>${title}<input type="${inputType}" disabled value="${attr(row.default_value || "")}" placeholder="${attr(row.placeholder || "")}" ${row.field_type === "calculation" ? "readonly" : ""}></label>`;
}

function renderSummary() {
  const rows = readCustomRows();
  els.builderTotalFieldCount.textContent = `${rows.length} configured`;
  els.builderActiveFieldCount.textContent = `${rows.filter((row) => row.active).length} active fields`;
  els.builderLedgerFieldCount.textContent = `${rows.filter((row) => row.active && row.show_in_ledger).length} ledger columns`;
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
    placeholder: type !== "single_select" && type !== "multi_select" && type !== "calculation" ? configuration.trim() : "",
    options: type === "single_select" || type === "multi_select" ? configuration.split(",").map((item) => item.trim()).filter(Boolean) : [],
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

function readGradeRows() { return [...els.builderGradeRows.querySelectorAll("tr")].map((row) => ({ grade: row.dataset.grade, price_per_kg: numberValue(row, "price_per_kg"), rejected: checked(row, "rejected"), active: checked(row, "active"), effective_from: value(row, "effective_from") })); }
function readSeaweedRows() { return [...els.builderSeaweedRows.querySelectorAll("tr")].map((row) => ({ type_key: row.dataset.typeKey, label: value(row, "label"), common_name: value(row, "common_name"), active: checked(row, "active"), is_default: checked(row, "is_default"), display_order: numberValue(row, "display_order") })); }
function readFieldRows() { return [...els.builderFieldRows.querySelectorAll("tr")].map((row) => ({ field_key: row.dataset.fieldKey, label: value(row, "label"), visible: checked(row, "visible"), required: checked(row, "required"), default_value: value(row, "default_value"), display_order: numberValue(row, "display_order") })); }
function typeOptions(selected) { return Object.entries(FIELD_TYPES).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join(""); }
function input(row, key) { return row.querySelector(`[data-key="${key}"]`); }
function value(row, key) { return input(row, key)?.value ?? ""; }
function numberValue(row, key) { const number = Number(value(row, key)); return Number.isFinite(number) ? number : 0; }
function optionalNumberValue(row, key) { const raw = value(row, key); if (raw === "") return null; const number = Number(raw); return Number.isFinite(number) ? number : null; }
function checked(row, key) { return Boolean(input(row, key)?.checked); }
function slugKey(value) { return String(value || "field").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "") || "field"; }
function uniqueKey(base, keys) { let key = base; let index = 2; while (keys.has(key)) { key = `${base}_${index}`; index += 1; } return key.slice(0, 50); }
function setStatus(message, type = "") { els.builderStatus.textContent = message || ""; els.builderStatus.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function attr(value) { return html(value); }
