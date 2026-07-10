export const APP_CONFIG = {
  appName: "Seaweed Aggregation",
  backendContext: "v1_Ag_System",
  supabase: {
    enabled: true,
    projectName: "v1_Ag_System",
    projectRef: "wwzmajhdusfyfskppupg",
    url: "https://wwzmajhdusfyfskppupg.supabase.co",
    restUrl: "https://wwzmajhdusfyfskppupg.supabase.co/rest/v1",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3em1hamhkdXNmeWZza3BwdXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDY5MzQsImV4cCI6MjA5ODE4MjkzNH0.9W8zCF8cTjWn6ArYaJmvRNX9_wDlwsOLMDi8yh5c998"
  },
  auth: {
    providers: {
      google: false,
      facebook: false
    }
  },
  tables: {
    communities: "ag_public_communities",
    farmers: "farmers",
    collections: "collections"
  },
  pricePerKg: {
    A: 12,
    B: 8,
    C: 0
  },
  previewData: {
    communities: [
      {
        id: "preview-community-1200",
        community_id: "CID1200",
        community_name: "Shimoni Seaweed Group",
        gps_latitude: -4.646,
        gps_longitude: 39.381,
        chair_person: "Sample Chair",
        chair_person_contact: "+254700000001"
      },
      {
        id: "preview-community-1201",
        community_id: "CID1201",
        community_name: "Mkwiro Seaweed Group",
        gps_latitude: -4.672,
        gps_longitude: 39.391,
        chair_person: "Sample Chair 2",
        chair_person_contact: "+254700000002"
      }
    ],
    farmers: [
      {
        id: "preview-farmer-4300",
        farmer_id: "RID4300",
        name: "Sample Farmer One",
        phone: "+254711000001",
        community_id: "CID1200",
        etims_status: "unknown",
        farm_size_value: 24,
        farm_size_unit: "lines",
        farm_size_updated_at: "2026-06-20T09:00:00+03:00"
      },
      {
        id: "preview-farmer-4301",
        farmer_id: "RID4301",
        name: "Sample Farmer Two",
        phone: "+254711000002",
        community_id: "CID1200",
        etims_status: "no",
        farm_size_value: 36,
        farm_size_unit: "lines",
        farm_size_updated_at: "2026-06-21T09:00:00+03:00"
      },
      {
        id: "preview-farmer-4302",
        farmer_id: "RID4302",
        name: "Sample Farmer Three",
        phone: "+254711000003",
        community_id: "CID1201",
        etims_status: "yes",
        farm_size_value: 18,
        farm_size_unit: "lines",
        farm_size_updated_at: "2026-06-22T09:00:00+03:00"
      }
    ]
  }
};
