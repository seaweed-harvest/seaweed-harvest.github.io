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

document.addEventListener("DOMContentLoaded", initializeDryerTablePage);

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

    await import("./dryer_table_open_edit.js?v=2");
    await import("./dryer_table_form.js?v=2");
    setupDryerShedConfiguration();
  } catch (error) {
    showAccessError(error.message || "The Dryer Table form is not available.");
  } finally {
    document.body.removeAttribute("data-auth-pending");
  }
}

export function setupDryerShedConfiguration() {
  const locationSelect = document.getElementById("dryerLocation");
  const configurationSelect = document.getElementById("dryingConfiguration");
  const form = document.getElementById("dryingForm");
  if (!locationSelect || !configurationSelect) return;

  let noConfigurationOption = configurationSelect.querySelector('option[value="no_configuration"]');
  if (!noConfigurationOption) {
    noConfigurationOption = document.createElement("option");
    noConfigurationOption.value = "no_configuration";
    configurationSelect.append(noConfigurationOption);
  }

  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeGet = valueDescriptor?.get;
  const nativeSet = valueDescriptor?.set;

  const sync = () => {
    const dryerShedSelected = locationSelect.value === "bati-dryer-shed";
    noConfigurationOption.textContent = document.body.dataset.language === "sw"
      ? "Hakuna mpangilio"
      : "No configuration";
    noConfigurationOption.hidden = !dryerShedSelected;
    configurationSelect.disabled = dryerShedSelected;

    if (dryerShedSelected) {
      if (nativeSet) nativeSet.call(configurationSelect, "no_configuration");
      else configurationSelect.value = "no_configuration";
    } else if (configurationSelect.value === "no_configuration") {
      if (nativeSet) nativeSet.call(configurationSelect, "");
      else configurationSelect.value = "";
    }

    const field = configurationSelect.closest(".required-field");
    field?.classList.toggle(
      "is-filled",
      dryerShedSelected || Boolean(String(configurationSelect.value || "").trim())
    );
  };

  if (nativeGet && nativeSet) {
    Object.defineProperty(locationSelect, "value", {
      configurable: true,
      get() {
        return nativeGet.call(locationSelect);
      },
      set(value) {
        nativeSet.call(locationSelect, value);
        queueMicrotask(sync);
      }
    });

    Object.defineProperty(configurationSelect, "value", {
      configurable: true,
      get() {
        return nativeGet.call(configurationSelect);
      },
      set(value) {
        const nextValue = nativeGet.call(locationSelect) === "bati-dryer-shed"
          ? "no_configuration"
          : value;
        nativeSet.call(configurationSelect, nextValue);
      }
    });
  }

  locationSelect.addEventListener("change", sync);
  form?.addEventListener("reset", () => queueMicrotask(sync));
  document.addEventListener("seaweed-drying-language-change", sync);
  sync();
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

async function requireDryerTableEntryAccess(profile) {
  const activeOrganisation = String(profile?.active_aggregator_code || "").trim().toUpperCase();
  const authenticatedAccess = activeOrganisation === "COSME"
    && (profile?.app_role === "system_admin" || profile?.can_access_reef_nursery)
    && Boolean(profile?.organisation_capabilities?.form_dryer_table);
  if (authenticatedAccess) return;

  const parameters = new URLSearchParams(window.location.search);
  const context = await callPublicRpc("ag_public_form_entry_context", {
    p_form_key: "form_dryer_table",
    p_organisation_code: "COSME",
    p_share_token: parameters.get("share") || null
  });
  if (!context?.allowed) {
    throw new Error(context?.reason || "The Dryer Table form is not available.");
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
