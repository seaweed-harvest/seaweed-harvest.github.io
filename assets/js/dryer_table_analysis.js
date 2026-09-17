import { currentAccessToken } from "./auth_client.js?v=25";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";

const RPC_NAME = "list_authenticated_seaweed_drying_ledger";
const KENYA_TIME_ZONE = "Africa/Nairobi";
const TAB = "analysis";
const ORDER = ["NEW T1","NEW T2","NEW T3","NEW T4","EXISTING SHED T1","EXISTING SHED T2","EXISTING SHED T3","EXISTING SHED T4","EXISTING SHED T5","Shed - General"];
const WEATHER_DATES = Array.from({ length: 78 }, (_, i) => new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10));
const WEATHER_TEMP = [27.89,27.47,27.08,26.7,27.3,27.77,28.54,28.71,29.04,28.84,28.97,29.01,29.08,29.13,29.45,29.23,29.47,29.39,30.37,31.35,31.44,31.16,29.6,29.75,28.98,28.55,28.5,28.89,30.06,28.94,28.53,27.95,28.47,28.68,28.62,29.35,29.71,30.01,30.15,29.87,30.76,30.88,31.64,31.01,29.81,29.04,28.77,28.24,27.91,28.15,29.75,30.14,30.32,30.61,30.94,30.68,30.4,30.17,30.49,30.02,30.06,29.93,29.99,30.56,31.28,32.04,31.85,31.35,31.55,31.05,30.59,28.07,28.65,29.62,32.01,31.87,31.61,31.41];
const WEATHER_RH = [72.7,74.08,75.53,76.61,75.21,73.05,71.23,71.34,71.62,73.11,71.56,70.72,70.28,70.7,69.55,69.51,67.76,68.46,66.25,65.22,65.3,65.33,69.6,69.37,72.65,73.72,72.75,71.07,66.77,71.88,73.36,75.21,72.56,71.8,72.13,70.11,69.28,69.61,69.05,69.51,66.15,65.27,62.9,64.59,69.33,71.7,73.3,75.39,77.4,75.77,69.99,70.33,72.0,70.93,68.04,67.77,68.43,69.16,68.01,71.38,71.76,71.88,70.8,67.9,66.11,64.21,65.85,66.65,64.44,65.69,68.38,79.41,79.72,76.31,66.94,66.4,66.96,67.59];
const RAIN_VALUES = [1.5,0.3,1.3,0.0,0.9,3.2,4.9,1.0,3.0,0.0,0.0,0.5,0.0,0.0,0.0,7.0,30.0,58.0,5.0,0.0,5.0,2.0];
const RAIN_DATES = RAIN_VALUES.map((_, i) => new Date(Date.UTC(2026, 7, 25 + i)).toISOString().slice(0, 10));
const WEATHER = new Map(WEATHER_DATES.map((d, i) => [d, { temp: WEATHER_TEMP[i], rh: WEATHER_RH[i] }]));
const RAIN = new Map(RAIN_DATES.map((d, i) => [d, RAIN_VALUES[i]]));
const state = { runs: [], rangeDays: 30, sort: { col: 1, dir: "desc" }, loading: false };
const els = {};
let plotlyPromise;

document.addEventListener("DOMContentLoaded", init);

function init() {
  installShell();
  cache();
  if (!els.tabs || !els.tab || !els.panel) return;
  bind();
  if (new URLSearchParams(location.search).get("tab") === TAB) setTimeout(() => void activate(), 0);
}

