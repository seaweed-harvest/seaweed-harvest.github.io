import { APP_CONFIG } from "./config.js?v=20260725-location-cleanup";
import {
  getDataStatus,
  getLocations,
  getProfiles,
  loadPublicFarmLocations,
  loadPublicTideDatasetBundle
} from "./tide_data.js?v=20260725-location-cleanup";
import {
  getFarmLocationOfflineBundle,
  isOfflineStorageSupported,
  removeFarmLocationOfflineBundle,
  saveFarmLocationOfflineBundle
} from "./offline_location_store.js?v=20260810";
import {
  moonEvents,
  moonIllumination,
  moonPhase,
  moonPhaseName,
  nextMoonEvent,
  rangeAroundNow,
  springWindows,
  tideCurve,
  tideExtremes,
  tideHeight
} from "./tide_core.js";
import {
  addDaysToDateKey,
  addMonthsToDateKey,
  dateKeyToUtcDate,
  daysInMonth,
  formatDate,
  formatDateTime,
  formatMetres,
  formatMonth,
  formatPercent,
  formatTime,
  localDateKey,
  startOfMonthKey,
  weekdayIndex
} from "./tide_format.js";
import { renderTideChart } from "./tide_charts.js?v=20260725-location-cleanup";
import {
  getLocale,
  t,
  translateDataText,
  translateStatusLabel
} from "./language.js?v=20260725-location-cleanup";

const state = {
  location: null,
  profile: null,
  thresholdM: 0.7,
  thresholdEnabled: true,
  forecastDays: 7,
  overviewMonths: 3,
  lowListDays: 14,
  lastForecast: null,
  forecastRangeUserSelected: false,
  overviewRangeUserSelected: false,
  runtimeBundle: null,
  runtimeTideData: null,
  offlineBundle: null,
  offlineTideData: null,
  tideDataStatus: "loading",
  forecastRefreshKey: ""
};

const els = {};
const MAIN_TIDE_DATASET_KEY = "kmfri_2026_mombasa";
let farmLocations = mainPageLocations(getLocations());
let tideLocations = farmLocations;
const TIDE_PROFILES = getProfiles();
const FORECAST_AUTO_REFRESH_MS = 5 * 60 * 1000;
const LOW_TIDE_SUNRISE_GRACE_MS = 60 * 60 * 1000;
const LEGACY_LOCATION_KEY_ALIASES = {
  "kenya-coast-reference": "kenya-coast",
  "funzi-placeholder": "funzi",
  "shangani-placeholder": "shangani",
  "shimoni-placeholder": "shimoni",
  "bati-seaweed-group": "bati",
  "chiromo-seaweed-farmers": "chiromo",
  "daima-self-help-group": "daima",
  "furaha-seaweed-group": "furaha",
  "imani-seaweed-farmers-gazi": "imani",
  "jimbo-youth-group": "jimbo",
  "kibuyuni-seaweed-farmers-cooperative": "kibuyuni",
  "kijiweni-self-help-group": "kijiweni",
  "mkwiro-seaweed-development-group": "mkwiro",
  "mtimbwani-seaweed": "mtimbwani",
  "nuru-isamic": "nuru",
  "shangani-amani-enterprises": "shangani-amani",
  "siwema-environmental-conservation-group": "siwema",
  "tumbe-seaweed-farmers": "tumbe",
  "tunusuru-conservation-group": "tunusuru",
  "tushirikiane-conservation-women": "tushirikiane",
  "wasini-seaweed-group": "wasini",
  "yungi-mwenjeni-conservation-group": "yungi-mwenjeni",
  "fremantle-reference": "fremantle"
};
const MOBILE_QUERY = window.matchMedia("(max-width: 620px)");
const SYMBOLS = {
  plant: "\uD83C\uDF3F",
  lodge: "\uD83C\uDFE8",
  newMoon: "\uD83C\uDF11",
  fullMoon: "\uD83C\uDF15",
  down: "\u25BC"
};
const MOON_PHASE_SYMBOLS = [
  "\uD83C\uDF11",
  "\uD83C\uDF12",
  "\uD83C\uDF13",
  "\uD83C\uDF14",
  "\uD83C\uDF15",
  "\uD83C\uDF16",
  "\uD83C\uDF17",
  "\uD83C\uDF18"
];
let tideDataLoadSequence = 0;
const TREND_SYMBOLS = {
  slack: "\u2194",
  flooding: "\u2197",
  ebbing: "\u2198"
};
const SOLAR_ZENITH_DEG = 90.833;
const PROFILE_REFERENCE_COORDINATES = {
  kenya_mombasa_reference: { lat: -4.0435, lon: 39.6682 },
  fremantle_reference: { lat: -32.0569, lon: 115.7439 }
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  populateLocationSelect();
  applyResponsiveDefaults();
  bindEvents();
  setLocation(resolveInitialLocationKey(), { updateUrl: false, persistSelection: false });
  void refreshLocationRecordsInPlace();
  window.setInterval(renderClock, 30000);
  window.setInterval(refreshForecastIfNeeded, 60000);
}

function cacheElements() {
  [
    "locationSelect",
    "selectedLocationIcon",
    "selectedLocationName",
    "locationMeta",
    "locationReferenceStation",
    "localClock",
    "thresholdEnabled",
    "thresholdInput",
    "thresholdDefault",
    "currentTideState",
    "todayTidesDate",
    "todayLowTides",
    "todayHighTides",
    "harvestWindow",
    "harvestStartLabel",
    "harvestStartLow",
    "harvestLowestLow",
    "harvestEndLabel",
    "harvestEndLow",
    "moonPhaseSymbol",
    "moonPhase",
    "moonIllumination",
    "nextNewMoon",
    "nextFullMoon",
    "sunriseTime",
    "sunsetTime",
    "tideChart7d",
    "tideChartOverview",
    "overviewHarvestWindows",
    "lowTideList",
    "lowTideRangeLabel",
    "loadMoreLows",
    "harvestCalendar",
    "sourceDetails",
    "safetyDetails",
    "locationDetails",
    "lastUpdated",
    "connectivityStatus",
    "showOnMapButton",
    "offlineLocationStatus",
    "offlineSaveLocation",
    "offlineRemoveLocation"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.forecastRangeLabel = document.getElementById("forecastRangeLabel");
  els.overviewRangeLabel = document.getElementById("overviewRangeLabel");
  els.overviewChartSubhead = document.querySelector(".overview-chart-subhead");
  els.overviewChartFrame = document.querySelector(".overview-chart-frame");
  els.forecastRangeButtons = Array.from(document.querySelectorAll("[data-forecast-days]"));
  els.overviewRangeButtons = Array.from(document.querySelectorAll("[data-overview-months]"));
}

async function loadLocationRecords() {
  const farmResult = await loadPublicFarmLocations();

  if (Array.isArray(farmResult.locations) && farmResult.locations.length) {
    farmLocations = mainPageLocations(farmResult.locations);
  }

  tideLocations = farmLocations;
}

async function refreshLocationRecordsInPlace() {
  const preferredKey = requestedLocationKey();
  const selectedKey = preferredKey || state.location?.key || resolveInitialLocationKey();
  try {
    await loadLocationRecords();
    populateLocationSelect();

    const refreshedLocation = getLocation(selectedKey)
      || getLocation(APP_CONFIG.defaultLocationKey)
      || tideLocations[0];
    if (!refreshedLocation) return;

    if (refreshedLocation.key !== state.location?.key) {
      setLocation(refreshedLocation.key, { updateUrl: false });
      return;
    }

    state.location = refreshedLocation;
    state.profile = TIDE_PROFILES[refreshedLocation.tideProfileKey]
      || TIDE_PROFILES.kenya_mombasa_reference;
    loadThresholdState();
    syncThresholdControls();
    els.locationSelect.value = refreshedLocation.key;
    render();
  } catch (error) {
    console.warn("Location metadata refresh failed; keeping bundled locations.", error);
  }
}

function mainPageLocations(locations) {
  return locations
    .filter((location) => {
      return location?.locationType !== "tide_reference"
        && String(location?.status || "").toLowerCase() !== "reference_only";
    })
    .map((location) => ({
      ...location,
      tideProfileKey: "kenya_mombasa_reference",
      defaultTideDatasetId: location.defaultTideDatasetKey === MAIN_TIDE_DATASET_KEY
        ? location.defaultTideDatasetId || ""
        : "",
      defaultTideDatasetKey: MAIN_TIDE_DATASET_KEY
    }));
}

function populateLocationSelect() {
  tideLocations = farmLocations;

  els.locationSelect.innerHTML = tideLocations.map((location) => {
    return `<option value="${escapeHtml(location.key)}">${escapeHtml(translateDataText(location.name))}</option>`;
  }).join("");
}

function bindEvents() {
  els.locationSelect.addEventListener("change", () => {
    setLocation(els.locationSelect.value, { updateUrl: true });
  });

  els.thresholdEnabled.addEventListener("change", () => {
    state.thresholdEnabled = els.thresholdEnabled.checked;
    saveThresholdState();
    render();
  });

  els.thresholdInput.addEventListener("input", () => {
    state.thresholdM = clampThreshold(Number(els.thresholdInput.value));
    saveThresholdState();
    render();
  });

  els.thresholdDefault.addEventListener("click", () => {
    state.thresholdM = getDefaultThreshold(state.location, state.profile);
    state.thresholdEnabled = true;
    saveThresholdState();
    syncThresholdControls();
    render();
  });

  els.forecastRangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const days = Number(button.dataset.forecastDays);
      if (![3, 5, 7].includes(days) || days === state.forecastDays) return;

      state.forecastDays = days;
      state.forecastRangeUserSelected = true;
      syncForecastRangeControls();
      render();
    });
  });

  els.overviewRangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const months = Number(button.dataset.overviewMonths);
      if (![1, 3].includes(months) || months === state.overviewMonths) return;

      state.overviewMonths = months;
      state.overviewRangeUserSelected = true;
      syncOverviewRangeControls();
      render();
    });
  });

  els.loadMoreLows.addEventListener("click", () => {
    state.lowListDays += 14;
    renderLowTides();
  });

  els.offlineSaveLocation?.addEventListener("click", () => {
    void saveCurrentLocationOffline();
  });

  els.offlineRemoveLocation?.addEventListener("click", () => {
    void removeCurrentLocationOffline();
  });

  document.addEventListener("seaweed-language-change", () => {
    populateLocationSelect();
    if (state.location) {
      els.locationSelect.value = state.location.key;
      render();
      void refreshOfflineLocationStatus();
    }
  });

  window.addEventListener("online", () => {
    void refreshOfflineLocationStatus();
  });

  window.addEventListener("offline", () => {
    void refreshOfflineLocationStatus();
  });

  window.addEventListener("resize", debounce(() => {
    const previousForecastDays = state.forecastDays;
    const previousOverviewMonths = state.overviewMonths;
    applyResponsiveDefaults();

    if (previousForecastDays !== state.forecastDays || previousOverviewMonths !== state.overviewMonths) {
      render();
    } else if (state.lastForecast) {
      syncOverviewRangeControls();
      renderCharts(state.lastForecast);
      renderLowTides();
    }
  }, 150));
}

