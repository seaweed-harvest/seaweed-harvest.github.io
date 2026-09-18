import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";

const KENYA_TIME_ZONE = "Africa/Nairobi";
const SENSOR_STATIONS = {
  "NEW T1": "ST-0102",
  "NEW T2": "ST-0004",
  "NEW T3": "ST-0002"
};
const METRICS = {
  temperature: {
    label: "Temperature",
    unit: "°C",
    field: "temp",
    extremeLabel: "Peak daytime",
    extremeMode: "max"
  },
  humidity: {
    label: "Humidity",
    unit: "% RH",
    field: "humidity",
    extremeLabel: "Minimum daytime",
    extremeMode: "min"
  }
};

const state = {
  runs: [],
  selectedKey: "",
  metric: "temperature",
  rows: [],
  requestId: 0
};

const els = {};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    window.setTimeout(init, 0);
  }, { once: true });
} else {
  window.setTimeout(init, 0);
}

function init() {
  addStyle();
  if (!installCard()) {
    window.setTimeout(init, 150);
    return;
  }
  cache();
  bind();
  receiveRuns(Array.isArray(window.DRYER_ANALYSIS_RUNS) ? window.DRYER_ANALYSIS_RUNS : []);
  window.addEventListener("dryer-analysis-runs-updated", function (event) {
    receiveRuns(Array.isArray(event.detail && event.detail.runs) ? event.detail.runs : []);
  });
}

