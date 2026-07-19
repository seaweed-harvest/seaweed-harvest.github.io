export const DASHBOARD_OPTIONS = {
  admin: [
    { key: "total_kg", label: "Total weight" },
    { key: "quality_totals", label: "Accepted and rejected weight" },
    { key: "estimated_ksh", label: "Estimated value" },
    { key: "grade_breakdown", label: "Grade weights" },
    { key: "collection_counts", label: "Collection counts" },
    { key: "active_network", label: "Active members and communities" },
    { key: "last_collection", label: "Last collection" },
    { key: "missing_ids", label: "Missing ID checks" },
    { key: "community_totals", label: "Community totals" }
  ],
  collector: [
    { key: "today", label: "Today's collections" },
    { key: "month", label: "This month's collections" },
    { key: "all_time", label: "All-time collections" },
    { key: "last_collection", label: "Last collection" },
    { key: "recent_records", label: "Recent records" }
  ],
  farmer: [
    { key: "farm_profile", label: "Community and farm size" },
    { key: "total_kg", label: "Total harvested" },
    { key: "grade_breakdown", label: "Grade weights" },
    { key: "estimated_ksh", label: "Estimated value" },
    { key: "collection_count", label: "Collection count" },
    { key: "last_collection", label: "Last collection" },
    { key: "recent_records", label: "Harvest records" }
  ]
};

export function dashboardKind(profile) {
  if (profile?.app_role === "farmer_viewer") return "farmer";
  if (profile?.app_role === "field_collector") return "collector";
  if (profile?.can_access_admin || profile?.can_view_dashboard || profile?.app_role === "system_admin") return "admin";
  return profile?.can_submit_collection ? "collector" : null;
}

export function dashboardSelection(profile) {
  const kind = dashboardKind(profile);
  if (!kind) return { kind: null, options: [], selected: [] };
  const options = DASHBOARD_OPTIONS[kind];
  const allowed = new Set(options.map((option) => option.key));
  const stored = profile?.dashboard_preferences?.[kind];
  const selected = Array.isArray(stored) ? stored.filter((key) => allowed.has(key)) : [];
  return {
    kind,
    options,
    selected: selected.length ? selected : options.map((option) => option.key)
  };
}

export function applyDashboardPreferences(profile, root = document) {
  const { selected } = dashboardSelection(profile);
  const visible = new Set(selected);
  root.querySelectorAll("[data-dashboard-widget]").forEach((element) => {
    element.hidden = !visible.has(element.dataset.dashboardWidget);
  });
}

export async function saveDashboardPreferences(client, widgets) {
  const { data, error } = await client.rpc("ag_update_my_dashboard_preferences", {
    p_widgets: widgets
  });
  if (error) throw error;
  return data;
}
