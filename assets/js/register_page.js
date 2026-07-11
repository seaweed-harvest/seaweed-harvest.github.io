import { APP_CONFIG } from "./config.js";
import { currentSession, enabledSocialProviders, signInWithProvider, signUpFarmer } from "./auth_client.js";
import { callRpc, selectRows } from "./supabase_client.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "farmerRegistrationForm", "registrationName", "registrationPhone", "registrationCommunity",
    "registrationFarmerId", "registrationFarmSize", "registrationFarmSizeUnit",
    "registrationEmail", "registrationPassword", "registrationConfirmPassword", "registrationSocialActions",
    "registrationGoogle", "registrationFacebook", "registrationStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  els.farmerRegistrationForm.addEventListener("submit", handleRegistration);
  els.registrationGoogle.addEventListener("click", () => socialRegistration("google"));
  els.registrationFacebook.addEventListener("click", () => socialRegistration("facebook"));
  await configureSocialButtons();
  await loadCommunities();

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
    const rows = await selectRows(APP_CONFIG.tables.communities, "select=community_id,community_name&order=community_name.asc");
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
      await callRpc("ag_submit_farmer_registration", {
        p_full_name: details.full_name,
        p_phone: details.phone,
        p_requested_farmer_id: details.requested_farmer_id,
        p_requested_community_id: details.requested_community_id,
        p_farm_size_value: details.farm_size_value,
        p_farm_size_unit: details.farm_size_unit
      });
      window.location.replace("./access_pending.html");
      return;
    }

    const data = await signUpFarmer(
      els.registrationEmail.value.trim(),
      els.registrationPassword.value,
      details
    );
    if (data.session) window.location.replace("./access_pending.html");
    else setStatus("Registration received. Check your email to confirm the account.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function socialRegistration(provider) {
  localStorage.setItem("seaweed-ag:farmer-registration-draft", JSON.stringify(registrationDetails()));
  try {
    await signInWithProvider(provider, "register.html?oauth=1");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function registrationDetails() {
  return {
    full_name: els.registrationName.value.trim(),
    phone: nullableText(els.registrationPhone.value),
    requested_community_id: nullableText(els.registrationCommunity.value),
    requested_farmer_id: normalizedFarmerId(els.registrationFarmerId.value),
    farm_size_value: nullableNumber(els.registrationFarmSize.value),
    farm_size_unit: els.registrationFarmSizeUnit.value
  };
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

function nullableNumber(value) {
  if (String(value || "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