function resolveInitialLocationKey() {
  const requested = requestedLocationKey();
  const requestedLocation = getLocation(requested);
  if (requestedLocation) return requestedLocation.key;

  return APP_CONFIG.defaultLocationKey;
}

function requestedLocationKey() {
  const params = new URLSearchParams(window.location.search);
  const queryLocation = params.get("location");
  if (queryLocation) return queryLocation;

  const saved = readStorage(APP_CONFIG.storageKeys.selectedLocation);
  return saved || "";
}

function setLocation(locationKey, options = {}) {
  const location = getLocation(locationKey) || getLocation(APP_CONFIG.defaultLocationKey) || tideLocations[0];
  const profile = TIDE_PROFILES[location.tideProfileKey] || TIDE_PROFILES.kenya_mombasa_reference;

  state.location = location;
  state.profile = profile;
  state.runtimeBundle = null;
  state.runtimeTideData = null;
  state.offlineBundle = null;
  state.offlineTideData = null;
  state.tideDataStatus = "loading";
  state.lowListDays = 14;
  loadThresholdState();
  syncThresholdControls();

  els.locationSelect.value = location.key;
  if (options.persistSelection !== false) {
    writeStorage(APP_CONFIG.storageKeys.selectedLocation, location.key);
  }

  if (options.updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("location", location.key);
    window.history.replaceState({}, "", url);
  }

  render();
  void loadRuntimeTideData();
  void refreshOfflineLocationStatus();
}

async function loadRuntimeTideData() {
  if (!state.location || !state.profile) return;

  const sequence = ++tideDataLoadSequence;
  const locationKey = state.location.key;
  const datasetRef = state.location.defaultTideDatasetId || state.location.defaultTideDatasetKey || state.location.tideProfileKey;
  const datasetKey = state.location.defaultTideDatasetKey || state.location.tideProfileKey;
  const now = new Date();
  const fromDate = addDaysToDateKey(localDateKey(now, state.profile.timezone), -2);
  const toDate = addDaysToDateKey(localDateKey(now, state.profile.timezone), 110);

  try {
    if (navigator.onLine === false) {
      await loadRuntimeTideDataFromOffline(locationKey, sequence);
      return;
    }

    const bundle = await loadPublicTideDatasetBundle(datasetRef, {
      datasetId: state.location.defaultTideDatasetId,
      datasetKey: state.location.defaultTideDatasetKey,
      fromDate,
      toDate
    });
    const currentDatasetKey = state.location?.defaultTideDatasetKey || state.location?.tideProfileKey;
    if (sequence !== tideDataLoadSequence || currentDatasetKey !== datasetKey) return;

    const tideData = normalizeTideDataBundle(bundle, "supabase");
    if (tideData.hasData) {
      state.runtimeBundle = bundle;
      state.runtimeTideData = tideData;
      state.tideDataStatus = "supabase";
      render();
      return;
    }

    await loadRuntimeTideDataFromOffline(state.location?.key || locationKey, sequence);
  } catch (error) {
    console.warn("Runtime tide data load failed.", error);
    await loadRuntimeTideDataFromOffline(state.location?.key || locationKey, sequence);
  }
}

async function loadRuntimeTideDataFromOffline(locationKey, sequence) {
  if (!isOfflineStorageSupported()) {
    if (sequence === tideDataLoadSequence) {
      state.runtimeBundle = null;
      state.runtimeTideData = null;
      state.tideDataStatus = "prototype";
      render();
    }
    return;
  }

  try {
    const bundle = await getFarmLocationOfflineBundle(locationKey);
    if (sequence !== tideDataLoadSequence || state.location?.key !== locationKey) return;

    state.offlineBundle = bundle;
    state.offlineTideData = normalizeTideDataBundle(bundle, "offline");

    if (state.offlineTideData.hasData) {
      state.runtimeBundle = bundle;
      state.runtimeTideData = state.offlineTideData;
      state.tideDataStatus = "offline";
    } else {
      state.runtimeBundle = null;
      state.runtimeTideData = null;
      state.tideDataStatus = "prototype";
    }

    render();
  } catch (error) {
    console.warn("Offline tide data load failed.", error);
    if (sequence === tideDataLoadSequence) {
      state.runtimeBundle = null;
      state.runtimeTideData = null;
      state.tideDataStatus = "prototype";
      render();
    }
  }
}

function render() {
  if (!state.location || !state.profile) return;

  renderClock();
  renderConnectivityStatus();
  renderLocationSummary();
  syncThresholdControls();
  syncForecastRangeControls();
  syncOverviewRangeControls();

  const now = new Date();
  state.forecastRefreshKey = forecastRefreshKey(now);
  const forecastRange = rangeAroundNow(now, 1, 95);
  const fullCurve = tideCurveForRange(forecastRange, 30);
  const fullExtremes = tideExtremesForRange(forecastRange, fullCurve);
  const weekRange = rangeAroundNow(now, 0.15, state.forecastDays);
  const weekCurve = tideCurveForRange(weekRange, 20);
  const weekExtremes = tideExtremesForRange(weekRange, weekCurve);
  const overviewRange = rangeAroundNow(now, 1, state.overviewMonths === 1 ? 34 : 95);
  const overviewCurve = tideCurveForRange(overviewRange, 30);
  const overviewExtremes = tideExtremesForRange(overviewRange, overviewCurve);
  const moons = moonEvents(now, forecastRange.end);
  const springs = springWindows(now, forecastRange.end);

  state.lastForecast = {
    now,
    forecastRange,
    weekRange,
    overviewRange,
    fullCurve,
    fullExtremes,
    weekCurve,
    weekExtremes,
    overviewCurve,
    overviewExtremes,
    moons,
    springs,
    tideDataSource: activeTideData()
  };

  renderSummaryCards(state.lastForecast);
  renderMoon(now);
  renderCharts(state.lastForecast);
  renderLowTides();
  renderCalendar(state.lastForecast);
  renderSourceDetails();
  renderSafetyDetails();
}

function refreshForecastIfNeeded() {
  if (!state.location || !state.profile) return;

  const key = forecastRefreshKey(new Date());
  if (key === state.forecastRefreshKey) return;

  render();
}

function forecastRefreshKey(date) {
  return String(Math.floor(date.getTime() / FORECAST_AUTO_REFRESH_MS));
}

function activeTideData() {
  if (state.runtimeTideData?.hasData) return state.runtimeTideData;
  if (state.offlineTideData?.hasData) return state.offlineTideData;
  return null;
}

function tideCurveForRange(range, intervalMinutes = 30) {
  const data = activeTideData();
  const importedCurve = importedHourlyCurveForRange(data, range);
  if (importedCurve.length >= 2) return importedCurve;

  return tideCurve(state.profile, range.start, range.end, intervalMinutes);
}