function addStyle() {
  if (document.querySelector("link[data-dryer-sensor-preview-style]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./assets/css/dryer_sensor_comparison_preview.css?v=1";
  link.setAttribute("data-dryer-sensor-preview-style", "true");
  document.head.appendChild(link);
}

function installCard() {
  if (document.getElementById("dryerAnalysisSensorCard")) return true;
  const panel = document.getElementById("dryerAnalysisPanel");
  if (!panel) return false;
  const cards = Array.from(panel.querySelectorAll(".dryer-analysis-card"));
  const scatterCard = cards.find(function (card) {
    const summary = card.querySelector("summary");
    return summary && summary.textContent.trim().indexOf("Performance scatter plot") >= 0;
  });
  if (!scatterCard) return false;

  const card = document.createElement("details");
  card.id = "dryerAnalysisSensorCard";
  card.open = true;
  card.className = "dryer-analysis-card";
  card.innerHTML =
    '<summary>3. Table sensor comparison</summary>' +
    '<div class="dryer-analysis-card-body">' +
      '<div class="dryer-sensor-toolbar">' +
        '<div class="dryer-sensor-run-select">' +
          '<label for="dryerAnalysisSensorRun">Drying event</label>' +
          '<select id="dryerAnalysisSensorRun" aria-label="Select drying event"></select>' +
        '</div>' +
        '<div class="dryer-sensor-metric-controls" role="group" aria-label="Sensor metric">' +
          '<button type="button" data-dryer-sensor-metric="temperature" class="active">Temperature</button>' +
          '<button type="button" data-dryer-sensor-metric="humidity">Humidity</button>' +
        '</div>' +
      '</div>' +
      '<p id="dryerAnalysisSensorStatus" class="admin-status" aria-live="polite"></p>' +
      '<div class="dryer-analysis-chart-wrap"><div id="dryerAnalysisSensorChart"></div></div>' +
      '<div id="dryerAnalysisSensorSummary" class="dryer-sensor-summary" hidden></div>' +
      '<div class="responsive-table-wrap">' +
        '<table id="dryerAnalysisSensorTable" class="management-table admin-data-table dryer-analysis-table dryer-sensor-table">' +
          '<thead><tr>' +
            '<th>Source</th>' +
            '<th id="dryerAnalysisSensorAvgHead">Avg daytime temp</th>' +
            '<th id="dryerAnalysisSensorExtremeHead">Peak daytime</th>' +
            '<th>Δ avg vs weather</th>' +
            '<th id="dryerAnalysisSensorDeltaExtremeHead">Δ peak vs weather</th>' +
          '</tr></thead>' +
          '<tbody></tbody>' +
        '</table>' +
      '</div>' +
      '<p id="dryerAnalysisSensorNote" class="dryer-analysis-note">Table sensors are read live from Seaweed Station history for the selected drying event. Daytime = 07:00–17:59 EAT.</p>' +
    '</div>';

  panel.insertBefore(card, scatterCard);
  renumberFollowingCards(panel);
  return true;
}

function renumberFollowingCards(panel) {
  const cards = Array.from(panel.querySelectorAll(".dryer-analysis-card"));
  cards.forEach(function (card, index) {
    const summary = card.querySelector("summary");
    if (!summary) return;
    const label = summary.textContent.replace(/^\d+\.\s*/, "");
    summary.textContent = String(index + 1) + ". " + label;
  });
}

function cache() {
  els.run = document.getElementById("dryerAnalysisSensorRun");
  els.status = document.getElementById("dryerAnalysisSensorStatus");
  els.chart = document.getElementById("dryerAnalysisSensorChart");
  els.summary = document.getElementById("dryerAnalysisSensorSummary");
  els.tableBody = document.querySelector("#dryerAnalysisSensorTable tbody");
  els.avgHead = document.getElementById("dryerAnalysisSensorAvgHead");
  els.extremeHead = document.getElementById("dryerAnalysisSensorExtremeHead");
  els.deltaExtremeHead = document.getElementById("dryerAnalysisSensorDeltaExtremeHead");
  els.note = document.getElementById("dryerAnalysisSensorNote");
}

function bind() {
  if (els.run) {
    els.run.addEventListener("change", function () {
      state.selectedKey = els.run.value;
      void loadSelectedRun();
    });
  }
  document.querySelectorAll("[data-dryer-sensor-metric]").forEach(function (button) {
    button.addEventListener("click", function () {
      state.metric = button.dataset.dryerSensorMetric === "humidity" ? "humidity" : "temperature";
      document.querySelectorAll("[data-dryer-sensor-metric]").forEach(function (item) {
        item.classList.toggle("active", item === button);
      });
      renderComparison();
    });
  });
}

function receiveRuns(runs) {
  state.runs = runs.filter(function (run) {
    return Boolean(SENSOR_STATIONS[run.table] && run.end);
  }).sort(function (a, b) {
    return Date.parse(b.start) - Date.parse(a.start);
  });

  const keys = new Set(state.runs.map(runKey));
  if (!state.selectedKey || !keys.has(state.selectedKey)) {
    state.selectedKey = state.runs[0] ? runKey(state.runs[0]) : "";
  }
  renderSelector();
  if (state.selectedKey) void loadSelectedRun();
}

function renderSelector() {
  if (!els.run) return;
  if (!state.runs.length) {
    els.run.innerHTML = '<option value="">No supported completed runs</option>';
    els.run.disabled = true;
    setStatus("No completed Table 1–3 drying events are available for sensor comparison.", "error");
    clearComparison();
    return;
  }
  els.run.disabled = false;
  els.run.innerHTML = state.runs.map(function (run) {
    const selected = runKey(run) === state.selectedKey ? " selected" : "";
    return '<option value="' + escapeAttr(runKey(run)) + '"' + selected + '>' + escapeHtml(runLabel(run)) + '</option>';
  }).join("");
}

function selectedRun() {
  return state.runs.find(function (run) {
    return runKey(run) === state.selectedKey;
  }) || null;
}

function runKey(run) {
  return String(run.table) + "|" + String(run.start) + "|" + String(run.end);
}

function runLabel(run) {
  return String(run.table).replace(/^NEW /, "") + " · " + formatDate(run.start) + " – " + formatDate(run.end);
}

async function loadSelectedRun() {
  const run = selectedRun();
  if (!run) return;
  const stationUid = SENSOR_STATIONS[run.table];
  const requestId = ++state.requestId;
  setStatus("Loading " + String(run.table).replace(/^NEW /, "") + " sensor history…");

  try {
    const url = new URL(DRYING_FORM_CONFIG.supabaseUrl + "/rest/v1/sensor_readings");
    url.searchParams.set("select", "sample_epoch,temp_1,humidity_1,temp_2,humidity_2,temp_3,humidity_3");
    url.searchParams.set("station_uid", "eq." + stationUid);
    url.searchParams.set("sample_role", "eq.hub");
    url.searchParams.set("sample_epoch", "gte." + run.start);
    url.searchParams.append("sample_epoch", "lte." + run.end);
    url.searchParams.set("order", "sample_epoch.asc");
    url.searchParams.set("limit", "5000");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: DRYING_FORM_CONFIG.supabaseAnonKey,
        Authorization: "Bearer " + DRYING_FORM_CONFIG.supabaseAnonKey
      }
    });
    if (!response.ok) {
      throw new Error(String(response.status) + " " + response.statusText);
    }
    const rows = await response.json();
    if (requestId !== state.requestId) return;
    state.rows = Array.isArray(rows) ? rows : [];
    renderComparison();

    if (state.rows.length) {
      setStatus(
        String(state.rows.length) + " logger samples · " + stationUid + " · " +
        formatDateTime(state.rows[0].sample_epoch) + " to " +
        formatDateTime(state.rows[state.rows.length - 1].sample_epoch)
      );
    } else {
      const extra = run.table === "NEW T1"
        ? " Table 1 is currently not reporting recent logger data."
        : "";
      setStatus("No table sensor readings were found for this drying event." + extra, "error");
    }
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.rows = [];
    clearComparison();
    setStatus("Unable to load table sensors: " + (error && error.message ? error.message : String(error)), "error");
  }
}

