const STORAGE_KEY = "seaweed_harvest:collection_language";

const packs = {
  en: {
    locale: "en-KE",
    text: {
      "meta.title": "Collection - Seaweed Aggregation",
      "app.eyebrow": "Seaweed aggregation",
      "page.title": "Collection",
      "nav.ariaLabel": "Main navigation",
      "nav.collection": "Collection",
      "nav.today": "Today's Intake",
      "nav.admin": "Admin",
      "nav.signIn": "Sign in",
      "account.changePassword": "Change password",
      "account.myDetails": "My details",
      "account.signOut": "Sign out",
      "language.ariaLabel": "Language",
      "language.label": "Language:",
      "language.choose": "Choose language",
      "aggregator.label": "Aggregator",
      "collector.name": "Collector name",
      "farmer.legend": "Farmer",
      "farmer.id": "Farmer ID",
      "farmer.detailsSummary": "Farmer Detail - Enter Details:",
      "farmer.firstName": "First name",
      "farmer.lastNames": "Last / other names",
      "farmer.phone": "Phone",
      "farmer.community": "Community",
      "farmer.communityPlaceholder": "Type community",
      "farmer.farmSize": "Farm size",
      "farmer.farmSizeUnit": "Farm size unit",
      "farmer.assignId": "Assign ID number",
      "quick.name": "Name:",
      "quick.community": "Community:",
      "quick.farmSize": "Farm size:",
      "harvest.legend": "Harvest",
      "harvest.sackId": "Sack ID",
      "harvest.transactionId": "Transaction ID",
      "harvest.dateTime": "Date / time",
      "harvest.gps": "GPS",
      "harvest.weight": "Weight kg",
      "harvest.seaweedType": "Seaweed type (common name)",
      "harvest.grade": "Grade",
      "harvest.productForm": "Product form",
      "harvest.pricePerKg": "Price / kg",
      "harvest.totalPrice": "Total price",
      "harvest.manualPrice": "Manual price",
      "harvest.overrideReason": "Price override reason",
      "harvest.notes": "Notes",
      "harvest.photos": "Photos",
      "photos.hint": "Up to 5 photos. Compressed before upload.",
      "photos.selected": "{count} photo(s) selected. Compressed when saved.",
      "photos.processing": "Preparing photo {current} of {total}...",
      "photos.uploading": "Uploading photo {current} of {total}...",
      "photos.uploaded": "{count} photo(s) uploaded.",
      "photos.tooMany": "Select no more than 5 photos.",
      "photos.invalid": "Only image files can be uploaded.",
      "photos.decodeFailed": "A photo could not be opened. Take it again or choose a JPEG image.",
      "photos.compressFailed": "A photo could not be reduced below 700 KB.",
      "action.lookup": "Lookup",
      "action.scan": "Scan",
      "action.submit": "Submit collection",
      "action.clear": "Clear",
      "action.cancel": "Cancel",
      "action.close": "Close",
      "receipt.saved": "Collection receipt",
      "receipt.view": "View receipt",
      "product.wet": "Wet",
      "product.dried": "Dried",
      "product.milled": "Milled",
      "common.optional": "Optional",
      "common.select": "Select",
      "unit.lines": "Lines",
      "unit.ropes": "Ropes",
      "unit.plots": "Plots",
      "unit.acres": "Acres",
      "unit.hectares": "Hectares",
      "unit.sqm": "Square metres",
      "unit.other": "Other",
      "scanner.title": "Scan QR Code",
      "scanner.pointCamera": "Point camera at QR code.",
      "scanner.opening": "Opening camera...",
      "scanner.farmer": "Scan Farmer ID QR code.",
      "scanner.sack": "Scan Sack ID QR code.",
      "scanner.unavailable": "Camera access is not available. Type the number instead.",
      "scanner.loadFailed": "QR scanner could not load. Refresh the page and try again.",
      "scanner.noValue": "QR code did not contain a usable value.",
      "scanner.farmerScanned": "Farmer ID scanned.",
      "scanner.sackScanned": "Sack ID scanned.",
      "scanner.permissionBlocked": "Camera permission was blocked. Type the number instead.",
      "scanner.noCamera": "No camera was found. Type the number instead.",
      "scanner.openFailed": "Could not open camera. Type the number instead.",
      "status.loading": "Loading",
      "status.preview": "Preview",
      "status.live": "Live",
      "status.error": "Error",
      "status.lookupFailed": "Lookup failed",
      "status.notFound": "Not found",
      "status.linked": "Linked",
      "status.saving": "Saving collection...",
      "status.saved": "Saved.",
      "status.savedTransaction": "Saved {id}.",
      "status.farmSizeUpdated": "Farm size updated.",
      "status.farmSizeWarning": "Collection saved, but farm size was not updated: {message}",
      "gps.unavailable": "GPS unavailable",
      "gps.getting": "Getting GPS...",
      "gps.notCaptured": "GPS not captured",
      "validation.required": "{field} is required.",
      "type.other": "Other type",
      "grade.rejected": "Rejected"
    }
  },
  sw: {
    locale: "sw-KE",
    text: {
      "meta.title": "Mapokezi - Mwani",
      "app.eyebrow": "Mapokezi ya mwani",
      "page.title": "Mapokezi",
      "nav.ariaLabel": "Kurasa kuu",
      "nav.collection": "Mapokezi",
      "nav.today": "Mapokezi ya leo",
      "nav.admin": "Usimamizi",
      "nav.signIn": "Ingia",
      "account.changePassword": "Badili nenosiri",
      "account.myDetails": "Taarifa zangu",
      "account.signOut": "Toka",
      "language.ariaLabel": "Lugha",
      "language.label": "Lugha:",
      "language.choose": "Chagua lugha",
      "aggregator.label": "Mnunuzi",
      "collector.name": "Jina la mpokeaji",
      "farmer.legend": "Mkulima",
      "farmer.id": "Namba ya mkulima",
      "farmer.detailsSummary": "Taarifa za mkulima - weka taarifa:",
      "farmer.firstName": "Jina la kwanza",
      "farmer.lastNames": "Jina la ukoo / majina mengine",
      "farmer.phone": "Simu",
      "farmer.community": "Kikundi",
      "farmer.communityPlaceholder": "Andika kikundi",
      "farmer.farmSize": "Ukubwa wa shamba",
      "farmer.farmSizeUnit": "Kipimo",
      "farmer.assignId": "Toa namba ya mkulima",
      "quick.name": "Jina:",
      "quick.community": "Kikundi:",
      "quick.farmSize": "Ukubwa wa shamba:",
      "harvest.legend": "Mavuno",
      "harvest.sackId": "Namba ya gunia",
      "harvest.transactionId": "Namba ya rekodi",
      "harvest.dateTime": "Tarehe / saa",
      "harvest.gps": "GPS",
      "harvest.weight": "Uzito (kg)",
      "harvest.seaweedType": "Aina ya mwani (jina la kawaida)",
      "harvest.grade": "Daraja",
      "harvest.productForm": "Hali ya mwani",
      "harvest.pricePerKg": "Bei kwa kilo",
      "harvest.totalPrice": "Jumla ya bei",
      "harvest.manualPrice": "Weka bei mwenyewe",
      "harvest.overrideReason": "Sababu ya kubadili bei",
      "harvest.notes": "Maelezo",
      "harvest.photos": "Picha",
      "photos.hint": "Hadi picha 5. Zinapunguzwa kabla ya kutumwa.",
      "photos.selected": "Picha {count} zimechaguliwa. Zitapunguzwa ukihifadhi.",
      "photos.processing": "Inatayarisha picha {current} kati ya {total}...",
      "photos.uploading": "Inatuma picha {current} kati ya {total}...",
      "photos.uploaded": "Picha {count} zimetumwa.",
      "photos.tooMany": "Chagua picha zisizozidi 5.",
      "photos.invalid": "Chagua picha tu.",
      "photos.decodeFailed": "Picha haikufunguka. Piga tena au chagua picha ya JPEG.",
      "photos.compressFailed": "Picha haikuweza kupunguzwa chini ya KB 700.",
      "action.lookup": "Tafuta",
      "action.scan": "Soma QR",
      "action.submit": "Hifadhi mapokezi",
      "action.clear": "Futa",
      "action.cancel": "Funga",
      "action.close": "Funga",
      "receipt.saved": "Risiti ya mapokezi",
      "receipt.view": "Angalia risiti",
      "product.wet": "Mbichi",
      "product.dried": "Kavu",
      "product.milled": "Unga",
      "common.optional": "Si lazima",
      "common.select": "Chagua",
      "unit.lines": "Mistari",
      "unit.ropes": "Kamba",
      "unit.plots": "Vipande",
      "unit.acres": "Eka",
      "unit.hectares": "Hekta",
      "unit.sqm": "Mita mraba",
      "unit.other": "Nyingine",
      "scanner.title": "Soma QR",
      "scanner.pointCamera": "Elekeza kamera kwenye QR.",
      "scanner.opening": "Kamera inafunguka...",
      "scanner.farmer": "Soma QR ya namba ya mkulima.",
      "scanner.sack": "Soma QR ya namba ya gunia.",
      "scanner.unavailable": "Kamera haipatikani. Andika namba.",
      "scanner.loadFailed": "QR haikufunguka. Fungua ukurasa upya ujaribu tena.",
      "scanner.noValue": "QR hii haina namba inayoweza kutumika.",
      "scanner.farmerScanned": "Namba ya mkulima imesomwa.",
      "scanner.sackScanned": "Namba ya gunia imesomwa.",
      "scanner.permissionBlocked": "Ruhusa ya kamera imezuiwa. Andika namba.",
      "scanner.noCamera": "Kamera haijapatikana. Andika namba.",
      "scanner.openFailed": "Kamera haikufunguka. Andika namba.",
      "status.loading": "Inapakia",
      "status.preview": "Mfano",
      "status.live": "Mtandaoni",
      "status.error": "Hitilafu",
      "status.lookupFailed": "Imeshindikana kutafuta",
      "status.notFound": "Hajapatikana",
      "status.linked": "Amepatikana",
      "status.saving": "Inahifadhi...",
      "status.saved": "Imehifadhiwa.",
      "status.savedTransaction": "Imehifadhiwa {id}.",
      "status.farmSizeUpdated": "Ukubwa wa shamba umebadilishwa.",
      "status.farmSizeWarning": "Mapokezi yamehifadhiwa, lakini ukubwa wa shamba haukubadilishwa: {message}",
      "gps.unavailable": "GPS haipatikani",
      "gps.getting": "Inatafuta GPS...",
      "gps.notCaptured": "GPS haijapatikana",
      "validation.required": "Weka {field}.",
      "type.other": "Aina nyingine",
      "grade.rejected": "Imekataliwa"
    }
  }
};

