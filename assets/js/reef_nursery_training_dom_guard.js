const PARTICIPANT_REFERENCE_MAX_LENGTH = 100;
const ACTION_TIMEOUT_MS = 20000;

const LOCATION_OPTIONS = Object.freeze([
  ["tumbe_shore", "Tumbe - Shore / Farm"],
  ["tumbe_offshore", "Tumbe - Offshore Nursery Site"],
  ["mkwiro_shore", "Mkwiro - Shore / Farm"],
  ["mkwiro_offshore", "Mkwiro - Offshore Nursery Site"]
]);
const LEGACY_TRAINING_LOCATIONS = Object.freeze([
  ["mkwiro", "Mkwiro (existing record)"],
  ["offshore_nursery", "Offshore nursery site (existing record)"],
  ["shoreline_preparation", "Shoreline preparation area (existing record)"]
]);
const GENDER_OPTIONS = Object.freeze([
  ["", "No Entry"],
  ["male", "Male"],
  ["female", "Female"]
]);
const LEGACY_GENDERS = Object.freeze([
  ["other", "Other (existing record)"],
  ["prefer_not_to_say", "Prefer not to say (existing record)"]
]);
const LOCATION_DISPLAY_REPLACEMENTS = Object.freeze({
  tumbe_shore: "Tumbe - Shore / Farm",
  tumbe_offshore: "Tumbe - Offshore Nursery Site",
  mkwiro_shore: "Mkwiro - Shore / Farm",
  mkwiro_offshore: "Mkwiro - Offshore Nursery Site",
  "Tumbe – Shore": "Tumbe - Shore / Farm",
  "Tumbe - Shore": "Tumbe - Shore / Farm",
  "Tumbe – Offshore Nursery Site": "Tumbe - Offshore Nursery Site",
  "Tumbe - Offshore Nursery": "Tumbe - Offshore Nursery Site",
  "Mkwiro – Shore": "Mkwiro - Shore / Farm",
  "Mkwiro - Shore": "Mkwiro - Shore / Farm",
  "Mkwiro – Offshore Nursery Site": "Mkwiro - Offshore Nursery Site",
  "Mkwiro - Offshore Nursery": "Mkwiro - Offshore Nursery Site"
});
const FORM_ACTIONS = Object.freeze({
  training: {
    formId: "reefNurseryForm",
    saveId: "saveReefNursery",
    submitId: "submitReefNursery",
    clearId: "clearReefNursery"
  },
  seaweed: {
    formId: "reefSeaweedForm",
    saveId: "saveReefSeaweedChanges",
    submitId: "submitReefSeaweed",
    clearId: "clearReefSeaweed",
    statusId: "reefSeaweedStatus",
    recordNumberId: "reefSeaweedRecordNumber",
    recordParam: "seaweed_record"
  },
  inspection: {
    formId: "reefInspectionForm",
    saveId: "saveReefInspectionChanges",
    submitId: "submitReefInspection",
    clearId: "clearReefInspection",
    statusId: "reefInspectionStatus",
    recordNumberId: "reefInspectionRecordNumber",
    recordParam: "inspection_record"
  }
});

let syncScheduled = false;
let programmaticSaveType = null;
let pendingStartNew = null;
let stayWatcher = null;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseDomGuards, { once: true });
} else {
  initialiseDomGuards();
}

function initialiseDomGuards() {
  document.addEventListener("keydown", protectParticipantKeyboardContract, true);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("change", scheduleDomSync, true);
  document.addEventListener("submit", handleDocumentSubmit, true);

  const observer = new MutationObserver(scheduleDomSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "maxlength", "aria-selected"]
  });
  scheduleDomSync();
}

function scheduleDomSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    syncDomContracts();
  });
}