function clearComparison() {
  if (els.chart && window.Plotly) window.Plotly.purge(els.chart);
  if (els.tableBody) els.tableBody.innerHTML = "";
  if (els.summary) {
    els.summary.hidden = true;
    els.summary.textContent = "";
  }
}

function renderComparison() {
  const run = selectedRun();
  if (!run || !els.chart || !window.Plotly) return;
  if (!state.rows.length) {
    clearComparison();
    return;
  }

  const metric = METRICS[state.metric];
  const x = state.rows.map(function (row) {
    return eatWallClock(row.sample_epoch);
  });
  const sensorSeries = [1, 2, 3].map(function (sensor) {
    return state.rows.map(function (row) {
      return metricValue(row, sensor, state.metric);
    });
  });
  const tableMean = state.rows.map(function (row) {
    return averageAvailable([
      metricValue(row, 1, state.metric),
      metricValue(row, 2, state.metric),
      metricValue(row, 3, state.metric)
    ]);
  });
  const weather = weatherReference(run, state.metric);

  const traces = [
    sensorTrace(x, sensorSeries[0], "Sensor 1", "#4C78A8", metric),
    sensorTrace(x, sensorSeries[1], "Sensor 2", "#F58518", metric),
    sensorTrace(x, sensorSeries[2], "Sensor 3", "#54A24B", metric),
    sensorTrace(x, tableMean, "Table mean", "#263b36", metric, 3)
  ];

  if (weather.x.length) {
    traces.push({
      x: weather.x,
      y: weather.y,
      type: "scatter",
      mode: "lines",
      name: "Weather",
      line: { color: "#8b6f61", width: 2.4, dash: "dot", shape: "spline", smoothing: 0.25 },
      hovertemplate: "%{x|%a %d %b %H:%M}<br><b>%{y:.1f} " + metric.unit + "</b><extra>Weather</extra>"
    });
  }

  const allValues = sensorSeries[0].concat(sensorSeries[1], sensorSeries[2], tableMean, weather.y).filter(Number.isFinite);
  const minValue = allValues.length ? Math.min.apply(null, allValues) : 0;
  const maxValue = allValues.length ? Math.max.apply(null, allValues) : 1;
  const pad = Math.max(1, (maxValue - minValue) * 0.08);

  window.Plotly.react(els.chart, traces, {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#fff",
    margin: { l: 64, r: 24, t: 18, b: 56 },
    hovermode: "x unified",
    dragmode: false,
    legend: { orientation: "h", x: 0, y: 1.08, xanchor: "left", yanchor: "bottom" },
    xaxis: {
      title: { text: "East Africa Time" },
      fixedrange: true,
      showgrid: true,
      gridcolor: "rgba(70,90,85,.08)",
      zeroline: false
    },
    yaxis: {
      title: { text: metric.label + " (" + metric.unit + ")" },
      fixedrange: true,
      range: [minValue - pad, maxValue + pad],
      showgrid: true,
      gridcolor: "rgba(70,90,85,.10)",
      zeroline: false
    }
  }, {
    responsive: true,
    displaylogo: false,
    scrollZoom: false,
    doubleClick: false,
    displayModeBar: false
  });

  renderTable(run, metric, sensorSeries, tableMean, weather);
}

