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
} from "./collection_language.js?v=24";
import {
  clearOfflineCollectionAccess,
  initialiseOfflineStore,
  listOutboxItems,
  loadOfflineCollectionAccess,
  loadReferenceSnapshot,
  offlineStorageEstimate,
  offlineStorageSupported,
  requestPersistentOfflineStorage,
  saveOfflineCollectionAccess,
  saveCollectionToOutbox,
  saveReferenceSnapshot
} from "./offline_store.js";
import { syncPendingCollections } from "./offline_sync.js";
import { completeLaunchSplash } from "./app_transition.js";
import { createOperationFeedback } from "./operation_feedback.js";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=12";
import { setupFavoriteFormButton } from "./favorite_forms.js?v=3";
import { setPrintValue, setupPdfWorksheet } from "./print_worksheet.js";

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
  publicContextPromise: null,
  publicMode: true,
  publicShareToken: null,
  canOverridePrice: false,
  submissionId: crypto.randomUUID(),
  addingNewCommunity: false,
  communitySuggestionsOpen: false,
  communityBrowseAll: false,
  activeCommunitySuggestion: -1,
  selectedFarmer: null,
  selectedFarmerPhoneQuery: "",
  pendingFarmer: null,
  pendingFarmerPhoneQuery: "",
  collectionFarmers: [],
  currentFarmerWeight: null,
  gps: null,
  collectionPhotos: [],
  activePhotoIndex: null,
  activePhotoUrl: null,
  retakePhotoIndex: null,
  offline: {
    installPrompt: null,
    native: false,
    online: navigator.onLine,
    persistent: null,
    ready: false,
    referenceSavedAt: null,
    serviceWorkerReady: false,
    syncing: false,
    authenticated: false,
    accessVerifiedAt: null
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

const PHOTO_MAX_COUNT = 2;
const PHOTO_MAX_BYTES = 700 * 1024;
const PHOTO_TARGET_BYTES = 550 * 1024;
const PHOTO_MAX_EDGE = 1920;
const COLLECTOR_NAME_STORAGE_KEY = "seaweed_harvest:collector_name";
const COLLECTION_COMMUNITY_STORAGE_KEY = "seaweed_harvest:collection_day_community";
const LEGACY_FORM_REFERENCE_KEY = "mawimbi-collection-form";
const MAWIMBI_CONTEXT_KEY = "mawimbi-context";
const MAWIMBI_ENTRY_ACCESS_KEY = "mawimbi-form-entry-access";
const FARMER_PHONE_LOOKUP_MIN_DIGITS = 5;
const FARMER_PHONE_LOOKUP_DELAY_MS = 250;

const els = {};
let operationFeedback = null;
let farmerPhoneLookupTimer = null;
let farmerPhoneLookupRequest = 0;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    try {
      initCollectionLanguage();
      cacheElements();
      operationFeedback = createOperationFeedback(els.collectionOperationFeedback);
      await initialiseNativeRuntime();
      await initialiseOfflineCollection();
      await initialiseCollectionAccess();
      setupCollectionHeader();
      renderOfflineAccessState();
      setupFavoriteFormButton({
        button: els.favoriteCollectionForm,
        formKey: "collection",
        profile: state.profile,
        client: state.authApi?.authClient || null,
        returnPage: "collection.html"
      });
      setupCollectorName();
      applyCollectionAccessMode();
      bindEvents();
      setDefaultDateTime();
      await Promise.all([
        state.publicContextPromise || Promise.resolve(),
        loadFormData()
      ]);
      renderActiveAggregator();
      ensureTransactionId();
      updateEmptyFieldHighlights();
      await refreshOfflineQueue();
      void autoSyncOutbox();
    } catch (error) {
      if (els.collectionSaveStatus) {
        setStatus(error.message || "Unable to open the collection form.", "error");
      } else {
        console.error(error);
      }
    }
  } finally {
    document.body.removeAttribute("data-auth-pending");
    await completeLaunchSplash();
  }
}

async function initialiseCollectionAccess() {
  const storedAuth = localStorage.getItem("seaweed-ag-auth");
  if (!navigator.onLine || !isOnline()) {
    if (await restoreOfflineCollectionAccess()) return;
    throw new Error("Internet connection required to verify Collection access on this device.");
  }

  if (!storedAuth) {
    await clearCachedCollectionAccess();
    state.session = null;
    state.profile = null;
    state.publicMode = true;
    state.canOverridePrice = false;
    state.publicContextPromise = loadPublicMawimbiContext();
    return;
  }

  state.authApi = await import("./auth_client.js");
  try {
    state.session = await state.authApi.currentSession();
    if (state.session) {
      const { error: userError } = await state.authApi.authClient.auth.getUser();
      if (userError) throw userError;
      state.profile = await state.authApi.currentProfile(true);
    }
  } catch (error) {
    if (isConnectivityFailure(error) && await restoreOfflineCollectionAccess()) return;
    await clearCachedCollectionAccess();
    throw error;
  }

  const profile = state.profile;
  if (state.session
      && profile?.account_status === "active"
      && profile.active_aggregator_code
      && !state.authApi.hasOrganisationCapability(
        profile,
        "form_intake_collection"
      )) {
    window.location.replace(
      "./access_pending.html?reason=Intake%20Collection%20is%20not%20enabled%20for%20the%20active%20organisation.&return=collection.html"
    );
    throw new Error("Intake Collection is not enabled for the active organisation.");
  }
  const canUseAuthenticatedRoute = Boolean(
    state.session
    && profile?.account_status === "active"
    && (profile.app_role === "system_admin" || profile.can_submit_collection)
  );

  state.publicMode = !canUseAuthenticatedRoute;
  if (canUseAuthenticatedRoute) {
    try {
      state.aggregatorContext = await state.authApi.currentAggregatorContext(true);
    } catch (error) {
      if (isConnectivityFailure(error) && await restoreOfflineCollectionAccess()) return;
      await clearCachedCollectionAccess();
      throw error;
    }
    state.canOverridePrice = profile.app_role === "system_admin"
      || (profile.can_manage_pricing && ["aggregator_admin", "finance"].includes(profile.active_membership_role));
    if (state.offline.ready) {
      const snapshot = await saveOfflineCollectionAccess({
        userId: state.session.user.id,
        email: state.session.user.email || profile.email,
        displayName: profile.display_name,
        accountStatus: profile.account_status,
        canSubmitCollection: true,
        canOverridePrice: state.canOverridePrice,
        appRole: profile.app_role,
        activeMembershipRole: profile.active_membership_role,
        organisationCapabilities: profile.organisation_capabilities,
        aggregator: state.aggregatorContext.active_aggregator,
        validatedAt: new Date().toISOString()
      });
      state.offline.accessVerifiedAt = snapshot.validatedAt;
    }
    return;
  }

  await clearCachedCollectionAccess();
  state.canOverridePrice = false;
  state.publicContextPromise = loadPublicMawimbiContext();
}

async function clearCachedCollectionAccess() {
  if (!state.offline.ready) return;
  try {
    await clearOfflineCollectionAccess();
  } catch (error) {
    console.warn("Unable to clear cached Collection access.", error);
  }
}

function isConnectivityFailure(error) {
  if (!navigator.onLine || error instanceof TypeError) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return /failed to fetch|network(?: error| request)?|load failed|fetch failed|timed out|timeout/.test(message);
}

async function restoreOfflineCollectionAccess() {
  if (!state.offline.ready) return false;
  const snapshot = await loadOfflineCollectionAccess();
  if (!snapshot) return false;
  state.authApi = await import("./auth_client.js");
  state.session = {
    offline: true,
    user: { id: snapshot.userId, email: snapshot.email }
  };
  state.profile = {
    id: snapshot.userId,
    email: snapshot.email,
    display_name: snapshot.displayName,
    account_status: snapshot.accountStatus,
    can_submit_collection: snapshot.canSubmitCollection,
    app_role: snapshot.appRole,
    active_membership_role: snapshot.activeMembershipRole,
    organisation_capabilities: snapshot.organisationCapabilities
  };
  if (!state.profile.organisation_capabilities?.form_intake_collection) {
    return false;
  }
  state.aggregatorContext = {
    active_aggregator_id: snapshot.aggregator.id,
    active_aggregator: snapshot.aggregator,
    aggregators: [snapshot.aggregator]
  };
  state.publicMode = false;
  state.canOverridePrice = snapshot.canOverridePrice;
  state.offline.authenticated = true;
  state.offline.accessVerifiedAt = snapshot.validatedAt;
  return true;
}

function renderOfflineAccessState() {
  const visible = state.offline.authenticated;
  els.offlineAccessBand.hidden = !visible;
  if (!visible) return;
  els.offlineAccessName.textContent = state.profile?.display_name || state.profile?.email || "collector";
  els.offlineAccessVerifiedAt.textContent = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(state.offline.accessVerifiedAt));
}

