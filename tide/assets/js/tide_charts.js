import {
  addDaysToDateKey,
  addMonthsToDateKey,
  formatDate,
  formatDateTime,
  formatTime,
  localDateKey,
  startOfMonthKey
} from "./tide_format.js";
import { getLocale, t } from "./language.js?v=20260723-table-harvest-align";

const COLORS = {
  line: "#3b82f6",
  fill: "rgba(59, 130, 246, 0.10)",
  grid: "rgba(30, 41, 59, 0.28)",
  axis: "#64748b",
  text: "#334155",
  low: "#22c55e",
  high: "#f59e0b",
  threshold: "#2f855a",
  thresholdFill: "rgba(22, 163, 74, 0.20)",
  thresholdSoftFill: "rgba(34, 197, 94, 0.08)",
  thresholdBorder: "rgba(22, 163, 74, 0.48)",
  night: "rgba(15, 23, 42, 0.055)",
  now: "#ef4444"
};

const CHART_STATES = new WeakMap();
const BOUND_CANVASES = new WeakSet();
const INTERACTION_FLAGS = new WeakMap();

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(260, Math.round(rect.width || canvas.parentElement?.clientWidth || 640));
  const height = Math.max(220, Math.round(rect.height || canvas.parentElement?.clientHeight || 280));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  return { ctx, width, height };
}

function paddedRange(values, fallback = [0, 1]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }

  const pad = (max - min) * 0.12;
  return [Math.max(0, min - pad), max + pad];
}