function syncDomContracts() {
  document.querySelectorAll('[data-participant-field="reference"]').forEach((control) => {
    if (control.maxLength !== PARTICIPANT_REFERENCE_MAX_LENGTH) {
      control.maxLength = PARTICIPANT_REFERENCE_MAX_LENGTH;
    }
  });
  document.querySelectorAll('[data-participant-field="gender"]').forEach(syncGenderSelect);
  syncLocationSelect(document.getElementById("reefLocation"), true);
  syncLocationSelect(document.getElementById("reefSeaweedLocation"), false);
  syncLocationSelect(document.getElementById("reefInspectionLocation"), false);
  syncActionButtons();
  syncLocationDisplayText();
  syncPublicShell();
}

function syncLocationSelect(select, includeLegacyTraining) {
  if (!select) return;
  const current = String(select.value || "");
  const standardValues = new Set(LOCATION_OPTIONS.map(([value]) => value));
  const legacy = includeLegacyTraining ? [...LEGACY_TRAINING_LOCATIONS] : [];
  const knownLegacyValues = new Set(legacy.map(([value]) => value));
  if (current && !standardValues.has(current) && !knownLegacyValues.has(current)) {
    legacy.push([current, `${current} (existing record)`]);
  }
  const signature = JSON.stringify([current, ...LOCATION_OPTIONS, ...legacy]);
  if (select.dataset.reefSimpleLocationSignature === signature) return;

  const placeholder = optionElement("", "Select location");
  const standard = LOCATION_OPTIONS.map(([value, label]) => optionElement(value, label));
  const compatibility = legacy.map(([value, label]) => {
    const option = optionElement(value, label);
    option.hidden = value !== current;
    return option;
  });
  select.replaceChildren(placeholder, ...standard, ...compatibility);
  select.value = current;
  select.dataset.reefSimpleLocationSignature = signature;
}

function syncGenderSelect(select) {
  const current = String(select.value || "");
  const visibleValues = new Set(GENDER_OPTIONS.map(([value]) => value));
  const legacy = [...LEGACY_GENDERS];
  const legacyValues = new Set(legacy.map(([value]) => value));
  if (current && !visibleValues.has(current) && !legacyValues.has(current)) {
    legacy.push([current, `${current} (existing record)`]);
  }
  const signature = JSON.stringify([current, ...GENDER_OPTIONS, ...legacy]);
  if (select.dataset.reefSimpleGenderSignature === signature) return;

  const visible = GENDER_OPTIONS.map(([value, label]) => optionElement(value, label));
  const compatibility = legacy.map(([value, label]) => {
    const option = optionElement(value, label);
    option.hidden = value !== current;
    return option;
  });
  select.replaceChildren(...visible, ...compatibility);
  select.value = current;
  select.dataset.reefSimpleGenderSignature = signature;
}