async function loadPublicMawimbiContext() {
  const parameters = new URLSearchParams(window.location.search);
  const requestedOrganisation = String(parameters.get("org") || "MAWIMBI").trim().toUpperCase();
  if (requestedOrganisation !== "MAWIMBI") {
    throw new Error("This public Collection form is not available for that organisation.");
  }
  state.publicShareToken = parameters.get("share") || null;

  let entryContext;
  try {
    entryContext = await callPublicRpc("ag_public_form_entry_context", {
      p_form_key: "form_intake_collection",
      p_organisation_code: "MAWIMBI",
      p_share_token: state.publicShareToken
    });
    if (entryContext?.allowed && state.offline.ready) {
      await saveReferenceSnapshot(MAWIMBI_ENTRY_ACCESS_KEY, entryContext);
    }
  } catch (error) {
    const cached = state.offline.ready
      ? await loadReferenceSnapshot(MAWIMBI_ENTRY_ACCESS_KEY)
      : null;
    if (!cached?.value?.allowed) throw error;
    entryContext = cached.value;
  }
  if (!entryContext?.allowed) {
    throw new Error(entryContext?.reason || "The Collection form is not available.");
  }

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

  if (signedIn) {
    state.authApi?.setupAccountControls(profile, {
      returnPage: "collection.html",
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

  const dashboardHref = signedIn
    ? state.authApi?.routeForProfile(profile) || "./home.html"
    : "./login.html?return=home.html";
  const sidebar = populateAppSidebar(document.getElementById("collectionSidebar"), {
    profile: signedIn ? profile : null,
    dashboardHref
  });
  setupAppNavigation({
    profile: signedIn ? profile : null,
    dashboardHref,
    sidebar
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
    setStatus(t("offline.unavailable"), "error");
    return;
  }

  try {
    await initialiseOfflineStore();
    state.offline.ready = true;
    state.offline.persistent = await requestPersistentOfflineStorage();
    await offlineStorageEstimate();
  } catch (error) {
    setStatus(error.message || t("offline.unavailable"), "error");
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
    void autoSyncOutbox();
  });
  window.addEventListener("offline", () => {
    state.offline.online = false;
    updateOfflineReadiness();
  });
  window.addEventListener("focus", () => {
    updateOfflineReadiness();
    void refreshOfflineQueue();
    void autoSyncOutbox();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshOfflineQueue();
      void autoSyncOutbox();
    }
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
      if (state.offline.online) void autoSyncOutbox();
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
  els.sackId.required = false;
  els.gpsSummary.required = false;
  const gradeField = els.seaweedGrade.closest("label");
  if (gradeField) gradeField.hidden = false;
  els.seaweedGrade.disabled = false;
  els.seaweedGrade.required = true;
  if (!state.publicMode) return;

  els.collectionPhotosField.hidden = false;
  els.collectionPhotos.disabled = false;
}

function cacheElements() {
  [
    "pendingRecordsBand",
    "pendingRecordsBandLabel",
    "pendingRecordsBandText",
    "pendingRecordsBandSync",
    "offlineAccessBand",
    "offlineAccessName",
    "offlineAccessVerifiedAt",
    "collectionConnectionStatus",
    "collectionAdminLink",
    "collectionSignInLink",
    "collectionForm",
    "submitCollection",
    "favoriteCollectionForm",
    "printCollectionWorksheet",
    "collectionPrintWorksheet",
    "printCollectionAggregator",
    "printCollectionCollector",
    "collectionCommunitySearch",
    "collectionCommunitySuggestions",
    "collectionCommunityId",
    "collectionCommunityMatch",
    "toggleCollectionCommunitySuggestions",
    "addCollectionCommunityName",
    "collectorName",
    "collectionWebsite",
    "farmerId",
    "lookupFarmer",
    "scanFarmerId",
    "farmerLinkStatus",
    "farmerDetails",
    "selectedFarmerSummaries",
    "addAnotherFarmer",
    "quickFarmerName",
    "quickFarmerMatchStatus",
    "quickFarmerCommunity",
    "quickFarmerFarmSize",
    "manualFarmerFirstName",
    "manualFarmerLastNames",
    "manualFarmerPhone",
    "farmerPhoneMatchHint",
    "manualCommunityInput",
    "manualFarmerFarmSize",
    "manualFarmerFarmSizeUnit",
    "assignFarmerId",
    "communityOptions",
    "farmerCommunityId",
    "farmerCommunityName",
    "sackId",
    "scanSackId",
    "transactionId",
    "collectedAt",
    "captureGps",
    "gpsSummary",
    "sackWeightKg",
    "individualFarmerWeights",
    "individualFarmerWeightRows",
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
    "collectionPhotoPreview",
    "collectionPhotoActions",
    "collectionPhotoActionPreview",
    "collectionPhotoActionName",
    "retakeCollectionPhoto",
    "deleteCollectionPhoto",
    "cancelCollectionPhotoAction",
    "collectionPhotoRetake",
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
    "collectionOperationFeedback",
    "qrScannerModal",
    "qrScannerVideo",
    "qrScannerStatus",
    "stopQrScanner"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  setupPdfWorksheet({
    button: els.printCollectionWorksheet,
    worksheet: els.collectionPrintWorksheet,
    rowCount: 20,
    columnCount: 14,
    prepare: prepareCollectionWorksheet
  });
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
    state.selectedFarmerPhoneQuery = "";
    clearPendingFarmer();
    if (hadLinkedFarmer) clearManualFarmerDetails();
    setFarmerStatus("");
    updateQuickReference();
  });
  els.manualFarmerFirstName.addEventListener("input", updateQuickReference);
  els.manualFarmerLastNames.addEventListener("input", updateQuickReference);
  els.manualFarmerPhone.addEventListener("input", scheduleFarmerPhoneLookup);
  els.manualFarmerPhone.addEventListener("change", lookupFarmerByPhone);
  els.quickFarmerName.addEventListener("click", acceptPendingFarmerMatch);
  els.addAnotherFarmer.addEventListener("click", freezeCurrentFarmer);
  els.manualFarmerFarmSize.addEventListener("input", updateQuickReference);
  els.manualFarmerFarmSizeUnit.addEventListener("change", updateQuickReference);
  els.manualCommunityInput.addEventListener("input", syncManualCommunity);
  els.manualCommunityInput.addEventListener("change", syncManualCommunity);
  els.collectionCommunitySearch.addEventListener("focus", openCollectionCommunitySuggestions);
  els.collectionCommunitySearch.addEventListener("click", openCollectionCommunitySuggestions);
  els.collectionCommunitySearch.addEventListener("input", () => {
    state.communitySuggestionsOpen = true;
    state.communityBrowseAll = false;
    state.activeCommunitySuggestion = -1;
    syncCollectionCommunity();
  });
  els.collectionCommunitySearch.addEventListener("change", syncCollectionCommunity);
  els.collectionCommunitySearch.addEventListener("blur", closeCollectionCommunitySuggestions);
  els.collectionCommunitySearch.addEventListener("keydown", handleCollectionCommunityKeydown);
  els.toggleCollectionCommunitySuggestions.addEventListener("click", toggleCollectionCommunitySuggestions);
  els.addCollectionCommunityName.addEventListener("click", toggleNewCollectionCommunity);
  document.addEventListener("pointerdown", closeCollectionCommunitySuggestionsFromPointer);
  els.assignFarmerId.addEventListener("click", assignNextFarmerId);
  els.sackId.addEventListener("change", () => {
    els.sackId.value = normalizedSackId();
    ensureTransactionId();
    if (!state.gps) captureGps();
  });
  els.scanSackId.addEventListener("click", () => startQrScanner("sack"));
  els.captureGps.addEventListener("click", captureGps);
  els.sackWeightKg.addEventListener("input", () => {
    updatePrice();
    renderIndividualFarmerWeights();
  });
  els.individualFarmerWeightRows.addEventListener("input", updateIndividualFarmerWeight);
  els.seaweedGrade.addEventListener("change", updatePriceForGrade);
  els.seaweedType.addEventListener("change", updatePriceForGrade);
  els.productForm.addEventListener("change", updatePriceForGrade);
  els.collectedAt.addEventListener("change", () => {
    rememberCollectionCommunity();
    void refreshPricingForDate();
  });
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
  els.collectionPhotos.addEventListener("change", addCollectionPhotos);
  els.collectionPhotoRetake.addEventListener("change", replaceCollectionPhoto);
  els.retakeCollectionPhoto.addEventListener("click", beginCollectionPhotoRetake);
  els.deleteCollectionPhoto.addEventListener("click", deleteActiveCollectionPhoto);
  els.cancelCollectionPhotoAction.addEventListener("click", closeCollectionPhotoActions);
  els.collectionPhotoActions.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCollectionPhotoActions();
  });
  els.collectionPhotoActions.addEventListener("close", releaseActivePhotoUrl);
  els.stopQrScanner.addEventListener("click", stopQrScanner);
  els.dismissSavedReceipt.addEventListener("click", () => { els.collectionReceiptResult.hidden = true; });
  document.addEventListener("seaweed-collection-language-change", refreshTranslatedContent);
}

function prepareCollectionWorksheet() {
  const activeAggregator = state.aggregatorContext?.active_aggregator;
  const aggregator = activeAggregator?.short_name
    || activeAggregator?.aggregator_code
    || activeAggregator?.organisation_name
    || "";
  setPrintValue(els.printCollectionAggregator, aggregator === "-" ? "" : aggregator);
  setPrintValue(els.printCollectionCollector, els.collectorName.value);
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
    const snapshot = state.offline.ready
      ? (await loadReferenceSnapshot(formReferenceKey())
        || await loadReferenceSnapshot(LEGACY_FORM_REFERENCE_KEY))
      : null;
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
      const snapshot = await saveReferenceSnapshot(formReferenceKey(), formData);
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
  restoreCollectionCommunity();
  syncFarmerCommunityName();
  renderCollectionCommunitySuggestions();
}

function syncCollectionCommunity() {
  const community = findExactCommunityFromText(els.collectionCommunitySearch.value);
  els.collectionCommunityId.value = community?.community_id || "";
  if (community) state.addingNewCommunity = false;
  updateCollectionCommunityMode();
  renderCollectionCommunitySuggestions();
  rememberCollectionCommunity();
}

function updateCollectionCommunityMode() {
  const community = selectedCollectionCommunity();
  const name = normalizedCommunityNameInput(els.collectionCommunitySearch.value);
  const showCommunitiesLabel = t("collection.showCommunities");
  els.toggleCollectionCommunitySuggestions.setAttribute("aria-label", showCommunitiesLabel);
  els.toggleCollectionCommunitySuggestions.title = showCommunitiesLabel;
  els.addCollectionCommunityName.setAttribute("aria-pressed", String(state.addingNewCommunity));
  els.addCollectionCommunityName.setAttribute(
    "aria-label",
    state.addingNewCommunity ? t("collection.cancelNewCommunity") : t("collection.addNewCommunity")
  );
  els.addCollectionCommunityName.title = state.addingNewCommunity
    ? t("collection.cancelNewCommunity")
    : t("collection.addNewCommunity");
  els.collectionCommunitySearch.closest(".collection-community-field")
    ?.classList.toggle("is-new-community", state.addingNewCommunity);

  if (community) {
    els.collectionCommunityMatch.textContent = t("collection.registryMatch", {
      community: communityLabel(community)
    });
  } else if (state.addingNewCommunity && name) {
    els.collectionCommunityMatch.textContent = t("collection.willCreateCommunity", { community: name });
  } else if (state.addingNewCommunity) {
    els.collectionCommunityMatch.textContent = t("collection.newCommunityHint");
  } else if (name) {
    els.collectionCommunityMatch.textContent = t("collection.noCommunityMatch");
  } else {
    els.collectionCommunityMatch.textContent = t("collection.communityHint");
  }
}

function rememberCollectionCommunity() {
  try {
    const communityId = String(els.collectionCommunityId.value || "").trim();
    const communityName = String(els.collectionCommunitySearch.value || "").trim();
    if (!communityId && !communityName) {
      localStorage.removeItem(COLLECTION_COMMUNITY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(COLLECTION_COMMUNITY_STORAGE_KEY, JSON.stringify({
      date: collectionDateValue(),
      communityId,
      communityName
    }));
  } catch {
    // The selected community remains active for this open form when storage is unavailable.
  }
}

function restoreCollectionCommunity() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLECTION_COMMUNITY_STORAGE_KEY) || "null");
    const exists = state.communities.some((community) => community.community_id === saved?.communityId);
    if (saved?.date === collectionDateValue() && exists) {
      els.collectionCommunityId.value = saved.communityId;
      els.collectionCommunitySearch.value = communityLabel(communityById(saved.communityId));
      syncCollectionCommunity();
      return;
    }
    if (saved?.date === collectionDateValue() && saved?.communityName) {
      els.collectionCommunityId.value = "";
      els.collectionCommunitySearch.value = String(saved.communityName);
      syncCollectionCommunity();
      return;
    }
    localStorage.removeItem(COLLECTION_COMMUNITY_STORAGE_KEY);
  } catch {
    localStorage.removeItem(COLLECTION_COMMUNITY_STORAGE_KEY);
  }
}

