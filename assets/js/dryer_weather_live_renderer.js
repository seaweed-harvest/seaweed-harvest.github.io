import { currentAccessToken } from "./auth_client.js?v=25";
import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";
import "./dryer_analysis_weather_snapshot.js?v=1";

const IS_DRYER_RECORDS = /\/dryer_table_records\.html$/.test(window.location.pathname);
const RPC_NAME = "list_authenticated_seaweed_drying_ledger";
const KENYA_TIME_ZONE = "Africa/Nairobi";
const D = window.DRYER_WEATHER;
const TIDE = window.DRYER_TIDE;
const COLORS = {
  "Bati (Table 1)": "#4C78A8",
  "Bati (Table 2)": "#F58518",
  "Bati (Table 3)": "#54A24B",
  "Bati (Table 4)": "#E45756",
  "Dryer Shed": "#72B7B2",
  "Dryer Shed - T1": "#B279A2",
  "Dryer Shed - T2": "#FF9DA6",
  "Dryer Shed - T3": "#9D755D",
  "Dryer Shed - T4": "#59A14F",
  "Dryer Shed - T5": "#BAB0AC"
};

const state = { days: 30, tide: false, runs: [], loading: false };
let started = false;

if (IS_DRYER_RECORDS && D && TIDE) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

function start() {
  if (started) return;
  started = true;

  document.addEventListener("click", interceptControls, true);
  void refreshAndRender();
  [350, 900, 1800, 3200].forEach((delay) => window.setTimeout(ensureRendered, delay));
}

function interceptControls(event) {
  const rangeButton = event.target.closest?.("[data-analysis-range]");
  const tideButton = event.target.closest?.("#dryerAnalysisTideToggle");
  const analysisTab = event.target.closest?.("#dryerAnalysisTab");
  const reloadButton = event.target.closest?.("#reloadDryerRecords");

  if (rangeButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.days = Number(rangeButton.dataset.analysisRange) || 30;
    document.querySelectorAll("[data-analysis-range]").forEach((button) => {
      button.classList.toggle("active", button === rangeButton);
    });
    render();
    return;
  }

  if (tideButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.tide = !state.tide;
    syncTideUi();
    render();
    return;
  }

  if (analysisTab || reloadButton) {
    window.setTimeout(() => void refreshAndRender(), 450);
    window.setTimeout(ensureRendered, 1100);
  }
}

async function waitForPlotly() {
  const startedAt = Date.now();
  while (!window.Plotly && Date.now() - startedAt < 12000) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  if (!window.Plotly) throw new Error("Plotly did not become available.");
}

async function refreshAndRender() {
  if (state.loading) return;
  state.loading = true;
  try {
    await waitForElement("dryerAnalysisWeatherChart", 12000);
    await waitForPlotly();
    state.runs = await fetchRuns();
    render();
  } catch (error) {
    console.error("Unable to render Dryer timeline + Weather.", error);
    showRenderError(error);
  } finally {
    state.loading = false;
  }
}

async function fetchRuns() {
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

  if (!response.ok) throw new Error(`Dryer records request failed (${response.status}).`);
  const payload = await response.json();
  return buildRuns(Array.isArray(payload?.bay_rows) ? payload.bay_rows : []);
}