function installShell() {
  if (!document.querySelector("link[data-dryer-analysis-style]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./assets/css/dryer_analysis_live.css?v=2";
    link.dataset.dryerAnalysisStyle = "true";
    document.head.appendChild(link);
  }
  const tabs = document.getElementById("dryerRecordTabs");
  if (tabs && !document.getElementById("dryerAnalysisTab")) {
    const button = document.createElement("button");
    button.id = "dryerAnalysisTab";
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-controls", "dryerAnalysisPanel");
    button.dataset.dryerTab = TAB;
    button.textContent = "Analysis";
    tabs.insertBefore(button, document.getElementById("dryerPaymentsTab"));
  }
  if (!document.getElementById("dryerAnalysisPanel")) {
    const panel = document.createElement("section");
    panel.id = "dryerAnalysisPanel";
    panel.className = "admin-card-body standalone dryer-record-panel dryer-analysis-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "dryerAnalysisTab");
    panel.hidden = true;
    panel.innerHTML = `
      <p class="dryer-analysis-intro">Live drying performance analysis built from the same Dryer Table records used by All Records. Opening this tab refreshes the ledger, so new drying entries are included automatically.</p>
      <p id="dryerAnalysisStatus" class="admin-status" aria-live="polite"></p>
      <details open class="dryer-analysis-card"><summary>1. Analysis summary</summary><div class="dryer-analysis-card-body">
        <div class="dryer-analysis-toolbar"><span class="field-hint">Table-level comparison of completed runs and timing confidence.</span><div class="button-row compact-actions"><button id="dryerAnalysisToggleDetails" type="button" aria-expanded="false">Show notes &amp; timing evidence</button></div></div>
        <div class="responsive-table-wrap"><table id="dryerAnalysisSummaryTable" class="management-table admin-data-table dryer-analysis-table"><thead><tr><th>Table</th><th>Completed</th><th>In progress</th><th>Avg bays<br>used</th><th>Avg total<br>load</th><th>Avg load /<br>occupied bay*</th><th>Load/bay<br>range</th><th>Weight-loss<br>range</th><th>Avg weight<br>lost</th><th>Timing-usable<br>elapsed time</th><th>Drying<br>efficiency<br><span class="analysis-small">% pts/day</span></th><th class="analysis-detail-col analysis-hidden">Notes</th><th class="analysis-detail-col analysis-hidden">Timing evidence</th></tr></thead><tbody></tbody></table></div>
      </div></details>
      <details open class="dryer-analysis-card"><summary>2. Drying timeline + Weather</summary><div class="dryer-analysis-card-body">
        <div class="dryer-analysis-toolbar"><div class="button-row compact-actions dryer-analysis-range"><button type="button" data-analysis-range="7">7 days</button><button type="button" data-analysis-range="30" class="active">1 month</button><button type="button" data-analysis-range="90">3 months</button></div></div>
        <div class="dryer-analysis-chart-wrap"><div id="dryerAnalysisWeatherChart"></div></div>
        <p class="dryer-analysis-note">Dryer run bars are live from Dryer Table records. Temperature and humidity are the current Seaweed Station analysis snapshot through 16 Sep 2026; regional rainfall context runs through 15 Sep 2026. Later dryer entries still appear automatically, with weather fields left blank beyond the available context.</p>
      </div></details>
      <details open class="dryer-analysis-card"><summary>3. Performance scatter plot</summary><div class="dryer-analysis-card-body"><div class="dryer-analysis-chart-wrap"><div id="dryerAnalysisScatter"></div></div></div></details>
      <details open class="dryer-analysis-card"><summary>4. Run-level source data</summary><div class="dryer-analysis-card-body"><div class="responsive-table-wrap"><table id="dryerAnalysisRunTable" class="management-table admin-data-table dryer-analysis-table"><thead><tr><th data-sort-type="text">Table</th><th data-sort-type="date">Date range</th><th data-sort-type="number">Bays</th><th data-sort-type="number">Start load</th><th data-sort-type="number">End load</th><th data-sort-type="number">Load / bay</th><th data-sort-type="number">Avg daytime<br>temp</th><th data-sort-type="number">Avg daytime<br>humidity</th><th data-sort-type="number">Avg rainfall*</th><th data-sort-type="number">Weight lost</th><th data-sort-type="number">Elapsed time</th><th data-sort-type="number">Drying efficiency</th><th data-sort-type="text">Timing status</th></tr></thead><tbody></tbody></table></div></div></details>`;
    const payments = document.getElementById("dryerPaymentsPanel");
    payments?.parentElement?.insertBefore(panel, payments);
  }
}

function cache() {
  els.tabs = document.getElementById("dryerRecordTabs");
  els.tab = document.getElementById("dryerAnalysisTab");
  els.panel = document.getElementById("dryerAnalysisPanel");
  els.status = document.getElementById("dryerAnalysisStatus");
  els.summaryBody = document.querySelector("#dryerAnalysisSummaryTable tbody");
  els.runBody = document.querySelector("#dryerAnalysisRunTable tbody");
  els.scatter = document.getElementById("dryerAnalysisScatter");
  els.weather = document.getElementById("dryerAnalysisWeatherChart");
  els.details = document.getElementById("dryerAnalysisToggleDetails");
}

function bind() {
  els.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dryer-tab]");
    if (!button) return;
    if (button.dataset.dryerTab === TAB) {
      event.preventDefault();
      event.stopPropagation();
      void activate();
    } else {
      els.panel.hidden = true;
    }
  }, true);
  els.tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const tabs = [...els.tabs.querySelectorAll("[data-dryer-tab]")];
    let i = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    if (i < 0) i = 0;
    if (event.key === "Home") i = 0;
    else if (event.key === "End") i = tabs.length - 1;
    else if (event.key === "ArrowLeft") i = Math.max(0, i - 1);
    else i = Math.min(tabs.length - 1, i + 1);
    tabs[i]?.click();
    tabs[i]?.focus();
  }, true);
  document.querySelectorAll("[data-analysis-range]").forEach((button) => button.addEventListener("click", () => {
    state.rangeDays = Number(button.dataset.analysisRange) || 30;
    document.querySelectorAll("[data-analysis-range]").forEach((item) => item.classList.toggle("active", item === button));
    renderWeather();
  }));
  els.details?.addEventListener("click", () => {
    const expanded = els.details.getAttribute("aria-expanded") === "true";
    document.querySelectorAll("#dryerAnalysisSummaryTable .analysis-detail-col").forEach((cell) => cell.classList.toggle("analysis-hidden", expanded));
    els.details.setAttribute("aria-expanded", expanded ? "false" : "true");
    els.details.textContent = expanded ? "Show notes & timing evidence" : "Hide notes & timing evidence";
  });
  document.querySelectorAll("#dryerAnalysisRunTable th[data-sort-type]").forEach((th, col) => th.addEventListener("click", () => sortRuns(col, th.dataset.sortType)));
  document.getElementById("reloadDryerRecords")?.addEventListener("click", () => { if (!els.panel.hidden) setTimeout(() => void load(), 50); });
}