function suggestCollectionCommunity(communityId) {
  const community = communityById(communityId);
  if (els.collectionCommunitySearch.value || !community) return;
  els.collectionCommunitySearch.value = communityLabel(community);
  syncCollectionCommunity();
}

function openCollectionCommunitySuggestions() {
  state.communitySuggestionsOpen = true;
  state.communityBrowseAll = !normalizedCommunityNameInput(els.collectionCommunitySearch.value);
  state.activeCommunitySuggestion = -1;
  renderCollectionCommunitySuggestions();
}

function closeCollectionCommunitySuggestions() {
  state.communitySuggestionsOpen = false;
  state.communityBrowseAll = false;
  state.activeCommunitySuggestion = -1;
  renderCollectionCommunitySuggestions();
}

function closeCollectionCommunitySuggestionsFromPointer(event) {
  if (event.target.closest(".collection-community-field")) return;
  closeCollectionCommunitySuggestions();
}

function toggleNewCollectionCommunity() {
  state.addingNewCommunity = !state.addingNewCommunity;
  if (state.addingNewCommunity) {
    els.collectionCommunityId.value = "";
    state.communitySuggestionsOpen = true;
    state.communityBrowseAll = false;
    state.activeCommunitySuggestion = -1;
    updateCollectionCommunityMode();
    renderCollectionCommunitySuggestions();
    els.collectionCommunitySearch.focus();
    els.collectionCommunitySearch.select();
    return;
  }
  syncCollectionCommunity();
}

function toggleCollectionCommunitySuggestions() {
  if (state.communitySuggestionsOpen && state.communityBrowseAll) {
    closeCollectionCommunitySuggestions();
    els.collectionCommunitySearch.focus();
    return;
  }
  state.communitySuggestionsOpen = true;
  state.communityBrowseAll = true;
  state.activeCommunitySuggestion = -1;
  renderCollectionCommunitySuggestions();
  els.collectionCommunitySearch.focus({ preventScroll: true });
}

function renderCollectionCommunitySuggestions() {
  const matches = communitySearchMatches(
    state.communityBrowseAll ? "" : els.collectionCommunitySearch.value
  );
  const selectedId = els.collectionCommunityId.value;
  els.collectionCommunitySuggestions.replaceChildren();

  matches.forEach((community, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "collection-community-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(community.community_id === selectedId));
    option.dataset.communityId = community.community_id;
    option.id = `collection-community-option-${String(community.community_id || index).toLowerCase()}`;
    option.classList.toggle("is-active", index === state.activeCommunitySuggestion);

    const name = document.createElement("strong");
    name.textContent = community.community_name || community.community_id;
    const id = document.createElement("small");
    id.textContent = community.community_id;
    option.append(name, id);
    option.addEventListener("pointerdown", (event) => event.preventDefault());
    option.addEventListener("click", () => selectCollectionCommunity(community));
    els.collectionCommunitySuggestions.append(option);
  });

  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "collection-community-empty";
    empty.setAttribute("role", "status");
    empty.textContent = state.communities.length
      ? t("collection.noMatchingCommunities")
      : t("collection.communitiesUnavailable");
    els.collectionCommunitySuggestions.append(empty);
  }

  const visible = state.communitySuggestionsOpen;
  els.collectionCommunitySuggestions.hidden = !visible;
  els.collectionCommunitySearch.setAttribute("aria-expanded", String(visible));
  els.toggleCollectionCommunitySuggestions.setAttribute("aria-expanded", String(visible));
  els.toggleCollectionCommunitySuggestions.classList.toggle("is-open", visible);
  const activeOption = matches[state.activeCommunitySuggestion];
  if (visible && activeOption) {
    els.collectionCommunitySearch.setAttribute(
      "aria-activedescendant",
      `collection-community-option-${String(activeOption.community_id).toLowerCase()}`
    );
  } else {
    els.collectionCommunitySearch.removeAttribute("aria-activedescendant");
  }
}

function selectCollectionCommunity(community) {
  state.addingNewCommunity = false;
  els.collectionCommunityId.value = community.community_id;
  els.collectionCommunitySearch.value = communityLabel(community);
  closeCollectionCommunitySuggestions();
  updateCollectionCommunityMode();
  rememberCollectionCommunity();
}

function handleCollectionCommunityKeydown(event) {
  prepareCollectionCommunityForTyping(event);
  const matches = communitySearchMatches(els.collectionCommunitySearch.value);
  if (event.key === "Escape") {
    closeCollectionCommunitySuggestions();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || !matches.length) return;

  if (event.key === "Enter" && state.activeCommunitySuggestion < 0) return;
  event.preventDefault();
  if (event.key === "ArrowDown") {
    state.communitySuggestionsOpen = true;
    state.activeCommunitySuggestion = (state.activeCommunitySuggestion + 1) % matches.length;
  } else if (event.key === "ArrowUp") {
    state.communitySuggestionsOpen = true;
    state.activeCommunitySuggestion = state.activeCommunitySuggestion <= 0
      ? matches.length - 1
      : state.activeCommunitySuggestion - 1;
  } else {
    selectCollectionCommunity(matches[state.activeCommunitySuggestion]);
    return;
  }
  renderCollectionCommunitySuggestions();
  els.collectionCommunitySuggestions
    .querySelector(".collection-community-option.is-active")
    ?.scrollIntoView({ block: "nearest" });
}

function prepareCollectionCommunityForTyping(event) {
  if (!selectedCollectionCommunity()) return;
  const replacesSelection = event.key === "Backspace"
    || event.key === "Delete"
    || (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey);
  if (!replacesSelection) return;

  const input = els.collectionCommunitySearch;
  const wholeValueSelected = input.selectionStart === 0
    && input.selectionEnd === input.value.length;
  if (wholeValueSelected) return;

  input.value = "";
  els.collectionCommunityId.value = "";
  state.addingNewCommunity = false;
  state.communitySuggestionsOpen = true;
  state.communityBrowseAll = false;
  state.activeCommunitySuggestion = -1;
  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    syncCollectionCommunity();
  }
}

