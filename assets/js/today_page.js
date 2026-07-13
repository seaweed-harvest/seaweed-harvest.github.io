import { callPublicRpc } from "./supabase_client.js";
import { currentProfile, currentSession, setupAccountControls } from "./auth_client.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "todayAdminLink",
    "todaySignInLink",
    "todayConnectionStatus",
    "todayIntakeDate",
    "publicTodayCount",
    "reloadPublicToday",
    "publicTodayRows",
    "publicTodayStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  els.todayIntakeDate.textContent = new Intl.DateTimeFormat("en-KE", {
    dateStyle: "long",
    timeZone: "Africa/Nairobi"
  }).format(new Date());
  els.reloadPublicToday.addEventListener("click", loadToday);

  await setupOptionalAccount();
  await loadToday();
}

async function setupOptionalAccount() {
  try {
    const session = await currentSession();
    if (!session) return;
    const profile = await currentProfile(true);
    if (!profile) return;

    els.todaySignInLink.hidden = true;
    els.todayAdminLink.hidden = !(profile.account_status === "active"
      && (profile.app_role === "system_admin" || profile.can_access_admin));
    setupAccountControls(profile, {
      returnPage: "today.html",
      signOutReturn: "./today.html",
      showAggregator: false
    });
  } catch {
    // Today's Intake remains public when an old or invalid session is stored.
  }
}

async function loadToday() {
  els.reloadPublicToday.disabled = true;
  setStatus("Loading...");
  try {
    const rows = await callPublicRpc("ag_public_mawimbi_today_intake");
    renderRows(Array.isArray(rows) ? rows : []);
    els.todayConnectionStatus.textContent = "Live";
    els.todayConnectionStatus.className = "status-pill";
    setStatus("Loaded.");
  } catch (error) {
    renderRows([]);
    els.todayConnectionStatus.textContent = "Error";
    els.todayConnectionStatus.className = "status-pill status-muted";
    setStatus(error.message, "error");
  } finally {
    els.reloadPublicToday.disabled = false;
  }
}

function renderRows(rows) {
  els.publicTodayCount.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    els.publicTodayRows.innerHTML = '<tr><td colspan="9" class="empty-state">No Mawimbi intake has been recorded today.</td></tr>';
    return;
  }

  els.publicTodayRows.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(formatTime(row.collected_at))}</td>
      <td><strong>${escapeHtml(row.transaction_id || "-")}</strong></td>
      <td>${escapeHtml(joinValues(row.community_id, row.community_name_snapshot))}</td>
      <td>${escapeHtml(row.farmer_id || "-")}</td>
      <td>${escapeHtml(row.sack_id || "-")}</td>
      <td>${escapeHtml(formatNumber(row.sack_weight_kg))}</td>
      <td>${escapeHtml(titleCase(row.seaweed_type))}</td>
      <td>${escapeHtml(row.seaweed_grade || "-")}</td>
      <td>${escapeHtml(row.recorded_by_name || "-")}</td>
    </tr>
  `).join("");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-KE", { maximumFractionDigits: 2 }) : "-";
}

function joinValues(...values) {
  return values.filter(Boolean).join(" - ") || "-";
}

function titleCase(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "-";
}

function setStatus(message, type = "") {
  els.publicTodayStatus.textContent = message || "";
  els.publicTodayStatus.dataset.status = type;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
