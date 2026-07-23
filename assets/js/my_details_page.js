import {
  authClient,
  currentAggregatorContext,
  requireAuthenticatedAccount,
  currentProfile,
  routeForProfile,
  setActiveAggregator,
  setupAccountControls,
  updateMyDetails,
  updatePassword
} from "./auth_client.js?v=22";
import {
  dashboardSelection,
  saveDashboardPreferences
} from "./dashboard_preferences.js";
import { setupAppNavigation } from "./app_navigation.js?v=7";
import {
  listOutboxItems,
  loadOfflineCollectionAccess,
  saveOfflineCollectionAccess
} from "./offline_store.js";

const els = {};
let profile = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "myDetailsForm",
    "myDetailsFarmerIdField",
    "myDetailsFarmerId",
    "myDetailsName",
    "myDetailsEmail",
    "myDetailsPhone",
    "myDetailsAddress",
    "myDetailsDateOfBirth",
    "myReceiptPreferences",
    "myReceiptDelivery",
    "myReceiptEmail",
    "myReceiptPhone",
    "myReceiptLanguage",
    "myReceiptNotifications",
    "myDashboardPreferences",
    "myDashboardPreferenceOptions",
    "saveMyDetails",
    "myDetailsStatus",
    "myDetailsHomeLink",
    "myPasswordForm",
    "myNewPassword",
    "myConfirmPassword",
    "saveMyPassword",
    "myPasswordStatus"
    , "myActiveAggregator", "myAggregatorCode", "myAggregatorSelectorField",
    "myAggregatorSelector", "myAggregatorStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!navigator.onLine) {
    await initialiseOfflineProfile();
    return;
  }

  try {
    const access = await requireAuthenticatedAccount("my_details.html");
    if (!access) return;
    profile = access.profile;
  } catch (error) {
    window.location.replace(`./login.html?return=my_details.html&error=${encodeURIComponent(error.message)}`);
    return;
  }

  document.body.removeAttribute("data-auth-pending");
  setupAccountControls(profile, {
    container: document.querySelector(".my-details-header-controls"),
    returnPage: "my_details.html",
    showMyDetails: false
  });
  setupAppNavigation({ profile, dashboardHref: routeForProfile(profile) });
  configureHomeLink();
  populateForm();
  populateDashboardPreferences();
  await loadAggregatorProfile();
  try {
    await loadReceiptPreferences();
  } catch (error) {
    setStatus(error.message, "error");
  }
  els.myDetailsForm.addEventListener("submit", saveDetails);
  els.myPasswordForm.addEventListener("submit", savePassword);
}

async function initialiseOfflineProfile() {
  const snapshot = await loadOfflineCollectionAccess().catch(() => null);
  if (!snapshot) {
    window.location.replace("./collection.html?online_required=1");
    return;
  }
  profile = {
    id: snapshot.userId,
    email: snapshot.email,
    display_name: snapshot.displayName,
    account_status: snapshot.accountStatus,
    can_submit_collection: true,
    app_role: snapshot.appRole
  };
  document.body.removeAttribute("data-auth-pending");
  setupAppNavigation({ profile, dashboardHref: "./collection.html" });
  els.myDetailsHomeLink.href = "./collection.html";
  els.myDetailsHomeLink.textContent = "Collection";
  populateForm();
  els.myDetailsForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = true;
  });
  els.myPasswordForm.querySelectorAll("input, button").forEach((control) => {
    control.disabled = true;
  });
  els.myDashboardPreferences.hidden = true;
  els.myReceiptPreferences.hidden = true;
  renderAggregator(snapshot.aggregator, [snapshot.aggregator], snapshot.validatedAt, true);
  setStatus("Offline profile view. Connect to update account details.");
  setPasswordStatus("Connect to change your password.");
}