async function lookupFarmer() {
  const farmerId = normalizedFarmerId();
  if (!farmerId) {
    state.selectedFarmer = null;
    state.selectedFarmerPhoneQuery = "";
    clearPendingFarmer();
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
  state.selectedFarmerPhoneQuery = normalizedPhoneDigits(farmer?.phone);
  clearPendingFarmer();

  if (!farmer) {
    setFarmerStatus(t("status.notFound"), "status-muted");
    updateQuickReference();
    return;
  }

  els.farmerId.value = farmer.farmer_id;
  if (farmer.community_id) {
    els.farmerCommunityId.value = farmer.community_id;
    syncFarmerCommunityName();
    suggestCollectionCommunity(farmer.community_id);
  }
  syncManualDetailsFromFarmer(farmer);
  updateQuickReference();
  setFarmerStatus(t("status.linked"), "");
}

function formReferenceKey() {
  const aggregatorId = state.aggregatorContext?.active_aggregator_id;
  return `collection-form:${aggregatorId || "public-mawimbi"}`;
}

function scheduleFarmerPhoneLookup() {
  window.clearTimeout(farmerPhoneLookupTimer);
  farmerPhoneLookupRequest += 1;
  const query = normalizedPhoneDigits(els.manualFarmerPhone.value);
  if (state.selectedFarmer && query !== state.selectedFarmerPhoneQuery) {
    clearSelectedFarmer({ preservePhone: true });
  }
  if (state.pendingFarmer && !query.startsWith(state.pendingFarmerPhoneQuery)) {
    clearPendingFarmer();
  }

  if (query.length < FARMER_PHONE_LOOKUP_MIN_DIGITS) {
    clearPendingFarmer();
    setFarmerPhoneMatchHint(query.length ? "farmer.phoneMoreDigits" : "farmer.phoneHint");
    updateQuickReference();
    return;
  }

  setFarmerPhoneMatchHint("farmer.phoneSearching");
  farmerPhoneLookupTimer = window.setTimeout(
    () => lookupFarmerByPhone(),
    FARMER_PHONE_LOOKUP_DELAY_MS
  );
}

async function lookupFarmerByPhone() {
  window.clearTimeout(farmerPhoneLookupTimer);
  const phoneValue = String(els.manualFarmerPhone.value || "").trim();
  const query = normalizedPhoneDigits(phoneValue);
  if (state.selectedFarmer && query === state.selectedFarmerPhoneQuery) return;
  const requestId = ++farmerPhoneLookupRequest;
  if (query.length < FARMER_PHONE_LOOKUP_MIN_DIGITS) return;

  let farmer = null;
  const localMatches = state.farmers.filter((row) => normalizedPhoneDigits(row.phone).startsWith(query));
  if (localMatches.length === 1) {
    farmer = {
      ...localMatches[0],
      match_exact: normalizedPhoneDigits(localMatches[0].phone) === query
    };
  }

  if (!state.farmers.length && isSupabaseEnabled()) {
    try {
      const result = state.publicMode
        ? await callPublicRpc("ag_public_mawimbi_farmer_phone_lookup", { p_phone: phoneValue })
        : await callRpc("ag_farmer_phone_lookup", { p_phone: phoneValue });
      farmer = result && Object.keys(result).length ? result : null;
    } catch (error) {
      if (requestId !== farmerPhoneLookupRequest) return;
      setFarmerStatus(t("status.lookupFailed"), "status-muted");
      setStatus(error.message, "error");
      return;
    }
  }

  if (requestId !== farmerPhoneLookupRequest
      || phoneValue !== String(els.manualFarmerPhone.value || "").trim()) return;

  if (!farmer) {
    if (state.selectedFarmer) clearSelectedFarmer({ preservePhone: true });
    clearPendingFarmer();
    setFarmerStatus("");
    setFarmerPhoneMatchHint("farmer.phoneNoMatch");
    updateQuickReference();
    return;
  }

  if (!farmer.match_exact) {
    if (state.selectedFarmer) clearSelectedFarmer({ preservePhone: true });
    state.pendingFarmer = farmer;
    state.pendingFarmerPhoneQuery = query;
    els.farmerId.value = "";
    setFarmerStatus("");
    setFarmerPhoneMatchHint("farmer.phonePossibleMatch");
    updateQuickReference();
    return;
  }

  linkFarmerMatch(farmer);
}

function acceptPendingFarmerMatch() {
  if (!state.pendingFarmer) return;
  linkFarmerMatch(state.pendingFarmer);
}

function linkFarmerMatch(farmer) {
  clearPendingFarmer();
  state.selectedFarmer = farmer;
  els.farmerId.value = farmer.farmer_id || "";
  if (farmer.community_id) {
    els.farmerCommunityId.value = farmer.community_id;
    syncFarmerCommunityName();
    suggestCollectionCommunity(farmer.community_id);
  }
  syncManualDetailsFromFarmer(farmer, { preservePhone: true });
  state.selectedFarmerPhoneQuery = normalizedPhoneDigits(els.manualFarmerPhone.value);
  updateQuickReference();
  setFarmerStatus(t("status.linked"), "");
  setFarmerPhoneMatchHint("farmer.phoneMatched");
}

function setFarmerPhoneMatchHint(key) {
  els.farmerPhoneMatchHint.textContent = t(key);
}

function syncManualDetailsFromFarmer(farmer, options = {}) {
  const enteredPhone = els.manualFarmerPhone.value;
  const community = communityById(farmer.community_id);
  const name = splitFarmerName(farmer.name);
  els.manualFarmerFirstName.value = name.firstName;
  els.manualFarmerLastNames.value = name.lastNames;
  els.manualFarmerPhone.value = options.preservePhone ? enteredPhone : farmer.phone || "";
  els.manualCommunityInput.value = communityLabel(community) || farmer.community_id || "";
  els.manualFarmerFarmSize.value = farmer.farm_size_value ?? "";
  els.manualFarmerFarmSizeUnit.value = farmer.farm_size_unit || "blocks";
}

function clearManualFarmerDetails(options = {}) {
  const enteredPhone = els.manualFarmerPhone.value;
  els.manualFarmerFirstName.value = "";
  els.manualFarmerLastNames.value = "";
  els.manualFarmerPhone.value = options.preservePhone ? enteredPhone : "";
  els.manualCommunityInput.value = "";
  els.manualFarmerFarmSize.value = "";
  els.manualFarmerFarmSizeUnit.value = "blocks";
  els.farmerCommunityId.value = "";
  syncFarmerCommunityName();
}

function clearSelectedFarmer(options = {}) {
  state.selectedFarmer = null;
  state.selectedFarmerPhoneQuery = "";
  els.farmerId.value = "";
  clearManualFarmerDetails(options);
}

function clearPendingFarmer() {
  state.pendingFarmer = null;
  state.pendingFarmerPhoneQuery = "";
}

function syncFarmerCommunityName() {
  const community = selectedFarmerCommunity();
  els.farmerCommunityName.value = community?.community_name || "";
}

function syncManualCommunity(event) {
  const community = findCommunityFromText(els.manualCommunityInput.value);
  els.farmerCommunityId.value = community?.community_id || "";
  if (community && event?.type === "change") {
    els.manualCommunityInput.value = communityLabel(community);
  }
  syncFarmerCommunityName();
  updateQuickReference();
}

function updateQuickReference() {
  const community = selectedFarmerCommunity() || findCommunityFromText(els.manualCommunityInput.value);
  const farmerName = combinedManualFarmerName() || state.selectedFarmer?.name || state.pendingFarmer?.name;
  els.quickFarmerName.textContent = farmerName || "-";
  els.quickFarmerName.disabled = !state.pendingFarmer;
  els.quickFarmerName.classList.toggle("is-candidate", Boolean(state.pendingFarmer));
  if (state.pendingFarmer) {
    els.quickFarmerName.setAttribute("aria-label", t("quick.selectMatch", { name: farmerName }));
  } else {
    els.quickFarmerName.removeAttribute("aria-label");
  }
  els.quickFarmerMatchStatus.hidden = !state.pendingFarmer;
  els.quickFarmerCommunity.textContent = communityLabel(community) || "-";
  els.quickFarmerFarmSize.textContent = formatManualFarmSize();
  updateAddAnotherFarmerState();
  renderSelectedFarmerSummaries();
  renderIndividualFarmerWeights();
}

function currentFarmerDraft() {
  const manualFarmerName = combinedManualFarmerName();
  const farmerName = manualFarmerName || state.selectedFarmer?.name || "";
  if (!farmerName || (state.pendingFarmer && !manualFarmerName)) return null;

  const community = selectedFarmerCommunity() || findCommunityFromText(els.manualCommunityInput.value);
  const manualCommunityName = normalizedCommunityNameInput(els.manualCommunityInput.value);
  return {
    entry_id: "current",
    farmer_record_id: state.selectedFarmer?.id || null,
    farmer_id: state.selectedFarmer?.farmer_id || null,
    farmer_name_snapshot: farmerName,
    phone_snapshot: nullableText(els.manualFarmerPhone.value),
    community_record_id: community?.id || null,
    community_id_snapshot: community?.community_id || nullableText(els.farmerCommunityId.value),
    community_name_snapshot: community?.community_name || manualCommunityName || null,
    farm_size_value: nullableNumber(els.manualFarmerFarmSize.value),
    farm_size_unit: els.manualFarmerFarmSizeUnit.value || "blocks",
    original_farm_size_value: state.selectedFarmer
      ? nullableNumber(state.selectedFarmer.farm_size_value)
      : null,
    original_farm_size_unit: state.selectedFarmer
      ? String(state.selectedFarmer.farm_size_unit || "lines").trim() || "lines"
      : null,
    weight_kg: state.currentFarmerWeight
  };
}

function updateAddAnotherFarmerState() {
  const canAdd = Boolean(currentFarmerDraft());
  els.addAnotherFarmer.disabled = !canAdd;
  els.addAnotherFarmer.title = canAdd
    ? t("farmer.addAnother")
    : t("farmer.addAnotherDisabled");
  els.addAnotherFarmer.setAttribute("aria-label", t("farmer.addAnother"));
}

function freezeCurrentFarmer() {
  const farmer = currentFarmerDraft();
  if (!farmer) return;
  if (state.collectionFarmers.some((saved) => farmersSharePhone(saved, farmer))) {
    setFarmerPhoneMatchHint("farmer.phoneAlreadyAdded");
    setStatus(t("farmer.phoneAlreadyAdded"), "error");
    return;
  }
  if (state.collectionFarmers.some((saved) => farmerIdentityKey(saved) === farmerIdentityKey(farmer))) {
    setStatus(t("farmer.alreadyAdded"), "error");
    return;
  }

  state.collectionFarmers.push({
    ...farmer,
    entry_id: crypto.randomUUID()
  });
  state.currentFarmerWeight = null;
  clearActiveFarmerEditor();
  setStatus("");
  renderSelectedFarmerSummaries();
  renderIndividualFarmerWeights();
  els.manualFarmerPhone.focus();
}

function clearActiveFarmerEditor() {
  window.clearTimeout(farmerPhoneLookupTimer);
  farmerPhoneLookupRequest += 1;
  state.selectedFarmer = null;
  state.selectedFarmerPhoneQuery = "";
  clearPendingFarmer();
  els.farmerId.value = "";
  clearManualFarmerDetails();
  setFarmerStatus("");
  setFarmerPhoneMatchHint("farmer.phoneHint");
  updateQuickReference();
}

function renderSelectedFarmerSummaries() {
  els.selectedFarmerSummaries.replaceChildren();
  els.selectedFarmerSummaries.hidden = state.collectionFarmers.length === 0;

  state.collectionFarmers.forEach((farmer, index) => {
    const row = document.createElement("div");
    row.className = "selected-farmer-summary";

    const details = document.createElement("div");
    details.className = "selected-farmer-summary-details";
    details.append(
      farmerSummaryPart(t("quick.name"), farmer.farmer_name_snapshot || "-"),
      farmerSummaryPart(
        t("quick.community"),
        [farmer.community_id_snapshot, farmer.community_name_snapshot].filter(Boolean).join(" - ") || "-"
      ),
      farmerSummaryPart(t("quick.farmSize"), formatFarmSize(farmer))
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "selected-farmer-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", t("farmer.remove", { name: farmer.farmer_name_snapshot }));
    remove.title = t("farmer.remove", { name: farmer.farmer_name_snapshot });
    remove.addEventListener("click", () => {
      state.collectionFarmers.splice(index, 1);
      renderSelectedFarmerSummaries();
      renderIndividualFarmerWeights();
      updateAddAnotherFarmerState();
    });

    row.append(details, remove);
    els.selectedFarmerSummaries.append(row);
  });
}

function farmerSummaryPart(label, value) {
  const part = document.createElement("p");
  const name = document.createElement("span");
  const detail = document.createElement("strong");
  name.textContent = `${label} `;
  detail.textContent = value;
  part.append(name, detail);
  return part;
}

function effectiveCollectionFarmers() {
  const current = currentFarmerDraft();
  return current ? [...state.collectionFarmers, current] : [...state.collectionFarmers];
}

function renderIndividualFarmerWeights() {
  const farmers = effectiveCollectionFarmers();
  const shouldShow = farmers.length > 1;
  els.individualFarmerWeights.hidden = !shouldShow;
  if (!shouldShow) {
    els.individualFarmerWeights.open = false;
    els.individualFarmerWeightRows.replaceChildren();
    return;
  }

  const wasOpen = els.individualFarmerWeights.open;
  els.individualFarmerWeightRows.replaceChildren();
  farmers.forEach((farmer) => {
    const label = document.createElement("label");
    label.className = "individual-farmer-weight-row";

    const name = document.createElement("span");
    name.textContent = farmer.farmer_name_snapshot;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.inputMode = "decimal";
    input.placeholder = t("common.optional");
    input.value = farmer.weight_kg ?? "";
    input.dataset.farmerEntryId = farmer.entry_id;
    input.setAttribute(
      "aria-label",
      t("farmer.weightFor", { name: farmer.farmer_name_snapshot })
    );
    label.append(name, input);
    els.individualFarmerWeightRows.append(label);
  });

  const status = document.createElement("p");
  status.id = "individualFarmerWeightStatus";
  status.className = "individual-farmer-weight-status";
  els.individualFarmerWeightRows.append(status);
  els.individualFarmerWeights.open = wasOpen;
  updateIndividualFarmerWeightStatus();
}

function updateIndividualFarmerWeight(event) {
  const input = event.target.closest("[data-farmer-entry-id]");
  if (!input) return;
  const value = nullableNumber(input.value);
  if (input.dataset.farmerEntryId === "current") {
    state.currentFarmerWeight = value;
  } else {
    const farmer = state.collectionFarmers.find((item) => item.entry_id === input.dataset.farmerEntryId);
    if (farmer) farmer.weight_kg = value;
  }
  updateIndividualFarmerWeightStatus();
}

function updateIndividualFarmerWeightStatus() {
  const status = document.getElementById("individualFarmerWeightStatus");
  if (!status) return;
  const farmers = effectiveCollectionFarmers();
  const entered = farmers.filter((farmer) => farmer.weight_kg !== null);
  if (!entered.length) {
    const totalWeight = nullableNumber(els.sackWeightKg.value);
    if (totalWeight === null) {
      status.textContent = t("farmer.weightsOptional");
      status.dataset.status = "";
      return;
    }
    const allocations = equalFarmerWeightAllocations(farmers, totalWeight);
    const equalShare = allocations.every(
      (farmer) => farmer.weight_kg === allocations[0]?.weight_kg
    );
    status.textContent = equalShare
      ? t("farmer.weightsEqualSplit", {
        total: formatCompactNumber(totalWeight),
        share: formatCompactNumber(allocations[0]?.weight_kg)
      })
      : t("farmer.weightsEqualSplitRounded", {
        total: formatCompactNumber(totalWeight),
        count: farmers.length
      });
    status.dataset.status = "ok";
    return;
  }

  const allocated = entered.reduce((total, farmer) => total + Number(farmer.weight_kg || 0), 0);
  const totalWeight = nullableNumber(els.sackWeightKg.value);
  status.textContent = totalWeight === null
    ? t("farmer.weightsAllocated", { allocated: formatCompactNumber(allocated) })
    : t("farmer.weightsCompared", {
      allocated: formatCompactNumber(allocated),
      total: formatCompactNumber(totalWeight)
    });
  const complete = entered.length === farmers.length;
  const balanced = totalWeight !== null && Math.abs(allocated - totalWeight) < 0.005;
  status.dataset.status = complete && balanced ? "ok" : "check";
}

function farmerIdentityKey(farmer) {
  if (farmer.farmer_record_id) return `record:${farmer.farmer_record_id}`;
  if (farmer.farmer_id) return `id:${String(farmer.farmer_id).toUpperCase()}`;
  const name = normalizeCommunitySearchText(farmer.farmer_name_snapshot);
  const phone = normalizedPhoneDigits(farmer.phone_snapshot);
  const community = normalizeCommunitySearchText(
    farmer.community_id_snapshot || farmer.community_name_snapshot
  );
  return `custom:${name}:${phone}:${community}`;
}

function farmersSharePhone(left, right) {
  const leftPhone = normalizedPhoneDigits(left.phone_snapshot);
  const rightPhone = normalizedPhoneDigits(right.phone_snapshot);
  return leftPhone.length >= FARMER_PHONE_LOOKUP_MIN_DIGITS
    && leftPhone === rightPhone;
}

function assignNextFarmerId() {
  els.farmerId.value = nextFarmerId();
  state.selectedFarmer = null;
  state.selectedFarmerPhoneQuery = "";
  clearPendingFarmer();
  setFarmerStatus("");
  updateQuickReference();
}

function updatePriceForGrade() {
  if (isUngradedSelection()) {
    els.priceOverridden.checked = false;
    els.pricePerKg.value = "0.00";
    els.priceSourceStatus.textContent = t("grade.ungradedPrice");
    updateOverrideReasonVisibility();
    updateTotalPrice();
    updateEmptyFieldHighlights();
    return;
  }

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
  if (!type || !grade || grade === "UNGRADED") return null;
  return state.pricingRules.find((row) => (
    row.seaweed_type === type
    && row.grade_code === grade
    && row.product_form === form
  )) || null;
}

function isUngradedSelection() {
  return String(els.seaweedGrade.value || "").toUpperCase() === "UNGRADED";
}

function updateOverrideReasonVisibility() {
  const ungraded = isUngradedSelection();
  if (ungraded) els.priceOverridden.checked = false;
  const isOverride = !ungraded && Boolean(els.priceOverridden.checked);
  els.priceOverrideReasonField.hidden = !isOverride;
  els.priceOverrideReason.required = isOverride;
  els.pricePerKg.readOnly = ungraded || !state.canOverridePrice;
  els.priceOverridden.disabled = ungraded || !state.canOverridePrice;
  els.priceOverridden.closest("label").hidden = ungraded || !state.canOverridePrice;
  if (!isOverride) els.priceOverrideReason.value = "";
  if (isOverride) els.priceSourceStatus.textContent = "Authorised manual price";
}

function collectionDateValue() {
  const value = String(els.collectedAt?.value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
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
      const snapshot = await saveReferenceSnapshot(formReferenceKey(), currentFormData());
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
  const count = state.collectionPhotos.length;
  els.collectionPhotoStatus.textContent = count
    ? t("photos.selected", { count })
    : t("photos.hint");
  renderCollectionPhotoPreview();
}

function addCollectionPhotos() {
  const available = PHOTO_MAX_COUNT - state.collectionPhotos.length;
  const files = acceptedCollectionPhotoFiles(els.collectionPhotos.files, available);
  if (files.length) state.collectionPhotos.push(...files);
  els.collectionPhotos.value = "";
  updatePhotoSelectionStatus();
}

function acceptedCollectionPhotoFiles(fileList, limit) {
  const candidates = [...(fileList || [])];
  if (candidates.length > limit) {
    els.collectionPhotoStatus.textContent = t("photos.tooMany");
  }
  return candidates.slice(0, Math.max(0, limit)).filter((file) => {
    if (String(file.type || "").startsWith("image/")) return true;
    setStatus(t("photos.invalid"), "error");
    return false;
  });
}

function renderCollectionPhotoPreview() {
  els.collectionPhotoPreview.replaceChildren();
  state.collectionPhotos.forEach((file, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collection-photo-card";
    button.setAttribute("aria-label", t("photos.openActions", { number: index + 1 }));
    button.addEventListener("click", () => openCollectionPhotoActions(index));

    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.alt = t("photos.previewAlt", { number: index + 1 });
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });

    const caption = document.createElement("span");
    caption.textContent = t("photos.photoNumber", { number: index + 1 });
    button.append(image, caption);
    els.collectionPhotoPreview.append(button);
  });
}

