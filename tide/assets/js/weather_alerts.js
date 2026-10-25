import { getLocale, t } from "./language.js?v=20260723-table-harvest-align";

const KMD_WARNINGS_URL = "https://meteo.go.ke/weather-warnings/";
const PUBLIC_ALERT_ENDPOINT = "https://wwzmajhdusfyfskppupg.supabase.co/functions/v1/kmd-weather-alerts";
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_RESPONSE_AGE_MS = 45 * 60 * 1000;

let lastStatus = null;
let elements = null;
let refreshing = false;

function initWeatherAlerts() {
  elements = {
    card: document.getElementById("weatherAlertCard"),
    label: document.getElementById("weatherAlertLabel"),
    text: document.getElementById("weatherAlertText"),
    meta: document.getElementById("weatherAlertMeta"),
    items: document.getElementById("weatherAlertItems"),
    source: document.getElementById("weatherAlertSource")
  };
  if (!elements.card) return;

  renderWeatherAlert({ status: "loading" });
  document.addEventListener("seaweed-language-change", () => {
    renderWeatherAlert(lastStatus || { status: "loading" });
  });
  document.getElementById("locationSelect")?.addEventListener("change", () => {
    if (lastStatus) renderWeatherAlert(lastStatus);
  });
  document.getElementById("mapRegionSelect")?.addEventListener("change", () => {
    if (lastStatus) renderWeatherAlert(lastStatus);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && lastStatus?.fetched_at &&
      Date.now() - new Date(lastStatus.fetched_at).getTime() >= REFRESH_INTERVAL_MS) {
      refreshWeatherAlertStatus();
    }
  });
  refreshWeatherAlertStatus();
  window.setInterval(() => {
    if (!document.hidden) refreshWeatherAlertStatus();
  }, REFRESH_INTERVAL_MS);
}

async function refreshWeatherAlertStatus() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch(PUBLIC_ALERT_ENDPOINT, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(16000)
    });
    if (!response.ok) throw new Error(`KMD alerts HTTP ${response.status}`);
    const data = await response.json();
    const status = normalizeWeatherStatus(data.status || data);
    const fetched = Date.parse(status.fetched_at || "");
    if (!Number.isFinite(fetched) || fetched > Date.now() + 60000 ||
      Date.now() - fetched > MAX_RESPONSE_AGE_MS || !["active", "clear"].includes(status.status)) {
      throw new Error("KMD alert information is not current");
    }
    renderWeatherAlert(status);
  } catch (error) {
    console.warn("KMD weather alert status is unavailable:", error);
    renderWeatherAlert({ status: "error" });
  } finally {
    refreshing = false;
  }
}

function normalizeWeatherStatus(raw) {
  const alerts = Array.isArray(raw.alerts) ? raw.alerts : [];
  return {
    status: String(raw.status || "unknown").toLowerCase(),
    fetched_at: raw.fetched_at || "",
    active_alert_count: Number(raw.active_alert_count || 0),
    coastal_alert_count: Number(raw.coastal_alert_count || 0),
    alerts
  };
}

function isKenyanCoastSelected() {
  const location = document.getElementById("locationSelect");
  const region = document.getElementById("mapRegionSelect");
  const selectedLabel = location?.selectedOptions?.[0]?.textContent ||
    region?.selectedOptions?.[0]?.textContent || "";
  return !/tanzania|zanzibar|dar es salaam|pemba|tanga region/i.test(selectedLabel);
}

function activeCoastalAlerts(status) {
  const now = Date.now();
  const selected = status.alerts.filter(alert => {
    const expiry = Date.parse(alert.expires_at || "");
    return alert.coastal_relevant === true &&
      (!Number.isFinite(expiry) || expiry > now);
  });
  const priority = event => /wave|swell|sea state/i.test(event) ? 0 :
    /wind|gale|storm/i.test(event) ? 1 : /rain|flood/i.test(event) ? 2 : 3;
  // Prefer an explicitly local advisory over a generic national one when
  // both cover the same weather event. Keep individual source links.
  const specificity = alert => /kwale|shimoni|wasini|mombasa/i.test(
    (alert.areas || []).join(" ")) ? 1 : 0;
  selected.sort((a, b) => priority(a.event || a.headline || "") -
    priority(b.event || b.headline || "") ||
    specificity(b) - specificity(a) ||
    Date.parse(b.sent_at || 0) - Date.parse(a.sent_at || 0));
  const seen = new Set();
  return selected.filter(alert => {
    const label = String(alert.event || alert.headline || "weather").toLowerCase();
    const group = /wave|swell/.test(label) ? "waves" :
      /wind|gale/.test(label) ? "winds" :
      /rain|flood/.test(label) ? "rain" : label;
    if (seen.has(group)) return false;
    seen.add(group);
    return true;
  }).slice(0, 4);
}

