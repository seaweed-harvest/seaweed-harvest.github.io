export const DRYING_FORM_CONFIG = Object.freeze({
  appName: "Seaweed Harvest",
  supabaseUrl: "https://iyoihlwtvdshtlzjdoed.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5b2lobHd0dmRzaHRsempkb2VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTA4MTksImV4cCI6MjA5MjI4NjgxOX0.i3jy8WlSF72v7Ypb2ulkL12EJaDfGcDYbdiC--PgjOc",
  photoBucket: "seaweed-drying-photos",
  submitRpc: "submit_seaweed_drying_observation",
  attachPhotosRpc: "attach_seaweed_drying_photos",
  listRecordsRpc: "list_seaweed_drying_records",
  adminAuthRpc: "dashboard_authenticate_access_role",
  deleteRecordsRpc: "delete_seaweed_drying_records",
  getRecordRpc: "get_seaweed_drying_record",
  claimRecordRpc: "claim_seaweed_drying_record",
  getTrialsRpc: "get_seaweed_drying_trial_schedule",
  updateTrialsRpc: "update_seaweed_drying_trial_schedule",
  draftStorageKey: "seaweed_drying_form_draft_v1",
  recordTokensStorageKey: "seaweed_drying_record_tokens_v1",
  enumeratorStorageKey: "seaweed_drying_enumerator_v1",
  languageStorageKey: "seaweed_drying_language",
  source: "seaweed_harvest_cosme",
  clientVersion: "2026-07-26.1",
  maxPhotoBytes: 8 * 1024 * 1024,
  photoTargetBytes: 850 * 1024,
  maxPhotoDimension: 1600,
  locations: [
    {
      value: "bati-table-1",
      label: "Bati (Table 1)",
      translationKey: "location.bati1",
      stationUid: "ST-0102",
      bayCount: 8
    },
    {
      value: "bati-table-2",
      label: "Bati (Table 2)",
      translationKey: "location.bati2",
      stationUid: "ST-0102",
      bayCount: 8
    },
    {
      value: "bati-table-3",
      label: "Bati (Table 3)",
      translationKey: "location.bati3",
      stationUid: "ST-0102",
      bayCount: 8
    },
    {
      value: "bati-table-4",
      label: "Bati (Table 4)",
      translationKey: "location.bati4",
      stationUid: "ST-0102",
      bayCount: 8
    },
    {
      value: "bati-dryer-shed",
      label: "Dryer Shed",
      translationKey: "location.dryerShed",
      stationUid: "ST-0102",
      bayCount: 1
    },
    {
      value: "shangani-table-1",
      label: "Shangani (Table 1)",
      translationKey: "location.shangani1",
      stationUid: "ST-0003",
      bayCount: 8
    }
  ],
  trials: [
    {
      trialCode: "BATI-TRIAL-1",
      site: "bati",
      trialNumber: 1,
      startDate: "2026-07-14",
      finishDate: "2026-07-17",
      assignments: [
        { table: "Bati (Table 1)", configuration: "cover_open_back_open" },
        { table: "Bati (Table 2)", configuration: "cover_down_back_closed" },
        { table: "Bati (Table 3)", configuration: "cover_down_back_open" },
        { table: "Solar Shed", collectionOnly: true }
      ]
    },
    {
      trialCode: "BATI-TRIAL-2",
      site: "bati",
      trialNumber: 2,
      startDate: "2026-07-29",
      finishDate: "2026-08-02",
      assignments: [
        { table: "Bati (Table 1)", configuration: "cover_down_back_closed" },
        { table: "Bati (Table 2)", configuration: "cover_down_back_open" },
        { table: "Bati (Table 3)", configuration: "cover_open_back_open" },
        { table: "Solar Shed", collectionOnly: true }
      ]
    },
    {
      trialCode: "BATI-TRIAL-3",
      site: "bati",
      trialNumber: 3,
      startDate: "2026-08-12",
      finishDate: "2026-08-15",
      assignments: [
        { table: "Bati (Table 1)", configuration: "cover_down_back_open" },
        { table: "Bati (Table 2)", configuration: "cover_open_back_open" },
        { table: "Bati (Table 3)", configuration: "cover_down_back_closed" },
        { table: "Solar Shed", collectionOnly: true }
      ]
    }
  ]
});
