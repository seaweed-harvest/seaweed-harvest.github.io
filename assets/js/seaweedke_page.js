import { authClient, currentProfile, requireAdminAccess } from "./auth_client.js";

const state = { profile: null, config: null, environment: null, clients: [], aggregators: [] };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reloadSeaweedke", "smsMode", "smsEnabled", "smsProvider", "smsSender", "smsCallback",
    "smsProductionReady", "smsReadinessStatus", "smsTestEstimate", "smsTestForm", "smsTestPhone",
    "smsTestScenario", "smsTestMessage", "previewSmsTest", "smsTestStatus", "saveSmsSettings",
    "checkSmsBalance", "smsLocalMode", "smsEstimatedCost", "smsMaxSegments", "smsMaxAttempts",
    "smsRetrySeconds", "smsWorkerBatch", "smsManualBalance", "smsLowBalance", "smsBalanceNote",
    "smsSettingsStatus", "smsClientsPanel", "saveSmsClient", "smsClientSelect", "smsClientCode",
    "smsClientName", "smsClientSource", "smsClientActive", "smsClientApproval", "smsClientAggregators",
    "smsClientEvents", "smsClientNotes", "rotateSmsClientToken", "smsClientTokenField",
    "smsClientToken", "smsClientStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  const access = await requireAdminAccess("can_manage_notifications");
  if (!access) return;
  state.profile = access.profile || await currentProfile(true);
  bindEvents();
  await loadAll();
}

function bindEvents() {
  els.reloadSeaweedke.addEventListener("click", loadAll);
  els.previewSmsTest.addEventListener("click", previewMessage);
  els.smsTestMessage.addEventListener("input", debounce(previewMessage, 200));
  els.smsTestForm.addEventListener("submit", runTest);
  els.saveSmsSettings.addEventListener("click", saveSettings);
  els.checkSmsBalance?.addEventListener("click", checkBalance);
  els.smsClientSelect.addEventListener("change", renderSelectedClient);
  els.saveSmsClient.addEventListener("click", () => saveClient(false));
  els.rotateSmsClientToken.addEventListener("click", () => saveClient(true));
}

async function loadAll() {
  setText(els.smsReadinessStatus, "Loading...");
  try {
    const data = await invokeAdmin({ action: "configuration" });
    state.config = data.config;
    state.environment = data.environment;
    renderConfiguration();
    if (state.profile.app_role === "system_admin") await loadClients();
    await previewMessage();
  } catch (error) { setText(els.smsReadinessStatus, error.message, "error"); }
}

function renderConfiguration() {
  const config = state.config || {};
  const environment = state.environment || {};
  els.smsMode.textContent = title(environment.mode || config.operating_mode);
  els.smsEnabled.textContent = environment.enabled ? "Enabled" : "Disabled";
  els.smsProvider.textContent = title(environment.provider || config.provider_name);
  els.smsSender.textContent = config.sender_id || "SEAWEEDKE";
  els.smsCallback.textContent = environment.callback_enabled ? "Enabled" : "Disabled";
  els.smsProductionReady.textContent = environment.production_ready ? "Ready" : "Not ready";
  els.smsLocalMode.value = ["disabled", "fake"].includes(config.operating_mode) ? config.operating_mode : "disabled";
  els.smsEstimatedCost.value = config.estimated_cost_per_segment_kes ?? "";
  els.smsMaxSegments.value = config.maximum_segments ?? "";
  els.smsMaxAttempts.value = config.maximum_attempts ?? "";
  els.smsRetrySeconds.value = config.retry_base_seconds ?? "";
  els.smsWorkerBatch.value = config.worker_batch_size ?? "";
  els.smsManualBalance.value = config.manual_balance_kes ?? "";
  els.smsLowBalance.value = config.low_balance_threshold_kes ?? "";
  els.smsBalanceNote.value = config.balance_check_note ?? "";
  const canSave = state.profile.app_role === "system_admin" || state.profile.can_manage_settings;
  els.saveSmsSettings.hidden = !canSave;
  document.querySelectorAll(".seaweedke-settings-grid input, .seaweedke-settings-grid select").forEach((control) => { control.disabled = !canSave; });
  const issues = environment.production_issues || [];
  setText(els.smsReadinessStatus, issues.length ? issues.join(" | ") : "Production checks complete.", issues.length ? "" : "ready");
}

async function previewMessage() {
  const message = els.smsTestMessage.value.trim();
  if (!message || !state.config) { els.smsTestEstimate.textContent = "0 segments"; return; }
  const { data, error } = await authClient.rpc("seaweedke_estimate_sms", {
    p_message: message,
    p_cost_per_segment_kes: Number(state.config.estimated_cost_per_segment_kes || 0),
    p_maximum_segments: Number(state.config.maximum_segments || 2)
  });
  if (error) { setText(els.smsTestStatus, error.message, "error"); return; }
  els.smsTestEstimate.textContent = `${data.segments} segment${Number(data.segments) === 1 ? "" : "s"} / KES ${money(data.estimated_cost_kes)}`;
  setText(els.smsTestStatus, data.over_limit ? "Message exceeds the configured segment limit." : `${title(data.encoding)} / ${data.units} units`, data.over_limit ? "error" : "");
}

