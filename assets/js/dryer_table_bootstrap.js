import {
  authClient,
  currentProfile,
  currentSession,
  routeForProfile,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=15";
import { setupFavoriteFormButton } from "./favorite_forms.js?v=3";
import { callPublicRpc } from "./supabase_client.js";

document.addEventListener("DOMContentLoaded", () => {
  installDryerPhotoInputLayoutFix();
  initializeDryerTablePage();
});

function installDryerPhotoInputLayoutFix() {
  if (document.getElementById("dryerPhotoInputLayoutFix")) return;
  const style = document.createElement("style");
  style.id = "dryerPhotoInputLayoutFix";
  style.textContent = `
    .drying-page .camera-field input[type="file"] {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      inline-size: 100%;
      max-inline-size: 100%;
      min-inline-size: 0;
      box-sizing: border-box;
      overflow: hidden;
      justify-self: stretch;
    }
  `;
  document.head.appendChild(style);
}

async function initializeDryerTablePage() {
  try {
    const profile = await optionalSignedInProfile();
    await requireDryerTableEntryAccess(profile);
    const dashboardHref = profile ? routeForProfile(profile) : "./login.html?return=home.html";

    const sidebar = populateAppSidebar(document.getElementById("dryerTableSidebar"), {
      profile,
      dashboardHref
    });
    if (profile) setupAccountControls(profile);
    setupAppNavigation({
      profile,
      sidebar,
      dashboardHref
    });
    setupFavoriteFormButton({
      button: document.getElementById("favoriteDryerTableForm"),
      formKey: "dryer_table",
      profile,
      client: authClient,
      returnPage: "dryer_table.html"
    });

    const shedLocations = await import("./dryer_table_shed_locations.js?v=3");
    await import("./dryer_table_open_edit.js?v=3");
    await import("./dryer_table_form.js?v=8");
    shedLocations.setupDryerShedLocations();
    await import("./dryer_table_ra_name.js?v=3");
  } catch (error) {
    showAccessError(error.message || "The Dryer Table form is not available.");
  } finally {
    document.body.removeAttribute("data-auth-pending");
  }
}

async function optionalSignedInProfile() {
  try {
    const session = await currentSession();
    if (!session) return null;
    const profile = await currentProfile(true);
    return profile?.account_status === "active" ? profile : null;
  } catch (error) {
    console.warn("Opening Dryer Table without an account session.", error);
    return null;
  }
}

const DRYER_OFFLINE_ACCESS_KEY = "seaweed_dryer_verified_access_v1";
const DRYER_OFFLINE_ACCESS_MS = 7 * 24 * 60 * 60 * 1000;

function rememberDryerOfflineAccess() {
  try {
    localStorage.setItem(DRYER_OFFLINE_ACCESS_KEY, String(Date.now()));
  } catch {
    // Online form entry still works when storage is unavailable.
  }
}

function hasRecentDryerOfflineAccess() {
  try {
    const validatedAt = Number(localStorage.getItem(DRYER_OFFLINE_ACCESS_KEY));
    return Number.isFinite(validatedAt) && validatedAt > 0
      && Date.now() - validatedAt < DRYER_OFFLINE_ACCESS_MS;
  } catch {
    return false;
  }
}

async function requireDryerTableEntryAccess(profile) {
  const activeOrganisation = String(profile?.active_aggregator_code || "").trim().toUpperCase();
  const authenticatedAccess = activeOrganisation === "COSME"
    && (profile?.app_role === "system_admin" || profile?.can_access_reef_nursery)
    && Boolean(profile?.organisation_capabilities?.form_dryer_table);
  if (authenticatedAccess) {
    rememberDryerOfflineAccess();
    return;
  }

  const parameters = new URLSearchParams(window.location.search);
  try {
    const context = await callPublicRpc("ag_public_form_entry_context", {
      p_form_key: "form_dryer_table",
      p_organisation_code: "COSME",
      p_share_token: parameters.get("share") || null
    });
    if (!context?.allowed) {
      throw new Error(context?.reason || "The Dryer Table form is not available.");
    }
    rememberDryerOfflineAccess();
  } catch (error) {
    if ((!navigator.onLine || /failed to fetch|networkerror|load failed|timeout|abort/i
      .test(String(error?.message || error || ""))) && hasRecentDryerOfflineAccess()) {
      return;
    }
    throw error;
  }
}

function showAccessError(message) {
  const content = document.querySelector(".dryer-table-content");
  if (!content) return;
  content.innerHTML = `
    <section class="panel empty-state" role="alert">
      <h2>Dryer Table unavailable</h2>
      <p>${escapeHtml(message)}</p>
      <a class="button-link" href="./login.html?return=dryer_table.html">Sign in</a>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
