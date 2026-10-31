import {
  authClient, currentSession, currentProfile, setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=16";
import {
  normalizeReleaseItems, selectMetrics, exportSelectedCsv,
  parseReleaseVersion, sourceLabel
} from "./cosme_metrics_core.mjs";

// The COSME register only reads the access-controlled, frozen release RPCs.
// Column choices persist locally; neither workbook data nor grants do.
const el = (id) => document.getElementById(id);
const ACTIVITY_ORDER = ["Solar Drying Tables", "Offshore Nursery", "Aggregation Hub", "Mawimbi"];
const STORAGE_KEY = "seaweed_ag:cosme_metric_columns_v1";
const COLUMN_DEFS = [
  { key: "title", label: "Metric", weight: 28 },
  { key: "activity", label: "Activity", weight: 15 },
  { key: "theme", label: "Theme", weight: 12 },
  { key: "value", label: "Value", weight: 23 },
  { key: "unit", label: "Unit", weight: 12 },
  { key: "dataKind", label: "Data", weight: 10 },
  { key: "id", label: "Metric ID", weight: 11 },
  { key: "source", label: "Source", weight: 27 },
  { key: "note", label: "Notes", weight: 25 },
  { key: "verification", label: "Evidence", weight: 11 },
  { key: "asOf", label: "As of", weight: 16 }
];
const DEFAULT_COLUMNS = ["title", "activity", "theme", "value", "unit", "dataKind"];
let all = [];
let current = null;
let visible = [];
let lastFocus = null;
let access = null;
let initializedNavigation = false;
let sortKey = "id";
let sortDirection = "asc";
let selectedColumns = loadColumns();

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved)) {
      const allowed = new Set(COLUMN_DEFS.map((column) => column.key));
      const valid = saved.filter((key) => allowed.has(key));
      if (valid.length) return new Set(["title", ...valid]);
    }
  } catch { /* Privacy settings may disallow local preferences. */ }
  return new Set(DEFAULT_COLUMNS);
}
function saveColumns() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedColumns])); } catch {}
}
function setStatus(message, error = false, show = true) {
  const node = el("status");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.hidden = !show;
}
function clearPrivateState() {
  all = []; visible = []; current = null; access = null;
  el("rows").replaceChildren();
  el("activityCards").replaceChildren();
  el("app").hidden = true;
  el("accessRole").textContent = "Access unavailable";
  el("releaseCaption").textContent = "";
  el("veil").classList.remove("open");
}
async function requireMetrics() {
  if (!navigator.onLine) throw new Error("Connect to the internet to open project metrics.");
  const session = await currentSession();
  if (!session) {
    window.location.replace("./login.html?return=cosme_metrics.html");
    return null;
  }
  const { data, error } = await authClient.rpc("cosme_metrics_my_access");
  if (error) throw error;
  if (!data?.can_view) throw new Error("Your account does not have Project Metrics access.");
  return data;
}
async function prepareNavigation() {
  if (initializedNavigation) return;
  const profile = await currentProfile(true);
  if (profile) {
    const sidebar = populateAppSidebar(el("cosmeSidebar"), {
      profile, dashboardHref: "./home.html"
    });
    setupAccountControls(profile);
    setupAppNavigation({ profile, sidebar, dashboardHref: "./home.html" });
  }
  initializedNavigation = true;
  document.body.removeAttribute("data-auth-pending");
}
async function loadReleases() {
  const { data, error } = await authClient.rpc("cosme_metrics_list_releases");
  if (error) throw error;
  const select = el("version");
  select.replaceChildren();
  for (const release of Array.isArray(data) ? data : []) {
    const opt = document.createElement("option");
    opt.value = String(release.major) + "." + String(release.minor);
    opt.textContent = release.version + " · " + (release.purpose || "Published");
    select.append(opt);
  }
}
async function loadRelease(version = null) {
  const params = version ? { p_major: version[0], p_minor: version[1] } : {};
  const { data, error } = await authClient.rpc("cosme_metrics_get_release", params);
  if (error) throw error;
  current = data;
  if (data?.status !== "published") {
    all = [];
    setStatus("No metrics release is currently available.");
    el("releaseCaption").textContent = "Not yet published";
    render();
    return;
  }
  all = normalizeReleaseItems(data.items).map((m) => ({
    ...m, dataKind: sourceLabel(m), liveValidated: false
  }));
  el("releaseCaption").textContent = data.version + " · " +
    (data.published_at ? new Date(data.published_at).toLocaleDateString() : "");
  el("historyInfo").textContent = "Purpose: " + (data.purpose || "Reference") +
    " · Reporting cut-off: " + (data.reporting_cutoff || "not specified") +
    " · " + all.length + " frozen metrics.";
  el("version").value = String(data.major) + "." + String(data.minor);
  setStatus("", false, false);
  render();
}
function tab(name) {
  for (const button of document.querySelectorAll(".metrics-tabs .tab")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const view of ["overview", "register", "history"]) el(view).hidden = view !== name;
  if (name === "register") renderRows();
}
function add(parent, tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = String(value ?? "");
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function render() {
  const activity = el("activity");
  const previous = activity.value;
  activity.replaceChildren();
  const any = document.createElement("option");
  any.value = ""; any.textContent = "All activities"; activity.append(any);
  const activities = [...ACTIVITY_ORDER, ...new Set(all.map((m) => m.activity)
    .filter((name) => !ACTIVITY_ORDER.includes(name)))];
  for (const name of activities) {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name; activity.append(opt);
  }
  activity.value = activities.includes(previous) ? previous : "";
  const cards = el("activityCards");
  cards.replaceChildren();
  for (const name of activities) {
    const rows = all.filter((metric) => metric.activity === name);
    const button = document.createElement("button");
    button.className = "metrics-activity-card";
    add(button, "strong", name);
    add(button, "span", rows.length + " metrics", "metrics-big");
    add(button, "span", rows.filter((metric) => metric.featured).length + " Top Picks", "metrics-muted");
    button.addEventListener("click", () => {
      activity.value = name;
      tab("register");
      renderRows();
    });
    cards.append(button);
  }
  renderRows();
}
function renderColumnChoices() {
  const options = el("columnOptions");
  options.replaceChildren();
  for (const column of COLUMN_DEFS) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedColumns.has(column.key);
    checkbox.disabled = column.key === "title";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedColumns.add(column.key);
      else selectedColumns.delete(column.key);
      saveColumns();
      renderRows();
    });
    label.append(checkbox, document.createTextNode(column.label));
    options.append(label);
  }
}
function renderRows() {
  const query = el("search").value.trim().toLocaleLowerCase();
  visible = selectMetrics(all, {
    query, activity: el("activity").value,
    featured: el("featured").checked, sort: sortKey, direction: sortDirection
  });
  const cols = COLUMN_DEFS.filter((column) => selectedColumns.has(column.key));
  const table = el("metricHead").closest("table");
  table.querySelector("colgroup")?.remove();
  const group = document.createElement("colgroup");
  const totalWeight = cols.reduce((sum, column) => sum + column.weight, 0);
  for (const col of cols) {
    const node = document.createElement("col");
    node.style.width = String(col.weight * 100 / totalWeight) + "%";
    group.append(node);
  }
  table.prepend(group);
  const head = el("metricHead");
  head.replaceChildren();
  for (const column of cols) {
    const th = document.createElement("th");
    th.scope = "col";
    th.setAttribute("aria-sort", sortKey === column.key ?
      (sortDirection === "asc" ? "ascending" : "descending") : "none");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = column.label + (sortKey === column.key ?
      (sortDirection === "asc" ? " ↑" : " ↓") : "");
    button.title = "Sort by " + column.label;
    button.addEventListener("click", () => {
      if (sortKey === column.key) sortDirection = sortDirection === "asc" ? "desc" : "asc";
      else { sortKey = column.key; sortDirection = "asc"; }
      renderRows();
    });
    th.append(button);
    head.append(th);
  }
  const tbody = el("rows");
  tbody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const metric of visible) {
    const row = document.createElement("tr");
    for (const col of cols) {
      const cell = document.createElement("td");
      cell.dataset.col = col.key;
      const value = String(metric[col.key] ?? "");
      cell.title = value;
      if (col.key === "title") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "metric-open";
        button.textContent = value;
        button.title = value + " · open details";
        button.addEventListener("click", () => openMetric(metric, button));
        cell.append(button);
      } else if (col.key === "dataKind") {
        add(cell, "span", value, "metrics-type" + (value === "Live" ? " is-live" : ""));
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    }
    fragment.append(row);
  }
  tbody.append(fragment);
  el("count").textContent = visible.length + " of " + all.length +
    " metrics · " + (current?.version || "No release") +
    " · Click a column heading to sort";
  el("empty").hidden = visible.length > 0;
}
function openMetric(metric, button) {
  lastFocus = button;
  el("metricTitle").textContent = metric.title;
  const details = el("detail");
  details.replaceChildren();
  const fields = [
    ["Metric ID", metric.id],
    ["Activity", metric.activity],
    ["Theme", metric.theme],
    ["Value", metric.value],
    ["Unit / basis", metric.unit],
    ["Data", metric.dataKind],
    ["Claim basis", metric.basis],
    ["Evidence state", metric.verification],
    ["Original workbook evidence", metric.originalEvidence],
    ["Value availability", metric.valueState],
    ["Source worksheet", metric.sourceSheet],
    ["Source row", metric.sourceRow],
    ["As of", metric.asOf],
    ["Source", metric.source],
    ["Notes", metric.note],
    ["Published in", current?.version || ""]
  ];
  for (const [label, value] of fields) {
    add(details, "dt", label);
    add(details, "dd", value);
  }
  el("veil").classList.add("open");
  el("close").focus();
}
function closeMetric() {
  el("veil").classList.remove("open");
  lastFocus?.focus();
}
function exportCsv() {
  if (!current || !visible.length) return;
  const csv = exportSelectedCsv(visible, current.version || "");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "COSME_Metrics_" + (current.version || "unpublished") + "_selected.csv";
  link.click();
  URL.revokeObjectURL(url);
}
async function reloadAndRecheck() {
  const grant = await requireMetrics();
  if (!grant) return;
  access = grant;
  el("accessRole").textContent = "Metrics " + grant.role;
  await prepareNavigation();
  const previousVersion = current?.status === "published" ?
    [current.major, current.minor] : null;
  await loadReleases();
  await loadRelease(previousVersion);
  el("app").hidden = false;
}
for (const button of document.querySelectorAll(".metrics-tabs .tab")) {
  button.addEventListener("click", () => tab(button.dataset.tab));
}
for (const name of ["search", "activity", "featured"]) {
  el(name).addEventListener("input", renderRows);
}
el("openRegister").addEventListener("click", () => tab("register"));
el("reset").addEventListener("click", () => {
  el("search").value = "";
  el("activity").value = "";
  el("featured").checked = false;
  sortKey = "id"; sortDirection = "asc";
  selectedColumns = new Set(DEFAULT_COLUMNS);
  saveColumns();
  renderColumnChoices();
  renderRows();
});
el("exportCsv").addEventListener("click", exportCsv);
el("selectVersion").addEventListener("click", async () => {
  const version = parseReleaseVersion(el("version").value);
  if (!version) {
    setStatus("Choose a published release.", true);
    return;
  }
  try { await loadRelease(version); }
  catch (error) { setStatus(error.message, true); }
});
el("close").addEventListener("click", closeMetric);
el("veil").addEventListener("click", (event) => {
  if (event.target === el("veil")) closeMetric();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && el("veil").classList.contains("open")) closeMetric();
});
document.addEventListener("click", (event) => {
  const menu = el("columnMenu");
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && access) {
    reloadAndRecheck().catch((error) => {
      clearPrivateState();
      setStatus(error.message, true);
    });
  }
});
authClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    clearPrivateState();
    setStatus("Signed out.", true);
  }
});
renderColumnChoices();
reloadAndRecheck().catch((error) => {
  document.body.removeAttribute("data-auth-pending");
  clearPrivateState();
  setStatus(error.message || "Metrics could not be loaded.", true);
});
