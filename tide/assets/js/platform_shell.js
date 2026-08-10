const PLATFORM_ROUTE_PREFIX = "/tide/";
const TIDE_APP_KEY = "tide";
const ACCESS_CACHE_KEY = "seaweed_tide_planner:platform_access:v1";
const ACCESS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

if (isPlatformHosted()) {
  document.documentElement.dataset.platformAuth = "checking";
  initPlatformShell().catch((error) => {
    console.error("Tide platform authentication failed.", error);
    showPlatformError(error?.message || "Tide access could not be checked.");
  });
}

async function initPlatformShell() {
  ensurePlatformStylesheet();

  const [authModule, accessModule] = await Promise.all([
    import("/assets/js/auth_client.js?v=22"),
    import("/assets/js/platform_access.js?v=1"),
  ]);

  const session = await authModule.currentSession();
  if (!session?.user) {
    redirectToLogin();
    return;
  }

  let grant = null;
  if (navigator.onLine) {
    grant = await accessModule.applicationAccess(TIDE_APP_KEY, true);
    if (grant?.role) writeCachedGrant(session.user.id, grant);
  } else {
    grant = readCachedGrant(session.user.id);
  }

  if (!grant?.role) {
    if (!navigator.onLine) {
      throw new Error("Connect to the internet once to verify this account's Tide access.");
    }
    window.location.replace(
      `/access_pending.html?reason=${encodeURIComponent("Tide Planner is not enabled for this account.")}`,
    );
    return;
  }

  const requiredRole = requiredRoleForPath();
  if (accessModule.roleRank(grant.role) < accessModule.roleRank(requiredRole)) {
    const reason = requiredRole === "admin"
      ? "Tide administrator access is required for this page."
      : "Tide operator access is required for the observation form.";
    window.location.replace(`/access_pending.html?reason=${encodeURIComponent(reason)}`);
    return;
  }

  const profile = navigator.onLine
    ? await authModule.currentProfile(true).catch(() => null)
    : null;
  setupAccountControl({
    session,
    profile,
    grant,
    signOut: authModule.signOut,
    clearApplicationAccessCache: accessModule.clearApplicationAccessCache,
  });

  document.documentElement.dataset.platformAuth = "ready";
  document.dispatchEvent(new CustomEvent("seaweed-tide-platform-ready", {
    detail: { role: grant.role, userId: session.user.id },
  }));
}

function setupAccountControl({ session, profile, grant, signOut, clearApplicationAccessCache }) {
  const controls = document.querySelector(".header-actions");
  if (!controls || controls.querySelector(".platform-account-menu")) return;

  const details = document.createElement("details");
  details.className = "platform-account-menu";

  const trigger = document.createElement("summary");
  trigger.className = "platform-account-trigger";
  trigger.setAttribute("aria-label", "Open account menu");
  trigger.innerHTML = `<span class="platform-account-avatar" aria-hidden="true">${escapeHtml(initials(profile, session))}</span>`;

  const popover = document.createElement("div");
  popover.className = "platform-account-popover";

  const identity = document.createElement("div");
  identity.className = "platform-account-identity";
  const name = document.createElement("strong");
  name.textContent = profile?.display_name
    || session.user?.user_metadata?.full_name
    || session.user?.email
    || "Tide user";
  const email = document.createElement("span");
  email.textContent = session.user?.email || "";
  const role = document.createElement("span");
  role.className = "platform-account-role";
  role.textContent = tideRoleLabel(grant.role);
  identity.append(name, email, role);

  const profileLink = menuLink("/my_details.html", "Profile settings");
  const harvestLink = menuLink("/", "Seaweed Harvest");

  const signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.className = "platform-account-item platform-account-signout";
  signOutButton.textContent = "Sign out";
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    localStorage.removeItem(ACCESS_CACHE_KEY);
    clearApplicationAccessCache?.();
    try {
      await signOut();
    } finally {
      window.location.replace(`/login.html?return=${encodeURIComponent("tide/index.html")}`);
    }
  });

  popover.append(identity, profileLink, harvestLink, signOutButton);
  details.append(trigger, popover);
  controls.append(details);

  document.addEventListener("click", (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });
  details.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    details.open = false;
    trigger.focus();
  });
}

function menuLink(href, label) {
  const link = document.createElement("a");
  link.className = "platform-account-item";
  link.href = href;
  link.textContent = label;
  return link;
}

function initials(profile, session) {
  const text = String(
    profile?.display_name
      || session.user?.user_metadata?.full_name
      || session.user?.email
      || "U",
  ).trim();
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

function tideRoleLabel(role) {
  if (role === "admin") return "Tide admin";
  if (role === "operator") return "Tide operator";
  return "Tide access";
}

function requiredRoleForPath() {
  const page = window.location.pathname.split("/").pop()?.toLowerCase() || "index.html";
  if (page === "observation.html") return "operator";
  if ([
    "admin.html",
    "admin_settings.html",
    "calibration.html",
    "locations.html",
    "tide_datasets.html"
  ].includes(page)) return "admin";
  return "user";
}

function isPlatformHosted() {
  return window.location.pathname === "/tide" || window.location.pathname.startsWith(PLATFORM_ROUTE_PREFIX);
}

function tideReturnPath() {
  let path = window.location.pathname;
  if (path === "/tide" || path === "/tide/") path = "/tide/index.html";
  const relative = path.replace(/^\/+/, "");
  return `${relative}${window.location.search || ""}`;
}

function redirectToLogin() {
  window.location.replace(`/login.html?return=${encodeURIComponent(tideReturnPath())}`);
}

function writeCachedGrant(userId, grant) {
  try {
    localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({
      userId,
      role: grant.role,
      checkedAt: Date.now(),
    }));
  } catch {
    // Tide still works online if browser storage is unavailable.
  }
}

function readCachedGrant(userId) {
  try {
    const cached = JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY) || "null");
    if (!cached || cached.userId !== userId || !cached.role) return null;
    if (Date.now() - Number(cached.checkedAt || 0) > ACCESS_CACHE_MAX_AGE_MS) return null;
    return { role: cached.role };
  } catch {
    return null;
  }
}

function ensurePlatformStylesheet() {
  if (document.querySelector('link[data-tide-platform-shell="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./assets/css/platform_shell.css?v=1";
  link.dataset.tidePlatformShell = "true";
  document.head.append(link);
}

function showPlatformError(message) {
  document.documentElement.dataset.platformAuth = "error";
  const panel = document.createElement("section");
  panel.className = "platform-access-error";
  panel.setAttribute("role", "alert");
  panel.innerHTML = `
    <strong>Tide access unavailable</strong>
    <span>${escapeHtml(message)}</span>
    <a href="/login.html?return=${encodeURIComponent(tideReturnPath())}">Sign in / try again</a>
  `;
  document.body.prepend(panel);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
