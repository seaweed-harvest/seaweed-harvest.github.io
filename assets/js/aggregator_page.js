import { authClient, currentProfile, requireAdminAccess } from "./auth_client.js";

const state = {
  aggregators: [],
  memberships: [],
  relationships: { communities: [], farmers: [] },
  profile: null,
  canManageMemberships: false,
  canEditRelationships: false
};
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["addAggregator", "aggregatorRows", "aggregatorStatus", "aggregatorEditor", "closeAggregatorEditor", "aggregatorForm", "aggregatorId", "aggregatorCode", "aggregatorName", "aggregatorShortName", "aggregatorRole", "aggregatorReceiptPrefix", "aggregatorCurrency", "aggregatorContactName", "aggregatorPhone", "aggregatorEmail", "aggregatorOperatingArea", "aggregatorAddress", "aggregatorNotes", "aggregatorActive", "aggregatorSaveStatus", "membershipForm", "membershipEmail", "membershipRole", "membershipActive", "membershipRows", "membershipCount", "membershipStatus", "relationshipPanel", "relationshipStatus", "relationshipCommunitySearch", "relationshipFarmerSearch", "relationshipCommunities", "relationshipFarmers"].forEach((id) => { els[id] = document.getElementById(id); });
  const access = await requireAdminAccess("can_access_admin"); if (!access) return;
  state.profile = access.profile || await currentProfile(true);
  state.canManageMemberships = state.profile.app_role === "system_admin"
    || (state.profile.can_manage_users && ["aggregator_admin", "platform_admin"].includes(state.profile.active_membership_role));
  state.canEditRelationships = state.profile.app_role === "system_admin" || state.profile.can_edit_registry;
  els.addAggregator.hidden = state.profile.app_role !== "system_admin";
  bindEvents();
  await loadAll();
}

function bindEvents() {
  els.addAggregator.addEventListener("click", () => openAggregatorEditor());
  els.closeAggregatorEditor.addEventListener("click", () => { els.aggregatorEditor.hidden = true; });
  els.aggregatorForm.addEventListener("submit", saveAggregator);
  els.aggregatorRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-aggregator]");
    if (button) openAggregatorEditor(state.aggregators.find((row) => row.id === button.dataset.editAggregator));
  });
  els.membershipForm.addEventListener("submit", saveMembership);
  els.membershipRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-membership]"); if (!button) return;
    const row = state.memberships.find((item) => item.id === button.dataset.editMembership); if (!row) return;
    els.membershipEmail.value = row.email; els.membershipRole.value = row.membership_role; els.membershipActive.checked = row.is_active;
  });
  els.relationshipCommunitySearch.addEventListener("input", renderRelationships);
  els.relationshipFarmerSearch.addEventListener("input", renderRelationships);
  els.relationshipPanel.addEventListener("change", saveRelationship);
}

async function loadAll() {
  setStatus(els.aggregatorStatus, "Loading...");
  try {
    const [aggregators, memberships, relationships] = await Promise.all([
      rpc("ag_admin_aggregator_registry"),
      state.canManageMemberships ? rpc("ag_admin_aggregator_memberships") : [],
      state.profile.can_view_registry || state.profile.app_role === "system_admin"
        ? rpc("ag_admin_aggregator_relationships")
        : { communities: [], farmers: [] }
    ]);
    state.aggregators = aggregators;
    state.memberships = memberships;
    state.relationships = relationships;
    renderAggregators();
    renderMemberships();
    renderRelationships();
    setStatus(els.aggregatorStatus, "");
  } catch (error) {
    setStatus(els.aggregatorStatus, error.message, "error");
  }
  els.membershipForm.hidden = !state.canManageMemberships;
  els.relationshipPanel.hidden = !(state.profile.can_view_registry || state.profile.app_role === "system_admin");
}

