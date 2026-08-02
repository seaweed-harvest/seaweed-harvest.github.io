import {
  authClient,
  currentProfile,
  requireAuthenticatedAccount,
  routeForProfile,
  setupAccountControls
} from "./auth_client.js?v=22";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=14";

const els = {};
let profile = null;
let subscriptionState = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reportSubscriptionsSidebar",
    "reportSubscriptionsForm",
    "reportSubscriptionsEmail",
    "reportSubscriptionsCount",
    "reportSubscriptionOrganisations",
    "saveReportSubscriptions",
    "stopAllReportSubscriptions",
    "reportSubscriptionsStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  try {
    const access = await requireAuthenticatedAccount("report_subscriptions.html");
    if (!access) return;
    profile = access.profile || await currentProfile(true);
  } catch (error) {
    window.location.replace(`./login.html?return=report_subscriptions.html&error=${encodeURIComponent(error.message)}`);
    return;
  }

  document.body.removeAttribute("data-auth-pending");
  setupAccountControls(profile, {
    container: document.querySelector(".report-subscriptions-header-controls"),
    returnPage: "report_subscriptions.html"
  });
  const dashboardHref = routeForProfile(profile);
  const sidebar = populateAppSidebar(els.reportSubscriptionsSidebar, { profile, dashboardHref });
  setupAppNavigation({ profile, dashboardHref, sidebar });
  els.reportSubscriptionsForm.addEventListener("submit", saveSubscriptions);
  els.stopAllReportSubscriptions.addEventListener("click", stopAllReports);
  els.reportSubscriptionOrganisations.addEventListener("change", updateEnabledCount);
  await loadSubscriptions();
}

async function loadSubscriptions() {
  setStatus("Loading...");
  try {
    const { data, error } = await authClient.rpc("ag_my_report_subscriptions");
    if (error) throw error;
    subscriptionState = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
    els.reportSubscriptionsEmail.textContent = data?.email
      ? `Reports will be sent to ${data.email}.`
      : "Add an email address to your account before enabling reports.";
    renderSubscriptions();
    setStatus("");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderSubscriptions() {
  if (!subscriptionState.length) {
    els.reportSubscriptionOrganisations.innerHTML = '<p class="empty-state">No active organisation memberships are available.</p>';
    els.saveReportSubscriptions.disabled = true;
    els.stopAllReportSubscriptions.disabled = true;
    updateEnabledCount();
    return;
  }

  els.reportSubscriptionOrganisations.innerHTML = subscriptionState.map((row) => `
    <fieldset class="report-subscription-organisation" data-aggregator-id="${escapeHtml(row.aggregator_id)}">
      <legend>${escapeHtml(row.short_name || row.organisation_name || row.aggregator_code)}</legend>
      <div class="report-subscription-options">
        ${reportOption("daily", "Daily", "08:00 next day (Kenya time)", row.daily)}
        ${reportOption("weekly", "Weekly", "08:00 Monday (Kenya time)", row.weekly)}
        ${reportOption("monthly", "Monthly", "08:00 after month end (Kenya time)", row.monthly)}
      </div>
    </fieldset>
  `).join("");
  updateEnabledCount();
}

function reportOption(key, label, schedule, checked) {
  return `<label class="report-subscription-option">
    <input type="checkbox" data-report-type="${key}"${checked ? " checked" : ""}>
    <span><strong>${label}</strong><small>${schedule}</small></span>
  </label>`;
}

async function saveSubscriptions(event) {
  event?.preventDefault();
  await persistSubscriptions("Subscriptions saved.");
}

async function stopAllReports() {
  const enabled = els.reportSubscriptionOrganisations.querySelectorAll('input[type="checkbox"]:checked');
  if (!enabled.length) {
    setStatus("All reports are already stopped.");
    return;
  }
  if (!window.confirm("Stop all daily, weekly and monthly email reports?")) return;
  enabled.forEach((input) => { input.checked = false; });
  updateEnabledCount();
  await persistSubscriptions("All report emails stopped.");
}

async function persistSubscriptions(successMessage) {
  const payload = [...els.reportSubscriptionOrganisations.querySelectorAll("[data-aggregator-id]")]
    .map((group) => ({
      aggregator_id: group.dataset.aggregatorId,
      daily: group.querySelector('[data-report-type="daily"]').checked,
      weekly: group.querySelector('[data-report-type="weekly"]').checked,
      monthly: group.querySelector('[data-report-type="monthly"]').checked
    }));
  els.saveReportSubscriptions.disabled = true;
  els.stopAllReportSubscriptions.disabled = true;
  setStatus("Saving...");
  try {
    const { data, error } = await authClient.rpc("ag_save_my_report_subscriptions", {
      p_subscriptions: payload
    });
    if (error) throw error;
    subscriptionState = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
    renderSubscriptions();
    setStatus(successMessage);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.saveReportSubscriptions.disabled = !subscriptionState.length;
    els.stopAllReportSubscriptions.disabled = !subscriptionState.length;
  }
}

function updateEnabledCount() {
  const count = els.reportSubscriptionOrganisations.querySelectorAll('input[type="checkbox"]:checked').length;
  els.reportSubscriptionsCount.textContent = `${count} enabled`;
}

function setStatus(message, type = "") {
  els.reportSubscriptionsStatus.textContent = message || "";
  els.reportSubscriptionsStatus.dataset.status = type;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
