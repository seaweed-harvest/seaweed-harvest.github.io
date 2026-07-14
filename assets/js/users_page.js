import { APP_CONFIG } from "./config.js";
import { authClient, currentProfile, invokeAdminUsers, requireAdminAccess } from "./auth_client.js";
import { selectRows } from "./supabase_client.js";

const permissionDefinitions = [
  ["can_access_admin", "Admin pages", "Open the administration area."],
  ["can_submit_collection", "Submit collections", "Record new seaweed collections."],
  ["can_view_dashboard", "Dashboard", "View summary totals and operational metrics."],
  ["can_view_registry", "View farmer registry", "Includes farmer names, phone numbers, addresses and dates of birth when recorded."],
  ["can_edit_registry", "Edit farmer registry", "Change or remove farmer and community records."],
  ["can_view_map", "Community map", "View community names and mapped coordinates."],
  ["can_view_data", "View collection data", "Includes collection history, collector details, locations and photo references."],
  ["can_edit_collections", "Edit collections", "Correct previously recorded collection data."],
  ["can_view_finance", "View financial data", "View prices, receipts and financial summaries."],
  ["can_manage_pricing", "Manage pricing", "Add, change or deactivate prices used for collection values and receipts."],
  ["can_export_data", "Export data", "Download data from the system for use outside it."],
  ["can_manage_settings", "Form builder settings", "Change collection fields, grades and seaweed types."],
  ["can_manage_users", "Invite and edit users", "View user emails and manage non-admin accounts."],
  ["can_manage_admin_users", "Add or edit admin users", "Grant or change administrator access, except the protected owner."],
  ["can_view_user_activity", "View recent activity", "View login and administrator action history. The page shows the newest 20 events."],
  ["can_view_notifications", "View notification content", "Includes recipient names, masked phone numbers, message text and delivery history."],
  ["can_manage_notifications", "Manage notification delivery", "Retry or cancel messages and perform notification operations that may incur costs."],
  ["can_manage_sms_settings", "Configure SMS settings", "Change SMS provider mode, cost limits, retries and balance settings."]
];

const permissionDependencies = [
  ["can_edit_registry", "can_view_registry"],
  ["can_edit_collections", "can_view_data"],
  ["can_manage_pricing", "can_view_finance"],
  ["can_manage_admin_users", "can_manage_users"],
  ["can_view_user_activity", "can_manage_users"],
  ["can_manage_notifications", "can_view_notifications"]
];

const roleLabels = {
  company_admin: "Company admin",
  registry_admin: "Registry admin",
  finance_admin: "Finance admin",
  field_collector: "Field collector",
  community_viewer: "Community viewer",
  farmer_viewer: "Farmer",
  read_only_auditor: "Read-only auditor",
  system_admin: "System admin"
};

const state = { users: [], registrations: [], communities: [], aggregators: [], activity: [], actor: null, editingUser: null };
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reloadUsers", "inviteUserForm", "inviteEmail", "inviteName", "inviteRole",
    "inviteCommunity", "inviteFarmerIdField", "inviteFarmerId", "inviteAggregators", "invitePermissions", "inviteStatus", "userDirectoryRows",
    "userEditorPanel", "closeUserEditor", "editUserForm", "editUserId", "editUserEmail",
    "editUserName", "editUserRole", "editUserStatus", "editUserCommunity", "editFarmerIdField", "editFarmerId", "editAggregators", "editPermissions",
    "editUserMessage", "deleteUser", "farmerRegistrationCount", "farmerRegistrationRows", "farmerRegistrationStatus",
    "userActivityPanel", "userActivityCount", "userActivityRows"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const access = await requireAdminAccess("can_manage_users");
  if (!access) return;
  state.actor = access.profile || await currentProfile(true);
  els.userActivityPanel.hidden = !canViewUserActivity();

  buildPermissionInputs(els.invitePermissions, "invite");
  buildPermissionInputs(els.editPermissions, "edit");
  buildEditRoleOptions();
  bindEvents();
  applyRolePreset("invite", els.inviteRole.value);
  configureFarmerRoleFields("invite");
  await loadPageData();
}

