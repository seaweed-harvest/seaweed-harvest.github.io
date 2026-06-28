import { APP_CONFIG } from "./config.js";
import { dataModeLabel, selectRows } from "./supabase_client.js";

const state = {
  communities: [],
  farmers: []
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  await loadRegistry();
}

function cacheElements() {
  [
    "registryConnectionStatus",
    "farmerCount",
    "communityCount",
    "farmerRegistryRows",
    "communityRegistryRows"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

async function loadRegistry() {
  setConnectionStatus("Loading", "status-muted");
  try {
    const [communities, farmers] = await Promise.all([
      selectRows(APP_CONFIG.tables.communities, "select=*&order=community_id.asc"),
      selectRows(APP_CONFIG.tables.farmers, "select=*&order=farmer_id.asc")
    ]);
    state.communities = communities;
    state.farmers = farmers;
    renderCommunities();
    renderFarmers();
    setConnectionStatus(dataModeLabel(), dataModeLabel() === "Preview" ? "status-muted" : "");
  } catch (error) {
    setConnectionStatus("Error", "status-muted");
    renderError(error);
  }
}

function renderFarmers() {
  els.farmerCount.textContent = `${state.farmers.length} rows`;
  els.farmerRegistryRows.innerHTML = state.farmers.map((farmer) => {
    const community = communityById(farmer.community_id);
    return `<tr>
      <td><strong>${escapeHtml(farmer.farmer_id)}</strong></td>
      <td>${escapeHtml(farmer.name)}</td>
      <td>${escapeHtml(farmer.phone || "-")}</td>
      <td>${escapeHtml(community?.community_name || farmer.community_id || "-")}</td>
    </tr>`;
  }).join("") || emptyRow(4, "No farmers found.");
}

function renderCommunities() {
  els.communityCount.textContent = `${state.communities.length} rows`;
  els.communityRegistryRows.innerHTML = state.communities.map((community) => {
    return `<tr>
      <td><strong>${escapeHtml(community.community_id)}</strong></td>
      <td>${escapeHtml(community.community_name)}</td>
      <td>${escapeHtml(locationLabel(community))}</td>
      <td>${escapeHtml(community.chair_person || "-")}</td>
      <td>${escapeHtml(community.chair_person_contact || "-")}</td>
    </tr>`;
  }).join("") || emptyRow(5, "No communities found.");
}

function renderError(error) {
  els.farmerRegistryRows.innerHTML = emptyRow(4, error.message);
  els.communityRegistryRows.innerHTML = emptyRow(5, error.message);
}

function communityById(communityId) {
  return state.communities.find((community) => community.community_id === communityId) || null;
}

function locationLabel(community) {
  if (community.gps_latitude === null || community.gps_latitude === undefined) return "-";
  if (community.gps_longitude === null || community.gps_longitude === undefined) return "-";
  return `${Number(community.gps_latitude).toFixed(5)}, ${Number(community.gps_longitude).toFixed(5)}`;
}

function setConnectionStatus(text, extraClass = "") {
  els.registryConnectionStatus.textContent = text;
  els.registryConnectionStatus.className = `status-pill ${extraClass}`.trim();
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="muted-cell">${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