function drawText(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.fillStyle = options.color || COLORS.text;
  ctx.font = `${options.weight || 500} ${options.size || 12}px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function renderTideChart(canvas, curve, extremes, options = {}) {
  if (!canvas || !curve.length) return;

  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = {
    top: Number.isFinite(options.topPadding) ? options.topPadding : options.legendSpace ? 42 : 18,
    right: Number.isFinite(options.rightPadding) ? options.rightPadding : 16,
    bottom: Number.isFinite(options.bottomPadding) ? options.bottomPadding : options.timeGrid === "half-day" || options.timeGrid === "month" ? 46 : 34,
    left: Number.isFinite(options.leftPadding) ? options.leftPadding : 46
  };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const minTime = curve[0].timeMs;
  const maxTime = curve[curve.length - 1].timeMs;
  const threshold = options.thresholdEnabled ? Number(options.thresholdM) : NaN;
  const [minH, maxH] = paddedRange([...curve.map((point) => point.heightM), threshold]);

  const x = (timeMs) => pad.left + ((timeMs - minTime) / (maxTime - minTime || 1)) * plotW;
  const y = (heightM) => pad.top + (1 - (heightM - minH) / (maxH - minH || 1)) * plotH;
  const extremeMarkers = options.showExtremes === false
    ? []
    : buildExtremeMarkers(extremes, x, y, minTime, maxTime, options);
  const chartState = {
    canvas,
    curve,
    extremes,
    options,
    width,
    height,
    pad,
    plotW,
    plotH,
    minTime,
    maxTime,
    minH,
    maxH,
    x,
    y,
    extremeMarkers,
    activePoint: options.activePoint || null
  };

  CHART_STATES.set(canvas, chartState);
  bindChartInteractions(canvas);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (options.timeGrid === "month" && options.monthBanding !== false) {
    drawMonthBackgroundBands(ctx, pad, plotW, plotH, x, minTime, maxTime, options.timeZone);
  }

  drawNightBands(ctx, options.nightBands, x, pad, plotW, plotH, options);

  if (options.thresholdEnabled && Number.isFinite(threshold)) {
    const thresholdY = y(threshold);
    if (options.thresholdShadeMode === "harvest-windows") {
      drawHarvestWindowFills(ctx, options.harvestWindows, x, pad, plotW, plotH, thresholdY, options);
    } else if (options.thresholdShadeMode === "below-curve") {
      drawBelowThresholdRegions(ctx, curve, x, y, threshold, thresholdY);
    } else {
      drawThresholdBandFill(ctx, pad, plotW, plotH, thresholdY);
    }
  }

  drawGrid(ctx, width, height, pad, minH, maxH, x, y, minTime, maxTime, options);

  if (options.thresholdEnabled && Number.isFinite(threshold)) {
    const thresholdY = y(threshold);
    if (options.thresholdShadeMode === "harvest-windows") {
      drawHarvestWindowBorders(ctx, options.harvestWindows, x, pad, plotW, plotH, options);
    }
    drawThresholdLine(ctx, pad, plotW, thresholdY, threshold, options);
  }

  drawCurve(ctx, curve, x, y, pad, plotH);
  if (options.showExtremes !== false) {
    drawExtremes(ctx, extremeMarkers, options);
  }

  if (options.now) {
    const nowX = x(options.now.getTime());
    if (nowX >= pad.left && nowX <= pad.left + plotW) {
      ctx.save();
      ctx.strokeStyle = COLORS.now;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(nowX, pad.top);
      ctx.lineTo(nowX, pad.top + plotH);
      ctx.stroke();
      ctx.restore();
      drawText(ctx, t("chart.now"), nowX + 5, pad.top + 10, { color: COLORS.now, size: options.tickLabelSize || 11 });
    }
  }

  if (chartState.activePoint) {
    drawActiveReadout(ctx, chartState.activePoint, chartState);
  }
}

function drawGrid(ctx, width, height, pad, minH, maxH, x, y, minTime, maxTime, options) {
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;

  const yTicks = options.compact ? 5 : 6;
  for (let i = 0; i <= yTicks; i += 1) {
    const value = minH + ((maxH - minH) / yTicks) * i;
    const yy = y(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    drawText(ctx, value.toFixed(1), pad.left - 8, yy, { align: "right", color: COLORS.axis, size: options.axisLabelSize || 11 });
  }

  const plotW = width - pad.left - pad.right;
  if (!options.compact && options.timeGrid === "half-day") {
    drawHalfDayTimeGrid(ctx, width, height, pad, x, minTime, maxTime, options.timeZone, options);
    ctx.restore();
    return;
  }

  if (options.timeGrid === "month") {
    drawMonthTimeGrid(ctx, width, height, pad, x, minTime, maxTime, options.timeZone, options);
    ctx.restore();
    return;
  }

  const tickCount = options.compact
    ? Math.min(7, Math.max(3, Math.floor(plotW / 220)))
    : Math.min(10, Math.max(4, Math.floor(plotW / 145)));
  for (let i = 0; i <= tickCount; i += 1) {
    const t = minTime + ((maxTime - minTime) / tickCount) * i;
    const xx = x(t);
    ctx.beginPath();
    ctx.moveTo(xx, pad.top);
    ctx.lineTo(xx, height - pad.bottom);
    ctx.stroke();

    const labelDate = new Date(t);
    const label = options.compact
      ? formatDate(labelDate, options.timeZone, chartLocale(options))
      : formatDateTime(labelDate, options.timeZone, chartLocale(options));
    const align = i === 0 ? "left" : i === tickCount ? "right" : "center";
    drawText(ctx, label, xx, height - 16, { align, color: COLORS.axis, size: options.tickLabelSize || 10 });
  }

  ctx.restore();
}

function drawHalfDayTimeGrid(ctx, width, height, pad, x, minTime, maxTime, timeZone, options = {}) {
  const ticks = buildHalfDayTicks(minTime, maxTime, timeZone || "UTC");

  for (const tick of ticks) {
    const xx = x(tick.timeMs);
    if (xx < pad.left || xx > width - pad.right) continue;

    const isDayStart = tick.hour === 0;
    ctx.strokeStyle = isDayStart ? "rgba(30, 41, 59, 0.42)" : "rgba(30, 41, 59, 0.22)";
    ctx.lineWidth = isDayStart ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(xx, pad.top);
    ctx.lineTo(xx, height - pad.bottom);
    ctx.stroke();

    const align = xx - pad.left < 34 ? "left" : width - pad.right - xx < 34 ? "right" : "center";
    drawText(ctx, isDayStart ? formatDate(new Date(tick.timeMs), timeZone, chartLocale(options)) : "12:00", xx, height - 19, {
      align,
      color: COLORS.axis,
      size: options.tickLabelSize || 10,
      weight: isDayStart ? 700 : 500
    });
  }
}

function buildHalfDayTicks(minTime, maxTime, timeZone) {
  const ticks = [];
  let dateKey = localDateKey(new Date(minTime - 86400000), timeZone);
  const endKey = localDateKey(new Date(maxTime + 86400000), timeZone);

  while (dateKey <= endKey) {
    for (const hour of [0, 12]) {
      const date = zonedDateKeyToDate(dateKey, timeZone, hour);
      const timeMs = date.getTime();
      if (timeMs >= minTime && timeMs <= maxTime) {
        ticks.push({ timeMs, hour });
      }
    }
    dateKey = addDaysToDateKey(dateKey, 1);
  }

  return ticks.sort((a, b) => a.timeMs - b.timeMs);
}

function drawMonthTimeGrid(ctx, width, height, pad, x, minTime, maxTime, timeZone, options = {}) {
  const zone = timeZone || "UTC";
  const startKey = localDateKey(new Date(minTime), zone);
  const endKey = localDateKey(new Date(maxTime), zone);
  let monthKey = startOfMonthKey(startKey);
  const endMonthKey = startOfMonthKey(endKey);

  while (monthKey <= endMonthKey) {
    const nextMonthKey = addMonthsToDateKey(monthKey, 1);
    const monthStart = zonedDateKeyToDate(monthKey, zone).getTime();
    const nextMonthStart = zonedDateKeyToDate(nextMonthKey, zone).getTime();
    const visibleStart = Math.max(minTime, monthStart);
    const visibleEnd = Math.min(maxTime, nextMonthStart);

    if (visibleEnd > visibleStart) {
      const monthBoundaryX = x(monthStart);
      if (monthStart >= minTime && monthStart <= maxTime) {
        ctx.strokeStyle = "rgba(30, 41, 59, 0.58)";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(monthBoundaryX, pad.top);
        ctx.lineTo(monthBoundaryX, height - pad.bottom);
        ctx.stroke();
      }

      const midMonthKey = `${monthKey.slice(0, 8)}15`;
      const midMonth = zonedDateKeyToDate(midMonthKey, zone).getTime();
      if (midMonth >= minTime && midMonth <= maxTime) {
        const midX = x(midMonth);
        ctx.strokeStyle = "rgba(30, 41, 59, 0.26)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(midX, pad.top);
        ctx.lineTo(midX, height - pad.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        drawText(ctx, formatMidMonthLabel(new Date(midMonth), zone, chartLocale(options)), midX, height - 29, {
          align: "center",
          color: COLORS.axis,
          size: options.tickLabelSize ? Math.max(8, options.tickLabelSize - 1) : 9
        });
      }

      const labelX = x(visibleStart + (visibleEnd - visibleStart) / 2);
      drawText(ctx, formatMonthLabel(new Date(visibleStart + (visibleEnd - visibleStart) / 2), zone, chartLocale(options)), labelX, height - 14, {
        align: "center",
        color: COLORS.axis,
        size: options.axisLabelSize || 11,
        weight: 700
      });
    }

    monthKey = nextMonthKey;
  }
}

function drawMonthBackgroundBands(ctx, pad, plotW, plotH, x, minTime, maxTime, timeZone) {
  const zone = timeZone || "UTC";
  const startKey = localDateKey(new Date(minTime), zone);
  const endKey = localDateKey(new Date(maxTime), zone);
  let monthKey = startOfMonthKey(startKey);
  const endMonthKey = startOfMonthKey(endKey);
  let index = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();

  while (monthKey <= endMonthKey) {
    const nextMonthKey = addMonthsToDateKey(monthKey, 1);
    const monthStart = zonedDateKeyToDate(monthKey, zone).getTime();
    const nextMonthStart = zonedDateKeyToDate(nextMonthKey, zone).getTime();
    const visibleStart = Math.max(minTime, monthStart);
    const visibleEnd = Math.min(maxTime, nextMonthStart);

    if (visibleEnd > visibleStart && index % 2 === 0) {
      const left = x(visibleStart);
      const right = x(visibleEnd);
      ctx.fillStyle = "rgba(15, 118, 110, 0.075)";
      ctx.fillRect(left, pad.top, right - left, plotH);
    }

    monthKey = nextMonthKey;
    index += 1;
  }

  ctx.restore();
}

function drawNightBands(ctx, bands, x, pad, plotW, plotH, options = {}) {
  if (!Array.isArray(bands) || !bands.length) return;

  const chartLeft = pad.left;
  const chartRight = pad.left + plotW;
  const chartTop = pad.top;

  ctx.save();
  ctx.beginPath();
  ctx.rect(chartLeft, chartTop, plotW, plotH);
  ctx.clip();
  ctx.fillStyle = options.nightBandColor || COLORS.night;

  for (const band of bands) {
    const start = getWindowTime(band.start);
    const end = getWindowTime(band.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const left = Math.max(chartLeft, x(start));
    const right = Math.min(chartRight, x(end));
    if (right > left) {
      ctx.fillRect(left, chartTop, right - left, plotH);
    }
  }

  ctx.restore();
}

function formatMonthLabel(date, timeZone, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "long"
  }).format(date);
}

function formatMidMonthLabel(date, timeZone, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short"
  }).format(date);
}

function drawThresholdBandFill(ctx, pad, plotW, plotH, thresholdY) {
  ctx.save();
  ctx.fillStyle = COLORS.thresholdSoftFill;
  ctx.fillRect(pad.left, thresholdY, plotW, Math.max(0, pad.top + plotH - thresholdY));
  ctx.restore();
}

function drawThresholdLine(ctx, pad, plotW, thresholdY, threshold, options = {}) {
  ctx.save();
  ctx.strokeStyle = COLORS.threshold;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, thresholdY);
  ctx.lineTo(pad.left + plotW, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (options.showThresholdLabel === false) {
    ctx.restore();
    return;
  }

  const outsideLeft = options.thresholdLabelPosition === "left-of-axis";
  drawText(ctx, t("chart.thresholdHarvest", { value: Number(threshold).toFixed(2) }), outsideLeft ? pad.left - 10 : pad.left + 8, thresholdY - 8, {
    align: outsideLeft ? "right" : "left",
    color: COLORS.threshold,
    size: 11,
    weight: 700
  });
  ctx.restore();
}

function drawHarvestWindowFills(ctx, windows, x, pad, plotW, plotH, thresholdY, options) {
  const grouped = groupHarvestWindows(windows, options.harvestWindowGroupGapMs);
  if (!grouped.length) return;

  const chartLeft = pad.left;
  const chartRight = pad.left + plotW;
  const chartTop = pad.top;
  const chartBottom = pad.top + plotH;
  const bandTop = Math.max(chartTop, Math.min(thresholdY, chartBottom));

  ctx.save();
  ctx.beginPath();
  ctx.rect(chartLeft, chartTop, plotW, plotH);
  ctx.clip();

  for (const window of grouped) {
    const left = Math.max(chartLeft, x(getWindowTime(window.start)));
    const right = Math.min(chartRight, x(getWindowTime(window.end)));
    if (right <= left) continue;

    const topColor = options.harvestWindowTopColor || COLORS.thresholdSoftFill;
    if (topColor !== "transparent" && topColor !== "none") {
      ctx.fillStyle = topColor;
      ctx.fillRect(left, chartTop, right - left, Math.max(0, bandTop - chartTop));
    }

    ctx.fillStyle = options.harvestWindowBottomColor || COLORS.thresholdFill;
    ctx.fillRect(left, bandTop, right - left, chartBottom - bandTop);
  }

  ctx.restore();
}

function drawHarvestWindowBorders(ctx, windows, x, pad, plotW, plotH, options) {
  const grouped = groupHarvestWindows(windows, options.harvestWindowGroupGapMs);
  if (!grouped.length) return;

  const chartLeft = pad.left;
  const chartRight = pad.left + plotW;
  const chartTop = pad.top;
  const chartBottom = pad.top + plotH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(chartLeft, chartTop, plotW, plotH);
  ctx.clip();
  ctx.strokeStyle = options.harvestWindowBorderColor || COLORS.thresholdBorder;
  ctx.lineWidth = options.harvestWindowBorderWidth || 1.25;
  ctx.setLineDash(options.harvestWindowBorderDash || [4, 4]);
  const labels = [];

  for (const window of grouped) {
    const left = Math.max(chartLeft, x(getWindowTime(window.start)));
    const right = Math.min(chartRight, x(getWindowTime(window.end)));
    if (right <= left) continue;

    ctx.strokeRect(left, chartTop, right - left, chartBottom - chartTop);

    const label = harvestWindowLabel(window, options);
    const minLabelWidth = options.harvestWindowLabelMinWidth || 36;
    if (label && right - left >= minLabelWidth) {
      const labelY = options.harvestWindowLabelPosition === "above-plot"
        ? Math.max(8, chartTop - (options.harvestWindowLabelOffset || 10))
        : chartTop + 10;
      labels.push({ label, x: (left + right) / 2, y: labelY });
    }
  }

  ctx.restore();

  if (labels.length) {
    ctx.save();
    ctx.setLineDash([]);
    for (const item of labels) {
      drawText(ctx, item.label, item.x, item.y, {
        align: "center",
        color: options.harvestWindowLabelColor || COLORS.threshold,
        size: 10,
        weight: 700
      });
    }
    ctx.restore();
  }
}

function harvestWindowLabel(window, options) {
  if (!options.harvestWindowLabel) return "";
  if (typeof options.harvestWindowLabel === "function") {
    return options.harvestWindowLabel(window);
  }
  return options.harvestWindowLabel;
}

function groupHarvestWindows(windows, gapMs) {
  if (!Array.isArray(windows) || !windows.length) return [];

  const sorted = windows
    .map((window) => ({
      start: getWindowTime(window.start),
      end: getWindowTime(window.end)
    }))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .sort((a, b) => a.start - b.start);

  if (!Number.isFinite(gapMs)) return sorted;

  return sorted.reduce((groups, window) => {
    const previous = groups[groups.length - 1];
    if (previous && window.start - previous.end <= gapMs) {
      previous.end = Math.max(previous.end, window.end);
    } else {
      groups.push({ ...window });
    }
    return groups;
  }, []);
}

function getWindowTime(value) {
  if (value instanceof Date) return value.getTime();
  return Number(value);
}

function zonedDateKeyToDate(dateKey, timeZone, hour = 0) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  let utcMs = targetMs;

  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(new Date(utcMs), timeZone);
    const renderedMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const deltaMs = renderedMs - targetMs;
    if (Math.abs(deltaMs) < 1000) break;
    utcMs -= deltaMs;
  }

  return new Date(utcMs);
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function drawBelowThresholdRegions(ctx, curve, x, y, threshold, thresholdY) {
  ctx.save();
  ctx.fillStyle = COLORS.thresholdFill;

  for (let i = 1; i < curve.length; i += 1) {
    const prev = curve[i - 1];
    const next = curve[i];
    const prevBelow = prev.heightM <= threshold;
    const nextBelow = next.heightM <= threshold;

    if (!prevBelow && !nextBelow) continue;

    const left = prevBelow ? prev : crossingPoint(prev, next, threshold);
    const right = nextBelow ? next : crossingPoint(prev, next, threshold);

    if (!left || !right) continue;

    const x1 = x(left.timeMs);
    const x2 = x(right.timeMs);
    const y1 = y(Math.min(left.heightM, threshold));
    const y2 = y(Math.min(right.heightM, threshold));

    ctx.beginPath();
    ctx.moveTo(x1, thresholdY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, thresholdY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function crossingPoint(prev, next, threshold) {
  const delta = next.heightM - prev.heightM;
  if (!Number.isFinite(delta) || delta === 0) {
    return { timeMs: prev.timeMs, heightM: threshold };
  }

  const ratio = (threshold - prev.heightM) / delta;
  return {
    timeMs: prev.timeMs + (next.timeMs - prev.timeMs) * ratio,
    heightM: threshold
  };
}

function drawCurve(ctx, curve, x, y, pad, plotH) {
  ctx.save();
  ctx.beginPath();
  curve.forEach((point, index) => {
    const xx = x(point.timeMs);
    const yy = y(point.heightM);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });

  ctx.lineTo(x(curve[curve.length - 1].timeMs), pad.top + plotH);
  ctx.lineTo(x(curve[0].timeMs), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = COLORS.fill;
  ctx.fill();

  ctx.beginPath();
  curve.forEach((point, index) => {
    const xx = x(point.timeMs);
    const yy = y(point.heightM);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();
}

function buildExtremeMarkers(extremes, x, y, minTime, maxTime, options) {
  const visible = extremes.filter((extreme) => extreme.timeMs >= minTime && extreme.timeMs <= maxTime);
  const compact = !!options.compact;
  const maxCompactMarkers = Number.isFinite(options.compactExtremeMax) ? options.compactExtremeMax : 42;
  const stride = Number.isFinite(options.extremeMarkerStride)
    ? Math.max(1, options.extremeMarkerStride)
    : compact ? Math.max(1, Math.ceil(visible.length / maxCompactMarkers)) : 1;
  const size = Number.isFinite(options.extremeMarkerSize) ? options.extremeMarkerSize : compact ? 3.8 : 5;

  return visible
    .filter((_, index) => !compact || index % stride === 0)
    .map((extreme) => ({
      extreme,
      type: extreme.type,
      x: x(extreme.timeMs),
      y: y(extreme.heightM),
      size
    }));
}

function drawExtremes(ctx, markers, options) {
  ctx.save();

  const compact = !!options.compact;
  const showLabels = options.showExtremeLabels !== false;

  markers.forEach((marker) => {
    const isLow = marker.type === "low";
    ctx.fillStyle = isLow ? COLORS.low : COLORS.high;
    if (isLow) {
      drawDiamond(ctx, marker.x, marker.y, marker.size);
    } else {
      drawTriangle(ctx, marker.x, marker.y, marker.size);
    }

    if (showLabels && !compact && isLow) {
      drawText(ctx, formatTime(marker.extreme.date, options.timeZone || "UTC", chartLocale(options)), marker.x, marker.y + 12, {
        align: "center",
        color: COLORS.low,
        size: 10,
        weight: 700
      });
    }
  });

  ctx.restore();
}

function drawActiveReadout(ctx, point, state) {
  const { width, height, pad, plotH, x, y, options } = state;
  const xx = x(point.timeMs);
  const yy = y(point.heightM);
  const chartBottom = pad.top + plotH;

  ctx.save();
  ctx.strokeStyle = "rgba(15, 118, 110, 0.72)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(xx, pad.top);
  ctx.lineTo(xx, chartBottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = point.type === "high" ? COLORS.high : point.type === "low" ? COLORS.low : COLORS.line;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(xx, yy, options.compact ? 4.5 : 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  drawTooltip(ctx, point, xx, yy, width, height, options);
  ctx.restore();
}

function drawTooltip(ctx, point, xPos, yPos, width, height, options) {
  const title = point.type === "high" ? t("chart.tooltipHigh") : point.type === "low" ? t("chart.tooltipLow") : t("chart.tooltipHeight");
  const lines = [
    title,
    formatDateTime(new Date(point.timeMs), options.timeZone || "UTC", chartLocale(options)),
    `${Number(point.heightM).toFixed(2)} m`
  ];
  const fontSize = options.compact ? 10 : 11;
  const lineHeight = fontSize + 4;
  const paddingX = 8;
  const paddingY = 7;

  ctx.save();
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif`;
  const boxW = Math.max(...lines.map((line) => ctx.measureText(line).width)) + paddingX * 2;
  const boxH = lines.length * lineHeight + paddingY * 2 - 3;
  let boxX = xPos + 10;
  let boxY = yPos - boxH - 12;

  if (boxX + boxW > width - 4) boxX = xPos - boxW - 10;
  if (boxX < 4) boxX = 4;
  if (boxY < 4) boxY = yPos + 12;
  if (boxY + boxH > height - 4) boxY = height - boxH - 4;

  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeStyle = "rgba(15, 118, 110, 0.34)";
  ctx.lineWidth = 1;
  roundRect(ctx, boxX, boxY, boxW, boxH, 7);
  ctx.fill();
  ctx.stroke();

  lines.forEach((line, index) => {
    drawText(ctx, line, boxX + paddingX, boxY + paddingY + index * lineHeight + lineHeight / 2 - 1, {
      color: index === 0 ? COLORS.text : COLORS.axis,
      size: fontSize,
      weight: index === 0 ? 700 : 600
    });
  });
  ctx.restore();
}