function tideExtremesForRange(range, curve) {
  const data = activeTideData();
  const importedEvents = importedEventsForRange(data, range);
  if (importedEvents.length) return importedEvents;

  return tideExtremes(curve);
}

function importedHourlyCurveForRange(data, range) {
  if (!data?.hourlyPoints?.length) return [];

  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const points = data.hourlyPoints.filter((point) => point.timeMs >= startMs && point.timeMs <= endMs);
  const startHeight = interpolatedImportedHeight(range.start, data);
  const endHeight = interpolatedImportedHeight(range.end, data);
  const curve = [];

  if (Number.isFinite(startHeight)) {
    curve.push({ timeMs: startMs, date: new Date(startMs), heightM: startHeight });
  }

  curve.push(...points);

  if (Number.isFinite(endHeight) && endMs > startMs) {
    curve.push({ timeMs: endMs, date: new Date(endMs), heightM: endHeight });
  }

  return dedupeCurvePoints(curve).sort(sortByTime);
}

function importedEventsForRange(data, range) {
  if (!data?.events?.length) return [];

  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  return data.events.filter((event) => event.timeMs >= startMs && event.timeMs <= endMs);
}

function tideHeightForDate(date) {
  const importedHeight = interpolatedImportedHeight(date, activeTideData());
  return Number.isFinite(importedHeight) ? importedHeight : tideHeight(date, state.profile);
}

function interpolatedImportedHeight(date, data) {
  if (!data?.hourlyPoints?.length) return NaN;

  const timeMs = date.getTime();
  let previous = null;
  let next = null;

  for (const point of data.hourlyPoints) {
    if (point.timeMs === timeMs) return point.heightM;
    if (point.timeMs < timeMs) {
      previous = point;
      continue;
    }
    next = point;
    break;
  }

  if (!previous || !next) return NaN;

  const span = next.timeMs - previous.timeMs;
  if (span <= 0) return NaN;

  const ratio = (timeMs - previous.timeMs) / span;
  return previous.heightM + (next.heightM - previous.heightM) * ratio;
}

function dedupeCurvePoints(points) {
  const byTime = new Map();
  for (const point of points) {
    byTime.set(point.timeMs, point);
  }
  return Array.from(byTime.values());
}

function renderClock() {
  if (!state.profile) return;
  const now = new Date();
  const timezone = state.location?.timezone || state.profile.timezone;
  els.localClock.textContent = formatDateTime(now, timezone, getLocale());
}

function renderLocationSummary() {
  const { location, profile } = state;
  if (els.selectedLocationIcon) {
    els.selectedLocationIcon.textContent = locationSymbol(location);
  }
  if (els.selectedLocationName) {
    els.selectedLocationName.textContent = translateDataText(location.name);
  }
  if (els.showOnMapButton) {
    els.showOnMapButton.href = mapUrl(location);
  }

  els.locationMeta.textContent = [translateDataText(location.region), translateDataText(location.country)]
    .filter(Boolean)
    .join(", ");
  els.locationReferenceStation.textContent = t("details.referenceStation", { station: referenceStationLabel(profile) });
  const gps = location.gps
    ? `${location.gps.lat.toFixed(5)}, ${location.gps.lon.toFixed(5)}`
    : translateDataText(location.gpsLabel);

  els.locationDetails.innerHTML = `
    <span><strong>${escapeHtml(t("details.location"))}</strong> ${escapeHtml(translateDataText(location.name))}</span>
    <span><strong>${escapeHtml(t("details.gps"))}</strong> ${escapeHtml(gps || t("details.toBeConfirmed"))}</span>
    <span><strong>${escapeHtml(t("details.dataset"))}</strong> ${escapeHtml(activeDatasetName())}</span>
  `;

}

function locationSymbol(location) {
  return location?.locationType === "lodge" ? SYMBOLS.lodge : SYMBOLS.plant;
}

function mapUrl(location) {
  return `./map.html?v=20260725-location-cleanup&location=${encodeURIComponent(location.key)}`;
}

function referenceStationLabel(profile) {
  return translateDataText(String(profile?.name || t("details.referenceStationFallback"))).replace(/\s+Reference$/i, "");
}

function activeDatasetName() {
  const data = activeTideData();
  if (data?.dataset?.dataset_name) return translateDataText(data.dataset.dataset_name);
  if (state.tideDataStatus === "loading") return t("data.loadingTideData");
  return translateDataText(state.profile.version);
}

function renderSummaryCards(forecast) {
  const nextHarvest = findNextHarvestEligibleLow(forecast.fullExtremes, forecast.now);

  renderTodayTides(forecast);

  if (nextHarvest) {
    renderHarvestSummary(nextHarvest, forecast);
  } else if (!state.thresholdEnabled) {
    resetHarvestSummary(t("summary.harvestThresholdHidden"));
  } else {
    resetHarvestSummary(t("summary.noHarvestWindow"));
  }

  if (els.lastUpdated) {
    els.lastUpdated.textContent = t("lastUpdated.time", {
      time: formatTime(forecast.now, state.profile.timezone, getLocale())
    });
  }
}

function renderConnectivityStatus() {
  if (!els.connectivityStatus) return;
  const isOnline = navigator.onLine !== false;
  els.connectivityStatus.textContent = isOnline ? t("status.online") : t("status.offline");
  els.connectivityStatus.dataset.status = isOnline ? "verified" : "pending_verification";
}

async function refreshOfflineLocationStatus() {
  renderConnectivityStatus();
  if (!els.offlineLocationStatus || !els.offlineSaveLocation || !els.offlineRemoveLocation) return;

  if (!isOfflineStorageSupported()) {
    els.offlineLocationStatus.textContent = t("offline.storageUnavailable");
    els.offlineLocationStatus.dataset.status = "error";
    els.offlineSaveLocation.disabled = true;
    els.offlineRemoveLocation.hidden = true;
    return;
  }

  if (!state.location) {
    els.offlineLocationStatus.textContent = t("offline.selectLocation");
    els.offlineLocationStatus.dataset.status = "muted";
    els.offlineSaveLocation.disabled = true;
    els.offlineRemoveLocation.hidden = true;
    return;
  }

  els.offlineSaveLocation.disabled = false;
  els.offlineLocationStatus.textContent = navigator.onLine === false
    ? t("offline.notAvailableOffline")
    : t("offline.notAvailable");
  els.offlineLocationStatus.dataset.status = navigator.onLine === false ? "error" : "muted";
  els.offlineSaveLocation.textContent = t("offline.make");
  els.offlineRemoveLocation.hidden = true;

  try {
    const bundle = await getFarmLocationOfflineBundle(state.location.key);
    state.offlineBundle = bundle;
    state.offlineTideData = normalizeTideDataBundle(bundle, "offline");

    if (bundle) {
      els.offlineLocationStatus.textContent = formatOfflineBundleStatus(bundle);
      els.offlineLocationStatus.dataset.status = state.offlineTideData.hasData ? "ready" : "error";
      els.offlineSaveLocation.textContent = t("offline.update");
      els.offlineRemoveLocation.hidden = false;
      return;
    }

  } catch (error) {
    console.warn("Offline status read failed.", error);
    els.offlineLocationStatus.textContent = t("offline.statusUnavailable");
    els.offlineLocationStatus.dataset.status = "error";
    els.offlineRemoveLocation.hidden = true;
  }
}

async function saveCurrentLocationOffline() {
  if (!state.location || !state.profile) return;

  setOfflineButtonsDisabled(true);
  els.offlineLocationStatus.textContent = t("offline.downloading");
  els.offlineLocationStatus.dataset.status = "loading";

  try {
    const savedBundle = await saveFarmLocationOfflineBundle(await buildCurrentOfflineBundle());
    state.offlineBundle = savedBundle;
    state.offlineTideData = normalizeTideDataBundle(savedBundle, "offline");
    if (state.offlineTideData.hasData) {
      state.runtimeBundle = savedBundle;
      state.runtimeTideData = state.offlineTideData;
      state.tideDataStatus = "offline";
      render();
    }
    await refreshOfflineLocationStatus();
  } catch (error) {
    console.warn("Offline save failed.", error);
    els.offlineLocationStatus.textContent = t("offline.saveFailed");
    els.offlineLocationStatus.dataset.status = "error";
  } finally {
    setOfflineButtonsDisabled(false);
  }
}

async function removeCurrentLocationOffline() {
  if (!state.location) return;

  setOfflineButtonsDisabled(true);
  els.offlineLocationStatus.textContent = t("offline.removing");
  els.offlineLocationStatus.dataset.status = "loading";

  try {
    await removeFarmLocationOfflineBundle(state.location.key);
    state.offlineBundle = null;
    await refreshOfflineLocationStatus();
  } catch (error) {
    console.warn("Offline remove failed.", error);
    els.offlineLocationStatus.textContent = t("offline.removeFailed");
    els.offlineLocationStatus.dataset.status = "error";
  } finally {
    setOfflineButtonsDisabled(false);
  }
}

