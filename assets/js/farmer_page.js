import { authClient, currentProfile, currentSession, setupAccountControls } from "./auth_client.js";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const status = document.getElementById("farmerAccountStatus");
  const session = await currentSession();
  if (!session) {
    window.location.replace("./login.html?return=farmer.html");
    return;
  }

  try {
    const profile = await currentProfile(true);
    if (profile?.account_status !== "active" || profile.app_role !== "farmer_viewer") {
      window.location.replace(profile?.can_access_admin ? "./admin.html" : "./access_pending.html");
      return;
    }
    setupAccountControls(profile, {
      container: document.querySelector(".farmer-header-controls"),
      returnPage: "farmer.html"
    });

    const [summaryResponse, collectionsResponse] = await Promise.all([
      authClient.rpc("ag_my_farmer_summary"),
      authClient.rpc("ag_my_farmer_collections", { p_limit: 100 })
    ]);
    if (summaryResponse.error) throw summaryResponse.error;
    if (collectionsResponse.error) throw collectionsResponse.error;
    renderSummary(summaryResponse.data || {});
    renderCollections(collectionsResponse.data || []);
    status.textContent = `${(collectionsResponse.data || []).length} recent rows`;
  } catch (error) {
    status.textContent = error.message;
    status.dataset.status = "error";
  }
}

function renderSummary(summary) {
  const farmer = summary.profile || {};
  setText("farmerAccountName", farmer.name || "Farmer Account");
  setText("farmerAccountId", farmer.farmer_id || "No farmer ID");
  setText("farmerAccountCommunity", [farmer.community_id, farmer.community_name].filter(Boolean).join(" - ") || "-");
  setText("farmerAccountFarmSize", formatFarmSize(farmer));
  setText("farmerAccountTotalKg", formatNumber(summary.total_kg));
  setText("farmerAccountEstimatedKsh", formatNumber(summary.estimated_ksh));
  setText("farmerAccountCollectionCount", formatNumber(summary.collection_count, 0));
  setText("farmerAccountLastCollection", formatDate(summary.last_collection_at));
}

function renderCollections(rows) {
  const body = document.getElementById("farmerCollectionRows");
  body.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.collected_at))}</td>
      <td>${escapeHtml(row.transaction_id || "-")}</td>
      <td>${escapeHtml(row.sack_id || "-")}</td>
      <td>${escapeHtml(formatNumber(row.sack_weight_kg))}</td>
      <td>${escapeHtml(row.seaweed_type || "-")}</td>
      <td>${escapeHtml(row.seaweed_grade || "-")}</td>
      <td>${escapeHtml(formatNumber(row.price_per_kg))}</td>
      <td>${escapeHtml(formatNumber(row.total_price))}</td>
    </tr>
  `).join("") : '<tr><td colspan="8">No collection records yet.</td></tr>';
}

function formatFarmSize(farmer) {
  if (farmer.farm_size_value === null || farmer.farm_size_value === undefined) return "-";
  return `${formatNumber(farmer.farm_size_value)} ${farmer.farm_size_unit || "lines"}`;
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
