import { DRYING_FORM_CONFIG as CONFIG } from "./dryer_table_config.js?v=2";
import {
  configurationParts,
  getLocale,
  initDryingLanguage,
  t,
  tableLabel
} from "./dryer_table_language.js?v=2";

const $ = (id) => document.getElementById(id);

const els = {
  form: $("dryingForm"),
  formPanel: $("formPanel"),
  website: $("website"),
  dryerLocation: $("dryerLocation"),
  enumeratorName: $("enumeratorName"),
  enumeratorId: $("enumeratorId"),
  rememberEnumerator: $("rememberEnumerator"),
  dryingConfiguration: $("dryingConfiguration"),
  tablePhotos: $("tablePhotos"),
  tablePhotoPreview: $("tablePhotoPreview"),
  bayProgress: $("bayProgress"),
  capturePhaseTabs: $("capturePhaseTabs"),
  loadingPhaseTab: $("loadingPhaseTab"),
  unloadingPhaseTab: $("unloadingPhaseTab"),
  loadingPhasePanel: $("loadingPhasePanel"),
  unloadingPhasePanel: $("unloadingPhasePanel"),
  loadingCaptureWeight: $("loadingCaptureWeight"),
  loadingWeightSplit: $("loadingWeightSplit"),
  loadingCaptureAt: $("loadingCaptureAt"),
  loadingCaptureWeather: $("loadingCaptureWeather"),
  loadingBaySelector: $("loadingBaySelector"),
  loadingCapturePhotos: $("loadingCapturePhotos"),
  loadingCapturePhotoPreview: $("loadingCapturePhotoPreview"),
  saveLoadingCapture: $("saveLoadingCapture"),
  unloadingCaptureWeight: $("unloadingCaptureWeight"),
  unloadingWeightSplit: $("unloadingWeightSplit"),
  unloadingCaptureAt: $("unloadingCaptureAt"),
  unloadingCaptureWeather: $("unloadingCaptureWeather"),
  unloadingBaySelector: $("unloadingBaySelector"),
  unloadingCapturePhotos: $("unloadingCapturePhotos"),
  unloadingCapturePhotoPreview: $("unloadingCapturePhotoPreview"),
  saveUnloadingCapture: $("saveUnloadingCapture"),
  savedCaptureList: $("savedCaptureList"),
  baySummaryBody: $("baySummaryBody"),
  generalObservations: $("generalObservations"),
  workingWell: $("workingWell"),
  notWorking: $("notWorking"),
  saveStatus: $("saveStatus"),
  clearForm: $("clearForm"),
  submitForm: $("submitForm"),
  successPanel: $("successPanel"),
  successSummary: $("successSummary"),
  receiptNumber: $("receiptNumber"),
  receiptLocation: $("receiptLocation"),
  receiptBays: $("receiptBays"),
  receiptPhotos: $("receiptPhotos"),
  newRecord: $("newRecord"),
  topNewRecord: $("topNewRecord"),
  topPrintPdf: $("topPrintPdf"),
  activeRecordBanner: $("activeRecordBanner"),
  activeReceiptNumber: $("activeReceiptNumber"),
  activeRecordStatus: $("activeRecordStatus"),
  recordsStatus: $("recordsStatus"),
  recordsList: $("recordsList"),
  refreshRecords: $("refreshRecords"),
  recordsRaId: $("recordsRaId"),
  openRecordsDelete: $("openRecordsDelete"),
  recordsDeleteBar: $("recordsDeleteBar"),
  recordsDeleteCount: $("recordsDeleteCount"),
  cancelRecordsDelete: $("cancelRecordsDelete"),
  deleteSelectedRecords: $("deleteSelectedRecords"),
  recordsSelectHeading: $("recordsSelectHeading"),
  recordsDeleteDialog: $("recordsDeleteDialog"),
  recordsDeleteAuthForm: $("recordsDeleteAuthForm"),
  recordsDeletePassword: $("recordsDeletePassword"),
  recordsDeleteAuthError: $("recordsDeleteAuthError"),
  cancelRecordsDeleteAuth: $("cancelRecordsDeleteAuth"),
  authorizeRecordsDelete: $("authorizeRecordsDelete"),
  batiTrialsBody: $("batiTrialsBody"),
  trialSaveStatus: $("trialSaveStatus"),
  dryingPhotoActions: $("dryingPhotoActions"),
  dryingPhotoActionPreview: $("dryingPhotoActionPreview"),
  dryingPhotoActionName: $("dryingPhotoActionName"),
  retakeDryingPhoto: $("retakeDryingPhoto"),
  deleteDryingPhoto: $("deleteDryingPhoto"),
  cancelDryingPhotoAction: $("cancelDryingPhotoAction"),
  dryingPhotoRetake: $("dryingPhotoRetake")
};

const draftControls = [...document.querySelectorAll("[data-draft]")];
const TABLE_PHOTO_LIMIT = 1;
const PHASE_PHOTO_LIMIT = 2;

let state = freshState();
let draftTimer = null;

initialize();

function freshState() {
  return {
    bayCount: 8,
    bays: {},
    activeCapturePhase: "loading",
    selectedBays: { loading: [], unloading: [] },
    editingCaptureBays: { loading: [], unloading: [] },
    files: { table: [], captures: { loading: [], unloading: [] } },
    submissionId: null,
    uploadToken: null,
    receiptNumber: null,
    recordedAt: null,
    recordStatus: "in_progress",
    savedPhotos: { table: 0, bays: {} },
    photoAction: { context: null, index: null, objectUrl: null, retakeContext: null, retakeIndex: null },
    records: [],
    recordsLoading: false,
    recordOpening: false,
    recordsStatusKey: "records.loading",
    recordsStatusArgs: {},
    recordsStatusError: false,
    recordsDeleteMode: false,
    recordsDeletePassword: "",
    selectedDeleteReceipts: new Set(),
    recordsDeleteAuthenticating: false,
    recordsDeleting: false,
    submitting: false,
    trials: CONFIG.trials.map((trial) => ({
      ...trial,
      assignments: trial.assignments.map((assignment) => ({ ...assignment })),
      startDate: trial.startDate || "",
      finishDate: trial.finishDate || "",
      completed: false
    }))
  };
}

function initialize() {
  initDryingLanguage();
  restoreDraft();
  loadRememberedEnumerator();
  bindEvents();
  applyLocationSelection(false);
  renderAll();
  renderTrials();
  loadTrialSchedule();
  loadRecords();
  updateRequiredFieldStates();
}

function bindEvents() {
  els.dryerLocation.addEventListener("change", () => {
    applyLocationSelection(true);
    scheduleDraftSave();
  });

  draftControls.forEach((control) => {
    const eventName = control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, scheduleDraftSave);
  });

  els.rememberEnumerator.addEventListener("change", updateRememberedEnumerator);
  [els.enumeratorName, els.enumeratorId].forEach((control) => {
    control.addEventListener("input", () => {
      if (els.rememberEnumerator.checked) saveRememberedEnumerator();
      if (control === els.enumeratorId && !els.recordsRaId.value.trim()) {
        els.recordsRaId.value = control.value;
      }
    });
  });

  els.tablePhotos.addEventListener("change", () => addSelectedPhotos({ kind: "table" }));
  els.capturePhaseTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-capture-phase]");
    if (tab) setActiveCapturePhase(tab.dataset.capturePhase);
  });
  els.capturePhaseTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const phase = ["ArrowRight", "End"].includes(event.key) ? "unloading" : "loading";
    setActiveCapturePhase(phase, { focus: true });
  });

  ["loading", "unloading"].forEach((phase) => {
    const input = captureElement(phase, "Photos");
    captureElement(phase, "Weight").addEventListener("input", () => renderWeightSplit(phase));
    input.addEventListener("change", () => addSelectedPhotos({ kind: "capture", phase }));
    captureElement(phase, "BaySelector").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-bay]");
      if (button) toggleCaptureBay(phase, Number(button.dataset.bay));
    });
    captureElement(phase, "Save").addEventListener("click", () => saveBatchCapture(phase));
  });
  els.savedCaptureList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-edit-bays][data-edit-phase]");
    if (!button) return;
    editCaptureGroup(
      button.dataset.editPhase,
      button.dataset.editBays.split(",").map(Number)
    );
  });

  els.retakeDryingPhoto.addEventListener("click", beginDryingPhotoRetake);
  els.deleteDryingPhoto.addEventListener("click", deleteActiveDryingPhoto);
  els.cancelDryingPhotoAction.addEventListener("click", closeDryingPhotoActions);
  els.dryingPhotoRetake.addEventListener("change", replaceDryingPhoto);
  els.dryingPhotoActions.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDryingPhotoActions();
  });
  els.dryingPhotoActions.addEventListener("close", releaseDryingPhotoActionUrl);

  els.form.addEventListener("input", updateRequiredFieldStates);
  els.form.addEventListener("change", updateRequiredFieldStates);

  const updateTrial = async (event) => {
    const control = event.target.closest("[data-trial-code]");
    if (!control) return;
    const trial = state.trials.find((item) => item.trialCode === control.dataset.trialCode);
    if (!trial) return;
    const previous = trial.completed;
    trial.completed = control.checked;
    control.closest("tr")?.classList.toggle("is-complete", trial.completed);
    await saveTrialCompletion(trial, control, previous);
  };
  els.batiTrialsBody.addEventListener("change", updateTrial);

  els.clearForm.addEventListener("click", clearFormWithConfirmation);
  els.newRecord.addEventListener("click", resetForNewRecord);
  els.topNewRecord.addEventListener("click", startNewRecord);
  els.topPrintPdf.addEventListener("click", printForm);
  els.refreshRecords.addEventListener("click", loadRecords);
  els.openRecordsDelete.addEventListener("click", openRecordsDeleteAuthorization);
  els.cancelRecordsDelete.addEventListener("click", exitRecordsDeleteMode);
  els.deleteSelectedRecords.addEventListener("click", deleteSelectedRecords);
  els.cancelRecordsDeleteAuth.addEventListener("click", () => els.recordsDeleteDialog.close());
  els.recordsDeleteAuthForm.addEventListener("submit", authorizeRecordsDelete);
  els.recordsList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-delete-receipt]");
    if (!checkbox) return;
    if (checkbox.checked) state.selectedDeleteReceipts.add(checkbox.dataset.deleteReceipt);
    else state.selectedDeleteReceipts.delete(checkbox.dataset.deleteReceipt);
    checkbox.closest("tr")?.classList.toggle("is-delete-selected", checkbox.checked);
    renderRecordsDeleteControls();
  });
  els.recordsRaId.addEventListener("input", () => {
    if (state.recordsStatusKey === "records.enterRaId") {
      state.recordsStatusKey = state.records.length ? "records.loaded" : "records.empty";
      state.recordsStatusArgs = { count: state.records.length };
      state.recordsStatusError = false;
      renderRecords();
    }
  });
  els.recordsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-edit-receipt]");
    if (button) openSavedRecord(button.dataset.editReceipt);
  });
  els.form.addEventListener("submit", submitForm);
  document.addEventListener("seaweed-drying-language-change", renderLanguageDependentContent);
}