function setOfflineButtonsDisabled(disabled) {
  if (els.offlineSaveLocation) els.offlineSaveLocation.disabled = disabled;
  if (els.offlineRemoveLocation) els.offlineRemoveLocation.disabled = disabled;
}

async function buildCurrentOfflineBundle() {
  const now = new Date();
  const validFrom = localDateKey(now, state.profile.timezone);
  const validTo = addMonthsToDateKey(validFrom, 3);
  const dataStatus = getDataStatus();
  const datasetId = state.location.defaultTideDatasetId || "";
  const datasetKey = state.location.defaultTideDatasetKey || state.location.tideProfileKey;
  const datasetBundle = await loadPublicTideDatasetBundle(datasetId || datasetKey, {
    datasetId,
    datasetKey,
    fromDate: validFrom,
    toDate: validTo
  });

  return {
    locationKey: state.location.key,
    locationName: state.location.name,
    datasetId,
    datasetKey,
    profileKey: state.location.tideProfileKey,
    validFrom,
    validTo,
    timezone: state.profile.timezone,
    location: {
      key: state.location.key,
      name: state.location.name,
      shortName: state.location.shortName,
      region: state.location.region,
      country: state.location.country,
      gps: state.location.gps,
      gpsLabel: state.location.gpsLabel,
      status: state.location.status,
      notes: state.location.notes
    },
    tideProfile: state.profile,
    source: {
      backendContext: dataStatus.backendContext,
      dataMode: dataStatus.mode,
      supabaseProjectRef: dataStatus.supabaseProjectRef,
      profileSourceName: state.profile.sourceName,
      profileSourceUrl: state.profile.sourceUrl,
      verificationStatus: state.profile.verificationStatus,
      verificationLabel: state.profile.verificationLabel,
      datumLabel: state.profile.datumLabel,
      version: state.profile.version
    },
    threshold: {
      currentM: state.thresholdM,
      enabled: state.thresholdEnabled,
      defaultM: getDefaultThreshold(state.location, state.profile)
    },
    dataset: datasetBundle.dataset,
    tideEvents: datasetBundle.tideEvents,
    hourlyPredictions: datasetBundle.hourlyPredictions,
    warningText: datasetBundle.dataset?.warning_text || state.profile.warningText,
    warning: datasetBundle.warning,
    note: datasetBundle.warning
      ? t("offline.partialNote")
      : t("offline.completeNote")
  };
}

function formatOfflineBundleStatus(bundle) {
  const eventCount = Array.isArray(bundle.tideEvents) ? bundle.tideEvents.length : 0;
  const hourlyCount = Array.isArray(bundle.hourlyPredictions) ? bundle.hourlyPredictions.length : 0;
  const hasData = eventCount > 0 || hourlyCount > 1;
  return t(hasData ? "offline.available" : "offline.availablePartial");
}

function normalizeTideDataBundle(bundle, sourceType) {
  const hourlyPoints = Array.isArray(bundle?.hourlyPredictions)
    ? bundle.hourlyPredictions.map(normalizeHourlyPrediction).filter(Boolean).sort(sortByTime)
    : [];
  const events = Array.isArray(bundle?.tideEvents)
    ? bundle.tideEvents.map(normalizeTideEvent).filter(Boolean).sort(sortByTime)
    : [];

  return {
    sourceType,
    dataset: bundle?.dataset || null,
    hourlyPoints,
    events,
    hasData: hourlyPoints.length > 1 || events.length > 0,
    savedAt: bundle?.savedAt || ""
  };
}

function normalizeHourlyPrediction(row) {
  const date = parsePredictionDate(row.prediction_time_utc);
  const heightM = Number(row.height_m);
  if (!date || !Number.isFinite(heightM)) return null;

  return {
    timeMs: date.getTime(),
    date,
    heightM,
    sourceRow: row
  };
}

function normalizeTideEvent(row) {
  const date = parsePredictionDate(row.event_time_utc);
  const heightM = Number(row.height_m);
  const type = normalizeEventType(row.event_type);
  if (!date || !Number.isFinite(heightM) || !type) return null;

  return {
    type,
    timeMs: date.getTime(),
    date,
    heightM,
    sourceRow: row
  };
}

function parsePredictionDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeEventType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("h")) return "high";
  if (text.startsWith("l")) return "low";
  return "";
}

function sortByTime(a, b) {
  return a.timeMs - b.timeMs;
}

function renderTodayTides(forecast) {
  const todayKey = localDateKey(forecast.now, state.profile.timezone);
  const dayRange = localDayRange(todayKey, state.profile.timezone);
  const dayCurve = tideCurveForRange(dayRange, 10);
  const dayExtremes = tideExtremesForRange(dayRange, dayCurve);
  const currentHeight = tideHeightForDate(forecast.now);
  const nextHeight = tideHeightForDate(new Date(forecast.now.getTime() + 10 * 60000));
  const trend = tideTrendLabel(currentHeight, nextHeight);
  const lows = dayExtremes.filter((extreme) => extreme.type === "low").sort((a, b) => a.timeMs - b.timeMs);
  const highs = dayExtremes.filter((extreme) => extreme.type === "high").sort((a, b) => a.timeMs - b.timeMs);

  els.todayTidesDate.textContent = `(${formatDate(forecast.now, state.profile.timezone, getLocale())})`;
  els.currentTideState.textContent =
    t("summary.currentTideState", {
      symbol: tideTrendSymbol(trend),
      trend: t(`trend.${trend}`),
      height: formatMetres(currentHeight),
      time: formatTime(forecast.now, state.profile.timezone, getLocale())
    });
  els.todayLowTides.textContent = lows.length ? lows.map(formatEventTimeHeight).join("   ") : "--";
  els.todayHighTides.textContent = highs.length ? highs.map(formatEventTimeHeight).join("   ") : "--";
}

function tideTrendLabel(currentHeight, nextHeight) {
  const delta = nextHeight - currentHeight;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.005) return "slack";
  return delta > 0 ? "flooding" : "ebbing";
}

function tideTrendSymbol(trend) {
  return TREND_SYMBOLS[trend] || "";
}

function renderHarvestSummary(nextHarvest, forecast) {
  const harvestWindow = nextHarvestWindow(forecast, nextHarvest);
  if (!harvestWindow) {
    resetHarvestSummary(t("summary.noHarvestWindow"));
    return;
  }

  const startLow = lowestLowForLocalDay(harvestWindow.start);
  const endLow = lowestLowForLocalDay(harvestWindow.end);
  const lowestLow = lowestEligibleLowBetween(harvestWindow.start, harvestWindow.end);

  els.harvestWindow.textContent =
    `${formatDate(harvestWindow.start, state.profile.timezone, getLocale())} - ${formatDate(harvestWindow.end, state.profile.timezone, getLocale())}`;
  els.harvestStartLabel.textContent = t("summary.lowTideDate", { date: formatDayMonth(harvestWindow.start) });
  els.harvestStartLow.textContent = startLow ? formatEventTimeHeight(startLow) : "--";
  els.harvestLowestLow.textContent = lowestLow
    ? `${formatMetres(lowestLow.heightM)} (${formatDayMonth(lowestLow.date)})`
    : "--";
  els.harvestEndLabel.textContent = t("summary.lowTideDate", { date: formatDayMonth(harvestWindow.end) });
  els.harvestEndLow.textContent = endLow ? formatEventTimeHeight(endLow) : "--";
}

function resetHarvestSummary(message) {
  els.harvestWindow.textContent = message;
  els.harvestStartLabel.textContent = t("summary.lowTide");
  els.harvestStartLow.textContent = "--";
  els.harvestLowestLow.textContent = "--";
  els.harvestEndLabel.textContent = t("summary.lowTide");
  els.harvestEndLow.textContent = "--";
}

function findNextHarvestEligibleLow(extremes, now) {
  if (!state.thresholdEnabled) return null;

  const nowMs = now.getTime();
  return extremes.find((extreme) => {
    return extreme.timeMs >= nowMs && isHarvestEligibleLow(extreme);
  }) || null;
}

function nextHarvestWindow(forecast, nextHarvest) {
  const ranges = buildHarvestDayRanges(
    forecast.now,
    forecast.forecastRange.end,
    state.profile,
    state.thresholdM,
    state.thresholdEnabled
  );
  const windows = groupAdjacentRanges(ranges, 86400000 * 1.1);
  const harvestTime = nextHarvest.timeMs;

  return (
    windows.find((window) => harvestTime >= window.start.getTime() && harvestTime <= window.end.getTime()) ||
    windows.find((window) => window.end.getTime() >= forecast.now.getTime()) ||
    null
  );
}

