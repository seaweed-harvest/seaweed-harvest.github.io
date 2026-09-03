import { DRYING_FORM_CONFIG as CONFIG } from "./dryer_table_config.js?v=2";

export const LEGACY_DRYER_SHED_CODE = "bati-dryer-shed";
export const DRYER_SHED_TABLES = Object.freeze([
  Object.freeze({
    value: "bati-dryer-shed-t1",
    label: "Dryer Shed - T1",
    stationUid: "ST-0102",
    bayCount: 1,
    noConfiguration: true
  }),
  Object.freeze({
    value: "bati-dryer-shed-t2",
    label: "Dryer Shed - T2",
    stationUid: "ST-0102",
    bayCount: 1,
    noConfiguration: true
  }),
  Object.freeze({
    value: "bati-dryer-shed-t3",
    label: "Dryer Shed - T3",
    stationUid: "ST-0102",
    bayCount: 1,
    noConfiguration: true
  })
]);

const SHED_CODES = new Set([
  LEGACY_DRYER_SHED_CODE,
  ...DRYER_SHED_TABLES.map((location) => location.value)
]);

let setupComplete = false;
let resync = null;

prepareLocationConfig();
prepareLocationOptions();
prepareConfigurationOption();

export function setupDryerShedLocations() {
  prepareLocationConfig();
  prepareLocationOptions();
  const locationSelect = document.getElementById("dryerLocation");
  const configurationSelect = document.getElementById("dryingConfiguration");
  const form = document.getElementById("dryingForm");
  if (!locationSelect || !configurationSelect) return;

  if (setupComplete) {
    resync?.();
    return;
  }

  const noConfigurationOption = prepareConfigurationOption();
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeGet = valueDescriptor?.get;
  const nativeSet = valueDescriptor?.set;

  const sync = () => {
    prepareLocationOptions();
    updateLocationOptionLabels();
    if (!noConfigurationOption) return;

    noConfigurationOption.textContent = isSwahili()
      ? "Hakuna mpangilio"
      : "No configuration";

    const shedSelected = SHED_CODES.has(readSelectValue(locationSelect, nativeGet));
    noConfigurationOption.hidden = !shedSelected;
    configurationSelect.disabled = shedSelected;

    const currentConfiguration = readSelectValue(configurationSelect, nativeGet);
    if (shedSelected) {
      writeSelectValue(configurationSelect, "no_configuration", nativeSet);
    } else if (currentConfiguration === "no_configuration") {
      writeSelectValue(configurationSelect, "", nativeSet);
    }

    const field = configurationSelect.closest(".required-field");
    field?.classList.toggle(
      "is-filled",
      shedSelected || Boolean(readSelectValue(configurationSelect, nativeGet).trim())
    );
  };

  if (nativeGet && nativeSet) {
    Object.defineProperty(locationSelect, "value", {
      configurable: true,
      get() {
        return nativeGet.call(locationSelect);
      },
      set(value) {
        nativeSet.call(locationSelect, value);
        queueMicrotask(sync);
      }
    });

    Object.defineProperty(configurationSelect, "value", {
      configurable: true,
      get() {
        return nativeGet.call(configurationSelect);
      },
      set(value) {
        const nextValue = SHED_CODES.has(nativeGet.call(locationSelect))
          ? "no_configuration"
          : value;
        nativeSet.call(configurationSelect, nextValue);
      }
    });
  }

  locationSelect.addEventListener("change", sync);
  form?.addEventListener("reset", () => queueMicrotask(sync));
  document.addEventListener("seaweed-drying-language-change", sync);

  setupComplete = true;
  resync = sync;
  sync();
}

export function isDryerShedLocation(value) {
  return SHED_CODES.has(String(value || ""));
}