function printForm() {
  window.print();
}

function renderLanguageDependentContent() {
  renderAll();
  renderTrials();
  renderRecords();
  renderActiveRecordBanner();
  if (!state.submitting) els.submitForm.textContent = t("action.submit");
}

function localDateTimeValue(date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function restoreDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(CONFIG.draftStorageKey) || "null");
  } catch {
    draft = null;
  }
  if (!draft || typeof draft !== "object") return;

  const savedAt = Date.parse(draft.savedAt || "");
  if (Number.isFinite(savedAt) && Date.now() - savedAt > 30 * 24 * 60 * 60 * 1000) {
    localStorage.removeItem(CONFIG.draftStorageKey);
    return;
  }

  Object.entries(draft.root || {}).forEach(([id, value]) => {
    const control = $(id);
    if (!control || !control.matches("[data-draft]")) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value ?? "";
  });

  state.bayCount = clampInteger(draft.bayCount, 1, 8, 8);
  state.bays = sanitizeBays(draft.bays);
  state.selectedBays = sanitizeSelectedBays(draft.selectedBays, state.bayCount);
  state.submissionId = isUuid(draft.submissionId) ? draft.submissionId : null;
  state.uploadToken = typeof draft.uploadToken === "string" ? draft.uploadToken : null;
  state.receiptNumber = typeof draft.receiptNumber === "string" ? draft.receiptNumber : null;
  state.recordedAt = Number.isFinite(Date.parse(draft.recordedAt || "")) ? draft.recordedAt : null;
  state.recordStatus = draft.recordStatus === "complete" ? "complete" : "in_progress";
  state.savedPhotos = sanitizeSavedPhotos(draft.savedPhotos);
  if (state.receiptNumber && state.submissionId && state.uploadToken) {
    rememberRecordAccess(state.receiptNumber, state.submissionId, state.uploadToken);
  }
}

function loadRememberedEnumerator() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG.enumeratorStorageKey) || "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") {
    els.rememberEnumerator.checked = false;
    if (!els.recordsRaId.value) els.recordsRaId.value = els.enumeratorId.value;
    return;
  }
  els.rememberEnumerator.checked = true;
  if (!els.enumeratorName.value) els.enumeratorName.value = saved.name || "";
  if (!els.enumeratorId.value) els.enumeratorId.value = saved.id || "";
  if (!els.recordsRaId.value) els.recordsRaId.value = els.enumeratorId.value || saved.id || "";
}

function updateRememberedEnumerator() {
  if (els.rememberEnumerator.checked) saveRememberedEnumerator();
  else {
    try {
      localStorage.removeItem(CONFIG.enumeratorStorageKey);
    } catch {
      // Ignore storage restrictions.
    }
  }
}

function saveRememberedEnumerator() {
  try {
    localStorage.setItem(CONFIG.enumeratorStorageKey, JSON.stringify({
      name: els.enumeratorName.value.trim(),
      id: els.enumeratorId.value.trim()
    }));
  } catch {
    // The form remains usable when device storage is unavailable.
  }
}

function sanitizeBays(value) {
  const allowed = new Set([
    "loading_at",
    "loading_weight_kg",
    "loading_weather",
    "unloading_at",
    "unloading_weight_kg",
    "unloading_weather",
    "notes"
  ]);
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([bayNumber, bay]) => {
    const clean = Object.fromEntries(Object.entries(bay || {}).filter(([key]) => allowed.has(key)));
    if (clean.loading_weight_kg === undefined && nullableNumber(bay?.loading_weight_g) !== null) {
      clean.loading_weight_kg = nullableNumber(bay.loading_weight_g) / 1000;
    }
    if (clean.unloading_weight_kg === undefined && nullableNumber(bay?.unloading_weight_g) !== null) {
      clean.unloading_weight_kg = nullableNumber(bay.unloading_weight_g) / 1000;
    }
    return [bayNumber, clean];
  }));
}

function sanitizeSavedPhotos(value) {
  const table = clampInteger(value?.table, 0, TABLE_PHOTO_LIMIT, 0);
  const bays = {};
  Object.entries(value?.bays || {}).forEach(([bayNumber, phases]) => {
    bays[bayNumber] = {
      loading: clampInteger(phases?.loading, 0, PHASE_PHOTO_LIMIT, 0),
      unloading: clampInteger(phases?.unloading, 0, PHASE_PHOTO_LIMIT, 0)
    };
  });
  return { table, bays };
}

function updateRequiredFieldStates() {
  document.querySelectorAll(".required-field").forEach((field) => {
    let isFilled;
    if (field.classList.contains("bay-picker-field")) {
      const phase = field.querySelector("#loadingBaySelector") ? "loading" : "unloading";
      isFilled = state.selectedBays[phase].length > 0;
    } else {
      const controls = [...field.querySelectorAll("input, select, textarea")];
      isFilled = controls.length > 0 && controls.every((control) => {
        if (control.disabled) return true;
        if (control.type === "file") {
          if (control === els.tablePhotos) {
            return state.files.table.length > 0 || state.savedPhotos.table > 0;
          }
          if (control === els.loadingCapturePhotos) return state.files.captures.loading.length > 0;
          if (control === els.unloadingCapturePhotos) return state.files.captures.unloading.length > 0;
          return control.files.length > 0;
        }
        if (control.type === "checkbox" || control.type === "radio") return control.checked;
        return String(control.value ?? "").trim() !== "";
      });
    }
    field.classList.toggle("is-filled", isFilled);
  });
}

function sanitizeSelectedBays(value, bayCount = 8) {
  const clean = (phase) => [...new Set(Array.isArray(value?.[phase]) ? value[phase] : [])]
    .map(Number)
    .filter((bayNumber) => Number.isInteger(bayNumber) && bayNumber >= 1 && bayNumber <= bayCount);
  return { loading: clean("loading"), unloading: clean("unloading") };
}

function scheduleDraftSave() {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 350);
}

function saveDraft() {
  const root = {};
  draftControls.forEach((control) => {
    root[control.id] = control.type === "checkbox" ? control.checked : control.value;
  });
  const savedAt = new Date().toISOString();
  const draft = {
    version: 2,
    savedAt,
    root,
    bayCount: state.bayCount,
    bays: state.bays,
    selectedBays: state.selectedBays,
    submissionId: state.submissionId,
    uploadToken: state.uploadToken,
    receiptNumber: state.receiptNumber,
    recordedAt: state.recordedAt,
    recordStatus: state.recordStatus,
    savedPhotos: state.savedPhotos
  };
  try {
    localStorage.setItem(CONFIG.draftStorageKey, JSON.stringify(draft));
  } catch {
    // Draft storage is optional; the form remains usable when it is unavailable.
  }
}

function applyLocationSelection(resetCurrentBay) {
  const location = selectedLocation();
  if (location) state.bayCount = location.bayCount;
  if (resetCurrentBay) {
    state.selectedBays = { loading: [], unloading: [] };
    state.editingCaptureBays = { loading: [], unloading: [] };
  }
  state.selectedBays = sanitizeSelectedBays(state.selectedBays, state.bayCount);
  renderAll();
}

function selectedLocation() {
  return CONFIG.locations.find((location) => location.value === els.dryerLocation.value) || null;
}

function ensureBay(bayNumber) {
  const key = String(bayNumber);
  if (!state.bays[key] || typeof state.bays[key] !== "object") state.bays[key] = {};
  return state.bays[key];
}

