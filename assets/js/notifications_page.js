import { authClient, currentProfile, requireAdminAccess } from "./auth_client.js";

const state = { profile: null, offset: 0, limit: 50, total: 0, rows: [] };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "notificationCount", "notificationFrom", "notificationTo", "notificationStatus",
    "notificationSource", "notificationCategory", "notificationSearch", "loadNotifications",
    "notificationMetricMessages", "notificationMetricSegments", "notificationMetricCost",
    "notificationMetricDelivered", "notificationMetricFailed", "notificationMetricSuppressed",
    "notificationRows", "notificationPrevious", "notificationNext", "notificationPageStatus",
    "notificationStatusText", "notificationDetailPanel", "notificationDetail", "closeNotificationDetail"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  const access = await requireAdminAccess("can_view_notifications");
  if (!access) return;
  state.profile = access.profile || await currentProfile(true);
  const end = new Date();
  const start = new Date(end); start.setDate(start.getDate() - 29);
  els.notificationFrom.value = inputDate(start);
  els.notificationTo.value = inputDate(end);
  bindEvents();
  await loadPage(true);
}

function bindEvents() {
  els.loadNotifications.addEventListener("click", () => loadPage(true));
  els.notificationSearch.addEventListener("keydown", (event) => { if (event.key === "Enter") loadPage(true); });
  els.notificationPrevious.addEventListener("click", () => { state.offset = Math.max(0, state.offset - state.limit); loadPage(false); });
  els.notificationNext.addEventListener("click", () => { state.offset += state.limit; loadPage(false); });
  els.closeNotificationDetail.addEventListener("click", () => { els.notificationDetailPanel.hidden = true; });
  els.notificationRows.addEventListener("click", handleRowAction);
}

async function loadPage(resetOffset) {
  if (resetOffset) state.offset = 0;
  setStatus("Loading...");
  const filters = {
    from: startIso(els.notificationFrom.value),
    to: endIso(els.notificationTo.value),
    status: nullable(els.notificationStatus.value),
    source_app: nullable(els.notificationSource.value),
    message_category: nullable(els.notificationCategory.value),
    search: nullable(els.notificationSearch.value),
    limit: state.limit,
    offset: state.offset
  };
  const [list, usage] = await Promise.all([
    rpc("seaweedke_admin_notifications", { p_filters: filters }),
    rpc("seaweedke_admin_usage_summary", { p_filters: { from: filters.from, to: filters.to } })
  ]).catch((error) => {
    setStatus(error.message, "error");
    return [null, null];
  });
  if (!list) return;
  state.rows = list.rows || [];
  state.total = Number(list.total || 0);
  renderRows();
  renderUsage(usage?.summary || {});
  updatePager();
  setStatus(`${state.rows.length} rows loaded. Costs are estimates.`);
}

function renderRows() {
  const canManage = state.profile.app_role === "system_admin" || state.profile.can_manage_notifications;
  els.notificationRows.innerHTML = state.rows.map((row) => {
    const actions = [`<button type="button" data-view-notification="${row.id}">View</button>`];
    if (canManage && row.status === "failed") actions.push(`<button type="button" data-retry-notification="${row.id}">Retry</button>`);
    if (canManage && ["draft", "queued"].includes(row.status)) actions.push(`<button type="button" data-cancel-notification="${row.id}">Cancel</button>`);
    return `<tr>
      <td>${html(dateTime(row.created_at))}</td>
      <td>${html(title(row.source_app))}</td>
      <td>${html(row.aggregator_code || row.aggregator_name || "Platform")}</td>
      <td>${html(title(row.message_category))}</td>
      <td>${html(row.recipient_name || row.recipient_type)}</td>
      <td>${html(row.recipient_phone || "-")}</td>
      <td class="notification-message-cell">${html(row.message_body)}</td>
      <td><span class="status-pill status-${statusTone(row.status)}">${html(title(row.status))}</span></td>
      <td>${number(row.attempt_count)}/${number(row.max_attempts)}</td>
      <td>${number(row.estimated_segments)}</td>
      <td>${money(row.estimated_cost_kes)}</td>
      <td>${html(row.provider_status || "-")}</td>
      <td>${html(shortText(row.last_error, 120) || "-")}</td>
      <td><div class="row-actions">${actions.join("")}</div></td>
    </tr>`;
  }).join("") || '<tr><td colspan="14">No notifications in this period.</td></tr>';
}