function openCollectionPhotoActions(index) {
  const file = state.collectionPhotos[index];
  if (!file) return;
  releaseActivePhotoUrl();
  state.activePhotoIndex = index;
  state.activePhotoUrl = URL.createObjectURL(file);
  els.collectionPhotoActionPreview.src = state.activePhotoUrl;
  els.collectionPhotoActionPreview.alt = t("photos.previewAlt", { number: index + 1 });
  els.collectionPhotoActionName.textContent = `${t("photos.photoNumber", { number: index + 1 })} - ${file.name}`;
  if (typeof els.collectionPhotoActions.showModal === "function") els.collectionPhotoActions.showModal();
  else els.collectionPhotoActions.setAttribute("open", "");
}

function closeCollectionPhotoActions() {
  if (typeof els.collectionPhotoActions.close === "function" && els.collectionPhotoActions.open) {
    els.collectionPhotoActions.close();
  } else {
    els.collectionPhotoActions.removeAttribute("open");
    releaseActivePhotoUrl();
  }
  state.activePhotoIndex = null;
}

function releaseActivePhotoUrl() {
  if (state.activePhotoUrl) URL.revokeObjectURL(state.activePhotoUrl);
  state.activePhotoUrl = null;
  els.collectionPhotoActionPreview.removeAttribute("src");
}