function sensorTrace(x, y, name, color, metric, width) {
  return {
    x: x,
    y: y,
    type: "scatter",
    mode: "lines",
    name: name,
    line: { color: color, width: width || 1.8 },
    hovertemplate: "%{x|%a %d %b %H:%M}<br><b>%{y:.1f} " + metric.unit + "</b><extra>" + name + "</extra>"
  };
}

function renderTable(run, metric, sensorSeries, tableMean, weather) {
  if (!els.tableBody) return;

  const dayMask = state.rows.map(function (row) {
    return isDaytime(row.sample_epoch);
  });
  const sources = [
    { name: "Sensor 1", values: sensorSeries[0] },
    { name: "Sensor 2", values: sensorSeries[1] },
    { name: "Sensor 3", values: sensorSeries[2] },
    { name: "Table mean", values: tableMean, strong: true }
  ];

  const weatherDayValues = weather.raw.filter(function (point) {
    return isDaytime(point.epoch);
  }).map(function (point) {
    return point.value;
  }).filter(Number.isFinite);
  const weatherStats = metricStats(weatherDayValues, metric.extremeMode);

  const sourceStats = sources.map(function (source) {
    const values = source.values.filter(function (value, index) {
      return dayMask[index] && Number.isFinite(value);
    });
    const stats = metricStats(values, metric.extremeMode);
    return {
      name: source.name,
      strong: source.strong,
      avg: stats.avg,
      extreme: stats.extreme,
      deltaAvg: Number.isFinite(stats.avg) && Number.isFinite(weatherStats.avg) ? stats.avg - weatherStats.avg : null,
      deltaExtreme: Number.isFinite(stats.extreme) && Number.isFinite(weatherStats.extreme) ? stats.extreme - weatherStats.extreme : null
    };
  });

  if (els.avgHead) els.avgHead.textContent = state.metric === "humidity" ? "Avg daytime RH" : "Avg daytime temp";
  if (els.extremeHead) els.extremeHead.textContent = metric.extremeLabel;
  if (els.deltaExtremeHead) {
    els.deltaExtremeHead.textContent = state.metric === "humidity" ? "Δ minimum vs weather" : "Δ peak vs weather";
  }

  els.tableBody.innerHTML = sourceStats.map(function (row) {
    return '<tr' + (row.strong ? ' class="dryer-sensor-mean-row"' : "") + '>' +
      '<td>' + (row.strong ? "<strong>Table mean</strong>" : escapeHtml(row.name)) + '</td>' +
      '<td>' + metricFormat(row.avg, metric) + '</td>' +
      '<td>' + metricFormat(row.extreme, metric) + '</td>' +
      '<td>' + signedFormat(row.deltaAvg, metric) + '</td>' +
      '<td>' + signedFormat(row.deltaExtreme, metric) + '</td>' +
    '</tr>';
  }).join("") +
  '<tr class="dryer-sensor-weather-row">' +
    '<td><strong>Weather</strong></td>' +
    '<td>' + metricFormat(weatherStats.avg, metric) + '</td>' +
    '<td>' + metricFormat(weatherStats.extreme, metric) + '</td>' +
    '<td>—</td><td>—</td>' +
  '</tr>';

  renderVariationSummary(sourceStats, weatherStats, metric);

  if (els.note) {
    let coverage = " No matching 3-hour weather observations are available for this event.";
    if (weather.raw.length) {
      coverage =
        " Weather overlap: " + formatDateTime(weather.raw[0].epoch) + " to " +
        formatDateTime(weather.raw[weather.raw.length - 1].epoch) + " (" +
        String(weather.raw.length) + " points).";
    }
    els.note.textContent =
      "Table sensors are live for " + runLabel(run) +
      ". Daytime = 07:00–17:59 EAT." + coverage;
  }
}

