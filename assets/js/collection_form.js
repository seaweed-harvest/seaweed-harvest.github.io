import { APP_CONFIG } from "./config.js";
import { callRpc, dataModeLabel, insertRow, isSupabaseEnabled, selectRows } from "./supabase_client.js";
import {
  configuredFieldLabel,
  initCollectionLanguage,
  t,
  unitLabel
} from "./collection_language.js";

const state = {
  communities: [],
  farmers: [],
  formSettings: [],
  gradePrices: [],
  pricePerKg: { ...APP_CONFIG.pricePerKg },
  seaweedTypes: [],
  customFields: [],
  defaultSeaweedType: "spinosum",
  selectedFarmer: null,
  gps: null,
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

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  initCollectionLanguage();
  cacheElements();
  bindEvents();
  setDefaultDateTime();
  await loadFormData();
  ensureTransactionId();
}

function cacheElements() {
  [
    "collectionConnectionStatus",
    "collectionForm",
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
    "pricePerKg",
    "totalPrice",
    "priceOverridden",
    "customCollectionFields",
    "collectionNotes",
    "collectionPhotos",
    "clearCollectionForm",
    "collectionSaveStatus",
    "qrScannerModal",
    "qrScannerVideo",
    "qrScannerStatus",
    "stopQrScanner"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
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
  els.pricePerKg.addEventListener("input", () => {
    els.priceOverridden.checked = true;
    updateTotalPrice();
  });
  els.totalPrice.addEventListener("input", () => {
    els.priceOverridden.checked = true;
  });
  els.clearCollectionForm.addEventListener("click", clearForm);
  els.collectionForm.addEventListener("submit", submitCollection);
  els.collectionForm.addEventListener("input", updateCustomCalculations);
  els.collectionForm.addEventListener("change", updateCustomCalculations);
  els.stopQrScanner.addEventListener("click", stopQrScanner);
  document.addEventListener("seaweed-collection-language-change", refreshTranslatedContent);
}

async function loadFormData() {
  setConnectionStatus(t("status.loading"), "status-muted");
  try {
    const [communities, farmers, formSettings, gradePrices, seaweedTypes, customFields] = await Promise.all([
      selectRows(APP_CONFIG.tables.communities, "select=*&order=community_id.asc"),
      isSupabaseEnabled()
        ? Promise.resolve([])
        : selectRows(APP_CONFIG.tables.farmers, "select=*&order=farmer_id.asc"),
      selectRows("ag_public_collection_form_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_grade_price_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"),
      selectRows("ag_public_collection_custom_fields", "select=*&order=display_order.asc")
    ]);
    state.communities = communities;
    state.farmers = farmers;
    state.formSettings = formSettings;
    state.gradePrices = gradePrices;
    state.seaweedTypes = seaweedTypes;
    state.customFields = customFields;
    state.pricePerKg = {};
    gradePrices.forEach((row) => { state.pricePerKg[row.grade] = Number(row.price_per_kg); });
    state.defaultSeaweedType = seaweedTypes.find((row) => row.is_default)?.type_key || "spinosum";
    renderCommunityOptions();
    applyRuntimeSettings(gradePrices);
    renderCustomFields();
    updateQuickReference();
    setConnectionStatus(translatedDataMode(), dataModeLabel() === "Preview" ? "status-muted" : "");
  } catch (error) {
    setConnectionStatus(t("status.error"), "status-muted");
    setStatus(error.message, "error");
  }
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
      const result = await callRpc("ag_public_farmer_lookup", { p_farmer_id: farmerId });
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
  const grade = els.seaweedGrade.value;
  const configuredPrice = state.pricePerKg[grade];
  if (configuredPrice !== null && configuredPrice !== undefined) {
    els.pricePerKg.value = configuredPrice;
    els.priceOverridden.checked = false;
  }
  updateTotalPrice();
}

function updatePrice() {
  if (!els.priceOverridden.checked) updateTotalPrice();
}

function updateTotalPrice() {
  if (els.priceOverridden.checked && document.activeElement === els.totalPrice) return;

  const weight = nullableNumber(els.sackWeightKg.value);
  const price = nullableNumber(els.pricePerKg.value);
  if (weight === null || price === null) return;
  els.totalPrice.value = (weight * price).toFixed(2);
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
    return;
  }

  els.gpsSummary.value = t("gps.getting");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.gps = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      els.gpsSummary.value = `${state.gps.latitude.toFixed(5)}, ${state.gps.longitude.toFixed(5)}`;
    },
    () => {
      els.gpsSummary.value = t("gps.notCaptured");
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

async function submitCollection(event) {
  event.preventDefault();

  try {
    setStatus(t("status.saving"));
    const payload = buildPayload();
    const farmSizeUpdate = pendingFarmSizeUpdate();
    const rows = await insertRow(APP_CONFIG.tables.collections, payload);
    const saved = rows[0];
    let farmSizeWarning = "";
    if (farmSizeUpdate) {
      try {
        await callRpc("ag_update_farmer_farm_size_from_collection", farmSizeUpdate);
      } catch (error) {
        farmSizeWarning = t("status.farmSizeWarning", { message: error.message });
      }
    }
    const savedMessage = saved?.transaction_id
      ? t("status.savedTransaction", { id: saved.transaction_id })
      : t("status.saved");
    clearForm();
    const updateMessage = farmSizeUpdate && !farmSizeWarning ? ` ${t("status.farmSizeUpdated")}` : "";
    const warningMessage = farmSizeWarning ? ` ${farmSizeWarning}` : "";
    setStatus(`${savedMessage}${updateMessage}${warningMessage}`, farmSizeWarning ? "error" : "");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function buildPayload() {
  const farmerId = nullableText(normalizedFarmerId());
  const sackId = nullableText(normalizedSackId());
  const community = selectedCommunity();
  const weight = requiredNumber(els.sackWeightKg.value, t("harvest.weight"));
  const seaweedType = nullableText(els.seaweedType.value) || state.defaultSeaweedType;
  const gradeCode = nullableText(els.seaweedGrade.value);
  const collectedAt = els.collectedAt.value ? new Date(els.collectedAt.value) : new Date();
  const farmerNameSnapshot = combinedManualFarmerName() || state.selectedFarmer?.name || null;

  return {
    transaction_id: requiredText(els.transactionId.value, t("harvest.transactionId")),
    farmer_id: farmerId,
    farmer_record_id: state.selectedFarmer?.id || null,
    farmer_name_snapshot: farmerNameSnapshot,
    community_id: nullableText(els.communityId.value),
    community_record_id: community?.id || null,
    community_name_snapshot: community?.community_name || null,
    sack_id: sackId,
    collected_at: collectedAt.toISOString(),
    gps_latitude: state.gps?.latitude ?? null,
    gps_longitude: state.gps?.longitude ?? null,
    gps_accuracy_m: state.gps?.accuracy ?? null,
    sack_weight_kg: weight,
    seaweed_type: seaweedType,
    grade_code: gradeCode,
    seaweed_grade: ["A", "B", "C"].includes(gradeCode) ? gradeCode : null,
    price_per_kg: nullableNumber(els.pricePerKg.value),
    total_price: nullableNumber(els.totalPrice.value),
    price_overridden: els.priceOverridden.checked,
    notes: nullableText(els.collectionNotes.value),
    photo_urls: [],
    custom_fields: customFieldPayload()
  };
}

function clearForm() {
  els.collectionForm.reset();
  state.selectedFarmer = null;
  state.gps = null;
  els.transactionId.value = "";
  els.gpsSummary.value = "";
  setDefaultDateTime();
  els.seaweedType.value = state.defaultSeaweedType;
  ensureTransactionId();
  syncCommunityName();
  updateQuickReference();
  updateCustomCalculations();
  setFarmerStatus("");
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
      const detail = row.rejected ? t("grade.rejected") : `${formatCompactNumber(row.price_per_kg)} KSH/kg`;
      return `<option value="${escapeAttribute(row.grade)}">${escapeHtml(name)} - ${escapeHtml(detail)}</option>`;
    })
  ].join("");
  els.seaweedGrade.value = [...els.seaweedGrade.options].some((option) => option.value === selectedGrade)
    ? selectedGrade
    : "";

  const controls = {
    farmer_id: els.farmerId,
    sack_id: els.sackId,
    transaction_id: els.transactionId,
    collected_at: els.collectedAt,
    gps: els.gpsSummary,
    sack_weight_kg: els.sackWeightKg,
    seaweed_type: els.seaweedType,
    seaweed_grade: els.seaweedGrade,
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

  const farmerVisible = state.formSettings.find((row) => row.field_key === "farmer_id")?.visible !== false;
  els.farmerLinkStatus.closest(".field-status-block").hidden = !farmerVisible;
  document.querySelector(".quick-farmer-reference").hidden = !farmerVisible;
  els.farmerDetails.hidden = !farmerVisible;

  const priceVisible = state.formSettings.find((row) => row.field_key === "price_per_kg")?.visible !== false;
  const totalVisible = state.formSettings.find((row) => row.field_key === "total_price")?.visible !== false;
  els.priceOverridden.closest("label").hidden = !priceVisible && !totalVisible;
}

function renderCustomFields() {
  els.customCollectionFields.hidden = state.customFields.length === 0;
  els.customCollectionFields.innerHTML = state.customFields.map(customFieldControl).join("");
  updateCustomCalculations();
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
  setConnectionStatus(translatedDataMode(), dataModeLabel() === "Preview" ? "status-muted" : "");
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