function groupAdjacentRanges(ranges, gapMs) {
  return ranges
    .slice()
    .sort((a, b) => a.start - b.start)
    .reduce((groups, range) => {
      const previous = groups[groups.length - 1];
      if (previous && range.start.getTime() - previous.end.getTime() <= gapMs) {
        previous.end = new Date(Math.max(previous.end.getTime(), range.end.getTime()));
      } else {
        groups.push({ start: new Date(range.start), end: new Date(range.end) });
      }
      return groups;
    }, []);
}

function localDayRange(dateKey, timeZone) {
  const start = zonedDateKeyToDate(dateKey, timeZone);
  const end = new Date(zonedDateKeyToDate(addDaysToDateKey(dateKey, 1), timeZone).getTime() - 60000);
  return { start, end };
}

function lowestLowForLocalDay(date) {
  const dayRange = localDayRange(localDateKey(date, state.profile.timezone), state.profile.timezone);
  return lowestEligibleLowBetween(dayRange.start, dayRange.end);
}

function lowestEligibleLowBetween(startDate, endDate) {
  const range = { start: startDate, end: endDate };
  const curve = tideCurveForRange(range, 10);
  const lows = tideExtremesForRange(range, curve).filter((low) => isHarvestEligibleLow(low));
  if (!lows.length) return null;
  return lows.reduce((lowest, low) => (low.heightM < lowest.heightM ? low : lowest), lows[0]);
}

function formatEventTimeHeight(extreme) {
  return `${formatTime(extreme.date, state.profile.timezone, getLocale())} (${formatMetres(extreme.heightM)})`;
}

function formatDayMonth(date) {
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: state.profile.timezone,
    day: "numeric",
    month: "long"
  }).format(date);
}

function formatDayMonthShort(date) {
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: state.profile.timezone,
    day: "numeric",
    month: "short"
  }).format(date);
}

function renderMoon(now) {
  const phase = moonPhase(now);
  const nextNew = nextMoonEvent(now, 0);
  const nextFull = nextMoonEvent(now, 0.5);

  els.moonPhaseSymbol.textContent = moonPhaseSymbol(phase);
  els.moonPhase.textContent = t(`moonPhase.${moonPhaseName(phase)}`);
  els.moonIllumination.textContent = t("moon.illuminated", { percent: formatPercent(moonIllumination(phase)) });
  els.nextNewMoon.textContent = formatDateTime(nextNew, state.profile.timezone, getLocale());
  els.nextFullMoon.textContent = formatDateTime(nextFull, state.profile.timezone, getLocale());
  renderSolarTimes(now);
}

function moonPhaseSymbol(phase) {
  const normalized = ((phase % 1) + 1) % 1;
  const index = Math.round(normalized * MOON_PHASE_SYMBOLS.length) % MOON_PHASE_SYMBOLS.length;
  return MOON_PHASE_SYMBOLS[index];
}

function renderSolarTimes(now) {
  const coordinates = solarCoordinatesForSelection();

  if (!coordinates) {
    els.sunriseTime.textContent = "--";
    els.sunsetTime.textContent = "--";
    return;
  }

  const times = solarTimes(now, coordinates.lat, coordinates.lon, state.profile.timezone);
  els.sunriseTime.textContent = times.sunrise ? formatTime(times.sunrise, state.profile.timezone, getLocale()) : "--";
  els.sunsetTime.textContent = times.sunset ? formatTime(times.sunset, state.profile.timezone, getLocale()) : "--";
}

function solarCoordinatesForSelection() {
  if (hasCoordinates(state.location?.gps)) return state.location.gps;

  const reference = PROFILE_REFERENCE_COORDINATES[state.profile?.key];
  if (hasCoordinates(reference)) return reference;

  return null;
}

function hasCoordinates(coordinates) {
  return (
    coordinates &&
    Number.isFinite(coordinates.lat) &&
    Number.isFinite(coordinates.lon)
  );
}

function solarTimes(date, latitude, longitude, timeZone) {
  const dateKey = localDateKey(date, timeZone);
  const [year, month, day] = dateKey.split("-").map(Number);
  const dayOfYear = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000
  );

  return {
    sunrise: solarEventUtcDate(year, month, day, dayOfYear, latitude, longitude, true),
    sunset: solarEventUtcDate(year, month, day, dayOfYear, latitude, longitude, false)
  };
}

function buildNightBandsForRange(startDate, endDate, timeZone, coordinates) {
  const bands = [];
  const zone = timeZone || "UTC";
  let dateKey = localDateKey(startDate, zone);
  const endKey = localDateKey(endDate, zone);

  while (dateKey <= endKey) {
    const dayStart = zonedDateKeyToDate(dateKey, zone);
    const nextDateKey = addDaysToDateKey(dateKey, 1);
    const nextDayStart = zonedDateKeyToDate(nextDateKey, zone);
    const solar = coordinates
      ? solarTimes(new Date(dayStart.getTime() + 12 * 3600000), coordinates.lat, coordinates.lon, zone)
      : null;
    const fallback = fallbackSolarTimes(dateKey, zone);
    const sunrise = solar?.sunrise || fallback.sunrise;
    const sunset = solar?.sunset || fallback.sunset;

    addClippedNightBand(bands, dayStart, sunrise, startDate, endDate);
    addClippedNightBand(bands, sunset, nextDayStart, startDate, endDate);
    dateKey = nextDateKey;
  }

  return bands;
}

function fallbackSolarTimes(dateKey, timeZone) {
  return {
    sunrise: zonedDateKeyToDate(dateKey, timeZone, 6, 15),
    sunset: zonedDateKeyToDate(dateKey, timeZone, 18, 30)
  };
}

function addClippedNightBand(bands, start, end, rangeStart, rangeEnd) {
  if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return;
  }

  const clippedStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
  const clippedEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));
  if (clippedEnd.getTime() > clippedStart.getTime()) {
    bands.push({ start: clippedStart, end: clippedEnd });
  }
}

function solarEventUtcDate(year, month, day, dayOfYear, latitude, longitude, isSunrise) {
  const longitudeHour = longitude / 15;
  const approximateTime = dayOfYear + ((isSunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
    (1.916 * degSin(meanAnomaly)) +
    (0.020 * degSin(2 * meanAnomaly)) +
    282.634
  );

  let rightAscension = normalizeDegrees(radToDeg(
    Math.atan(0.91764 * Math.tan(degToRad(trueLongitude)))
  ));
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * degSin(trueLongitude);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    degCos(SOLAR_ZENITH_DEG) -
    (sinDeclination * degSin(latitude))
  ) / (cosDeclination * degCos(latitude));

  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = (isSunrise
    ? 360 - radToDeg(Math.acos(cosHourAngle))
    : radToDeg(Math.acos(cosHourAngle))) / 15;
  const localMeanTime = hourAngle + rightAscension - (0.06571 * approximateTime) - 6.622;
  const utcHours = normalizeDayHours(localMeanTime - longitudeHour);

  return new Date(Date.UTC(year, month - 1, day) + Math.round(utcHours * 3600000));
}

function normalizeDayHours(hours) {
  return ((hours % 24) + 24) % 24;
}

function degToRad(degrees) {
  return degrees * Math.PI / 180;
}

function radToDeg(radians) {
  return radians * 180 / Math.PI;
}

function degSin(degrees) {
  return Math.sin(degToRad(degrees));
}