async function runTest(event) {
  event.preventDefault();
  setText(els.smsTestStatus, "Queueing test...");
  try {
    const { data: queued, error: queueError } = await authClient.rpc("seaweedke_admin_test_message", {
      p_payload: {
        recipient_phone: els.smsTestPhone.value,
        message_body: els.smsTestMessage.value.trim(),
        fake_scenario: els.smsTestScenario.value
      }
    });
    if (queueError) throw queueError;
    const { data: worker, error: workerError } = await authClient.functions.invoke("seaweedke-worker", {
      body: { force_fake: true, limit: 1 }
    });
    if (workerError) throw workerError;
    const outcome = worker.results?.find((row) => row.id === queued.id) || worker.results?.[0];
    setText(els.smsTestStatus, `Test ${outcome?.status || queued.status}. Request ${queued.id}.`);
  } catch (error) { setText(els.smsTestStatus, error.message || "Test failed.", "error"); }
}

async function saveSettings() {
  setText(els.smsSettingsStatus, "Saving...");
  try {
    const data = await invokeAdmin({
      action: "save_configuration",
      config: {
        operating_mode: els.smsLocalMode.value,
        estimated_cost_per_segment_kes: nullable(els.smsEstimatedCost.value),
        maximum_segments: nullable(els.smsMaxSegments.value),
        maximum_attempts: nullable(els.smsMaxAttempts.value),
        retry_base_seconds: nullable(els.smsRetrySeconds.value),
        worker_batch_size: nullable(els.smsWorkerBatch.value),
        manual_balance_kes: nullable(els.smsManualBalance.value),
        low_balance_threshold_kes: nullable(els.smsLowBalance.value),
        balance_check_note: nullable(els.smsBalanceNote.value)
      }
    });
    state.config = data.config;
    state.environment = data.environment;
    renderConfiguration();
    setText(els.smsSettingsStatus, "Settings saved. Live sending remains controlled by server secrets.");
  } catch (error) { setText(els.smsSettingsStatus, error.message, "error"); }
}

async function checkBalance() {
  setText(els.smsSettingsStatus, "Checking balance...");
  try {
    const data = await invokeAdmin({ action: "provider_balance" });
    els.smsManualBalance.value = data.balance.currency === "KES" ? data.balance.amount : "";
    els.smsBalanceNote.value = `Provider API balance: ${data.balance.rawLabel}`;
    setText(els.smsSettingsStatus, `${data.balance.currency} ${money(data.balance.amount)}`);
  } catch (error) { setText(els.smsSettingsStatus, error.message, "error"); }
}

async function loadClients() {
  const [clientData, aggregatorResponse] = await Promise.all([
    invokeAdmin({ action: "application_clients" }),
    authClient.rpc("ag_admin_user_aggregator_options")
  ]);
  if (aggregatorResponse.error) throw aggregatorResponse.error;
  state.clients = clientData.clients || [];
  state.aggregators = aggregatorResponse.data || [];
  els.smsClientsPanel.hidden = false;
  els.smsClientSelect.innerHTML = '<option value="">New client</option>' + state.clients.map((client) => `<option value="${client.id}">${html(client.client_name)}</option>`).join("");
  renderSelectedClient();
}

function renderSelectedClient() {
  const client = state.clients.find((row) => row.id === els.smsClientSelect.value) || {};
  els.smsClientCode.value = client.client_code || "";
  els.smsClientName.value = client.client_name || "";
  els.smsClientSource.value = client.source_app || "";
  els.smsClientActive.checked = Boolean(client.is_active);
  els.smsClientApproval.checked = client.require_manual_approval !== false;
  els.smsClientEvents.value = (client.allowed_event_types || []).join(", ");
  els.smsClientNotes.value = client.notes || "";
  const selected = new Set(client.aggregator_ids || []);
  els.smsClientAggregators.innerHTML = state.aggregators.map((aggregator) => `<label class="permission-option"><input type="checkbox" value="${aggregator.id}" ${selected.has(aggregator.id) ? "checked" : ""}> ${html(aggregator.short_name || aggregator.organisation_name)}</label>`).join("");
  els.smsClientTokenField.hidden = true;
  els.smsClientToken.value = "";
  setText(els.smsClientStatus, client.id ? `${client.credential_configured ? "Credential configured" : "No credential"}${client.last_used_at ? ` / last used ${dateTime(client.last_used_at)}` : ""}` : "");
}

async function saveClient(rotateToken) {
  if (rotateToken && !window.confirm("Rotate this application client token? The previous token will stop working.")) return;
  setText(els.smsClientStatus, rotateToken ? "Rotating token..." : "Saving client...");
  const client = {
    id: nullable(els.smsClientSelect.value),
    client_code: els.smsClientCode.value.trim().toUpperCase(),
    client_name: els.smsClientName.value.trim(),
    source_app: els.smsClientSource.value.trim().toLowerCase(),
    is_active: els.smsClientActive.checked,
    require_manual_approval: els.smsClientApproval.checked,
    allowed_event_types: els.smsClientEvents.value.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
    aggregator_ids: [...els.smsClientAggregators.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value),
    notes: nullable(els.smsClientNotes.value)
  };
  try {
    const result = await invokeAdmin({ action: rotateToken ? "rotate_application_token" : "save_application_client", client });
    if (result.token) {
      els.smsClientToken.value = result.token;
      els.smsClientTokenField.hidden = false;
    }
    setText(els.smsClientStatus, rotateToken ? "Token rotated. Store the displayed token in server-side secrets." : "Client saved.");
    if (!result.token) await loadClients();
  } catch (error) { setText(els.smsClientStatus, error.message, "error"); }
}

async function invokeAdmin(body) {
  const { data, error } = await authClient.functions.invoke("seaweedke-admin", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
function nullable(value) { return String(value ?? "").trim() || null; }
function money(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function title(value) { return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function dateTime(value) { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function setText(element, message, type = "") { if (!element) return; element.textContent = message || ""; element.dataset.status = type; }
function html(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
