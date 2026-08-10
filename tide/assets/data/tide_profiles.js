export const TIDE_PROFILES = {
  kenya_mombasa_reference: {
    key: "kenya_mombasa_reference",
    name: "Mombasa / Kenya Coast Reference",
    timezone: "Africa/Nairobi",
    datumLabel: "Prototype chart datum metadata pending",
    meanLevelM: 2.0,
    defaultHarvestThresholdM: 0.7,
    sourceName: "IOC Intergovernmental Oceanographic Commission - Sea Level Station Monitoring Facility",
    sourceUrl: "https://www.ioc-sealevelmonitoring.org/",
    verificationStatus: "planning_guidance_unverified",
    verificationLabel: "Planning guidance - not locally verified",
    version: "prototype-harmonic-2026-06-09",
    validFrom: null,
    validTo: null,
    warningText: "Uses a Mombasa/Kenya coast harmonic reference profile until farm-location calibration and local verification are complete.",
    constituents: [
      { id: "M2", amp: 1.14, phase: 28 },
      { id: "S2", amp: 0.58, phase: 59 },
      { id: "N2", amp: 0.24, phase: 8 },
      { id: "K1", amp: 0.23, phase: 206 },
      { id: "O1", amp: 0.12, phase: 176 },
      { id: "P1", amp: 0.08, phase: 206 },
      { id: "K2", amp: 0.16, phase: 59 }
    ]
  },
  fremantle_reference: {
    key: "fremantle_reference",
    name: "Fremantle, Western Australia Reference",
    timezone: "Australia/Perth",
    datumLabel: "Prototype chart datum metadata pending",
    meanLevelM: 0.8,
    defaultHarvestThresholdM: 0.5,
    sourceName: "Australian Bureau of Meteorology / National Tidal Centre - Australian National Tide Tables",
    sourceUrl: "https://www.bom.gov.au/oceanography/tides/",
    verificationStatus: "reference_only",
    verificationLabel: "Reference profile - not a Kenya farming location",
    version: "prototype-harmonic-2026-06-09",
    validFrom: null,
    validTo: null,
    warningText: "Included only as a regression/reference profile from the Seaweed Station tide implementation.",
    constituents: [
      { id: "M2", amp: 0.158, phase: 211 },
      { id: "S2", amp: 0.059, phase: 240 },
      { id: "N2", amp: 0.033, phase: 199 },
      { id: "K1", amp: 0.169, phase: 108 },
      { id: "O1", amp: 0.102, phase: 91 },
      { id: "P1", amp: 0.055, phase: 108 },
      { id: "K2", amp: 0.016, phase: 240 }
    ]
  }
};