function prepareLocationConfig() {
  const locations = CONFIG.locations;
  if (!Array.isArray(locations)) return;

  const firstShedIndex = locations.findIndex((location) => SHED_CODES.has(location?.value));
  const legacySource = locations.find((location) => location?.value === LEGACY_DRYER_SHED_CODE);
  const remaining = locations.filter((location) => !SHED_CODES.has(location?.value));
  const fallbackIndex = remaining.findIndex((location) => location?.value === "shangani-table-1");
  const insertAt = firstShedIndex >= 0
    ? Math.min(firstShedIndex, remaining.length)
    : (fallbackIndex >= 0 ? fallbackIndex : remaining.length);
  const legacyLocation = {
    value: LEGACY_DRYER_SHED_CODE,
    label: "Dryer Shed",
    translationKey: "location.dryerShed",
    stationUid: "ST-0102",
    bayCount: 1,
    noConfiguration: true,
    legacy: true,
    ...(legacySource || {})
  };
  legacyLocation.noConfiguration = true;
  legacyLocation.legacy = true;

  locations.splice(
    0,
    locations.length,
    ...remaining.slice(0, insertAt),
    ...DRYER_SHED_TABLES.map((location) => ({ ...location })),
    legacyLocation,
    ...remaining.slice(insertAt)
  );
}

function prepareLocationOptions() {
  const select = document.getElementById("dryerLocation");
  if (!select) return;

  let legacyOption = findOption(select, LEGACY_DRYER_SHED_CODE);
  if (!legacyOption) {
    legacyOption = document.createElement("option");
    legacyOption.value = LEGACY_DRYER_SHED_CODE;
    select.append(legacyOption);
  }
  legacyOption.textContent = isSwahili() ? "Banda la Kukaushia" : "Dryer Shed";
  legacyOption.hidden = true;
  legacyOption.dataset.legacyDryerShed = "true";

  DRYER_SHED_TABLES.forEach((location) => {
    let option = findOption(select, location.value);
    if (!option) {
      option = document.createElement("option");
      option.value = location.value;
    }
    option.hidden = false;
    option.dataset.dryerShedTable = location.value.slice(-2).toUpperCase();
    option.textContent = localizedLocationLabel(location.value);
    select.insertBefore(option, legacyOption);
  });
}

function updateLocationOptionLabels() {
  const select = document.getElementById("dryerLocation");
  if (!select) return;
  DRYER_SHED_TABLES.forEach((location) => {
    const option = findOption(select, location.value);
    if (option) option.textContent = localizedLocationLabel(location.value);
  });
  const legacyOption = findOption(select, LEGACY_DRYER_SHED_CODE);
  if (legacyOption) {
    legacyOption.textContent = isSwahili() ? "Banda la Kukaushia" : "Dryer Shed";
    legacyOption.hidden = true;
  }
}

function prepareConfigurationOption() {
  const select = document.getElementById("dryingConfiguration");
  if (!select) return null;
  let option = findOption(select, "no_configuration");
  if (!option) {
    option = document.createElement("option");
    option.value = "no_configuration";
    select.append(option);
  }
  option.textContent = isSwahili() ? "Hakuna mpangilio" : "No configuration";
  option.hidden = !SHED_CODES.has(selectValue(document.getElementById("dryerLocation")));
  return option;
}

function localizedLocationLabel(value) {
  const suffix = value.endsWith("t1") ? "T1" : value.endsWith("t2") ? "T2" : "T3";
  return `${isSwahili() ? "Banda la Kukaushia" : "Dryer Shed"} - ${suffix}`;
}

function isSwahili() {
  return document.body?.dataset.language === "sw";
}

function findOption(select, value) {
  return [...select.options].find((option) => option.value === value) || null;
}

function selectValue(select) {
  return select ? String(select.value || "") : "";
}

function readSelectValue(select, nativeGet) {
  return String(nativeGet ? nativeGet.call(select) : select.value || "");
}

function writeSelectValue(select, value, nativeSet) {
  if (nativeSet) nativeSet.call(select, value);
  else select.value = value;
}