function bindEvents() {
  els.reloadUsers.addEventListener("click", loadPageData);
  els.inviteRole.addEventListener("change", () => {
    applyRolePreset("invite", els.inviteRole.value);
    configureFarmerRoleFields("invite");
  });
  els.editUserRole.addEventListener("change", () => {
    applyRolePreset("edit", els.editUserRole.value);
    configureFarmerRoleFields("edit");
    renderAggregatorInputs("edit", selectedAggregatorIds("edit"), els.editUserRole.value === "system_admin");
  });
  els.inviteUserForm.addEventListener("submit", inviteUser);
  els.editUserForm.addEventListener("submit", saveUser);
  els.deleteUser.addEventListener("click", deleteSelectedUser);
  els.closeUserEditor.addEventListener("click", () => {
    state.editingUser = null;
    els.userEditorPanel.hidden = true;
  });
  els.userDirectoryRows.addEventListener("click", handleUserTableClick);
  els.farmerRegistrationRows.addEventListener("click", handleRegistrationClick);
}

async function loadPageData() {
  setStatus(els.inviteStatus, "Loading...");
  try {
    const activityRequest = canViewUserActivity()
      ? authClient.rpc("ag_admin_activity_log", { p_limit: 20 })
      : Promise.resolve({ data: [], error: null });
    const [usersResponse, registrationsResponse, activityResponse, aggregatorResponse, communities] = await Promise.all([
      authClient.rpc("ag_admin_user_directory"),
      authClient.rpc("ag_admin_farmer_registration_requests"),
      activityRequest,
      authClient.rpc("ag_admin_user_aggregator_options"),
      selectRows(APP_CONFIG.tables.communities, "select=community_id,community_name&order=community_name.asc")
    ]);
    if (usersResponse.error) throw usersResponse.error;
    if (registrationsResponse.error) throw registrationsResponse.error;
    if (activityResponse.error) throw activityResponse.error;
    if (aggregatorResponse.error) throw aggregatorResponse.error;
    state.users = usersResponse.data || [];
    state.registrations = registrationsResponse.data || [];
    state.activity = activityResponse.data || [];
    state.aggregators = aggregatorResponse.data || [];
    state.communities = communities;
    renderCommunityOptions();
    renderAggregatorInputs("invite", defaultInviteAggregatorIds());
    renderUsers();
    renderRegistrations();
    renderActivity();
    setStatus(els.inviteStatus, "");
  } catch (error) {
    setStatus(els.inviteStatus, error.message, "error");
  }
}

function canViewUserActivity() {
  return state.actor?.app_role === "system_admin"
    || Boolean(state.actor?.can_manage_users && state.actor?.can_view_user_activity);
}

async function inviteUser(event) {
  event.preventDefault();
  const aggregatorIds = selectedAggregatorIds("invite");
  if (!aggregatorIds.length) {
    setStatus(els.inviteStatus, "Select at least one aggregator.", "error");
    return;
  }
  setStatus(els.inviteStatus, "Sending invite...");
  try {
    await invokeAdminUsers({
      action: "invite",
      email: els.inviteEmail.value.trim(),
      display_name: nullableText(els.inviteName.value),
      app_role: els.inviteRole.value,
      community_id: nullableText(els.inviteCommunity.value),
      farmer_id: nullableText(els.inviteFarmerId.value),
      aggregator_ids: aggregatorIds,
      permissions: readPermissions("invite")
    });
    els.inviteUserForm.reset();
    els.inviteRole.value = "company_admin";
    configureFarmerRoleFields("invite");
    applyRolePreset("invite", "company_admin");
    renderAggregatorInputs("invite", defaultInviteAggregatorIds());
    setStatus(els.inviteStatus, "Invite sent.");
    await loadPageData();
  } catch (error) {
    setStatus(els.inviteStatus, error.message, "error");
  }
}

async function saveUser(event) {
  event.preventDefault();
  const aggregatorIds = selectedAggregatorIds("edit");
  if (els.editUserRole.value !== "system_admin" && !aggregatorIds.length) {
    setStatus(els.editUserMessage, "Select at least one aggregator.", "error");
    return;
  }
  setStatus(els.editUserMessage, "Saving...");
  try {
    await invokeAdminUsers({
      action: "update",
      user_id: els.editUserId.value,
      display_name: nullableText(els.editUserName.value),
      app_role: els.editUserRole.value,
      account_status: els.editUserStatus.value,
      community_id: nullableText(els.editUserCommunity.value),
      farmer_id: nullableText(els.editFarmerId.value),
      aggregator_ids: aggregatorIds,
      permissions: readPermissions("edit")
    });
    setStatus(els.editUserMessage, "Saved.");
    state.editingUser = null;
    els.userEditorPanel.hidden = true;
    await loadPageData();
  } catch (error) {
    setStatus(els.editUserMessage, error.message, "error");
  }
}

