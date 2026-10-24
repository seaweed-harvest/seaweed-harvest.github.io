import { authClient, hasOrganisationCapability, requireAggregatorAccess } from "./auth_client.js?v=25";
import { selectRows } from "./supabase_client.js";

const STOCK_PAGE_SIZE = 50;
const ACTION_PAGE_SIZE = 100;
const MAX_LEDGER_ROWS = 12000;
const SVG_NS = "http://www.w3.org/2000/svg";
const els = {};
const state = { stockRows: null, stockActions: null, harvesting: 0, stocking: 0 };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "analysisFrom", "analysisTo", "analysisApply", "analysisRefresh", "analysisStatus",
    "harvestCommunity", "harvestGrouping", "harvestPlot", "harvestEmpty",
    "harvestTotal", "harvestStatus", "harvestRows",
    "stockPlot", "stockEmpty", "stockTotal", "stockStatus", "stockRows"
  ].forEach(id => { els[id] = document.getElementById(id); });
  if (!els.harvestPlot) return;

  try {
    const access = await requireAggregatorAccess("MAWIMBI", "can_view_data", "mawimbi_analysis.html");
    if (!access) return;
    if (!hasOrganisationCapability(access.profile, "form_intake_collection")
        || !hasOrganisationCapability(access.profile, "form_stock_record")) {
      window.location.replace("./access_pending.html");
      return;
    }
    const communities = await selectRows(
      "ag_secure_communities",
      "select=community_id,community_name&order=community_name.asc"
    );
    for (const item of communities) {
      if (item.community_id) {
        els.harvestCommunity.add(new Option(
          String(item.community_name || item.community_id),
          String(item.community_id)
        ));
      }
    }

    els.analysisApply.addEventListener("click", () => void refreshViews(false));
    els.analysisRefresh.addEventListener("click", () => void refreshViews(true));
    els.harvestCommunity.addEventListener("change", () => { void loadHarvest().catch(() => {}); });
    els.harvestGrouping.addEventListener("change", () => { void loadHarvest().catch(() => {}); });
    await refreshViews(true);
  } catch (error) {
    showMessage(els.analysisStatus, readableError(error), true);
    showMessage(els.harvestStatus, readableError(error), true);
    showMessage(els.stockStatus, readableError(error), true);
  }
}

function kenyaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = type => parts.find(value => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function selectedRange() {
  const end = els.analysisTo.value || kenyaDate();
  const today = kenyaDate();
  const start = els.analysisFrom.value || `${Number(today.slice(0, 4)) - 9}-01-01`;
  if (end < start) throw new Error("The end date must be on or after the start date.");
  // The existing tenant-scoped operational summary has a ten-year maximum.
  if (dayNumber(end) - dayNumber(start) > 3660) {
    throw new Error("Select a date range of ten years or less.");
  }
  return { start, end };
}

async function refreshViews(refreshStock) {
  let range;
  try { range = selectedRange(); }
  catch (error) { showMessage(els.analysisStatus, error.message, true); return; }
  showMessage(els.analysisStatus, "Loading current records...");
  const tasks = [loadHarvest(range), loadStock(range, refreshStock)];
  const results = await Promise.allSettled(tasks);
  if (results.every(result => result.status === "fulfilled")) {
    showMessage(els.analysisStatus, "Showing current record data.");
  } else {
    const firstError = results.find(result => result.status === "rejected");
    showMessage(els.analysisStatus, readableError(firstError?.reason), true);
  }
}

async function loadHarvest(range = null) {
  const requestId = ++state.harvesting;
  showMessage(els.harvestStatus, "Loading collection totals...");
  els.harvestPlot.replaceChildren();
  els.harvestEmpty.hidden = true;
  try {
    const dates = range || selectedRange();
    const grouping = els.harvestGrouping.value;
    const { data, error } = await authClient.rpc("ag_sec_operational_summary", {
      p_start_date: dates.start,
      p_end_date: dates.end,
      p_grouping: grouping,
      p_community_id: els.harvestCommunity.value || null
    });
    if (error) throw error;
    if (requestId !== state.harvesting) return;
    const result = unwrap(data);
    const raw = (Array.isArray(result?.rows) ? result.rows : [])
      .filter(row => isISODate(row.period_start))
      .map(row => ({
        date: row.period_start,
        kg: finiteNumber(row.intake_weight_kg),
        count: finiteNumber(row.collection_count)
      }))
      .filter(row => row.kg > 0 || row.count > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const totalKg = finiteNumber(result?.totals?.intake_weight_kg);
    els.harvestTotal.textContent = `${formatNumber(totalKg)} kg`;
    if (!raw.length) {
      els.harvestEmpty.hidden = false;
      els.harvestRows.replaceChildren();
      showMessage(els.harvestStatus, "No collection entries in this period.");
      return;
    }
    const points = fillMissingPeriods(raw, grouping, els.analysisFrom.value ? dates.start : raw[0].date,
      els.analysisTo.value ? dates.end : raw[raw.length - 1].date);
    drawHarvest(points);
    renderHarvestTable(points);
    showMessage(els.harvestStatus,
      `${formatNumber(raw.reduce((sum, row) => sum + row.count, 0))} collection entries · ${grouping === "day" ? "Daily" : grouping === "week" ? "Weekly" : "Monthly"} totals`);
  } catch (error) {
    if (requestId !== state.harvesting) return;
    els.harvestTotal.textContent = "— kg";
    showMessage(els.harvestStatus, readableError(error), true);
    throw error;
  }
}

function fillMissingPeriods(raw, grouping, from, to) {
  const byDate = new Map(raw.map(row => [row.date, row]));
  let cursor = periodStart(from, grouping);
  const end = periodStart(to, grouping);
  const points = [];
  while (cursor <= end && points.length < 3700) {
    points.push(byDate.get(cursor) || { date: cursor, kg: 0, count: 0 });
    cursor = nextPeriod(cursor, grouping);
  }
  return points;
}

function periodStart(date, grouping) {
  const stamp = dayNumber(date);
  const dt = new Date(stamp * 86400000);
  if (grouping === "month") return `${date.slice(0, 7)}-01`;
  if (grouping === "week") {
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  }
  return dt.toISOString().slice(0, 10);
}

function nextPeriod(date, grouping) {
  const dt = new Date(dayNumber(date) * 86400000);
  if (grouping === "month") dt.setUTCMonth(dt.getUTCMonth() + 1);
  else dt.setUTCDate(dt.getUTCDate() + (grouping === "week" ? 7 : 1));
  return dt.toISOString().slice(0, 10);
}

async function fetchEveryPage(functionName, parameters, pageSize) {
  async function fetchPage(offset) {
    const { data, error } = await authClient.rpc(functionName, {
      ...parameters, p_page_limit: pageSize, p_page_offset: offset
    });
    if (error) throw error;
    return unwrap(data);
  }
  const first = await fetchPage(0);
  const total = Number(first?.total_count ?? 0);
  if (!Number.isInteger(total) || total < 0 || total > MAX_LEDGER_ROWS) {
    throw new Error("There are too many stock records for this chart; an aggregated reporting endpoint is needed.");
  }
  const pages = Math.ceil(total / pageSize);
  const output = [...(Array.isArray(first?.rows) ? first.rows : [])];
  for (let page = 1; page < pages; page += 4) {
    const offsets = Array.from({ length: Math.min(4, pages - page) },
      (_, n) => (page + n) * pageSize);
    const responses = await Promise.all(offsets.map(fetchPage));
    for (const response of responses) {
      output.push(...(Array.isArray(response?.rows) ? response.rows : []));
    }
  }
  if (output.length !== total) {
    throw new Error("The stock ledger changed while loading. Refresh to avoid an incomplete balance.");
  }
  return output;
}

async function loadStock(range = null, refresh = false) {
  const requestId = ++state.stocking;
  showMessage(els.stockStatus, "Loading numbered stock and QC history...");
  els.stockPlot.replaceChildren();
  els.stockEmpty.hidden = true;
  try {
    const dates = range || selectedRange();
    if (refresh || !state.stockRows || !state.stockActions) {
      // Do not rely on a month-limited summary: the opening balance needs all earlier records.
      const [stockRows, stockActions] = await Promise.all([
        fetchEveryPage("ag_form_record_ledger", {
          p_record_type: "stock", p_start_date: "0001-01-01",
          p_end_date: "9999-12-31", p_community_id: null, p_search: null
        }, STOCK_PAGE_SIZE),
        fetchEveryPage("ag_stabilization_stock_action_ledger", {
          p_start_date: "0001-01-01", p_end_date: "9999-12-31", p_search: null
        }, ACTION_PAGE_SIZE)
      ]);
      if (requestId !== state.stocking) return;
      state.stockRows = stockRows;
      state.stockActions = stockActions;
    }
    if (requestId !== state.stocking) return;
    // Blank "From" means begin at the first stock event, not nine years of empty space.
    const earliest = [
      ...state.stockRows.map(row => row.record_date),
      ...state.stockActions.map(row => row.action_date)
    ].filter(isISODate).sort()[0];
    const plotRange = {
      ...dates,
      start: !els.analysisFrom.value && earliest && earliest <= dates.end
        ? (earliest > dates.start ? earliest : dates.start)
        : dates.start
    };
    const timeline = buildStockTimeline(state.stockRows, state.stockActions, plotRange);
    els.stockTotal.textContent = `${formatNumber(timeline.lastBalance)} L`;
    if (!timeline.hasInitial && !timeline.hasActions) {
      els.stockEmpty.hidden = false;
      els.stockRows.replaceChildren();
      showMessage(els.stockStatus, "No numbered BioStim stock records in the ledger.");
      return;
    }
    drawStock(timeline.points, plotRange);
    renderStockTable(timeline.points);
    showMessage(els.stockStatus,
      `${formatNumber(timeline.initialCount)} new container records · ${formatNumber(timeline.qcCount)} QC batch/retest records · ${formatNumber(timeline.actionCount)} stock actions`);
  } catch (error) {
    if (requestId !== state.stocking) return;
    els.stockTotal.textContent = "— L";
    showMessage(els.stockStatus, readableError(error), true);
    throw error;
  }
}

function buildStockTimeline(records, actions, range) {
  const daily = new Map();
  const entry = date => {
    if (!daily.has(date)) daily.set(date, { date, delta: 0, qc: 0 });
    return daily.get(date);
  };
  let initialCount = 0, actionCount = 0, qcCount = 0;
  for (const record of records) {
    const date = record.record_date;
    if (!isISODate(date) || date > range.end) continue;
    const isInitial = !record.record_type || record.record_type === "initial";
    const hasQc = record.salinity_value != null
      || record.ph_value != null || record.electrical_conductivity_ms_cm != null;
    const isQcBatchOrRetest = hasQc
      && (record.batch_submission_id != null || record.record_type === "retest");
    if (isQcBatchOrRetest) { entry(date).qc += 1; qcCount++; }
    if (!isInitial) continue;
    const litres = record.weight_unit === "L" ? Number(record.weight_value)
      : record.weight_unit === "mL" ? Number(record.weight_value) / 1000 : NaN;
    if (Number.isFinite(litres) && litres >= 0) {
      entry(date).delta += litres;
      initialCount++;
    }
  }
  for (const action of actions) {
    const date = action.action_date;
    if (!isISODate(date) || date > range.end) continue;
    if (!["removal", "restoration"].includes(action.action_type)) {
      throw new Error("Unrecognised stock action. Balance could not be verified.");
    }
    const volume = Number(action.total_litres);
    if (!Number.isFinite(volume) || volume < 0) {
      throw new Error("Invalid stock action volume. Balance could not be verified.");
    }
    entry(date).delta += action.action_type === "removal" ? -volume : volume;
    actionCount++;
  }

  const sorted = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  for (const row of sorted) {
    if (row.date >= range.start) break;
    balance += row.delta;
  }
  const points = [{ date: range.start, delta: 0, qc: 0, balance }];
  for (const row of sorted) {
    if (row.date < range.start || row.date > range.end) continue;
    balance += row.delta;
    if (row.date === range.start) points[0] = { ...row, balance };
    else points.push({ ...row, balance });
  }
  if (points[points.length - 1].date !== range.end) {
    points.push({ date: range.end, delta: 0, qc: 0, balance });
  }
  return {
    points, lastBalance: balance, initialCount, actionCount, qcCount,
    hasInitial: initialCount > 0, hasActions: actionCount > 0
  };
}

function drawHarvest(rows) {
  const width = 880, height = 286, left = 64, right = 18, top = 24, bottom = 46;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = Math.max(1, ...rows.map(row => row.kg));
  const ceiling = niceCeiling(max);
  const svg = baseSvg(width, height, els.harvestPlot);
  drawGrid(svg, { width, height, left, right, top, bottom, max: ceiling, suffix: "kg" });
  const barW = Math.max(.7, Math.min(30, (plotW / rows.length) * .76));
  rows.forEach((row, index) => {
    if (row.kg <= 0) return;
    const x = left + ((index + .5) / rows.length) * plotW;
    const h = row.kg / ceiling * plotH;
    svgNode(svg, "rect", {
      x: x - barW / 2, y: top + plotH - h, width: barW, height: h,
      rx: Math.min(barW / 4, 3), class: "analysis-bar"
    }, `${formatDate(row.date)}: ${formatNumber(row.kg)} kg from ${row.count} collection entries`);
  });
  drawDateLabels(svg, rows.map(row => row.date), left, plotW, height - 16);
  els.harvestPlot.setAttribute("aria-label",
    `Wet seaweed collected by period. ${rows.length} periods, maximum ${formatNumber(max)} kilograms.`);
}

function drawStock(rows, range) {
  const width = 880, height = 286, left = 64, right = 18, top = 24, bottom = 46;
  const plotW = width - left - right, plotH = height - top - bottom;
  const rawMin = Math.min(0, ...rows.map(row => row.balance));
  const rawMax = Math.max(1, ...rows.map(row => row.balance));
  const floor = Math.min(0, Math.floor(rawMin / 100) * 100);
  const ceiling = Math.max(1, niceCeiling(rawMax));
  const svg = baseSvg(width, height, els.stockPlot);
  drawGrid(svg, { width, height, left, right, top, bottom, min: floor, max: ceiling, suffix: "L" });
  const a = dayNumber(range.start), b = dayNumber(range.end);
  const duration = Math.max(1, b - a);
  const x = date => left + (dayNumber(date) - a) / duration * plotW;
  const y = value => top + (ceiling - value) / (ceiling - floor) * plotH;
  for (const row of rows) {
    if (!row.qc) continue;
    const bandX = x(row.date);
    svgNode(svg, "rect", {
      x: Math.max(left, bandX - 4), y: top,
      width: Math.min(8, left + plotW - Math.max(left, bandX - 4)), height: plotH,
      class: "analysis-qc-band"
    }, `${formatDate(row.date)} · ${row.qc} QC records (recording date)`);
  }
  let d = `M ${x(rows[0].date)} ${y(rows[0].balance)}`;
  for (let i = 1; i < rows.length; i++) {
    d += ` H ${x(rows[i].date)} V ${y(rows[i].balance)}`;
  }
  svgNode(svg, "path", { d, class: "analysis-stroke" });
  rows.filter(row => row.qc > 0).forEach(row => {
    svgNode(svg, "circle", { cx: x(row.date), cy: y(row.balance),
      r: 3.5, class: "analysis-point" },
    `${formatDate(row.date)}: ${formatNumber(row.balance)} L · ${row.qc} QC records`);
  });
  drawDateLabels(svg, [range.start, range.end], left, plotW, height - 16);
  els.stockPlot.setAttribute("aria-label",
    `Recorded numbered stock balance from ${formatDate(range.start)} to ${formatDate(range.end)}. Final balance ${formatNumber(rows[rows.length - 1].balance)} litres. Shaded bands mark QC record dates.`);
}

function baseSvg(width, height, parent) {
  parent.replaceChildren();
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "presentation");
  parent.append(svg);
  return svg;
}

function svgNode(parent, tag, attributes, title = null) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, String(value)));
  if (title) {
    const tooltip = document.createElementNS(SVG_NS, "title");
    tooltip.textContent = title;
    el.append(tooltip);
  }
  parent.append(el);
  return el;
}

