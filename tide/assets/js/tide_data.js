import { APP_CONFIG } from "./config.js?v=20260723-table-harvest-align";
import { TIDE_LOCATIONS } from "../data/locations.js";
import { TIDE_PROFILES } from "../data/tide_profiles.js";
import {
  isSeaweedHarvestPlatform,
  tideBackendContext,
  tideBackendTables
} from "./platform_backend.js?v=20260810-platform-auth-v3";

const DATASET_PROFILE_MAP = {
  kmfri_2026_mombasa: "kenya_mombasa_reference",
  kmfri_2026_lamu: "kenya_mombasa_reference",
  kpa_2026_kilindini: "kenya_mombasa_reference",
  fremantle_reference: "fremantle_reference"
};
const TIDE_REFERENCE_REGION_BY_DATASET = {
  kmfri_2026_lamu: "Lamu County",
  kmfri_2026_mombasa: "Mombasa County",
  kpa_2026_kilindini: "Mombasa County",
  kpa_2026_dar_es_salaam: "Dar es Salaam Region"
};
const TIDE_REFERENCE_REGION_BY_LOCATION = {
  lamu: "Lamu County",
  mombasa: "Mombasa County",
  kilindini: "Mombasa County",
  dar_es_salaam: "Dar es Salaam Region",
  "dar-es-salaam": "Dar es Salaam Region"
};
const PUBLIC_FARM_LOCATION_CACHE_KEY = "seaweed_tide_planner:public_farm_locations:v2";
const PUBLIC_TIDE_REFERENCE_CACHE_KEY = "seaweed_tide_planner:public_tide_references:v2";
const SUPABASE_REQUEST_TIMEOUT_MS = 12000;
const SUPABASE_PAGE_CONCURRENCY = 2;

export function getLocations() {
  return TIDE_LOCATIONS;
}

export function getProfiles() {
  return TIDE_PROFILES;
}

export function getDataStatus() {
  const platform = isSeaweedHarvestPlatform();
  return {
    mode: platform ? "supabase-authenticated-with-static-fallback" : APP_CONFIG.dataMode,
    backendContext: platform ? "v1_Ag_System/tide" : APP_CONFIG.backendContext,
    supabaseProjectRef: platform ? "seaweed-harvest-shared" : APP_CONFIG.supabase.projectRef,
    supabaseRestUrl: platform ? "shared Seaweed Harvest Supabase" : APP_CONFIG.supabase.restUrl,
    supabaseEnabled: platform || APP_CONFIG.supabase.enabled,
    supabasePublicReadsEnabled: !platform && APP_CONFIG.supabase.publicReadsEnabled === true,
    authenticatedReads: platform
  };
}

export async function fetchSupabaseTable(tableName, query = "select=*") {
  if (!canReadSupabase()) {
    throw new Error("Supabase reads are configured but not enabled yet.");
  }

  return fetchSupabaseJson(tableName, query);
}

export async function fetchSupabaseTablePaged(tableName, query = "select=*", pageSize = 1000) {
  if (!canReadSupabase()) {
    throw new Error("Supabase reads are configured but not enabled yet.");
  }

  const firstPage = await fetchSupabaseJson(tableName, `${query}&limit=${pageSize}&offset=0`);
  const rows = [...firstPage];
  if (firstPage.length < pageSize) return rows;

  let start = pageSize;
  while (true) {
    const pages = await Promise.all(Array.from({ length: SUPABASE_PAGE_CONCURRENCY }, (_, index) => {
      const offset = start + index * pageSize;
      return fetchSupabaseJson(tableName, `${query}&limit=${pageSize}&offset=${offset}`);
    }));

    pages.forEach((page) => rows.push(...page));
    if (pages.some((page) => page.length < pageSize)) break;
    start += pageSize * SUPABASE_PAGE_CONCURRENCY;
  }

  return rows;
}

export async function loadPublicTideDatasetBundle(datasetRef, options = {}) {
  const datasetFilter = resolveDatasetFilter(datasetRef, options);
  if (!datasetFilter || !canReadSupabase()) {
    return emptyDatasetBundle(datasetRef, "Supabase reads are unavailable.");
  }

  const fromDate = options.fromDate ? encodeURIComponent(options.fromDate) : "";
  const toDate = options.toDate ? encodeURIComponent(options.toDate) : "";
  const dateFilter = fromDate && toDate ? `&local_date=gte.${fromDate}&local_date=lte.${toDate}` : "";
  const tables = tideBackendTables();

  try {
    const [datasetRows, tideEvents, hourlyPredictions] = await Promise.all([
      fetchSupabaseTable(
        tables.datasets,
        `select=*&${datasetFilter.datasetQuery}&active=eq.true&public_visible=eq.true&limit=1`
      ),
      fetchSupabaseTablePaged(
        tables.events,
        `select=dataset_id,dataset_key,event_time_utc,local_date,local_time,event_type,height_m,quality_flag,source_event_id,source_pdf_page,notes&${datasetFilter.rawQuery}${dateFilter}&order=event_time_utc.asc`
      ),
      fetchSupabaseTablePaged(
        tables.hourlyPredictions,
        `select=dataset_id,dataset_key,prediction_time_utc,local_date,local_time,local_hour,height_m,quality_flag,source_record_id,source_pdf_page,notes&${datasetFilter.rawQuery}${dateFilter}&order=prediction_time_utc.asc`
      )
    ]);

    return {
      dataset: datasetRows[0] || null,
      tideEvents,
      hourlyPredictions,
      source: "supabase",
      warning: datasetRows.length ? "" : `No Tide dataset row found for ${datasetFilter.label}.`
    };
  } catch (error) {
    console.warn("Tide dataset bundle read failed.", error);
    return emptyDatasetBundle(datasetRef, error.message || "Tide dataset bundle read failed.");
  }
}