function degCos(degrees) {
  return Math.cos(degToRad(degrees));
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function renderCharts(forecast) {
  const mobile = isMobileView();
  const weekHarvestWindows = buildHarvestDayRanges(
    forecast.weekRange.start,
    forecast.weekRange.end,
    state.profile,
    state.thresholdM,
    state.thresholdEnabled
  );
  const overviewHarvestWindows = buildHarvestDayRanges(
    forecast.overviewRange.start,
    forecast.overviewRange.end,
    state.profile,
    state.thresholdM,
    state.thresholdEnabled
  );
  const groupedOverviewHarvestWindows = groupAdjacentRanges(overviewHarvestWindows, 86400000 * 1.1);
  const solarCoordinates = solarCoordinatesForSelection();
  const weekNightBands = buildNightBandsForRange(
    forecast.weekRange.start,
    forecast.weekRange.end,
    state.profile.timezone,
    solarCoordinates
  );
  const overviewNightBands = mobile
    ? []
    : buildNightBandsForRange(
      forecast.overviewRange.start,
      forecast.overviewRange.end,
      state.profile.timezone,
      solarCoordinates
    );

  renderOverviewHarvestWindowSummary(groupedOverviewHarvestWindows);

  renderTideChart(els.tideChart7d, forecast.weekCurve, forecast.weekExtremes, {
    timeZone: state.profile.timezone,
    locale: getLocale(),
    thresholdEnabled: state.thresholdEnabled,
    thresholdM: state.thresholdM,
    now: forecast.now,
    leftPadding: mobile ? 36 : 96,
    rightPadding: mobile ? 6 : 16,
    compact: mobile,
    legendSpace: !mobile,
    showExtremes: true,
    showExtremeLabels: !mobile,
    extremeMarkerSize: mobile ? 3.8 : 5,
    extremeHitRadius: mobile ? 18 : 12,
    showThresholdLabel: !mobile,
    topPadding: mobile ? 14 : undefined,
    axisLabelSize: mobile ? 9 : 11,
    tickLabelSize: mobile ? 9 : 10,
    timeGrid: "half-day",
    thresholdShadeMode: "harvest-windows",
    harvestWindows: weekHarvestWindows,
    harvestWindowTopColor: "transparent",
    harvestWindowBottomColor: "rgba(22, 163, 74, 0.16)",
    nightBands: weekNightBands,
    nightBandColor: "rgba(15, 23, 42, 0.055)",
    thresholdLabelPosition: "left-of-axis"
  });

  if (mobile) return;

  renderTideChart(els.tideChartOverview, forecast.overviewCurve, forecast.overviewExtremes, {
    timeZone: state.profile.timezone,
    locale: getLocale(),
    thresholdEnabled: state.thresholdEnabled,
    thresholdM: state.thresholdM,
    now: forecast.now,
    compact: true,
    timeGrid: "month",
    monthBanding: false,
    topPadding: mobile ? 18 : 34,
    leftPadding: mobile ? 44 : 96,
    showExtremes: false,
    showThresholdLabel: !mobile,
    axisLabelSize: mobile ? 9 : 11,
    tickLabelSize: mobile ? 9 : 10,
    thresholdShadeMode: "harvest-windows",
    harvestWindows: groupedOverviewHarvestWindows,
    harvestWindowTopColor: "transparent",
    harvestWindowBottomColor: "rgba(22, 163, 74, 0.14)",
    nightBands: overviewNightBands,
    nightBandColor: "rgba(15, 23, 42, 0.035)",
    harvestWindowLabel: mobile ? "" : formatChartHarvestWindowLabel,
    harvestWindowLabelMinWidth: 54,
    harvestWindowLabelPosition: "above-plot",
    harvestWindowLabelOffset: 13,
    thresholdLabelPosition: "left-of-axis"
  });
}

function renderOverviewHarvestWindowSummary(windows) {
  if (!els.overviewHarvestWindows) return;

  if (!state.thresholdEnabled) {
    els.overviewHarvestWindows.innerHTML = `<span>${escapeHtml(t("harvest.thresholdHiddenSentence"))}</span>`;
    return;
  }

  if (!windows.length) {
    els.overviewHarvestWindows.innerHTML = `<span>${escapeHtml(t("harvest.noWindowsInRange", { months: state.overviewMonths }))}</span>`;
    return;
  }

  els.overviewHarvestWindows.innerHTML = `
    <strong>${escapeHtml(t("harvest.windows"))}</strong>
    ${windows.map((window) => `<span class="harvest-window-chip">${escapeHtml(formatHarvestWindowRange(window))}</span>`).join("")}
  `;
}

function formatChartHarvestWindowLabel(window) {
  const start = new Date(Number(window.start));
  const end = new Date(Number(window.end));
  return formatHarvestWindowRange({ start, end });
}

function formatHarvestWindowRange(window) {
  const start = window.start instanceof Date ? window.start : new Date(Number(window.start));
  const end = window.end instanceof Date ? window.end : new Date(Number(window.end));
  const startKey = localDateKey(start, state.profile.timezone);
  const endKey = localDateKey(end, state.profile.timezone);
  const sameMonth = startKey.slice(0, 7) === endKey.slice(0, 7);

  if (startKey === endKey) {
    return formatDayMonthShort(start);
  }

  if (sameMonth) {
    return `${Number(startKey.slice(8, 10))}-${formatDayMonthShort(end)}`;
  }

  return `${formatDayMonthShort(start)}-${formatDayMonthShort(end)}`;
}

function buildHarvestDayRanges(startDate, endDate, profile, thresholdM, enabled) {
  if (!enabled || !profile || !Number.isFinite(thresholdM)) return [];

  const ranges = [];
  let dateKey = localDateKey(startDate, profile.timezone);
  const endKey = localDateKey(endDate, profile.timezone);

  while (dateKey <= endKey) {
    const dayStart = zonedDateKeyToDate(dateKey, profile.timezone);
    const nextDateKey = addDaysToDateKey(dateKey, 1);
    const dayEnd = new Date(zonedDateKeyToDate(nextDateKey, profile.timezone).getTime() - 60000);
    const dayRange = { start: dayStart, end: dayEnd };
    const curve = tideCurveForRange(dayRange, 30);
    const lows = tideExtremesForRange(dayRange, curve).filter((extreme) => extreme.type === "low");
    const eligibleLows = lows.filter((low) => isHarvestEligibleLow(low, thresholdM, enabled));

    if (eligibleLows.length) {
      ranges.push({ start: dayStart, end: dayEnd });
    }

    dateKey = nextDateKey;
  }

  return ranges;
}

function zonedDateKeyToDate(dateKey, timeZone, hour = 0, minute = 0, second = 0) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMs = Date.UTC(year, month - 1, day, hour, minute, second);
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

function renderLowTides() {
  const forecast = state.lastForecast;
  if (!forecast) return;

  const endMs = forecast.now.getTime() + state.lowListDays * 86400000;
  const upcomingLows = forecast.fullExtremes.filter((extreme) => {
    return extreme.type === "low" && extreme.timeMs >= forecast.now.getTime() && extreme.timeMs <= endMs;
  });
  const dailyRows = buildDailyTideRows(forecast.now, state.lowListDays);
  const dailyLows = dailyRows.map((row) => row.lowestLow).filter(Boolean);
  const moonByDay = moonMapByLocalDay(forecast.moons);
  const springLowDays = springLowDaySet(dailyLows, forecast.springs);

  els.lowTideRangeLabel.textContent = t("table.nextDays", { days: state.lowListDays });
  if (els.loadMoreLows) {
    els.loadMoreLows.textContent = t("table.loadMore", { days: 14 });
  }

  if (!dailyRows.length || !upcomingLows.length) {
    els.lowTideList.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(t("table.empty"))}</td></tr>`;
    return;
  }

  const rowsWithEligibility = dailyRows.map((row) => ({
    ...row,
    eligibleLowKeys: harvestEligibleLowKeySet(row)
  }));
  const tableHarvestWindows = buildHarvestWindowsFromDateKeys(
    rowsWithEligibility
      .filter((row) => row.eligibleLowKeys.size > 0)
      .map((row) => row.dateKey)
  );

  els.lowTideList.innerHTML = rowsWithEligibility.map((row) => {
    const isHarvest = row.eligibleLowKeys.size > 0;
    const isSpringLow = isHarvest && springLowDays.has(row.dateKey);
    const moon = moonByDay.get(row.dateKey);
    const windowInfo = harvestWindowInfoForDate(row.dateKey, tableHarvestWindows);
    const status = renderLowTideStatus(isHarvest, isSpringLow, moon, windowInfo);
    const rowClass = isHarvest ? "harvest-row" : "";

    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(formatDate(row.date, state.profile.timezone, getLocale()))}</td>
        <td class="high-tide-cell">${formatTidePeriodCell(row.highMorning, "high")}</td>
        <td class="high-tide-cell">${formatTidePeriodCell(row.highAfternoon, "high")}</td>
        <td class="low-tide-cell">${formatTidePeriodCell(row.lowMorning, "low", row.eligibleLowKeys)}</td>
        <td class="low-tide-cell">${formatTidePeriodCell(row.lowAfternoon, "low", row.eligibleLowKeys)}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join("");
}

function buildDailyTideRows(startDate, dayCount) {
  const startKey = localDateKey(startDate, state.profile.timezone);
  const rows = [];

  for (let offset = 0; offset < dayCount; offset += 1) {
    const dateKey = addDaysToDateKey(startKey, offset);
    const dayRange = localDayRange(dateKey, state.profile.timezone);
    const dayCurve = tideCurveForRange(dayRange, 10);
    const extremes = tideExtremesForRange(dayRange, dayCurve).sort((a, b) => a.timeMs - b.timeMs);
    const highs = extremes.filter((extreme) => extreme.type === "high").slice(0, 2);
    const lows = extremes.filter((extreme) => extreme.type === "low").slice(0, 2);
    const highMorning = highs.filter(isMorningTideEvent);
    const highAfternoon = highs.filter((extreme) => !isMorningTideEvent(extreme));
    const lowMorning = lows.filter(isMorningTideEvent);
    const lowAfternoon = lows.filter((extreme) => !isMorningTideEvent(extreme));
    const lowestLow = lows.reduce((lowest, low) => {
      return !lowest || low.heightM < lowest.heightM ? low : lowest;
    }, null);

    rows.push({
      dateKey,
      date: dateKeyToUtcDate(dateKey),
      highs,
      lows,
      highMorning,
      highAfternoon,
      lowMorning,
      lowAfternoon,
      lowestLow
    });
  }

  return rows;
}

function isMorningTideEvent(extreme) {
  return zonedParts(extreme.date, state.profile.timezone).hour < 12;
}

function isDaylightTideEvent(extreme) {
  if (!extreme?.date) return false;

  const coordinates = solarCoordinatesForSelection();
  const zone = state.profile.timezone;
  const dateKey = localDateKey(extreme.date, zone);
  const solar = coordinates
    ? solarTimes(extreme.date, coordinates.lat, coordinates.lon, zone)
    : null;
  const fallback = fallbackSolarTimes(dateKey, zone);
  const sunrise = solar?.sunrise || fallback.sunrise;
  const sunset = solar?.sunset || fallback.sunset;
  const sunriseGraceStart = new Date(sunrise.getTime() - LOW_TIDE_SUNRISE_GRACE_MS);

  return extreme.date >= sunriseGraceStart && extreme.date <= sunset;
}

function isBelowHarvestThreshold(extreme, thresholdM = state.thresholdM, enabled = state.thresholdEnabled) {
  return Boolean(
    enabled &&
    extreme?.type === "low" &&
    Number.isFinite(extreme.heightM) &&
    extreme.heightM <= thresholdM
  );
}

function isHarvestEligibleLow(extreme, thresholdM = state.thresholdM, enabled = state.thresholdEnabled) {
  return isBelowHarvestThreshold(extreme, thresholdM, enabled) && isDaylightTideEvent(extreme);
}

function harvestEligibleLowKeySet(row) {
  return new Set(
    row.lows
      .filter((low) => isHarvestEligibleLow(low))
      .map(tideEventKey)
  );
}

function tideEventKey(extreme) {
  return `${extreme?.type || ""}:${Math.round(extreme?.timeMs || 0)}:${Number(extreme?.heightM || 0).toFixed(3)}`;
}

function formatTidePeriodCell(extremes, tideType, eligibleLowKeys = null) {
  if (!extremes?.length) return `<span class="muted-cell">--</span>`;
  return extremes.map((extreme) => formatTideTableCell(extreme, tideType, eligibleLowKeys)).join("<br>");
}

function formatTideTableCell(extreme, tideType, eligibleLowKeys = null) {
  if (!extreme) return `<span class="muted-cell">--</span>`;

  const classes = ["tide-event-cell"];
  if (tideType === "high") classes.push("high-tide-event");
  if (tideType === "low") {
    const isBelowThreshold = isBelowHarvestThreshold(extreme);
    const isEligibleLow = eligibleLowKeys
      ? eligibleLowKeys.has(tideEventKey(extreme))
      : isHarvestEligibleLow(extreme);
    classes.push("low-tide-event");
    if (isBelowThreshold) classes.push("low-tide-threshold");
    if (isEligibleLow) {
      classes.push("low-tide-daylight");
    } else if (isBelowThreshold) {
      classes.push("low-tide-night");
    }
  }

  return `<span class="${classes.join(" ")}"><span class="tide-event-time">${escapeHtml(formatTime(extreme.date, state.profile.timezone, getLocale()))}</span> <span class="tide-event-height">(${escapeHtml(formatCompactMetres(extreme.heightM))})</span></span>`;
}

function formatCompactMetres(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}m`;
}

function moonMapByLocalDay(moons) {
  const map = new Map();

  for (const moon of moons) {
    map.set(localDateKey(moon.date, state.profile.timezone), moon);
  }

  return map;
}

function springLowDaySet(dailyLows, windows) {
  const days = new Set();

  for (const window of windows) {
    const lowsInWindow = dailyLows.filter((low) => {
      return low.timeMs >= window.start.getTime() && low.timeMs <= window.end.getTime();
    });
    if (!lowsInWindow.length) continue;

    const lowest = lowsInWindow.reduce((best, low) => {
      return low.heightM < best.heightM ? low : best;
    }, lowsInWindow[0]);
    days.add(localDateKey(lowest.date, state.profile.timezone));
  }

  return days;
}

function harvestWindowInfoForDate(dateKey, windows) {
  for (const window of windows) {
    const startKey = window.startKey || localDateKey(window.start, state.profile.timezone);
    const endKey = window.endKey || localDateKey(window.end, state.profile.timezone);
    if (dateKey < startKey || dateKey > endKey) continue;

    const sameDay = startKey === endKey;
    const role = sameDay ? "single" : dateKey === startKey ? "start" : dateKey === endKey ? "end" : "middle";
    return {
      role,
      label: formatHarvestWindowRange(window)
    };
  }

  return null;
}

function buildHarvestWindowsFromDateKeys(dateKeys) {
  const sortedKeys = [...new Set(dateKeys)].sort();
  const windows = [];

  for (const dateKey of sortedKeys) {
    const previous = windows[windows.length - 1];
    if (previous && addDaysToDateKey(previous.endKey, 1) === dateKey) {
      previous.endKey = dateKey;
      previous.end = new Date(zonedDateKeyToDate(addDaysToDateKey(dateKey, 1), state.profile.timezone).getTime() - 60000);
      continue;
    }

    windows.push({
      startKey: dateKey,
      endKey: dateKey,
      start: zonedDateKeyToDate(dateKey, state.profile.timezone),
      end: new Date(zonedDateKeyToDate(addDaysToDateKey(dateKey, 1), state.profile.timezone).getTime() - 60000)
    });
  }

  return windows;
}

function renderLowTideStatus(isHarvest, isSpringLow, moon, windowInfo) {
  const moonText = moon ? `<span class="moon-symbol-inline">${escapeHtml(moonSymbol(moon.type))}</span>` : "";
  const harvestText = harvestStatusText(windowInfo);

  if (isMobileView()) {
    if (isHarvest && isSpringLow) {
      return `${moonText}<span class="spring-low" title="${escapeAttribute(t("harvest.springLow", { harvestText }))}">${escapeHtml(SYMBOLS.plant)}${escapeHtml(SYMBOLS.down)}</span>`;
    }

    if (isHarvest) {
      return `${moonText}<span class="harvest-text" title="${escapeAttribute(harvestText)}">${escapeHtml(SYMBOLS.plant)}</span>`;
    }

    return moon ? `${moonText}` : "";
  }

  if (isHarvest && isSpringLow) {
    return `${moonText}<span class="spring-low">${escapeHtml(SYMBOLS.plant)} ${escapeHtml(t("harvest.springLow", { harvestText }))} ${escapeHtml(SYMBOLS.down)}</span>`;
  }

  if (isHarvest) {
    return `${moonText}<span class="harvest-text">${escapeHtml(SYMBOLS.plant)} ${escapeHtml(harvestText)}</span>`;
  }

  if (moon) {
    return `${moonText}`;
  }

  return "";
}

function harvestStatusText(windowInfo) {
  if (!windowInfo) return t("harvest.status");
  if (windowInfo.role === "single") return t("harvest.day", { label: windowInfo.label });
  if (windowInfo.role === "start") return t("harvest.start", { label: windowInfo.label });
  if (windowInfo.role === "end") return t("harvest.end", { label: windowInfo.label });
  return t("harvest.windowLabel", { label: windowInfo.label });
}

function moonSymbol(type) {
  return type === "full" ? SYMBOLS.fullMoon : SYMBOLS.newMoon;
}

function renderCalendar(forecast) {
  const todayKey = localDateKey(forecast.now, state.profile.timezone);
  const months = [0, 1, 2].map((offset) => startOfMonthKey(addMonthsToDateKey(todayKey, offset)));
  const calendarRange = visibleCalendarRange(months);
  const calendarMoons = moonEvents(calendarRange.start, calendarRange.end);
  const harvestDays = buildCalendarHarvestDays(months, calendarMoons);

  els.harvestCalendar.innerHTML = months.map((monthStartKey) => {
    const monthDate = dateKeyToUtcDate(monthStartKey);
    const monthLabel = formatMonth(monthDate, state.profile.timezone, getLocale());
    const blanks = (weekdayIndex(monthStartKey) + 6) % 7;
    const totalDays = daysInMonth(monthStartKey);
    const cells = [];

    for (let i = 0; i < blanks; i += 1) {
      cells.push(`<div class="calendar-day empty" aria-hidden="true"></div>`);
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const dateKey = `${monthStartKey.slice(0, 8)}${String(day).padStart(2, "0")}`;
      const info = harvestDays.get(dateKey);
      const isToday = dateKey === todayKey;
      const isPast = dateKey < todayKey;
      const classes = [
        "calendar-day",
        info?.harvest ? "harvest" : "",
        info?.moonType ? "moon" : "",
        isToday ? "today" : "",
        isPast ? "past" : ""
      ].filter(Boolean).join(" ");
      const title = buildCalendarTitle(dateKey, info);

      cells.push(`
        <div class="${classes}" title="${escapeHtml(title)}">
          <span>${day}</span>
          ${info?.moonType ? `<small class="calendar-moon ${escapeHtml(info.moonType)}">${escapeHtml(moonSymbol(info.moonType))}</small>` : ""}
        </div>
      `);
    }

    return `
      <section class="calendar-month" aria-label="${escapeHtml(monthLabel)}">
        <h3>${escapeHtml(monthLabel)}</h3>
        <div class="calendar-grid calendar-head">
          <span>${escapeHtml(t("calendar.weekday.mon"))}</span><span>${escapeHtml(t("calendar.weekday.tue"))}</span><span>${escapeHtml(t("calendar.weekday.wed"))}</span><span>${escapeHtml(t("calendar.weekday.thu"))}</span><span>${escapeHtml(t("calendar.weekday.fri"))}</span><span>${escapeHtml(t("calendar.weekday.sat"))}</span><span>${escapeHtml(t("calendar.weekday.sun"))}</span>
        </div>
        <div class="calendar-grid">${cells.join("")}</div>
      </section>
    `;
  }).join("");
}

function visibleCalendarRange(months) {
  const firstMonthKey = months[0];
  const lastMonthKey = months[months.length - 1];
  const lastDayKey = `${lastMonthKey.slice(0, 8)}${String(daysInMonth(lastMonthKey)).padStart(2, "0")}`;
  const start = zonedDateKeyToDate(firstMonthKey, state.profile.timezone);
  const end = new Date(zonedDateKeyToDate(addDaysToDateKey(lastDayKey, 1), state.profile.timezone).getTime() - 60000);
  return { start, end };
}

function buildCalendarHarvestDays(months, moons) {
  const dayMap = new Map();

  if (state.thresholdEnabled) {
    for (const monthStartKey of months) {
      const totalDays = daysInMonth(monthStartKey);

      for (let day = 1; day <= totalDays; day += 1) {
        const dateKey = `${monthStartKey.slice(0, 8)}${String(day).padStart(2, "0")}`;
        const dayRange = localDayRange(dateKey, state.profile.timezone);
        const dayCurve = tideCurveForRange(dayRange, 30);
        const lows = tideExtremesForRange(dayRange, dayCurve).filter((extreme) => extreme.type === "low");

        if (!lows.length) continue;

        const current = dayMap.get(dateKey) || emptyCalendarDayInfo();
        current.lows.push(...lows);

        for (const low of lows) {
          if (isHarvestEligibleLow(low)) {
            current.minLow = Math.min(current.minLow, low.heightM);
            current.harvest = true;
          }
        }

        dayMap.set(dateKey, current);
      }
    }
  }

  for (const moon of moons) {
    const dateKey = localDateKey(moon.date, state.profile.timezone);
    const current = dayMap.get(dateKey) || emptyCalendarDayInfo();
    current.moonLabel = moon.type === "full" ? t("moon.full") : t("moon.new");
    current.moonType = moon.type;
    dayMap.set(dateKey, current);
  }

  return dayMap;
}

function emptyCalendarDayInfo() {
  return { lows: [], harvest: false, minLow: Infinity, moonLabel: "", moonType: "" };
}

function buildCalendarTitle(dateKey, info) {
  const bits = [dateKey];
  if (info?.harvest) bits.push(t("calendar.harvestLowTitle", { height: formatMetres(info.minLow) }));
  if (info?.moonLabel) bits.push(t("calendar.moonTitle", { moon: info.moonLabel }));
  return bits.join(" - ");
}

function renderSourceDetails() {
  const { profile, location } = state;
  const tideData = activeTideData();
  const dataset = tideData?.dataset;
  const verification = dataset?.verification_status
    ? translateStatusLabel(dataset.verification_status)
    : translateDataText(profile.verificationLabel);
  els.sourceDetails.innerHTML = `
    <div><strong>${escapeHtml(t("details.dataset"))}</strong> ${escapeHtml(translateDataText(dataset?.dataset_name || profile.version))}</div>
    <div><strong>${escapeHtml(t("details.source"))}</strong> <a href="${escapeAttribute(dataset?.source_url || profile.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(translateDataText(dataset?.source_organization || dataset?.source_title || profile.sourceName))}</a></div>
    <div><strong>${escapeHtml(t("details.datum"))}</strong> ${escapeHtml(translateDataText(dataset?.datum_label || profile.datumLabel))}</div>
    <div><strong>${escapeHtml(t("details.timezone"))}</strong> ${escapeHtml(profile.timezone)}</div>
    <div><strong>${escapeHtml(t("details.verification"))}</strong> ${escapeHtml(verification)}</div>
    <div><strong>${escapeHtml(t("details.locationNote"))}</strong> ${escapeHtml(translateDataText(location.notes))}</div>
  `;
}

function activeTideDataLabel(tideData) {
  if (tideData?.sourceType === "supabase") return t("data.active.supabase");
  if (tideData?.sourceType === "offline") return t("data.active.offline");
  if (state.tideDataStatus === "loading") return t("data.active.loading");
  return t("data.active.prototype");
}

function renderSafetyDetails() {
  els.safetyDetails.innerHTML = `
    <p>${escapeHtml(translateDataText(state.profile.warningText))}</p>
    <p>${escapeHtml(t("safety.prototypeWarning"))}</p>
  `;
}

function getLocation(locationKey) {
  const normalizedKey = canonicalLocationSlug(locationKey);
  if (!normalizedKey) return null;

  return farmLocations.find((location) => {
    return locationIdentifierCandidates(location).some((candidate) => {
      return canonicalLocationSlug(candidate) === normalizedKey;
    });
  }) || null;
}

function locationIdentifierCandidates(location) {
  return [
    location?.key,
    location?.databaseKey,
    location?.locationCode,
    location?.id,
    location?.shortName,
    location?.name,
    ...(Array.isArray(location?.aliases) ? location.aliases : [])
  ];
}

function getDefaultThreshold(location, profile) {
  return Number(location?.defaultHarvestThresholdM || profile?.defaultHarvestThresholdM || 0.7);
}

function thresholdStorageKey() {
  return `${APP_CONFIG.storageKeys.thresholdPrefix}${state.location.key}`;
}

function thresholdEnabledStorageKey() {
  return `${APP_CONFIG.storageKeys.thresholdEnabledPrefix}${state.location.key}`;
}

function loadThresholdState() {
  const savedThresholdText = readStorage(thresholdStorageKey());
  const savedThreshold = savedThresholdText === null ? NaN : Number(savedThresholdText);
  const savedEnabled = readStorage(thresholdEnabledStorageKey());

  state.thresholdM = Number.isFinite(savedThreshold)
    ? clampThreshold(savedThreshold)
    : getDefaultThreshold(state.location, state.profile);
  state.thresholdEnabled = savedEnabled === null ? true : savedEnabled === "true";
}

function saveThresholdState() {
  writeStorage(thresholdStorageKey(), String(clampThreshold(state.thresholdM)));
  writeStorage(thresholdEnabledStorageKey(), String(state.thresholdEnabled));
}

function normalizeLocationSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalLocationSlug(value) {
  const normalized = normalizeLocationSlug(value);
  return LEGACY_LOCATION_KEY_ALIASES[normalized] || normalized;
}

function syncThresholdControls() {
  els.thresholdInput.value = state.thresholdM.toFixed(2);
  els.thresholdEnabled.checked = state.thresholdEnabled;
  els.thresholdInput.disabled = !state.thresholdEnabled;
}

function syncForecastRangeControls() {
  if (els.forecastRangeLabel) {
    els.forecastRangeLabel.textContent = t("forecast.rangeLabel", { days: state.forecastDays });
  }

  els.forecastRangeButtons.forEach((button) => {
    const isSelected = Number(button.dataset.forecastDays) === state.forecastDays;
    button.setAttribute("aria-pressed", String(isSelected));
    button.textContent = t("forecast.buttonDays", { count: button.dataset.forecastDays });
  });
}

function syncOverviewRangeControls() {
  syncOverviewVisibility();

  if (els.overviewRangeLabel) {
    const suffix = isMobileView() ? "" : t("overview.suffixHarvest");
    els.overviewRangeLabel.textContent = t("overview.rangeLabel", {
      months: state.overviewMonths,
      suffix
    });
  }

  els.overviewRangeButtons.forEach((button) => {
    const isSelected = Number(button.dataset.overviewMonths) === state.overviewMonths;
    button.setAttribute("aria-pressed", String(isSelected));
    const count = Number(button.dataset.overviewMonths);
    button.textContent = t(count === 1 ? "overview.buttonMonth" : "overview.buttonMonths", { count });
  });
}

function syncOverviewVisibility() {
  const hideOverview = isMobileView();

  [els.overviewChartSubhead, els.overviewHarvestWindows, els.overviewChartFrame].forEach((element) => {
    if (element) element.hidden = hideOverview;
  });
}

function applyResponsiveDefaults() {
  if (!state.forecastRangeUserSelected) {
    state.forecastDays = isMobileView() ? 3 : 7;
  }

  if (!state.overviewRangeUserSelected) {
    state.overviewMonths = isMobileView() ? 1 : 3;
  }
}

function isMobileView() {
  return MOBILE_QUERY.matches;
}

function clampThreshold(value) {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(5, Math.max(0, value));
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted browsers. The app still works for this session.
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), waitMs);
  };
}