function drawGrid(svg, { height, left, right, top, bottom, max, min = 0, suffix }) {
  const graphH = height - top - bottom;
  for (let n = 0; n <= 4; n++) {
    const value = min + (max - min) * (4 - n) / 4;
    const y = top + graphH * n / 4;
    svgNode(svg, "line", { x1: left, y1: y, x2: 880 - right, y2: y, class: "analysis-axis" });
    const label = svgNode(svg, "text", { x: left - 9, y: y + 4, "text-anchor": "end" });
    label.textContent = `${formatShort(value)} ${suffix}`;
  }
}

function drawDateLabels(svg, dates, left, plotW, y) {
  if (!dates.length) return;
  const labels = [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates[dates.length - 1]];
  labels.forEach((date, index) => {
    const label = svgNode(svg, "text", {
      x: left + (plotW * index / 2), y,
      "text-anchor": index === 0 ? "start" : index === 2 ? "end" : "middle"
    });
    label.textContent = formatDate(date);
  });
}

function renderHarvestTable(rows) {
  els.harvestRows.replaceChildren();
  for (const row of rows) {
    appendCells(els.harvestRows, [formatDate(row.date), formatNumber(row.kg), formatNumber(row.count)]);
  }
}

function renderStockTable(rows) {
  els.stockRows.replaceChildren();
  for (const row of [...rows].reverse()) {
    if (row.delta === 0 && !row.qc) continue;
    appendCells(els.stockRows, [
      formatDate(row.date), `${row.delta > 0 ? "+" : ""}${formatNumber(row.delta)}`,
      formatNumber(row.balance), String(row.qc || "—")
    ]);
  }
}

function appendCells(parent, values) {
  const tr = document.createElement("tr");
  for (const value of values) {
    const td = document.createElement("td");
    td.textContent = String(value);
    tr.append(td);
  }
  parent.append(tr);
}

function unwrap(data) { return Array.isArray(data) ? data[0] : data; }
function isISODate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function dayNumber(iso) { return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000); }
function finiteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function niceCeiling(value) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  const m = value / step;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * step;
}
function formatDate(iso) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC",
    day: "numeric", month: "short", year: "2-digit" }).format(new Date(`${iso}T00:00:00Z`));
}
function formatNumber(value) {
  return Number(value).toLocaleString("en-KE", { maximumFractionDigits: 1 });
}
function formatShort(value) {
  return Math.abs(value) >= 1000 ? `${formatNumber(value / 1000)}k` : formatNumber(value);
}
function readableError(error) { return error?.message || "The analysis could not be loaded."; }
function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.dataset.status = isError ? "error" : "";
}
