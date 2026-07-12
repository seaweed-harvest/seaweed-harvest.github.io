import { authClient, currentProfile, requireAdminAccess } from "./auth_client.js";
import { selectRows } from "./supabase_client.js";

const state = {
  rows: [],
  types: [],
  grades: [],
  profile: null,
  canManage: false
};
const els = {};
document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "addPricingRule", "pricingTypeFilter", "pricingGradeFilter", "pricingFormFilter",
    "pricingStatusFilter", "pricingRows", "pricingStatus", "pricingEditor",
    "closePricingEditor", "pricingRuleForm", "pricingRuleId", "pricingType",
    "pricingGrade", "pricingProductForm", "pricingPrice", "pricingCurrency",
    "pricingEffectiveFrom", "pricingEffectiveTo", "pricingActive", "pricingNotes",
    "deactivatePricingRule", "pricingSaveStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const access = await requireAdminAccess("can_view_finance");
  if (!access) return;
  state.profile = access.profile || await currentProfile(true);
  state.canManage = state.profile.app_role === "system_admin"
    || (state.profile.can_view_finance
      && ["aggregator_admin", "finance", "platform_admin"].includes(state.profile.active_membership_role));
  els.addPricingRule.hidden = !state.canManage;
  bindEvents();
  await loadSettings();
  await loadPrices();
}

function bindEvents() {
  [els.pricingTypeFilter, els.pricingGradeFilter, els.pricingFormFilter, els.pricingStatusFilter].forEach((control) => control.addEventListener("change", renderRows));
  els.addPricingRule.addEventListener("click", () => openEditor());
  els.closePricingEditor.addEventListener("click", closeEditor);
  els.pricingRuleForm.addEventListener("submit", savePrice);
  els.deactivatePricingRule.addEventListener("click", deactivatePrice);
  els.pricingRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-price]");
    if (button) openEditor(state.rows.find((row) => row.id === button.dataset.editPrice));
  });
}

async function loadSettings() {
  [state.types, state.grades] = await Promise.all([selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"), selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc")]);
  const types = state.types.map((row) => `<option value="${html(row.type_key)}">${html(row.label)}</option>`).join(""); const grades = state.grades.map((row) => `<option value="${html(row.grade)}">${html(row.label || row.grade)}</option>`).join("");
  els.pricingType.innerHTML = types; els.pricingGrade.innerHTML = grades; els.pricingTypeFilter.insertAdjacentHTML("beforeend", types); els.pricingGradeFilter.insertAdjacentHTML("beforeend", grades);
}

async function loadPrices() { setStatus(els.pricingStatus, "Loading..."); try { state.rows = await rpc("ag_admin_pricing_matrix"); renderRows(); setStatus(els.pricingStatus, `${state.rows.length} price rules.`); } catch (error) { setStatus(els.pricingStatus, error.message, "error"); } }

function renderRows() {
  const rows = state.rows.filter((row) => (!els.pricingTypeFilter.value || row.seaweed_type === els.pricingTypeFilter.value) && (!els.pricingGradeFilter.value || row.grade_code === els.pricingGradeFilter.value) && (!els.pricingFormFilter.value || row.product_form === els.pricingFormFilter.value) && (els.pricingStatusFilter.value === "all" || (els.pricingStatusFilter.value === "active" ? row.is_active : !row.is_active)));
  els.pricingRows.innerHTML = rows.map((row) => `<tr><td>${html(labelFor(state.types, "type_key", row.seaweed_type, "label"))}</td><td><strong>${html(row.grade_code)}</strong></td><td>${html(title(row.product_form))}</td><td>${money(row.price_per_kg)}</td><td>${html(row.currency)}</td><td>${date(row.effective_from)}</td><td>${date(row.effective_to)}</td><td>${row.is_active ? "Active" : "Inactive"}</td><td>${dateTime(row.updated_at)}${row.updated_by_name ? ` - ${html(row.updated_by_name)}` : ""}</td><td>${state.canManage ? `<button type="button" data-edit-price="${row.id}">Edit</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="10">No matching prices.</td></tr>';
}

function openEditor(row = {}) {
  if (!state.canManage) return;
  els.pricingRuleId.value = row.id || "";
  els.pricingType.value = row.seaweed_type || state.types[0]?.type_key || "";
  els.pricingGrade.value = row.grade_code || state.grades[0]?.grade || "";
  els.pricingProductForm.value = row.product_form || "wet";
  els.pricingPrice.value = row.price_per_kg ?? "";
  els.pricingCurrency.value = row.currency || "KES";
  els.pricingEffectiveFrom.value = row.effective_from || new Date().toISOString().slice(0, 10);
  els.pricingEffectiveTo.value = row.effective_to || "";
  els.pricingActive.checked = row.is_active !== false;
  els.pricingNotes.value = row.notes || "";
  els.deactivatePricingRule.hidden = !row.id || !row.is_active;
  els.pricingEditor.hidden = false;
  els.pricingEditor.scrollIntoView({ behavior: "smooth" });
}

function closeEditor() {
  els.pricingEditor.hidden = true;
  els.pricingRuleForm.reset();
  els.pricingSaveStatus.textContent = "";
}

async function savePrice(event) {
  event.preventDefault();
  if (!state.canManage) return;
  setStatus(els.pricingSaveStatus, "Saving...");
  try {
    await rpc("ag_admin_save_pricing_rule", {
      p_rule: {
        id: nullable(els.pricingRuleId.value),
        seaweed_type: els.pricingType.value,
        grade_code: els.pricingGrade.value,
        product_form: els.pricingProductForm.value,
        price_per_kg: Number(els.pricingPrice.value),
        currency: els.pricingCurrency.value,
        effective_from: els.pricingEffectiveFrom.value,
        effective_to: nullable(els.pricingEffectiveTo.value),
        is_active: els.pricingActive.checked,
        notes: nullable(els.pricingNotes.value)
      }
    });
    closeEditor();
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

async function rpc(name, payload = {}) { const { data, error } = await authClient.rpc(name, payload); if (error) throw error; return data; }
function labelFor(rows, key, value, label) { return rows.find((row) => row[key] === value)?.[label] || value; }
function nullable(value) { return String(value || "").trim() || null; }
function money(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function date(value) { return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB") : "-"; }
function dateTime(value) { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function setStatus(element, message, type = "") { element.textContent = message || ""; element.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