function configureHomeLink() {
  const destination = routeForProfile(profile);
  els.myDetailsHomeLink.href = destination;
  if (destination.includes("farmer.html")) els.myDetailsHomeLink.textContent = "Farmer account";
  else if (destination.includes("home.html")) els.myDetailsHomeLink.textContent = "Home";
  else if (destination.includes("collector_dashboard.html")) els.myDetailsHomeLink.textContent = "Dashboard";
  else if (destination.includes("collection.html")) els.myDetailsHomeLink.textContent = "Collection";
  else els.myDetailsHomeLink.textContent = "Account home";
}

function populateForm() {
  els.myDetailsFarmerIdField.hidden = !profile.farmer_id;
  els.myDetailsFarmerId.value = profile.farmer_id || "";
  els.myDetailsName.value = profile.display_name || "";
  els.myDetailsEmail.value = profile.email || "";
  els.myDetailsPhone.value = profile.phone || "";
  els.myDetailsAddress.value = profile.address || "";
  els.myDetailsDateOfBirth.value = profile.date_of_birth || "";
  els.myDetailsDateOfBirth.max = new Date().toISOString().slice(0, 10);
}

async function saveDetails(event) {
  event.preventDefault();
  const dashboardWidgets = selectedDashboardWidgets();
  if (!dashboardWidgets.length) {
    setStatus("Keep at least one dashboard item visible.", "error");
    return;
  }
  els.saveMyDetails.disabled = true;
  setStatus("Saving...");
  try {
    await updateMyDetails({
      display_name: els.myDetailsName.value.trim(),
      phone: els.myDetailsPhone.value.trim(),
      address: els.myDetailsAddress.value.trim(),
      date_of_birth: els.myDetailsDateOfBirth.value
    });
    profile = await currentProfile(true);
    if (profile.farmer_id) {
      const { error: preferenceError } = await authClient.rpc("ag_update_my_receipt_preferences", {
        p_delivery_preference: els.myReceiptDelivery.value,
        p_receipt_email: els.myReceiptEmail.value.trim() || null,
        p_receipt_phone: els.myReceiptPhone.value.trim() || null,
        p_preferred_language: els.myReceiptLanguage.value,
        p_allow_transaction_notifications: els.myReceiptNotifications.checked
      });
      if (preferenceError) throw preferenceError;
    }
    await saveDashboardPreferences(authClient, dashboardWidgets);
    profile = await currentProfile(true);
    const accountName = document.querySelector(".account-name");
    if (accountName) accountName.textContent = profile.display_name || profile.email;
    populateForm();
    populateDashboardPreferences();
    setStatus("Details saved.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.saveMyDetails.disabled = false;
  }
}

async function savePassword(event) {
  event.preventDefault();
  const password = els.myNewPassword.value;
  if (password.length < 10) {
    setPasswordStatus("Use at least 10 characters.", "error");
    return;
  }
  if (password !== els.myConfirmPassword.value) {
    setPasswordStatus("Passwords do not match.", "error");
    return;
  }

  els.saveMyPassword.disabled = true;
  setPasswordStatus("Updating...");
  try {
    await updatePassword(password, profile.display_name || els.myDetailsName.value.trim());
    els.myPasswordForm.reset();
    setPasswordStatus("Password updated.");
  } catch (error) {
    setPasswordStatus(error.message, "error");
  } finally {
    els.saveMyPassword.disabled = false;
  }
}

function populateDashboardPreferences() {
  const selection = dashboardSelection(profile);
  els.myDashboardPreferences.hidden = !selection.kind;
  if (!selection.kind) {
    els.myDashboardPreferenceOptions.innerHTML = "";
    return;
  }
  const selected = new Set(selection.selected);
  els.myDashboardPreferenceOptions.innerHTML = selection.options.map((option) => `
    <label class="check-row">
      <input type="checkbox" name="dashboardWidget" value="${escapeHtml(option.key)}"${selected.has(option.key) ? " checked" : ""}>
      ${escapeHtml(option.label)}
    </label>
  `).join("");
}

function selectedDashboardWidgets() {
  return [...els.myDashboardPreferenceOptions.querySelectorAll('input[name="dashboardWidget"]:checked')]
    .map((input) => input.value);
}

async function loadReceiptPreferences() {
  els.myReceiptPreferences.hidden = !profile.farmer_id;
  if (!profile.farmer_id) return;
  const { data, error } = await authClient.rpc("ag_my_receipt_preferences");
  if (error) throw error;
  els.myReceiptDelivery.value = data?.receipt_delivery_preference || "none";
  els.myReceiptEmail.value = data?.receipt_email || profile.email || "";
  els.myReceiptPhone.value = data?.receipt_phone || profile.phone || "";
  els.myReceiptLanguage.value = data?.preferred_language || "en";
  els.myReceiptNotifications.checked = data?.allow_transaction_notifications !== false;
}

async function loadAggregatorProfile() {
  const context = await currentAggregatorContext(true);
  const cached = await loadOfflineCollectionAccess().catch(() => null);
  renderAggregator(
    context.active_aggregator,
    context.aggregators || [],
    cached?.validatedAt || null,
    false
  );
}

function renderAggregator(active, aggregators, validatedAt, offline) {
  els.myActiveAggregator.textContent = active?.short_name || active?.organisation_name || "Not assigned";
  els.myAggregatorCode.textContent = active?.aggregator_code ? ` ${active.aggregator_code}` : "";
  els.myAggregatorSelectorField.hidden = offline || aggregators.length < 2;
  els.myAggregatorSelector.replaceChildren();
  aggregators.forEach((aggregator) => {
    const option = document.createElement("option");
    option.value = aggregator.id;
    option.textContent = aggregator.short_name || aggregator.organisation_name || aggregator.aggregator_code;
    option.selected = aggregator.id === active?.id;
    els.myAggregatorSelector.append(option);
  });
  const verified = validatedAt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(validatedAt))
    : "";
  els.myAggregatorStatus.textContent = offline
    ? `Offline - last verified ${verified}. Connect to change aggregator.`
    : (verified ? `Offline Collection access last verified ${verified}.` : "Open Collection online once to enable offline access.");
  if (!offline) els.myAggregatorSelector.onchange = changeAggregator;
}