function beginCollectionPhotoRetake() {
  if (!Number.isInteger(state.activePhotoIndex)) return;
  state.retakePhotoIndex = state.activePhotoIndex;
  els.collectionPhotoRetake.value = "";
  closeCollectionPhotoActions();
  els.collectionPhotoRetake.click();
}

function replaceCollectionPhoto() {
  const [replacement] = acceptedCollectionPhotoFiles(els.collectionPhotoRetake.files, 1);
  const index = state.retakePhotoIndex;
  if (replacement && Number.isInteger(index) && state.collectionPhotos[index]) {
    state.collectionPhotos[index] = replacement;
  }
  state.retakePhotoIndex = null;
  els.collectionPhotoRetake.value = "";
  updatePhotoSelectionStatus();
}

function deleteActiveCollectionPhoto() {
  const index = state.activePhotoIndex;
  if (!Number.isInteger(index) || !state.collectionPhotos[index]) return;
  state.collectionPhotos.splice(index, 1);
  closeCollectionPhotoActions();
  updatePhotoSelectionStatus();
}

async function prepareSelectedCollectionPhotos() {
  const files = [...state.collectionPhotos];
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
  const submitButton = event.submitter || els.submitCollection;
  let queuedSafely = false;
  submitButton.disabled = true;
  operationFeedback.show({
    state: "progress",
    title: t("operation.submittingTitle"),
    message: t("operation.submittingMessage")
  });

  try {
    if (!state.offline.ready) throw new Error(t("offline.unavailable"));
    rememberCollectorName();
    setStatus(t("status.saving"));
    if (els.collectionPhotosField.dataset.photoRequired === "true" && !state.collectionPhotos.length) {
      throw new Error(t("photos.required"));
    }
    const farmers = collectionFarmersForSubmission();
    const payload = buildPayload([], farmers);
    validateCollectionPricing(payload);
    const photos = await prepareSelectedCollectionPhotos();
    const farmSizeUpdates = pendingFarmSizeUpdates(farmers);
    if (state.publicMode && farmSizeUpdates.length) {
      const farmSizeUpdate = farmSizeUpdates[0];
      payload.farm_size_update = {
        value: farmSizeUpdate.p_farm_size_value,
        unit: farmSizeUpdate.p_farm_size_unit
      };
    }

    const submissionId = state.submissionId;
    await saveCollectionToOutbox({
      submissionId,
      mode: state.publicMode ? "public" : "authenticated",
      ownerUserId: state.publicMode ? null : state.session?.user?.id || null,
      aggregatorId: state.aggregatorContext?.active_aggregator_id || null,
      aggregatorCode: state.aggregatorContext?.active_aggregator?.aggregator_code || null,
      shareToken: state.publicMode ? state.publicShareToken : null,
      collectorName: String(els.collectorName.value || "").trim(),
      website: els.collectionWebsite.value,
      payload,
      farmSizeUpdate: state.publicMode ? null : farmSizeUpdates[0] || null,
      farmSizeUpdates: state.publicMode ? [] : farmSizeUpdates,
      photos,
      summary: {
        transactionId: payload.transaction_id,
        collectedAt: payload.collected_at,
        community: payload.community_name_snapshot || payload.community_id || "No community",
        farmer: farmers.map((farmer) => farmer.farmer_name_snapshot).filter(Boolean).join(", ") || "No farmer",
        weightKg: payload.sack_weight_kg,
        grade: payload.grade_code || "Ungraded"
      }
    });
    queuedSafely = true;
    if (photos.length) {
      els.collectionPhotoStatus.textContent = t("photos.stored", { count: photos.length });
    }

    setStatus(t("offline.localSaved"));
    await refreshOfflineQueue();

    if (isOnline()) {
      const syncResult = await syncOutbox({ submissionId });
      const saved = syncResult?.requestedResult;
      if (saved) {
        if (photos.length) {
          els.collectionPhotoStatus.textContent = t("photos.uploaded", { count: photos.length });
        }
        applySavedCollectionCommunity(saved);
        renderReceiptResult(saved);
        setStatus(t("offline.confirmed", { id: saved.transaction_id || payload.transaction_id }));
        operationFeedback.show({
          state: "success",
          title: t("operation.submittedTitle"),
          message: t("operation.submittedMessage", { id: saved.transaction_id || payload.transaction_id }),
          actionLabel: t("action.newCollection"),
          onAction: startNewCollection
        });
        return;
      }
      if (syncResult?.requestedError?.serverRejected) {
        showServerRejectedFeedback(syncResult.requestedError);
        return;
      }
    }
    showStoredLocallyFeedback();
  } catch (error) {
    if (queuedSafely) {
      setStatus(`${t("offline.localSaved")} ${error.message || ""}`.trim(), "error");
      showStoredLocallyFeedback();
    } else {
      setStatus(error.message, "error");
      operationFeedback.show({
        state: "error",
        title: t("status.error"),
        message: error.message || t("status.error"),
        actionLabel: t("action.close"),
        onAction: () => operationFeedback.hide()
      });
    }
  } finally {
    submitButton.disabled = queuedSafely;
  }
}

function showServerRejectedFeedback(error) {
  const message = friendlyServerRejection(error?.message);
  setStatus(t("offline.serverRejected", { message }), "error");
  operationFeedback.show({
    state: "error",
    title: t("operation.rejectedTitle"),
    message: t("operation.rejectedMessage", { message }),
    actionLabel: t("action.openToday"),
    onAction: () => { window.location.href = "./today.html"; }
  });
}

function friendlyServerRejection(message) {
  const text = String(message || "").trim();
  if (/no active price/i.test(text)) return t("grade.priceMissing");
  if (/select a grade|grade is required/i.test(text)) return t("grade.required");
  return text || t("status.error");
}

function showStoredLocallyFeedback() {
  operationFeedback.show({
    state: "stored",
    title: t("operation.storedTitle"),
    message: t("operation.storedMessage"),
    actionLabel: t("action.newCollection"),
    onAction: startNewCollection
  });
}

function startNewCollection() {
  clearForm();
  setStatus("");
  els.submitCollection.disabled = false;
  operationFeedback.hide();
  els.sackWeightKg.focus();
}

function buildPayload(photoPaths = [], farmers = collectionFarmersForSubmission()) {
  const communitySelection = validatedCollectionCommunity();
  const community = communitySelection.community;
  const communityName = community?.community_name || communitySelection.name;
  const weight = requiredNumber(els.sackWeightKg.value, t("harvest.weight"));
  const farmerAllocations = validateIndividualFarmerWeights(farmers, weight);
  const seaweedType = nullableText(els.seaweedType.value) || state.defaultSeaweedType;
  const gradeCode = requiredText(els.seaweedGrade.value, t("harvest.grade")).toUpperCase();
  const ungraded = gradeCode === "UNGRADED";
  const collectedAt = els.collectedAt.value ? new Date(els.collectedAt.value) : new Date();
  const primaryFarmer = farmerAllocations[0] || null;
  const customFields = customFieldPayload();
  if (farmerAllocations.length) {
    customFields.collection_farmers = farmerAllocations.map(farmerAllocationPayload);
    customFields.farm_size_value = primaryFarmer.farm_size_value;
    customFields.farm_size_unit = primaryFarmer.farm_size_unit;
  }

  return {
    collector_name: requiredText(els.collectorName.value, t("collector.name")),
    transaction_id: requiredText(els.transactionId.value, t("harvest.transactionId")),
    farmer_id: primaryFarmer?.farmer_id || null,
    farmer_record_id: primaryFarmer?.farmer_record_id || null,
    farmer_name_snapshot: primaryFarmer?.farmer_name_snapshot || null,
    community_id: nullableText(community?.community_id),
    community_record_id: community?.id || null,
    community_name_snapshot: communityName,
    create_community: communitySelection.create,
    sack_id: normalizedSackId() || null,
    collected_at: collectedAt.toISOString(),
    gps_latitude: state.gps?.latitude ?? null,
    gps_longitude: state.gps?.longitude ?? null,
    gps_accuracy_m: state.gps?.accuracy ?? null,
    sack_weight_kg: weight,
    seaweed_type: seaweedType,
    product_form: els.productForm.value || "wet",
    grade_code: gradeCode,
    seaweed_grade: ["A", "B", "C"].includes(gradeCode) ? gradeCode : null,
    price_per_kg: ungraded ? 0 : nullableNumber(els.pricePerKg.value),
    total_price: ungraded ? 0 : nullableNumber(els.totalPrice.value),
    price_overridden: ungraded ? false : els.priceOverridden.checked,
    price_override_reason: nullableText(els.priceOverrideReason.value),
    notes: nullableText(els.collectionNotes.value),
    photo_urls: photoPaths,
    custom_fields: customFields
  };
}

