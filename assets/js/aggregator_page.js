import { authClient, currentProfile, requireAdminAccess } from "./auth_client.js";

const state = { aggregators: [], profile: null };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "addAggregator", "aggregatorRows", "aggregatorStatus", "aggregatorEditor",
    "closeAggregatorEditor", "aggregatorForm", "aggregatorId", "aggregatorCode",
    "aggregatorName", "aggregatorShortName", "aggregatorRole",
    "aggregatorReceiptPrefix", "aggregatorCurrency", "aggregatorContactName",
    "aggregatorPhone", "aggregatorEmail", "aggregatorOperatingArea",
    "aggregatorAddress", "aggregatorNotes", "aggregatorActive",
    "aggregatorSaveStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const access = await requireAdminAccess("can_access_admin");
  if (!access) return;
  state.profile = access.profile || await currentProfile(true);
  els.addAggregator.hidden = state.profile.app_role !== "system_admin";
  bindEvents();
  await loadAggregators();
}

function bindEvents() {
  els.addAggregator.addEventListener("click", () => openAggregatorEditor());
  els.closeAggregatorEditor.addEventListener("click", () => { els.aggregatorEditor.hidden = true; });
  els.aggregatorForm.addEventListener("submit", saveAggregator);
  els.aggregatorRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-aggregator]");
    if (!button) return;
    openAggregatorEditor(state.aggregators.find((row) => row.id === button.dataset.editAggregator));
  });
}

async function loadAggregators() {
  setStatus(els.aggregatorStatus, "Loading...");
  try {
    state.aggregators = await rpc("ag_admin_aggregator_registry");
    renderAggregators();
    setStatus(els.aggregatorStatus, "");
  } catch (error) {
    setStatus(els.aggregatorStatus, error.message, "error");
  }
}

function renderAggregators() {
  els.aggregatorRows.innerHTML = state.aggregators.map((row) => `
    <tr>
      <td><strong>${html(row.aggregator_code)}</strong></td>
      <td>${html(row.organisation_name)}</td>
      <td>${html(title(row.organisation_role))}</td>
      <td>${html(row.receipt_prefix)}</td>
      <td>${html(row.default_currency)}</td>
      <td>${number(row.active_members)}</td>
      <td>${number(row.linked_farmers)}</td>
      <td>${number(row.linked_communities)}</td>
      <td>${row.active ? "Active" : "Inactive"}</td>
      <td>${state.profile.app_role === "system_admin" ? `<button type="button" data-edit-aggregator="${row.id}">Edit</button>` : ""}</td>
    </tr>
  `).join("") || '<tr><td colspan="10">No aggregators.</td></tr>';
}

function openAggregatorEditor(row = {}) {
  els.aggregatorId.value = row.id || "";
  els.aggregatorCode.value = row.aggregator_code || "";
  els.aggregatorName.value = row.organisation_name || "";
  els.aggregatorShortName.value = row.short_name || "";
  els.aggregatorRole.value = row.organisation_role || "aggregator";
  els.aggregatorReceiptPrefix.value = row.receipt_prefix || "";
  els.aggregatorCurrency.value = row.default_currency || "KES";
  els.aggregatorContactName.value = row.main_contact_name || "";
  els.aggregatorPhone.value = row.phone || "";
  els.aggregatorEmail.value = row.email || "";
  els.aggregatorOperatingArea.value = row.operating_area || "";
  els.aggregatorAddress.value = row.address || "";
  els.aggregatorNotes.value = row.notes || "";
  els.aggregatorActive.checked = row.active !== false;
  els.aggregatorEditor.hidden = false;
  els.aggregatorEditor.scrollIntoView({ behavior: "smooth" });
}

async function saveAggregator(event) {
  event.preventDefault();
  setStatus(els.aggregatorSaveStatus, "Saving...");
  try {
    await rpc("ag_admin_save_aggregator", {
      p_aggregator: {
        id: value(els.aggregatorId),
        aggregator_code: els.aggregatorCode.value,
        organisation_name: els.aggregatorName.value,
        short_name: value(els.aggregatorShortName),
        organisation_role: els.aggregatorRole.value,
        receipt_prefix: els.aggregatorReceiptPrefix.value,
        default_currency: els.aggregatorCurrency.value,
        main_contact_name: value(els.aggregatorContactName),
        phone: value(els.aggregatorPhone),
        email: value(els.aggregatorEmail),
        operating_area: value(els.aggregatorOperatingArea),
        address: value(els.aggregatorAddress),
        notes: value(els.aggregatorNotes),
        active: els.aggregatorActive.checked
      }
    });
    els.aggregatorEditor.hidden = true;
    await loadAggregators();
  } catch (error) {
    setStatus(els.aggregatorSaveStatus, error.message, "error");
  }
}

async function rpc(name, payload = {}) {
  const { data, error } = await authClient.rpc(name, payload);
  if (error) throw error;
  return data;
}

function setStatus(element, message, type = "") { element.textContent = message || ""; element.dataset.status = type; }
function value(element) { return element.value.trim() || null; }
function number(value) { return Number(value || 0).toLocaleString(); }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
