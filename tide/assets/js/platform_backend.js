import { APP_CONFIG } from "./config.js?v=20260723-table-harvest-align";

const TIDE_ROLE_RANK = Object.freeze({ user: 10, operator: 20, admin: 30 });

export function isSeaweedHarvestPlatform() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === "/tide"
    || window.location.pathname.startsWith("/tide/");
}

export function tideBackendTables() {
  if (isSeaweedHarvestPlatform()) {
    return {
      locations: "tide_location_context",
      locationAdmin: "tide_locations",
      datasets: "tide_datasets",
      events: "tide_events",
      hourlyPredictions: "tide_hourly_predictions",
      observations: "tide_location_observations",
      calibrations: "tide_location_calibrations",
      calibrationSummary: "tide_location_calibration_admin_summary",
      datasetSummary: "tide_dataset_summary",
      weather: "tide_weather_alert_status"
    };
  }

  return {
    locations: "farm_locations",
    locationAdmin: "farm_locations",
    datasets: "tide_datasets",
    events: "tide_events",
    hourlyPredictions: "tide_hourly_predictions",
    observations: "location_tide_observations",
    calibrations: "location_tide_calibrations",
    calibrationSummary: "location_tide_calibration_admin_summary",
    datasetSummary: "tide_dataset_summary",
    weather: "public_weather_alert_status"
  };
}

export function tideRoleRank(role) {
  return TIDE_ROLE_RANK[String(role || "").trim().toLowerCase()] || 0;
}

export async function requireTidePlatformRole(minimumRole = "user", force = false) {
  if (!isSeaweedHarvestPlatform()) return null;

  const [auth, access] = await Promise.all([
    import("/assets/js/auth_client.js?v=22"),
    import("/assets/js/platform_access.js?v=1")
  ]);
  const session = await auth.currentSession();
  if (!session?.user || !session?.access_token) {
    throw new Error("Seaweed Harvest sign-in is required for Tide access.");
  }

  const grant = await access.applicationAccess("tide", force);
  if (!grant?.role || tideRoleRank(grant.role) < tideRoleRank(minimumRole)) {
    const label = minimumRole === "admin" ? "administrator" : minimumRole;
    throw new Error(`Tide ${label} access is required for this page.`);
  }

  return { session, grant };
}

export async function tideBackendContext() {
  if (!isSeaweedHarvestPlatform()) {
    return {
      mode: "legacy-v0",
      projectRef: APP_CONFIG.supabase.projectRef,
      url: APP_CONFIG.supabase.url,
      restUrl: APP_CONFIG.supabase.restUrl,
      anonKey: APP_CONFIG.supabase.anonKey,
      accessToken: APP_CONFIG.supabase.anonKey,
      userId: null,
      role: null
    };
  }

  const [{ APP_CONFIG: platformConfig }, access] = await Promise.all([
    import("/assets/js/config.js"),
    requireTidePlatformRole("user")
  ]);
  const { session, grant } = access;

  return {
    mode: "seaweed-harvest-platform",
    projectRef: platformConfig.supabase.projectRef,
    url: platformConfig.supabase.url,
    restUrl: platformConfig.supabase.restUrl,
    anonKey: platformConfig.supabase.anonKey,
    accessToken: session.access_token,
    userId: session.user.id,
    role: grant.role
  };
}

export async function tideSupabaseHeaders(extraHeaders = {}) {
  const backend = await tideBackendContext();
  return {
    apikey: backend.anonKey,
    Authorization: `Bearer ${backend.accessToken}`,
    ...extraHeaders
  };
}
