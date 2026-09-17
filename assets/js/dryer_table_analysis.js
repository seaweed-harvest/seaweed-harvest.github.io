import { currentAccessToken } from "./auth_client.js?v=25";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";

const RPC_NAME = "list_authenticated_seaweed_drying_ledger";
const KENYA_TIME_ZONE = "Africa/Nairobi";
const ANALYSIS_TAB = "analysis";
const WEATHER_DATES = Array.from({ length: 78 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, 1 + index));
  return date.toISOString().slice(0, 10);
});
const WEATHER_TEMP = [27.89,27.47,27.08,26.7,27.3,27.77,28.54,28.71,29.04,28.84,28.97,29.01,29.08,29.13,29.45,29.23,29.47,29.39,30.37,31.35,31.44,31.16,29.6,29.75,28.98,28.55,28.5,28.89,30.06,28.94,28.53,27.95,28.47,28.68,28.62,29.35,29.71,30.01,30.15,29.87,30.76,30.88,31.64,31.01,29.81,29.04,28.77,28.24,27.91,28.15,29.75,30.14,30.32,30.61,30.94,30.68,30.4,30.17,30.49,30.02,30.06,29.93,29.99,30.56,31.28,32.04,31.85,31.35,31.55,31.05,30.59,28.07,28.65,29.62,32.01,31.87,31.61,31.41];
const WEATHER_RH = [72.7,74.08,75.53,76.61,75.21,73.05,71.23,71.34,71.62,73.11,71.56,70.72,70.28,70.7,69.55,69.51,67.76,68.46,66.25,65.22,65.3,65.33,69.6,69.37,72.65,73.72,72.75,71.07,66.77,71.88,73.36,75.21,72.56,71.8,72.13,70.11,69.28,69.61,69.05,69.51,66.15,65.27,62.9,64.59,69.33,71.7,73.3,75.39,77.4,75.77,69.99,70.33,72.0,70.93,68.04,67.77,68.43,69.16,68.01,71.38,71.76,71.88,70.8,67.9,66.11,64.21,65.85,66.65,64.44,65.69,68.38,79.41,79.72,76.31,66.94,66.4,66.96,67.59];
const RAIN_VALUES = [1.5,0.3,1.3,0.0,0.9,3.2,4.9,1.0,3.0,0.0,0.0,0.5,0.0,0.0,0.0,7.0,30.0,58.0,5.0,0.0,5.0,2.0];
const RAIN_DATES = RAIN_VALUES.map((_, index) => {
  const date = new Date(Date.UTC(2026, 7, 25 + index));
  return date.toISOString().slice(0, 10);
});
const WEATHER = new Map(WEATHER_DATES.map((date, index) => [date, { temp: WEATHER_TEMP[index], rh: WEATHER_RH[index] }]));
const RAIN = new Map(RAIN_DATES.map((date, index) => [date, RAIN_VALUES[index]]));
const TABLE_ORDER = ["NEW T1", "NEW T2", "NEW T3", "NEW T4", "EXISTING SHED T1", "EXISTING SHED T2", "EXISTING SHED T3", "EXISTING SHED T4", "EXISTING SHED T5", "Shed - General"];
const state = { runs: [], rangeDays: 30, sort: { col: 1, dir: "desc" }, loading: false, loadedAt: 0 };
const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  if (!els.tab || !els.panel) return;
  bindTabNavigation();
  bindControls();
  if (new URLSearchParams(window.location.search).get("tab") === ANALYSIS_TAB) {
    setTimeout(() => activateAnalysis({ focus: false }), 0);
  }
}

function cacheElements() {
  els.tabs = document.getElementById("dryerRecordTabs");
  els.tab = document.getElementById("dryerAnalysisTab");
  els.panel = document.getElementById("dryerAnalysisPanel");
  els.summaryBody = document.querySelector("#dryerAnalysisSummaryTable tbody");
  els.runBody = document.querySelector("#dryerAnalysisRunTable tbody");
  els.status = document.getElementById("dryerAnalysisStatus");
  els.scatter = document.getElementById("dryerAnalysisScatter");
  els.weather = document.getElementById("dryerAnalysisWeatherChart");
  els.detailsButton = document.getElementById("dryerAnalysisToggleDetails");
  els.reload = document.getElementById("reloadDryerRecords");
}

