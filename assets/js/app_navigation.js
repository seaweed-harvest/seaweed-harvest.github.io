const MOBILE_NAV_QUERY = "(max-width: 980px)";
const SIDEBAR_PINNED_KEY = "seaweed_ag:admin_sidebar_pinned";
const SIDEBAR_GROUP_KEY_PREFIX = "seaweed_ag:admin_menu:";

export function setupAppNavigation(options = {}) {
  const header = options.header || document.querySelector(".app-header");
  const actions = header?.querySelector(".header-actions");
  if (!header || !actions || header.dataset.appNavigationReady === "true") return null;

  const profile = options.profile || null;
  const currentFile = window.location.pathname.split("/").pop() || "collection.html";
  const dashboardHref = options.dashboardHref || dashboardRoute(profile);
  const forms = formLinks();
  const records = recordLinks(profile);

  header.classList.add("unified-app-header");
  const primary = document.createElement("nav");
  primary.className = "mobile-primary-nav";
  primary.setAttribute("aria-label", "Primary navigation");

  const menuButton = primaryButton("button", "menu", "Menu");
  menuButton.classList.add("mobile-menu-toggle");
  menuButton.type = "button";
  menuButton.setAttribute("aria-expanded", "false");

  const formsMenu = quickMenu("clipboard-list", "Forms", forms, currentFile, "forms");
  const recordsMenu = quickMenu("database", "Records", records, currentFile, "records");
  primary.append(menuButton, formsMenu, recordsMenu);
  actions.prepend(primary);

  let profileFallback = null;
  if (!actions.querySelector(".account-menu")) {
    profileFallback = primaryButton("a", "user-round", "User");
    profileFallback.classList.add("mobile-profile-link");
    profileFallback.href = `./login.html?return=${encodeURIComponent(currentFile)}`;
    profileFallback.setAttribute("aria-label", "Sign in");
    profileFallback.title = "Sign in";
    actions.append(profileFallback);
  }

  const drawer = options.sidebar || createNavigationDrawer(profile, dashboardHref, currentFile);
  drawer.classList.add("app-navigation-drawer");
  if (!drawer.id) drawer.id = "appNavigationDrawer";
  menuButton.setAttribute("aria-controls", drawer.id);

  const drawerHead = document.createElement("div");
  drawerHead.className = "mobile-drawer-head";
  const drawerTitle = document.createElement("strong");
  drawerTitle.textContent = "Menu";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "mobile-drawer-close";
  closeButton.setAttribute("aria-label", "Close menu");
  closeButton.title = "Close menu";
  closeButton.append(createNavIcon("x"));
  drawerHead.append(drawerTitle, closeButton);
  drawer.prepend(drawerHead);

  const overlay = document.createElement("button");
  overlay.type = "button";
  overlay.className = "mobile-drawer-overlay";
  overlay.setAttribute("aria-label", "Close menu");
  overlay.hidden = true;
  document.body.append(overlay);

  const mobileMedia = window.matchMedia(MOBILE_NAV_QUERY);
  let drawerOpen = false;
  const closeQuickMenus = () => {
    primary.querySelectorAll("details[open]").forEach((menu) => { menu.open = false; });
  };
  const setDrawerOpen = (open) => {
    drawerOpen = Boolean(open && mobileMedia.matches);
    drawer.classList.toggle("is-open", drawerOpen);
    document.body.classList.toggle("mobile-menu-open", drawerOpen);
    menuButton.setAttribute("aria-expanded", String(drawerOpen));
    overlay.hidden = !drawerOpen;
    if (mobileMedia.matches) drawer.setAttribute("aria-hidden", String(!drawerOpen));
    else drawer.removeAttribute("aria-hidden");
    if (drawerOpen) {
      closeQuickMenus();
      closeButton.focus();
    }
  };
  const syncHeaderHeight = () => {
    document.documentElement.style.setProperty("--app-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
  };
  const syncViewport = () => {
    if (!mobileMedia.matches) setDrawerOpen(false);
    else drawer.setAttribute("aria-hidden", String(!drawerOpen));
    syncHeaderHeight();
  };

  setDrawerOpen(false);

  menuButton.addEventListener("click", () => setDrawerOpen(!drawerOpen));
  closeButton.addEventListener("click", () => setDrawerOpen(false));
  overlay.addEventListener("click", () => setDrawerOpen(false));
  drawer.addEventListener("click", (event) => {
    if (event.target.closest("a")) setDrawerOpen(false);
  });
  primary.querySelectorAll("details").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      primary.querySelectorAll("details[open]").forEach((other) => {
        if (other !== menu) other.open = false;
      });
      setDrawerOpen(false);
    });
  });
  document.addEventListener("click", (event) => {
    if (!primary.contains(event.target)) closeQuickMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (drawerOpen) {
      setDrawerOpen(false);
      menuButton.focus();
    } else {
      closeQuickMenus();
    }
  });
  mobileMedia.addEventListener?.("change", syncViewport);
  window.addEventListener("resize", syncHeaderHeight);
  requestAnimationFrame(syncViewport);

  header.dataset.appNavigationReady = "true";
  return { drawer, menuButton, primary, profileFallback, setDrawerOpen };
}

