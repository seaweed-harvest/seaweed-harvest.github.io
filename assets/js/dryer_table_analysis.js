import { currentAccessToken } from "./auth_client.js?v=25";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";
import "./dryer_analysis_weather_snapshot.js?v=1";

const RPC_NAME = "list_authenticated_seaweed_drying_ledger";
const KENYA_TIME_ZONE = "Africa/Nairobi";
const TAB = "analysis";
const ORDER = ["NEW T1","NEW T2","NEW T3","NEW T4","EXISTING SHED T1","EXISTING SHED T2","EXISTING SHED T3","EXISTING SHED T4","EXISTING SHED T5","Shed - General"];
const RUN_COLORS = {
  "NEW T1":"#4C78A8","NEW T2":"#F58518","NEW T3":"#54A24B","NEW T4":"#E45756",
  "Shed - General":"#72B7B2","EXISTING SHED T1":"#B279A2","EXISTING SHED T2":"#FF9DA6",
  "EXISTING SHED T3":"#9D755D","EXISTING SHED T4":"#59A14F","EXISTING SHED T5":"#BAB0AC"
};
const D = window.DRYER_WEATHER;
const TIDE = window.DRYER_TIDE;
const WEATHER_DATES = D.oneMonth.x.map((x) => String(x).slice(0, 10));
const WEATHER_TEMP = D.oneMonth.temp;
const WEATHER_RH = D.oneMonth.hum;
const RAIN_DATES = D.rain.x.map((x) => String(x).slice(0, 10));
const RAIN_VALUES = D.rain.y;
const WEATHER = new Map(WEATHER_DATES.map((d, i) => [d, { temp: WEATHER_TEMP[i], rh: WEATHER_RH[i] }]));
const RAIN = new Map(RAIN_DATES.map((d, i) => [d, RAIN_VALUES[i]]));
const state = { runs: [], rangeDays: 30, tideEnabled: false, sort: { col: 1, dir: "desc" }, loading: false };
const els = {};
let plotlyPromise;

document.addEventListener("DOMContentLoaded", init);

function init() {
  installShell();
  cache();
  if (!els.tabs || !els.tab || !els.panel) return;
  bind();
  if (new URLSearchParams(location.search).get("tab") === TAB) void activateWhenRecordsReady();
}

async function activateWhenRecordsReady() {
  if (document.body.hasAttribute("data-auth-pending")) {
    await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.body.hasAttribute("data-auth-pending")) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-auth-pending"] });
      window.setTimeout(() => { observer.disconnect(); resolve(); }, 10000);
    });
  }
  await activate();
}