function roundRect(ctx, xPos, yPos, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(xPos + r, yPos);
  ctx.lineTo(xPos + width - r, yPos);
  ctx.quadraticCurveTo(xPos + width, yPos, xPos + width, yPos + r);
  ctx.lineTo(xPos + width, yPos + height - r);
  ctx.quadraticCurveTo(xPos + width, yPos + height, xPos + width - r, yPos + height);
  ctx.lineTo(xPos + r, yPos + height);
  ctx.quadraticCurveTo(xPos, yPos + height, xPos, yPos + height - r);
  ctx.lineTo(xPos, yPos + r);
  ctx.quadraticCurveTo(xPos, yPos, xPos + r, yPos);
  ctx.closePath();
}

function bindChartInteractions(canvas) {
  if (BOUND_CANVASES.has(canvas)) return;

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);
  canvas.addEventListener("lostpointercapture", handlePointerUp);
  BOUND_CANVASES.add(canvas);
}

function handlePointerDown(event) {
  const canvas = event.currentTarget;
  const state = CHART_STATES.get(canvas);
  if (!state) return;

  event.preventDefault();
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic tests and a few embedded browsers can report pointer IDs that cannot be captured.
  }
  INTERACTION_FLAGS.set(canvas, { dragging: true, pointerId: event.pointerId });
  updateInteraction(canvas, event, true);
}