function resolveDatasetFilter(datasetRef, options = {}) {
  const datasetId = options.datasetId || (isUuid(datasetRef) ? datasetRef : "");
  const datasetKey = options.datasetKey || (!isUuid(datasetRef) ? datasetRef : "");

  if (datasetId) {
    const encoded = encodeURIComponent(datasetId);
    return {
      label: datasetId,
      datasetQuery: `id=eq.${encoded}`,
      rawQuery: `dataset_id=eq.${encoded}`
    };
  }

  if (datasetKey) {
    const encoded = encodeURIComponent(datasetKey);
    return {
      label: datasetKey,
      datasetQuery: `dataset_key=eq.${encoded}`,
      rawQuery: `dataset_key=eq.${encoded}`
    };
  }

  return null;
}

async function fetchSupabaseJson(tableName, query, extraHeaders = {}) {
  const backend = await tideBackendContext();
  const path = `${backend.restUrl}/${encodeURIComponent(tableName)}?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, {
      headers: {
        apikey: backend.anonKey,
        Authorization: `Bearer ${backend.accessToken}`,
        ...extraHeaders
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${Math.round(SUPABASE_REQUEST_TIMEOUT_MS / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function emptyDatasetBundle(datasetKey, warning) {
  return {
    dataset: null,
    tideEvents: [],
    hourlyPredictions: [],
    source: "none",
    warning: warning || `No tide data loaded for ${datasetKey || "selected dataset"}.`
  };
}

export async function loadPublicFarmLocations() {
  const staticLocations = getLocations();

  if (!canReadSupabase()) {
    return {
      locations: staticLocations,
      sourceLabel: "Using static prototype location records",
      source: "static"
    };
  }

  try {
    const tables = tideBackendTables();
    const platform = isSeaweedHarvestPlatform();
    const rows = await fetchSupabaseTable(
      tables.locations,
      platform
        ? "select=*&active=eq.true&public_visible=eq.true&order=location_name.asc"
        : "select=*&active=eq.true&public_visible=eq.true&order=farm_name.asc"
    );
    const locations = applyLocationUrlKeys(rows.map(normalizeSupabaseFarmLocation).filter(Boolean));

    if (locations.length) {
      writeJsonCache(PUBLIC_FARM_LOCATION_CACHE_KEY, locations);
      return {
        locations,
        sourceLabel: "",
        source: "supabase"
      };
    }
  } catch (error) {
    console.warn("Tide location read failed, using static locations.", error);
  }

  const cachedLocations = readJsonCache(PUBLIC_FARM_LOCATION_CACHE_KEY);
  if (Array.isArray(cachedLocations) && cachedLocations.length) {
    return {
      locations: cachedLocations,
      sourceLabel: "Using cached farm location records",
      source: "cache"
    };
  }

  return {
    locations: staticLocations,
    sourceLabel: "Using static prototype location records",
    source: "static"
  };
}

export async function loadPublicTideReferences() {
  if (!canReadSupabase()) {
    return {
      references: [],
      sourceLabel: "No Supabase tide references loaded",
      source: "static"
    };
  }

  try {
    const rows = await fetchSupabaseTable(
      tideBackendTables().datasets,
      "select=*&active=eq.true&public_visible=eq.true&order=dataset_name.asc"
    );

    const references = rows.map(normalizeSupabaseTideReference).filter(Boolean);
    if (references.length) {
      writeJsonCache(PUBLIC_TIDE_REFERENCE_CACHE_KEY, references);
    }

    return {
      references,
      sourceLabel: "",
      source: "supabase"
    };
  } catch (error) {
    console.warn("Tide reference read failed.", error);
  }

  const cachedReferences = readJsonCache(PUBLIC_TIDE_REFERENCE_CACHE_KEY);
  if (Array.isArray(cachedReferences) && cachedReferences.length) {
    return {
      references: cachedReferences,
      sourceLabel: "Using cached tide references",
      source: "cache"
    };
  }

  return {
    references: [],
    sourceLabel: "No Supabase tide references loaded",
    source: "static"
  };
}

function normalizeSupabaseFarmLocation(row) {
  const databaseKey = row.location_key || row.farm_location_key || "";
  const displayName = row.location_name || row.community_name || row.farm_name || row.short_name || databaseKey;
  const preferredKey = normalizeLocationSlug(row.short_name || displayName || databaseKey || row.location_code || row.id);
  const key = preferredKey || databaseKey || row.location_code || row.id;
  if (!key) return null;

  const latitude = toFiniteNumber(row.latitude);
  const longitude = toFiniteNumber(row.longitude);
  const datasetId = row.default_tide_dataset_id || "";
  const datasetKey = row.default_tide_dataset_key || "kmfri_2026_mombasa";
  const aliases = uniqueValues([
    databaseKey,
    row.location_code,
    row.id,
    row.community_id,
    normalizeLocationSlug(displayName),
    normalizeLocationSlug(row.short_name)
  ]);

  return {
    key,
    id: row.id || null,
    databaseKey,
    aliases,
    locationCode: row.location_code || "",
    communityId: row.community_id || null,
    communityRecordId: row.community_record_id || null,
    name: displayName || key,
    shortName: row.short_name || displayName || key,
    region: row.region || "",
    country: row.country || "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: DATASET_PROFILE_MAP[datasetKey] || "kenya_mombasa_reference",
    defaultTideDatasetId: datasetId,
    defaultTideDatasetKey: datasetKey,
    defaultHarvestThresholdM: Number(row.default_harvest_threshold_m ?? 0.7),
    locationType: inferFarmLocationType(row),
    gps: Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { lat: latitude, lon: longitude }
      : null,
    gpsLabel: row.gps_notes || (row.gps_source === "communities" ? "Community registry GPS" : "GPS to be confirmed"),
    identitySource: row.identity_source || "tide_locations",
    gpsSource: row.gps_source || "tide_locations",
    status: row.status || "",
    publicVisible: row.public_visible,
    active: row.active,
    notes: row.notes || "Tide location loaded from Supabase."
  };
}

function inferFarmLocationType(row) {
  const text = [
    row.location_key,
    row.farm_location_key,
    row.location_name,
    row.farm_name,
    row.short_name,
    row.notes
  ].join(" ").toLowerCase();

  if (text.includes("lodge") || text.includes("hotel") || text.includes("resort")) return "lodge";
  return "farm";
}

function applyLocationUrlKeys(locations) {
  const preferredCounts = locations.reduce((counts, location) => {
    counts.set(location.key, (counts.get(location.key) || 0) + 1);
    return counts;
  }, new Map());

  return locations.map((location) => {
    if (preferredCounts.get(location.key) === 1) return location;

    const farmNameKey = normalizeLocationSlug(location.name);
    const key = farmNameKey && preferredCounts.get(farmNameKey) !== 1
      ? farmNameKey
      : (location.databaseKey || location.id || location.key);

    return {
      ...location,
      key,
      aliases: uniqueValues([...(location.aliases || []), location.key])
    };
  });
}

function normalizeSupabaseTideReference(row) {
  const key = row.id || row.dataset_key;
  if (!key) return null;

  const datasetKey = row.dataset_key || "";
  const latitude = toFiniteNumber(row.tide_location_latitude);
  const longitude = toFiniteNumber(row.tide_location_longitude);

  return {
    key,
    id: row.id || null,
    datasetKey,
    name: row.tide_location_name || row.dataset_name || key,
    datasetName: row.dataset_name || key,
    sourceName: row.source_organization || row.source_title || "Tide dataset",
    sourceUrl: row.source_url || "",
    latitude,
    longitude,
    region: tideReferenceRegion(row),
    country: row.tide_location_country || row.location_country || "",
    gps: Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { lat: latitude, lon: longitude }
      : null,
    datumLabel: row.datum_label || "",
    status: row.verification_status || "",
    timezone: row.timezone || "Africa/Nairobi",
    tideProfileKey: DATASET_PROFILE_MAP[datasetKey] || "kenya_mombasa_reference",
    defaultHarvestThresholdM: Number(row.default_harvest_threshold_m ?? row.harvest_threshold_m ?? 0.7)
  };
}

function tideReferenceRegion(row) {
  const datasetKey = row.dataset_key || "";
  const locationKey = row.tide_location_key || row.location_key || "";
  return (
    row.tide_location_region ||
    row.location_region ||
    TIDE_REFERENCE_REGION_BY_DATASET[datasetKey] ||
    TIDE_REFERENCE_REGION_BY_LOCATION[locationKey] ||
    ""
  );
}

function canReadSupabase() {
  return isSeaweedHarvestPlatform()
    || APP_CONFIG.supabase.enabled === true
    || APP_CONFIG.supabase.publicReadsEnabled === true;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeLocationSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function readJsonCache(key) {
  if (typeof window === "undefined" || !window.localStorage) return null;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Public data cache read failed.", error);
    return null;
  }
}

function writeJsonCache(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Public data cache write failed.", error);
  }
}