function bindTabNavigation() {
  els.tabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dryer-tab]");
    if (!button) return;
    if (button.dataset.dryerTab === ANALYSIS_TAB) {
      event.preventDefault();
      event.stopPropagation();
      activateAnalysis({ focus: false });
    } else {
      hideAnalysis();
    }
  }, true);

  els.tabs?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const tabs = [...els.tabs.querySelectorAll("[data-dryer-tab]")];
    const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    let next = current < 0 ? 0 : current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "ArrowLeft") next = Math.max(0, next - 1);
    else next = Math.min(tabs.length - 1, next + 1);
    tabs[next]?.click();
    tabs[next]?.focus();
  }, true);

  els.reload?.addEventListener("click", () => {
    if (!els.panel.hidden) setTimeout(() => loadAnalysis(), 25);
  });
}

function bindControls() {
  document.querySelectorAll("[data-analysis-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.rangeDays = Number(button.dataset.analysisRange) || 30;
      document.querySelectorAll("[data-analysis-range]").forEach((item) => item.classList.toggle("active", item === button));
      renderWeather();
    });
  });
  els.detailsButton?.addEventListener("click", () => {
    const expanded = els.detailsButton.getAttribute("aria-expanded") === "true";
    document.querySelectorAll("#dryerAnalysisSummaryTable .analysis-detail-col").forEach((cell) => cell.classList.toggle("analysis-hidden", expanded));
    els.detailsButton.setAttribute("aria-expanded", expanded ? "false" : "true");
    els.detailsButton.textContent = expanded ? "Show notes & timing evidence" : "Hide notes & timing evidence";
  });
  document.querySelectorAll("#dryerAnalysisRunTable thead th[data-sort-type]").forEach((th, col) => {
    th.addEventListener("click", () => sortRuns(col, th.dataset.sortType || "text"));
  });
}