async function deleteSelectedUser() {
  const user = state.users.find((row) => row.id === els.editUserId.value);
  if (!user || user.is_protected_owner) return;
  if (user.id === state.actor?.id) {
    setStatus(els.editUserMessage, "You cannot delete your own account.", "error");
    return;
  }

  const name = user.display_name || user.email;
  const confirmed = window.confirm(
    `Delete the account for ${name}?\n\nTheir sign-in access will be removed. Existing collections and farmer records will remain.`
  );
  if (!confirmed) return;

  els.deleteUser.disabled = true;
  setStatus(els.editUserMessage, "Deleting user...");
  try {
    await invokeAdminUsers({ action: "delete", user_id: user.id });
    state.editingUser = null;
    els.userEditorPanel.hidden = true;
    await loadPageData();
    setStatus(els.inviteStatus, `${name} was deleted.`);
  } catch (error) {
    setStatus(els.editUserMessage, error.message, "error");
  } finally {
    els.deleteUser.disabled = false;
  }
}

function renderUsers() {
  els.userDirectoryRows.innerHTML = state.users.length ? state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.email)}</td>
      <td>${user.display_name
        ? escapeHtml(user.display_name)
        : '<span class="user-name-warning" title="This user must add a name">Name required</span>'}</td>
      <td>${escapeHtml(roleLabels[user.app_role] || user.app_role)}</td>
      <td>${escapeHtml(formatAggregatorAccess(user))}</td>
      <td>${escapeHtml(capitalize(user.account_status))}</td>
      <td>${escapeHtml(user.community_id || "All")}</td>
      <td>${escapeHtml(formatDate(user.last_sign_in_at))}</td>
      <td>${user.can_manage_users ? "Yes" : "No"}</td>
      <td>${user.can_manage_admin_users ? "Yes" : "No"}</td>
      <td>${user.is_protected_owner
        ? '<span class="protected-owner-label" title="This owner account cannot be edited or removed">Protected owner</span>'
        : `<button type="button" data-edit-user="${escapeHtml(user.id)}">Edit</button>`}</td>
    </tr>
  `).join("") : '<tr><td colspan="10">No users yet.</td></tr>';
}

function renderRegistrations() {
  els.farmerRegistrationCount.textContent = `${state.registrations.length} pending`;
  els.farmerRegistrationRows.innerHTML = state.registrations.length ? state.registrations.map((row) => `
    <tr>
      <td>${escapeHtml(row.full_name)}</td>
      <td>${escapeHtml(row.email)}</td>
      <td>${escapeHtml(row.phone || "-")}</td>
      <td>${escapeHtml([row.requested_community_id, row.community_name].filter(Boolean).join(" - ") || "-")}</td>
      <td>${escapeHtml(row.requested_farmer_id || "-")}</td>
      <td>${escapeHtml(formatFarmSize(row))}</td>
      <td><input class="registration-link-id" data-registration-link="${escapeHtml(row.id)}" type="text" placeholder="RID####"></td>
      <td class="row-actions"><button type="button" data-approve-registration="${escapeHtml(row.id)}">Approve</button><button type="button" data-reject-registration="${escapeHtml(row.id)}">Reject</button></td>
    </tr>
  `).join("") : '<tr><td colspan="8">No pending farmer registrations.</td></tr>';
}

function renderActivity() {
  els.userActivityCount.textContent = `${state.activity.length} events`;
  els.userActivityRows.innerHTML = state.activity.length ? state.activity.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.event_time))}</td>
      <td>${escapeHtml(row.actor_name || row.actor_email || "Unauthenticated")}</td>
      <td>${escapeHtml(row.summary)}</td>
      <td>${escapeHtml(row.target_id || "-")}</td>
    </tr>
  `).join("") : '<tr><td colspan="4">No activity recorded yet.</td></tr>';
}