function savedBayPhotos(bayNumber) {
  const key = String(bayNumber);
  if (!state.savedPhotos.bays[key]) state.savedPhotos.bays[key] = { loading: 0, unloading: 0 };
  return state.savedPhotos.bays[key];
}

function captureElement(phase, part) {
  const phaseTitle = `${phase[0].toUpperCase()}${phase.slice(1)}`;
  const key = part === "Save" ? `save${phaseTitle}Capture`
    : part === "BaySelector" ? `${phase}BaySelector`
      : part === "PhotoPreview" ? `${phase}CapturePhotoPreview`
        : `${phase}Capture${part}`;
  return els[key];
}

function renderAll() {
  renderCapturePhaseTabs();
  renderBatchBaySelectors();
  renderBayStatus();
  renderBaySummary();
  renderCaptureLists();
  renderWeightSplit("loading");
  renderWeightSplit("unloading");
  renderCapturePhotoPreview("loading");
  renderCapturePhotoPreview("unloading");
  renderPhotoPreview(els.tablePhotoPreview, state.files.table, state.savedPhotos.table, { kind: "table" });
  renderActiveRecordBanner();
  renderCaptureEditingState("loading");
  renderCaptureEditingState("unloading");
  updateRequiredFieldStates();
}

function setActiveCapturePhase(phase, { focus = false } = {}) {
  if (!["loading", "unloading"].includes(phase)) return;
  state.activeCapturePhase = phase;
  renderCapturePhaseTabs();
  if (focus) els[`${phase}PhaseTab`].focus();
}

function renderCapturePhaseTabs() {
  ["loading", "unloading"].forEach((phase) => {
    const active = state.activeCapturePhase === phase;
    const tab = els[`${phase}PhaseTab`];
    const panel = els[`${phase}PhasePanel`];
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
}

function renderActiveRecordBanner() {
  const active = Boolean(state.receiptNumber);
  els.activeRecordBanner.hidden = !active;
  if (!active) return;
  els.activeReceiptNumber.textContent = state.receiptNumber;
  els.activeRecordStatus.textContent = t(state.recordStatus === "complete" ? "records.complete" : "records.inProgress");
  els.activeRecordStatus.classList.toggle("is-complete", state.recordStatus === "complete");
}

function renderBatchBaySelectors() {
  ["loading", "unloading"].forEach((phase) => {
    const container = captureElement(phase, "BaySelector");
    container.replaceChildren();
    for (let bayNumber = 1; bayNumber <= state.bayCount; bayNumber += 1) {
      const button = document.createElement("button");
      const selected = state.selectedBays[phase].includes(bayNumber);
      button.type = "button";
      button.dataset.bay = String(bayNumber);
      button.className = "batch-bay-button";
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
      const hasLoading = bayPhaseHasData(bayNumber, "loading");
      const hasUnloading = bayPhaseHasData(bayNumber, "unloading");
      button.classList.toggle("has-loading-data", hasLoading);
      button.classList.toggle("has-unloading-data", hasUnloading);
      button.textContent = t("bay.label", { number: bayNumber });
      button.setAttribute("aria-label", t("capture.bayDataStatus", {
        bay: bayNumber,
        wet: t(hasLoading ? "capture.dataSaved" : "capture.notSaved"),
        dry: t(hasUnloading ? "capture.dataSaved" : "capture.notSaved")
      }));
      container.append(button);
    }
  });
}

function renderBayStatus() {
  const entered = activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber)).length;
  els.bayProgress.textContent = t("bay.progress", { entered, total: state.bayCount });
}

function toggleCaptureBay(phase, bayNumber) {
  if (!Number.isInteger(bayNumber) || bayNumber < 1 || bayNumber > state.bayCount) return;
  const selected = new Set(state.selectedBays[phase]);
  if (selected.has(bayNumber)) selected.delete(bayNumber);
  else selected.add(bayNumber);
  state.selectedBays[phase] = [...selected].sort((a, b) => a - b);
  renderBatchBaySelectors();
  renderWeightSplit(phase);
  updateRequiredFieldStates();
  scheduleDraftSave();
}

function bayHasData(bayNumber) {
  const bay = ensureBay(bayNumber);
  const hasField = Object.values(bay).some((value) => String(value ?? "").trim() !== "");
  const savedPhotos = savedBayPhotos(bayNumber);
  return hasField || Boolean(savedPhotos.loading || savedPhotos.unloading);
}

function bayPhaseHasData(bayNumber, phase) {
  const bay = ensureBay(bayNumber);
  return Boolean(
    String(bay[`${phase}_at`] || "").trim()
    || String(bay[`${phase}_weight_kg`] || "").trim()
    || String(bay[`${phase}_weather`] || "").trim()
    || savedBayPhotos(bayNumber)[phase]
  );
}

function bayIsComplete(bayNumber) {
  const bay = ensureBay(bayNumber);
  return Boolean(
    String(bay.loading_at || "").trim()
    && String(bay.loading_weight_kg || "").trim()
    && String(bay.unloading_at || "").trim()
    && String(bay.unloading_weight_kg || "").trim()
  );
}

function activeBayNumbers() {
  return Array.from({ length: state.bayCount }, (_, index) => index + 1);
}