async function activate() {
  ["dryerAllPanel","dryerObservationsPanel","dryerPaymentsPanel"].forEach((id) => { const panel = document.getElementById(id); if (panel) panel.hidden = true; });
  [...els.tabs.querySelectorAll("[data-dryer-tab]")].forEach((button) => {
    const active = button.dataset.dryerTab === TAB;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  els.panel.hidden = false;
  const url = new URL(location.href); url.searchParams.set("tab", TAB); history.replaceState({}, "", url);
  try { await ensurePlotly(); await load(); } catch (error) { setStatus(error?.message || String(error), "error"); }
}

function ensurePlotly() {
  if (window.Plotly) return Promise.resolve();
  if (plotlyPromise) return plotlyPromise;
  plotlyPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-3.3.1.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Plotly could not be loaded."));
    document.head.appendChild(script);
  });
  return plotlyPromise;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  setStatus("Refreshing live Dryer Table records…");
  try {
    const token = await currentAccessToken();
    const response = await fetch(`${DRYING_FORM_CONFIG.supabaseUrl}/rest/v1/rpc/${RPC_NAME}`, {
      method: "POST",
      headers: { apikey: DRYING_FORM_CONFIG.supabaseAnonKey, Authorization: `Bearer ${DRYING_FORM_CONFIG.supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_account_access_token: token, p_limit: 5000 })
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
    const data = await response.json();
    state.runs = buildRuns(Array.isArray(data?.bay_rows) ? data.bay_rows : []);
    render();
    setStatus(`${state.runs.length} drying ${state.runs.length === 1 ? "event" : "events"} analysed from live records · refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } finally { state.loading = false; }
}

function buildRuns(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(row.submission_id || row.receipt_number || `${row.table_location || "unknown"}:${row.loading_at || row.recorded_at || "unknown"}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.values()].map(eventToRun).filter((run) => run.start).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

function eventToRun(rows) {
  const table = tableName(rows.find((row) => row.table_location)?.table_location);
  const start = earliest(rows, "loading_at") || earliest(rows, "recorded_at");
  const complete = rows.length > 0 && rows.every((row) => row.status === "complete" && row.unloading_at && optionalNumber(row.unloading_weight_kg) !== null);
  const end = complete ? latest(rows, "unloading_at") : "";
  const bays = new Set(rows.map((row) => String(row.bay_number ?? "unknown"))).size;
  const startkg = sum(rows, "loading_weight_kg");
  const unloaded = sum(rows, "unloading_weight_kg");
  const endkg = complete ? unloaded : null;
  const kgpb = bays ? startkg / bays : null;
  const lost = complete && startkg > 0 ? (startkg - unloaded) / startkg * 100 : null;
  const hours = complete && Date.parse(end) >= Date.parse(start) ? (Date.parse(end) - Date.parse(start)) / 3600000 : null;
  const weather = weatherAverage(start, end || start);
  return { table, start, end, bays, startkg, endkg, kgpb, lost, hours, status: timingStatus(table, start, end, complete), ...weather };
}

function tableName(value) {
  const text = String(value || "").trim();
  const bati = text.match(/Bati\s*\(Table\s*(\d+)\)/i) || text.match(/Bati.*Table\s*(\d+)/i);
  if (bati) return `NEW T${bati[1]}`;
  const shed = text.match(/Dryer\s*Shed\s*-\s*T(\d+)/i);
  if (shed) return `EXISTING SHED T${shed[1]}`;
  if (/^Dryer\s*Shed$/i.test(text)) return "Shed - General";
  return text || "Unknown table";
}

function timingStatus(table, start, end, complete) {
  if (!complete) return "in_progress";
  const s = kenyaDateKey(start), e = kenyaDateKey(end);
  if (e === "2026-09-04") {
    if (["NEW T1","NEW T2","NEW T3"].includes(table) && s === "2026-08-31") return "caution";
    return "excluded";
  }
  return "complete";
}

function weatherAverage(start, end) {
  const first = kenyaDateKey(start), last = kenyaDateKey(end);
  if (!first) return { temp: null, rh: null, rain: null };
  const temp = [], rh = [], rain = [];
  let cursor = new Date(`${first}T12:00:00Z`), stop = new Date(`${last || first}T12:00:00Z`), guard = 0;
  while (cursor <= stop && guard++ < 120) {
    const key = cursor.toISOString().slice(0, 10), w = WEATHER.get(key);
    if (w) { temp.push(w.temp); rh.push(w.rh); }
    if (RAIN.has(key)) rain.push(RAIN.get(key));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return { temp: avg(temp), rh: avg(rh), rain: avg(rain) };
}

function render() { renderSummary(); renderRuns(); heatmaps(); renderScatter(); renderWeather(); }

function renderSummary() {
  const names = [...new Set([...ORDER, ...state.runs.map((run) => run.table)])];
  els.summaryBody.innerHTML = names.map((table) => {
    const group = state.runs.filter((run) => run.table === table);
    const completed = group.filter((run) => run.status !== "in_progress");
    const timed = group.filter((run) => timingUsable(run.status));
    const hours = values(timed, "hours"), efficiencies = timed.map(efficiency).filter(Number.isFinite);
    return `<tr><td class="analysis-name">${esc(table)}</td><td>${completed.length}</td><td>${group.filter((r) => r.status === "in_progress").length}</td><td>${fmt(avg(values(completed,"bays")))}</td><td>${fmt(avg(values(completed,"startkg"))," kg")}</td><td>${fmt(avg(values(completed,"kgpb"))," kg")}</td><td>${range(values(completed,"kgpb")," kg")}</td><td>${range(values(completed,"lost"),"%")}</td><td class="analysis-summary-loss">${fmt(avg(values(completed,"lost")),"%")}</td><td class="analysis-summary-time">${timeSummary(hours)}</td><td class="analysis-summary-eff">${fmt(avg(efficiencies)," %/day")}</td><td class="analysis-detail-col analysis-hidden">${esc(note(table, group))}</td><td class="analysis-detail-col analysis-hidden">${chips(group)}</td></tr>`;
  }).join("");
}

function renderRuns() {
  els.runBody.innerHTML = [...state.runs].sort((a,b) => Date.parse(b.start) - Date.parse(a.start)).map((run) => {
    const eff = timingUsable(run.status) ? efficiency(run) : null;
    return `<tr data-start="${escAttr(run.start)}"><td data-sort="${escAttr(run.table.toLowerCase())}">${esc(run.table)}</td><td data-sort="${escAttr(run.start)}">${esc(dateRange(run))}</td><td data-sort="${run.bays}">${run.bays}</td><td data-sort="${sortValue(run.startkg)}">${fmt(run.startkg," kg")}</td><td data-sort="${sortValue(run.endkg)}">${fmt(run.endkg," kg")}</td><td data-sort="${sortValue(run.kgpb)}">${fmt(run.kgpb," kg")}</td><td class="analysis-temp" data-sort="${sortValue(run.temp)}">${fmt(run.temp," °C")}</td><td class="analysis-rh" data-sort="${sortValue(run.rh)}">${fmt(run.rh,"%")}</td><td class="analysis-rain" data-sort="${sortValue(run.rain)}">${fmt(run.rain," mm/day")}</td><td class="analysis-loss" data-sort="${sortValue(run.lost)}">${fmt(run.lost,"%")}</td><td class="analysis-time" data-usable="${timingUsable(run.status) ? 1 : 0}" data-sort="${sortValue(run.hours)}">${fmt(run.hours," h")}</td><td class="analysis-eff" data-sort="${sortValue(eff)}">${fmt(eff," %/day")}</td><td data-sort="${run.status}">${status(run.status)}</td></tr>`;
  }).join("");
}

function sortRuns(col, type) {
  const body = document.querySelector("#dryerAnalysisRunTable tbody"); if (!body) return;
  const dir = state.sort.col === col && state.sort.dir === "asc" ? "desc" : "asc";
  const get = (cell) => { const raw = cell.dataset.sort ?? cell.textContent.trim(); if (!raw || raw === "—") return null; if (type === "number") return Number(raw); if (type === "date") return Date.parse(raw); return raw.toLowerCase(); };
  [...body.rows].sort((a,b) => { const x=get(a.cells[col]), y=get(b.cells[col]); if (x==null&&y==null) return 0; if (x==null) return 1; if (y==null) return -1; return x<y ? (dir==="asc"?-1:1) : x>y ? (dir==="asc"?1:-1) : 0; }).forEach((row) => body.appendChild(row));
  state.sort = { col, dir };
  document.querySelectorAll("#dryerAnalysisRunTable th").forEach((th,i) => { th.classList.remove("analysis-sort-asc","analysis-sort-desc"); if (i===col) th.classList.add(dir==="asc"?"analysis-sort-asc":"analysis-sort-desc"); });
}

function renderScatter() {
  if (!window.Plotly) return;
  const groups = new Map();
  state.runs.filter((r) => timingUsable(r.status) && Number.isFinite(r.hours) && Number.isFinite(r.lost)).forEach((r) => { if (!groups.has(r.table)) groups.set(r.table, []); groups.get(r.table).push(r); });
  const traces = [...groups.entries()].map(([name,runs]) => ({ x:runs.map(r=>r.hours), y:runs.map(r=>r.lost), mode:"markers", type:"scatter", name, marker:{size:11}, text:runs.map(r=>`<b>${esc(r.table)}</b><br>${esc(dateRange(r))}<br>Drying time: ${r.hours.toFixed(1)} h<br>Weight lost: ${r.lost.toFixed(1)}%<br>Start load: ${r.startkg.toFixed(1)} kg<br>End load: ${r.endkg.toFixed(1)} kg<br>Bays: ${r.bays}<br>Load / bay: ${r.kgpb.toFixed(1)} kg`), hovertemplate:"%{text}<extra></extra>" }));
  window.Plotly.react(els.scatter, traces, { xaxis:{title:"Recorded drying time (hours)",fixedrange:true}, yaxis:{title:"Weight lost (%)",fixedrange:true}, hovermode:"closest", dragmode:false, margin:{l:60,r:20,t:20,b:60}, paper_bgcolor:"transparent", plot_bgcolor:"#fff", legend:{orientation:"h",y:-0.22} }, {responsive:true,displaylogo:false,scrollZoom:false,doubleClick:false,displayModeBar:false});
}

function renderWeather() {
  if (!window.Plotly) return;
  const latestRun = state.runs.reduce((v,r) => Math.max(v, Date.parse(r.end||r.start)||0), 0);
  const end = new Date(Math.max(latestRun, Date.parse("2026-09-16T23:59:59+03:00")));
  const start = new Date(end.getTime() - state.rangeDays*86400000);
  const dates = WEATHER_DATES.filter((d) => { const t=Date.parse(`${d}T12:00:00+03:00`); return t>=start && t<=end; });
  const traces = [
    {x:dates,y:dates.map(d=>WEATHER.get(d)?.temp??null),type:"scatter",mode:"lines+markers",name:"Temperature",yaxis:"y",hovertemplate:"%{x}<br><b>%{y:.1f} °C</b><extra>Temperature</extra>"},
    {x:dates,y:dates.map(d=>WEATHER.get(d)?.rh??null),type:"scatter",mode:"lines+markers",name:"Humidity",yaxis:"y2",hovertemplate:"%{x}<br><b>%{y:.0f}% RH</b><extra>Humidity</extra>"},
    {x:RAIN_DATES,y:RAIN_VALUES,type:"bar",name:"Rainfall",yaxis:"y3",opacity:.42,hovertemplate:"%{x}<br><b>%{y:.1f} mm</b><extra>Regional rainfall</extra>"}
  ];
  const visible = state.runs.filter((r) => (Date.parse(r.end||r.start)||0)>=start && (Date.parse(r.start)||0)<=end);
  visible.forEach((r) => traces.push({x:[r.start,r.end||end.toISOString()],y:[r.table,r.table],xaxis:"x2",yaxis:"y4",type:"scatter",mode:"lines",line:{width:12},showlegend:false,hovertemplate:`<b>${esc(r.table)}</b><br>${esc(dateRange(r))}<br>${r.bays} bays · ${r.startkg.toFixed(1)} kg loaded<extra></extra>`}));
  const tables=[...new Set(visible.map(r=>r.table))];
  window.Plotly.react(els.weather,traces,{margin:{l:145,r:120,t:35,b:35},hovermode:"x",dragmode:false,paper_bgcolor:"transparent",plot_bgcolor:"#fff",legend:{orientation:"h",x:.02,y:1.02,yanchor:"bottom"},xaxis:{domain:[.04,.88],type:"date",range:[start,end],fixedrange:true,showticklabels:false},yaxis:{domain:[.58,.96],title:"Temperature",ticksuffix:" °C",fixedrange:true},yaxis2:{overlaying:"y",side:"right",position:.91,title:"Humidity",ticksuffix:" %",fixedrange:true,range:[45,100],showgrid:false},yaxis3:{overlaying:"y",side:"right",position:.98,title:"Rainfall",ticksuffix:" mm",fixedrange:true,rangemode:"tozero",showgrid:false},xaxis2:{domain:[.04,.88],type:"date",range:[start,end],fixedrange:true,anchor:"y4"},yaxis4:{domain:[.08,.48],type:"category",categoryorder:"array",categoryarray:[...tables].reverse(),fixedrange:true,showgrid:false}}, {responsive:true,displaylogo:false,scrollZoom:false,doubleClick:false,displayModeBar:false});
}

function heatmaps() {
  const summary=[...document.querySelectorAll("#dryerAnalysisSummaryTable tbody tr")];
  color(summary.map(r=>r.querySelector(".analysis-summary-loss")),true);
  color(summary.map(r=>r.querySelector(".analysis-summary-time")).filter(hasNumber),false);
  color(summary.map(r=>r.querySelector(".analysis-summary-eff")).filter(hasNumber),true);
  const rows=[...document.querySelectorAll("#dryerAnalysisRunTable tbody tr")];
  color(rows.map(r=>r.querySelector(".analysis-temp")).filter(hasNumber),true,"temp");
  color(rows.map(r=>r.querySelector(".analysis-rh")).filter(hasNumber),true,"humidity");
  color(rows.map(r=>r.querySelector(".analysis-rain")).filter(hasNumber),true,"rain");
  color(rows.map(r=>r.querySelector(".analysis-loss")).filter(hasNumber),true);
  color(rows.map(r=>r.querySelector(".analysis-time")).filter(c=>c?.dataset.usable==="1"&&hasNumber(c)),false);
  color(rows.map(r=>r.querySelector(".analysis-eff")).filter(hasNumber),true);
}

function color(cells,higher=true,palette="default") {
  cells=cells.filter(Boolean); const nums=cells.map(c=>firstNumber(c.textContent)).filter(Number.isFinite); if(!nums.length)return;
  const lo=Math.min(...nums),hi=Math.max(...nums), palettes={default:[[255,224,224],[255,243,191],[216,243,220]],temp:[[216,243,220],[255,243,191],[255,224,224]],humidity:[[232,247,236],[224,240,242],[210,230,255]],rain:[[255,255,255],[234,243,252],[210,230,255]]};
  const [low,mid,high]=palettes[palette]||palettes.default;
  cells.forEach(c=>{const v=firstNumber(c.textContent);if(!Number.isFinite(v))return;let n=hi===lo?.5:(v-lo)/(hi-lo);if(!higher)n=1-n;const rgb=n<=.5?mix(low,mid,n/.5):mix(mid,high,(n-.5)/.5);c.style.backgroundColor=`rgb(${rgb.join(",")})`;c.classList.add("analysis-heat");});
}

function timingUsable(s){return s==="complete"||s==="caution";} function efficiency(r){return Number.isFinite(r.lost)&&Number.isFinite(r.hours)&&r.hours>0?r.lost*24/r.hours:null;}
function values(a,k){return a.map(x=>x[k]).filter(Number.isFinite);} function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;} function sum(a,k){return a.reduce((s,x)=>s+(optionalNumber(x[k])??0),0);}
function earliest(a,k){return a.map(x=>x[k]).filter(Boolean).sort((x,y)=>Date.parse(x)-Date.parse(y))[0]||"";} function latest(a,k){return a.map(x=>x[k]).filter(Boolean).sort((x,y)=>Date.parse(y)-Date.parse(x))[0]||"";}
function optionalNumber(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;} function sortValue(v){return Number.isFinite(v)?String(v):"";} function firstNumber(t){const m=String(t||"").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;} function hasNumber(c){return !!c&&Number.isFinite(firstNumber(c.textContent));} function mix(a,b,t){return a.map((v,i)=>Math.round(v+(b[i]-v)*t));}
function fmt(v,s=""){return Number.isFinite(v)?`${v.toFixed(1)}${s}`:"—";} function range(a,s=""){if(!a.length)return"—";const lo=Math.min(...a),hi=Math.max(...a);return Math.abs(lo-hi)<1e-9?"—":`${lo.toFixed(1)}–${hi.toFixed(1)}${s}`;} function timeSummary(a){if(!a.length)return"—";return a.length===1?`${a[0].toFixed(1)} h (${(a[0]/24).toFixed(1)} d)`:`${avg(a).toFixed(1)} h avg (${Math.min(...a).toFixed(1)}–${Math.max(...a).toFixed(1)})`;}
function dateRange(r){return r.end?`${formatDate(r.start)} – ${formatDate(r.end)}`:`${formatDate(r.start)} → in progress`;} function formatDate(v){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:KENYA_TIME_ZONE});}
function note(t,g){const n=[];if(t==="NEW T4")n.push("Includes multiple later trial configurations.");if(t.startsWith("EXISTING SHED"))n.push("Existing shed is normally recorded as one whole-table bay.");if(g.some(r=>r.status==="in_progress"))n.push("Run in progress.");return n.join(" ")||"—";}
function chips(g){const c=g.filter(r=>r.status==="complete").length,o=g.filter(r=>r.status==="caution").length,x=g.filter(r=>r.status==="excluded").length;return[c?`<span class="analysis-chip" title="Timing treated as usable.">🟢 ${c}</span>`:"",o?`<span class="analysis-chip" title="Timing usable with caution; exact dry-end point was not independently observed.">🟠 ${o}</span>`:"",x?`<span class="analysis-chip" title="Timing excluded from drying-speed analysis.">🔴 ${x}</span>`:""].filter(Boolean).join(" ")||'<span class="analysis-chip">⚪ none</span>';}
function status(s){const map={complete:["good","complete"],caution:["caution","caution"],excluded:["bad","excluded"],in_progress:["pending","in progress"]};const [k,l]=map[s]||map.in_progress;return `<span class="analysis-status ${k}"><span aria-hidden="true">●</span> ${l}</span>`;}
function kenyaDateKey(v){if(!v)return"";const d=new Date(v);if(Number.isNaN(d.getTime()))return"";const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:KENYA_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}`;}
function setStatus(message,type=""){if(!els.status)return;els.status.textContent=message||"";if(type)els.status.dataset.status=type;else delete els.status.dataset.status;}
async function responseDetail(response){try{const p=await response.json();const d=p?.message||p?.details||p?.hint||p?.error||"";return d?` - ${d}`:"";}catch{const d=await response.text();return d?` - ${d}`:"";}}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");} function escAttr(v){return esc(v).replace(/`/g,"&#096;");}
