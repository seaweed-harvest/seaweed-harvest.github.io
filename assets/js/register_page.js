import { APP_CONFIG } from "./config.js";
import { currentSession, enabledSocialProviders, normalizePhone, signInWithProvider, signUpAccount } from "./auth_client.js?v=19";
import { callRpc, selectRows } from "./supabase_client.js";

const els = {};
const registrationDraftKey = "seaweed-ag:account-registration-draft";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "farmerRegistrationForm", "registrationName", "registrationEmail", "registrationPhone", "registrationRole",
    "farmerRegistrationFields", "registrationReviewNote", "registrationCommunity",
    "registrationFarmerId",
    "registrationPassword", "registrationConfirmPassword", "registrationSocialActions",
    "registrationGoogle", "registrationFacebook", "registrationStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  els.farmerRegistrationForm.addEventListener("submit", handleRegistration);
  els.registrationRole.addEventListener("change", updateRoleFields);
  els.registrationGoogle.addEventListener("click", () => socialRegistration("google"));
  els.registrationFacebook.addEventListener("click", () => socialRegistration("facebook"));
  await configureSocialButtons();
  await loadCommunities();
  restoreRegistrationDraft();
  updateRoleFields();

  const session = await currentSession();
  if (session) {
    els.registrationEmail.value = session.user.email || "";
    els.registrationEmail.disabled = true;
    els.registrationPassword.closest("label").hidden = true;
    els.registrationConfirmPassword.closest("label").hidden = true;
    els.registrationConfirmPassword.required = false;
    els.farmerRegistrationForm.querySelector('button[type="submit"]').textContent = "Submit registration";
  }
}

async function loadCommunities() {
  try {
    const rows = await selectRows("ag_public_communities", "select=community_id,community_name&order=community_name.asc");
    els.registrationCommunity.insertAdjacentHTML("beforeend", rows.map((row) => (
      `<option value="${escapeHtml(row.community_id)}">${escapeHtml(row.community_id)} - ${escapeHtml(row.community_name)}</option>`
    )).join(""));
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleRegistration(event) {
  event.preventDefault();
  if (!els.registrationEmail.disabled && els.registrationPassword.value !== els.registrationConfirmPassword.value) {
    setStatus("Passwords do not match.", "error");
    return;
  }
  const details = registrationDetails();
  setStatus("Submitting registration...");

  try {
    const session = await currentSession();
    if (session) {
      await callRpc("ag_submit_account_registration", {
        p_full_name: details.full_name,
        p_phone: details.phone,
        p_requested_role: details.requested_role,
        p_requested_farmer_id: details.requested_farmer_id,
        p_requested_community_id: details.requested_community_id,
        p_farm_size_value: details.farm_size_value,
        p_farm_size_unit: details.farm_size_unit
      });
      localStorage.removeItem(registrationDraftKey);
      window.location.replace("./access_pending.html");
      return;
    }

    const data = await signUpAccount(
      {
        email: els.registrationEmail.value.trim(),
        phone: els.registrationPhone.value.trim()
      },
      els.registrationPassword.value,
      details
    );
    if (data.session) window.location.replace("./access_pending.html");
    else if (els.registrationEmail.value.trim()) setStatus("Registration received. Check your email to confirm the account.");
    else setStatus("Registration received. An administrator will review the account.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function socialRegistration(provider) {
  if (!els.registrationName.value.trim() || !els.registrationPhone.value.trim()) {
    setStatus("Enter your name and phone number before continuing.", "error");
    return;
  }
  localStorage.setItem(registrationDraftKey, JSON.stringify(registrationDetails()));
  try {
    await signInWithProvider(provider, "register.html?oauth=1");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function registrationDetails() {
  const isFarmer = els.registrationRole.value === "farmer_viewer";
  const phone = normalizePhone(els.registrationPhone.value);
  return {
    full_name: els.registrationName.value.trim(),
    phone,
    requested_role: els.registrationRole.value,
    requested_community_id: isFarmer ? nullableText(els.registrationCommunity.value) : null,
    requested_farmer_id: isFarmer ? normalizedFarmerId(els.registrationFarmerId.value) : null,
    farm_size_value: null,
    farm_size_unit: "lines"
  };
}

function updateRoleFields() {
  const isFarmer = els.registrationRole.value === "farmer_viewer";
  els.farmerRegistrationFields.hidden = !isFarmer;
  els.registrationReviewNote.textContent = isFarmer
    ? "An administrator checks and links the farmer account before harvest records become visible."
    : "An administrator reviews the account before access is activated.";
}

function restoreRegistrationDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(registrationDraftKey) || "null");
  } catch {
    localStorage.removeItem(registrationDraftKey);
  }
  if (!draft) return;

  els.registrationName.value = draft.full_name || "";
  els.registrationPhone.value = draft.phone || "";
  els.registrationRole.value = draft.requested_role || "community_viewer";
  els.registrationCommunity.value = draft.requested_community_id || "";
  els.registrationFarmerId.value = draft.requested_farmer_id || "";
}

async function configureSocialButtons() {
  const { google, facebook } = await enabledSocialProviders();
  els.registrationGoogle.hidden = !google;
  els.registrationFacebook.hidden = !facebook;
  els.registrationSocialActions.hidden = !(google || facebook);
}

function normalizedFarmerId(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return `RID${raw.padStart(4, "0")}`;
  const match = raw.match(/^RID(\d+)$/);
  return match ? `RID${match[1].padStart(4, "0")}` : raw;
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, type = "") {
  els.registrationStatus.textContent = message || "";
  els.registrationStatus.dataset.status = type;
}