function dryingDurationLabel(bay) {
  if (!bay.loading_at || !bay.unloading_at) return "-";
  const start = new Date(bay.loading_at).getTime();
  const end = new Date(bay.unloading_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return t("bay.checkTimes");
  const minutes = Math.round((end - start) / 60_000);
  return t("bay.duration", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function weightLossLabel(bay) {
  const wet = nullableNumber(bay.loading_weight_kg);
  const dry = nullableNumber(bay.unloading_weight_kg);
  if (wet === null || dry === null || wet <= 0) return "-";
  return `${(((wet - dry) / wet) * 100).toFixed(1)}%`;
}

function renderBaySummary() {
  els.baySummaryBody.replaceChildren();
  activeBayNumbers().forEach((bayNumber) => {
    const bay = ensureBay(bayNumber);
    const savedPhotos = savedBayPhotos(bayNumber);
    const row = document.createElement("tr");
    const values = [
      t("bay.label", { number: bayNumber }),
      formatLocalInput(bay.loading_at),
      displayNumber(bay.loading_weight_kg, 2),
      formatLocalInput(bay.unloading_at),
      displayNumber(bay.unloading_weight_kg, 2),
      weightLossLabel(bay),
      dryingDurationLabel(bay),
      `${savedPhotos.loading + savedPhotos.unloading}`
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    els.baySummaryBody.append(row);
  });
}

function renderCapturePhotoPreview(phase) {
  renderPhotoPreview(
    captureElement(phase, "PhotoPreview"),
    state.files.captures[phase],
    0,
    { kind: "capture", phase }
  );
}

function renderCaptureLists() {
  els.savedCaptureList.replaceChildren();
  let groupCount = 0;
  ["loading", "unloading"].forEach((phase) => {
    const groups = new Map();
    activeBayNumbers().forEach((bayNumber) => {
      if (!bayPhaseHasData(bayNumber, phase)) return;
      const bay = ensureBay(bayNumber);
      const key = JSON.stringify([
        bay[`${phase}_at`] || "",
        bay[`${phase}_weight_kg`] ?? "",
        bay[`${phase}_weather`] || ""
      ]);
      if (!groups.has(key)) groups.set(key, { bayNumbers: [], bay });
      groups.get(key).bayNumbers.push(bayNumber);
    });
    groups.forEach(({ bayNumbers, bay }) => {
      groupCount += 1;
      const row = document.createElement("div");
      row.className = `capture-list-row is-${phase}`;
      const content = document.createElement("div");
      content.className = "capture-list-content";
      const phaseBadge = document.createElement("span");
      phaseBadge.className = `capture-phase-badge is-${phase}`;
      phaseBadge.textContent = `${t(`${phase}.title`)} ${t(`${phase}.qualifier`)}`;
      const bays = document.createElement("strong");
      const bayLabel = bayNumbers.map((number) => `B${number}`).join(", ");
      bays.textContent = bayLabel;
      const details = document.createElement("span");
      const weather = bay[`${phase}_weather`]
        ? t(`weather.${bay[`${phase}_weather`]}`)
        : "-";
      const perBayWeight = nullableNumber(bay[`${phase}_weight_kg`]);
      const weightSummary = perBayWeight === null
        ? "-"
        : t("capture.savedWeightSplit", {
          total: displayNumber(reconstructedTotalWeight(perBayWeight, bayNumbers.length), 2),
          perBay: displayNumber(perBayWeight, 5)
        });
      details.textContent = [
        formatLocalInput(bay[`${phase}_at`]),
        weightSummary,
        weather
      ].join(" · ");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "capture-edit-button";
      edit.dataset.editBays = bayNumbers.join(",");
      edit.dataset.editPhase = phase;
      edit.textContent = "\u270e";
      edit.title = t(`capture.edit${phase[0].toUpperCase()}${phase.slice(1)}`, { bays: bayLabel });
      edit.setAttribute("aria-label", edit.title);
      content.append(phaseBadge, bays, details);
      row.append(content, edit);
      els.savedCaptureList.append(row);
    });
  });
  if (!groupCount) {
    const empty = document.createElement("p");
    empty.className = "capture-list-empty";
    empty.textContent = t("capture.empty");
    els.savedCaptureList.append(empty);
  }
}

function reconstructedTotalWeight(perBayWeight, bayCount) {
  const perBay = nullableNumber(perBayWeight);
  if (perBay === null || !Number.isInteger(bayCount) || bayCount < 1) return null;
  return Math.round(perBay * bayCount * 100) / 100;
}

function editCaptureGroup(phase, bayNumbers) {
  const validBays = [...new Set(bayNumbers)]
    .filter((bayNumber) => Number.isInteger(bayNumber) && bayNumber >= 1 && bayNumber <= state.bayCount)
    .sort((a, b) => a - b);
  if (!validBays.length) return;
  const bay = ensureBay(validBays[0]);
  const perBayWeight = nullableNumber(bay[`${phase}_weight_kg`]);
  const totalWeight = reconstructedTotalWeight(perBayWeight, validBays.length);
  captureElement(phase, "At").value = bay[`${phase}_at`] || "";
  captureElement(phase, "Weight").value = totalWeight === null ? "" : String(totalWeight);
  captureElement(phase, "Weather").value = bay[`${phase}_weather`] || "";
  captureElement(phase, "Photos").value = "";
  state.files.captures[phase] = [];
  state.selectedBays[phase] = validBays;
  state.editingCaptureBays[phase] = validBays;
  state.activeCapturePhase = phase;
  renderAll();
  scheduleDraftSave();
  captureElement(phase, "Weight").closest(".phase-fields")?.scrollIntoView({
    behavior: preferredScrollBehavior(),
    block: "center"
  });
}

function renderCaptureEditingState(phase) {
  const editing = state.editingCaptureBays[phase].length > 0;
  const card = captureElement(phase, "Save").closest(".batch-capture-card");
  card?.classList.toggle("is-editing", editing);
  const key = editing
    ? `capture.update${phase[0].toUpperCase()}${phase.slice(1)}`
    : `capture.save${phase[0].toUpperCase()}${phase.slice(1)}`;
  captureElement(phase, "Save").textContent = t(key);
}

function captureCardData(phase) {
  return {
    at: captureElement(phase, "At").value,
    weight: captureElement(phase, "Weight").value,
    weather: captureElement(phase, "Weather").value,
    photos: state.files.captures[phase]
  };
}

function captureCardHasData(phase) {
  const capture = captureCardData(phase);
  return Boolean(capture.at || capture.weight || capture.weather || capture.photos.length);
}

function applyCaptureToBays(phase) {
  const capture = captureCardData(phase);
  const weightPerBay = splitWeightAcrossBays(capture.weight, state.selectedBays[phase].length);
  state.selectedBays[phase].forEach((bayNumber) => {
    const bay = ensureBay(bayNumber);
    bay[`${phase}_at`] = capture.at;
    bay[`${phase}_weight_kg`] = weightPerBay === null ? "" : String(weightPerBay);
    bay[`${phase}_weather`] = capture.weather;
  });
}

function splitWeightAcrossBays(totalWeight, bayCount) {
  const total = nullableNumber(totalWeight);
  if (total === null || !Number.isInteger(bayCount) || bayCount < 1) return null;
  return Math.round((total / bayCount) * 100_000) / 100_000;
}

function renderWeightSplit(phase) {
  const output = els[`${phase}WeightSplit`];
  const total = nullableNumber(captureElement(phase, "Weight").value);
  const count = state.selectedBays[phase].length;
  const perBay = splitWeightAcrossBays(total, count);
  if (perBay === null) {
    output.textContent = "";
    output.hidden = true;
    return;
  }
  output.hidden = false;
  output.textContent = t("capture.splitPreview", {
    total: displayNumber(total, 5),
    count,
    perBay: displayNumber(perBay, 5)
  });
}

function clearCaptureCard(phase) {
  captureElement(phase, "At").value = "";
  captureElement(phase, "Weight").value = "";
  captureElement(phase, "Weather").value = "";
  captureElement(phase, "Photos").value = "";
  state.selectedBays[phase] = [];
  state.editingCaptureBays[phase] = [];
  state.files.captures[phase] = [];
}

function renderTrials() {
  renderTrialSite(els.batiTrialsBody);
}

function renderTrialSite(container) {
  container.replaceChildren();
  state.trials.forEach((trial) => {
    const row = document.createElement("tr");
    row.classList.toggle("is-complete", trial.completed);

    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.className = "trial-label";
    labelCell.textContent = t("trials.trialLabel", {
      number: trial.trialNumber
    });

    const assignmentCell = document.createElement("td");
    const assignmentList = document.createElement("div");
    assignmentList.className = "trial-assignments";
    trial.assignments.forEach((assignment) => {
      const item = document.createElement("span");
      item.className = "trial-assignment";
      const tableName = document.createElement("strong");
      tableName.textContent = tableLabel(assignment.table);
      const configuration = document.createElement("span");
      configuration.className = "trial-config-pills";
      if (assignment.collectionOnly) {
        const collectionPill = document.createElement("span");
        collectionPill.className = "config-pill trial-collection-pill";
        collectionPill.textContent = t("trials.collectionOnly");
        configuration.setAttribute("aria-label", collectionPill.textContent);
        configuration.append(collectionPill);
      } else {
        const parts = configurationParts(assignment.configuration);
        configuration.setAttribute("aria-label", parts.map((part) => part.text).join(" / "));
        parts.forEach((part, index) => {
          if (index) {
            const separator = document.createElement("span");
            separator.className = "config-separator";
            separator.textContent = "/";
            configuration.append(separator);
          }
          const pill = document.createElement("span");
          pill.className = `config-pill ${part.className}`;
          pill.textContent = part.text;
          configuration.append(pill);
        });
      }
      item.append(tableName, configuration);
      assignmentList.append(item);
    });
    assignmentCell.append(assignmentList);

    const dateCells = [createFixedTrialDateCell(trial)];

    const completeCell = document.createElement("td");
    completeCell.className = "trial-complete-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = trial.completed;
    checkbox.className = "trial-complete";
    checkbox.dataset.trialCode = trial.trialCode;
    checkbox.setAttribute("aria-label", `${labelCell.textContent}: ${t("trials.complete")}`);
    completeCell.append(checkbox);

    row.append(labelCell, assignmentCell, ...dateCells, completeCell);
    container.append(row);
  });
}

function createFixedTrialDateCell(trial) {
  const cell = document.createElement("td");
  const label = document.createElement("span");
  label.className = "trial-date-pill";
  label.textContent = fixedTrialDateLabel(trial.startDate, trial.finishDate);
  cell.append(label);
  return cell;
}

function fixedTrialDateLabel(startValue, finishValue) {
  const start = parseFixedDate(startValue);
  const finish = parseFixedDate(finishValue);
  if (!start || !finish) return "-";
  const month = (date) => new Intl.DateTimeFormat(getLocale(), { month: "long", timeZone: "UTC" }).format(date);
  const startDay = start.getUTCDate();
  const finishDay = finish.getUTCDate();
  if (start.getUTCMonth() === finish.getUTCMonth()) {
    return `${startDay}\u2013${finishDay} ${month(finish)}`;
  }
  return `${startDay} ${month(start)}\u2013${finishDay} ${month(finish)}`;
}

function parseFixedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function loadTrialSchedule() {
  renderTrials();
  try {
    const result = await callRpc(CONFIG.getTrialsRpc, {}, { unwrapSingle: false });
    const savedTrials = extractTrialRows(result);
    savedTrials.forEach((saved) => {
      const trial = state.trials.find((item) => item.trialCode === saved.trial_code);
      if (!trial) return;
      trial.completed = Boolean(saved.completed);
    });
  } catch (error) {
    if (!isDatabasePendingError(error)) {
      showTrialError(t("trials.loadFailed"));
    }
  }
  renderTrials();
}

function extractTrialRows(result) {
  if (Array.isArray(result)) {
    if (result.length === 1 && Array.isArray(result[0])) return result[0];
    return result;
  }
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result.trials)) return result.trials;
  const nested = Object.values(result).find(Array.isArray);
  return nested || [];
}

async function saveTrialCompletion(trial, control, previous) {
  control.disabled = true;
  els.trialSaveStatus.hidden = true;
  els.trialSaveStatus.textContent = "";
  try {
    await callRpc(CONFIG.updateTrialsRpc, {
      p_updates: [{
        trial_code: trial.trialCode,
        completed: trial.completed
      }]
    }, { unwrapSingle: false });
  } catch (error) {
    trial.completed = previous;
    showTrialError(t("trials.saveFailed", { message: friendlyError(error) }));
  } finally {
    control.disabled = false;
    renderTrials();
  }
}

function showTrialError(message) {
  els.trialSaveStatus.textContent = message;
  els.trialSaveStatus.dataset.status = "error";
  els.trialSaveStatus.hidden = false;
}

async function loadRecords() {
  if (state.recordsLoading) return;
  state.recordsLoading = true;
  state.recordsStatusKey = "records.loading";
  state.recordsStatusArgs = {};
  state.recordsStatusError = false;
  renderRecords();
  try {
    const result = await callRpc(CONFIG.listRecordsRpc, { p_limit: 50 }, { unwrapSingle: false });
    state.records = extractRecordRows(result);
    state.recordsStatusKey = state.records.length ? "records.loaded" : "records.empty";
    state.recordsStatusArgs = { count: state.records.length };
  } catch (error) {
    state.recordsStatusKey = isDatabasePendingError(error) ? "records.preview" : "records.loadFailed";
    state.recordsStatusArgs = { message: simpleErrorMessage(error) };
    state.recordsStatusError = true;
  } finally {
    state.recordsLoading = false;
    renderRecords();
  }
}

function extractRecordRows(result) {
  if (Array.isArray(result)) {
    if (result.length === 1 && Array.isArray(result[0])) return result[0];
    return result;
  }
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result.records)) return result.records;
  return [];
}

