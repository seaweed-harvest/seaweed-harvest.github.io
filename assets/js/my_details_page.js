import {
  authClient,
  requireAuthenticatedAccount,
  currentProfile,
  routeForProfile,
  setupAccountControls,
  updateMyDetails
} from "./auth_client.js";

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
    "saveMyDetails",
    "myDetailsStatus",
    "myDetailsHomeLink"
  ].forEach((id) => { els[id] = document.getElementById(id); });

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
  configureHomeLink();
  populateForm();
  try {
    await loadReceiptPreferences();
  } catch (error) {
    setStatus(error.message, "error");
  }
  els.myDetailsForm.addEventListener("submit", saveDetails);
}

function configureHomeLink() {
  const destination = routeForProfile(profile);
  els.myDetailsHomeLink.href = destination;
  if (destination.includes("farmer.html")) els.myDetailsHomeLink.textContent = "Farmer account";
  else if (destination.includes("admin")) els.myDetailsHomeLink.textContent = "Admin";
  else if (destination.includes("index.html")) els.myDetailsHomeLink.textContent = "Collection";
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
    document.querySelector(".account-name").textContent = profile.display_name || profile.email;
    populateForm();
    setStatus("Details saved.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.saveMyDetails.disabled = false;
  }
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

function setStatus(message, type = "") {
  els.myDetailsStatus.textContent = message || "";
  els.myDetailsStatus.dataset.status = type;
}