function renderAggregators() {
  els.aggregatorRows.innerHTML = state.aggregators.map((row) => `<tr><td><strong>${html(row.aggregator_code)}</strong></td><td>${html(row.organisation_name)}</td><td>${html(title(row.organisation_role))}</td><td>${html(row.receipt_prefix)}</td><td>${html(row.default_currency)}</td><td>${number(row.active_members)}</td><td>${number(row.linked_farmers)}</td><td>${number(row.linked_communities)}</td><td>${row.active ? "Active" : "Inactive"}</td><td>${state.profile.app_role === "system_admin" ? `<button type="button" data-edit-aggregator="${row.id}">Edit</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="10">No aggregators.</td></tr>';
}

function openAggregatorEditor(row = {}) {
  els.aggregatorId.value = row.id || ""; els.aggregatorCode.value = row.aggregator_code || ""; els.aggregatorName.value = row.organisation_name || ""; els.aggregatorShortName.value = row.short_name || ""; els.aggregatorRole.value = row.organisation_role || "aggregator"; els.aggregatorReceiptPrefix.value = row.receipt_prefix || ""; els.aggregatorCurrency.value = row.default_currency || "KES"; els.aggregatorContactName.value = row.main_contact_name || ""; els.aggregatorPhone.value = row.phone || ""; els.aggregatorEmail.value = row.email || ""; els.aggregatorOperatingArea.value = row.operating_area || ""; els.aggregatorAddress.value = row.address || ""; els.aggregatorNotes.value = row.notes || ""; els.aggregatorActive.checked = row.active !== false; els.aggregatorEditor.hidden = false; els.aggregatorEditor.scrollIntoView({ behavior: "smooth" });
}

async function saveAggregator(event) {
  event.preventDefault(); setStatus(els.aggregatorSaveStatus, "Saving...");
  try { await rpc("ag_admin_save_aggregator", { p_aggregator: { id: value(els.aggregatorId), aggregator_code: els.aggregatorCode.value, organisation_name: els.aggregatorName.value, short_name: value(els.aggregatorShortName), organisation_role: els.aggregatorRole.value, receipt_prefix: els.aggregatorReceiptPrefix.value, default_currency: els.aggregatorCurrency.value, main_contact_name: value(els.aggregatorContactName), phone: value(els.aggregatorPhone), email: value(els.aggregatorEmail), operating_area: value(els.aggregatorOperatingArea), address: value(els.aggregatorAddress), notes: value(els.aggregatorNotes), active: els.aggregatorActive.checked } }); els.aggregatorEditor.hidden = true; await loadAll(); } catch (error) { setStatus(els.aggregatorSaveStatus, error.message, "error"); }
}

function renderMemberships() {
  els.membershipCount.textContent = `${state.memberships.length} users`;
  els.membershipRows.innerHTML = state.memberships.map((row) => `<tr><td>${html(row.email)}</td><td>${html(row.display_name || "-")}</td><td>${html(title(row.app_role))}</td><td>${html(title(row.membership_role))}</td><td>${row.is_active ? "Active" : "Inactive"}</td><td>${state.canManageMemberships ? `<button type="button" data-edit-membership="${row.id}">Edit</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="6">No assigned users.</td></tr>';
}

async function saveMembership(event) {
  event.preventDefault(); setStatus(els.membershipStatus, "Saving...");
  try { await rpc("ag_admin_save_aggregator_membership", { p_membership: { email: els.membershipEmail.value, membership_role: els.membershipRole.value, is_active: els.membershipActive.checked } }); els.membershipForm.reset(); els.membershipActive.checked = true; state.memberships = await rpc("ag_admin_aggregator_memberships"); renderMemberships(); setStatus(els.membershipStatus, "Saved."); } catch (error) { setStatus(els.membershipStatus, error.message, "error"); }
}

function renderRelationships() {
  const cq = els.relationshipCommunitySearch.value.trim().toLowerCase(); const fq = els.relationshipFarmerSearch.value.trim().toLowerCase();
  const disabled = state.canEditRelationships ? "" : "disabled";
  els.relationshipCommunities.innerHTML = state.relationships.communities.filter((row) => `${row.community_id} ${row.community_name}`.toLowerCase().includes(cq)).map((row) => `<label><input type="checkbox" data-relationship-type="community" data-record-id="${row.id}" ${row.linked ? "checked" : ""} ${disabled}> <span>${html(row.community_id)} - ${html(row.community_name)}</span></label>`).join("");
  els.relationshipFarmers.innerHTML = state.relationships.farmers.filter((row) => `${row.farmer_id} ${row.name} ${row.community_id || ""}`.toLowerCase().includes(fq)).map((row) => `<label><input type="checkbox" data-relationship-type="farmer" data-record-id="${row.id}" ${row.linked ? "checked" : ""} ${disabled}> <span>${html(row.farmer_id)} - ${html(row.name)}</span></label>`).join("");
}

async function saveRelationship(event) {
  const input = event.target.closest("[data-relationship-type]"); if (!input) return;
  if (!state.canEditRelationships) return;
  input.disabled = true; setStatus(els.relationshipStatus, "Saving...");
  try { await rpc("ag_admin_set_aggregator_relationship", { p_entity_type: input.dataset.relationshipType, p_record_id: input.dataset.recordId, p_is_active: input.checked }); setStatus(els.relationshipStatus, "Saved."); } catch (error) { input.checked = !input.checked; setStatus(els.relationshipStatus, error.message, "error"); } finally { input.disabled = false; }
}

async function rpc(name, payload = {}) { const { data, error } = await authClient.rpc(name, payload); if (error) throw error; return data; }
function setStatus(element, message, type = "") { element.textContent = message || ""; element.dataset.status = type; }
function value(element) { return element.value.trim() || null; }
function number(value) { return Number(value || 0).toLocaleString(); }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