function renderRecords() {
  els.refreshRecords.disabled = state.recordsLoading || state.recordOpening || state.recordsDeleting;
  els.openRecordsDelete.disabled = state.recordsLoading || state.recordOpening
    || state.recordsDeleting || !state.records.length;
  els.recordsStatus.textContent = t(state.recordsStatusKey, state.recordsStatusArgs);
  els.recordsStatus.dataset.status = state.recordsStatusError ? "error" : "";
  els.recordsList.replaceChildren();
  state.records.forEach((record) => els.recordsList.append(createRecordRow(record)));
  renderRecordsDeleteControls();
}

function renderRecordsDeleteControls() {
  els.recordsDeleteBar.hidden = !state.recordsDeleteMode;
  els.recordsSelectHeading.hidden = !state.recordsDeleteMode;
  els.recordsDeleteCount.textContent = t("records.selectedCount", {
    count: state.selectedDeleteReceipts.size
  });
  els.deleteSelectedRecords.disabled = state.recordsDeleting || !state.selectedDeleteReceipts.size;
  els.cancelRecordsDelete.disabled = state.recordsDeleting;
  els.deleteSelectedRecords.textContent = t(state.recordsDeleting
    ? "records.deleting"
    : "records.deleteSelected");
}

function createRecordRow(record) {
  const row = document.createElement("tr");
  const status = document.createElement("span");
  const complete = record.record_status === "complete";
  status.className = "record-status-pill";
  status.classList.toggle("is-complete", complete);
  status.textContent = t(complete ? "records.complete" : "records.inProgress");
  const bayStates = Array.isArray(record.bay_states) ? record.bay_states : [];
  const bayText = bayStates.length
    ? bayStates.map((bay) => `B${bay.bay_number}`).join(", ")
    : t("records.bays", { count: record.bay_count || 0 });
  const edit = document.createElement("button");
  edit.type = "button";
  const access = recordAccessFor(record.receipt_number);
  edit.disabled = state.recordOpening;
  edit.textContent = t(access ? "records.edit" : "records.unlockEdit");
  edit.title = t(access ? "records.edit" : "records.unlockHint");
  edit.dataset.editReceipt = record.receipt_number;
  const values = [
    edit,
    formatRecordDay(record.recorded_at),
    tableLabel(record.table_location),
    status,
    bayText,
    formatRecordDate(record.updated_at)
  ];
  if (state.recordsDeleteMode) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "record-delete-checkbox";
    checkbox.dataset.deleteReceipt = record.receipt_number;
    checkbox.checked = state.selectedDeleteReceipts.has(record.receipt_number);
    checkbox.setAttribute("aria-label", t("records.selectRecord", {
      date: formatRecordDay(record.recorded_at),
      table: tableLabel(record.table_location)
    }));
    values.unshift(checkbox);
    row.classList.toggle("is-delete-selected", checkbox.checked);
  }
  values.forEach((value) => {
    const cell = document.createElement("td");
    if (value instanceof Node) cell.append(value);
    else cell.textContent = value;
    row.append(cell);
  });
  return row;
}

function openRecordsDeleteAuthorization() {
  if (!state.records.length || state.recordsLoading || state.recordsDeleting) return;
  els.recordsDeletePassword.value = "";
  els.recordsDeleteAuthError.textContent = "";
  els.recordsDeleteAuthError.hidden = true;
  els.authorizeRecordsDelete.disabled = false;
  els.recordsDeleteDialog.showModal();
  els.recordsDeletePassword.focus();
}

async function authorizeRecordsDelete(event) {
  event.preventDefault();
  if (state.recordsDeleteAuthenticating) return;
  const password = els.recordsDeletePassword.value;
  if (!password) {
    els.recordsDeletePassword.reportValidity();
    return;
  }
  state.recordsDeleteAuthenticating = true;
  els.authorizeRecordsDelete.disabled = true;
  els.recordsDeleteAuthError.hidden = true;
  try {
    const result = await callRpc(CONFIG.adminAuthRpc, { p_password: password });
    const roleId = result?.role?.roleId || result?.role?.role_id || "";
    if (!result?.authenticated || roleId !== "admin") {
      throw new Error(t("records.invalidAdminPassword"));
    }
    state.recordsDeletePassword = password;
    state.recordsDeleteMode = true;
    state.selectedDeleteReceipts.clear();
    els.recordsDeletePassword.value = "";
    els.recordsDeleteDialog.close();
    renderRecords();
  } catch (error) {
    els.recordsDeleteAuthError.textContent = simpleErrorMessage(error);
    els.recordsDeleteAuthError.hidden = false;
    els.recordsDeletePassword.select();
  } finally {
    state.recordsDeleteAuthenticating = false;
    els.authorizeRecordsDelete.disabled = false;
  }
}

function exitRecordsDeleteMode({ force = false } = {}) {
  if (state.recordsDeleting && !force) return;
  state.recordsDeleteMode = false;
  state.recordsDeletePassword = "";
  state.selectedDeleteReceipts.clear();
  renderRecords();
}

async function deleteSelectedRecords() {
  const receiptNumbers = [...state.selectedDeleteReceipts];
  if (!receiptNumbers.length || state.recordsDeleting) return;
  if (!window.confirm(t("records.confirmDelete", { count: receiptNumbers.length }))) return;
  state.recordsDeleting = true;
  renderRecordsDeleteControls();
  try {
    const result = await callRpc(CONFIG.deleteRecordsRpc, {
      p_admin_password: state.recordsDeletePassword,
      p_receipt_numbers: receiptNumbers
    });
    const deletedReceipts = Array.isArray(result?.receipt_numbers)
      ? result.receipt_numbers
      : receiptNumbers;
    const deletedCount = Number.isFinite(Number(result?.deleted_count))
      ? Number(result.deleted_count)
      : deletedReceipts.length;
    forgetRecordAccess(deletedReceipts);
    const deletedActiveRecord = deletedReceipts.includes(state.receiptNumber);
    exitRecordsDeleteMode({ force: true });
    if (deletedActiveRecord) resetForNewRecord({ scroll: false });
    await loadRecords();
    state.recordsStatusKey = "records.deleted";
    state.recordsStatusArgs = { count: deletedCount };
    state.recordsStatusError = false;
  } catch (error) {
    state.recordsStatusKey = "records.deleteFailed";
    state.recordsStatusArgs = { message: simpleErrorMessage(error) };
    state.recordsStatusError = true;
  } finally {
    state.recordsDeleting = false;
    renderRecords();
  }
}

function forgetRecordAccess(receiptNumbers) {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.recordTokensStorageKey) || "{}");
    receiptNumbers.forEach((receipt) => delete saved[receipt]);
    localStorage.setItem(CONFIG.recordTokensStorageKey, JSON.stringify(saved));
  } catch {
    // Deletion does not depend on local edit-token cleanup.
  }
}

async function openSavedRecord(receiptNumber) {
  let access = recordAccessFor(receiptNumber);
  const raId = els.recordsRaId.value.trim();
  if (state.recordOpening || state.submitting) return;
  if (!access && !raId) {
    state.recordsStatusKey = "records.enterRaId";
    state.recordsStatusArgs = {};
    state.recordsStatusError = true;
    renderRecords();
    els.recordsRaId.focus();
    return;
  }
  if (formHasMeaningfulData() && state.receiptNumber !== receiptNumber
      && !window.confirm(t("confirm.editRecord", { receipt: receiptNumber }))) return;
  state.recordOpening = true;
  state.recordsStatusKey = access ? "records.opening" : "records.unlocking";
  state.recordsStatusArgs = { receipt: receiptNumber };
  state.recordsStatusError = false;
  renderRecords();
  try {
    let result;
    if (access) {
      try {
        result = await callRpc(CONFIG.getRecordRpc, {
          p_submission_id: access.id,
          p_edit_token: access.token
        });
      } catch (error) {
        if (!raId || !isEditTokenError(error)) throw error;
        access = null;
      }
    }
    if (!access) {
      const claimed = await callRpc(CONFIG.claimRecordRpc, {
        p_receipt_number: receiptNumber,
        p_enumerator_id: raId
      });
      access = { id: claimed?.id, token: claimed?.edit_token };
      if (!isUuid(access.id) || typeof access.token !== "string") {
        throw new Error(t("records.unlockInvalid"));
      }
      rememberRecordAccess(receiptNumber, access.id, access.token);
      result = claimed.record;
    }
    hydrateSavedRecord(result?.record || result, access);
  } catch (error) {
    state.recordsStatusKey = "records.editFailed";
    state.recordsStatusArgs = { receipt: receiptNumber, message: simpleErrorMessage(error) };
    state.recordsStatusError = true;
  } finally {
    state.recordOpening = false;
    renderRecords();
  }
}

