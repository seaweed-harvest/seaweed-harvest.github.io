import {
  authClient,
  requireAggregatorAccess,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=13";
import { setupFavoriteFormButton } from "./favorite_forms.js?v=3";

document.addEventListener("DOMContentLoaded", initializeDryerTablePage);

async function initializeDryerTablePage() {
  try {
    const access = await requireAggregatorAccess(
      "COSME",
      "can_access_reef_nursery",
      "dryer_table.html",
      "form_dryer_table"
    );
    if (!access) return;

    const sidebar = populateAppSidebar(document.getElementById("dryerTableSidebar"), {
      profile: access.profile,
      dashboardHref: "./home.html"
    });
    setupAccountControls(access.profile);
    setupAppNavigation({
      profile: access.profile,
      sidebar,
      dashboardHref: "./home.html"
    });
    setupFavoriteFormButton({
      button: document.getElementById("favoriteDryerTableForm"),
      formKey: "dryer_table",
      profile: access.profile,
      client: authClient,
      returnPage: "dryer_table.html"
    });

    await import("./dryer_table_form.js?v=2");
    document.body.removeAttribute("data-auth-pending");
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error.message)}`);
  }
}