function handleUserTableClick(event) {
  const button = event.target.closest("[data-edit-user]");
  if (!button) return;
  const user = state.users.find((row) => row.id === button.dataset.editUser);
  if (!user || user.is_protected_owner) return;

  state.editingUser = user;
  els.editUserId.value = user.id;
  els.editUserEmail.value = user.email;
  els.editUserName.value = user.display_name || "";
  els.editUserRole.value = user.app_role;
  els.editUserStatus.value = user.account_status;
  els.editUserCommunity.value = user.community_id || "";
  els.editFarmerId.value = user.farmer_id || "";
  configureFarmerRoleFields("edit");
  renderAggregatorInputs("edit", user.aggregator_ids || [], user.all_aggregators);
  els.deleteUser.disabled = user.id === state.actor?.id;
  els.deleteUser.title = user.id === state.actor?.id ? "You cannot delete your own account" : "Delete this user account";
  writePermissions("edit", user);
  els.userEditorPanel.hidden = false;
  els.userEditorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleRegistrationClick(event) {
  const approve = event.target.closest("[data-approve-registration]");
  const reject = event.target.closest("[data-reject-registration]");
  if (!approve && !reject) return;
  const requestId = (approve || reject).dataset.approveRegistration || (approve || reject).dataset.rejectRegistration;
  const action = approve ? "approve_farmer" : "reject_farmer";
  const linkInput = els.farmerRegistrationRows.querySelector(`[data-registration-link="${CSS.escape(requestId)}"]`);

  if (reject && !window.confirm("Reject this farmer registration?")) return;
  setStatus(els.farmerRegistrationStatus, approve ? "Approving..." : "Rejecting...");
  try {
    await invokeAdminUsers({
      action,
      request_id: requestId,
      link_farmer_id: nullableText(linkInput?.value)
    });
    setStatus(els.farmerRegistrationStatus, approve ? "Farmer approved." : "Registration rejected.");
    await loadPageData();
  } catch (error) {
    setStatus(els.farmerRegistrationStatus, error.message, "error");
  }
}

function buildPermissionInputs(container, prefix) {
  container.innerHTML = permissionDefinitions.map(([key, label, description]) => `
    <label class="permission-option" title="${escapeHtml(description)}"><input type="checkbox" id="${prefix}-${key}" data-permission-key="${key}"> ${escapeHtml(label)}</label>
  `).join("");
  container.addEventListener("change", (event) => enforcePermissionDependencies(prefix, event.target.dataset.permissionKey));
}

function buildEditRoleOptions() {
  const roles = Object.entries(roleLabels).filter(([role]) => role !== "system_admin" || state.actor?.app_role === "system_admin");
  els.editUserRole.innerHTML = roles.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("");
}

function renderCommunityOptions() {
  const options = state.communities.map((row) => `<option value="${escapeHtml(row.community_id)}">${escapeHtml(row.community_id)} - ${escapeHtml(row.community_name)}</option>`).join("");
  [els.inviteCommunity, els.editUserCommunity].forEach((select) => {
    const current = select.value;
    select.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
    select.insertAdjacentHTML("beforeend", options);
    select.value = current;
  });
}

function renderAggregatorInputs(prefix, selectedIds = [], allAggregators = false) {
  const container = prefix === "invite" ? els.inviteAggregators : els.editAggregators;
  const selected = new Set((selectedIds || []).map(String));
  if (allAggregators) {
    container.innerHTML = '<label class="aggregator-access-option"><input type="checkbox" checked disabled> All current and future aggregators</label>';
    return;
  }
  container.innerHTML = state.aggregators.map((row) => `
    <label class="aggregator-access-option">
      <input type="checkbox" data-aggregator-access="${prefix}" value="${escapeHtml(row.id)}" ${selected.has(String(row.id)) ? "checked" : ""}>
      ${escapeHtml(row.aggregator_code)} - ${escapeHtml(row.organisation_name)}
    </label>
  `).join("") || '<span class="admin-status">No manageable aggregators.</span>';
}

function selectedAggregatorIds(prefix) {
  const container = prefix === "invite" ? els.inviteAggregators : els.editAggregators;
  return [...container.querySelectorAll(`[data-aggregator-access="${prefix}"]:checked`)].map((input) => input.value);
}

function defaultInviteAggregatorIds() {
  const activeId = String(state.actor?.active_aggregator_id || "");
  if (state.aggregators.some((row) => String(row.id) === activeId)) return [activeId];
  return state.aggregators[0]?.id ? [String(state.aggregators[0].id)] : [];
}

function formatAggregatorAccess(user) {
  if (user.all_aggregators) return "All";
  const names = Array.isArray(user.aggregator_names) ? user.aggregator_names : [];
  return names.length ? names.join(", ") : "None";
}

function applyRolePreset(prefix, role) {
  writePermissions(prefix, rolePreset(role));
}

function configureFarmerRoleFields(prefix) {
  const isInvite = prefix === "invite";
  const role = isInvite ? els.inviteRole.value : els.editUserRole.value;
  const field = isInvite ? els.inviteFarmerIdField : els.editFarmerIdField;
  const input = isInvite ? els.inviteFarmerId : els.editFarmerId;
  const nameInput = isInvite ? els.inviteName : els.editUserName;
  const communityInput = isInvite ? els.inviteCommunity : els.editUserCommunity;
  const isFarmer = role === "farmer_viewer";
  field.hidden = !isFarmer;
  input.required = isFarmer;
  nameInput.disabled = isFarmer;
  nameInput.required = !isFarmer;
  nameInput.placeholder = isFarmer ? "Uses farmer registry name" : "";
  communityInput.disabled = isFarmer;
  communityInput.title = isFarmer ? "Uses the farmer registry community" : "";
  if (!isFarmer && isInvite) input.value = "";
}

function rolePreset(role) {
  const values = Object.fromEntries(permissionDefinitions.map(([key]) => [key, false]));
  if (role === "company_admin") Object.assign(values, { can_access_admin: true, can_submit_collection: true, can_view_dashboard: true, can_view_registry: true, can_edit_registry: true, can_view_map: true, can_view_data: true, can_edit_collections: true, can_view_finance: true, can_manage_pricing: true, can_export_data: true, can_manage_settings: true, can_manage_users: true, can_view_notifications: true, can_manage_notifications: true });
  if (role === "registry_admin") Object.assign(values, { can_access_admin: true, can_submit_collection: true, can_view_dashboard: true, can_view_registry: true, can_edit_registry: true, can_view_map: true, can_view_data: true });
  if (role === "finance_admin") Object.assign(values, { can_access_admin: true, can_view_dashboard: true, can_view_map: true, can_view_data: true, can_view_finance: true, can_manage_pricing: true, can_export_data: true, can_view_notifications: true });
  if (role === "field_collector") values.can_submit_collection = true;
  if (role === "read_only_auditor") Object.assign(values, { can_access_admin: true, can_view_dashboard: true, can_view_registry: true, can_view_map: true, can_view_data: true, can_view_finance: true, can_view_notifications: true });
  return values;
}

function writePermissions(prefix, values) {
  permissionDefinitions.forEach(([key]) => {
    const input = document.getElementById(`${prefix}-${key}`);
    const canChange = actorCanChangePermission(key);
    input.checked = canChange
      ? Boolean(values[key])
      : prefix === "edit" && state.editingUser
        ? Boolean(state.editingUser[key])
        : false;
    input.disabled = !canChange;
    input.title = canChange ? "" : "You cannot grant or change a permission you do not have";
  });
}

function actorCanChangePermission(key) {
  return state.actor?.is_protected_owner
    || state.actor?.app_role === "system_admin"
    || Boolean(state.actor?.[key]);
}

function enforcePermissionDependencies(prefix, changedKey) {
  permissionDependencies.forEach(([writeKey, readKey]) => {
    const writeInput = document.getElementById(`${prefix}-${writeKey}`);
    const readInput = document.getElementById(`${prefix}-${readKey}`);
    if (!writeInput || !readInput) return;

    if (changedKey === writeKey && writeInput.checked) {
      if (readInput.disabled && !readInput.checked) writeInput.checked = false;
      else readInput.checked = true;
    }
    if (changedKey === readKey && !readInput.checked) writeInput.checked = false;
  });
}

function readPermissions(prefix) {
  return Object.fromEntries(permissionDefinitions.map(([key]) => [key, document.getElementById(`${prefix}-${key}`).checked]));
}

function formatFarmSize(row) {
  if (row.farm_size_value === null || row.farm_size_value === undefined) return "-";
  return `${Number(row.farm_size_value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.farm_size_unit || "lines"}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "-";
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function setStatus(element, message, type = "") {
  element.textContent = message || "";
  element.dataset.status = type;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