function hydrateSavedRecord(record, access) {
  if (!record || typeof record !== "object") throw new Error("Invalid saved record");
  resetForNewRecord({ scroll: false });
  state.submissionId = access.id;
  state.uploadToken = access.token;
  state.receiptNumber = record.receipt_number || null;
  state.recordStatus = record.record_status === "complete" ? "complete" : "in_progress";
  state.savedPhotos.table = clampInteger(record.table_photo_count, 0, TABLE_PHOTO_LIMIT, 0);

  els.dryerLocation.value = record.dryer_location_code || "";
  els.enumeratorName.value = record.enumerator_name || "";
  els.enumeratorId.value = record.enumerator_id || "";
  els.recordsRaId.value = record.enumerator_id || els.recordsRaId.value;
  state.recordedAt = Number.isFinite(Date.parse(record.recorded_at || "")) ? record.recorded_at : null;
  els.dryingConfiguration.value = record.drying_configuration || "";
  els.generalObservations.value = record.general_observations || "";
  els.workingWell.value = record.working_well || "";
  els.notWorking.value = record.not_working || "";

  state.bays = {};
  (Array.isArray(record.bays) ? record.bays : []).forEach((bay) => {
    const key = String(bay.bay_number);
    state.bays[key] = {
      loading_at: localDateTimeFromIso(bay.loading_at),
      loading_weight_kg: bay.loading_weight_kg ?? "",
      loading_weather: bay.loading_weather || "",
      unloading_at: localDateTimeFromIso(bay.unloading_at),
      unloading_weight_kg: bay.unloading_weight_kg ?? "",
      unloading_weather: bay.unloading_weather || "",
      notes: bay.notes || ""
    };
    state.savedPhotos.bays[key] = {
      loading: clampInteger(bay.loading_photo_count, 0, PHASE_PHOTO_LIMIT, 0),
      unloading: clampInteger(bay.unloading_photo_count, 0, PHASE_PHOTO_LIMIT, 0)
    };
  });
  applyLocationSelection(false);
  els.formPanel.hidden = false;
  els.successPanel.hidden = true;
  setStatus(t("records.editing"), "success");
  renderAll();
  saveDraft();
  els.formPanel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  loadRecords();
}

function formHasMeaningfulData() {
  return Boolean(
    state.submissionId
    || els.dryerLocation.value
    || els.enumeratorName.value.trim()
    || Object.keys(state.bays).some((bayNumber) => bayHasData(Number(bayNumber)))
    || state.files.table.length
    || captureCardHasData("loading")
    || captureCardHasData("unloading")
    || state.selectedBays.loading.length
    || state.selectedBays.unloading.length
  );
}

function acceptedFiles(fileList, limit) {
  const accepted = [];
  for (const file of [...fileList].slice(0, limit)) {
    if (!file.type.startsWith("image/")) {
      setStatus(t("photo.notImage", { name: file.name }), "error");
      continue;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStatus(t("photo.tooLarge", { name: file.name }), "error");
      continue;
    }
    accepted.push(file);
  }
  if (fileList.length > limit) setStatus(t("photo.limit", { limit }), "warning");
  return accepted;
}

function addSelectedPhotos(context) {
  const input = photoInput(context);
  const files = photoFiles(context);
  const limit = photoLimit(context);
  const additions = acceptedFiles(input.files, Math.max(0, limit - files.length));
  if (additions.length) files.push(...additions);
  input.value = "";
  renderAll();
  scheduleDraftSave();
}

function photoInput(context) {
  return context?.kind === "table" ? els.tablePhotos : captureElement(context?.phase, "Photos");
}

function photoFiles(context) {
  return context?.kind === "table" ? state.files.table : state.files.captures[context?.phase];
}

function photoLimit(context) {
  return context?.kind === "table" ? TABLE_PHOTO_LIMIT : PHASE_PHOTO_LIMIT;
}

function renderPhotoPreview(container, files, savedCount = 0, context = null) {
  container.replaceChildren();
  if (savedCount) {
    const saved = document.createElement("span");
    saved.className = "photo-chip saved-photo-chip";
    saved.textContent = savedCount > 1 ? `${t("photo.saved")} (${savedCount})` : t("photo.saved");
    container.append(saved);
  }
  files.forEach((file, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "photo-chip selected-photo-chip";
    chip.setAttribute("aria-label", t("photo.openActions", { number: index + 1 }));
    chip.addEventListener("click", () => openDryingPhotoActions(context, index));
    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.alt = t("photo.previewAlt", { number: index + 1 });
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
    const name = document.createElement("span");
    name.textContent = `${file.name} (${formatBytes(file.size)})`;
    chip.append(image, name);
    container.append(chip);
  });
}

function openDryingPhotoActions(context, index) {
  const file = photoFiles(context)?.[index];
  if (!file) return;
  releaseDryingPhotoActionUrl();
  state.photoAction.context = { ...context };
  state.photoAction.index = index;
  state.photoAction.objectUrl = URL.createObjectURL(file);
  els.dryingPhotoActionPreview.src = state.photoAction.objectUrl;
  els.dryingPhotoActionPreview.alt = t("photo.previewAlt", { number: index + 1 });
  els.dryingPhotoActionName.textContent = `${t("photo.photoNumber", { number: index + 1 })} - ${file.name}`;
  if (typeof els.dryingPhotoActions.showModal === "function") els.dryingPhotoActions.showModal();
  else els.dryingPhotoActions.setAttribute("open", "");
}

function closeDryingPhotoActions() {
  if (typeof els.dryingPhotoActions.close === "function" && els.dryingPhotoActions.open) {
    els.dryingPhotoActions.close();
  } else {
    els.dryingPhotoActions.removeAttribute("open");
    releaseDryingPhotoActionUrl();
  }
  state.photoAction.context = null;
  state.photoAction.index = null;
}

function releaseDryingPhotoActionUrl() {
  if (state.photoAction.objectUrl) URL.revokeObjectURL(state.photoAction.objectUrl);
  state.photoAction.objectUrl = null;
  els.dryingPhotoActionPreview.removeAttribute("src");
}

function beginDryingPhotoRetake() {
  if (!state.photoAction.context || !Number.isInteger(state.photoAction.index)) return;
  state.photoAction.retakeContext = { ...state.photoAction.context };
  state.photoAction.retakeIndex = state.photoAction.index;
  els.dryingPhotoRetake.value = "";
  closeDryingPhotoActions();
  els.dryingPhotoRetake.click();
}

function replaceDryingPhoto() {
  const [replacement] = acceptedFiles(els.dryingPhotoRetake.files, 1);
  const context = state.photoAction.retakeContext;
  const index = state.photoAction.retakeIndex;
  const files = context ? photoFiles(context) : null;
  if (replacement && files?.[index]) files[index] = replacement;
  state.photoAction.retakeContext = null;
  state.photoAction.retakeIndex = null;
  els.dryingPhotoRetake.value = "";
  renderAll();
  scheduleDraftSave();
}

function deleteActiveDryingPhoto() {
  const context = state.photoAction.context;
  const index = state.photoAction.index;
  const files = context ? photoFiles(context) : null;
  if (!files?.[index]) return;
  files.splice(index, 1);
  closeDryingPhotoActions();
  renderAll();
  scheduleDraftSave();
}

async function saveBatchCapture(phase) {
  if (state.submitting) return;
  const bayNumbers = [...state.selectedBays[phase]];
  const validationMessage = validateBatchCapture(phase, bayNumbers);
  if (validationMessage) {
    setStatus(validationMessage, "error");
    return;
  }

  applyCaptureToBays(phase);
  ensureRecordIdentity();
  saveDraft();
  state.submitting = true;
  setSubmittingUi(true);
  setStatus(t("capture.saving"));
  let receipt;
  try {
    receipt = await callRpc(CONFIG.submitRpc, {
      p_payload: buildPayload(false),
      p_upload_token: state.uploadToken
    });
    acceptSavedReceipt(receipt);
    saveDraft();
    const photoResult = await uploadSelectedPhotos({
      phaseBayNumbers: { [phase]: bayNumbers },
      includeTable: true
    });
    applyUploadedPhotoResult(photoResult);
    clearCaptureCard(phase);
    saveDraft();
    renderAll();
    setStatus(t("capture.saved", {
      bays: bayNumbers.map((number) => `B${number}`).join(", "),
      receipt: state.receiptNumber
    }), "success");
    loadRecords();
  } catch (error) {
    const receiptHint = receipt?.receipt_number
      ? t("status.recordSavedPhotos", { receipt: receipt.receipt_number })
      : "";
    setStatus(`${friendlyError(error)}${receiptHint}`, receipt ? "warning" : "error");
    saveDraft();
  } finally {
    state.submitting = false;
    setSubmittingUi(false);
    renderAll();
  }
}

