import { authClient, currentProfile, requireAdminAccess } from "./auth_client.js";
import { selectRows } from "./supabase_client.js";

const state = {
  rows: [],
  types: [],
  grades: [],
  forms: [],
  profile: null,
  canManage: false
};
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "addPricingRule", "pricingTypeFilter", "pricingGradeFilter", "pricingFormFilter",
    "pricingStatusFilter", "pricingRows", "pricingStatus", "pricingEditor",
    "pricingEditorTitle", "closePricingEditor", "pricingRuleForm", "pricingRuleId",
    "pricingType", "pricingTypeOptions", "pricingGrade", "pricingGradeOptions",
    "pricingProductForm", "pricingProductFormOptions", "pricingPrice", "pricingCurrency",
    "pricingRejected", "pricingEffectiveFrom", "pricingEffectiveTo", "pricingActive",
    "pricingNotes", "deactivatePricingRule", "pricingSaveStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const access = await requireAdminAccess("can_view_finance");
  if (!access) return;
  state.profile = access.profile || await currentProfile(true);
  state.canManage = state.profile.app_role === "system_admin"
    || (state.profile.can_manage_pricing
      && ["aggregator_admin", "finance", "platform_admin"].includes(state.profile.active_membership_role));
  els.addPricingRule.hidden = !state.canManage;
  bindEvents();
  await loadSettings();
  await loadPrices();
}

function bindEvents() {
  [els.pricingTypeFilter, els.pricingGradeFilter, els.pricingFormFilter, els.pricingStatusFilter]
    .forEach((control) => control.addEventListener("change", renderRows));
  els.addPricingRule.addEventListener("click", () => openEditor());
  els.closePricingEditor.addEventListener("click", closeEditor);
  els.pricingRuleForm.addEventListener("submit", savePrice);
  els.deactivatePricingRule.addEventListener("click", deactivatePrice);
  els.pricingGrade.addEventListener("change", syncRejectedGrade);
  els.pricingRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-price]");
    if (button) openEditor(state.rows.find((row) => row.id === button.dataset.editPrice));
  });
}

async function loadSettings() {
  [state.types, state.grades, state.forms] = await Promise.all([
    selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"),
    selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc"),
    selectRows("ag_public_product_form_settings", "select=*&order=display_order.asc")
  ]);
  renderCatalogControls();
}

function renderCatalogControls() {
  els.pricingTypeOptions.innerHTML = state.types
    .map((row) => `<option value="${attr(row.label)}">${html(row.type_key)}</option>`).join("");
  els.pricingGradeOptions.innerHTML = state.grades
    .map((row) => `<option value="${attr(row.grade)}">${html(row.label || row.grade)}</option>`).join("");
  els.pricingProductFormOptions.innerHTML = state.forms
    .map((row) => `<option value="${attr(row.label)}">${html(row.form_key)}</option>`).join("");

  replaceFilterOptions(els.pricingTypeFilter, state.types, "type_key", "label", "All types");
  replaceFilterOptions(els.pricingGradeFilter, state.grades, "grade", "label", "All grades");
  replaceFilterOptions(els.pricingFormFilter, state.forms, "form_key", "label", "All forms");
}

function replaceFilterOptions(select, rows, key, label, emptyLabel) {
  const selected = select.value;
  select.innerHTML = `<option value="">${html(emptyLabel)}</option>${rows.map((row) => (
    `<option value="${attr(row[key])}">${html(row[label] || row[key])}</option>`
  )).join("")}`;
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "";
}

async function loadPrices() {
  setStatus(els.pricingStatus, "Loading...");
  try {
    state.rows = await rpc("ag_admin_pricing_matrix");
    renderRows();
    setStatus(els.pricingStatus, `${state.rows.length} price rules.`);
  } catch (error) {
    setStatus(els.pricingStatus, error.message, "error");
  }
}

