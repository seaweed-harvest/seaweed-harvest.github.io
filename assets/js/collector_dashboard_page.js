import { authClient, requireAuthenticatedAccount, setupAccountControls } from "./auth_client.js";
import { applyDashboardPreferences } from "./dashboard_preferences.js";
import { renderFavoriteForms } from "./favorite_forms.js";
import { setupAppNavigation } from "./app_navigation.js?v=7";

const els = {};
let profile = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reloadCollectorDashboard", "collectorTodayCount", "collectorTodayKg",
    "collectorMonthCount", "collectorMonthKg", "collectorAllTimeCount",
    "collectorAllTimeKg", "collectorLastCollection", "collectorDashboardStatus",
    "collectorRecentRows", "collectorCollectionLink", "collectorAdminLink"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  try {
    const access = await requireAuthenticatedAccount("collector_dashboard.html");
    if (!access) return;
    profile = access.profile;
    const allowed = profile.account_status === "active"
      && (profile.app_role === "field_collector" || profile.can_submit_collection || profile.app_role === "system_admin");
    if (!allowed) {
      window.location.replace("./access_pending.html");
      return;
    }
    document.body.removeAttribute("data-auth-pending");
    setupAccountControls(profile, {
      container: document.querySelector(".collector-header-controls"),
      returnPage: "collector_dashboard.html"
    });
    setupAppNavigation({ profile });
    renderFavoriteForms(document.getElementById("collectorFavoriteForms"), profile);
    els.collectorCollectionLink.hidden = !profile.can_submit_collection && profile.app_role !== "system_admin";
    els.collectorAdminLink.hidden = !profile.can_access_admin && profile.app_role !== "system_admin";
    applyDashboardPreferences(profile);
    els.reloadCollectorDashboard.addEventListener("click", loadDashboard);
    await loadDashboard();
  } catch (error) {
    window.location.replace(`./login.html?return=collector_dashboard.html&error=${encodeURIComponent(error.message)}`);
  }
}

async function loadDashboard() {
  els.reloadCollectorDashboard.disabled = true;
  setStatus("Loading");
  try {
    const { data, error } = await authClient.rpc("ag_my_collector_dashboard");
    if (error) throw error;
    renderSummary(data || {});
    renderRecent(data?.recent_records || []);
    setStatus(`${(data?.recent_records || []).length} recent rows`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.reloadCollectorDashboard.disabled = false;
  }
}

function renderSummary(summary) {
  setText("collectorTodayCount", formatInteger(summary.today_count));
  setText("collectorTodayKg", `${formatNumber(summary.today_kg)} kg`);
  setText("collectorMonthCount", formatInteger(summary.month_count));
  setText("collectorMonthKg", `${formatNumber(summary.month_kg)} kg`);
  setText("collectorAllTimeCount", formatInteger(summary.all_time_count));
  setText("collectorAllTimeKg", `${formatNumber(summary.all_time_kg)} kg`);
  setText("collectorLastCollection", formatDate(summary.last_collection_at));
}

function renderRecent(rows) {
  els.collectorRecentRows.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.collected_at))}</td>
      <td>${escapeHtml([row.farmer_id, row.farmer_name].filter(Boolean).join(" - ") || "-")}</td>
      <td>${escapeHtml([row.community_id, row.community_name].filter(Boolean).join(" - ") || "-")}</td>
      <td>${escapeHtml(formatNumber(row.weight_kg))}</td>
      <td>${escapeHtml(row.seaweed_type || "-")}</td>
      <td>${escapeHtml(row.grade || "Ungraded")}</td>
      <td>${escapeHtml(formatNumber(row.total_ksh))}</td>
      <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
    </tr>
  `).join("") : '<tr><td colspan="8">No collection records yet.</td></tr>';
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: digits }) : "0";
}

function formatInteger(value) {
  return formatNumber(value, 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function setStatus(message, type = "") {
  els.collectorDashboardStatus.textContent = message;
  els.collectorDashboardStatus.dataset.status = type;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