function handlePointerMove(event) {
  const canvas = event.currentTarget;
  const flags = INTERACTION_FLAGS.get(canvas);
  if (!flags?.dragging || flags.pointerId !== event.pointerId) return;

  event.preventDefault();
  updateInteraction(canvas, event, false);
}

function handlePointerUp(event) {
  const canvas = event.currentTarget;
  const flags = INTERACTION_FLAGS.get(canvas);
  if (flags?.pointerId === event.pointerId) {
    INTERACTION_FLAGS.set(canvas, { dragging: false, pointerId: null });
  }
}

function updateInteraction(canvas, event, preferExtreme) {
  const state = CHART_STATES.get(canvas);
  if (!state) return;

  const pointer = canvasPointer(event, canvas);
  const point = preferExtreme
    ? nearestExtremePoint(state, pointer) || curvePointAtPointer(state, pointer)
    : curvePointAtPointer(state, pointer);

  if (!point) return;

  canvas.title = `${formatDateTime(new Date(point.timeMs), state.options.timeZone || "UTC", chartLocale(state.options))} - ${Number(point.heightM).toFixed(2)} m`;
  renderTideChart(canvas, state.curve, state.extremes, {
    ...state.options,
    activePoint: point
  });
}

function chartLocale(options = {}) {
  return options.locale || getLocale();
}

