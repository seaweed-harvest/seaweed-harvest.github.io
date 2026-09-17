const ROOT_SELECTOR = ".dryer-weather-v2-root";
let pendingFrame = 0;

function activeDays() {
  const active = document.querySelector("[data-analysis-range].active");
  return Number(active?.dataset?.analysisRange) || 30;
}

function scheduleParity(delay = 0) {
  window.clearTimeout(scheduleParity.timer);
  scheduleParity.timer = window.setTimeout(() => {
    if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = 0;
      applyParity();
    });
  }, delay);
}

function alignedTicks(start, end, stepDays) {
  const ticks = [];
  let cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    ticks.push(cursor.toISOString());
    cursor = new Date(cursor.getTime() + stepDays * 86400000);
  }
  return ticks;
}

function tickText(values) {
  return values.map((value) => {
    const date = new Date(value);
    const weekday = date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Africa/Nairobi" });
    const dayMonth = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Nairobi" });
    return `${weekday}<br><b>${dayMonth}</b>`;
  });
}

function verticalGrid(start, end, days) {
  const minorHours = days === 7 ? 12 : days === 30 ? 24 : 48;
  const majorDays = days === 7 ? 1 : days === 30 ? 3 : 7;
  const shapes = [];

  let minor = new Date(start);
  minor.setUTCMinutes(0, 0, 0);
  while (minor <= end) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: minor.toISOString(),
      x1: minor.toISOString(),
      y0: 0,
      y1: 1,
      line: { color: "rgba(70,90,85,.055)", width: 0.7 },
      layer: "below"
    });
    minor = new Date(minor.getTime() + minorHours * 3600000);
  }

  alignedTicks(start, end, majorDays).forEach((value) => {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: value,
      x1: value,
      y0: 0,
      y1: 1,
      line: { color: "rgba(70,90,85,.14)", width: 1 },
      layer: "below"
    });
  });
  return shapes;
}

function applyParity() {
  if (!window.Plotly) return;
  const root = document.querySelector(ROOT_SELECTOR);
  const upper = root?.querySelector(".dryer-weather-v2-upper");
  const lower = root?.querySelector(".dryer-weather-v2-lower");
  if (!upper?._fullLayout || !lower?._fullLayout) return;

  const range = upper._fullLayout.xaxis?.range;
  if (!Array.isArray(range) || range.length !== 2) return;
  const start = new Date(range[0]);
  const end = new Date(range[1]);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;

  const days = activeDays();
  const majorDays = days === 7 ? 1 : days === 30 ? 3 : 7;
  const ticks = alignedTicks(start, end, majorDays);
  const labels = tickText(ticks);
  const grid = verticalGrid(start, end, days);

  const harvestBands = (upper.layout?.shapes || []).filter((shape) => shape?.type === "rect");
  const baseline = {
    type: "line",
    xref: "paper",
    yref: "paper",
    x0: 0,
    x1: 1,
    y0: 0,
    y1: 0,
    line: { color: "rgba(70,90,85,.30)", width: 1.25 },
    layer: "above"
  };

  void window.Plotly.relayout(upper, {
    "xaxis.showgrid": false,
    "xaxis.showline": false,
    "yaxis.title": { text: "" },
    "yaxis2.title": { text: "" },
    "yaxis3.title": { text: "" },
    "yaxis4.title": { text: "" },
    shapes: [...harvestBands, ...grid, baseline]
  });

  void window.Plotly.relayout(lower, {
    "xaxis.showgrid": false,
    "xaxis.tickmode": "array",
    "xaxis.tickvals": ticks,
    "xaxis.ticktext": labels,
    "xaxis.ticks": "outside",
    "xaxis.ticklen": 7,
    shapes: grid
  });
}

if (/\/dryer_table_records\.html$/.test(window.location.pathname)) {
  const observer = new MutationObserver(() => scheduleParity(40));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-analysis-range], #dryerAnalysisTideToggle, #dryerAnalysisTab, #reloadDryerRecords")) {
      scheduleParity(120);
      window.setTimeout(() => scheduleParity(0), 450);
    }
  }, true);

  window.addEventListener("resize", () => scheduleParity(80));
  scheduleParity(700);
  window.setTimeout(() => scheduleParity(0), 1800);
}
