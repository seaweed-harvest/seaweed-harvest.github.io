import {
  authClient, currentSession, currentProfile, setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=17";
import {
  normalizeReleaseItems, selectMetrics,
  parseReleaseVersion, sourceLabel, displayMetricValue, metricValueType, financialContext, currentDryerWeightReduction, metricCategory
} from "./cosme_metrics_core.mjs?v=3";
import { createSharedPicks } from "./cosme_metrics_picks.mjs?v=1";
import { liveStatus, displayValue, exportMetricViewCsv } from "./cosme_metrics_live_values.mjs?v=2";
import { populatedMetrics, concisePickStatus, metricEvidence } from "./cosme_metrics_presentation.js?v=1";
import { createNurseryGrowthPanel } from "./cosme_nursery_growth.mjs?v=4";
import { createMawimbiOperationsPanel } from "./cosme_mawimbi_operations.mjs?v=1";
import { createMawimbiStockQcPanel } from "./cosme_mawimbi_stock_qc.mjs?v=1";
import { createMawimbiTraceabilityPanel } from "./cosme_mawimbi_traceability.mjs?v=1";
import { createMetricsTimeline } from "./cosme_metrics_timeline.mjs?v=3";
import { createCosmeFinancesPanel } from "./cosme_finances_panel.mjs?v=7";
import { createProjectLibrary } from "./cosme_project_library.mjs?v=13";
import { createMetricEvidenceReview } from "./cosme_metric_evidence_review.mjs?v=1";
import { createOperationalIndicators } from "./cosme_operational_indicators.mjs?v=2";
import { metricDisplayName, withMetricPresentation } from "./cosme_metrics_labels.mjs?v=1";

// Published values remain immutable. Shared picks are a separate authorised layer.
// Only column choices persist locally; metric data and picks never do.
const el = (id) => document.getElementById(id);
const sharedPicks=createSharedPicks(authClient,()=>{
  all=sharedPicks.apply(all);
  for(const id of ["picksStatusRegister"]){
    const message=concisePickStatus(sharedPicks.message());
    el(id).textContent=message;el(id).hidden=!message;
  }
  render();
});
const nurseryGrowthPanel = createNurseryGrowthPanel(authClient,el("currentNurseryGrowth"));
const mawimbiPanel = createMawimbiOperationsPanel(authClient,el("currentMawimbiOperations"));
const mawimbiQcPanel = createMawimbiStockQcPanel(authClient,el("currentMawimbiStockQc"));
const traceabilityPanel = createMawimbiTraceabilityPanel(authClient,el("currentMawimbiTraceability"));
const timelinePanel = createMetricsTimeline(authClient,el("metricsTimeline"),(id,button)=>{
  const metric=all.find(item=>item.id===id);
  if(metric)openMetric(metric,button);
});
const financesPanel = createCosmeFinancesPanel(authClient,el("cosmeFinances"));
let financesLoaded = false;
const libraries={reports:createProjectLibrary(authClient,el("projectReports"),"reports"),photos:createProjectLibrary(authClient,el("projectPhotos"),"photos")};
const metricEvidenceReview=createMetricEvidenceReview(authClient,el("metricLinkedPhotos"),el("metricProposalReview"));
const librariesLoaded=new Set();
const LAST_METRICS_TAB = "seaweed-ag:cosme-last-tab";
let initialTabRestored = false;
const ACTIVITY_ORDER = ["Solar Drying Tables", "Offshore Nursery", "Aggregation Hub", "Mawimbi", "Off-bottom Farming"];
const STORAGE_KEY = "seaweed_ag:cosme_metric_columns_v2";
const HIDDEN_KEY_PREFIX = "seaweed_ag:cosme_hidden_metric_ids_v1:";
const COLUMN_DEFS = [
  { key: "title", label: "Metric", weight: 28 },
  { key: "activity", label: "Activity", weight: 15 },
  { key: "theme", label: "Category", weight: 12 },
  { key: "value", label: "Value", weight: 23 },
  { key: "unit", label: "Unit", weight: 12 },
  { key: "dataKind", label: "Data", weight: 10 },
  { key: "valueType", label: "Value type", weight: 14 },
  { key: "id", label: "Metric ID", weight: 11 },
  { key: "source", label: "Source", weight: 27 },
  { key: "note", label: "Notes", weight: 25 },
  { key: "verification", label: "Evidence", weight: 11 },
  { key: "asOf", label: "As of", weight: 16 },
  { key: "hide", label: "Hide", weight: 5 }
];
const DEFAULT_COLUMNS = ["title", "activity", "theme", "value"];
let all = [];
let current = null;
let visible = [];
let lastFocus = null;
let access = null;
let currentRopeCoverage = null;
let currentDryerMetrics = null;
let currentDryerError = "";
let operationalIndicators = [];
let operationalIndicatorsError = "";
let currentCoverageError = "";
let initializedNavigation = false;
let sortKey = "metricType";
let sortDirection = "asc";
let selectedColumns = loadColumns();
let selectedCategories = new Set();
let detailMetricId=null;
let releaseLoad=0;
let latestReleaseKey=null;
let prefersLiveValues=true;
let liveRefreshInFlight=null;
let hiddenMetricIds=new Set();
let mobileLiveOnly=false;
let preferenceUserId=null;
function preferencesKey(){return preferenceUserId?HIDDEN_KEY_PREFIX+preferenceUserId:null;}
function loadHiddenMetrics(){
  try {
    const value=JSON.parse(localStorage.getItem(preferencesKey())||"[]");
    hiddenMetricIds=new Set(Array.isArray(value) ? value.filter(
      x=>typeof x==="string" && /^(?:LIVE-)?[A-Z]+-[A-Z0-9-]{1,32}$/.test(x)).slice(0,1000):[]);
  } catch { hiddenMetricIds=new Set(); }
}
function saveHiddenMetrics(){
  try {const key=preferencesKey();if(key)localStorage.setItem(key,JSON.stringify([...hiddenMetricIds]));}catch {}
}
function hideMetric(id){
  if(!preferenceUserId)return;
  hiddenMetricIds.add(id);saveHiddenMetrics();renderRows();
}
function restoreMetric(id){
  hiddenMetricIds.delete(id);saveHiddenMetrics();renderRows();
}
function restoreAllHidden(){
  hiddenMetricIds.clear();saveHiddenMetrics();renderRows();
}
function renderHiddenMetricMenu(){
  const list=el("hiddenMetricList");
  list.replaceChildren();
  const hidden=[...all,...operationalIndicators].filter(m=>hiddenMetricIds.has(m.id));
  el("hiddenMetricSummary").textContent="Hidden"+(hidden.length?" · "+hidden.length:"");
  el("restoreAllHidden").disabled=!hiddenMetricIds.size;
  if(!hidden.length){
    add(list,"p","No hidden metrics.","metrics-small-note");
    return;
  }
  for(const metric of hidden.sort((a,b)=>metricDisplayName(a).localeCompare(metricDisplayName(b)))){
    const item=add(list,"div","","metrics-hidden-item");
    const label=add(item,"span",metricDisplayName(metric));
    label.title=metric.id;
    const button=add(item,"button","Restore","metrics-button");
    button.type="button";button.setAttribute("aria-label","Restore "+metricDisplayName(metric));
    button.addEventListener("click",()=>restoreMetric(metric.id));
  }
}

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
  releaseLoad++;
  sharedPicks.clear();
  detailMetricId=null;
  all = []; visible = []; current = null; access = null;
  preferenceUserId=null; hiddenMetricIds.clear();
  mobileLiveOnly=false;
  latestReleaseKey=null;
  prefersLiveValues=true;
  currentRopeCoverage = null; currentCoverageError = "";
  currentDryerMetrics = null; currentDryerError = "";
  operationalIndicators = []; operationalIndicatorsError = "";
  nurseryGrowthPanel.clear();
  mawimbiPanel.clear();
  mawimbiQcPanel.clear();
  traceabilityPanel.clear();
  timelinePanel.clear();
  financesPanel.clear();
  financesLoaded = false;
  Object.values(libraries).forEach(panel=>panel.clear());
  metricEvidenceReview.clear();
  librariesLoaded.clear();
  el("rows").replaceChildren();
  el("activityCards").replaceChildren();

  el("detail").replaceChildren();
  el("metricMetadata").replaceChildren();
  el("metricEvidence").replaceChildren();
  el("metricTitle").textContent="";

  el("metricsConnectionStatus").replaceChildren();
  el("app").hidden = true;
  el("accessRole").textContent = "Access unavailable";
  el("releaseCaption").textContent = "";
  el("overviewRegisterFacts").replaceChildren();
  el("veil").classList.remove("open");
  el("metricsStickyScroll").hidden = true;
}
async function requireMetrics() {
  if (!navigator.onLine) throw new Error("Connect to the internet to open project metrics.");
  const session = await currentSession();
  if (!session) {
    window.location.replace("./login.html?return=cosme_metrics.html");
    return null;
  }
  const newUserId=session.user?.id||null;
  if(preferenceUserId!==newUserId){
    preferenceUserId=newUserId;
    loadHiddenMetrics();
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
  const request=++releaseLoad;
  sharedPicks.clear();
  const params = version ? { p_major: version[0], p_minor: version[1] } : {};
  const { data, error } = await authClient.rpc("cosme_metrics_get_release", params);
  if (error) throw error;
  if(request!==releaseLoad) return;
  current = data;
  if(!version && data?.status === "published")
    latestReleaseKey = String(data.major)+"."+String(data.minor);
  if (data?.status !== "published") {
    all = [];
    timelinePanel.setRelease([]);
    setStatus("No metrics release is currently available.");
    el("releaseCaption").textContent = "Not yet published";
    render();
    return;
  }
  const evidenceById=new Map((data.items||[]).map(item=>[String(item.metric_id),metricEvidence(item.frozen?.source_evidence)]));
  all = normalizeReleaseItems(data.items).map((m) => ({
    ...m, theme:metricCategory(m.theme,m.id), publishedFeatured:m.featured,
    evidence:evidenceById.get(m.id)||null,
    dataKind: sourceLabel(m), valueType: metricValueType(m), liveValidated: false
  }));
  timelinePanel.setRelease(all);
  el("releaseCaption").textContent = data.version + " · " +
    (data.published_at ? new Date(data.published_at).toLocaleDateString() : "");
  el("historyInfo").textContent = "Purpose: " + (data.purpose || "Reference") +
    " · Reporting cut-off: " + (data.reporting_cutoff || "not specified") +
    " · " + all.length + " frozen metrics.";
  el("version").value = String(data.major) + "." + String(data.minor);
  el("showLiveValues").disabled=!isLatestRelease();
  el("showLiveValues").checked=isLatestRelease() && prefersLiveValues;
  setStatus("", false, false);
  render();
  await sharedPicks.load(data,all);
}
/** An overlay is eligible only on the current release and after validated RPC reads. */
function isLatestRelease() {
  return current?.status==="published" &&
    String(current.major)+"."+String(current.minor)===latestReleaseKey;
}
function currentStatus(metric) {
  if(metric.operationalLive) return {kind:"live", source:metric.liveCurrent.source,
    currentValue:metric.liveCurrent};
  return liveStatus(metric.id,{
    dryer:currentDryerMetrics,coverage:currentRopeCoverage,
    mawimbiContext:id=>mawimbiPanel.metricContext(id)||mawimbiQcPanel.metricContext(id)
  });
}
function metricDisplay(metric) {
  return displayValue(metric,currentStatus(metric),
    metric.operationalLive || el("showLiveValues").checked,isLatestRelease());
}
function currentLinkSource(metric) {
  return currentStatus(metric).source;
}
// Anchor the table's *scrolling viewport* to the visible screen bottom on
// desktop, so large registers scroll inside the table rather than pushing the
// horizontal scrollbar pages below. Never resize during vertical page scroll.
function sizeRegisterViewport(){
  if(el("app").hidden||el("register").hidden||window.innerWidth<700)return;
  const wrap=el("metricScrollArea");
  const top=wrap.getBoundingClientRect().top;
  const available=window.innerHeight-top-25;
  if(top>=0 && available>=280){
    wrap.style.height=Math.min(920,Math.max(280,Math.floor(available)))+"px";
  }
}
function syncStickyScrollbar() {
  const wrap=el("metricScrollArea"), bar=el("metricsStickyScroll");
  const rect=wrap.getBoundingClientRect();
  const active=!el("app").hidden && !el("register").hidden
    && rect.top<window.innerHeight && rect.bottom>0
    && wrap.scrollWidth>wrap.clientWidth+2;
  bar.hidden=!active;
  if(!active)return;
  const left=Math.max(0,rect.left), right=Math.min(window.innerWidth,rect.right);
  bar.style.left=left+"px";
  bar.style.width=Math.max(0,right-left)+"px";
  el("metricsStickyWidth").style.width=wrap.scrollWidth+"px";
  if(bar.scrollLeft!==wrap.scrollLeft)bar.scrollLeft=wrap.scrollLeft;
}
function tab(name) {
  if(name==="current")name="register";
  try { localStorage.setItem(LAST_METRICS_TAB,name); } catch {}
  if(name==="proposals" && !["owner","editor"].includes(access?.role))name="overview";
  for (const button of document.querySelectorAll(".metrics-tabs .tab")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const view of ["overview", "register", "current", "timeline", "finances", "reports", "photos", "proposals", "history"]) el(view).hidden = view !== name;
  if(name==="proposals" && access && !metricEvidenceReview.draftsLoaded())
    metricEvidenceReview.loadDrafts();
  if(libraries[name]&&access&&!librariesLoaded.has(name)){
    librariesLoaded.add(name);libraries[name].load();
  }
  if(name==="photos")requestAnimationFrame(()=>libraries.photos.refreshMap?.());
  if (name === "finances" && access && !financesLoaded) {
    financesLoaded = true;
    financesPanel.load();
  }
  if (name === "register") renderRows();
  requestAnimationFrame(()=>{sizeRegisterViewport();syncStickyScrollbar();});
}
function add(parent, tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = String(value ?? "");
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function render() {
  const populated=[...populatedMetrics(all),...(isLatestRelease()?operationalIndicators:[])];
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
    const rows = populated.filter((metric) => metric.activity === name);
    const button = document.createElement("button");
    button.className = "metrics-activity-card";
    const [tone,symbol]=({
      "Solar Drying Tables":["dryer","☀"],
      "Offshore Nursery":["nursery","≈"],
      "Aggregation Hub":["aggregation","▦"],
      "Mawimbi":["mawimbi","❧"],
      "Off-bottom Farming":["farming","≋"]
    })[name]||["other","○"];
    button.dataset.activityTone=tone;
    const heading=add(button,"div","","metrics-activity-heading");
    const mark=add(heading,"span",symbol,"metrics-activity-icon");
    mark.setAttribute("aria-hidden","true");
    add(heading,"strong",name);
    add(button, "span", rows.length + " metrics", "metrics-big");
    button.addEventListener("click", () => {
      activity.value = name;
      tab("register");
      renderRows();
    });
    cards.append(button);
  }
  renderCategoryChoices();
  renderRegisterSummary();
  renderCurrentRopeCoverage();
  renderCurrentDryerMetrics();
  renderRows();
  const detailMetric=all.find(m=>m.id===detailMetricId);
  if(detailMetric){
    configureStar(el("detailStar"),detailMetric);
    const detailSelection=el("metricMetadata").querySelector("[data-shared-selection]");
    if(detailSelection) detailSelection.textContent=detailMetric.featured?"Yes":"No";
  }
}
function configureStar(button,metric){
  button.className="metrics-star";
  button.dataset.metricStar=metric.id;
  button.textContent=metric.featured?"★":"☆";
  button.setAttribute("aria-pressed",String(metric.featured));
  button.setAttribute("aria-label",(metric.featured?"Remove ":"Add ")+metricDisplayName(metric)+
    (metric.featured?" from":" to")+" shared Top Picks");
  button.title=sharedPicks.editable()?button.getAttribute("aria-label"):sharedPicks.message();
  button.disabled=Boolean(metric.operationalLive)||!sharedPicks.editable();
  if(metric.operationalLive)button.title="Top Picks only apply to published metrics";
  button.setAttribute("aria-busy",String(sharedPicks.busy(metric.id)));
}
async function togglePick(id,context="rows"){
  await sharedPicks.toggle(id);
  const root=context==="detail"?el("detailStar"):el(context);
  const target=context==="detail"?root:[...root.querySelectorAll("[data-metric-star]")].find(b=>b.dataset.metricStar===id);
  if(target&&!target.disabled) target.focus();
  else el("featured").focus();
}
function renderRegisterSummary(){
  const root=el("overviewRegisterFacts");
  root.replaceChildren();
  const publishedAt=current?.published_at&&Number.isFinite(Date.parse(current.published_at))
    ?new Date(current.published_at).toLocaleString():"Not recorded";
  for(const [name,value] of [
    ["Published metrics",all.length.toLocaleString()],
    ["Live indicators",isLatestRelease()?operationalIndicators.length.toLocaleString():"—"],
    ["Release",current?.version||"—"],
    ["Last published",publishedAt],
    ["Published by","Not recorded"]
  ]){
    const fact=add(root,"div","","metrics-register-fact");
    add(fact,"span",name);
    add(fact,"strong",value);
  }
}

/** An additional current, access-controlled aggregate; never overwrite V0.1. */
async function loadCurrentRopeCoverage() {
  currentRopeCoverage = null;
  currentCoverageError = "";
  try {
    const {data,error} = await authClient.rpc("cosme_metrics_live_rope_coverage");
    if(error) throw error;
    if(!data?.can_view || data.metric_id !== "ON-0054"
       || !Number.isSafeInteger(data.rope_count) || data.rope_count < 0
       || !Number.isSafeInteger(data.site_count) || data.site_count < 0
       || !Number.isFinite(Date.parse(data.queried_at))
       || (data.source_updated_at && !Number.isFinite(Date.parse(data.source_updated_at)))){
      throw new Error("The current nursery dataset could not be verified.");
    }
    currentRopeCoverage = data;
  } catch {
    currentCoverageError = "Current nursery coverage is unavailable.";
  }
  renderCurrentRopeCoverage();
}
function renderCurrentRopeCoverage() {
  const parent = el("currentNurseryCoverage");
  parent.replaceChildren();
  const source = all.find(metric => metric.id === "ON-0054");
  if(!source) return;
  const container = add(parent,"section","","metrics-current-panel");
  const heading = add(container,"div","","metrics-current-heading");
  add(heading,"h4","Nursery sample-rope coverage");
  const originalVersion = current?.version || "selected release";
  if(!currentRopeCoverage){
    add(container,"p",currentCoverageError || "Reading current coverage…","metrics-small-note");
    return;
  }
  const cards = add(container,"div","","metrics-current-comparison");
  const old = add(cards,"div","","metrics-current-side");
  add(old,"span","Published " + originalVersion,"metrics-current-label");
  add(old,"strong",source.value || "Not recorded");
  add(old,"span","Historical workbook figure","metrics-current-note");
  const latest = add(cards,"div","","metrics-current-side");
  add(latest,"span","Current · Verified aggregate","metrics-current-label metrics-current-verified");
  add(latest,"strong",currentRopeCoverage.rope_count+" ropes / "+currentRopeCoverage.site_count+" sites");
  add(latest,"span","Active COSME rope positions with initial weight; deleted rows excluded","metrics-current-note");
  const lastDate = currentRopeCoverage.source_updated_at ?
    new Date(currentRopeCoverage.source_updated_at).toLocaleString() : "unknown";
  add(container,"p","Source last updated: "+lastDate+" · Queried: "+
    new Date(currentRopeCoverage.queried_at).toLocaleString(),
    "metrics-small-note");
}

/** Independently authorised live aggregate. Never mutates a published metric. */
async function loadCurrentDryerMetrics() {
  currentDryerMetrics = null;
  currentDryerError = "";
  try {
    const {data,error} = await authClient.rpc("cosme_metrics_live_dryer_metrics");
    if(error) throw error;
    const required=["SDT-0063","SDT-0064","SDT-0065","SDT-0066"];
    const validCount=value=>Number.isSafeInteger(value)&&value>=0;
    const validWeight=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0;
    if(!data?.can_view || data.status!=="current"
      || !Array.isArray(data.metric_ids)
      || required.some(id=>!data.metric_ids.includes(id))
      || !validCount(data.completed_cycles)
      || !validCount(data.completed_bays)
      || !validCount(data.excluded_completed)
      || !validWeight(data.wet_kg)
      || !validWeight(data.final_kg)
      || data.final_kg>data.wet_kg
      || !Number.isFinite(Date.parse(data.queried_at))
      || (data.source_updated_at && !Number.isFinite(Date.parse(data.source_updated_at)))){
      throw new Error("Current dryer measurements could not be validated.");
    }
    const reduction=currentDryerWeightReduction(data);
    if(reduction === null) throw new Error("Current dryer mass ratio is invalid.");
    currentDryerMetrics = {...data, wet_weight_reduction_pct:reduction};
  } catch {
    currentDryerError = "Current dryer measurements are unavailable.";
  }
  renderCurrentDryerMetrics();
}
const DRYER_COMPARE = [
  {id:"SDT-0063",key:"completed_cycles",unit:"cycles"},
  {id:"SDT-0064",key:"completed_bays",unit:"bay records"},
  {id:"SDT-0065",key:"wet_kg",unit:"kg"},
  {id:"SDT-0066",key:"final_kg",unit:"kg"},
  {id:"SDT-0022",key:"wet_weight_reduction_pct",unit:"%"}
];
function renderCurrentDryerMetrics() {
  const parent = el("currentDryerMetrics");
  parent.replaceChildren();
  const sources = DRYER_COMPARE.map(item=>({
    ...item, metric:all.find(m=>m.id===item.id)
  }));
  if(sources.some(x=>!x.metric))return;
  const panel = add(parent,"section","","metrics-current-panel");
  const heading = add(panel,"div","","metrics-current-heading");
  add(heading,"h4","COSME drying-table results");
  if(!currentDryerMetrics){
    add(panel,"p",currentDryerError||"Reading current dryer records…","metrics-small-note");
    return;
  }
  const tableWrap=add(panel,"div","","metrics-dryer-comparison-wrap");
  const table=add(tableWrap,"table","","metrics-dryer-comparison");
  const thead=add(table,"thead");
  const headingRow=add(thead,"tr");
  for(const label of ["Metric","Published "+(current?.version||"release"),"Current · Verified"]){
    const th=add(headingRow,"th",label);
    th.scope="col";
  }
  const tbody=add(table,"tbody");
  for(const item of sources){
    const row=add(tbody,"tr");
    const name=add(row,"th",metricDisplayName(item.metric));
    name.scope="row";
    const historical=displayMetricValue(item.metric.value,item.metric.unit).full;
    add(row,"td",historical);
    const latest=displayMetricValue(currentDryerMetrics[item.key],item.unit).full;
    add(row,"td",latest,"metrics-current-verified-value");
  }
  add(panel,"p",
    "Completed, confirmed Bati COSME tables only (not Dryer Shed). All bays require at least 12 hours drying and weight reduction; intermediate reweighs are not added. "+
    currentDryerMetrics.excluded_completed+" completed records excluded by these checks. Wet-weight reduction is not measured final moisture content.",
    "metrics-small-note");
  const modified=currentDryerMetrics.source_updated_at ?
    new Date(currentDryerMetrics.source_updated_at).toLocaleString():"Unknown";
  add(panel,"p","Source last updated: "+modified+" · Queried: "+
    new Date(currentDryerMetrics.queried_at).toLocaleString(),
    "metrics-small-note");
}
function renderCategoryChoices() {
  const options = el("categoryOptions");
  options.replaceChildren();
  const activity = el("activity").value;
  const featured = el("featured").checked;
  const counts = new Map();
  for (const metric of [...populatedMetrics(all),...(isLatestRelease()?operationalIndicators:[])]) {
    if (activity && metric.activity !== activity) continue;
    if (featured && !metric.featured) continue;
    const category = metric.theme || "Uncategorised";
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  // Remove selections that cannot match the current activity / featured scope.
  selectedCategories = new Set([...selectedCategories].filter((name) => counts.has(name)));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "metrics-category-clear";
  reset.textContent = "All categories";
  reset.disabled = selectedCategories.size === 0;
  reset.addEventListener("click", () => {
    selectedCategories.clear();
    renderCategoryChoices();
    renderRows();
  });
  options.append(reset);
  for (const [category, count] of [...counts].sort(([a],[b]) => a.localeCompare(b, undefined, {numeric:true}))) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedCategories.has(category);
    input.addEventListener("change", () => {
      if (input.checked) selectedCategories.add(category);
      else selectedCategories.delete(category);
      updateCategorySummary();
      renderRows();
    });
    const name = document.createElement("span");
    name.textContent = category;
    const number = document.createElement("small");
    number.textContent = String(count);
    number.className = "metrics-category-count";
    label.append(input, name, number);
    options.append(label);
  }
  updateCategorySummary();
}
function updateCategorySummary() {
  const summary = el("categorySummary");
  const count = selectedCategories.size;
  summary.textContent = count === 0 ? "All categories" :
    count === 1 ? [...selectedCategories][0] : count + " categories";
  summary.title = count ? [...selectedCategories].join(", ") : "Show every category";
  summary.classList.toggle("has-selection", count > 0);
}
/** Never imply that frozen Mawimbi or Aggregation Hub claims are connected. */
function renderConnectionStatus() {
  const root = el("metricsConnectionStatus");
  root.replaceChildren();
  const statuses = [
    ["Solar Drying Tables", Boolean(currentDryerMetrics),
     currentDryerMetrics ? "5 current calculations" : "Current feed unavailable"],
    ["Offshore Nursery", Boolean(currentRopeCoverage || nurseryGrowthPanel.isConnected()),
     nurseryGrowthPanel.isConnected() ? "Sample-rope coverage and growth" :
     currentRopeCoverage ? "Sample-rope coverage only" : "Current feed unavailable"],
    ["Mawimbi", mawimbiPanel.isConnected() || mawimbiQcPanel.isConnected(),
      mawimbiPanel.isConnected() && mawimbiQcPanel.isConnected() ?
        "Collection, processing and stock QC records" :
      mawimbiPanel.isConnected() ? "Collection and processing records" :
      mawimbiQcPanel.isConnected() ? "Stock QC records only" : "Reference only / owner-only feed"],
    ["Aggregation Hub", false, "Historical reference only"]
  ];
  for (const [name,connected,note] of statuses) {
    const line = document.createElement("div");
    line.className = "metrics-connection-item";
    const title = document.createElement("strong");
    title.textContent = name;
    const status = document.createElement("span");
    status.className = connected ? "metrics-connection-live" : "metrics-connection-reference";
    status.textContent = note;
    line.append(title,status);
    root.append(line);
  }
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
// Phone cards share the same filtered metrics, current-value overlay and detail dialog.
function renderMobileRows(){
  const list=el("mobileMetricList");
  const fragment=document.createDocumentFragment();
  let previousType="";
  for(const metric of visible){
    const typeKey=metric.activity+" · "+metric.metricType;
    if(sortKey==="metricType" && typeKey!==previousType){
      add(fragment,"h3",typeKey,"metrics-group-label");
      previousType=typeKey;
    }
    const status=currentStatus(metric);
    const overlay=metricDisplay(metric);
    const formatted=displayMetricValue(overlay.value,overlay.unit);
    const state=overlay.state==="Live" ? "Live" :
      isLatestRelease() && status.kind==="live" ? "Live available" :
      isLatestRelease() && status.kind==="linked" ? "Linked" : "Published";
    const card=add(fragment,"article","","metrics-mobile-card");
    if(state==="Live")card.classList.add("metrics-mobile-card-live");
    else if(state==="Linked")card.classList.add("metrics-mobile-card-linked");
    const star=add(card,"button","","metrics-star");
    star.type="button";configureStar(star,metric);
    if(!metric.operationalLive)star.addEventListener("click",()=>togglePick(metric.id));
    const open=add(card,"button","","metrics-mobile-card-open");
    open.type="button";
    open.setAttribute("aria-label",(metric.displayTitle||metric.title)+" · "+formatted.full+" · open metric details");
    open.addEventListener("click",()=>openMetric(metric,open));
    const body=add(open,"span","","metrics-mobile-card-body");
    add(body,"span",metric.displayTitle||metric.title,"metrics-mobile-card-title");
    const meta=add(body,"span","","metrics-mobile-card-meta");
    add(meta,"span",metric.activity||"Project metric","metrics-mobile-card-activity");
    add(meta,"span",state,"metrics-mobile-status"+
      (state==="Live"?" is-live":state==="Linked"?" is-linked":""));
    const value=add(body,"span","","metrics-mobile-card-value");
    add(value,"span",formatted.value,"metrics-value-main");
    if(formatted.unit)add(value,"span",formatted.unit,"metrics-value-unit");
    add(open,"span","›","metrics-mobile-chevron").setAttribute("aria-hidden","true");
  }
  list.replaceChildren(fragment);
}
function renderRows() {
  const query = el("search").value.trim().toLocaleLowerCase();
  const populated=[...populatedMetrics(all),...(isLatestRelease()?operationalIndicators:[])];
  const liveCount=populated.filter(metric=>currentStatus(metric).kind==="live").length;
  // Sorting and text search use the displayed current figure, not an unseen
  // frozen number, while keeping the original metric values intact.
  const displayRows=populated.filter(metric=>!hiddenMetricIds.has(metric.id)).map(metric=>({
    ...withMetricPresentation(metric),liveDisplayValue:metricDisplay(metric).value
  }));
  visible = selectMetrics(displayRows, {
    query, activity: el("activity").value, categories: [...selectedCategories],
    featured: el("featured").checked, sort: sortKey, direction: sortDirection
  });
  el("sortChoice").value=["metricType","title","id"].includes(sortKey)?sortKey:"column";
  if(el("linkedOnly").checked) visible=visible.filter(metric=>Boolean(currentLinkSource(metric)));
  if(!isLatestRelease())mobileLiveOnly=false;
  if(mobileLiveOnly)visible=visible.filter(metric=>currentStatus(metric).kind==="live");
  el("mobileLiveOnly").disabled=!isLatestRelease();
  el("mobileLiveOnly").setAttribute("aria-pressed",String(mobileLiveOnly));
  el("mobileTopPicks").setAttribute("aria-pressed",String(el("featured").checked));
  const cols = COLUMN_DEFS.filter((column) => selectedColumns.has(column.key));
  const table = el("metricHead").closest("table");
  // More selected columns get horizontal room rather than squeezing each cell.
  const minimum = cols.reduce((width, col) =>
    width + (col.key === "title" ? 220 :
      col.key === "value" || col.key === "source" || col.key === "note" ? 170 : 108), 42);
  table.style.minWidth = String(Math.max(660, minimum)) + "px";
  table.querySelector("colgroup")?.remove();
  const group = document.createElement("colgroup");
  const starColumn=document.createElement("col");
  starColumn.style.width="42px";
  group.append(starColumn);
  const totalWeight = cols.reduce((sum, column) => sum + column.weight, 0);
  for (const col of cols) {
    const node = document.createElement("col");
    node.style.width = String(col.weight * 100 / totalWeight) + "%";
    group.append(node);
  }
  table.prepend(group);
  const head = el("metricHead");
  head.replaceChildren();
  const pickHead=add(head,"th","★","metrics-pick-cell");
  pickHead.scope="col";pickHead.setAttribute("aria-label","Shared Top Pick");
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
  let previousType="";
  for (const metric of visible) {
    const typeKey=metric.activity+" · "+metric.metricType;
    if(sortKey==="metricType" && typeKey!==previousType){
      const groupRow=add(fragment,"tr","","metrics-type-row");
      const groupCell=add(groupRow,"td",typeKey);
      groupCell.colSpan=cols.length+1;
      previousType=typeKey;
    }
    const row = document.createElement("tr");
    const status=currentStatus(metric);
    const linkSource=status.source;
    const overlay=metricDisplay(metric);
    if(overlay.state==="Live") row.classList.add("metrics-live-linked");
    else if(status.kind!=="published") row.classList.add("metrics-data-linked");
    if(linkSource) row.title=(status.kind==="live" ?
      "Verified current-data calculation: " : "Related current records: ") +linkSource;
    const pickCell=add(row,"td","","metrics-pick-cell");
    const star=add(pickCell,"button","");
    star.type="button";configureStar(star,metric);
    if(!metric.operationalLive)star.addEventListener("click",()=>togglePick(metric.id));
    for (const col of cols) {
      const cell = document.createElement("td");
      cell.dataset.col = col.key;
      const value = String(col.key==="title" ? metric.displayTitle||metric.title :
        col.key==="unit" ? overlay.unit :
        col.key==="asOf" && overlay.state==="Live" ?
          new Date(overlay.sourceUpdatedAt || overlay.checkedAt).toLocaleString() :
        col.key==="dataKind" && status.kind!=="published" ? overlay.state :
        metric[col.key] ?? "");
      const formatted = col.key === "value" ?
        displayMetricValue(overlay.value, selectedColumns.has("unit") ? "" : overlay.unit) : null;
      if (formatted?.numeric || formatted?.missing) cell.classList.add("metrics-number");
      cell.title = formatted ? formatted.full : value;
      if (col.key === "hide") {
        const hideButton=add(cell,"button","×","metrics-hide-action");
        hideButton.type="button";
        hideButton.title="Hide from my metrics view";
        hideButton.setAttribute("aria-label","Hide "+(metric.displayTitle||metric.title));
        hideButton.addEventListener("click",()=>hideMetric(metric.id));
      } else if (col.key === "title") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "metric-open";
        button.textContent = value;
        button.dataset.metricId=metric.id;
        button.title = value + " · open details";
        if(linkSource) {
          button.classList.add("has-current-link");
          button.replaceChildren();
          add(button,"span",value,"metric-title-text");
          add(button,"span",overlay.state==="Live" ? "● Live" :
            status.kind==="live" ? "Live available" : "Linked",
            overlay.state==="Live" ? "metrics-live-mark" : "metrics-linked-mark");
          button.title=value+" · "+(status.kind==="live" ?
            "live calculation" : "related operational data")+" from "+linkSource;
        }
        button.addEventListener("click", () => openMetric(metric, button));
        cell.append(button);
      } else if (col.key === "dataKind") {
        add(cell, "span", value, "metrics-type" + (value === "Live" ? " is-live" : ""));
      } else if (col.key === "value") {
        const button=add(cell,"button","","metrics-value-open");
        button.type="button";
        button.setAttribute("aria-label",(metric.displayTitle||metric.title)+" · "+formatted.full+" · details");
        button.addEventListener("click",()=>openMetric(metric,button));
        add(button, "span", formatted.value, "metrics-value-main");
        if (formatted.unit) add(button, "span", formatted.unit, "metrics-value-unit");
        if(overlay.state==="Live") {
          add(button,"span","● Live","metrics-live-mark");
          button.title="Live value · "+linkSource+" · checked "+
            new Date(overlay.checkedAt).toLocaleString()+"; published value: "+
            displayMetricValue(metric.value,metric.unit).full;
        }
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    }
    fragment.append(row);
  }
  tbody.append(fragment);
  renderMobileRows();
  const hiddenCount=populated.filter(m=>hiddenMetricIds.has(m.id)).length;
  el("count").textContent=visible.length+" shown · "+populated.length+
    " available · "+liveCount+" live"+(hiddenCount?" · "+hiddenCount+" hidden":"");
  renderHiddenMetricMenu();
  const notice=isLatestRelease()?"":"Historical release — published values only.";
  el("liveValueNotice").textContent=notice;
  el("liveValueNotice").hidden=!notice;
  el("empty").hidden = visible.length > 0;
  requestAnimationFrame(()=>{sizeRegisterViewport();syncStickyScrollbar();});
}
function openMetric(metric, button, keepFocus=false) {
  detailMetricId=metric.id;
  configureStar(el("detailStar"),metric);
  if(!keepFocus) lastFocus = button;
  el("metricTitle").textContent = metricDisplayName(metric);
  const details = el("detail");
  details.replaceChildren();
  const metadata=el("metricMetadata");
  metadata.replaceChildren();
  metadata.closest("details").open=false;
  const evidence=el("metricEvidence");
  evidence.replaceChildren();
  if(metric.evidence){
    add(evidence,"h3","Groups");
    const list=add(evidence,"ul","","metrics-evidence-groups");
    for(const group of metric.evidence.groups)add(list,"li",group);
    add(evidence,"p",metric.evidence.source+" · "+metric.evidence.locator,"metrics-small-note");
    if(metric.evidence.method)add(evidence,"p",metric.evidence.method,"metrics-small-note");
  }
  const fields = [
    ["Metric ID", metric.id],
    ...(metricDisplayName(metric)!==metric.title ? [["Original metric name",metric.title]] : []),
    ["Activity", metric.activity],
    ["Category", metric.theme],
    ["Original workbook theme", metric.originalTheme],
    ["Shared Top Pick", metric.featured?"Yes":"No"],
    ["Value", metricDisplay(metric).value],
    ["Unit / basis", metricDisplay(metric).unit],
    ...(metricDisplay(metric).state==="Live" ? [
      ["Value status","Live · refreshed on current data query"],
      ...(!metric.operationalLive ? [["Published "+(current?.version||"release"),displayMetricValue(metric.value,metric.unit).full]] : []),
      ["Current calculated value",displayMetricValue(metricDisplay(metric).value,metricDisplay(metric).unit).full],
      ["Current query checked",new Date(metricDisplay(metric).checkedAt).toLocaleString()],
      ...(metricDisplay(metric).sourceUpdatedAt ?
        [["Operational records last updated",new Date(metricDisplay(metric).sourceUpdatedAt).toLocaleString()]]:[])
    ] : [["Value status",metricDisplay(metric).state]]),
    ["Data", metric.dataKind],
    ...(currentLinkSource(metric) ? [["Current data link",currentLinkSource(metric)+
      " · published releases remain frozen and unchanged"]] : []),
    ["Value type", metric.valueType],
    ...(mawimbiQcPanel.metricContext(metric.id) ? [
      ["Current MAWIMBI stock record counts",mawimbiQcPanel.metricContext(metric.id).value],
      ["Current scope",mawimbiQcPanel.metricContext(metric.id).description],
      ["QC completeness","Not verified: recorded inputs are not calibrated batch QC outcomes"]
    ] : []),
    ...(mawimbiPanel.metricContext(metric.id) ? [
      ["Current MAWIMBI aggregate",mawimbiPanel.metricContext(metric.id).value],
      ["Current scope",mawimbiPanel.metricContext(metric.id).description],
      ["Live aggregate status","Separate from the frozen V0.1 value; payment and batch linkage not verified"]
    ] : []),
    ...(financialContext(metric) ? [["Financial context", financialContext(metric).caveat]] : []),

    ...(currentDryerMetrics && DRYER_COMPARE.some(x=>x.id===metric.id) ? (()=>{
      const item=DRYER_COMPARE.find(x=>x.id===metric.id);
      return [
        ["Current measured value",displayMetricValue(currentDryerMetrics[item.key],item.unit).full],
        ["Current calculation scope",currentDryerMetrics.scope],
        ["Current inclusion/exclusion",currentDryerMetrics.definition],
        ["Completed records excluded",currentDryerMetrics.excluded_completed],
        ["Current source updated",currentDryerMetrics.source_updated_at ?
          new Date(currentDryerMetrics.source_updated_at).toLocaleString() : "Unknown"],
        ["Current calculation checked",new Date(currentDryerMetrics.queried_at).toLocaleString()]
      ];
    })() : []),
    ...(metric.id === "ON-0054" && currentRopeCoverage ? [
      ["Current coverage",currentRopeCoverage.rope_count+" ropes across "+currentRopeCoverage.site_count+" sites"],
      ["Current calculation","Active COSME rope positions with an initial weight; soft-deleted entries excluded"],
      ["Current source modified",currentRopeCoverage.source_updated_at ? new Date(currentRopeCoverage.source_updated_at).toLocaleString() : "Unknown"],
      ["Current value checked",new Date(currentRopeCoverage.queried_at).toLocaleString()]
    ] : []),
    ["Claim basis", metric.basis],
    ["Evidence state", metric.verification],
    ["Original workbook evidence", metric.originalEvidence],
    ["Value availability", metric.valueState],
    ["Source worksheet", metric.sourceSheet],
    ["Source row", metric.sourceRow],
    ["As of", metric.asOf],
    ["Source", metric.source],
    ["Notes", metric.note],
    ["Published in", metric.operationalLive ? "Live operational indicator (not in frozen release)" : (current?.version || "")]
  ];
  for (const [label, value] of fields) {
    if(value===""||value===undefined||value===null)continue;
    const root=["Value","Unit / basis","Activity","As of","Source","Notes"].includes(label)?details:metadata;
    add(root, "dt", label);
    const dd=add(root, "dd", value);
    if(label==="Shared Top Pick") dd.dataset.sharedSelection="";
  }
  // These are navigation links to operational ledgers, not live calculations.
  const source = String(metric.source || "").toLowerCase();
  let relatedHref = "";
  if (metric.operationalLive && metric.activity==="Offshore Nursery")
    relatedHref="./reef_seaweed_records.html#analysis";
  else if (metric.operationalLive && metric.activity==="Solar Drying Tables")
    relatedHref="./dryer_table_records.html";
  else if (metric.operationalLive && metric.activity==="Mawimbi")
    relatedHref="./mawimbi_analysis.html";
  else if (metric.activity === "Solar Drying Tables" && source.includes("seaweed harvest")) {
    relatedHref = "./dryer_table_records.html";
  } else if (metric.activity === "Offshore Nursery" && source.includes("seaweed harvest")) {
    relatedHref = "./reef_seaweed_records.html";
  }
  if (relatedHref) {
    add(details, "dt", "Related records");
    const value = document.createElement("dd");
    const link = document.createElement("a");
    link.href = relatedHref;
    link.textContent = "Open source ledger";
    value.append(link);
    details.append(value);
  }
  el("veil").classList.add("open");
  metricEvidenceReview.openMetric(metric.id);
  if(!keepFocus)el("close").focus();
}
function closeMetric() {
  metricEvidenceReview.closeMetric();
  const closingId=detailMetricId;
  detailMetricId=null;
  el("veil").classList.remove("open");
  if(lastFocus && document.contains(lastFocus))lastFocus.focus();
  else {
    const replacement=[...el("rows").querySelectorAll("[data-metric-id]")]
      .find(node=>node.dataset.metricId===closingId);
    (replacement||el("search")).focus();
  }
}
function exportCsv() {
  if (!current || !visible.length) return;
  const csv = exportMetricViewCsv(visible,current.version||"",currentStatus,
    el("showLiveValues").checked,isLatestRelease());
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "COSME_Metrics_" + (current.version || "unpublished") + "_selected.csv";
  link.click();
  URL.revokeObjectURL(url);
}
async function loadOperationalIndicators() {
  operationalIndicators=[];
  operationalIndicatorsError="";
  try {
    const {data,error}=await authClient.rpc("cosme_metrics_live_operational_overview");
    if(error)throw error;
    if(!data || data.can_view!==true || data.status!=="current")
      throw Error("Operational aggregates unavailable");
    // Separate permission-checked dryer performance feed augments the existing
    // validated cycle weights without changing historical release payloads.
    try{
      const result=await authClient.rpc("cosme_metrics_live_dryer_performance");
      if(!result.error && result.data?.can_view===true && result.data.status==="current" &&
          Number.isFinite(Date.parse(result.data.queried_at))){
        data.drying={...data.drying,...result.data};
      }
    }catch{/* Keep base operational indicators if dryer supplementary data fail. */}
    operationalIndicators=createOperationalIndicators(data);
    if(!operationalIndicators.length)throw Error("No validated operational indicators");
  } catch {
    operationalIndicators=[];
    operationalIndicatorsError="Live operational indicators unavailable; published metrics are unchanged.";
  }
}

async function reloadAndRecheck() {
  const grant = await requireMetrics();
  if (!grant) return;
  access = grant;
  el("accessRole").textContent = "Metrics " + grant.role;
  const proposalsTab=document.querySelector(".metrics-tabs [data-tab=proposals]");
  proposalsTab.hidden=!["owner","editor"].includes(grant.role);
  await prepareNavigation();
  // Follow the latest release pointer on return, but preserve a deliberately
  // opened historical release for comparison.
  const previousVersion = current?.status === "published" && !isLatestRelease() ?
    [current.major, current.minor] : null;
  await loadReleases();
  await loadRelease(previousVersion);
  el("currentMawimbiTraceability").hidden = grant.role !== "owner";
  await Promise.all([loadCurrentRopeCoverage(),loadCurrentDryerMetrics(),loadOperationalIndicators(),nurseryGrowthPanel.refresh(),mawimbiPanel.refresh(),mawimbiQcPanel.refresh(),timelinePanel.load(),...(grant.role === "owner" ? [traceabilityPanel.refresh()] : [])]);
  renderConnectionStatus();
  el("app").hidden = false;
  if (!initialTabRestored) {
    initialTabRestored = true;
    let selected = new URLSearchParams(window.location.search).get("tab");
    if (!selected) {
      try { selected = localStorage.getItem(LAST_METRICS_TAB); } catch {}
    }
    if (["overview","register","timeline","finances","reports","photos","history"].includes(selected))
      tab(selected);
  }
  if (financesLoaded) financesPanel.load();
  for(const name of librariesLoaded)libraries[name].load();
  renderRegisterSummary();
  renderRows();
}
for (const button of document.querySelectorAll(".metrics-tabs .tab")) {
  button.addEventListener("click", () => tab(button.dataset.tab));
}
for(const [buttonId,panelId] of [
  ["mobileFiltersToggle","mobileFilters"],["mobileActionsToggle","registerActions"]
]){
  el(buttonId).addEventListener("click",()=>{
    const button=el(buttonId),panel=el(panelId);
    const open=!panel.classList.contains("is-open");
    panel.classList.toggle("is-open",open);
    button.setAttribute("aria-expanded",String(open));
  });
}
el("mobileLiveOnly").addEventListener("click",()=>{
  mobileLiveOnly=!mobileLiveOnly;
  renderRows();
});
el("mobileTopPicks").addEventListener("click",()=>{
  el("featured").checked=!el("featured").checked;
  renderCategoryChoices();
  renderRows();
});
el("sortChoice").addEventListener("change",()=>{
  sortKey=el("sortChoice").value;
  sortDirection="asc";
  renderRows();
});
el("search").addEventListener("input", renderRows);
el("activity").addEventListener("change", () => {
  renderCategoryChoices();
  renderRows();
});
el("featured").addEventListener("change", () => {
  renderCategoryChoices();
  renderRows();
});
el("linkedOnly").addEventListener("change", renderRows);
el("showLiveValues").addEventListener("change",()=>{
  prefersLiveValues=el("showLiveValues").checked;
  renderRegisterSummary();
  renderRows();
});
el("refreshLiveValues").addEventListener("click",()=>refreshLiveFeeds());
el("refreshMetricDrafts").addEventListener("click",()=>metricEvidenceReview.refreshDrafts());
// Overview activity cards navigate to All metrics.
el("reset").addEventListener("click", () => {
  el("search").value = "";
  el("activity").value = "";
  el("featured").checked = false;
  el("linkedOnly").checked = false;
  mobileLiveOnly=false;
  selectedCategories.clear();
  el("categoryMenu").open = false;
  sortKey = "metricType"; sortDirection = "asc";
  selectedColumns = new Set(DEFAULT_COLUMNS);
  saveColumns();
  renderColumnChoices();
  renderCategoryChoices();
  renderRows();
});
el("exportCsv").addEventListener("click", exportCsv);
el("restoreAllHidden").addEventListener("click",restoreAllHidden);
async function refreshLiveFeeds() {
  if(liveRefreshInFlight || !access || !navigator.onLine) return liveRefreshInFlight;
  const button=el("refreshLiveValues");
  button.disabled=true;
  liveRefreshInFlight=(async()=>{
    try {
      await Promise.all([loadCurrentRopeCoverage(),loadCurrentDryerMetrics(),loadOperationalIndicators(),
        nurseryGrowthPanel.refresh(),mawimbiPanel.refresh(),mawimbiQcPanel.refresh()]);
      renderConnectionStatus();
      renderRegisterSummary();
      renderRows();
      if(detailMetricId && el("veil").classList.contains("open")){
        // A stale detail should never suggest its opened value remains current.
        const metric=[...all,...operationalIndicators].find(m=>m.id===detailMetricId);
        if(metric)openMetric(metric,lastFocus,true);
      }
    } finally { button.disabled=false; liveRefreshInFlight=null; }
  })();
  return liveRefreshInFlight;
}
// Recheck live sources while an authorised user has this page open.
setInterval(()=>{
  if(access && !document.hidden && navigator.onLine)
    refreshLiveFeeds().catch(()=>{});
},300000);
const metricScrollArea=el("metricScrollArea");
const stickyScroll=el("metricsStickyScroll");
metricScrollArea.addEventListener("scroll",()=>{
  if(stickyScroll.scrollLeft!==metricScrollArea.scrollLeft)
    stickyScroll.scrollLeft=metricScrollArea.scrollLeft;
},{passive:true});
stickyScroll.addEventListener("scroll",()=>{
  if(metricScrollArea.scrollLeft!==stickyScroll.scrollLeft)
    metricScrollArea.scrollLeft=stickyScroll.scrollLeft;
},{passive:true});
window.addEventListener("scroll",syncStickyScrollbar,{passive:true});
window.addEventListener("resize",()=>{sizeRegisterViewport();syncStickyScrollbar();},{passive:true});
if("ResizeObserver" in window)
  new ResizeObserver(()=>requestAnimationFrame(syncStickyScrollbar)).observe(metricScrollArea);
el("detailStar").addEventListener("click",()=>togglePick(detailMetricId,"detail"));

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
  for (const id of ["columnMenu", "categoryMenu", "hiddenMetricMenu"]) {
    const menu = el(id);
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && access && document.body.dataset.cosmePhotoUploading !== "true") {
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