function buildRuns(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(row.submission_id || row.receipt_number || `${row.table_location || "unknown"}:${row.loading_at || row.recorded_at || "unknown"}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  return [...groups.values()].map((group) => {
    const table = normalizeTable(group.find((row) => row.table_location)?.table_location);
    const start = earliest(group, "loading_at") || earliest(group, "recorded_at");
    const complete = group.length > 0 && group.every((row) => row.status === "complete" && row.unloading_at);
    const end = complete ? latest(group, "unloading_at") : "";
    return { table, start, end, records: group.length };
  }).filter((run) => run.start && Number.isFinite(Date.parse(run.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function normalizeTable(value) {
  const text = String(value || "").trim();
  const bati = text.match(/Bati\s*\(Table\s*(\d+)\)/i) || text.match(/Bati.*Table\s*(\d+)/i);
  if (bati) return `Bati (Table ${bati[1]})`;
  const shed = text.match(/Dryer\s*Shed\s*-\s*T(\d+)/i);
  if (shed) return `Dryer Shed - T${shed[1]}`;
  if (/^Dryer\s*Shed$/i.test(text) || /^Shed\s*-\s*General$/i.test(text)) return "Dryer Shed";
  return text || "Unknown table";
}

function selectedWeather() {
  if (state.days === 7) return { w: D.recent, method: "Measured 3-hour data · lightly smoothed 6 hours" };
  if (state.days === 30) return { w: D.oneMonth, method: "Daylight average 07:00–17:59 · 3-day smoothing" };
  return { w: D.threeMonth, method: "Daylight average 07:00–17:59 · 7-day smoothing" };
}

function bounds() {
  const snapshotEnd = Date.parse(D.end) || 0;
  const liveEnd = state.runs.reduce((latestValue, run) => {
    const value = Date.parse(run.end || run.start) || 0;
    return Math.max(latestValue, value);
  }, 0);
  const end = new Date(Math.max(snapshotEnd, liveEnd, Date.now() - 86400000));
  const start = new Date(end.getTime() - state.days * 86400000);
  return [start, end];
}

function render() {
  const chart = document.getElementById("dryerAnalysisWeatherChart");
  if (!chart || !window.Plotly) return;

  syncTideUi();
  const method = document.getElementById("dryerAnalysisWeatherMethod");
  if (method) method.textContent = selectedWeather().method;

  const root = document.createElement("div");
  root.className = "dryer-weather-v2-root";
  root.style.width = "100%";
  root.style.height = "620px";
  root.innerHTML = '<div class="dryer-weather-v2-upper" style="width:100%;height:350px"></div><div class="dryer-weather-v2-lower" style="width:100%;height:260px"></div>';
  chart.replaceChildren(root);

  const upper = root.querySelector(".dryer-weather-v2-upper");
  const lower = root.querySelector(".dryer-weather-v2-lower");
  const [start, end] = bounds();

  const upperPromise = window.Plotly.newPlot(upper, weatherTraces(), weatherLayout(start, end), plotConfig());
  const lowerPromise = window.Plotly.newPlot(lower, runTraces(end), runLayout(start, end), plotConfig());

  Promise.all([Promise.resolve(upperPromise), Promise.resolve(lowerPromise)]).catch((error) => {
    console.error("Dryer timeline + Weather Plotly render failed.", error);
    showRenderError(error);
  });
}

function weatherTraces() {
  const selected = selectedWeather();
  const fmt = state.days === 7 ? "%{x|%a %d %b %H:%M}" : "%{x|%a %d %b %Y}";
  const traces = [
    {
      x: selected.w.x,
      y: selected.w.temp,
      type: "scatter",
      mode: "lines",
      name: "Temperature",
      line: { color: "#e78a55", width: 2.7, shape: "spline", smoothing: 0.28 },
      yaxis: "y",
      hovertemplate: `${fmt}<br><b>%{y:.1f} °C</b><extra>Temperature</extra>`
    },
    {
      x: selected.w.x,
      y: selected.w.hum,
      type: "scatter",
      mode: "lines",
      name: "Humidity",
      line: { color: "#4ca58f", width: 2.5, shape: "spline", smoothing: 0.28 },
      yaxis: "y2",
      hovertemplate: `${fmt}<br><b>%{y:.0f}% RH</b><extra>Humidity</extra>`
    },
    {
      x: D.rain.x,
      y: D.rain.y,
      customdata: D.rain.source,
      type: "bar",
      name: "Rainfall",
      marker: { color: "#7da7d4" },
      opacity: 0.5,
      yaxis: "y3",
      hovertemplate: "%{x|%a %d %b}<br><b>%{y:.1f} mm</b><br>%{customdata}<extra>Regional rainfall</extra>"
    }
  ];

  if (state.tide) {
    traces.push({
      x: TIDE.x,
      y: TIDE.height,
      customdata: TIDE.date.map((date, index) => [date, TIDE.time[index]]),
      type: "scatter",
      mode: "lines",
      name: "Lowest low tide",
      line: { color: "#687ea6", width: 2.2, shape: "spline", smoothing: 0.45 },
      yaxis: "y4",
      hovertemplate: "%{customdata[0]}<br>Low tide: <b>%{y:.2f} m</b> at %{customdata[1]} EAT<extra>Daily lowest low</extra>"
    });
  }
  return traces;
}

function weatherLayout(start, end) {
  return {
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    margin: { l: 105, r: 135, t: 45, b: 12 },
    hovermode: "x",
    dragmode: false,
    bargap: 0.18,
    legend: { orientation: "h", x: 0, y: 1.04, xanchor: "left", yanchor: "bottom" },
    xaxis: {
      type: "date",
      range: [start, end],
      showticklabels: false,
      showgrid: true,
      gridcolor: "rgba(70,90,85,.08)",
      zeroline: false,
      fixedrange: true
    },
    yaxis: {
      title: { text: "Temperature" },
      side: "left",
      fixedrange: true,
      showgrid: true,
      gridcolor: "rgba(70,90,85,.10)",
      zeroline: false,
      ticksuffix: " °C",
      tickformat: ".0f",
      dtick: 1
    },
    yaxis2: {
      overlaying: "y",
      side: "right",
      title: { text: "Humidity" },
      fixedrange: true,
      range: [45, 100],
      showgrid: false,
      zeroline: false,
      ticksuffix: " %",
      tickformat: ".0f",
      dtick: 10
    },
    yaxis3: {
      overlaying: "y",
      anchor: "free",
      position: 0.96,
      side: "right",
      title: { text: "Rainfall" },
      fixedrange: true,
      rangemode: "tozero",
      showgrid: false,
      zeroline: false,
      ticksuffix: " mm",
      tickformat: ".0f"
    },
    yaxis4: {
      overlaying: "y",
      anchor: "free",
      position: 0.02,
      side: "left",
      title: { text: "Low tide", font: { color: "#687ea6" } },
      fixedrange: true,
      range: [0, 1.6],
      visible: state.tide,
      showgrid: false,
      zeroline: false,
      ticksuffix: " m",
      tickformat: ".1f",
      tickfont: { color: "#687ea6" }
    },
    shapes: harvestShapes(start, end),
    annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1.06, text: "<b>Weather</b>", showarrow: false, xanchor: "left", font: { size: 13, color: "#526a63" } }]
  };
}

function harvestShapes(start, end) {
  if (!state.tide) return [];
  const shapes = [];
  TIDE.date.forEach((date, index) => {
    if (Number(TIDE.height[index]) >= Number(TIDE.threshold)) return;
    const from = new Date(`${date}T00:00:00+03:00`);
    const to = new Date(from.getTime() + 86400000);
    if (to < start || from > end) return;
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: from.toISOString(),
      x1: to.toISOString(),
      y0: 0,
      y1: 1,
      fillcolor: "rgba(86,170,102,.11)",
      line: { width: 0 },
      layer: "below"
    });
  });
  return shapes;
}

function runTraces(rangeEnd) {
  return state.runs.map((run) => ({
    x: [run.start, run.end || rangeEnd.toISOString()],
    y: [run.table, run.table],
    type: "scatter",
    mode: "lines",
    line: { color: COLORS[run.table] || "#7c8f89", width: 13 },
    showlegend: false,
    hovertemplate: `<b>${escapeHtml(run.table)}</b><br>${formatDate(run.start)} → ${run.end ? formatDate(run.end) : "in progress"}<br>Underlying drying records: ${run.records}<extra></extra>`
  }));
}

function runLayout(start, end) {
  const preferred = Array.isArray(D.tableOrder) ? D.tableOrder : [];
  const discovered = state.runs.map((run) => run.table);
  const tables = [...new Set([...preferred, ...discovered])].filter((table) => state.runs.some((run) => run.table === table));

  return {
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    margin: { l: 105, r: 135, t: 45, b: 16 },
    hovermode: "closest",
    dragmode: false,
    xaxis: {
      type: "date",
      range: [start, end],
      side: "top",
      fixedrange: true,
      showgrid: true,
      gridcolor: "rgba(70,90,85,.09)",
      zeroline: false,
      tickformat: state.days === 7 ? "%a<br><b>%d %b</b>" : "%a<br><b>%d %b</b>",
      dtick: state.days === 7 ? 86400000 : state.days === 30 ? 3 * 86400000 : 7 * 86400000
    },
    yaxis: {
      type: "category",
      fixedrange: true,
      categoryorder: "array",
      categoryarray: [...tables].reverse(),
      showgrid: false,
      zeroline: false,
      tickfont: { size: 11 }
    }
  };
}

function plotConfig() {
  return { responsive: true, displaylogo: false, scrollZoom: false, doubleClick: false, displayModeBar: false };
}

function syncTideUi() {
  const tideButton = document.getElementById("dryerAnalysisTideToggle");
  const tidePill = document.getElementById("dryerAnalysisTidePill");
  if (tideButton) tideButton.classList.toggle("active", state.tide);
  if (tidePill) tidePill.hidden = !state.tide;
}

function ensureRendered() {
  const chart = document.getElementById("dryerAnalysisWeatherChart");
  if (!chart || chart.querySelector(".dryer-weather-v2-root")) return;
  if (window.Plotly && state.runs.length) render();
}

function showRenderError(error) {
  const chart = document.getElementById("dryerAnalysisWeatherChart");
  if (!chart) return;
  chart.innerHTML = `<div style="padding:18px;color:#8a3f3f;font-size:.8rem">Timeline + Weather could not render. ${escapeHtml(error?.message || "Unknown chart error")}</div>`;
}

function waitForElement(id, timeoutMs) {
  const existing = document.getElementById(id);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = document.getElementById(id);
      if (!element) return;
      observer.disconnect();
      resolve(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`${id} was not created.`));
    }, timeoutMs);
  });
}

function earliest(rows, key) {
  return rows.map((row) => row[key]).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";
}

function latest(rows, key) {
  return rows.map((row) => row[key]).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: KENYA_TIME_ZONE });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
