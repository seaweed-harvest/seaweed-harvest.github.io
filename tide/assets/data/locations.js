export const TIDE_LOCATIONS = [
  {
    key: "kenya-coast",
    name: "Kenya Coast Reference",
    shortName: "Kenya Coast",
    region: "Southeast Kenya",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: null,
    gpsLabel: "Farm GPS location to be confirmed",
    status: "prototype_reference",
    notes: "Uses the Mombasa/Kenya coast reference profile until farm-specific calibration is available."
  },
  {
    key: "funzi",
    name: "Funzi Farm Area",
    shortName: "Funzi",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.581417,
      lon: 39.437528
    },
    gpsLabel: "4 deg 34 min 53.1 sec S, 39 deg 26 min 15.1 sec E",
    status: "prototype_placeholder",
    notes: "Farm GPS supplied 2026-06-11. Tide timing currently follows the Mombasa/Kenya coast reference profile."
  },
  {
    key: "shangani",
    name: "Shangani Farm Area",
    shortName: "Shangani",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.452111,
      lon: 39.497472
    },
    gpsLabel: "4 deg 27 min 07.6 sec S, 39 deg 29 min 50.9 sec E",
    status: "prototype_placeholder",
    notes: "Farm GPS supplied 2026-06-11. Tide timing currently follows the Mombasa/Kenya coast reference profile."
  },
  {
    key: "amka-utsamba",
    name: "Amka Utsamba",
    shortName: "Amka Utsamba",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.624165,
      lon: 39.342449
    },
    gpsLabel: "Mean of 34 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "bati",
    name: "Bati Seaweed Group",
    shortName: "Bati",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.601687,
      lon: 39.39755
    },
    gpsLabel: "Mean of 61 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "chiromo",
    name: "Chiromo Seaweed Farmers",
    shortName: "Chiromo",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.626419,
      lon: 39.320261
    },
    gpsLabel: "Mean of 61 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "daima",
    name: "Daima Self Help Group",
    shortName: "Daima",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.638397,
      lon: 39.329149
    },
    gpsLabel: "Mean of 25 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "furaha",
    name: "Furaha Seaweed Group",
    shortName: "Furaha",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.576657,
      lon: 39.429896
    },
    gpsLabel: "Mean of 39 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "imani",
    name: "Imani Seaweed Farmers Gazi",
    shortName: "Imani",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.425699,
      lon: 39.513782
    },
    gpsLabel: "Mean of 36 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "jikaze",
    name: "Jikaze",
    shortName: "Jikaze",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.531268,
      lon: 39.42764
    },
    gpsLabel: "Mean of 22 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "jimbo",
    name: "Jimbo Youth Group",
    shortName: "Jimbo",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.677668,
      lon: 39.218908
    },
    gpsLabel: "Mean of 37 collection GPS point(s); Review spread",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "kibuyuni",
    name: "Kibuyuni Seaweed Farmers Cooperative",
    shortName: "Kibuyuni",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.642045,
      lon: 39.340097
    },
    gpsLabel: "Mean of 65 collection GPS point(s); Review spread",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "kijiweni",
    name: "Kijiweni Self Help Group",
    shortName: "Kijiweni",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.640823,
      lon: 39.3562
    },
    gpsLabel: "Mean of 29 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "mkwiro",
    name: "Mkwiro Seaweed Development Group",
    shortName: "Mkwiro",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.672221,
      lon: 39.394254
    },
    gpsLabel: "Mean of 78 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "mtimbwani",
    name: "Mtimbwani Seaweed",
    shortName: "Mtimbwani",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.60969,
      lon: 39.298803
    },
    gpsLabel: "Mean of 36 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "nuru",
    name: "Nuru Isamic",
    shortName: "Nuru",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.635926,
      lon: 39.323294
    },
    gpsLabel: "Mean of 23 collection GPS point(s); Review spread",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "shangani-amani",
    name: "Shangani Amani Enterprises",
    shortName: "Shangani Amani",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.452955,
      lon: 39.499213
    },
    gpsLabel: "Mean of 35 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "siwema",
    name: "Siwema Environmental Conservation Group",
    shortName: "Siwema",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.531109,
      lon: 39.427517
    },
    gpsLabel: "Mean of 16 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "tumbe",
    name: "Tumbe Seaweed Farmers",
    shortName: "Tumbe",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.462999,
      lon: 39.502226
    },
    gpsLabel: "Mean of 43 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "tunusuru",
    name: "Tunusuru Conservation Group",
    shortName: "Tunusuru",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.530221,
      lon: 39.466326
    },
    gpsLabel: "Mean of 31 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "tushirikiane",
    name: "Tushirikiane Conservation",
    shortName: "Tushirikiane",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.549433,
      lon: 39.425106
    },
    gpsLabel: "Mean of 57 collection GPS point(s); High spread / possible outlier",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records. Source export name: Tushirikiane Conservation Women."
  },
  {
    key: "wasini",
    name: "Wasini Seaweed Group",
    shortName: "Wasini",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.649995,
      lon: 39.359237
    },
    gpsLabel: "Mean of 51 collection GPS point(s); Review spread",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "yungi-mwenjeni",
    name: "Yungi Mwenjeni Conservation Group",
    shortName: "Yungi Mwenjeni",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: {
      lat: -4.584328,
      lon: 39.311055
    },
    gpsLabel: "Mean of 42 collection GPS point(s); Tight cluster",
    status: "active",
    notes: "Farm community location generated from monthly seaweed collection records."
  },
  {
    key: "mwazaro-beach-lodge",
    name: "Mwazaro Beach Lodge",
    shortName: "Mwazaro Lodge",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.4,
    locationType: "lodge",
    gps: {
      lat: -4.597372,
      lon: 39.392824
    },
    gpsLabel: "Public listing coordinates for Mwazaro Beach Lodge; verify locally before field use",
    status: "active",
    notes: "Lodge/tide-monitoring location near Shimoni. Tide timing currently follows the Mombasa/Kenya coast reference dataset."
  },
  {
    key: "shimoni",
    name: "Shimoni Farm Area",
    shortName: "Shimoni",
    region: "Kwale County",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    tideProfileKey: "kenya_mombasa_reference",
    defaultTideDatasetKey: "kmfri_2026_mombasa",
    defaultHarvestThresholdM: 0.7,
    gps: null,
    gpsLabel: "GPS to be confirmed by local operator",
    status: "prototype_placeholder",
    notes: "Placeholder farm-location record. Tide timing currently follows the Mombasa/Kenya coast reference profile."
  },
  {
    key: "fremantle",
    name: "Fremantle Reference",
    shortName: "Fremantle",
    region: "Western Australia",
    country: "Australia",
    timezone: "Australia/Perth",
    tideProfileKey: "fremantle_reference",
    defaultTideDatasetKey: "fremantle_reference",
    defaultHarvestThresholdM: 0.5,
    gps: null,
    gpsLabel: "Reference only",
    status: "reference_only",
    notes: "Reference profile from the original Seaweed Station dashboard tide implementation."
  }
];
