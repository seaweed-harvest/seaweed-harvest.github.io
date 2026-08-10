export const APP_CONFIG = {
  appName: "Seaweed Tide Planner",
  shortName: "Tide Planner",
  deploymentMode: "static-github-pages-prototype",
  basePath: "./",
  assetBasePath: "./assets/",
  backendContext: "V0_Tide_Planner",
  dataMode: "supabase-public-read-with-static-fallback",
  supabase: {
    projectName: "V0_Tide_Planner",
    projectRef: "iztlyyavbdgfqfymqwzz",
    url: "https://iztlyyavbdgfqfymqwzz.supabase.co",
    restUrl: "https://iztlyyavbdgfqfymqwzz.supabase.co/rest/v1",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dGx5eWF2YmRnZnFmeW1xd3p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5ODA4NDYsImV4cCI6MjA5NjU1Njg0Nn0.9vQi7O7uCXxqyjOTwxNJypjpCuyXE_kh-TvVOiRS6Hc",
    enabled: false,
    publicReadsEnabled: true
  },
  weatherAlerts: {
    edgeRefreshEnabled: false
  },
  defaultLocationKey: "kenya-coast",
  defaultLocale: "en-GB",
  storageKeys: {
    selectedLocation: "seaweed_tide_planner:selected_location",
    thresholdPrefix: "seaweed_tide_planner:threshold:",
    thresholdEnabledPrefix: "seaweed_tide_planner:threshold_enabled:"
  }
};