function collectionFarmersForSubmission() {
  const farmers = effectiveCollectionFarmers();
  const identities = new Set();
  const phones = new Set();
  farmers.forEach((farmer) => {
    const identity = farmerIdentityKey(farmer);
    if (identities.has(identity)) throw new Error(t("farmer.duplicateError"));
    identities.add(identity);
    const phone = normalizedPhoneDigits(farmer.phone_snapshot);
    if (phone.length >= FARMER_PHONE_LOOKUP_MIN_DIGITS && phones.has(phone)) {
      throw new Error(t("farmer.phoneDuplicateError"));
    }
    if (phone.length >= FARMER_PHONE_LOOKUP_MIN_DIGITS) phones.add(phone);
  });
  return farmers;
}

function farmerAllocationPayload(farmer) {
  return {
    farmer_record_id: farmer.farmer_record_id || null,
    farmer_id: farmer.farmer_id || null,
    farmer_name_snapshot: farmer.farmer_name_snapshot,
    phone_snapshot: farmer.phone_snapshot || null,
    community_record_id: farmer.community_record_id || null,
    community_id_snapshot: farmer.community_id_snapshot || null,
    community_name_snapshot: farmer.community_name_snapshot || null,
    farm_size_value: farmer.farm_size_value,
    farm_size_unit: farmer.farm_size_unit || null,
    weight_kg: farmer.weight_kg
  };
}

function validateIndividualFarmerWeights(farmers, totalWeight) {
  if (!farmers.length) return farmers;
  const entered = farmers.filter((farmer) => farmer.weight_kg !== null);
  if (!entered.length) return equalFarmerWeightAllocations(farmers, totalWeight);
  if (entered.length !== farmers.length) throw new Error(t("farmer.weightsCompleteError"));
  const allocated = entered.reduce((total, farmer) => total + Number(farmer.weight_kg || 0), 0);
  if (Math.abs(allocated - totalWeight) >= 0.005) {
    throw new Error(t("farmer.weightsTotalError", {
      allocated: formatCompactNumber(allocated),
      total: formatCompactNumber(totalWeight)
    }));
  }
  return farmers;
}

function equalFarmerWeightAllocations(farmers, totalWeight) {
  if (!farmers.length) return [];
  const totalHundredths = Math.round(Number(totalWeight) * 100);
  const baseHundredths = Math.floor(totalHundredths / farmers.length);
  const remainder = totalHundredths - (baseHundredths * farmers.length);
  return farmers.map((farmer, index) => ({
    ...farmer,
    weight_kg: (baseHundredths + (index < remainder ? 1 : 0)) / 100
  }));
}

function validateCollectionPricing(payload) {
  if (!payload.grade_code) throw new Error(t("grade.required"));
  if (payload.grade_code === "UNGRADED") return;
  if (selectedPricingRule()) return;
  const validOverride = state.canOverridePrice
    && payload.price_overridden
    && payload.price_per_kg !== null
    && payload.price_per_kg >= 0
    && Boolean(payload.price_override_reason);
  if (!validOverride) throw new Error(t("grade.priceMissing"));
}