function optionElement(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function syncActionButtons() {
  const reviewMode = isReviewMode();
  Object.entries(FORM_ACTIONS).forEach(([type, config]) => {
    if (reviewMode && type === "training") return;
    const save = document.getElementById(config.saveId);
    const submit = document.getElementById(config.submitId);
    const clear = document.getElementById(config.clearId);
    const row = save?.closest(".standard-form-actions") || submit?.closest(".standard-form-actions");

    if (save) {
      if (save.hidden) save.hidden = false;
      if (save.textContent !== "Save") save.textContent = "Save";
    }
    if (submit) {
      if (submit.hidden) submit.hidden = false;
      if (submit.textContent !== "Submit and start new") submit.textContent = "Submit and start new";
    }
    if (clear) {
      if (clear.hidden) clear.hidden = false;
      if (clear.textContent !== "Clear") clear.textContent = "Clear";
    }
    if (row && save && submit && clear) {
      if (save.nextElementSibling !== submit) row.insertBefore(save, submit);
      if (submit.nextElementSibling !== clear) row.insertBefore(submit, clear);
    }
  });
}

function syncLocationDisplayText() {
  document.querySelectorAll('td[data-label="Location"], .reef-legacy-summary-grid strong').forEach((element) => {
    const current = String(element.textContent || "").trim();
    const replacement = LOCATION_DISPLAY_REPLACEMENTS[current];
    if (replacement && replacement !== current) element.textContent = replacement;
  });
}

function syncPublicShell() {
  const reviewMode = isReviewMode();
  const accessGate = document.getElementById("reefAccessGate");
  const deniedMode = Boolean(accessGate && !accessGate.hidden);
  const publicNotice = document.getElementById("reefPublicNotice");
  const publicMode = Boolean(publicNotice && !publicNotice.hidden && !reviewMode && !deniedMode);
  const toolbarSignIn = document.getElementById("reefSignInAction");
  const hideToolbarSignIn = !publicMode;
  if (toolbarSignIn && toolbarSignIn.hidden !== hideToolbarSignIn) toolbarSignIn.hidden = hideToolbarSignIn;
  document.querySelectorAll(".mobile-profile-link").forEach((fallback) => {
    if (!fallback.hidden) fallback.hidden = true;
  });
  if (!publicMode) return;

  const publicSidebar = document.getElementById("reefNurserySidebar");
  const publicLayout = publicSidebar?.closest(".admin-layout");
  if (publicSidebar && !publicSidebar.hidden) publicSidebar.hidden = true;
  if (publicLayout && !publicLayout.classList.contains("admin-sidebar-unpinned")) {
    publicLayout.classList.add("admin-sidebar-unpinned");
  }
  document.querySelectorAll(".admin-sidebar-reveal, .mobile-menu-toggle").forEach((control) => {
    if (!control.hidden) control.hidden = true;
  });
}

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const saveEntry = Object.entries(FORM_ACTIONS).find(([, config]) => target.closest(`#${config.saveId}`));
  if (!saveEntry) return;

  const [type, config] = saveEntry;
  if (type === "training" || (isReviewMode() && type === "training")) return;
  if (pendingStartNew?.type !== type) beginStayOnRecord(type);
  if (currentRecordId(type)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  programmaticSaveType = type;
  const form = document.getElementById(config.formId);
  queueMicrotask(() => {
    if (!(form instanceof HTMLFormElement)) {
      programmaticSaveType = null;
      return;
    }
    form.requestSubmit();
  });
}

function handleDocumentSubmit(event) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form) return;
  const entry = Object.entries(FORM_ACTIONS).find(([, config]) => config.formId === form.id);
  if (!entry || entry[0] === "training") return;

  const [type, config] = entry;
  if (programmaticSaveType === type) {
    programmaticSaveType = null;
    return;
  }
  if (pendingStartNew?.type === type) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  beginStartNew(type);
  if (!currentRecordId(type)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  queueMicrotask(() => document.getElementById(config.saveId)?.click());
}

function beginStayOnRecord(type) {
  stopStayWatcher();
  const config = FORM_ACTIONS[type];
  const status = document.getElementById(config.statusId);
  const baselineText = String(status?.textContent || "");
  const baselineKind = String(status?.dataset.status || "");
  const selectedTab = document.querySelector('#reefNurseryTabs [data-reef-tab][aria-selected="true"]')?.dataset.reefTab || "";
  const scrollLeft = window.scrollX;
  const scrollTop = window.scrollY;
  let sawBusy = false;
  const startedAt = Date.now();

  stayWatcher = window.setInterval(() => {
    const currentStatus = document.getElementById(config.statusId);
    const text = String(currentStatus?.textContent || "");
    const kind = String(currentStatus?.dataset.status || "");
    const busy = actionButtons(type).some((button) => button.disabled);
    if (busy) sawBusy = true;
    const changed = sawBusy || text !== baselineText || kind !== baselineKind;
    if (changed && !busy && kind === "error") return stopStayWatcher();
    if (changed && !busy && /\b(submitted|saved|updated|loaded)\b/i.test(text)) {
      stopStayWatcher();
      if (currentStatus) {
        const recordNumber = document.getElementById(config.recordNumberId)?.textContent?.trim();
        currentStatus.textContent = `${recordNumber || formLabel(type)} saved.`;
        currentStatus.dataset.status = "success";
      }
      syncActionButtons();
      restorePlace(selectedTab, scrollLeft, scrollTop);
      return;
    }
    if (Date.now() - startedAt > ACTION_TIMEOUT_MS) stopStayWatcher();
  }, 80);
}