export function populateAppSidebar(sidebar, {
  profile = null,
  dashboardHref = dashboardRoute(profile),
  currentFile = window.location.pathname.split("/").pop() || "collection.html"
} = {}) {
  if (!sidebar) return null;
  sidebar.replaceChildren();
  sidebar.classList.add("admin-sidebar");
  sidebar.setAttribute("aria-label", "Application menu");
  appendNavigationLinks(sidebar, profile, dashboardHref, currentFile);
  setupSidebarState(sidebar);
  return sidebar;
}

function setupSidebarState(sidebar) {
  const layout = sidebar.closest(".admin-layout");
  if (!layout) return;

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "admin-sidebar-top";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "admin-sidebar-toggle";
  sidebarHeader.append(toggle);
  sidebar.prepend(sidebarHeader);

  let reveal = layout.querySelector(":scope > .admin-sidebar-reveal");
  if (!reveal) {
    reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "admin-sidebar-reveal";
    reveal.textContent = "Menu";
    layout.insertBefore(reveal, sidebar);
  }

  const applyPinnedState = (isPinned, persist = true) => {
    if (persist) writeStoredValue(SIDEBAR_PINNED_KEY, String(isPinned));
    layout.classList.toggle("admin-sidebar-unpinned", !isPinned);
    toggle.textContent = isPinned ? "Unpin" : "Pin";
    toggle.setAttribute("aria-pressed", String(isPinned));
    reveal.hidden = isPinned;
  };

  const saved = readStoredValue(SIDEBAR_PINNED_KEY);
  applyPinnedState(saved === null ? true : saved !== "false", false);
  toggle.addEventListener("click", () => applyPinnedState(false));
  reveal.addEventListener("click", () => applyPinnedState(true));
  sidebar.dataset.sidebarReady = "true";
}

function primaryButton(tag, icon, label) {
  const element = document.createElement(tag);
  element.className = "mobile-primary-button";
  element.setAttribute("aria-label", label);
  element.title = label;
  const iconElement = document.createElement("span");
  iconElement.className = "mobile-primary-icon";
  iconElement.setAttribute("aria-hidden", "true");
  iconElement.append(createNavIcon(icon));
  const labelElement = document.createElement("span");
  labelElement.className = "mobile-primary-label";
  labelElement.textContent = label;
  element.append(iconElement, labelElement);
  return element;
}

const NAV_ICON_NODES = {
  menu: [
    ["path", { d: "M4 6h16" }],
    ["path", { d: "M4 12h16" }],
    ["path", { d: "M4 18h16" }]
  ],
  "clipboard-list": [
    ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1" }],
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M12 11h4" }],
    ["path", { d: "M12 16h4" }],
    ["path", { d: "M8 11h.01" }],
    ["path", { d: "M8 16h.01" }]
  ],
  database: [
    ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }],
    ["path", { d: "M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" }],
    ["path", { d: "M3 12c0 1.7 4 3 9 3s9-1.3 9-3" }]
  ],
  "user-round": [
    ["circle", { cx: "12", cy: "8", r: "5" }],
    ["path", { d: "M20 21a8 8 0 0 0-16 0" }]
  ],
  x: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }]
  ]
};

function createNavIcon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("data-lucide", name);
  (NAV_ICON_NODES[name] || NAV_ICON_NODES.menu).forEach(([tag, attributes]) => {
    const node = document.createElementNS(namespace, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    svg.append(node);
  });
  return svg;
}

function quickMenu(icon, label, links, currentFile, key) {
  const details = document.createElement("details");
  details.className = `mobile-primary-menu mobile-primary-menu-${key}`;
  const summary = primaryButton("summary", icon, label);
  if (links.some((link) => fileFromHref(link.href) === currentFile)) summary.setAttribute("aria-current", "page");
  const popover = document.createElement("div");
  popover.className = "mobile-primary-popover";
  links.forEach((link) => popover.append(navigationLink(link, currentFile)));
  details.append(summary, popover);
  return details;
}