function renderWeatherAlert(raw) {
  if (!elements?.card) return;
  const status = normalizeWeatherStatus(raw);
  lastStatus = status;
  const isKenyan = isKenyanCoastSelected();
  const localAlerts = isKenyan && status.status === "active" ? activeCoastalAlerts(status) : [];
  let label, description, appearance;

  if (status.status === "loading") {
    appearance = "loading";
    label = t("weatherWarning.loadingLabel");
    description = t("weatherWarning.loadingText");
  } else if (status.status === "error" || status.status === "unknown") {
    appearance = "error";
    label = t("weatherWarning.errorLabel");
    description = t("weatherWarning.errorText");
  } else if (localAlerts.length) {
    appearance = "active";
    label = t("weatherWarning.activeCoastalLabel");
    description = t("weatherWarning.coastalCount", { count: localAlerts.length });
  } else if (!isKenyan) {
    appearance = "unknown";
    label = t("weatherWarning.nonKenyanLabel");
    description = t("weatherWarning.nonKenyanText");
  } else if (status.status === "active") {
    appearance = "unknown";
    label = t("weatherWarning.activeLabel");
    description = t("weatherWarning.noCoastalText");
  } else {
    appearance = "clear";
    label = t("weatherWarning.clearLabel");
    description = t("weatherWarning.clearText");
  }

  elements.card.dataset.weatherAlertStatus = appearance;
  elements.card.dataset.weatherAlertSeverity = localAlerts.some(a => /severe|extreme/i.test(a.severity || "")) ? "severe" : "moderate";
  elements.label.textContent = label;
  elements.text.textContent = description;
  if (elements.meta) {
    elements.meta.textContent = ["active", "clear"].includes(status.status) ?
      formatLastChecked(status.fetched_at) : "";
    elements.meta.hidden = !elements.meta.textContent;
  }
  if (elements.source) {
    elements.source.href = KMD_WARNINGS_URL;
    elements.source.textContent = t("weatherWarning.sourceLink");
  }
  if (elements.items) {
    elements.items.replaceChildren();
    for (const alert of localAlerts) elements.items.appendChild(createAlertItem(alert));
    elements.items.hidden = !localAlerts.length;
  }
}

function createAlertItem(alert) {
  const item = document.createElement("article");
  item.className = "weather-warning-item";
  const heading = document.createElement("div");
  heading.className = "weather-warning-item-heading";

  const title = document.createElement("strong");
  title.textContent = trimText(alert.event || alert.headline || t("weatherWarning.activeLabel"), 65);
  heading.appendChild(title);

  if (alert.severity) {
    const severity = document.createElement("span");
    severity.className = "weather-warning-severity";
    severity.textContent = alert.severity;
    heading.appendChild(severity);
  }
  item.appendChild(heading);

  const summary = trimText(alert.summary || alert.headline || "", 175);
  if (summary) {
    const detail = document.createElement("p");
    detail.className = "weather-warning-item-summary";
    detail.textContent = summary;
    item.appendChild(detail);
  }
  const footer = document.createElement("div");
  footer.className = "weather-warning-item-footer";
  const expiry = formatExpiry(alert.expires_at);
  if (expiry) {
    const until = document.createElement("span");
    until.textContent = t("weatherWarning.validUntil", { time: expiry });
    footer.appendChild(until);
  }
  const sourceLink = safeKmdLink(alert.link);
  if (sourceLink) {
    const link = document.createElement("a");
    link.href = sourceLink;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("weatherWarning.advisoryLink");
    footer.appendChild(link);
  }
  if (footer.childNodes.length) item.appendChild(footer);
  return item;
}

function safeKmdLink(link) {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname === "meteo.go.ke" ? url.href : null;
  } catch {
    return null;
  }
}

function formatExpiry(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(getLocale(), {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatLastChecked(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return t("weatherWarning.lastChecked", {
    time: new Intl.DateTimeFormat(getLocale(), {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      timeZone: "Africa/Nairobi"
    }).format(date)
  });
}

function trimText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3).trim()}…`;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWeatherAlerts);
} else {
  initWeatherAlerts();
}