function beginStartNew(type) {
  stopPendingStartNew();
  const config = FORM_ACTIONS[type];
  const status = document.getElementById(config.statusId);
  pendingStartNew = {
    type,
    baselineText: String(status?.textContent || ""),
    baselineKind: String(status?.dataset.status || ""),
    sawBusy: false,
    startedAt: Date.now(),
    timer: null
  };
  pendingStartNew.timer = window.setInterval(() => {
    const current = pendingStartNew;
    if (!current || current.type !== type) return;
    const currentStatus = document.getElementById(config.statusId);
    const text = String(currentStatus?.textContent || "");
    const kind = String(currentStatus?.dataset.status || "");
    const busy = actionButtons(type).some((button) => button.disabled);
    if (busy) current.sawBusy = true;
    const changed = current.sawBusy || text !== current.baselineText || kind !== current.baselineKind;
    if (changed && !busy && kind === "error") return stopPendingStartNew();
    if (changed && !busy && /\b(submitted|saved)\b/i.test(text)) {
      stopPendingStartNew();
      document.getElementById(config.clearId)?.click();
      return;
    }
    if (Date.now() - current.startedAt > ACTION_TIMEOUT_MS) stopPendingStartNew();
  }, 80);
}

function stopStayWatcher() {
  if (stayWatcher !== null) window.clearInterval(stayWatcher);
  stayWatcher = null;
}

function stopPendingStartNew() {
  if (pendingStartNew?.timer) window.clearInterval(pendingStartNew.timer);
  pendingStartNew = null;
}

function actionButtons(type) {
  const config = FORM_ACTIONS[type];
  return [config.saveId, config.submitId].map((id) => document.getElementById(id)).filter(Boolean);
}

function restorePlace(tabName, left, top) {
  if (tabName) document.querySelector(`#reefNurseryTabs [data-reef-tab="${selectorEscape(tabName)}"]`)?.click();
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ left, top, behavior: "auto" })));
}

function currentRecordId(type) {
  return new URLSearchParams(window.location.search).get(FORM_ACTIONS[type].recordParam);
}

function formLabel(type) {
  return type === "seaweed" ? "Seaweed Record" : "Raft and Mooring Inspection";
}

function protectParticipantKeyboardContract(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.matches("[data-participant-field]")) return;
  if (event.key === "Enter" && !event.shiftKey && target.tagName !== "SELECT") {
    const row = target.closest("tr");
    const rows = [...document.querySelectorAll("#reefParticipantRows tr")];
    if (row && row === rows.at(-1)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }
  if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
      || !target.matches('[data-participant-field="gender"]')) return;
  const row = target.closest("tr");
  const rows = [...document.querySelectorAll("#reefParticipantRows tr")];
  if (!row || row !== rows.at(-1) || !participantRowHasValue(row)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.getElementById("addReefParticipant")?.click();
  requestAnimationFrame(() => document.querySelector("#reefParticipantRows tr:last-child")
    ?.querySelector('[data-participant-field="name"]')?.focus());
}

function participantRowHasValue(row) {
  return [...row.querySelectorAll("[data-participant-field]")]
    .some((control) => String(control.value || "").trim());
}

function selectorEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function isReviewMode() {
  const parameters = new URLSearchParams(window.location.search);
  return Boolean(parameters.get("share") && parameters.get("org"));
}

export const REEF_TRAINING_DOM_GUARD_CONTRACT = Object.freeze({
  participantReferenceMaxLength: PARTICIPANT_REFERENCE_MAX_LENGTH,
  originalParticipantTabBehaviour: true,
  duplicateSignInRemoved: true,
  publicSidebarHidden: true,
  sharedLocationOptions: true,
  genderNoEntryDefault: true,
  consistentActionOrder: true,
  trainingPhotosNotBlocked: true
});