function createNavigationDrawer(profile, dashboardHref, currentFile) {
  const drawer = document.createElement("aside");
  drawer.className = "admin-sidebar app-navigation-drawer-standalone";
  drawer.setAttribute("aria-label", "Application menu");
  appendNavigationLinks(drawer, profile, dashboardHref, currentFile);
  document.body.append(drawer);
  return drawer;
}

function appendNavigationLinks(drawer, profile, dashboardHref, currentFile) {
  drawer.append(navigationLink({ label: "Dashboard", href: dashboardHref }, currentFile));

  if (hasPermission(profile, "can_view_map")) {
    drawer.append(navigationLink({ label: "Community Map", href: "./admin_map.html" }, currentFile));
  }

  drawer.append(drawerGroup("Forms", formLinks(), currentFile, true));
  drawer.append(drawerGroup("Records", recordLinks(profile), currentFile));

  const registry = permittedLinks(profile, [
    { label: "Aggregators", href: "./admin_aggregators.html", permission: "can_access_admin" },
    { label: "Communities", href: "./admin_community_registry.html", permission: "can_view_registry" },
    { label: "Farmers", href: "./admin_member_registry.html", permission: "can_view_registry" },
    { label: "Admin Users", href: "./admin_users.html", permission: "can_manage_users" }
  ]);
  if (registry.length) drawer.append(drawerGroup("User Registry", registry, currentFile));

  const tools = permittedLinks(profile, [
    { label: "Tags", href: "./tags.html", permission: "can_access_admin" },
    { label: "Settings", href: "./admin_builder.html", permission: "can_manage_settings" },
    { label: "Pricing Matrix", href: "./admin_pricing.html", permission: "can_view_finance" },
    { label: "SMS Settings", href: "./admin_seaweedke.html", permission: "can_manage_sms_settings" }
  ]);
  if (tools.length) drawer.append(drawerGroup("Tools", tools, currentFile));
}

function drawerGroup(label, links, currentFile, defaultOpen = false) {
  const details = document.createElement("details");
  details.className = "admin-menu-group";
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  details.dataset.menuGroup = key;
  const summary = document.createElement("summary");
  summary.textContent = label;
  const content = document.createElement("div");
  content.className = "admin-menu-group-links";
  links.forEach((link) => content.append(navigationLink(link, currentFile)));
  details.append(summary, content);
  const saved = readStoredValue(`${SIDEBAR_GROUP_KEY_PREFIX}${key}`);
  const hasCurrentPage = links.some((link) => fileFromHref(link.href) === currentFile);
  details.open = saved === null ? (defaultOpen || hasCurrentPage) : saved === "true";
  details.addEventListener("toggle", () => {
    writeStoredValue(`${SIDEBAR_GROUP_KEY_PREFIX}${key}`, String(details.open));
  });
  return details;
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Navigation remains usable when storage is unavailable.
  }
}

function navigationLink(link, currentFile) {
  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.textContent = link.label;
  if (fileFromHref(link.href) === currentFile) anchor.setAttribute("aria-current", "page");
  return anchor;
}

function formLinks() {
  return [
    { label: "Collection Form", href: "./collection.html" },
    { label: "Stabilization & Packing", href: "./stabilization_packing.html" },
    { label: "Site Water Sample", href: "./site_water_sample.html" }
  ];
}

function recordLinks(profile) {
  const links = [{ label: "Today's Intake", href: hasPermission(profile, "can_view_data") ? "./admin_today.html" : "./today.html" }];
  return links.concat(permittedLinks(profile, [
    { label: "Collection Ledger", href: "./admin_ledger.html", permission: "can_view_data" },
    { label: "Finance Review", href: "./admin_finance.html", permission: "can_view_finance" },
    { label: "Receipts", href: "./admin_receipts.html", permission: "can_view_data" },
    { label: "Notifications", href: "./admin_notifications.html", permission: "can_view_notifications" }
  ]));
}

function permittedLinks(profile, links) {
  return links.filter((link) => hasPermission(profile, link.permission));
}

function hasPermission(profile, permission) {
  return profile?.app_role === "system_admin" || Boolean(profile?.[permission]);
}

function dashboardRoute(profile) {
  if (!profile) return "./login.html?return=home.html";
  if (profile.app_role === "farmer_viewer") return "./farmer.html";
  if (profile.app_role === "field_collector" || (profile.can_submit_collection && !profile.can_access_admin)) {
    return "./collector_dashboard.html";
  }
  return "./home.html";
}

function fileFromHref(href) {
  try {
    return new URL(href, window.location.href).pathname.split("/").pop() || "index.html";
  } catch {
    return "";
  }
}
