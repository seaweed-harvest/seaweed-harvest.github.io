import { APP_CONFIG } from "./config.js";
import {
  callPublicRpc,
  callRpc,
  dataModeLabel,
  isSupabaseEnabled,
  selectRows
} from "./supabase_client.js";
import {
  configuredFieldLabel,
  initCollectionLanguage,
  t,
  unitLabel
} from "./collection_language.js";
import {
  initialiseOfflineStore,
  listOutboxItems,
  loadReferenceSnapshot,
  offlineStorageEstimate,
  offlineStorageSupported,
  requestPersistentOfflineStorage,
  saveCollectionToOutbox,
  saveReferenceSnapshot
} from "./offline_store.js";
import { syncPendingCollections } from "./offline_sync.js";

const state = {
  communities: [],
  farmers: [],
  formSettings: [],
  gradePrices: [],
  pricingRules: [],
  pricePerKg: { ...APP_CONFIG.pricePerKg },
  seaweedTypes: [],
  productForms: [],
  authApi: null,
  customFields: [],
  defaultSeaweedType: "spinosum",
  session: null,
  profile: null,
  aggregatorContext: null,
  publicMode: true,
  canOverridePrice: false,
  submissionId: crypto.randomUUID(),
  selectedFarmer: null,
  gps: null,
  offline: {
    installPrompt: null,
    native: false,
    online: navigator.onLine,
    persistent: null,
    ready: false,
    referenceSavedAt: null,
    serviceWorkerReady: false,
    syncing: false
  },
  qrScanner: {
    canvas: null,
    context: null,
    detector: null,
    frameRequest: null,
    scanTarget: null,
    scanning: false,
    stream: null
  }
};

const PHOTO_MAX_COUNT = 5;
const PHOTO_MAX_BYTES = 700 * 1024;
const PHOTO_TARGET_BYTES = 550 * 1024;
const PHOTO_MAX_EDGE = 1920;
const COLLECTOR_NAME_STORAGE_KEY = "seaweed_harvest:collector_name";
const FORM_REFERENCE_KEY = "mawimbi-collection-form";
const MAWIMBI_CONTEXT_KEY = "mawimbi-context";

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  initCollectionLanguage();
  cacheElements();
  await initialiseNativeRuntime();
  await initialiseOfflineCollection();
  try {
    await initialiseCollectionAccess();
  } catch (error) {
    state.session = null;
    state.profile = null;
    state.publicMode = true;
    try {
      await loadPublicMawimbiContext();
    } catch (publicError) {
      document.body.removeAttribute("data-auth-pending");
      setStatus(publicError.message || error.message, "error");
      return;
    }
  }
  setupCollectionHeader();
  setupCollectorName();
  applyCollectionAccessMode();
  renderActiveAggregator();
  bindEvents();
  setDefaultDateTime();
  await loadFormData();
  ensureTransactionId();
  updateEmptyFieldHighlights();
  try {
    await refreshOfflineQueue();
  } finally {
    document.body.removeAttribute("data-auth-pending");
  }
}

async function initialiseCollectionAccess() {
  const storedAuth = localStorage.getItem("seaweed-ag-auth");
  if (!storedAuth || !isOnline()) {
    state.session = null;
    state.profile = null;
    state.publicMode = true;
    state.canOverridePrice = false;
    await loadPublicMawimbiContext();
    return;
  }

  state.authApi = await import("./auth_client.js");
  state.session = await state.authApi.currentSession();
  if (state.session) {
    try {
      state.profile = await state.authApi.currentProfile(true);
    } catch {
      state.profile = null;
    }
  }

  const profile = state.profile;
  const canUseAuthenticatedRoute = Boolean(
    state.session
    && profile?.account_status === "active"
    && (profile.app_role === "system_admin" || profile.can_submit_collection)
  );

  state.publicMode = !canUseAuthenticatedRoute;
  if (canUseAuthenticatedRoute) {
    state.aggregatorContext = await state.authApi.currentAggregatorContext(true);
    state.canOverridePrice = profile.app_role === "system_admin"
      || (profile.can_view_finance && ["platform_admin", "aggregator_admin", "finance"].includes(profile.active_membership_role));
    return;
  }

  state.canOverridePrice = false;
  await loadPublicMawimbiContext();
}

async function loadPublicMawimbiContext() {
  let aggregator;
  try {
    aggregator = await callPublicRpc("ag_public_mawimbi_context");
    if (aggregator?.id && state.offline.ready) {
      try {
        await saveReferenceSnapshot(MAWIMBI_CONTEXT_KEY, aggregator);
      } catch (storageError) {
        state.offline.ready = false;
        setStatus(storageError.message || t("offline.unavailable"), "error");
      }
    }
  } catch (error) {
    const cached = state.offline.ready ? await loadReferenceSnapshot(MAWIMBI_CONTEXT_KEY) : null;
    if (!cached?.value?.id) throw error;
    aggregator = cached.value;
    state.offline.referenceSavedAt = cached.savedAt;
  }
  if (!aggregator?.id) throw new Error("Mawimbi collection intake is not available.");
  state.aggregatorContext = {
    active_aggregator_id: aggregator.id,
    active_aggregator: aggregator,
    aggregators: [aggregator]
  };
}

function setupCollectionHeader() {
  const profile = state.profile;
  const signedIn = Boolean(state.session && profile);
  els.collectionSignInLink.hidden = signedIn;
  els.collectionAdminLink.hidden = !(signedIn
    && profile.account_status === "active"
    && (profile.app_role === "system_admin" || profile.can_access_admin));

  if (!signedIn) return;
  state.authApi?.setupAccountControls(profile, {
    returnPage: "index.html",
    signOutReturn: "./index.html",
    showAggregator: !state.publicMode,
    languageEvent: "seaweed-collection-language-change",
    labels: () => ({
      myDetails: t("account.myDetails"),
      changePassword: t("account.changePassword"),
      signOut: t("account.signOut")
    })
  });
}

function setupCollectorName() {
  const remembered = String(localStorage.getItem(COLLECTOR_NAME_STORAGE_KEY) || "").trim();
  els.collectorName.value = remembered || state.profile?.display_name || "";
  rememberCollectorName();
  els.collectorName.addEventListener("input", rememberCollectorName);
}

function rememberCollectorName() {
  const name = String(els.collectorName.value || "").trim().replace(/\s+/g, " ");
  if (name) localStorage.setItem(COLLECTOR_NAME_STORAGE_KEY, name);
}

async function initialiseOfflineCollection() {
  if (!offlineStorageSupported()) {
    els.offlineReadiness.textContent = t("offline.unavailable");
    els.offlineReadiness.dataset.status = "error";
    return;
  }

  try {
    await initialiseOfflineStore();
    state.offline.ready = true;
    state.offline.persistent = await requestPersistentOfflineStorage();
    await offlineStorageEstimate();
  } catch (error) {
    els.offlineReadiness.textContent = error.message || t("offline.unavailable");
    els.offlineReadiness.dataset.status = "error";
  }

  if (state.offline.native) {
    state.offline.serviceWorkerReady = true;
  } else if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js");
      state.offline.serviceWorkerReady = Boolean(registration.active || registration.waiting);
      navigator.serviceWorker.ready.then(() => {
        state.offline.serviceWorkerReady = true;
        updateOfflineReadiness();
      }).catch(() => null);
    } catch {
      state.offline.serviceWorkerReady = false;
    }
  }

  window.addEventListener("online", () => {
    state.offline.online = true;
    updateOfflineReadiness();
    void refreshOfflineQueue();
  });
  window.addEventListener("offline", () => {
    state.offline.online = false;
    updateOfflineReadiness();
  });
  window.addEventListener("focus", () => {
    updateOfflineReadiness();
    void refreshOfflineQueue();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshOfflineQueue();
  });
  updateOfflineReadiness();
}