function renderUsage(summary) {
  els.notificationMetricMessages.textContent = number(summary.messages);
  els.notificationMetricSegments.textContent = number(summary.segments);
  els.notificationMetricCost.textContent = money(summary.estimated_cost_kes);
  els.notificationMetricDelivered.textContent = number(summary.delivered);
  els.notificationMetricFailed.textContent = number(summary.failed);
  els.notificationMetricSuppressed.textContent = number(summary.suppressed);
}

function updatePager() {
  const first = state.total ? state.offset + 1 : 0;
  const last = Math.min(state.offset + state.rows.length, state.total);
  els.notificationCount.textContent = `${state.total} rows`;
  els.notificationPageStatus.textContent = `${first}-${last} of ${state.total}`;
  els.notificationPrevious.disabled = state.offset === 0;
  els.notificationNext.disabled = state.offset + state.rows.length >= state.total;
}

async function handleRowAction(event) {
  const view = event.target.closest("[data-view-notification]");
  const retry = event.target.closest("[data-retry-notification]");
  const cancel = event.target.closest("[data-cancel-notification]");
  if (view) return showDetail(view.dataset.viewNotification);
  if (retry) {
    const reason = window.prompt("Reason for retry:");
    if (!reason?.trim()) return;
    await mutate("seaweedke_admin_retry", { p_request_id: retry.dataset.retryNotification, p_reason: reason.trim() }, "Retry queued.");
  }
  if (cancel) {
    const reason = window.prompt("Reason for cancellation:");
    if (!reason?.trim()) return;
    await mutate("seaweedke_admin_cancel", { p_request_id: cancel.dataset.cancelNotification, p_reason: reason.trim() }, "Notification cancelled.");
  }
}

async function showDetail(id) {
  setStatus("Loading notification detail...");
  try {
    const data = await rpc("seaweedke_admin_notification_detail", { p_request_id: id });
    const request = data.request || {};
    els.notificationDetail.innerHTML = `
      <dl class="notification-detail-grid">
        <div><dt>Status</dt><dd>${html(title(request.status))}</dd></div>
        <div><dt>Source</dt><dd>${html(title(request.source_app))}</dd></div>
        <div><dt>Category</dt><dd>${html(title(request.message_category))}</dd></div>
        <div><dt>Phone</dt><dd>${html(request.recipient_phone || "-")}</dd></div>
        <div><dt>Provider ID</dt><dd>${html(request.provider_message_id || "-")}</dd></div>
        <div><dt>Estimate</dt><dd>${number(request.estimated_segments)} segments / KES ${money(request.estimated_cost_kes)}</dd></div>
        <div class="wide"><dt>Message</dt><dd>${html(request.message_body)}</dd></div>
      </dl>
      <h3>Attempts</h3>
      <div class="responsive-table-wrap compact-data-table-wrap"><table class="management-table admin-data-table"><thead><tr><th>Attempt</th><th>Requested</th><th>Outcome</th><th>Provider status</th><th>Error</th></tr></thead><tbody>${(data.attempts || []).map((attempt) => `<tr><td>${number(attempt.attempt_number)}</td><td>${html(dateTime(attempt.requested_at))}</td><td>${html(title(attempt.outcome))}</td><td>${html(attempt.provider_status || "-")}</td><td>${html(attempt.error_message || "-")}</td></tr>`).join("") || '<tr><td colspan="5">No delivery attempts.</td></tr>'}</tbody></table></div>`;
    els.notificationDetailPanel.hidden = false;
    els.notificationDetailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("");
  } catch (error) { setStatus(error.message, "error"); }
}

async function mutate(name, payload, successMessage) {
  setStatus("Saving...");
  try { await rpc(name, payload); await loadPage(false); setStatus(successMessage); }
  catch (error) { setStatus(error.message, "error"); }
}

async function rpc(name, payload = {}) {
  const { data, error } = await authClient.rpc(name, payload);
  if (error) throw error;
  return data;
}

function inputDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function startIso(value) { return value ? new Date(`${value}T00:00:00+03:00`).toISOString() : null; }
function endIso(value) { if (!value) return null; const date = new Date(`${value}T00:00:00+03:00`); date.setDate(date.getDate() + 1); return date.toISOString(); }
function nullable(value) { return String(value || "").trim() || null; }
function number(value) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function money(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dateTime(value) { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function statusTone(value) { return value === "delivered" ? "linked" : value === "failed" ? "warning" : ["cancelled", "suppressed"].includes(value) ? "muted" : "ready"; }
function shortText(value, limit) { const text = String(value || ""); return text.length > limit ? `${text.slice(0, limit)}...` : text; }
function setStatus(message, type = "") { els.notificationStatusText.textContent = message || ""; els.notificationStatusText.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
