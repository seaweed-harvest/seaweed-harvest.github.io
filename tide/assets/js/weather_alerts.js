import { APP_CONFIG } from "./config.js?v=20260723-table-harvest-align";
import { getLocale, t } from "./language.js?v=20260723-table-harvest-align";
import {
  tideBackendContext,
  tideBackendTables
} from "./platform_backend.js?v=20260810-platform-auth-v3";

const SOURCE_KEY = "kmd_cap";
const KMD_WARNINGS_URL = "https://meteo.go.ke/weather-warnings/";
const EDGE_FUNCTION_NAME = "kmd-weather-alerts";

let lastRenderedStatus = null;
let elements = null;

function initWeatherAlerts() {
  elements = getElements();
  if (!elements.card) return;

  renderWeatherAlert({
    status: "loading",
    source_url: KMD_WARNINGS_URL
  });

  document.addEventListener("seaweed-language-change", () => {
    renderWeatherAlert(lastRenderedStatus || { status: "loading", source_url: KMD_WARNINGS_URL });
  });

  refreshWeatherAlertStatus();
}

function getElements() {
  return {
    card: document.getElementById("weatherAlertCard"),
    label: document.getElementById("weatherAlertLabel"),
    text: document.getElementById("weatherAlertText"),
    meta: document.getElementById("weatherAlertMeta"),
    source: document.getElementById("weatherAlertSource")
  };
}

async function refreshWeatherAlertStatus() {
  try {
    const storedStatus = await loadStoredStatusFromSupabase();
    renderWeatherAlert(storedStatus);
    return;
  } catch (storedError) {
    console.warn("Stored KMD weather alert status could not be read.", storedError);
  }

  if (APP_CONFIG.weatherAlerts?.edgeRefreshEnabled) {
    try {
      const liveStatus = await loadLiveStatusFromEdgeFunction();
      renderWeatherAlert(liveStatus);
      return;
    } catch (edgeError) {
      console.warn("KMD weather alert refresh failed.", edgeError);
    }
  }

  renderWeatherAlert({
    status: "error",
    source_url: KMD_WARNINGS_URL,
    error_message: "Weather alert status unavailable."
  });
}

async function loadLiveStatusFromEdgeFunction() {
  const backend = await tideBackendContext();
  if (!backend.url || !backend.anonKey || !backend.accessToken) {
    throw new Error("Supabase Edge Function details are not configured.");
  }

  const response = await fetch(`${backend.url}/functions/v1/${EDGE_FUNCTION_NAME}`, {
    cache: "no-store",
    headers: {
      apikey: backend.anonKey,
      Authorization: `Bearer ${backend.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`KMD alert refresh failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return normalizeWeatherStatus(payload.status || payload);
}

async function loadStoredStatusFromSupabase() {
  const backend = await tideBackendContext();
  if (!backend.restUrl || !backend.anonKey || !backend.accessToken) {
    throw new Error("Supabase public read details are not configured.");
  }

  const query = `source_key=eq.${encodeURIComponent(SOURCE_KEY)}&select=*&limit=1`;
  const response = await fetch(`${backend.restUrl}/${tideBackendTables().weather}?${query}`, {
    cache: "no-store",
    headers: {
      apikey: backend.anonKey,
      Authorization: `Bearer ${backend.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`KMD stored alert read failed: ${response.status} ${response.statusText}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("No KMD weather alert status row found.");
  }

  return normalizeWeatherStatus(rows[0]);
}

function normalizeWeatherStatus(rawStatus) {
  const raw = rawStatus || {};
  const alerts = normalizeAlerts(raw.alerts);
  const activeCount = Number(raw.active_alert_count ?? raw.activeAlertCount ?? 0);
  const coastalCount = Number(raw.coastal_alert_count ?? raw.coastalAlertCount ?? 0);
  const status = String(raw.status || (activeCount > 0 ? "active" : "unknown")).toLowerCase();

  return {
    source_key: raw.source_key || raw.sourceKey || SOURCE_KEY,
    source_name: raw.source_name || raw.sourceName || "Kenya Meteorological Department",
    source_url: raw.source_url || raw.sourceUrl || KMD_WARNINGS_URL,
    status,
    headline: raw.headline || alerts[0]?.headline || "",
    summary: raw.summary || alerts[0]?.summary || "",
    severity: raw.severity || alerts[0]?.severity || "",
    areas: Array.isArray(raw.areas) ? raw.areas : alerts[0]?.areas || [],
    coastal_relevant: Boolean(raw.coastal_relevant ?? raw.coastalRelevant ?? coastalCount > 0),
    active_alert_count: activeCount,
    coastal_alert_count: coastalCount,
    fetched_at: raw.fetched_at || raw.fetchedAt || "",
    error_message: raw.error_message || raw.errorMessage || "",
    alerts
  };
}

function normalizeAlerts(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function renderWeatherAlert(status) {
  if (!elements?.card) return;

  const normalized = normalizeWeatherStatus(status);
  lastRenderedStatus = normalized;

  const display = getDisplayState(normalized);
  elements.card.dataset.weatherAlertStatus = display.status;
  elements.label.textContent = display.label;
  elements.text.textContent = display.text;

  if (elements.meta) {
    elements.meta.textContent = display.meta;
    elements.meta.hidden = !display.meta;
  }

  if (elements.source) {
    elements.source.href = normalized.source_url || KMD_WARNINGS_URL;
    elements.source.textContent = t("weatherWarning.sourceLink");
  }
}

function getDisplayState(status) {
  if (status.status === "loading") {
    return {
      status: "loading",
      label: t("weatherWarning.loadingLabel"),
      text: t("weatherWarning.loadingText"),
      meta: ""
    };
  }

  if (status.status === "active" && status.active_alert_count > 0) {
    const labelKey = status.coastal_relevant ? "weatherWarning.activeCoastalLabel" : "weatherWarning.activeLabel";
    return {
      status: "active",
      label: t(labelKey),
      text: buildActiveAlertText(status),
      meta: formatLastChecked(status.fetched_at)
    };
  }

  if (status.status === "clear") {
    return {
      status: "clear",
      label: t("weatherWarning.clearLabel"),
      text: t("weatherWarning.clearText"),
      meta: formatLastChecked(status.fetched_at)
    };
  }

  if (status.status === "error") {
    return {
      status: "error",
      label: t("weatherWarning.errorLabel"),
      text: t("weatherWarning.errorText"),
      meta: formatLastChecked(status.fetched_at)
    };
  }

  return {
    status: "unknown",
    label: t("weatherWarning.label"),
    text: t("weatherWarning.text"),
    meta: formatLastChecked(status.fetched_at)
  };
}

function buildActiveAlertText(status) {
  const parts = [];
  if (status.headline) parts.push(status.headline);
  if (status.severity) parts.push(status.severity);
  if (Array.isArray(status.areas) && status.areas.length) parts.push(status.areas.slice(0, 3).join(", "));
  if (status.summary) parts.push(status.summary);

  const text = parts.filter(Boolean).join(" - ");
  return trimText(text || t("weatherWarning.text"), 260);
}

function formatLastChecked(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const formatted = new Intl.DateTimeFormat(getLocale(), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(date);

  return t("weatherWarning.lastChecked", { time: formatted });
}

function trimText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWeatherAlerts);
} else {
  initWeatherAlerts();
}