function renderVariationSummary(rows, weatherStats, metric) {
  if (!els.summary) return;
  const sensors = rows.slice(0, 3).filter(function (row) {
    return Number.isFinite(row.avg);
  });
  if (!sensors.length) {
    els.summary.hidden = true;
    return;
  }
  const means = sensors.map(function (row) { return row.avg; });
  const spread = Math.max.apply(null, means) - Math.min.apply(null, means);
  const sorted = sensors.slice().sort(function (a, b) {
    return metric.extremeMode === "max" ? b.extreme - a.extreme : a.extreme - b.extreme;
  });
  const standout = sorted[0];
  const delta = standout && Number.isFinite(standout.extreme) && Number.isFinite(weatherStats.extreme)
    ? standout.extreme - weatherStats.extreme
    : null;

  const spreadLabel = state.metric === "humidity"
    ? "average daytime RH spread"
    : "average daytime temperature spread";
  const extremeLabel = state.metric === "humidity"
    ? "lowest daytime RH"
    : "highest daytime peak";

  els.summary.innerHTML =
    "<strong>Variation:</strong> " + spreadLabel + " " + metricFormat(spread, metric) +
    (standout
      ? " · " + escapeHtml(standout.name) + " has the " + extremeLabel +
        (Number.isFinite(delta) ? " (" + signedFormat(delta, metric) + " vs weather)" : "")
      : "");
  els.summary.hidden = false;
}

function weatherReference(run, metricName) {
  const source = window.DRYER_WEATHER && window.DRYER_WEATHER.recent;
  if (!source || !Array.isArray(source.x)) return { x: [], y: [], raw: [] };
  const values = metricName === "humidity" ? source.hum : source.temp;
  const start = Date.parse(run.start);
  const end = Date.parse(run.end);
  const raw = source.x.map(function (wall, index) {
    const epochDate = new Date(String(wall) + "+03:00");
    return {
      wall: String(wall),
      epoch: epochDate.toISOString(),
      value: optionalNumber(values && values[index])
    };
  }).filter(function (point) {
    const epoch = Date.parse(point.epoch);
    return epoch >= start && epoch <= end && Number.isFinite(point.value);
  });
  return {
    x: raw.map(function (point) { return point.wall; }),
    y: raw.map(function (point) { return point.value; }),
    raw: raw
  };
}

function metricValue(row, sensor, metricName) {
  const prefix = metricName === "humidity" ? "humidity" : "temp";
  return optionalNumber(row && row[prefix + "_" + String(sensor)]);
}

function averageAvailable(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return finite.reduce(function (sum, value) { return sum + value; }, 0) / finite.length;
}

function metricStats(values, mode) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { avg: null, extreme: null };
  return {
    avg: finite.reduce(function (sum, value) { return sum + value; }, 0) / finite.length,
    extreme: mode === "min" ? Math.min.apply(null, finite) : Math.max.apply(null, finite)
  };
}

function metricFormat(value, metric) {
  return Number.isFinite(value) ? value.toFixed(1) + " " + metric.unit : "—";
}

function signedFormat(value, metric) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return sign + Math.abs(value).toFixed(1) + " " + metric.unit;
}

function isDaytime(value) {
  const wall = eatWallClock(value);
  const hour = Number(wall.slice(11, 13));
  return Number.isFinite(hour) && hour >= 7 && hour <= 17;
}

function eatWallClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: KENYA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map(function (part) {
    return [part.type, part.value];
  }));
  return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute + ":" + parts.second;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    timeZone: KENYA_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: KENYA_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }) + " EAT";
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function setStatus(message, type) {
  if (!els.status) return;
  els.status.textContent = message || "";
  if (type) els.status.dataset.status = type;
  else delete els.status.dataset.status;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
