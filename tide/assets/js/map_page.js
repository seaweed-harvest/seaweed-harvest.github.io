import { loadPublicFarmLocations, loadPublicTideReferences } from "./tide_data.js?v=20260723-table-harvest-align";
import { t, translateDataText } from "./language.js?v=20260723-table-harvest-align";
import {
  isOfflineStorageSupported,
  listFarmLocationOfflineBundles
} from "./offline_location_store.js?v=20260810";

const TIDE_PAGE_VERSION = "20260723-table-harvest-align";

const KENYA_COAST_VIEW = {
  center: [-4.45, 39.45],
  zoom: 8
};

const els = {};
const markersByKey = new Map();
let map;
let lastMapData = null;
let selectedRegion = "";
let pendingFocusLocationKey = readFocusLocationKey();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  setStatus(t("map.statusLoading"), "muted");

  const result = await loadMapData();
  const farms = result.locations;
  const references = result.references;
  const mappedFarms = farms.filter(hasGps);
  const missingFarms = farms.filter((location) => !hasGps(location));
  const mappedReferences = references.filter(hasGps);

  lastMapData = {
    mappedFarms,
    missingFarms,
    references,
    mappedReferences
  };
  renderMapPage();
}

function cacheElements() {
  [
    "farmMap",
    "mapFallback",
    "mapStatus",
    "mappedCount",
    "referenceCount",
    "missingCount",
    "mapRegionSelect",
    "mappedLocationList",
    "tideReferenceList",
    "missingLocationPanel",
    "missingLocationList"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.mappedLocationList.addEventListener("click", focusMarkerFromEvent);
  els.tideReferenceList.addEventListener("click", focusMarkerFromEvent);
  els.mappedLocationList.addEventListener("keydown", focusMarkerFromEvent);
  els.tideReferenceList.addEventListener("keydown", focusMarkerFromEvent);
  els.mapRegionSelect?.addEventListener("change", () => {
    selectedRegion = els.mapRegionSelect.value;
    zoomToSelectedRegion();
  });

  window.addEventListener("online", () => {
    if (lastMapData) renderMapPage();
  });
  window.addEventListener("offline", () => {
    if (lastMapData) renderMapPage();
  });

  document.addEventListener("seaweed-language-change", () => {
    if (lastMapData) {
      renderMapPage();
    } else {
      setStatus(t("map.statusLoading"), "muted");
    }
  });
}

function renderMapPage() {
  const { mappedFarms, missingFarms, references, mappedReferences } = lastMapData;

  syncSelectedRegionToFocusLocation();
  renderRegionOptions([...mappedFarms, ...mappedReferences]);
  renderLists(mappedFarms, missingFarms, references);
  renderMap(mappedFarms, references);
  els.mappedCount.textContent = `${mappedFarms.length}`;
  els.referenceCount.textContent = `${mappedReferences.length}`;
  els.missingCount.textContent = `${missingFarms.length}`;

  if (mappedFarms.length || mappedReferences.length) {
    setStatus(
      t("map.statusCounts", {
        farms: mappedFarms.length,
        farmPlural: mappedFarms.length === 1 ? "" : "s",
        references: mappedReferences.length,
        referencePlural: mappedReferences.length === 1 ? "" : "s"
      }),
      "ready"
    );
  } else {
    setStatus(t("map.gpsNeeded"), "muted");
  }

  focusPendingLocation();
}

function renderRegionOptions(records) {
  if (!els.mapRegionSelect) return;

  const regions = uniqueValues(
    records
      .filter(hasGps)
      .map((record) => record.mapRegion)
      .filter(Boolean)
  ).sort((a, b) => translateDataText(a).localeCompare(translateDataText(b)));

  if (selectedRegion && !regions.includes(selectedRegion)) {
    selectedRegion = "";
  }

  els.mapRegionSelect.innerHTML = [
    `<option value="">${escapeHtml(t("map.allRegions"))}</option>`,
    ...regions.map((region) => `
      <option value="${escapeAttribute(region)}"${region === selectedRegion ? " selected" : ""}>${escapeHtml(translateDataText(region))}</option>
    `)
  ].join("");
}

function zoomToSelectedRegion() {
  if (!map || !lastMapData) return;

  const records = recordsForRegion([
    ...lastMapData.mappedFarms,
    ...lastMapData.mappedReferences
  ]);

  if (!records.length) {
    setStatus(t("map.noRegionMatches"), "muted");
    return;
  }

  fitMapToRecords(records, true);
}

function recordsForRegion(records) {
  const mapped = records.filter(hasGps);
  if (!selectedRegion) return mapped;
  return mapped.filter((record) => record.mapRegion === selectedRegion);
}

function fitMapToRecords(records, animate) {
  if (!map || !records.length) return;

  if (records.length === 1) {
    map.setView([records[0].latitude, records[0].longitude], 13, { animate });
    return;
  }

  const bounds = records.map((record) => [record.latitude, record.longitude]);
  map.fitBounds(bounds, {
    padding: [42, 42],
    maxZoom: 13,
    animate
  });
}

function syncSelectedRegionToFocusLocation() {
  if (!pendingFocusLocationKey || !lastMapData) return;
  const record = findRecordForLocationKey(pendingFocusLocationKey);
  if (record?.mapRegion) {
    selectedRegion = record.mapRegion;
  }
}

function focusPendingLocation() {
  if (!pendingFocusLocationKey) return;
  const markerKeyValue = markerKeyForLocationKey(pendingFocusLocationKey);

  if (!markerKeyValue) {
    setStatus(t("map.selectedLocationNotMapped"), "muted");
    pendingFocusLocationKey = "";
    return;
  }

  window.setTimeout(() => {
    focusMarker(markerKeyValue);
    pendingFocusLocationKey = "";
  }, 180);
}

function markerKeyForLocationKey(locationKey) {
  const farm = lastMapData?.mappedFarms.find((location) => location.key === locationKey);
  if (farm) return markerKey("farm", farm.key);

  const reference = lastMapData?.mappedReferences.find((record) => {
    return tideReferenceLocationKey(record) === locationKey || record.key === locationKey;
  });
  if (reference) return markerKey("reference", reference.key);

  return "";
}

function findRecordForLocationKey(locationKey) {
  return (
    lastMapData?.mappedFarms.find((location) => location.key === locationKey) ||
    lastMapData?.mappedReferences.find((record) => {
      return tideReferenceLocationKey(record) === locationKey || record.key === locationKey;
    }) ||
    null
  );
}

function focusMarkerFromEvent(event) {
  if (event.type === "click" && event.target.closest("a")) return;
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;

  const item = event.target.closest("[data-focus-marker]");
  if (!item) return;

  event.preventDefault();
  focusMarker(item.dataset.focusMarker);
}

async function loadMapData() {
  const [farmResult, referenceResult, offlineBundles] = await Promise.all([
    loadPublicFarmLocations(),
    loadPublicTideReferences(),
    loadOfflineBundles()
  ]);
  const offlineLocationKeys = new Set(offlineBundles.map((bundle) => bundle.locationKey).filter(Boolean));
  const offlineFarmLocations = offlineBundles
    .map(offlineBundleToFarmLocation)
    .filter(Boolean);
  const offlineTideReferences = offlineBundles
    .map(offlineBundleToTideReference)
    .filter(Boolean);

  return {
    locations: mergeRecordsByKey([
      ...farmResult.locations.filter(isFarmLocation),
      ...offlineFarmLocations
    ])
      .map(normalizeLocationForMap)
      .map((location) => withOfflineStatus(location, offlineLocationKeys, location.key)),
    references: mergeRecordsByKey([
      ...referenceResult.references,
      ...offlineTideReferences
    ])
      .map(normalizeReferenceForMap)
      .map((reference) => withOfflineStatus(reference, offlineLocationKeys, tideReferenceLocationKey(reference)))
  };
}

function normalizeLocationForMap(location) {
  const region = location.region || "";
  const country = location.country || "";
  return {
    ...location,
    latitude: Number(location.gps?.lat),
    longitude: Number(location.gps?.lon),
    mapRegion: region || country || t("map.regionNotSet"),
    regionCountry: formatRegionCountry(region, country)
  };
}

function normalizeReferenceForMap(reference) {
  const region = reference.region || "";
  const country = reference.country || "";
  return {
    ...reference,
    latitude: Number(reference.latitude),
    longitude: Number(reference.longitude),
    mapRegion: region || country || t("map.regionNotSet"),
    regionCountry: formatRegionCountry(region, country) || t("map.regionNotSet")
  };
}

async function loadOfflineBundles() {
  if (!isOfflineStorageSupported()) return [];

  try {
    return await listFarmLocationOfflineBundles();
  } catch (error) {
    console.warn("Offline location bundle read failed.", error);
    return [];
  }
}

function offlineBundleToFarmLocation(bundle) {
  if (!bundle?.location || String(bundle.locationKey || "").startsWith("tide-reference-")) return null;
  const location = bundle.location;
  return {
    key: bundle.locationKey || location.key,
    name: location.name || bundle.locationName || bundle.locationKey,
    shortName: location.shortName || location.name || bundle.locationName || bundle.locationKey,
    region: location.region || "",
    country: location.country || "Kenya",
    timezone: bundle.timezone || "Africa/Nairobi",
    tideProfileKey: bundle.profileKey,
    defaultTideDatasetId: bundle.datasetId,
    defaultTideDatasetKey: bundle.datasetKey,
    defaultHarvestThresholdM: Number(bundle.threshold?.defaultM ?? bundle.threshold?.currentM ?? 0.7),
    gps: location.gps || null,
    gpsLabel: location.gpsLabel || "",
    status: location.status || "offline_saved",
    notes: location.notes || "",
    offlineOnly: true
  };
}

function offlineBundleToTideReference(bundle) {
  if (!bundle?.location || !String(bundle.locationKey || "").startsWith("tide-reference-")) return null;
  const location = bundle.location;
  const gps = location.gps || null;
  return {
    key: bundle.datasetId || bundle.datasetKey || bundle.locationKey,
    id: bundle.datasetId || null,
    datasetKey: bundle.datasetKey || "",
    name: location.name || bundle.locationName || bundle.locationKey,
    datasetName: bundle.dataset?.dataset_name || bundle.locationName || bundle.datasetKey || bundle.locationKey,
    sourceName: bundle.source?.profileSourceName || bundle.dataset?.source_organization || "",
    latitude: Number(gps?.lat),
    longitude: Number(gps?.lon),
    region: location.region || "",
    country: location.country || "",
    gps,
    status: location.status || bundle.source?.verificationStatus || "offline_saved",
    timezone: bundle.timezone || "Africa/Nairobi",
    tideProfileKey: bundle.profileKey,
    defaultHarvestThresholdM: Number(bundle.threshold?.defaultM ?? bundle.threshold?.currentM ?? 0.7),
    offlineOnly: true
  };
}

function mergeRecordsByKey(records) {
  const merged = new Map();
  records.filter(Boolean).forEach((record) => {
    const key = record.key || record.id || record.datasetKey || record.dataset_key;
    if (!key) return;
    merged.set(key, {
      ...(merged.get(key) || {}),
      ...record
    });
  });
  return [...merged.values()];
}

function withOfflineStatus(record, offlineLocationKeys, locationKey) {
  return {
    ...record,
    offlineLocationKey: locationKey,
    offlineAvailable: offlineLocationKeys.has(locationKey)
  };
}

function hasGps(record) {
  return Number.isFinite(record.latitude) && Number.isFinite(record.longitude);
}

function isFarmLocation(location) {
  const status = String(location.status || "").toLowerCase();
  return location.appUse !== false && !status.includes("reference");
}

function renderMap(mappedFarms, tideReferences) {
  if (map) {
    map.remove();
    map = null;
  }
  markersByKey.clear();
  els.mapFallback.hidden = true;
  els.mapFallback.textContent = "";

  if (!window.L) {
    showMapFallback(t("map.libraryMissing"));
    return;
  }

  map = window.L.map(els.farmMap, {
    scrollWheelZoom: true
  }).setView(KENYA_COAST_VIEW.center, KENYA_COAST_VIEW.zoom);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const mappedReferences = tideReferences.filter(hasGps);

  if (!mappedFarms.length && !mappedReferences.length) {
    showMapFallback(t("map.noGpsData"));
    return;
  }

  mappedFarms.forEach((location) => {
    const position = [location.latitude, location.longitude];
    const type = locationMapType(location);

    const marker = window.L.marker(position, { icon: markerIcon(type, locationMarkerSymbol(type)) })
      .addTo(map)
      .bindPopup(renderFarmPopup(location));
    markersByKey.set(markerKey("farm", location.key), marker);
  });

  mappedReferences.forEach((reference) => {
    const position = [reference.latitude, reference.longitude];

    const marker = window.L.marker(position, { icon: markerIcon("tide-reference", "&#8776;") })
      .addTo(map)
      .bindPopup(renderReferencePopup(reference));
    markersByKey.set(markerKey("reference", reference.key), marker);
  });

  fitMapToRecords(recordsForRegion([...mappedFarms, ...mappedReferences]), false);

  window.setTimeout(() => map.invalidateSize(), 100);
}

function focusMarker(key) {
  const marker = markersByKey.get(key);
  if (!map || !marker) return;

  const targetZoom = Math.max(map.getZoom(), 13);
  map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.45 });
  window.setTimeout(() => marker.openPopup(), 480);
  setActiveListItem(key);
  els.farmMap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setActiveListItem(key) {
  document.querySelectorAll("[data-focus-marker]").forEach((item) => {
    item.classList.toggle("active", item.dataset.focusMarker === key);
  });
}