async function initialiseNativeRuntime() {
  const native = globalThis.SeaweedNative;
  state.offline.native = Boolean(native?.isNative);
  state.offline.online = navigator.onLine;
  if (!state.offline.native || !native?.Network) return;

  try {
    const status = await native.Network.getStatus();
    state.offline.online = Boolean(status.connected);
  } catch {
    state.offline.online = navigator.onLine;
  }

  try {
    await native.Network.addListener("networkStatusChange", (status) => {
      state.offline.online = Boolean(status.connected);
      updateOfflineReadiness();
      void refreshOfflineQueue();
    });
  } catch {
    // Browser online/offline events remain available as a fallback.
  }
}

function isOnline() {
  return Boolean(state.offline.online);
}

function applyCollectionAccessMode() {
  els.assignFarmerId.hidden = true;
  if (!state.publicMode) return;

  els.collectionPhotosField.hidden = false;
  els.collectionPhotos.disabled = false;
  const gradeField = els.seaweedGrade.closest("label");
  if (gradeField) gradeField.hidden = false;
  els.seaweedGrade.disabled = false;
  els.seaweedGrade.required = true;
}

function cacheElements() {
  [
    "offlineSyncPanel",
    "offlineReadiness",
    "offlineSyncNow",
    "pendingRecordsBand",
    "pendingRecordsBandLabel",
    "pendingRecordsBandText",
    "pendingRecordsBandSync",
    "collectionConnectionStatus",
    "collectionAdminLink",
    "collectionSignInLink",
    "collectionForm",
    "collectorName",
    "collectionWebsite",
    "farmerId",
    "lookupFarmer",
    "scanFarmerId",
    "farmerLinkStatus",
    "farmerDetails",
    "quickFarmerName",
    "quickFarmerCommunity",
    "quickFarmerFarmSize",
    "manualFarmerFirstName",
    "manualFarmerLastNames",
    "manualFarmerPhone",
    "manualCommunityInput",
    "manualFarmerFarmSize",
    "manualFarmerFarmSizeUnit",
    "assignFarmerId",
    "communityOptions",
    "communityId",
    "communityName",
    "sackId",
    "scanSackId",
    "transactionId",
    "collectedAt",
    "captureGps",
    "gpsSummary",
    "sackWeightKg",
    "seaweedType",
    "seaweedGrade",
    "productForm",
    "pricePerKg",
    "priceSourceStatus",
    "totalPrice",
    "priceOverridden",
    "priceOverrideReasonField",
    "priceOverrideReason",
    "customCollectionFields",
    "collectionNotes",
    "collectionPhotos",
    "collectionPhotosField",
    "collectionPhotoStatus",
    "clearCollectionForm",
    "collectionSaveStatus",
    "collectionReceiptResult",
    "savedReceiptNumber",
    "savedReceiptAggregator",
    "savedReceiptWeight",
    "savedReceiptPrice",
    "savedReceiptTotal",
    "viewSavedReceipt",
    "dismissSavedReceipt",
    "qrScannerModal",
    "qrScannerVideo",
    "qrScannerStatus",
    "stopQrScanner"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.offlineSyncNow.addEventListener("click", () => syncOutbox({ announce: true }));
  els.pendingRecordsBandSync.addEventListener("click", () => syncOutbox({ announce: true }));
  document.addEventListener("seaweed-collection-language-change", () => {
    updateOfflineReadiness();
    void refreshOfflineQueue();
  });
  els.lookupFarmer.addEventListener("click", lookupFarmer);
  els.scanFarmerId.addEventListener("click", () => startQrScanner("farmer"));
  els.farmerId.addEventListener("change", lookupFarmer);
  els.farmerId.addEventListener("input", () => {
    const hadLinkedFarmer = Boolean(state.selectedFarmer);
    state.selectedFarmer = null;
    if (hadLinkedFarmer) clearManualFarmerDetails();
    setFarmerStatus("");
    updateQuickReference();
  });
  els.manualFarmerFirstName.addEventListener("input", updateQuickReference);
  els.manualFarmerLastNames.addEventListener("input", updateQuickReference);
  els.manualFarmerPhone.addEventListener("input", updateQuickReference);
  els.manualFarmerFarmSize.addEventListener("input", updateQuickReference);
  els.manualFarmerFarmSizeUnit.addEventListener("change", updateQuickReference);
  els.manualCommunityInput.addEventListener("input", syncManualCommunity);
  els.manualCommunityInput.addEventListener("change", syncManualCommunity);
  els.assignFarmerId.addEventListener("click", assignNextFarmerId);
  els.sackId.addEventListener("change", () => {
    els.sackId.value = normalizedSackId();
    ensureTransactionId();
    if (!state.gps) captureGps();
  });
  els.scanSackId.addEventListener("click", () => startQrScanner("sack"));
  els.captureGps.addEventListener("click", captureGps);
  els.sackWeightKg.addEventListener("input", updatePrice);
  els.seaweedGrade.addEventListener("change", updatePriceForGrade);
  els.seaweedType.addEventListener("change", updatePriceForGrade);
  els.productForm.addEventListener("change", updatePriceForGrade);
  els.collectedAt.addEventListener("change", refreshPricingForDate);
  els.pricePerKg.addEventListener("input", () => {
    els.priceOverridden.checked = true;
    updateOverrideReasonVisibility();
    updateTotalPrice();
  });
  els.priceOverridden.addEventListener("change", () => {
    updateOverrideReasonVisibility();
    if (!els.priceOverridden.checked) updatePriceForGrade();
  });
  els.clearCollectionForm.addEventListener("click", clearForm);
  els.collectionForm.addEventListener("submit", submitCollection);
  els.collectionForm.addEventListener("input", updateCustomCalculations);
  els.collectionForm.addEventListener("change", updateCustomCalculations);
  els.collectionForm.addEventListener("input", updateEmptyFieldHighlights);
  els.collectionForm.addEventListener("change", updateEmptyFieldHighlights);
  els.collectionPhotos.addEventListener("change", () => {
    updatePhotoSelectionStatus();
  });
  els.stopQrScanner.addEventListener("click", stopQrScanner);
  els.dismissSavedReceipt.addEventListener("click", () => { els.collectionReceiptResult.hidden = true; });
  document.addEventListener("seaweed-collection-language-change", refreshTranslatedContent);
}

async function loadFormData() {
  setConnectionStatus(t("status.loading"), "status-muted");
  let formData;
  let loadedFromNetwork = false;
  try {
    const [communities, farmers, formSettings, gradePrices, seaweedTypes, productForms, customFields, pricingRules] = await Promise.all([
      state.publicMode
        ? callPublicRpc("ag_public_mawimbi_communities")
        : selectRows(APP_CONFIG.tables.communities, "select=*&order=community_id.asc"),
      isSupabaseEnabled()
        ? Promise.resolve([])
        : selectRows(APP_CONFIG.tables.farmers, "select=*&order=farmer_id.asc"),
      selectRows("ag_public_collection_form_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_product_form_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_collection_custom_fields", "select=*&order=display_order.asc"),
      state.publicMode
        ? callPublicRpc("ag_public_mawimbi_pricing", { p_collection_date: collectionDateValue() })
        : callRpc("ag_my_current_pricing", { p_collection_date: collectionDateValue() })
    ]);
    formData = { communities, farmers, formSettings, gradePrices, seaweedTypes, productForms, customFields, pricingRules };
    loadedFromNetwork = true;
  } catch (error) {
    const snapshot = state.offline.ready ? await loadReferenceSnapshot(FORM_REFERENCE_KEY) : null;
    if (!snapshot?.value) {
      setConnectionStatus(t("status.error"), "status-muted");
      setStatus(error.message, "error");
      updateOfflineReadiness();
      return;
    }
    formData = snapshot.value;
    state.offline.referenceSavedAt = snapshot.savedAt;
  }

  if (loadedFromNetwork && state.offline.ready) {
    try {
      const snapshot = await saveReferenceSnapshot(FORM_REFERENCE_KEY, formData);
      state.offline.referenceSavedAt = snapshot.savedAt;
    } catch (storageError) {
      state.offline.ready = false;
      setStatus(storageError.message || t("offline.unavailable"), "error");
    }
  }

  applyFormData(formData);
  setConnectionStatus(isOnline() ? translatedDataMode() : t("offline.offline"), isOnline() ? "" : "status-muted");
  updateOfflineReadiness();
}

function applyFormData(formData) {
  state.communities = formData.communities || [];
  state.farmers = formData.farmers || [];
  state.formSettings = formData.formSettings || [];
  state.gradePrices = formData.gradePrices || [];
  state.seaweedTypes = formData.seaweedTypes || [];
  state.productForms = formData.productForms || [];
  state.customFields = formData.customFields || [];
  state.pricingRules = formData.pricingRules || [];
  state.pricePerKg = {};
  state.defaultSeaweedType = state.seaweedTypes.find((row) => row.is_default)?.type_key || "spinosum";
  renderCommunityOptions();
  applyRuntimeSettings(state.gradePrices);
  renderCustomFields();
  updateQuickReference();
  updatePriceForGrade();
  updateEmptyFieldHighlights();
}

function renderCommunityOptions() {
  els.communityOptions.innerHTML = state.communities.map((community) => {
    const label = communityLabel(community);
    return `<option value="${escapeAttribute(label)}"></option>`;
  }).join("");
  syncCommunityName();
}

async function lookupFarmer() {
  const farmerId = normalizedFarmerId();
  if (!farmerId) {
    state.selectedFarmer = null;
    setFarmerStatus("");
    updateQuickReference();
    return;
  }

  els.farmerId.value = farmerId;
  let farmer = state.farmers.find((row) => row.farmer_id.toUpperCase() === farmerId) || null;
  if (!farmer && isSupabaseEnabled()) {
    try {
      const result = state.publicMode
        ? await callPublicRpc("ag_public_mawimbi_farmer_lookup", { p_farmer_id: farmerId })
        : await callRpc("ag_public_farmer_lookup", { p_farmer_id: farmerId });
      farmer = result && Object.keys(result).length ? result : null;
    } catch (error) {
      setFarmerStatus(t("status.lookupFailed"), "status-muted");
      setStatus(error.message, "error");
      return;
    }
  }
  state.selectedFarmer = farmer || null;

  if (!farmer) {
    setFarmerStatus(t("status.notFound"), "status-muted");
    updateQuickReference();
    return;
  }

  els.farmerId.value = farmer.farmer_id;
  if (farmer.community_id) {
    els.communityId.value = farmer.community_id;
    syncCommunityName();
  }
  syncManualDetailsFromFarmer(farmer);
  updateQuickReference();
  setFarmerStatus(t("status.linked"), "");
}

function syncManualDetailsFromFarmer(farmer) {
  const community = communityById(farmer.community_id);
  const name = splitFarmerName(farmer.name);
  els.manualFarmerFirstName.value = name.firstName;
  els.manualFarmerLastNames.value = name.lastNames;
  els.manualFarmerPhone.value = farmer.phone || "";
  els.manualCommunityInput.value = communityLabel(community) || farmer.community_id || "";
  els.manualFarmerFarmSize.value = farmer.farm_size_value ?? "";
  els.manualFarmerFarmSizeUnit.value = farmer.farm_size_unit || "lines";
}

function clearManualFarmerDetails() {
  els.manualFarmerFirstName.value = "";
  els.manualFarmerLastNames.value = "";
  els.manualFarmerPhone.value = "";
  els.manualCommunityInput.value = "";
  els.manualFarmerFarmSize.value = "";
  els.manualFarmerFarmSizeUnit.value = "lines";
  els.communityId.value = "";
  syncCommunityName();
}

function syncCommunityName() {
  const community = selectedCommunity();
  els.communityName.value = community?.community_name || "";
}

function syncManualCommunity(event) {
  const community = findCommunityFromText(els.manualCommunityInput.value);
  els.communityId.value = community?.community_id || "";
  if (community && event?.type === "change") {
    els.manualCommunityInput.value = communityLabel(community);
  }
  syncCommunityName();
  updateQuickReference();
}

function updateQuickReference() {
  const community = selectedCommunity() || findCommunityFromText(els.manualCommunityInput.value);
  const farmerName = combinedManualFarmerName() || state.selectedFarmer?.name;
  els.quickFarmerName.textContent = farmerName || "-";
  els.quickFarmerCommunity.textContent = communityLabel(community) || "-";
  els.quickFarmerFarmSize.textContent = formatManualFarmSize();
}

function assignNextFarmerId() {
  els.farmerId.value = nextFarmerId();
  state.selectedFarmer = null;
  setFarmerStatus("");
  updateQuickReference();
}

function updatePriceForGrade() {
  const rule = selectedPricingRule();
  if (rule) {
    els.pricePerKg.value = Number(rule.price_per_kg).toFixed(2);
    els.priceOverridden.checked = false;
    els.priceSourceStatus.textContent = `${state.aggregatorContext?.active_aggregator?.default_currency || rule.currency} matrix price`;
  } else if (!els.priceOverridden.checked) {
    els.pricePerKg.value = "";
    els.totalPrice.value = "";
    els.priceSourceStatus.textContent = els.seaweedGrade.value
      ? "No configured price for this combination"
      : "Select a grade or enter an authorised price";
  }
  updateOverrideReasonVisibility();
  updateTotalPrice();
  updateEmptyFieldHighlights();
}

function updatePrice() {
  if (!els.priceOverridden.checked) updateTotalPrice();
}

function updateTotalPrice() {
  if (els.priceOverridden.checked && document.activeElement === els.totalPrice) return;

  const weight = nullableNumber(els.sackWeightKg.value);
  const price = nullableNumber(els.pricePerKg.value);
  if (weight === null || price === null) {
    els.totalPrice.value = "";
    updateEmptyFieldHighlights();
    return;
  }
  els.totalPrice.value = (weight * price).toFixed(2);
  updateEmptyFieldHighlights();
}

function selectedPricingRule() {
  const type = String(els.seaweedType.value || "").toLowerCase();
  const grade = String(els.seaweedGrade.value || "").toUpperCase();
  const form = String(els.productForm.value || "wet").toLowerCase();
  if (!type || !grade) return null;
  return state.pricingRules.find((row) => (
    row.seaweed_type === type
    && row.grade_code === grade
    && row.product_form === form
  )) || null;
}

function updateOverrideReasonVisibility() {
  const isOverride = Boolean(els.priceOverridden.checked);
  els.priceOverrideReasonField.hidden = !isOverride;
  els.priceOverrideReason.required = isOverride;
  els.pricePerKg.readOnly = !state.canOverridePrice;
  els.priceOverridden.closest("label").hidden = !state.canOverridePrice;
  if (!isOverride) els.priceOverrideReason.value = "";
  if (isOverride) els.priceSourceStatus.textContent = "Authorised manual price";
}

function collectionDateValue() {
  const value = els.collectedAt?.value;
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

async function refreshPricingForDate() {
  if (!isOnline()) {
    updatePriceForGrade();
    return;
  }
  try {
    state.pricingRules = state.publicMode
      ? await callPublicRpc("ag_public_mawimbi_pricing", { p_collection_date: collectionDateValue() })
      : await callRpc("ag_my_current_pricing", { p_collection_date: collectionDateValue() });
    if (state.offline.ready) {
      const snapshot = await saveReferenceSnapshot(FORM_REFERENCE_KEY, currentFormData());
      state.offline.referenceSavedAt = snapshot.savedAt;
      updateOfflineReadiness();
    }
    updatePriceForGrade();
  } catch (error) {
    els.priceSourceStatus.textContent = error.message;
    setStatus(error.message, "error");
  }
}

function currentFormData() {
  return {
    communities: state.communities,
    farmers: state.farmers,
    formSettings: state.formSettings,
    gradePrices: state.gradePrices,
    seaweedTypes: state.seaweedTypes,
    productForms: state.productForms,
    customFields: state.customFields,
    pricingRules: state.pricingRules
  };
}

function renderActiveAggregator() {
  const aggregator = state.aggregatorContext?.active_aggregator;
  if (!aggregator) throw new Error("No active aggregator is assigned to this account.");
  els.activeAggregatorBar = document.getElementById("activeAggregatorBar");
  els.activeAggregatorName = document.getElementById("activeAggregatorName");
  els.activeAggregatorName.textContent = `${aggregator.aggregator_code} - ${aggregator.organisation_name}`;
  els.activeAggregatorBar.hidden = false;
}

function ensureTransactionId() {
  if (els.transactionId.value) return;
  els.transactionId.value = makeTransactionId();
}

function makeTransactionId() {
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TXN-${stamp}-${suffix}`;
}

function setDefaultDateTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  els.collectedAt.value = local.toISOString().slice(0, 16);
}

function captureGps() {
  if (!navigator.geolocation) {
    els.gpsSummary.value = t("gps.unavailable");
    updateEmptyFieldHighlights();
    return;
  }

  els.gpsSummary.value = t("gps.getting");
  updateEmptyFieldHighlights();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.gps = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      els.gpsSummary.value = `${state.gps.latitude.toFixed(5)}, ${state.gps.longitude.toFixed(5)}`;
      updateEmptyFieldHighlights();
    },
    () => {
      els.gpsSummary.value = t("gps.notCaptured");
      updateEmptyFieldHighlights();
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

async function startQrScanner(scanTarget) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(t("scanner.unavailable"), "error");
    return;
  }

  const detector = await createNativeQrDetector();
  if (!detector && typeof window.jsQR !== "function") {
    setStatus(t("scanner.loadFailed"), "error");
    return;
  }

  try {
    state.qrScanner.scanTarget = scanTarget;
    state.qrScanner.detector = detector;
    els.qrScannerStatus.textContent = t("scanner.opening");
    els.qrScannerModal.hidden = false;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    state.qrScanner.stream = stream;
    state.qrScanner.scanning = true;
    els.qrScannerVideo.srcObject = stream;
    await els.qrScannerVideo.play();
    els.qrScannerStatus.textContent = scanTarget === "farmer"
      ? t("scanner.farmer")
      : t("scanner.sack");
    scanQrFrame();
  } catch (error) {
    stopQrScanner();
    setStatus(cameraErrorMessage(error), "error");
  }
}

async function scanQrFrame() {
  if (!state.qrScanner.scanning) return;

  try {
    const scannedValue = state.qrScanner.detector
      ? await scanWithNativeDetector()
      : scanWithJsQr();

    if (scannedValue) {
      applyScannedValue(scannedValue);
      stopQrScanner();
      return;
    }
  } catch {
    // Keep scanning; camera frames can be briefly unavailable while video starts.
  }

  state.qrScanner.frameRequest = requestAnimationFrame(scanQrFrame);
}

async function createNativeQrDetector() {
  if (!("BarcodeDetector" in window)) return null;

  try {
    if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (!formats.includes("qr_code")) return null;
    }
    return new window.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

async function scanWithNativeDetector() {
  const codes = await state.qrScanner.detector.detect(els.qrScannerVideo);
  const code = codes.find((item) => item.rawValue);
  return code?.rawValue || "";
}

function scanWithJsQr() {
  const video = els.qrScannerVideo;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height || typeof window.jsQR !== "function") return "";

  if (!state.qrScanner.canvas) {
    state.qrScanner.canvas = document.createElement("canvas");
    state.qrScanner.context = state.qrScanner.canvas.getContext("2d", { willReadFrequently: true });
  }

  const canvas = state.qrScanner.canvas;
  const context = state.qrScanner.context;
  if (!context) return "";

  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, width, height, {
    inversionAttempts: "attemptBoth"
  });

  return code?.data || "";
}

function applyScannedValue(rawValue) {
  const value = extractQrValue(rawValue, state.qrScanner.scanTarget);
  if (!value) {
    setStatus(t("scanner.noValue"), "error");
    return;
  }

  if (state.qrScanner.scanTarget === "farmer") {
    els.farmerId.value = normalizeFarmerIdValue(value);
    lookupFarmer();
    setStatus(t("scanner.farmerScanned"));
    return;
  }

  els.sackId.value = normalizeSackIdValue(value);
  ensureTransactionId();
  if (!state.gps) captureGps();
  setStatus(t("scanner.sackScanned"));
}

function stopQrScanner() {
  state.qrScanner.scanning = false;
  if (state.qrScanner.frameRequest) {
    cancelAnimationFrame(state.qrScanner.frameRequest);
    state.qrScanner.frameRequest = null;
  }
  if (state.qrScanner.stream) {
    state.qrScanner.stream.getTracks().forEach((track) => track.stop());
    state.qrScanner.stream = null;
  }
  els.qrScannerVideo.pause();
  els.qrScannerVideo.srcObject = null;
  els.qrScannerModal.hidden = true;
}

function extractQrValue(rawValue, scanTarget) {
  const text = String(rawValue || "").trim();
  if (!text) return "";

  try {
    const parsedUrl = new URL(text);
    const farmerParam = parsedUrl.searchParams.get("farmer_id")
      || parsedUrl.searchParams.get("farmerId")
      || parsedUrl.searchParams.get("rid")
      || parsedUrl.searchParams.get("id");
    const sackParam = parsedUrl.searchParams.get("sack_id")
      || parsedUrl.searchParams.get("sackId")
      || parsedUrl.searchParams.get("sid")
      || parsedUrl.searchParams.get("id");
    if (scanTarget === "farmer" && farmerParam) return farmerParam.trim();
    if (scanTarget === "sack" && sackParam) return sackParam.trim();
  } catch {
    // Plain QR values are expected and fine.
  }

  if (scanTarget === "farmer") {
    const ridMatch = text.match(/RID\s*([0-9]+)/i);
    if (ridMatch) return `RID${ridMatch[1]}`;
    const digitsOnly = text.match(/^\s*([0-9]+)\s*$/);
    if (digitsOnly) return digitsOnly[1];
  }

  return text.split(/\r?\n/)[0].trim();
}

function updatePhotoSelectionStatus() {
  const count = els.collectionPhotos.files?.length || 0;
  els.collectionPhotoStatus.textContent = count
    ? t("photos.selected", { count })
    : t("photos.hint");
}

async function prepareSelectedCollectionPhotos() {
  const files = [...(els.collectionPhotos.files || [])];
  if (!files.length) return [];
  if (files.length > PHOTO_MAX_COUNT) throw new Error(t("photos.tooMany"));
  if (files.some((file) => !String(file.type || "").startsWith("image/"))) {
    throw new Error(t("photos.invalid"));
  }

  const photos = [];
  for (let index = 0; index < files.length; index += 1) {
    const progress = { current: index + 1, total: files.length };
    els.collectionPhotoStatus.textContent = t("photos.processing", progress);
    const blob = await compressCollectionPhoto(files[index]);
    if (blob.size > PHOTO_MAX_BYTES) throw new Error(t("photos.compressFailed"));
    photos.push({
      id: crypto.randomUUID(),
      blob,
      name: String(files[index].name || `photo-${index + 1}.jpg`),
      size: blob.size,
      uploadedPath: null
    });
  }
  return photos;
}

export async function compressCollectionPhoto(file) {
  const image = await loadCollectionImage(file);
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error(t("photos.decodeFailed"));

  const initialScale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialScale));
  height = Math.max(1, Math.round(height * initialScale));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(t("photos.compressFailed"));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    const blob = await jpegBlobNearTarget(canvas);
    if (blob.size <= PHOTO_MAX_BYTES) return blob;

    const reduction = Math.min(0.9, Math.sqrt(PHOTO_TARGET_BYTES / blob.size) * 0.96);
    width = Math.max(1, Math.round(width * reduction));
    height = Math.max(1, Math.round(height * reduction));
  }

  throw new Error(t("photos.compressFailed"));
}

function loadCollectionImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(t("photos.decodeFailed")));
    };
    image.src = objectUrl;
  });
}

async function jpegBlobNearTarget(canvas) {
  let low = 0.38;
  let high = 0.92;
  let best = null;
  let smallest = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(canvas, quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= PHOTO_TARGET_BYTES) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }

  return best || smallest;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(t("photos.compressFailed")));
    }, "image/jpeg", quality);
  });
}

async function submitCollection(event) {
  event.preventDefault();
  const submitButton = event.submitter || document.getElementById("submitCollection");
  submitButton.disabled = true;

  try {
    if (!state.offline.ready) throw new Error(t("offline.unavailable"));
    rememberCollectorName();
    setStatus(t("status.saving"));
    const photos = await prepareSelectedCollectionPhotos();
    const payload = buildPayload([]);
    const farmSizeUpdate = pendingFarmSizeUpdate();
    if (state.publicMode && farmSizeUpdate) {
      payload.farm_size_update = {
        value: farmSizeUpdate.p_farm_size_value,
        unit: farmSizeUpdate.p_farm_size_unit
      };
    }

    const submissionId = state.submissionId;
    await saveCollectionToOutbox({
      submissionId,
      mode: state.publicMode ? "public" : "authenticated",
      collectorName: String(els.collectorName.value || "").trim(),
      website: els.collectionWebsite.value,
      payload,
      farmSizeUpdate: state.publicMode ? null : farmSizeUpdate,
      photos,
      summary: {
        transactionId: payload.transaction_id,
        collectedAt: payload.collected_at,
        community: payload.community_name_snapshot || payload.community_id || "No community",
        farmer: payload.farmer_name_snapshot || payload.farmer_id || "No farmer",
        weightKg: payload.sack_weight_kg,
        grade: payload.grade_code || "Ungraded"
      }
    });

    clearForm();
    setStatus(t("offline.localSaved"));
    await refreshOfflineQueue();

    if (isOnline()) {
      const saved = await syncOutbox({ submissionId });
      if (saved) {
        renderReceiptResult(saved);
        setStatus(t("offline.confirmed", { id: saved.transaction_id || payload.transaction_id }));
      }
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

function buildPayload(photoPaths = []) {
  const community = selectedCommunity();
  const weight = requiredNumber(els.sackWeightKg.value, t("harvest.weight"));
  const seaweedType = nullableText(els.seaweedType.value) || state.defaultSeaweedType;
  const gradeCode = nullableText(els.seaweedGrade.value);
  const collectedAt = els.collectedAt.value ? new Date(els.collectedAt.value) : new Date();
  const farmerNameSnapshot = combinedManualFarmerName() || state.selectedFarmer?.name || null;

  return {
    collector_name: requiredText(els.collectorName.value, t("collector.name")),
    transaction_id: requiredText(els.transactionId.value, t("harvest.transactionId")),
    farmer_id: null,
    farmer_record_id: null,
    farmer_name_snapshot: farmerNameSnapshot,
    community_id: nullableText(els.communityId.value),
    community_record_id: community?.id || null,
    community_name_snapshot: community?.community_name || null,
    sack_id: null,
    collected_at: collectedAt.toISOString(),
    gps_latitude: state.gps?.latitude ?? null,
    gps_longitude: state.gps?.longitude ?? null,
    gps_accuracy_m: state.gps?.accuracy ?? null,
    sack_weight_kg: weight,
    seaweed_type: seaweedType,
    product_form: els.productForm.value || "wet",
    grade_code: gradeCode,
    seaweed_grade: ["A", "B", "C"].includes(gradeCode) ? gradeCode : null,
    price_per_kg: nullableNumber(els.pricePerKg.value),
    total_price: nullableNumber(els.totalPrice.value),
    price_overridden: els.priceOverridden.checked,
    price_override_reason: nullableText(els.priceOverrideReason.value),
    notes: nullableText(els.collectionNotes.value),
    photo_urls: photoPaths,
    custom_fields: customFieldPayload()
  };
}

function clearForm(options = {}) {
  const collectorName = String(els.collectorName.value || "").trim();
  els.collectionForm.reset();
  els.collectorName.value = collectorName || localStorage.getItem(COLLECTOR_NAME_STORAGE_KEY) || "";
  els.collectionWebsite.value = "";
  state.selectedFarmer = null;
  state.gps = null;
  els.transactionId.value = "";
  els.gpsSummary.value = "";
  setDefaultDateTime();
  els.seaweedType.value = state.defaultSeaweedType;
  els.productForm.value = "wet";
  state.submissionId = crypto.randomUUID();
  ensureTransactionId();
  syncCommunityName();
  updateQuickReference();
  updateCustomCalculations();
  updatePhotoSelectionStatus();
  setFarmerStatus("");
  updatePriceForGrade();
  updateEmptyFieldHighlights();
  if (!options.keepReceipt) els.collectionReceiptResult.hidden = true;
}

function renderReceiptResult(saved) {
  if (!saved?.receipt_id) return;
  els.savedReceiptNumber.textContent = saved.receipt_number || "Saved";
  els.savedReceiptAggregator.textContent = saved.aggregator_name || state.aggregatorContext?.active_aggregator?.organisation_name || "-";
  els.savedReceiptWeight.textContent = `${formatCompactNumber(saved.weight_kg)} kg`;
  els.savedReceiptPrice.textContent = `${formatCompactNumber(saved.unit_price)} ${saved.currency || "KES"}`;
  els.savedReceiptTotal.textContent = `${formatCompactNumber(saved.total)} ${saved.currency || "KES"}`;
  els.viewSavedReceipt.href = `./receipt.html?id=${encodeURIComponent(saved.receipt_id)}`;
  els.viewSavedReceipt.hidden = state.publicMode;
  els.collectionReceiptResult.hidden = false;
}

async function syncOutbox(options = {}) {
  if (!state.offline.ready || state.offline.syncing) return null;
  if (!isOnline()) {
    updateOfflineReadiness();
    if (options.announce) setStatus(t("offline.localSaved"));
    return null;
  }

  state.offline.syncing = true;
  try {
    await refreshOfflineQueue();
    const result = await syncPendingCollections({
      submissionId: options.submissionId,
      online: isOnline(),
      onProgress: refreshOfflineQueue
    });
    if (result.requestedError || (options.announce && result.failedCount)) {
      const error = result.requestedError || result.errors[0];
      setStatus(`${t("offline.localSaved")} ${error?.message || "Sync could not be completed."}`, "error");
    } else if (options.announce && result.remainingCount === 0) {
      setStatus(t("offline.syncComplete"));
    }
    return result.requestedResult;
  } finally {
    state.offline.syncing = false;
    await refreshOfflineQueue();
  }
}

async function refreshOfflineQueue() {
  updateOfflineReadiness();
  if (!state.offline.ready) return;

  const items = await listOutboxItems();
  const pending = items.filter((item) => item.status !== "synced");
  els.offlineSyncNow.disabled = state.offline.syncing || !isOnline() || pending.length === 0;
  els.pendingRecordsBand.hidden = pending.length === 0;
  if (!pending.length) return;

  const countText = pending.length === 1
    ? t("offline.localCountOne")
    : t("offline.localCountMany", { count: pending.length });
  els.pendingRecordsBandLabel.textContent = isOnline()
    ? t("offline.localWaiting")
    : t("offline.deviceOffline");
  els.pendingRecordsBandText.textContent = countText;
  els.pendingRecordsBandSync.hidden = !isOnline();
  els.pendingRecordsBandSync.disabled = state.offline.syncing;
}

function updateOfflineReadiness() {
  if (!state.offline.ready) {
    els.offlineReadiness.textContent = t("offline.unavailable");
    els.offlineReadiness.dataset.status = "error";
    return;
  }
  els.offlineReadiness.dataset.status = "";
  if (!state.offline.referenceSavedAt) {
    els.offlineReadiness.textContent = t("offline.readyShort");
  } else if (!state.offline.serviceWorkerReady) {
    els.offlineReadiness.textContent = t("offline.preparingShort");
  } else {
    els.offlineReadiness.textContent = t("offline.readyShort");
  }
}

function splitFarmerName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "",
    lastNames: parts.join(" ")
  };
}

function combinedManualFarmerName() {
  return [els.manualFarmerFirstName.value, els.manualFarmerLastNames.value]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || null;
}

function normalizedFarmerId() {
  return normalizeFarmerIdValue(els.farmerId.value);
}

function normalizedSackId() {
  return normalizeSackIdValue(els.sackId.value);
}

function normalizeFarmerIdValue(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return `RID${raw.padStart(4, "0")}`;
  const match = raw.match(/^RID(\d+)$/);
  if (match) return `RID${match[1].padStart(4, "0")}`;
  return raw;
}

function normalizeSackIdValue(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return `B-${raw.padStart(4, "0")}`;
  const match = raw.match(/^B-?(\d+)$/);
  if (match) return `B-${match[1].padStart(4, "0")}`;
  return raw;
}

function selectedCommunity() {
  return communityById(els.communityId.value);
}

function communityById(communityId) {
  if (!communityId) return null;
  return state.communities.find((community) => community.community_id.toUpperCase() === communityId.toUpperCase()) || null;
}

function communityLabel(community) {
  if (!community) return "";
  return [community.community_id, community.community_name].filter(Boolean).join(" - ");
}

function formatFarmSize(farmer) {
  const value = nullableNumber(farmer?.farm_size_value);
  if (value === null) return "-";
  const unit = String(farmer?.farm_size_unit || "lines").trim() || "lines";
  return `${formatCompactNumber(value)} ${unitLabel(unit)}`;
}

function formatManualFarmSize() {
  const value = nullableNumber(els.manualFarmerFarmSize.value);
  if (value === null) return "-";
  const unit = String(els.manualFarmerFarmSizeUnit.value || "lines").trim() || "lines";
  return `${formatCompactNumber(value)} ${unitLabel(unit)}`;
}

function pendingFarmSizeUpdate() {
  if (!state.selectedFarmer) return null;

  const previousValue = nullableNumber(state.selectedFarmer.farm_size_value);
  const nextValue = nullableNumber(els.manualFarmerFarmSize.value);
  const previousUnit = String(state.selectedFarmer.farm_size_unit || "lines").trim() || "lines";
  const nextUnit = String(els.manualFarmerFarmSizeUnit.value || "lines").trim() || "lines";
  if (previousValue === nextValue && previousUnit === nextUnit) return null;

  return {
    p_farmer_id: state.selectedFarmer.farmer_id,
    p_farm_size_value: nextValue,
    p_farm_size_unit: nextUnit
  };
}

function formatCompactNumber(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}

function findCommunityFromText(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return null;
  return state.communities.find((community) => {
    const id = String(community.community_id || "").toUpperCase();
    const name = String(community.community_name || "").toUpperCase();
    const label = communityLabel(community).toUpperCase();
    return text === id || text === name || text === label || label.includes(text);
  }) || null;
}

function nextFarmerId() {
  const numbers = state.farmers
    .map((farmer) => String(farmer.farmer_id || "").match(/^RID(\d+)$/i))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const next = numbers.length ? Math.max(...numbers) + 1 : 4300;
  return `RID${String(next).padStart(4, "0")}`;
}

function applyRuntimeSettings(gradePrices) {
  const selectedType = els.seaweedType.value || state.defaultSeaweedType;
  const selectedGrade = els.seaweedGrade.value;
  const selectedForm = els.productForm.value || "wet";
  setFixedFormOrder();
  if (state.seaweedTypes.length) {
    els.seaweedType.innerHTML = state.seaweedTypes.map((row) => {
      const configuredLabel = row.type_key === "other" ? t("type.other") : row.label;
      const label = [configuredLabel, row.common_name].filter(Boolean).join(" - ");
      return `<option value="${escapeAttribute(row.type_key)}">${escapeHtml(label)}</option>`;
    }).join("");
    els.seaweedType.value = [...els.seaweedType.options].some((option) => option.value === selectedType)
      ? selectedType
      : state.defaultSeaweedType;
  }

  els.seaweedGrade.innerHTML = [
    `<option value="">${escapeHtml(t("common.select"))}</option>`,
    ...gradePrices.map((row) => {
      const name = row.label && row.label !== row.grade ? `${row.grade} - ${row.label}` : row.grade;
      const detail = row.rejected ? ` - ${t("grade.rejected")}` : "";
      return `<option value="${escapeAttribute(row.grade)}">${escapeHtml(name)}${escapeHtml(detail)}</option>`;
    })
  ].join("");
  els.seaweedGrade.value = [...els.seaweedGrade.options].some((option) => option.value === selectedGrade)
    ? selectedGrade
    : "";

  if (state.productForms.length) {
    els.productForm.innerHTML = state.productForms.map((row) => (
      `<option value="${escapeAttribute(row.form_key)}">${escapeHtml(row.label || row.form_key)}</option>`
    )).join("");
    els.productForm.value = [...els.productForm.options].some((option) => option.value === selectedForm)
      ? selectedForm
      : state.productForms.find((row) => row.form_key === "wet")?.form_key || state.productForms[0].form_key;
  }

  const controls = {
    farmer_id: els.farmerId,
    sack_id: els.sackId,
    transaction_id: els.transactionId,
    collected_at: els.collectedAt,
    gps: els.gpsSummary,
    sack_weight_kg: els.sackWeightKg,
    seaweed_type: els.seaweedType,
    seaweed_grade: els.seaweedGrade,
    product_form: els.productForm,
    price_per_kg: els.pricePerKg,
    total_price: els.totalPrice,
    notes: els.collectionNotes,
    photos: els.collectionPhotos
  };

  state.formSettings.forEach((setting) => {
    const control = controls[setting.field_key];
    const label = control?.closest("label");
    if (!control || !label) return;
    const visible = setting.field_key === "sack_weight_kg" || Boolean(setting.visible);
    label.hidden = !visible;
    label.style.order = String(setting.display_order || 0);
    control.required = visible && Boolean(setting.required);
    control.disabled = !visible;
    updateLabelText(label, configuredFieldLabel(setting.field_key, setting.label));
    if (setting.default_value && !control.value) control.value = setting.default_value;
  });

  els.farmerLinkStatus.closest(".field-status-block").hidden = true;
  document.querySelector(".quick-farmer-reference").hidden = false;
  els.farmerDetails.hidden = false;

  const priceVisible = state.formSettings.find((row) => row.field_key === "price_per_kg")?.visible !== false;
  const totalVisible = state.formSettings.find((row) => row.field_key === "total_price")?.visible !== false;
  els.priceOverridden.closest("label").hidden = !priceVisible && !totalVisible;
  updateOverrideReasonVisibility();
  applyCollectionAccessMode();
}

function renderCustomFields() {
  els.customCollectionFields.hidden = state.customFields.length === 0;
  els.customCollectionFields.innerHTML = state.customFields.map(customFieldControl).join("");
  updateCustomCalculations();
  updateEmptyFieldHighlights();
}

function updateEmptyFieldHighlights() {
  if (!els.collectionForm) return;
  const controls = els.collectionForm.querySelectorAll("input, select, textarea");
  controls.forEach((control) => {
    const type = String(control.type || "").toLowerCase();
    const excluded = ["hidden", "checkbox", "radio", "file", "button", "submit", "reset"].includes(type)
      || control.closest("[hidden]")
      || control.closest(".public-form-trap");
    if (excluded) {
      control.classList.remove("empty-value-control");
      return;
    }
    const hasValue = control.multiple
      ? control.selectedOptions.length > 0
      : String(control.value ?? "").trim().length > 0;
    control.classList.toggle("empty-value-control", !hasValue);
  });
}

function customFieldControl(field) {
  const id = `custom-${field.field_key}`;
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ""}`;
  const required = field.required ? "required" : "";
  const placeholder = field.placeholder ? `placeholder="${escapeAttribute(field.placeholder)}"` : "";
  const common = `id="${escapeAttribute(id)}" data-custom-field="${escapeAttribute(field.field_key)}" ${required}`;

  if (field.field_type === "checkbox") {
    const checked = String(field.default_value || "").toLowerCase() === "true" ? "checked" : "";
    return `<label class="check-row custom-field-control"><input type="checkbox" ${common} ${checked}> ${escapeHtml(label)}</label>`;
  }
  if (field.field_type === "long_text") {
    return `<label class="custom-field-control">${escapeHtml(label)}<textarea rows="3" ${common} ${placeholder}>${escapeHtml(field.default_value || "")}</textarea></label>`;
  }
  if (field.field_type === "single_select" || field.field_type === "multi_select") {
    const defaults = new Set(String(field.default_value || "").split(",").map((value) => value.trim()).filter(Boolean));
    const emptyOption = field.field_type === "single_select" && !field.required
      ? `<option value="">${escapeHtml(t("common.select"))}</option>`
      : "";
    const options = (field.options || []).map((option) => `<option value="${escapeAttribute(option)}" ${defaults.has(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
    return `<label class="custom-field-control">${escapeHtml(label)}<select ${common} ${field.field_type === "multi_select" ? "multiple" : ""}>${emptyOption}${options}</select></label>`;
  }

  const type = {
    number: "number",
    currency: "number",
    calculation: "number",
    date: "date",
    time: "time",
    datetime: "datetime-local",
    email: "email",
    phone: "tel"
  }[field.field_type] || "text";
  const numberSettings = ["number", "currency", "calculation"].includes(field.field_type)
    ? `step="${field.decimal_places === 0 ? "1" : "any"}" ${field.min_value !== null ? `min="${field.min_value}"` : ""} ${field.max_value !== null ? `max="${field.max_value}"` : ""}`
    : "";
  const readonly = field.field_type === "calculation" ? "readonly" : "";
  return `<label class="custom-field-control">${escapeHtml(label)}<input type="${type}" ${common} ${placeholder} ${numberSettings} ${readonly} value="${escapeAttribute(field.default_value || "")}"></label>`;
}

function customFieldPayload() {
  const payload = {};
  state.customFields.forEach((field) => {
    const control = els.customCollectionFields.querySelector(`[data-custom-field="${CSS.escape(field.field_key)}"]`);
    if (!control) return;

    if (field.field_type === "checkbox") {
      payload[field.field_key] = control.checked;
      return;
    }
    if (field.field_type === "multi_select") {
      const values = [...control.selectedOptions].map((option) => option.value);
      if (values.length) payload[field.field_key] = values;
      return;
    }
    if (["number", "currency", "calculation"].includes(field.field_type)) {
      const number = nullableNumber(control.value);
      if (number !== null) payload[field.field_key] = number;
      return;
    }
    const text = nullableText(control.value);
    if (text !== null) payload[field.field_key] = text;
  });
  const farmSizeValue = nullableNumber(els.manualFarmerFarmSize.value);
  if (farmSizeValue !== null) {
    payload.farm_size_value = farmSizeValue;
    payload.farm_size_unit = els.manualFarmerFarmSizeUnit.value || "lines";
  }
  return payload;
}

function updateCustomCalculations() {
  if (!els.customCollectionFields || !state.customFields.length) return;
  for (let pass = 0; pass < 3; pass += 1) {
    const values = numericFormulaValues();
    state.customFields.filter((field) => field.field_type === "calculation").forEach((field) => {
      const control = els.customCollectionFields.querySelector(`[data-custom-field="${CSS.escape(field.field_key)}"]`);
      if (!control) return;
      const result = evaluateFormula(field.formula, values);
      control.value = result === null ? "" : result.toFixed(Number(field.decimal_places ?? 2));
    });
  }
}

function numericFormulaValues() {
  const values = {
    sack_weight_kg: nullableNumber(els.sackWeightKg.value),
    price_per_kg: nullableNumber(els.pricePerKg.value),
    total_price: nullableNumber(els.totalPrice.value)
  };
  state.customFields.forEach((field) => {
    const control = els.customCollectionFields.querySelector(`[data-custom-field="${CSS.escape(field.field_key)}"]`);
    if (control && ["number", "currency", "calculation"].includes(field.field_type)) {
      values[field.field_key] = nullableNumber(control.value);
    }
  });
  return values;
}

function evaluateFormula(formula, values) {
  try {
    const tokens = formulaTokens(String(formula || ""), values);
    const output = [];
    const operators = [];
    const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "u-": 3 };
    let previous = "start";

    tokens.forEach((token) => {
      if (token.type === "number") {
        output.push(token);
        previous = "value";
      } else if (token.value === "(") {
        operators.push(token.value);
        previous = "left";
      } else if (token.value === ")") {
        while (operators.length && operators.at(-1) !== "(") output.push({ type: "operator", value: operators.pop() });
        if (operators.pop() !== "(") throw new Error("Unmatched parenthesis");
        previous = "value";
      } else {
        let operator = token.value;
        if (operator === "-" && ["start", "operator", "left"].includes(previous)) operator = "u-";
        while (operators.length && operators.at(-1) !== "(" && precedence[operators.at(-1)] >= precedence[operator]) {
          output.push({ type: "operator", value: operators.pop() });
        }
        operators.push(operator);
        previous = "operator";
      }
    });
    while (operators.length) {
      const operator = operators.pop();
      if (operator === "(") throw new Error("Unmatched parenthesis");
      output.push({ type: "operator", value: operator });
    }

    const stack = [];
    output.forEach((token) => {
      if (token.type === "number") stack.push(token.value);
      else if (token.value === "u-") stack.push(-stack.pop());
      else {
        const right = stack.pop();
        const left = stack.pop();
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error("Missing value");
        if (token.value === "+") stack.push(left + right);
        if (token.value === "-") stack.push(left - right);
        if (token.value === "*") stack.push(left * right);
        if (token.value === "/") stack.push(right === 0 ? NaN : left / right);
      }
    });
    return stack.length === 1 && Number.isFinite(stack[0]) ? stack[0] : null;
  } catch {
    return null;
  }
}

function formulaTokens(expression, values) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)/);
    if (number) { tokens.push({ type: "number", value: Number(number[0]) }); index += number[0].length; continue; }
    const identifier = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (identifier) {
      const value = values[identifier[0]];
      if (!Number.isFinite(value)) throw new Error("Missing value");
      tokens.push({ type: "number", value });
      index += identifier[0].length;
      continue;
    }
    if ("+-*/()".includes(rest[0])) { tokens.push({ type: "operator", value: rest[0] }); index += 1; continue; }
    throw new Error("Invalid formula");
  }
  return tokens;
}

function setFixedFormOrder() {
  const fixedOrder = [
    [document.querySelector(".field-status-block"), 20],
    [document.querySelector(".quick-farmer-reference"), 30],
    [els.farmerDetails, 40],
    [els.transactionId.closest("label"), 25],
    [els.productForm.closest("label"), 85],
    [els.priceOverridden.closest("label"), 95],
    [els.customCollectionFields, 96],
    [els.collectionPhotos.closest("label"), 110]
  ];
  fixedOrder.forEach(([element, order]) => {
    if (element) element.style.order = String(order);
  });
}

function refreshTranslatedContent() {
  applyRuntimeSettings(state.gradePrices);
  updateQuickReference();
  updatePhotoSelectionStatus();
  setConnectionStatus(isOnline() ? translatedDataMode() : t("offline.offline"), isOnline() ? "" : "status-muted");
  updateOfflineReadiness();
  void refreshOfflineQueue();
  if (state.selectedFarmer) {
    setFarmerStatus(t("status.linked"));
  } else if (!normalizedFarmerId()) {
    setFarmerStatus("");
  }
}

function translatedDataMode() {
  const mode = dataModeLabel();
  if (mode === "Preview") return t("status.preview");
  if (mode === "Live") return t("status.live");
  return mode;
}

function updateLabelText(label, text) {
  const labelSpan = [...label.children].find((child) => child.tagName === "SPAN" && !child.classList.contains("input-action-row"));
  if (labelSpan) {
    labelSpan.textContent = text;
    return;
  }
  const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = `\n            ${text}\n            `;
}

function setConnectionStatus(text, extraClass = "") {
  els.collectionConnectionStatus.textContent = text;
  els.collectionConnectionStatus.className = `status-pill ${extraClass}`.trim();
}

function setFarmerStatus(text, extraClass = "") {
  if (!text) {
    els.farmerLinkStatus.textContent = "";
    els.farmerLinkStatus.className = "status-pill status-hidden";
    return;
  }
  els.farmerLinkStatus.textContent = text;
  els.farmerLinkStatus.className = `status-pill ${extraClass}`.trim();
}

function setStatus(message, type = "") {
  els.collectionSaveStatus.textContent = message || "";
  els.collectionSaveStatus.dataset.status = type;
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(t("validation.required", { field: label }));
  return text;
}

function requiredNumber(value, label) {
  const number = nullableNumber(value);
  if (number === null) throw new Error(t("validation.required", { field: label }));
  return number;
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function cameraErrorMessage(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError") return t("scanner.permissionBlocked");
  if (name === "NotFoundError") return t("scanner.noCamera");
  return t("scanner.openFailed");
}