function activateAnalysis({ focus = false } = {}) {
  ["dryerAllPanel", "dryerObservationsPanel", "dryerPaymentsPanel"].forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = true;
  });
  [...els.tabs.querySelectorAll("[data-dryer-tab]")].forEach((button) => {
    const active = button.dataset.dryerTab === ANALYSIS_TAB;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  els.panel.hidden = false;
  if (focus) els.tab.focus();
  const url = new URL(window.location.href);
  url.searchParams.set("tab", ANALYSIS_TAB);
  window.history.replaceState({}, "", url);
  loadAnalysis();
}

function hideAnalysis() {
  if (els.panel) els.panel.hidden = true;
}

async function loadAnalysis() {
  if (state.loading) return;
  state.loading = true;
  setStatus("Refreshing live Dryer Table records…");
  try {
    const accountToken = await currentAccessToken();
    const response = await fetch(`${DRYING_FORM_CONFIG.supabaseUrl}/rest/v1/rpc/${RPC_NAME}`, {
      method: "POST",
      headers: {
        apikey: DRYING_FORM_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${DRYING_FORM_CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_account_access_token: accountToken, p_limit: 5000 })
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}${await responseDetail(response)}`);
    const data = await response.json();
    const rows = Array.isArray(data?.bay_rows) ? data.bay_rows : [];
    state.runs = buildRuns(rows);
    state.loadedAt = Date.now();
    render();
    setStatus(`${state.runs.length} drying ${state.runs.length === 1 ? "event" : "events"} analysed from live records · refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } catch (error) {
    setStatus(`Analysis could not refresh: ${error?.message || error}`, "error");
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
  const tableRaw = rows.find((row) => row.table_location)?.table_location || "Unknown table";
  const table = analysisTableName(tableRaw);
  const start = earliest(rows, "loading_at") || earliest(rows, "recorded_at");
  const allComplete = rows.length > 0 && rows.every((row) => row.status === "complete" && row.unloading_at && optionalNumber(row.unloading_weight_kg) !== null);
  const end = allComplete ? latest(rows, "unloading_at") : "";
  const bays = new Set(rows.map((row) => String(row.bay_number ?? "unknown"))).size;
  const startkg = sum(rows, "loading_weight_kg");
  const unloadedKg = sum(rows, "unloading_weight_kg");
  const endkg = allComplete ? unloadedKg : null;
  const kgpb = bays > 0 ? startkg / bays : null;
  const lost = allComplete && startkg > 0 ? ((startkg - unloadedKg) / startkg) * 100 : null;
  const hours = allComplete && Date.parse(end) >= Date.parse(start) ? (Date.parse(end) - Date.parse(start)) / 3600000 : null;
  const status = timingStatus(table, start, end, allComplete);
  const weather = weatherAverage(start, end || start);
  return { table, tableRaw, start, end, bays, startkg, endkg, kgpb, lost, hours, status, temp: weather.temp, rh: weather.rh, rain: weather.rain };
}

function timingStatus(table, start, end, allComplete) {
  if (!allComplete) return "in_progress";
  const startDate = kenyaDateKey(start);
  const endDate = kenyaDateKey(end);
  if (endDate === "2026-09-04") {
    if (["NEW T1", "NEW T2", "NEW T3"].includes(table) && startDate === "2026-08-31") return "caution";
    return "excluded";
  }
  return "complete";
}

function analysisTableName(value) {
  const text = String(value || "").trim();
  const bati = text.match(/Bati\s*\(Table\s*(\d+)\)/i) || text.match(/Bati.*Table\s*(\d+)/i);
  if (bati) return `NEW T${bati[1]}`;
  const shed = text.match(/Dryer\s*Shed\s*-\s*T(\d+)/i);
  if (shed) return `EXISTING SHED T${shed[1]}`;
  if (/^Dryer\s*Shed$/i.test(text)) return "Shed - General";
  return text || "Unknown table";
}

function weatherAverage(start, end) {
  const first = kenyaDateKey(start);
  const last = kenyaDateKey(end);
  if (!first) return { temp: null, rh: null, rain: null };
  const temps = [], rhs = [], rains = [];
  let cursor = new Date(`${first}T12:00:00Z`);
  const stop = new Date(`${last || first}T12:00:00Z`);
  let guard = 0;
  while (cursor <= stop && guard++ < 120) {
    const key = cursor.toISOString().slice(0, 10);
    const weather = WEATHER.get(key);
    if (weather) { temps.push(weather.temp); rhs.push(weather.rh); }
    if (RAIN.has(key)) rains.push(RAIN.get(key));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return { temp: average(temps), rh: average(rhs), rain: average(rains) };
}

function render() {
  renderSummary();
  renderRuns();
  applyHeatmaps();
  renderScatter();
  renderWeather();
}

function renderSummary() {
  if (!els.summaryBody) return;
  const names = [...TABLE_ORDER, ...state.runs.map((run) => run.table).filter((name) => !TABLE_ORDER.includes(name))];
  const unique = [...new Set(names)].filter((name) => state.runs.some((run) => run.table === name) || TABLE_ORDER.includes(name));
  els.summaryBody.innerHTML = unique.map((table) => {
    const group = state.runs.filter((run) => run.table === table);
    const completed = group.filter((run) => run.status !== "in_progress");
    const timed = group.filter((run) => timingUsable(run.status));
    const efficiencies = timed.map(efficiency).filter(Number.isFinite);
    const hours = timed.map((run) => run.hours).filter(Number.isFinite);
    return `<tr>
      <td class="analysis-name">${table}</td>
      <td>${completed.length}</td><td>${group.filter((run) => run.status === "in_progress").length}</td>
      <td>${formatNumber(average(values(completed, "bays")))}</td>
      <td>${formatNumber(average(values(completed, "startkg")), " kg")}</td>
      <td>${formatNumber(average(values(completed, "kgpb")), " kg")}</td>
      <td>${formatRange(values(completed, "kgpb"), " kg")}</td>
      <td>${formatRange(values(completed, "lost"), "%")}</td>
      <td class="analysis-summary-loss">${formatNumber(average(values(completed, "lost")), "%")}</td>
      <td class="analysis-summary-time">${formatTimeSummary(hours)}</td>
      <td class="analysis-summary-eff">${formatNumber(average(efficiencies), " %/day")}</td>
      <td class="analysis-detail-col analysis-hidden">${summaryNote(table, group)}</td>
      <td class="analysis-detail-col analysis-hidden">${timingChips(group)}</td>
    </tr>`;
  }).join("");
}

function renderRuns() {
  if (!els.runBody) return;
  const ordered = [...state.runs].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  els.runBody.innerHTML = ordered.map((run) => {
    const eff = timingUsable(run.status) ? efficiency(run) : null;
    return `<tr data-start="${run.start}">
      <td data-sort="${run.table.toLowerCase()}">${run.table}</td>
      <td data-sort="${run.start}">${formatDateRange(run)}</td>
      <td data-sort="${run.bays}">${run.bays}</td>
      <td data-sort="${sortValue(run.startkg)}">${formatNumber(run.startkg, " kg")}</td>
      <td data-sort="${sortValue(run.endkg)}">${formatNumber(run.endkg, " kg")}</td>
      <td data-sort="${sortValue(run.kgpb)}">${formatNumber(run.kgpb, " kg")}</td>
      <td class="analysis-temp" data-sort="${sortValue(run.temp)}">${formatNumber(run.temp, " °C")}</td>
      <td class="analysis-rh" data-sort="${sortValue(run.rh)}">${formatNumber(run.rh, "%")}</td>
      <td class="analysis-rain" data-sort="${sortValue(run.rain)}">${formatNumber(run.rain, " mm/day")}</td>
      <td class="analysis-loss" data-sort="${sortValue(run.lost)}">${formatNumber(run.lost, "%")}</td>
      <td class="analysis-time" data-usable="${timingUsable(run.status) ? "1" : "0"}" data-sort="${sortValue(run.hours)}">${formatNumber(run.hours, " h")}</td>
      <td class="analysis-eff" data-sort="${sortValue(eff)}">${formatNumber(eff, " %/day")}</td>
      <td data-sort="${run.status}">${statusMarkup(run.status)}</td>
    </tr>`;
  }).join("");
  updateSortHeader();
}

function sortRuns(col, type) {
  const table = document.getElementById("dryerAnalysisRunTable");
  const body = table?.tBodies?.[0];
  if (!body) return;
  const dir = state.sort.col === col && state.sort.dir === "asc" ? "desc" : "asc";
  const rows = [...body.rows];
  const get = (cell) => {
    const raw = cell.dataset.sort ?? cell.textContent.trim();
    if (raw === "" || raw === "—") return null;
    if (type === "number") return Number(raw);
    if (type === "date") return Date.parse(raw);
    return raw.toLowerCase();
  };
  rows.sort((a, b) => {
    const x = get(a.cells[col]), y = get(b.cells[col]);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x < y) return dir === "asc" ? -1 : 1;
    if (x > y) return dir === "asc" ? 1 : -1;
    return String(b.dataset.start || "").localeCompare(String(a.dataset.start || ""));
  });
  rows.forEach((row) => body.appendChild(row));
  state.sort = { col, dir };
  updateSortHeader();
}

function updateSortHeader() {
  document.querySelectorAll("#dryerAnalysisRunTable thead th").forEach((th, index) => {
    th.classList.remove("analysis-sort-asc", "analysis-sort-desc");
    if (index === state.sort.col) th.classList.add(state.sort.dir === "asc" ? "analysis-sort-asc" : "analysis-sort-desc");
  });
}

function renderScatter() {
  if (!els.scatter || !window.Plotly) return;
  const groups = new Map();
  state.runs.filter((run) => timingUsable(run.status) && Number.isFinite(run.hours) && Number.isFinite(run.lost)).forEach((run) => {
    if (!groups.has(run.table)) groups.set(run.table, []);
    groups.get(run.table).push(run);
  });
  const traces = [...groups.entries()].map(([name, runs]) => ({
    x: runs.map((run) => run.hours), y: runs.map((run) => run.lost), mode: "markers", type: "scatter", name,
    marker: { size: 11 },
    text: runs.map((run) => `<b>${run.table}</b><br>${formatDateRange(run)}<br>Drying time: ${run.hours.toFixed(1)} h<br>Weight lost: ${run.lost.toFixed(1)}%<br>Start load: ${run.startkg.toFixed(1)} kg<br>End load: ${run.endkg.toFixed(1)} kg<br>Bays: ${run.bays}<br>Load / bay: ${run.kgpb.toFixed(1)} kg<br>Timing: ${run.status}`),
    hovertemplate: "%{text}<extra></extra>"
  }));
  window.Plotly.react(els.scatter, traces, {
    xaxis: { title: "Recorded drying time (hours)", fixedrange: true },
    yaxis: { title: "Weight lost (%)", fixedrange: true },
    hovermode: "closest", dragmode: false, margin: { l: 60, r: 20, t: 20, b: 60 }, paper_bgcolor: "transparent", plot_bgcolor: "#fff",
    legend: { orientation: "h", y: -0.22 }
  }, { responsive: true, displaylogo: false, scrollZoom: false, doubleClick: false, displayModeBar: false });
}

function renderWeather() {
  if (!els.weather || !window.Plotly) return;
  const latestRun = state.runs.reduce((latest, run) => Math.max(latest, Date.parse(run.end || run.start) || 0), 0);
  const latestWeather = Date.parse("2026-09-16T23:59:59+03:00");
  const end = new Date(Math.max(latestRun, latestWeather));
  const start = new Date(end.getTime() - state.rangeDays * 86400000);
  const weatherKeys = WEATHER_DATES.filter((date) => {
    const t = Date.parse(`${date}T12:00:00+03:00`);
    return t >= start.getTime() && t <= end.getTime();
  });
  const traces = [
    { x: weatherKeys, y: weatherKeys.map((date) => WEATHER.get(date)?.temp ?? null), type: "scatter", mode: "lines+markers", name: "Temperature", yaxis: "y", line: { width: 2.4 }, hovertemplate: "%{x}<br><b>%{y:.1f} °C</b><extra>Temperature</extra>" },
    { x: weatherKeys, y: weatherKeys.map((date) => WEATHER.get(date)?.rh ?? null), type: "scatter", mode: "lines+markers", name: "Humidity", yaxis: "y2", line: { width: 2.2 }, hovertemplate: "%{x}<br><b>%{y:.0f}% RH</b><extra>Humidity</extra>" },
    { x: RAIN_DATES, y: RAIN_VALUES, type: "bar", name: "Rainfall", yaxis: "y3", opacity: 0.42, hovertemplate: "%{x}<br><b>%{y:.1f} mm</b><extra>Regional rainfall</extra>" }
  ];
  const visibleRuns = state.runs.filter((run) => (Date.parse(run.end || run.start) || 0) >= start.getTime() && (Date.parse(run.start) || 0) <= end.getTime());
  visibleRuns.forEach((run) => traces.push({
    x: [run.start, run.end || end.toISOString()], y: [run.table, run.table], xaxis: "x2", yaxis: "y4", type: "scatter", mode: "lines", line: { width: 12 }, showlegend: false,
    hovertemplate: `<b>${run.table}</b><br>${formatDateRange(run)}<br>${run.bays} bays · ${run.startkg.toFixed(1)} kg loaded<extra></extra>`
  }));
  const tableNames = [...new Set(visibleRuns.map((run) => run.table))];
  window.Plotly.react(els.weather, traces, {
    margin: { l: 145, r: 120, t: 35, b: 35 }, hovermode: "x", dragmode: false, paper_bgcolor: "transparent", plot_bgcolor: "#fff",
    legend: { orientation: "h", x: 0.02, y: 1.02, yanchor: "bottom" },
    xaxis: { domain: [0.04, 0.88], type: "date", range: [start, end], fixedrange: true, showticklabels: false, anchor: "y" },
    yaxis: { domain: [0.58, 0.96], title: "Temperature", ticksuffix: " °C", fixedrange: true, gridcolor: "rgba(70,90,85,.10)" },
    yaxis2: { overlaying: "y", side: "right", position: 0.91, title: "Humidity", ticksuffix: " %", fixedrange: true, range: [45, 100], showgrid: false },
    yaxis3: { overlaying: "y", side: "right", position: 0.98, title: "Rainfall", ticksuffix: " mm", fixedrange: true, rangemode: "tozero", showgrid: false },
    xaxis2: { domain: [0.04, 0.88], type: "date", range: [start, end], fixedrange: true, anchor: "y4" },
    yaxis4: { domain: [0.08, 0.48], type: "category", categoryorder: "array", categoryarray: [...tableNames].reverse(), fixedrange: true, showgrid: false }
  }, { responsive: true, displaylogo: false, scrollZoom: false, doubleClick: false, displayModeBar: false });
}

function applyHeatmaps() {
  const summaryRows = [...document.querySelectorAll("#dryerAnalysisSummaryTable tbody tr")];
  colorCells(summaryRows.map((row) => row.querySelector(".analysis-summary-loss")).filter(Boolean), true);
  colorCells(summaryRows.map((row) => row.querySelector(".analysis-summary-time")).filter(hasNumber), false);
  colorCells(summaryRows.map((row) => row.querySelector(".analysis-summary-eff")).filter(hasNumber), true);
  const rows = [...document.querySelectorAll("#dryerAnalysisRunTable tbody tr")];
  colorCells(rows.map((row) => row.querySelector(".analysis-temp")).filter(hasNumber), true, "temp");
  colorCells(rows.map((row) => row.querySelector(".analysis-rh")).filter(hasNumber), true, "humidity");
  colorCells(rows.map((row) => row.querySelector(".analysis-rain")).filter(hasNumber), true, "rain");
  colorCells(rows.map((row) => row.querySelector(".analysis-loss")).filter(hasNumber), true);
  colorCells(rows.map((row) => row.querySelector(".analysis-time")).filter((cell) => cell?.dataset.usable === "1" && hasNumber(cell)), false);
  colorCells(rows.map((row) => row.querySelector(".analysis-eff")).filter(hasNumber), true);
}

function colorCells(cells, higher = true, palette = "default") {
  const values = cells.map((cell) => firstNumber(cell.textContent)).filter(Number.isFinite);
  if (!values.length) return;
  const lo = Math.min(...values), hi = Math.max(...values);
  const palettes = {
    default: [[255,224,224],[255,243,191],[216,243,220]],
    temp: [[216,243,220],[255,243,191],[255,224,224]],
    humidity: [[232,247,236],[224,240,242],[210,230,255]],
    rain: [[255,255,255],[234,243,252],[210,230,255]]
  };
  const [low, mid, high] = palettes[palette] || palettes.default;
  cells.forEach((cell) => {
    const value = firstNumber(cell.textContent);
    if (!Number.isFinite(value)) return;
    let n = hi === lo ? 0.5 : (value - lo) / (hi - lo);
    if (!higher) n = 1 - n;
    const color = n <= 0.5 ? mix(low, mid, n / 0.5) : mix(mid, high, (n - 0.5) / 0.5);
    cell.style.backgroundColor = `rgb(${color.join(",")})`;
    cell.classList.add("analysis-heat");
  });
}

function timingUsable(status) { return status === "complete" || status === "caution"; }
function efficiency(run) { return Number.isFinite(run.lost) && Number.isFinite(run.hours) && run.hours > 0 ? run.lost * 24 / run.hours : null; }
function values(rows, key) { return rows.map((row) => row[key]).filter(Number.isFinite); }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function sum(rows, key) { return rows.reduce((total, row) => total + (optionalNumber(row[key]) ?? 0), 0); }
function earliest(rows, key) { return rows.map((row) => row[key]).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || ""; }
function latest(rows, key) { return rows.map((row) => row[key]).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || ""; }
function optionalNumber(value) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function sortValue(value) { return Number.isFinite(value) ? String(value) : ""; }
function hasNumber(cell) { return !!cell && Number.isFinite(firstNumber(cell.textContent)); }
function firstNumber(text) { const match = String(text || "").match(/-?\d+(?:\.\d+)?/); return match ? Number(match[0]) : null; }
function mix(a, b, t) { return a.map((value, index) => Math.round(value + (b[index] - value) * t)); }
function formatNumber(value, suffix = "") { return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "—"; }
function formatRange(list, suffix = "") { if (!list.length) return "—"; const lo = Math.min(...list), hi = Math.max(...list); return Math.abs(lo - hi) < 1e-9 ? "—" : `${lo.toFixed(1)}–${hi.toFixed(1)}${suffix}`; }
function formatTimeSummary(hours) { if (!hours.length) return "—"; if (hours.length === 1) return `${hours[0].toFixed(1)} h (${(hours[0] / 24).toFixed(1)} d)`; return `${average(hours).toFixed(1)} h avg (${Math.min(...hours).toFixed(1)}–${Math.max(...hours).toFixed(1)})`; }
function formatDateRange(run) { const start = formatDate(run.start); return run.end ? `${start} – ${formatDate(run.end)}` : `${start} → in progress`; }
function formatDate(value) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: KENYA_TIME_ZONE }); }
function summaryNote(table, group) { const notes = []; if (table === "NEW T4") notes.push("Includes multiple later trial configurations."); if (table.startsWith("EXISTING SHED")) notes.push("Existing shed is normally recorded as one whole-table bay."); if (group.some((run) => run.status === "in_progress")) notes.push("Run in progress."); return notes.join(" ") || "—"; }
function timingChips(group) { const complete = group.filter((run) => run.status === "complete").length, caution = group.filter((run) => run.status === "caution").length, excluded = group.filter((run) => run.status === "excluded").length; return [complete ? `<span class="analysis-chip" title="Timing treated as usable.">🟢 ${complete}</span>` : "", caution ? `<span class="analysis-chip" title="Timing usable with caution; exact dry-end point was not independently observed.">🟠 ${caution}</span>` : "", excluded ? `<span class="analysis-chip" title="Timing excluded from drying-speed analysis.">🔴 ${excluded}</span>` : ""].filter(Boolean).join(" ") || '<span class="analysis-chip">⚪ none</span>'; }
function statusMarkup(status) { const labels = { complete: ["good", "complete"], caution: ["caution", "caution"], excluded: ["bad", "excluded"], in_progress: ["pending", "in progress"] }; const [klass, label] = labels[status] || labels.in_progress; return `<span class="analysis-status ${klass}"><span aria-hidden="true">●</span> ${label}</span>`; }
function kenyaDateKey(value) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KENYA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const out = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${out.year}-${out.month}-${out.day}`; }
function setStatus(message, type = "") { if (!els.status) return; els.status.textContent = message || ""; if (type) els.status.dataset.status = type; else delete els.status.dataset.status; }
async function responseDetail(response) { try { const payload = await response.json(); const detail = payload?.message || payload?.details || payload?.hint || payload?.error || ""; return detail ? ` - ${detail}` : ""; } catch { const detail = await response.text(); return detail ? ` - ${detail}` : ""; } }