function renderRows() {
  const rows = state.rows.filter((row) => (
    (!els.pricingTypeFilter.value || row.seaweed_type === els.pricingTypeFilter.value)
    && (!els.pricingGradeFilter.value || row.grade_code === els.pricingGradeFilter.value)
    && (!els.pricingFormFilter.value || row.product_form === els.pricingFormFilter.value)
    && (els.pricingStatusFilter.value === "all"
      || (els.pricingStatusFilter.value === "active" ? row.is_active : !row.is_active))
  ));
  els.pricingRows.innerHTML = rows.map((row) => {
    const grade = gradeFor(row.grade_code);
    return `<tr>
      <td>${html(labelFor(state.types, "type_key", row.seaweed_type, "label"))}</td>
      <td><strong>${html(row.grade_code)}</strong></td>
      <td>${html(labelFor(state.forms, "form_key", row.product_form, "label"))}</td>
      <td>${money(row.price_per_kg)}</td>
      <td>${html(row.currency)}</td>
      <td>${grade?.rejected ? "Yes" : "No"}</td>
      <td>${date(row.effective_from)}</td>
      <td>${date(row.effective_to)}</td>
      <td>${row.is_active ? "Active" : "Inactive"}</td>
      <td>${dateTime(row.updated_at)}${row.updated_by_name ? ` - ${html(row.updated_by_name)}` : ""}</td>
      <td>${state.canManage ? `<button type="button" data-edit-price="${row.id}">Edit</button>` : ""}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="11">No matching prices.</td></tr>';
}

function openEditor(row = {}) {
  if (!state.canManage) return;
  els.pricingEditorTitle.textContent = row.id ? "Edit Price" : "Add Price";
  els.pricingRuleId.value = row.id || "";
  els.pricingType.value = row.id
    ? labelFor(state.types, "type_key", row.seaweed_type, "label")
    : state.types.find((item) => item.is_default)?.label || state.types[0]?.label || "";
  els.pricingGrade.value = row.grade_code || state.grades[0]?.grade || "";
  els.pricingProductForm.value = row.id
    ? labelFor(state.forms, "form_key", row.product_form, "label")
    : labelFor(state.forms, "form_key", "wet", "label") || state.forms[0]?.label || "Wet";
  els.pricingPrice.value = row.price_per_kg ?? "";
  els.pricingCurrency.value = row.currency || "KES";
  els.pricingRejected.checked = Boolean(gradeFor(row.grade_code || els.pricingGrade.value)?.rejected);
  els.pricingEffectiveFrom.value = row.effective_from || new Date().toISOString().slice(0, 10);
  els.pricingEffectiveTo.value = row.effective_to || "";
  els.pricingActive.checked = row.is_active !== false;
  els.pricingNotes.value = row.notes || "";
  els.deactivatePricingRule.hidden = !row.id || !row.is_active;
  els.pricingEditor.hidden = false;
  els.pricingType.focus();
  els.pricingEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  els.pricingEditor.hidden = true;
  els.pricingRuleForm.reset();
  els.pricingRuleId.value = "";
  els.pricingSaveStatus.textContent = "";
}

function syncRejectedGrade() {
  const grade = resolveGrade(els.pricingGrade.value, false);
  const setting = grade ? gradeFor(grade.key) : null;
  if (setting) els.pricingRejected.checked = Boolean(setting.rejected);
}

async function savePrice(event) {
  event.preventDefault();
  if (!state.canManage) return;
  setStatus(els.pricingSaveStatus, "Saving...");
  try {
    const type = resolveType(els.pricingType.value);
    const grade = resolveGrade(els.pricingGrade.value);
    const form = resolveForm(els.pricingProductForm.value);
    await rpc("ag_admin_save_pricing_rule", {
      p_rule: {
        id: nullable(els.pricingRuleId.value),
        seaweed_type: type.key,
        seaweed_type_label: type.label,
        seaweed_type_common_name: type.commonName,
        grade_code: grade.key,
        grade_label: grade.label,
        grade_rejected: els.pricingRejected.checked,
        product_form: form.key,
        product_form_label: form.label,
        price_per_kg: Number(els.pricingPrice.value),
        currency: els.pricingCurrency.value,
        effective_from: els.pricingEffectiveFrom.value,
        effective_to: nullable(els.pricingEffectiveTo.value),
        is_active: els.pricingActive.checked,
        notes: nullable(els.pricingNotes.value)
      }
    });
    closeEditor();
    await loadSettings();
    await loadPrices();
  } catch (error) {
    setStatus(els.pricingSaveStatus, error.message, "error");
  }
}

async function deactivatePrice() {
  if (!state.canManage || !confirm("Deactivate this price rule? Existing receipts will not change.")) return;
  setStatus(els.pricingSaveStatus, "Deactivating...");
  try {
    await rpc("ag_admin_deactivate_pricing_rule", { p_rule_id: els.pricingRuleId.value });
    closeEditor();
    await loadPrices();
  } catch (error) {
    setStatus(els.pricingSaveStatus, error.message, "error");
  }
}

function resolveType(value, required = true) {
  const raw = String(value || "").trim();
  if (!raw) return required ? invalid("Enter a seaweed type.") : null;
  const existing = state.types.find((row) => [row.type_key, row.label, row.common_name]
    .filter(Boolean).some((item) => sameText(item, raw)));
  if (existing) return { key: existing.type_key, label: existing.label, commonName: existing.common_name || null };
  return { key: catalogKey(raw, "seaweed type"), label: raw, commonName: null };
}

function resolveGrade(value, required = true) {
  const raw = String(value || "").trim();
  if (!raw) return required ? invalid("Enter a grade.") : null;
  const existing = state.grades.find((row) => [row.grade, row.label]
    .filter(Boolean).some((item) => sameText(item, raw)));
  if (existing) return { key: existing.grade, label: existing.label || existing.grade };
  const key = raw.toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[A-Z][A-Z0-9_-]{0,9}$/.test(key)) invalid("Grade must use 1-10 letters, numbers, dashes, or underscores.");
  return { key, label: raw };
}

function resolveForm(value, required = true) {
  const raw = String(value || "").trim();
  if (!raw) return required ? invalid("Enter a product form.") : null;
  const existing = state.forms.find((row) => [row.form_key, row.label]
    .filter(Boolean).some((item) => sameText(item, raw)));
  if (existing) return { key: existing.form_key, label: existing.label };
  return { key: catalogKey(raw, "product form"), label: raw };
}

function catalogKey(value, label) {
  const key = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) invalid(`${title(label)} must contain at least two letters or numbers.`);
  return key;
}

function gradeFor(code) {
  return state.grades.find((row) => row.grade === code) || null;
}

function invalid(message) {
  throw new Error(message);
}

async function rpc(name, payload = {}) {
  const { data, error } = await authClient.rpc(name, payload);
  if (error) throw error;
  return data;
}

function labelFor(rows, key, value, label) { return rows.find((row) => row[key] === value)?.[label] || value || ""; }
function sameText(left, right) { return String(left).trim().toLowerCase() === String(right).trim().toLowerCase(); }
function nullable(value) { return String(value || "").trim() || null; }
function money(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function date(value) { return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB") : "-"; }
function dateTime(value) { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function setStatus(element, message, type = "") { element.textContent = message || ""; element.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function attr(value) { return html(value).replaceAll("`", "&#096;"); }