function validateBatchCapture(phase, bayNumbers) {
  const coreMessage = validateCoreRecordFields();
  if (coreMessage) return coreMessage;
  if (!bayNumbers.length) return t("capture.selectAtLeastOneBay");
  if (!captureCardHasData(phase)) return t("capture.enterMeasurement");
  const capture = captureCardData(phase);
  for (const bayNumber of bayNumbers) {
    const bay = ensureBay(bayNumber);
    const loadingAt = phase === "loading" ? capture.at : bay.loading_at;
    const unloadingAt = phase === "unloading" ? capture.at : bay.unloading_at;
    if (loadingAt && unloadingAt
        && new Date(unloadingAt).getTime() < new Date(loadingAt).getTime()) {
      return t("validation.timeOrder", { bay: bayNumber });
    }
  }
  return "";
}

function validateCoreRecordFields() {
  for (const control of [els.enumeratorName, els.enumeratorId, els.dryerLocation, els.dryingConfiguration]) {
    if (!control.checkValidity()) {
      control.reportValidity();
      return t("validation.required");
    }
  }
  return "";
}

function ensureRecordIdentity() {
  state.submissionId ||= createUuid();
  state.uploadToken ||= createUploadToken();
}

function acceptSavedReceipt(receipt) {
  state.receiptNumber = receipt?.receipt_number || state.receiptNumber || state.submissionId;
  state.recordStatus = receipt?.record_status === "complete" ? "complete" : "in_progress";
  rememberRecordAccess(state.receiptNumber, state.submissionId, state.uploadToken);
  renderActiveRecordBanner();
}

async function submitForm(event) {
  event.preventDefault();
  if (state.submitting) return;
  els.form.classList.add("was-validated");

  for (const phase of ["loading", "unloading"]) {
    if (!captureCardHasData(phase) && !state.selectedBays[phase].length) continue;
    const captureMessage = validateBatchCapture(phase, state.selectedBays[phase]);
    if (captureMessage) {
      setStatus(captureMessage, "error");
      return;
    }
    applyCaptureToBays(phase);
  }

  const validationMessage = validateForm();
  if (validationMessage) {
    setStatus(validationMessage, "error");
    return;
  }

  ensureRecordIdentity();
  saveDraft();
  state.submitting = true;
  setSubmittingUi(true);

  let receipt;
  try {
    setStatus(t("status.savingRecord"));
    receipt = await callRpc(CONFIG.submitRpc, {
      p_payload: buildPayload(recordCanBeFinalized()),
      p_upload_token: state.uploadToken
    });
    acceptSavedReceipt(receipt);
    saveDraft();
    const photoResult = await uploadSelectedPhotos();
    applyUploadedPhotoResult(photoResult);
    localStorage.removeItem(CONFIG.draftStorageKey);
    showSuccess(receipt, { count: totalSavedPhotoCount(), attached: photoResult.attached });
    loadRecords();
  } catch (error) {
    const receiptHint = receipt?.receipt_number
      ? t("status.recordSavedPhotos", { receipt: receipt.receipt_number })
      : "";
    setStatus(`${friendlyError(error)}${receiptHint}`, receipt ? "warning" : "error");
    saveDraft();
  } finally {
    state.submitting = false;
    setSubmittingUi(false);
  }
}

function validateForm() {
  if (!els.form.checkValidity()) {
    els.form.reportValidity();
    return t("validation.required");
  }

  const enteredBays = activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber));
  if (!enteredBays.length) {
    return t("validation.oneBay");
  }

  for (const bayNumber of enteredBays) {
    const bay = ensureBay(bayNumber);
    const loadingAt = new Date(bay.loading_at).getTime();
    const unloadingAt = new Date(bay.unloading_at).getTime();
    if (Number.isFinite(loadingAt) && Number.isFinite(unloadingAt) && unloadingAt < loadingAt) {
      return t("validation.timeOrder", { bay: bayNumber });
    }
  }
  return "";
}

function recordCanBeFinalized() {
  const enteredBays = activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber));
  return enteredBays.length > 0 && enteredBays.every((bayNumber) => bayIsComplete(bayNumber));
}

function buildPayload(finalize) {
  const location = selectedLocation();
  const recordedAt = deriveRecordedAt();
  return {
    submission_id: state.submissionId,
    station_uid: location?.stationUid || null,
    dryer_location_code: location?.value || null,
    table_location: location?.label || null,
    enumerator_name: els.enumeratorName.value.trim(),
    enumerator_id: nullableText(els.enumeratorId.value),
    recorded_at: recordedAt,
    drying_configuration: els.dryingConfiguration.value,
    general_observations: nullableText(els.generalObservations.value),
    working_well: nullableText(els.workingWell.value),
    not_working: nullableText(els.notWorking.value),
    confirmed_accurate: true,
    finalize: Boolean(finalize),
    website: els.website.value,
    source: CONFIG.source,
    client_version: CONFIG.clientVersion,
    bays: activeBayNumbers()
      .filter((bayNumber) => bayHasData(bayNumber))
      .map((bayNumber) => bayPayload(bayNumber))
  };
}

function deriveRecordedAt() {
  const captureTimes = activeBayNumbers()
    .flatMap((bayNumber) => {
      const bay = ensureBay(bayNumber);
      return [bay.loading_at, bay.unloading_at];
    })
    .map(toIso)
    .filter((value) => Number.isFinite(Date.parse(value || "")));
  if (captureTimes.length) {
    state.recordedAt = captureTimes.reduce((earliest, value) => (
      Date.parse(value) < Date.parse(earliest) ? value : earliest
    ));
  } else if (!Number.isFinite(Date.parse(state.recordedAt || ""))) {
    state.recordedAt = new Date().toISOString();
  }
  return state.recordedAt;
}

function bayPayload(bayNumber) {
  const bay = ensureBay(bayNumber);
  return {
    bay_number: bayNumber,
    loading_at: toIso(bay.loading_at),
    loading_weight_kg: nullableNumber(bay.loading_weight_kg),
    loading_weather: nullableText(bay.loading_weather),
    unloading_at: toIso(bay.unloading_at),
    unloading_weight_kg: nullableNumber(bay.unloading_weight_kg),
    unloading_weather: nullableText(bay.unloading_weather),
    notes: nullableText(bay.notes)
  };
}

async function uploadSelectedPhotos({ phaseBayNumbers = state.selectedBays, includeTable = true } = {}) {
  const uploads = [];
  if (includeTable) state.files.table.forEach((file) => uploads.push({ kind: "table", file }));
  ["loading", "unloading"].forEach((phase) => {
    const bayNumbers = Array.isArray(phaseBayNumbers?.[phase]) ? phaseBayNumbers[phase] : [];
    bayNumbers.forEach((bayNumber) => {
      state.files.captures[phase].forEach((file) => {
        uploads.push({ kind: "bay", phase, bayNumber, file });
      });
    });
  });
  if (!uploads.length) return { count: 0, attached: false, bayPhotos: [] };

  const manifest = { bays: [] };
  if (uploads.some((upload) => upload.kind === "table")) manifest.table = [];
  const manifestByBay = new Map();
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    setStatus(t("photo.preparing", { current: index + 1, total: uploads.length }));
    const blob = await preparePhoto(upload.file);
    if (blob.size > CONFIG.maxPhotoBytes) throw new Error(`${upload.file.name} is still larger than ${formatBytes(CONFIG.maxPhotoBytes)} after compression.`);
    const extension = photoExtension(blob.type);
    const objectId = createUuid();
    const objectPath = upload.kind === "table"
      ? `${state.submissionId}/table/${objectId}.${extension}`
      : `${state.submissionId}/bay-${String(upload.bayNumber).padStart(2, "0")}/${upload.phase}/${objectId}.${extension}`;
    await uploadObject(objectPath, blob);

    if (upload.kind === "table") {
      manifest.table.push(objectPath);
    } else {
      if (!manifestByBay.has(upload.bayNumber)) {
        const bayManifest = { bay_number: upload.bayNumber };
        manifestByBay.set(upload.bayNumber, bayManifest);
        manifest.bays.push(bayManifest);
      }
      const bayManifest = manifestByBay.get(upload.bayNumber);
      bayManifest[upload.phase] ||= [];
      bayManifest[upload.phase].push(objectPath);
    }
  }

  setStatus(t("photo.linking"));
  const attachResult = await callRpc(CONFIG.attachPhotosRpc, {
    p_submission_id: state.submissionId,
    p_upload_token: state.uploadToken,
    p_photos: manifest
  });
  if (manifest.table) {
    state.files.table = [];
    els.tablePhotos.value = "";
  }
  if (manifest.bays.some((bay) => bay.loading)) {
    state.files.captures.loading = [];
    els.loadingCapturePhotos.value = "";
  }
  if (manifest.bays.some((bay) => bay.unloading)) {
    state.files.captures.unloading = [];
    els.unloadingCapturePhotos.value = "";
  }
  return {
    count: uploads.length,
    attached: true,
    tableCount: attachResult?.table_photo_count,
    bayPhotos: Array.isArray(attachResult?.bay_photos) ? attachResult.bay_photos : [],
    touchedManifest: manifest
  };
}