function addStyle(href, marker) {
  if (document.querySelector(`link[${marker}]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(marker, "true");
  document.head.appendChild(link);
}

function installShell() {
  addStyle("./assets/css/dryer_analysis_live.css?v=2", "data-dryer-analysis-style");
  addStyle("./assets/css/dryer_analysis_weather_parity.css?v=1", "data-dryer-analysis-weather-style");

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
      <details open class="dryer-analysis-card"><summary>2. Drying timeline + Weather</summary><div class="dryer-analysis-card-body dryer-analysis-weather-parity">
        <div class="dryer-analysis-weather-header">
          <div class="dryer-analysis-weather-subtitle">Local Bati temperature and humidity from Seaweed Station, with longer views based only on daylight measurements. Rainfall is regional context, not a Bati rain-gauge measurement.</div>
          <div class="dryer-analysis-weather-controls">
            <button type="button" data-analysis-range="7">7 days</button>
            <button type="button" data-analysis-range="30" class="active">1 month</button>
            <button type="button" data-analysis-range="90">3 months</button>
            <button id="dryerAnalysisTideToggle" type="button">Tide overlay</button>
          </div>
        </div>
        <div class="dryer-analysis-weather-pills">
          <span class="dryer-analysis-weather-pill" id="dryerAnalysisWeatherMethod">Daylight average 07:00–17:59 · 3-day smoothing</span>
          <span class="dryer-analysis-weather-pill">Rainfall · daily regional total</span>
          <span class="dryer-analysis-weather-pill">Timezone · East Africa Time</span>
          <span class="dryer-analysis-weather-pill" id="dryerAnalysisTidePill" hidden>Harvest window · lowest low &lt; 0.5 m</span>
        </div>
        <div class="dryer-analysis-chart-wrap"><div id="dryerAnalysisWeatherChart"></div>
          <p class="dryer-analysis-note">7-day view retains the day/night cycle. 1-month and 3-month views use daylight measurements only. Regional rainfall is contextual and missing dates remain blank. Tide overlay uses KMFRI 2026 Mombasa predictions; green bands mark days where the lowest predicted low is below 0.5 m. Dryer run bars are live from Dryer Table records.</p>
        </div>
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
  els.weatherMethod = document.getElementById("dryerAnalysisWeatherMethod");
  els.tideButton = document.getElementById("dryerAnalysisTideToggle");
  els.tidePill = document.getElementById("dryerAnalysisTidePill");
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

  els.tideButton?.addEventListener("click", () => {
    state.tideEnabled = !state.tideEnabled;
    els.tideButton.classList.toggle("active", state.tideEnabled);
    els.tidePill.hidden = !state.tideEnabled;
    renderWeather();
  });

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
  const url = new URL(location.href);
  url.searchParams.set("tab", TAB);
  history.replaceState({}, "", url);
  try {
    await ensurePlotly();
    await load();
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  }
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
      headers: {
        apikey: DRYING_FORM_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${DRYING_FORM_CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_account_access_token: token, p_limit: 5000 })
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
    const data = await response.json();
    state.runs = buildRuns(Array.isArray(data?.bay_rows) ? data.bay_rows : []);
    render();
    setStatus(`${state.runs.length} drying ${state.runs.length === 1 ? "event" : "events"} analysed from live records · refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } finally {
    state.loading = false;
  }
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

function render() {
  renderSummary();
  renderRuns();
  heatmaps();
  renderScatter();
  renderWeather();
}

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
  const body = document.querySelector("#dryerAnalysisRunTable tbody");
  if (!body) return;
  const dir = state.sort.col === col && state.sort.dir === "asc" ? "desc" : "asc";
  const get = (cell) => {
    const raw = cell.dataset.sort ?? cell.textContent.trim();
    if (!raw || raw === "—") return null;
    if (type === "number") return Number(raw);
    if (type === "date") return Date.parse(raw);
    return raw.toLowerCase();
  };
  [...body.rows].sort((a,b) => {
    const x=get(a.cells[col]), y=get(b.cells[col]);
    if (x==null&&y==null) return 0;
    if (x==null) return 1;
    if (y==null) return -1;
    return x<y ? (dir==="asc"?-1:1) : x>y ? (dir==="asc"?1:-1) : 0;
  }).forEach((row) => body.appendChild(row));
  state.sort = { col, dir };
  document.querySelectorAll("#dryerAnalysisRunTable th").forEach((th,i) => {
    th.classList.remove("analysis-sort-asc","analysis-sort-desc");
    if (i===col) th.classList.add(dir==="asc"?"analysis-sort-asc":"analysis-sort-desc");
  });
}

function renderScatter() {
  if (!window.Plotly) return;
  const groups = new Map();
  state.runs.filter((r) => timingUsable(r.status) && Number.isFinite(r.hours) && Number.isFinite(r.lost)).forEach((r) => {
    if (!groups.has(r.table)) groups.set(r.table, []);
    groups.get(r.table).push(r);
  });
  const traces = [...groups.entries()].map(([name,runs]) => ({
    x:runs.map(r=>r.hours), y:runs.map(r=>r.lost), mode:"markers", type:"scatter", name, marker:{size:11},
    text:runs.map(r=>`<b>${esc(r.table)}</b><br>${esc(dateRange(r))}<br>Drying time: ${r.hours.toFixed(1)} h<br>Weight lost: ${r.lost.toFixed(1)}%<br>Start load: ${r.startkg.toFixed(1)} kg<br>End load: ${r.endkg.toFixed(1)} kg<br>Bays: ${r.bays}<br>Load / bay: ${r.kgpb.toFixed(1)} kg`),
    hovertemplate:"%{text}<extra></extra>"
  }));
  window.Plotly.react(els.scatter, traces, {
    xaxis:{title:"Recorded drying time (hours)",fixedrange:true}, yaxis:{title:"Weight lost (%)",fixedrange:true},
    hovermode:"closest", dragmode:false, margin:{l:60,r:20,t:20,b:60}, paper_bgcolor:"transparent", plot_bgcolor:"#fff",
    legend:{orientation:"h",y:-0.22}
  }, {responsive:true,displaylogo:false,scrollZoom:false,doubleClick:false,displayModeBar:false});
}

function selectedWeather(days) {
  if (days === 7) return { w: D.recent, method: "Measured 3-hour data · lightly smoothed 6 hours" };
  if (days === 30) return { w: D.oneMonth, method: "Daylight average 07:00–17:59 · 3-day smoothing" };
  return { w: D.threeMonth, method: "Daylight average 07:00–17:59 · 7-day smoothing" };
}

function weatherBounds(days) {
  const snapshotEnd = Date.parse(D.end);
  const liveEnd = state.runs.reduce((latest, run) => Math.max(latest, Date.parse(run.end || run.start) || 0), 0);
  const end = new Date(Math.max(snapshotEnd, liveEnd));
  return [new Date(end.getTime() - days * 86400000), end];
}

function weatherTraces(days) {
  const selected = selectedWeather(days);
  const fmt = days === 7 ? "%{x|%a %d %b %H:%M}" : "%{x|%a %d %b %Y}";
  const out = [
    {x:selected.w.x,y:selected.w.temp,type:"scatter",mode:"lines",name:"Temperature",line:{color:"#e78a55",width:2.7,shape:"spline",smoothing:.28},xaxis:"x",yaxis:"y",hovertemplate:fmt+"<br><b>%{y:.1f} °C</b><extra>Temperature</extra>"},
    {x:selected.w.x,y:selected.w.hum,type:"scatter",mode:"lines",name:"Humidity",line:{color:"#4ca58f",width:2.5,shape:"spline",smoothing:.28},xaxis:"x",yaxis:"y2",hovertemplate:fmt+"<br><b>%{y:.0f}% RH</b><extra>Humidity</extra>"},
    {x:D.rain.x,y:D.rain.y,customdata:D.rain.source,type:"bar",name:"Rainfall",marker:{color:"#7da7d4"},opacity:.5,xaxis:"x",yaxis:"y3",hovertemplate:"%{x|%a %d %b}<br><b>%{y:.1f} mm</b><br>%{customdata}<extra>Regional rainfall</extra>"}
  ];

  if (state.tideEnabled) {
    out.push({x:TIDE.x,y:TIDE.height,customdata:TIDE.date.map((d,i)=>[d,TIDE.time[i]]),type:"scatter",mode:"lines",name:"Lowest low tide",line:{color:"#687ea6",width:2.2,shape:"spline",smoothing:.45},xaxis:"x",yaxis:"y5",hovertemplate:"%{customdata[0]}<br>Low tide: <b>%{y:.2f} m</b> at %{customdata[1]} EAT<extra>Daily lowest low</extra>"});
  }

  const [, rangeEnd] = weatherBounds(days);
  state.runs.forEach((run) => {
    const end = run.end || rangeEnd.toISOString();
    out.push({
      x:[run.start,end], y:[run.table,run.table], type:"scatter", mode:"lines",
      line:{color:RUN_COLORS[run.table] || "#7c8f89",width:13}, showlegend:false, xaxis:"x2", yaxis:"y4",
      hovertemplate:`<b>${esc(run.table)}</b><br>${esc(dateRange(run))}<br>${run.bays} bays · ${fmt(run.startkg," kg")} loaded<extra></extra>`
    });
  });
  return out;
}

function weatherLayout(days) {
  const [start,end] = weatherBounds(days);
  const major = days===7 ? 1 : days===30 ? 3 : 7;
  const minor = days===7 ? 12 : days===30 ? 24 : 48;
  const ticks=[];
  let t=new Date(start);
  t.setHours(0,0,0,0);
  while(t<=end){ticks.push(t.toISOString());t=new Date(t.getTime()+major*86400000);}
  const texts=ticks.map((v)=>{
    const d=new Date(v);
    return d.toLocaleDateString("en-GB",{weekday:"short",timeZone:KENYA_TIME_ZONE})+"<br><b>"+d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",timeZone:KENYA_TIME_ZONE})+"</b>";
  });
  const shapes=[];
  let mt=new Date(start);
  mt.setMinutes(0,0,0);
  while(mt<=end){
    shapes.push({type:"line",xref:"x2",yref:"paper",x0:mt.toISOString(),x1:mt.toISOString(),y0:.07,y1:.96,line:{color:"rgba(70,90,85,.055)",width:.7},layer:"below"});
    mt=new Date(mt.getTime()+minor*3600000);
  }
  ticks.forEach((v)=>shapes.push({type:"line",xref:"x2",yref:"paper",x0:v,x1:v,y0:.07,y1:.96,line:{color:"rgba(70,90,85,.14)",width:1},layer:"below"}));
  shapes.push({type:"line",xref:"paper",yref:"paper",x0:.055,x1:.875,y0:.57,y1:.57,line:{color:"rgba(70,90,85,.30)",width:1.25},layer:"above"});

  if (state.tideEnabled) {
    TIDE.date.forEach((d,i)=>{
      if (+TIDE.height[i] >= TIDE.threshold) return;
      const a=new Date(`${d}T00:00:00+03:00`), b=new Date(a.getTime()+86400000);
      if (b<start || a>end) return;
      shapes.push({type:"rect",xref:"x",yref:"paper",x0:a.toISOString(),x1:b.toISOString(),y0:.57,y1:.96,fillcolor:"rgba(86,170,102,.11)",line:{width:0},layer:"below"});
    });
  }

  const tables = [...new Set(state.runs.map((run)=>run.table))].sort((a,b)=>{
    const ai=ORDER.indexOf(a), bi=ORDER.indexOf(b);
    return (ai<0?999:ai)-(bi<0?999:bi) || a.localeCompare(b);
  });

  return {
    paper_bgcolor:"#fff", plot_bgcolor:"#fff", margin:{l:150,r:150,t:40,b:30}, hovermode:"x", dragmode:false, bargap:.18,
    legend:{orientation:"h",x:.055,y:1.025,xanchor:"left",yanchor:"bottom"},
    xaxis:{domain:[.055,.875],anchor:"y",type:"date",range:[start,end],matches:"x2",showticklabels:false,showgrid:false,zeroline:false,fixedrange:true},
    yaxis:{domain:[.57,.96],anchor:"x",title:"Temperature",side:"left",fixedrange:true,showgrid:true,gridcolor:"rgba(70,90,85,.10)",zeroline:false,ticksuffix:" °C",tickformat:".0f",dtick:1},
    yaxis2:{overlaying:"y",anchor:"free",position:.90,side:"right",title:"Humidity",fixedrange:true,range:[45,100],showgrid:false,zeroline:false,ticksuffix:" %",tickformat:".0f",dtick:10},
    yaxis3:{overlaying:"y",anchor:"free",position:.965,side:"right",title:"Rainfall",fixedrange:true,rangemode:"tozero",showgrid:false,zeroline:false,ticksuffix:" mm",tickformat:".0f",dtick:10},
    yaxis5:{overlaying:"y",anchor:"free",position:.012,side:"left",title:"Low tide",fixedrange:true,range:[0,1.6],visible:state.tideEnabled,showgrid:false,zeroline:false,ticksuffix:" m",tickformat:".1f",dtick:.5,tickfont:{color:"#687ea6"},titlefont:{color:"#687ea6"}},
    xaxis2:{domain:[.055,.875],anchor:"y4",type:"date",range:[start,end],fixedrange:true,tickmode:"array",tickvals:ticks,ticktext:texts,side:"top",ticks:"outside",ticklen:7,showgrid:false,zeroline:false},
    yaxis4:{domain:[.10,.49],anchor:"x2",type:"category",fixedrange:true,categoryorder:"array",categoryarray:[...tables].reverse(),showgrid:false,zeroline:false,tickfont:{size:11}},
    shapes,
    annotations:[{xref:"paper",yref:"paper",x:.055,y:.985,text:"<b>Weather</b>",showarrow:false,xanchor:"left",font:{size:13,color:"#526a63"}}]
  };
}

function renderWeather() {
  if (!window.Plotly || !D || !TIDE) return;
  const selected = selectedWeather(state.rangeDays);
  if (els.weatherMethod) els.weatherMethod.textContent = selected.method;
  if (els.tideButton) els.tideButton.classList.toggle("active", state.tideEnabled);
  if (els.tidePill) els.tidePill.hidden = !state.tideEnabled;
  window.Plotly.react(els.weather, weatherTraces(state.rangeDays), weatherLayout(state.rangeDays), {
    responsive:true,displaylogo:false,scrollZoom:false,doubleClick:false,displayModeBar:false
  });
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
  cells=cells.filter(Boolean);
  const nums=cells.map(c=>firstNumber(c.textContent)).filter(Number.isFinite);
  if(!nums.length)return;
  const lo=Math.min(...nums),hi=Math.max(...nums);
  const palettes={default:[[255,224,224],[255,243,191],[216,243,220]],temp:[[216,243,220],[255,243,191],[255,224,224]],humidity:[[232,247,236],[224,240,242],[210,230,255]],rain:[[255,255,255],[234,243,252],[210,230,255]]};
  const [low,mid,high]=palettes[palette]||palettes.default;
  cells.forEach(c=>{
    const v=firstNumber(c.textContent);
    if(!Number.isFinite(v))return;
    let n=hi===lo?.5:(v-lo)/(hi-lo);
    if(!higher)n=1-n;
    const rgb=n<=.5?mix(low,mid,n/.5):mix(mid,high,(n-.5)/.5);
    c.style.backgroundColor=`rgb(${rgb.join(",")})`;
    c.classList.add("analysis-heat");
  });
}

function timingUsable(s){return s==="complete"||s==="caution";}
function efficiency(r){return Number.isFinite(r.lost)&&Number.isFinite(r.hours)&&r.hours>0?r.lost*24/r.hours:null;}
function values(a,k){return a.map(x=>x[k]).filter(Number.isFinite);}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
function sum(a,k){return a.reduce((s,x)=>s+(optionalNumber(x[k])??0),0);}
function earliest(a,k){return a.map(x=>x[k]).filter(Boolean).sort((x,y)=>Date.parse(x)-Date.parse(y))[0]||"";}
function latest(a,k){return a.map(x=>x[k]).filter(Boolean).sort((x,y)=>Date.parse(y)-Date.parse(x))[0]||"";}
function optionalNumber(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function sortValue(v){return Number.isFinite(v)?String(v):"";}
function firstNumber(t){const m=String(t||"").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;}
function hasNumber(c){return !!c&&Number.isFinite(firstNumber(c.textContent));}
function mix(a,b,t){return a.map((v,i)=>Math.round(v+(b[i]-v)*t));}
function fmt(v,s=""){return Number.isFinite(v)?`${v.toFixed(1)}${s}`:"—";}
function range(a,s=""){if(!a.length)return"—";const lo=Math.min(...a),hi=Math.max(...a);return Math.abs(lo-hi)<1e-9?"—":`${lo.toFixed(1)}–${hi.toFixed(1)}${s}`;}
function timeSummary(a){if(!a.length)return"—";return a.length===1?`${a[0].toFixed(1)} h (${(a[0]/24).toFixed(1)} d)`:`${avg(a).toFixed(1)} h avg (${Math.min(...a).toFixed(1)}–${Math.max(...a).toFixed(1)})`;}
function dateRange(r){return r.end?`${formatDate(r.start)} – ${formatDate(r.end)}`:`${formatDate(r.start)} → in progress`;}
function formatDate(v){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:KENYA_TIME_ZONE});}
function note(t,g){const n=[];if(t==="NEW T4")n.push("Includes multiple later trial configurations.");if(t.startsWith("EXISTING SHED"))n.push("Existing shed is normally recorded as one whole-table bay.");if(g.some(r=>r.status==="in_progress"))n.push("Run in progress.");return n.join(" ")||"—";}
function chips(g){const c=g.filter(r=>r.status==="complete").length,o=g.filter(r=>r.status==="caution").length,x=g.filter(r=>r.status==="excluded").length;return[c?`<span class="analysis-chip" title="Timing treated as usable.">🟢 ${c}</span>`:"",o?`<span class="analysis-chip" title="Timing usable with caution; exact dry-end point was not independently observed.">🟠 ${o}</span>`:"",x?`<span class="analysis-chip" title="Timing excluded from drying-speed analysis.">🔴 ${x}</span>`:""].filter(Boolean).join(" ")||'<span class="analysis-chip">⚪ none</span>';}
function status(s){const map={complete:["good","complete"],caution:["caution","caution"],excluded:["bad","excluded"],in_progress:["pending","in progress"]};const [k,l]=map[s]||map.in_progress;return `<span class="analysis-status ${k}"><span aria-hidden="true">●</span> ${l}</span>`;}
function kenyaDateKey(v){if(!v)return"";const d=new Date(v);if(Number.isNaN(d.getTime()))return"";const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:KENYA_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}`;}
function setStatus(message,type=""){if(!els.status)return;els.status.textContent=message||"";if(type)els.status.dataset.status=type;else delete els.status.dataset.status;}
async function responseDetail(response){try{const p=await response.json();const d=p?.message||p?.details||p?.hint||p?.error||"";return d?` - ${d}`:"";}catch{const d=await response.text();return d?` - ${d}`:"";}}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");}
function escAttr(v){return esc(v).replace(/`/g,"&#096;");}