let currentLanguage = initialLanguage();

export function initCollectionLanguage() {
  applyLanguage();
  document.querySelectorAll("[data-language-option]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.languageOption));
  });
}

export function setLanguage(language) {
  if (!packs[language] || language === currentLanguage) return;
  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);
  applyLanguage();
  document.dispatchEvent(new CustomEvent("seaweed-collection-language-change", {
    detail: { language }
  }));
}

export function getLanguage() {
  return currentLanguage;
}

export function t(key, replacements = {}) {
  const template = packs[currentLanguage]?.text[key] ?? packs.en.text[key] ?? key;
  return Object.entries(replacements).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template
  );
}

export function configuredFieldLabel(fieldKey, configuredLabel) {
  if (currentLanguage === "en") return configuredLabel;
  const key = {
    farmer_id: "farmer.id",
    sack_id: "harvest.sackId",
    transaction_id: "harvest.transactionId",
    collected_at: "harvest.dateTime",
    gps: "harvest.gps",
    sack_weight_kg: "harvest.weight",
    seaweed_type: "harvest.seaweedType",
    seaweed_grade: "harvest.grade",
    product_form: "harvest.productForm",
    price_per_kg: "harvest.pricePerKg",
    total_price: "harvest.totalPrice",
    notes: "harvest.notes",
    photos: "harvest.photos"
  }[fieldKey];
  return key ? t(key) : configuredLabel;
}

export function unitLabel(unit) {
  const key = `unit.${String(unit || "lines")}`;
  return packs[currentLanguage].text[key] || String(unit || "lines");
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-language-option]").forEach((button) => {
    const active = button.dataset.languageOption === currentLanguage;
    button.setAttribute("aria-pressed", String(active));
  });
}

function initialLanguage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (packs[saved]) return saved;
  const browserLanguage = String(navigator.language || "").toLowerCase();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browserLanguage.startsWith("sw") || timezone === "Africa/Nairobi" ? "sw" : "en";
}