function applyUploadedPhotoResult(result) {
  if (!result?.attached) return;
  if (Number.isFinite(Number(result.tableCount))) {
    state.savedPhotos.table = clampInteger(result.tableCount, 0, TABLE_PHOTO_LIMIT, state.savedPhotos.table);
  } else if (result.touchedManifest?.table) {
    state.savedPhotos.table = Math.min(TABLE_PHOTO_LIMIT, result.touchedManifest.table.length);
  }
  result.touchedManifest?.bays?.forEach((bay) => {
    const saved = savedBayPhotos(bay.bay_number);
    if (bay.loading) saved.loading = Math.min(PHASE_PHOTO_LIMIT, bay.loading.length);
    if (bay.unloading) saved.unloading = Math.min(PHASE_PHOTO_LIMIT, bay.unloading.length);
  });
  result.bayPhotos?.forEach((bay) => {
    const saved = savedBayPhotos(bay.bay_number);
    saved.loading = clampInteger(bay.loading_photo_count, 0, PHASE_PHOTO_LIMIT, saved.loading);
    saved.unloading = clampInteger(bay.unloading_photo_count, 0, PHASE_PHOTO_LIMIT, saved.unloading);
  });
}

function totalSavedPhotoCount() {
  return state.savedPhotos.table + Object.values(state.savedPhotos.bays).reduce(
    (total, bay) => total + Number(bay.loading || 0) + Number(bay.unloading || 0),
    0
  );
}

async function preparePhoto(file) {
  if (["image/heic", "image/heif"].includes(file.type)) {
    if (file.size <= CONFIG.maxPhotoBytes) return file;
    throw new Error(`${file.name} is larger than 8 MB and this browser cannot compress HEIC photos.`);
  }
  if (!window.createImageBitmap) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= CONFIG.maxPhotoBytes) return file;
    throw new Error(`${file.name} could not be compressed by this browser.`);
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= CONFIG.maxPhotoBytes) return file;
    throw new Error(`${file.name} could not be compressed by this browser.`);
  }

  const maxDimension = CONFIG.maxPhotoDimension;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 500_000) {
    bitmap.close?.();
    return file;
  }

  let width = Math.max(1, Math.round(bitmap.width * scale));
  let height = Math.max(1, Math.round(bitmap.height * scale));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await jpegBlobNearTarget(canvas, CONFIG.photoTargetBytes);
    if (blob.size <= CONFIG.maxPhotoBytes) {
      bitmap.close?.();
      return blob;
    }
    const reduction = Math.min(0.9, Math.sqrt(CONFIG.photoTargetBytes / blob.size) * 0.96);
    width = Math.max(1, Math.round(width * reduction));
    height = Math.max(1, Math.round(height * reduction));
  }
  bitmap.close?.();
  throw new Error(`${file.name} could not be compressed.`);
}

async function jpegBlobNearTarget(canvas, targetBytes) {
  let low = 0.4;
  let high = 0.84;
  let best = null;
  let smallest = null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToJpeg(canvas, quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= targetBytes) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }
  return best || smallest;
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Photo compression failed."));
    }, "image/jpeg", quality);
  });
}

async function uploadObject(objectPath, blob) {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${CONFIG.supabaseUrl}/storage/v1/object/${encodeURIComponent(CONFIG.photoBucket)}/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        "Content-Type": blob.type || "image/jpeg",
        "x-upsert": "false"
      },
      body: blob
    }
  );
  if (response.ok) return;
  const detail = await response.text();
  if ([400, 409].includes(response.status) && /duplicate|already exists/i.test(detail)) return;
  throw new Error(`Photo upload failed (${response.status})${detail ? `: ${safeServerDetail(detail)}` : ""}`);
}

async function callRpc(functionName, payload, { unwrapSingle = true } = {}) {
  const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    headers: {
      apikey: CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  if (!response.ok) {
    let detail = responseText;
    try {
      const parsed = JSON.parse(responseText);
      detail = parsed.message || parsed.details || parsed.hint || responseText;
    } catch {
      // Keep the text response.
    }
    throw new Error(`${response.status} ${detail || response.statusText}`);
  }
  if (!responseText) return {};
  const parsed = JSON.parse(responseText);
  return unwrapSingle && Array.isArray(parsed) ? parsed[0] || {} : parsed;
}

function showSuccess(receipt, photoResult) {
  const location = selectedLocation();
  els.receiptNumber.textContent = receipt.receipt_number || state.submissionId;
  els.receiptLocation.textContent = location ? tableLabel(location.label) : "-";
  els.receiptBays.textContent = String(
    receipt.bay_count ?? activeBayNumbers().filter((bayNumber) => bayHasData(bayNumber)).length
  );
  els.receiptPhotos.textContent = photoResult.count
    ? t("success.uploaded", { count: photoResult.count })
    : t("success.none");
  els.successSummary.textContent = photoResult.count ? t("success.withPhotos") : t("success.withoutPhotos");
  els.formPanel.hidden = true;
  els.successPanel.hidden = false;
  els.successPanel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
}

function setSubmittingUi(isSubmitting) {
  els.submitForm.disabled = isSubmitting;
  els.clearForm.disabled = isSubmitting;
  els.saveLoadingCapture.disabled = isSubmitting;
  els.saveUnloadingCapture.disabled = isSubmitting;
  els.topNewRecord.disabled = isSubmitting;
  els.newRecord.disabled = isSubmitting;
  els.submitForm.textContent = t(isSubmitting ? "action.submitting" : "action.submit");
}

function clearFormWithConfirmation() {
  if (window.confirm(t("confirm.clear"))) resetForNewRecord();
}

function startNewRecord() {
  if (!formHasMeaningfulData() || window.confirm(t("confirm.newRecord"))) resetForNewRecord();
}

function resetForNewRecord({ scroll = true } = {}) {
  localStorage.removeItem(CONFIG.draftStorageKey);
  els.form.reset();
  els.form.classList.remove("was-validated");
  els.formPanel.hidden = false;
  els.successPanel.hidden = true;
  const trials = state.trials;
  const records = state.records;
  const recordsStatusKey = state.recordsStatusKey;
  const recordsStatusArgs = state.recordsStatusArgs;
  const recordsStatusError = state.recordsStatusError;
  state = freshState();
  state.trials = trials;
  state.records = records;
  state.recordsStatusKey = recordsStatusKey;
  state.recordsStatusArgs = recordsStatusArgs;
  state.recordsStatusError = recordsStatusError;
  loadRememberedEnumerator();
  els.saveStatus.textContent = "";
  renderAll();
  renderRecords();
  if (scroll) window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
}

function setStatus(message, status = "") {
  els.saveStatus.textContent = message || "";
  els.saveStatus.dataset.status = status;
}

function friendlyError(error) {
  const message = String(error?.message || error || "Submission failed.");
  if (/failed to fetch|networkerror|load failed/i.test(message)) return t("status.network");
  if (isDatabasePendingError(error)) return t("status.databasePending");
  return t("status.submitFailed", { message });
}

function simpleErrorMessage(error) {
  return String(error?.message || error || "Unknown error").replace(/^\d{3}\s+/, "");
}

function isDatabasePendingError(error) {
  return /404.*(seaweed_drying|trial_schedule)|could not find the function/i.test(String(error?.message || error || ""));
}

function isEditTokenError(error) {
  return /edit token|record token|token does not match/i.test(String(error?.message || error || ""));
}

function createUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createUploadToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function recordAccessFor(receiptNumber) {
  if (!receiptNumber) return null;
  if (state.receiptNumber === receiptNumber && state.submissionId && state.uploadToken) {
    return { id: state.submissionId, token: state.uploadToken };
  }
  try {
    const records = JSON.parse(localStorage.getItem(CONFIG.recordTokensStorageKey) || "{}");
    const access = records?.[receiptNumber];
    return isUuid(access?.id) && typeof access?.token === "string"
      ? { id: access.id, token: access.token }
      : null;
  } catch {
    return null;
  }
}

function rememberRecordAccess(receiptNumber, submissionId, token) {
  if (!receiptNumber || !isUuid(submissionId) || typeof token !== "string") return;
  try {
    const records = JSON.parse(localStorage.getItem(CONFIG.recordTokensStorageKey) || "{}");
    records[receiptNumber] = { id: submissionId, token, savedAt: new Date().toISOString() };
    const trimmed = Object.fromEntries(Object.entries(records)
      .sort(([, a], [, b]) => String(b?.savedAt || "").localeCompare(String(a?.savedAt || "")))
      .slice(0, 100));
    localStorage.setItem(CONFIG.recordTokensStorageKey, JSON.stringify(trimmed));
  } catch {
    // Record editing still works for the active draft when local storage is unavailable.
  }
}

function nullableText(value) {
  const textValue = String(value ?? "").trim();
  return textValue || null;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatLocalInput(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function localDateTimeFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? localDateTimeValue(date) : "";
}

function formatRecordDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRecordDay(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function displayNumber(value, maximumFractionDigits = 1) {
  const number = nullableNumber(value);
  return number === null ? "-" : new Intl.NumberFormat(getLocale(), { maximumFractionDigits }).format(number);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoExtension(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic" || mimeType === "image/heif") return "heic";
  return "jpg";
}

function clampInteger(value, min, max, fallback) {
  const integer = Number.parseInt(value, 10);
  return Number.isInteger(integer) ? Math.min(max, Math.max(min, integer)) : fallback;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function safeServerDetail(value) {
  return String(value).replace(/<[^>]*>/g, "").slice(0, 300);
}

function preferredScrollBehavior() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