function locationMapType(location) {
  if (location?.locationType === "lodge") return "lodge";

  const locationText = [
    location?.key,
    location?.databaseKey,
    location?.name,
    location?.shortName,
    location?.notes,
    location?.gpsLabel
  ].join(" ").toLowerCase();

  return locationText.includes("lodge") || locationText.includes("hotel") || locationText.includes("resort")
    ? "lodge"
    : "farm";
}

function locationMarkerSymbol(type) {
  return type === "lodge" ? "&#127976;" : "&#127807;";
}

function markerIcon(type, symbolHtml) {
  return window.L.divIcon({
    className: "",
    html: `<span class="map-marker-icon ${type}">${symbolHtml}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -15]
  });
}

function showMapFallback(message) {
  els.mapFallback.hidden = false;
  els.mapFallback.textContent = message;
}

function renderFarmPopup(location) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(translateDataText(location.name))}</strong>
      <span>${escapeHtml(translateDataText(location.regionCountry))}</span>
      <small>${escapeHtml(formatCoordinate(location.latitude))}, ${escapeHtml(formatCoordinate(location.longitude))}</small>
      ${plannerActionHtml(location, tideUrl(location), t("map.openPlanner"))}
    </div>
  `;
}

function renderReferencePopup(reference) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(translateDataText(reference.name))}</strong>
      <span>${escapeHtml(translateDataText(reference.datasetName))}</span>
      <small>${escapeHtml(translateDataText(reference.status) || t("map.statusNotSet"))}</small>
      ${plannerActionHtml(reference, tideReferenceUrl(reference), t("map.openPlanner"))}
    </div>
  `;
}

function renderLists(mappedFarms, missingFarms, references) {
  els.mappedLocationList.innerHTML = mappedFarms.length
    ? renderLocationTable(mappedFarms, renderMappedLocationRow)
    : `<div class="empty-state">${escapeHtml(t("map.noMappedFarms"))}</div>`;

  els.tideReferenceList.innerHTML = references.length
    ? renderLocationTable(references, renderTideReferenceRow)
    : `<div class="empty-state">${escapeHtml(t("map.noReferences"))}</div>`;

  if (els.missingLocationPanel) {
    els.missingLocationPanel.hidden = !missingFarms.length;
  }

  els.missingLocationList.innerHTML = missingFarms.length
    ? renderLocationTable(missingFarms, renderMissingLocationRow)
    : `<div class="empty-state">${escapeHtml(t("map.allGps"))}</div>`;
}

function renderLocationTable(records, rowRenderer) {
  return `
    <table class="map-location-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("map.columnName"))}</th>
          <th>${escapeHtml(t("map.columnRegion"))}</th>
          <th>${escapeHtml(t("map.columnCoordinates"))}</th>
          <th>${escapeHtml(t("map.columnOpen"))}</th>
        </tr>
      </thead>
      <tbody>
        ${records.map(rowRenderer).join("")}
      </tbody>
    </table>
  `;
}

function renderMappedLocationRow(location) {
  const name = translateDataText(location.name);
  const type = locationMapType(location);
  return `
    <tr class="map-location-row ${escapeAttribute(type)}" tabindex="0" role="button" data-focus-marker="${escapeAttribute(markerKey("farm", location.key))}" aria-label="${escapeAttribute(t("map.showOnMap", { name }))}">
      <td><strong>${escapeHtml(name)}</strong></td>
      <td>${escapeHtml(translateDataText(location.regionCountry))}</td>
      <td>${escapeHtml(formatCoordinatePair(location.latitude, location.longitude))}</td>
      <td>${plannerActionHtml(location, tideUrl(location), t("map.open"))}</td>
    </tr>
  `;
}

function renderTideReferenceRow(reference) {
  const name = translateDataText(reference.name);
  const markerAttribute = hasGps(reference)
    ? ` tabindex="0" role="button" data-focus-marker="${escapeAttribute(markerKey("reference", reference.key))}" aria-label="${escapeAttribute(t("map.showOnMap", { name }))}"`
    : "";
  return `
    <tr class="map-location-row tide-reference"${markerAttribute}>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td>${escapeHtml(translateDataText(reference.regionCountry))}</td>
      <td>${escapeHtml(hasGps(reference) ? formatCoordinatePair(reference.latitude, reference.longitude) : t("map.gpsToConfirm"))}</td>
      <td>${plannerActionHtml(reference, tideReferenceUrl(reference), t("map.open"))}</td>
    </tr>
  `;
}

function renderMissingLocationRow(location) {
  return `
    <tr class="map-location-row muted">
      <td><strong>${escapeHtml(translateDataText(location.name))}</strong></td>
      <td>${escapeHtml(translateDataText(location.regionCountry))}</td>
      <td>${escapeHtml(translateDataText(location.gpsLabel) || t("map.gpsToConfirm"))}</td>
      <td>${plannerActionHtml(location, tideUrl(location), t("map.open"))}</td>
    </tr>
  `;
}

function plannerActionHtml(record, url, label) {
  if (canOpenPlanner(record)) {
    return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
  }

  return `<span class="map-offline-note">${escapeHtml(t("map.offlineLocationNotSaved"))}</span>`;
}

function canOpenPlanner(record) {
  return navigator.onLine !== false || record.offlineAvailable === true;
}

function tideUrl(location) {
  return `./index.html?v=${TIDE_PAGE_VERSION}&location=${encodeURIComponent(location.key)}`;
}

function tideReferenceUrl(reference) {
  return `./index.html?v=${TIDE_PAGE_VERSION}&location=${encodeURIComponent(tideReferenceLocationKey(reference))}`;
}

function tideReferenceLocationKey(reference) {
  const rawKey = reference?.id || reference?.datasetKey || reference?.key || "";
  if (String(rawKey).startsWith("tide-reference-")) return rawKey;
  return rawKey ? `tide-reference-${rawKey}` : "";
}

function markerKey(type, key) {
  return `${type}:${key}`;
}

function readFocusLocationKey() {
  return new URLSearchParams(window.location.search).get("location") || "";
}

function formatCoordinate(value) {
  return Number(value).toFixed(5);
}

function formatCoordinatePair(latitude, longitude) {
  return `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`;
}

function formatRegionCountry(region, country) {
  const parts = [region, country]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return [...new Map(parts.map((part) => [part.toLowerCase(), part])).values()].join(", ");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function setStatus(text, status) {
  els.mapStatus.textContent = text;
  els.mapStatus.classList.toggle("status-muted", status !== "ready");
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