function canvasPointer(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function nearestExtremePoint(state, pointer) {
  if (!state.extremeMarkers.length) return null;

  const hitRadius = Number.isFinite(state.options.extremeHitRadius)
    ? state.options.extremeHitRadius
    : state.options.compact ? 16 : 12;
  let best = null;

  for (const marker of state.extremeMarkers) {
    const distance = Math.hypot(pointer.x - marker.x, pointer.y - marker.y);
    if (distance <= hitRadius && (!best || distance < best.distance)) {
      best = { marker, distance };
    }
  }

  if (!best) return null;
  const extreme = best.marker.extreme;
  return {
    type: extreme.type,
    timeMs: extreme.timeMs,
    heightM: extreme.heightM
  };
}

function curvePointAtPointer(state, pointer) {
  if (!state.curve.length) return null;

  const clampedX = Math.min(state.pad.left + state.plotW, Math.max(state.pad.left, pointer.x));
  const ratio = (clampedX - state.pad.left) / (state.plotW || 1);
  const timeMs = state.minTime + ratio * (state.maxTime - state.minTime);
  const heightM = interpolateCurveHeight(state.curve, timeMs);

  return {
    type: "curve",
    timeMs,
    heightM
  };
}

function interpolateCurveHeight(curve, timeMs) {
  if (timeMs <= curve[0].timeMs) return curve[0].heightM;
  if (timeMs >= curve[curve.length - 1].timeMs) return curve[curve.length - 1].heightM;

  for (let i = 1; i < curve.length; i += 1) {
    const next = curve[i];
    if (next.timeMs < timeMs) continue;

    const prev = curve[i - 1];
    const span = next.timeMs - prev.timeMs || 1;
    const ratio = (timeMs - prev.timeMs) / span;
    return prev.heightM + (next.heightM - prev.heightM) * ratio;
  }

  return curve[curve.length - 1].heightM;
}

function drawDiamond(ctx, xPos, yPos, size) {
  ctx.beginPath();
  ctx.moveTo(xPos, yPos - size);
  ctx.lineTo(xPos + size, yPos);
  ctx.lineTo(xPos, yPos + size);
  ctx.lineTo(xPos - size, yPos);
  ctx.closePath();
  ctx.fill();
}

function drawTriangle(ctx, xPos, yPos, size) {
  ctx.beginPath();
  ctx.moveTo(xPos, yPos - size);
  ctx.lineTo(xPos + size, yPos + size);
  ctx.lineTo(xPos - size, yPos + size);
  ctx.closePath();
  ctx.fill();
}