function clearForm(options = {}) {
  const collectorName = String(els.collectorName.value || "").trim();
  const collectionCommunityId = els.collectionCommunityId.value;
  const collectionCommunityName = els.collectionCommunitySearch.value;
  const addingNewCommunity = state.addingNewCommunity;
  els.collectionForm.reset();
  els.collectionCommunityId.value = collectionCommunityId;
  els.collectionCommunitySearch.value = collectionCommunityName;
  state.addingNewCommunity = addingNewCommunity;
  state.communitySuggestionsOpen = false;
  state.activeCommunitySuggestion = -1;
  els.collectorName.value = collectorName || localStorage.getItem(COLLECTOR_NAME_STORAGE_KEY) || "";
  els.collectionWebsite.value = "";
  state.selectedFarmer = null;
  state.selectedFarmerPhoneQuery = "";
  clearPendingFarmer();
  state.collectionFarmers = [];
  state.currentFarmerWeight = null;
  state.gps = null;
  state.collectionPhotos = [];
  state.retakePhotoIndex = null;
  els.collectionPhotos.value = "";
  els.collectionPhotoRetake.value = "";
  closeCollectionPhotoActions();
  els.transactionId.value = "";
  els.gpsSummary.value = "";
  setDefaultDateTime();
  els.seaweedType.value = state.defaultSeaweedType;
  els.seaweedGrade.value = defaultGradeCode();
  els.productForm.value = "wet";
  state.submissionId = crypto.randomUUID();
  ensureTransactionId();
  syncFarmerCommunityName();
  syncCollectionCommunity();
  rememberCollectionCommunity();
  updateQuickReference();
  updateCustomCalculations();
  updatePhotoSelectionStatus();
  setFarmerStatus("");
  setFarmerPhoneMatchHint("farmer.phoneHint");
  updatePriceForGrade();
  updateEmptyFieldHighlights();
  els.submitCollection.disabled = false;
  operationFeedback?.hide();
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

function applySavedCollectionCommunity(saved) {
  const communityId = String(saved?.community_id || "").trim();
  const communityName = String(saved?.community_name || "").trim();
  const communityRecordId = String(saved?.community_record_id || "").trim();
  if (!communityId || !communityName) return;

  let community = communityById(communityId);
  if (!community) {
    community = {
      id: communityRecordId || null,
      community_id: communityId,
      community_name: communityName
    };
    state.communities.push(community);
    state.communities.sort((left, right) =>
      String(left.community_name || "").localeCompare(String(right.community_name || ""))
    );
    renderCommunityOptions();
  }

  const enteredName = normalizedCommunityNameInput(els.collectionCommunitySearch.value);
  if (normalizeCommunitySearchText(enteredName) !== normalizeCommunitySearchText(communityName)) return;
  state.addingNewCommunity = false;
  els.collectionCommunityId.value = communityId;
  els.collectionCommunitySearch.value = communityLabel(community);
  syncCollectionCommunity();
}

async function syncOutbox(options = {}) {
  if (!state.offline.ready || state.offline.syncing) return null;
  if (!isOnline()) {
    updateOfflineReadiness();
    if (options.announce) {
      setStatus(t("offline.localSaved"));
      operationFeedback.show({
        state: "stored",
        title: t("operation.storedTitle"),
        message: t("offline.localSaved"),
        actionLabel: t("action.done"),
        onAction: () => operationFeedback.hide()
      });
    }
    return null;
  }

  state.offline.syncing = true;
  try {
    await refreshOfflineQueue();
    const waiting = (await listOutboxItems())
      .filter((item) => item.status !== "synced")
      .filter((item) => !options.submissionId || item.submissionId === options.submissionId);
    if (options.announce) {
      operationFeedback.show({
        state: "progress",
        title: t("operation.syncingTitle"),
        message: t("operation.syncingProgress", { completed: 0, total: waiting.length })
      });
    }
    const result = await syncPendingCollections({
      submissionId: options.submissionId,
      online: isOnline(),
      currentUserId: state.session?.user?.id || null,
      onProgress: async (_submissionId, progress) => {
        if (options.announce) {
          operationFeedback.update({
            message: t("operation.syncingProgress", {
              completed: progress.processedCount,
              total: progress.totalCount
            })
          });
        }
        await refreshOfflineQueue();
      }
    });
    if (result.requestedError || (options.announce && result.failedCount)) {
      const error = result.requestedError || result.errors[0];
      const rejected = error?.serverRejected || error?.type === "server_rejected";
      const message = rejected ? friendlyServerRejection(error?.message) : (error?.message || t("offline.serverUnavailable"));
      setStatus(rejected
        ? t("offline.serverRejected", { message })
        : t("offline.serverUnavailable"), "error");
      if (options.announce) {
        operationFeedback.show({
          state: "error",
          title: rejected ? t("operation.rejectedTitle") : t("operation.syncPartialTitle"),
          message: rejected
            ? t("operation.rejectedMessage", { message })
            : t("operation.syncPartial", {
              synced: result.syncedCount,
              total: result.totalCount,
              failed: result.failedCount
            }),
          actionLabel: rejected ? t("action.openToday") : t("action.close"),
          onAction: rejected
            ? () => { window.location.href = "./today.html"; }
            : () => operationFeedback.hide()
        });
      }
    } else if (options.announce && result.remainingCount === 0) {
      setStatus(t("offline.syncComplete"));
      operationFeedback.show({
        state: "success",
        title: t("operation.syncCompleteTitle"),
        message: t("operation.syncSuccess", {
          synced: result.syncedCount,
          total: result.totalCount
        }),
        actionLabel: t("action.done"),
        onAction: () => operationFeedback.hide()
      });
    }
    return result;
  } finally {
    state.offline.syncing = false;
    await refreshOfflineQueue();
  }
}

async function autoSyncOutbox() {
  if (!state.offline.native || !state.offline.ready || !isOnline() || state.offline.syncing) return;
  const pending = (await listOutboxItems()).filter((item) => item.status !== "synced");
  if (pending.length > 0) await syncOutbox({ announce: true });
}

async function refreshOfflineQueue() {
  updateOfflineReadiness();
  if (!state.offline.ready) return;

  const items = await listOutboxItems();
  const pending = items.filter((item) => item.status !== "synced");
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
  setConnectionStatus(t("offline.offline"), "status-muted");
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

function normalizedPhoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("254")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function normalizeSackIdValue(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return `B-${raw.padStart(4, "0")}`;
  const match = raw.match(/^B-?(\d+)$/);
  if (match) return `B-${match[1].padStart(4, "0")}`;
  return raw;
}

function selectedCollectionCommunity() {
  return communityById(els.collectionCommunityId.value)
    || findExactCommunityFromText(els.collectionCommunitySearch.value);
}

function validatedCollectionCommunity() {
  const community = selectedCollectionCommunity();
  if (community) {
    return { community, name: community.community_name, create: false };
  }

  const name = normalizedCommunityNameInput(els.collectionCommunitySearch.value);
  if (!state.addingNewCommunity) {
    throw new Error(t("collection.selectCommunityError"));
  }
  if (name.length < 2 || name.length > 160) {
    throw new Error(t("collection.newCommunityLengthError"));
  }
  return { community: null, name, create: true };
}

function selectedFarmerCommunity() {
  return communityById(els.farmerCommunityId.value);
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
  const unit = String(els.manualFarmerFarmSizeUnit.value || "blocks").trim() || "blocks";
  return `${formatCompactNumber(value)} ${unitLabel(unit)}`;
}

function pendingFarmSizeUpdates(farmers) {
  return farmers
    .filter((farmer) => farmer.farmer_id && farmer.original_farm_size_unit !== null)
    .filter((farmer) => (
      farmer.original_farm_size_value !== farmer.farm_size_value
      || farmer.original_farm_size_unit !== farmer.farm_size_unit
    ))
    .map((farmer) => ({
      p_farmer_id: farmer.farmer_id,
      p_farm_size_value: farmer.farm_size_value,
      p_farm_size_unit: farmer.farm_size_unit
    }));
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

function findExactCommunityFromText(value) {
  const text = normalizeCommunitySearchText(value);
  if (!text) return null;
  return state.communities.find((community) => {
    const id = normalizeCommunitySearchText(community.community_id);
    const name = normalizeCommunitySearchText(community.community_name);
    const label = normalizeCommunitySearchText(communityLabel(community));
    return text === id || text === name || text === label;
  }) || null;
}

function normalizedCommunityNameInput(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCommunitySearchText(value) {
  return normalizedCommunityNameInput(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function communitySearchMatches(value) {
  const query = normalizeCommunitySearchText(value);
  return state.communities
    .map((community) => ({
      community,
      score: communitySearchScore(community, query)
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) =>
      left.score - right.score
      || String(left.community.community_name || "").localeCompare(String(right.community.community_name || ""))
    )
    .slice(0, 12)
    .map((entry) => entry.community);
}

function communitySearchScore(community, query) {
  if (!query) return 10;
  const id = normalizeCommunitySearchText(community.community_id);
  const name = normalizeCommunitySearchText(community.community_name);
  const label = normalizeCommunitySearchText(communityLabel(community));
  if ([id, name, label].includes(query)) return 0;
  if (id.startsWith(query) || name.startsWith(query)) return 1;
  if (id.includes(query) || name.includes(query) || label.includes(query)) return 2;
  if (query.split(" ").every((token) => label.includes(token))) return 3;

  const comparison = name.slice(0, Math.max(query.length, Math.min(name.length, query.length + 2)));
  const distance = levenshteinDistance(query, comparison);
  const threshold = Math.max(2, Math.ceil(query.length * 0.2));
  return distance <= threshold ? 4 + distance : Number.POSITIVE_INFINITY;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
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

  const configuredGrades = gradePrices.filter((row) => String(row.grade || "").toUpperCase() !== "UNGRADED");
  els.seaweedGrade.innerHTML = [
    ...configuredGrades.map((row) => {
      const name = row.label && row.label !== row.grade ? `${row.grade} - ${row.label}` : row.grade;
      const detail = row.rejected ? ` - ${t("grade.rejected")}` : "";
      return `<option value="${escapeAttribute(row.grade)}">${escapeHtml(name)}${escapeHtml(detail)}</option>`;
    }),
    `<option value="UNGRADED">${escapeHtml(t("grade.ungraded"))}</option>`
  ].join("");
  els.seaweedGrade.value = [...els.seaweedGrade.options].some((option) => option.value === selectedGrade)
    ? selectedGrade
    : defaultGradeCode();

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
    const label = control === els.collectionPhotos
      ? els.collectionPhotosField
      : control?.closest("label");
    if (!control || !label) return;
    const visible = ["sack_id", "sack_weight_kg"].includes(setting.field_key) || Boolean(setting.visible);
    label.hidden = !visible;
    label.style.order = String(setting.display_order || 0);
    const required = visible && control !== els.sackId && Boolean(setting.required);
    control.required = control === els.collectionPhotos ? false : required;
    if (control === els.collectionPhotos) label.dataset.photoRequired = String(required);
    control.disabled = !visible;
    updateLabelText(label, configuredFieldLabel(setting.field_key, setting.label));
    if (setting.default_value && !control.value) control.value = setting.default_value;
  });
  const weightField = els.sackWeightKg.closest("label");
  const weightOrder = Number(weightField?.style.order);
  if (weightField?.style.order && Number.isFinite(weightOrder)) {
    els.individualFarmerWeights.style.order = String(weightOrder + 1);
  } else {
    els.individualFarmerWeights.style.removeProperty("order");
  }

  els.farmerLinkStatus.closest(".field-status-block").hidden = true;
  document.querySelector(".quick-farmer-reference").hidden = false;
  els.farmerDetails.hidden = false;

  const priceVisible = state.formSettings.find((row) => row.field_key === "price_per_kg")?.visible !== false;
  const totalVisible = state.formSettings.find((row) => row.field_key === "total_price")?.visible !== false;
  els.priceOverridden.closest("label").hidden = !priceVisible && !totalVisible;
  updateOverrideReasonVisibility();
  applyCollectionAccessMode();
}

function defaultGradeCode() {
  const options = [...els.seaweedGrade.options];
  if (options.some((option) => option.value === "A")) return "A";
  return options.find((option) => option.value && option.value !== "UNGRADED")?.value || "UNGRADED";
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
      || control.closest(".public-form-trap")
      || control.disabled;
    const shouldHighlight = !excluded && (control.required || control.dataset.recommended === "true");
    if (!shouldHighlight) {
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
    payload.farm_size_unit = els.manualFarmerFarmSizeUnit.value || "blocks";
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
    [els.manualFarmerPhone.closest("label"), 10],
    [document.querySelector(".field-status-block"), 20],
    [document.querySelector(".quick-farmer-reference"), 30],
    [els.farmerDetails, 40],
    [els.transactionId.closest("label"), 25],
    [els.productForm.closest("label"), 85],
    [els.priceOverridden.closest("label"), 95],
    [els.customCollectionFields, 96],
    [els.collectionPhotosField, 110]
  ];
  fixedOrder.forEach(([element, order]) => {
    if (element) element.style.order = String(order);
  });
}

function refreshTranslatedContent() {
  applyRuntimeSettings(state.gradePrices);
  updateCollectionCommunityMode();
  renderCollectionCommunitySuggestions();
  updateQuickReference();
  updatePhotoSelectionStatus();
  setConnectionStatus(isOnline() ? translatedDataMode() : t("offline.offline"), isOnline() ? "" : "status-muted");
  updateOfflineReadiness();
  void refreshOfflineQueue();
  if (state.selectedFarmer) {
    setFarmerStatus(t("status.linked"));
    setFarmerPhoneMatchHint("farmer.phoneMatched");
  } else if (state.pendingFarmer) {
    setFarmerPhoneMatchHint("farmer.phonePossibleMatch");
  } else if (!normalizedFarmerId()) {
    setFarmerStatus("");
    setFarmerPhoneMatchHint(
      normalizedPhoneDigits(els.manualFarmerPhone.value).length
        ? "farmer.phoneNoMatch"
        : "farmer.phoneHint"
    );
  }
}

function translatedDataMode() {
  const mode = dataModeLabel();
  if (mode === "Preview") return t("status.preview");
  if (mode === "Live") return t("status.live");
  return mode;
}

function updateLabelText(label, text) {
  const configuredLabel = label.querySelector?.("[data-field-label]");
  if (configuredLabel) {
    configuredLabel.textContent = text;
    return;
  }
  const labelSpan = [...label.children].find((child) => child.tagName === "SPAN" && !child.classList.contains("input-action-row"));
  if (labelSpan) {
    labelSpan.textContent = text;
    return;
  }
  const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = `\n            ${text}\n            `;
}

function setConnectionStatus(text, extraClass = "") {
  const offline = !isOnline();
  els.collectionConnectionStatus.hidden = !offline;
  els.collectionConnectionStatus.textContent = offline ? "!" : "";
  els.collectionConnectionStatus.className = "connection-offline-indicator";
  els.collectionConnectionStatus.setAttribute("aria-label", offline ? t("offline.offline") : "");
  els.collectionConnectionStatus.title = offline ? t("offline.offline") : "";
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
