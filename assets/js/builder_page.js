import { authClient, requireAdminAccess } from "./auth_client.js";

const state = { settings: null };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["reloadBuilderSettings", "builderStatus", "saveGradePrices", "builderGradeRows", "saveSeaweedTypes", "builderSeaweedRows", "saveCollectionFields", "builderFieldRows"].forEach((id) => { els[id] = document.getElementById(id); });
  if (!await requireAdminAccess("can_manage_settings")) return;
  els.reloadBuilderSettings.addEventListener("click", loadSettings);
  els.saveGradePrices.addEventListener("click", () => saveSection("grade_prices", readGradeRows()));
  els.saveSeaweedTypes.addEventListener("click", () => saveSection("seaweed_types", readSeaweedRows()));
  els.saveCollectionFields.addEventListener("click", () => saveSection("collection_fields", readFieldRows()));
  await loadSettings();
}

async function loadSettings() {
  setStatus("Loading...");
  const { data, error } = await authClient.rpc("ag_admin_builder_settings");
  if (error) { setStatus(error.message, "error"); return; }
  state.settings = data;
  renderSettings();
  setStatus("");
}

async function saveSection(section, rows) {
  setStatus("Saving...");
  const { data, error } = await authClient.rpc("ag_admin_save_builder_settings", { p_section: section, p_rows: rows });
  if (error) { setStatus(error.message, "error"); return; }
  state.settings = data;
  renderSettings();
  setStatus("Saved. New collection entries use the published settings.");
}

function renderSettings() {
  els.builderGradeRows.innerHTML = (state.settings.grade_prices || []).map((row) => `<tr data-grade="${row.grade}"><td><strong>${row.grade}</strong></td><td><input data-key="price_per_kg" type="number" min="0" step="0.01" value="${attr(row.price_per_kg)}"></td><td><input data-key="rejected" type="checkbox" ${row.rejected ? "checked" : ""}></td><td><input data-key="active" type="checkbox" ${row.active ? "checked" : ""}></td><td><input data-key="effective_from" type="date" value="${attr(row.effective_from)}"></td></tr>`).join("");
  els.builderSeaweedRows.innerHTML = (state.settings.seaweed_types || []).map((row) => `<tr data-type-key="${attr(row.type_key)}"><td><strong>${html(row.type_key)}</strong></td><td><input data-key="label" type="text" value="${attr(row.label)}"></td><td><input data-key="common_name" type="text" value="${attr(row.common_name || "")}"></td><td><input data-key="active" type="checkbox" ${row.active ? "checked" : ""}></td><td><input data-key="is_default" name="defaultSeaweedType" type="radio" ${row.is_default ? "checked" : ""}></td><td><input data-key="display_order" type="number" min="0" step="1" value="${attr(row.display_order)}"></td></tr>`).join("");
  els.builderFieldRows.innerHTML = (state.settings.collection_fields || []).map((row) => `<tr data-field-key="${attr(row.field_key)}"><td><strong>${html(row.field_key)}</strong></td><td><input data-key="label" type="text" value="${attr(row.label)}"></td><td><input data-key="visible" type="checkbox" ${row.visible ? "checked" : ""} ${row.locked ? "disabled" : ""}></td><td><input data-key="required" type="checkbox" ${row.required ? "checked" : ""} ${row.locked ? "disabled" : ""}></td><td><input data-key="default_value" type="text" value="${attr(row.default_value || "")}"></td><td><input data-key="display_order" type="number" min="0" step="1" value="${attr(row.display_order)}"></td></tr>`).join("");
}

function readGradeRows() { return [...els.builderGradeRows.querySelectorAll("tr")].map((row) => ({ grade: row.dataset.grade, price_per_kg: numberValue(row, "price_per_kg"), rejected: checked(row, "rejected"), active: checked(row, "active"), effective_from: value(row, "effective_from") })); }
function readSeaweedRows() { return [...els.builderSeaweedRows.querySelectorAll("tr")].map((row) => ({ type_key: row.dataset.typeKey, label: value(row, "label"), common_name: value(row, "common_name"), active: checked(row, "active"), is_default: checked(row, "is_default"), display_order: numberValue(row, "display_order") })); }
function readFieldRows() { return [...els.builderFieldRows.querySelectorAll("tr")].map((row) => ({ field_key: row.dataset.fieldKey, label: value(row, "label"), visible: checked(row, "visible"), required: checked(row, "required"), default_value: value(row, "default_value"), display_order: numberValue(row, "display_order") })); }
function input(row, key) { return row.querySelector(`[data-key="${key}"]`); }
function value(row, key) { return input(row, key)?.value ?? ""; }
function numberValue(row, key) { const number = Number(value(row, key)); return Number.isFinite(number) ? number : 0; }
function checked(row, key) { return Boolean(input(row, key)?.checked); }
function setStatus(message, type = "") { els.builderStatus.textContent = message || ""; els.builderStatus.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function attr(value) { return html(value); }