async function changeAggregator() {
  const aggregatorId = els.myAggregatorSelector.value;
  if (!navigator.onLine) {
    setAggregatorStatus("Connect to change aggregator.", "error");
    return;
  }
  const pending = (await listOutboxItems()).filter((item) => item.status !== "synced");
  if (pending.length && !window.confirm(
    `${pending.length} local ${pending.length === 1 ? "record is" : "records are"} waiting to sync. `
    + "They will keep their original aggregator. Change aggregator anyway?"
  )) {
    await loadAggregatorProfile();
    return;
  }
  els.myAggregatorSelector.disabled = true;
  setAggregatorStatus("Changing aggregator...");
  try {
    const context = await setActiveAggregator(aggregatorId);
    profile = await currentProfile(true);
    const active = context.active_aggregator;
    if (profile.account_status === "active"
      && (profile.app_role === "system_admin" || profile.can_submit_collection)
      && active?.id) {
      await saveOfflineCollectionAccess({
        userId: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        accountStatus: profile.account_status,
        canSubmitCollection: true,
        canOverridePrice: profile.app_role === "system_admin"
          || (profile.can_manage_pricing && ["aggregator_admin", "finance"].includes(profile.active_membership_role)),
        appRole: profile.app_role,
        activeMembershipRole: profile.active_membership_role,
        aggregator: active,
        validatedAt: new Date().toISOString()
      });
    }
    window.location.reload();
  } catch (error) {
    setAggregatorStatus(error.message, "error");
    els.myAggregatorSelector.disabled = false;
  }
}

function setAggregatorStatus(message, type = "") {
  els.myAggregatorStatus.textContent = message || "";
  els.myAggregatorStatus.dataset.status = type;
}

function setStatus(message, type = "") {
  els.myDetailsStatus.textContent = message || "";
  els.myDetailsStatus.dataset.status = type;
}

function setPasswordStatus(message, type = "") {
  els.myPasswordStatus.textContent = message || "";
  els.myPasswordStatus.dataset.status = type;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
