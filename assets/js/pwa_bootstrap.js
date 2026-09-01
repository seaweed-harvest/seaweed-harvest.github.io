const canRegister = !globalThis.SeaweedNativeBundle
  && ["http:", "https:"].includes(window.location.protocol)
  && "serviceWorker" in navigator;

const organisationContextEventKey = "seaweed-active-organisation-change";
const safeContextReloadPages = new Set([
  "home.html",
  "records.html",
  "photos.html",
  "deleted_records.html",
  "historical_records.html",
  "dataset_dashboard.html",
  "admin_users.html",
  "admin_forms.html",
  "admin_suggestions.html"
]);
let pendingOrganisationSelect = null;
let pendingOrganisationId = "";

document.addEventListener("change", (event) => {
  const select = event.target?.closest?.('select[aria-label="Active aggregator"]');
  if (!select) return;
  pendingOrganisationSelect = select;
  pendingOrganisationId = String(select.value || "");
});

window.addEventListener("pagehide", () => {
  // auth_client keeps the selector disabled while the organisation RPC is
  // succeeding and reloads only after that RPC resolves. A failed change
  // re-enables the selector, so it must not be broadcast to other tabs.
  if (!pendingOrganisationSelect?.disabled || !pendingOrganisationId) return;
  try {
    localStorage.setItem(organisationContextEventKey, JSON.stringify({
      id: pendingOrganisationId,
      changed_at: Date.now()
    }));
  } catch {
    // Cross-tab synchronisation is best-effort when storage is unavailable.
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== organisationContextEventKey || !event.newValue) return;
  let change = null;
  try {
    change = JSON.parse(event.newValue);
  } catch {
    return;
  }
  if (!change?.id) return;

  const currentSelect = document.querySelector('select[aria-label="Active aggregator"]');
  if (currentSelect?.value === change.id) return;

  const page = window.location.pathname.split("/").pop() || "index.html";
  if (safeContextReloadPages.has(page)) {
    window.location.reload();
    return;
  }
  markOrganisationContextStale();
});

function markOrganisationContextStale() {
  if (!document.body || document.body.dataset.organisationContextStale === "true") return;
  document.body.dataset.organisationContextStale = "true";

  const notice = document.createElement("div");
  notice.id = "organisationContextStaleNotice";
  notice.setAttribute("role", "alert");
  notice.style.position = "fixed";
  notice.style.left = "50%";
  notice.style.top = "12px";
  notice.style.transform = "translateX(-50%)";
  notice.style.zIndex = "10000";
  notice.style.maxWidth = "min(92vw, 720px)";
  notice.style.padding = "10px 12px";
  notice.style.border = "1px solid #d9b65f";
  notice.style.borderRadius = "8px";
  notice.style.background = "#fff8e8";
  notice.style.color = "#5f4a16";
  notice.style.boxShadow = "0 4px 18px rgba(0,0,0,.12)";
  notice.style.font = "600 14px/1.4 system-ui, sans-serif";
  notice.innerHTML = "Organisation changed in another tab. Reload this tab before saving so records stay in the correct organisation. ";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload now";
  reload.style.marginLeft = "8px";
  reload.addEventListener("click", () => window.location.reload());
  notice.append(reload);
  document.body.append(notice);

  document.addEventListener("submit", blockStaleOrganisationSubmit, true);
}

function blockStaleOrganisationSubmit(event) {
  if (document.body?.dataset.organisationContextStale !== "true") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.alert("Organisation changed in another tab. Reload this tab before saving.");
}

if (window.location.pathname.endsWith("/reef_nursery.html")) {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("share") && parameters.get("org")) {
    import("./reef_review_matrix_collaboration.js?v=1").catch((error) => {
      console.warn("Reef review matrix collaboration could not be loaded.", error);
    });
  }
}

if (window.location.pathname.endsWith("/admin_users.html")) {
  import("./tide_activation_admin.js?v=1").catch((error) => {
    console.warn("Tide activation-link controls could not be loaded.", error);
  });
}

if (window.location.pathname.endsWith("/stabilization_packing.html")) {
  Promise.all([
    import("./stabilization_stock_removal.js?v=1"),
    import("./stabilization_stock_runtime_bridge.js?v=1")
  ]).catch((error) => {
    console.warn("BioStim stock-removal controls could not be loaded.", error);
  });
}

if (window.location.pathname.endsWith("/records.html")) {
  Promise.all([
    import("./stabilization_stock_ledger.js?v=1"),
    import("./stabilization_stock_lookup.js?v=1"),
    import("./stabilization_stock_runtime_bridge.js?v=1")
  ]).catch((error) => {
    console.warn("BioStim stock records extensions could not be loaded.", error);
  });
}

if (canRegister) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Seaweed Harvest offline support could not be registered.", error);
    });
  }, { once: true });
}
