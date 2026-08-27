import { authClient } from "./auth_client.js?v=25";

const params = new URLSearchParams(window.location.search);
const hasReviewShare = Boolean(params.get("share") && params.get("org"));

if (hasReviewShare) {
  await loadLegacyReefRuntime();
} else {
  let useProductionWorkspace = false;
  try {
    const { data, error } = await authClient.rpc("ag_reef_training_workspace_context");
    if (!error && data?.allowed && data?.entry_access === "public") {
      useProductionWorkspace = true;
    }
  } catch {
    // Until the staged Reef migrations are deployed, keep the existing Reef runtime unchanged.
  }

  if (useProductionWorkspace) {
    const target = new URL("./reef_nursery_training.html", window.location.href);
    for (const key of ["record", "tab", "seaweed_record", "inspection_record", "legacy_record"]) {
      const value = params.get(key);
      if (value) target.searchParams.set(key, value);
    }
    window.location.replace(target.href);
  } else {
    await loadLegacyReefRuntime();
  }
}

async function loadLegacyReefRuntime() {
  await import("./admin_page.js?v=36");
  await import("./reef_nursery_form.js?v=23");
}
